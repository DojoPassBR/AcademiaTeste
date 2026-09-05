// Verificação de ID token do Firebase Authentication dentro do Cloudflare Worker,
// SEM firebase-admin (que depende de Node e não roda aqui). O fluxo é o mesmo que a
// biblioteca oficial faz: baixa o JWKS público do Google, acha a chave pelo "kid" do
// header do JWT, valida a assinatura RS256 com Web Crypto e confere as claims
// (aud, iss, exp, sub).
//
// Usado por /criar-cobranca: sem isso, qualquer pessoa na internet que descobrisse a URL
// do Worker conseguiria gerar cobranças Pix em nome de qualquer aluno.

const JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

// Cache de módulo do Worker (vive enquanto a isolate estiver quente). TTL curto de 1h —
// o Google publica as chaves com validade bem maior, então isso é conservador.
const JWKS_TTL_MS = 60 * 60 * 1000;
let jwksCache = null; // { chaves: { [kid]: jwk }, expiraEm: number }

function base64urlParaBytes(str) {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binario = atob(padded);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

function base64urlParaJson(str) {
  return JSON.parse(new TextDecoder().decode(base64urlParaBytes(str)));
}

async function carregarJwks() {
  const agora = Date.now();
  if (jwksCache && jwksCache.expiraEm > agora) return jwksCache.chaves;

  const resp = await fetch(JWKS_URL);
  if (!resp.ok) throw new Error("Não foi possível obter as chaves públicas do Firebase.");

  const corpo = await resp.json();
  const chaves = {};
  for (const jwk of corpo.keys || []) {
    if (jwk.kid) chaves[jwk.kid] = jwk;
  }
  if (!Object.keys(chaves).length) throw new Error("JWKS do Firebase veio vazio.");

  jwksCache = { chaves, expiraEm: agora + JWKS_TTL_MS };
  return chaves;
}

// Exportado só pra testes/depuração: força o próximo verificarIdToken a rebaixar o JWKS.
function limparCacheJwks() {
  jwksCache = null;
}

/**
 * Valida um ID token do Firebase e devolve { uid }.
 * Lança Error com mensagem clara em qualquer falha.
 *
 * @param {object} env  bindings do Worker (precisa de FIREBASE_PROJECT_ID)
 * @param {string|null} authorizationHeader  conteúdo do header Authorization
 */
async function verificarIdToken(env, authorizationHeader) {
  if (!env.FIREBASE_PROJECT_ID) throw new Error("FIREBASE_PROJECT_ID não configurado no Worker.");

  if (!authorizationHeader || !/^Bearer\s+/i.test(authorizationHeader)) {
    throw new Error("Token de autenticação ausente.");
  }

  const token = authorizationHeader.replace(/^Bearer\s+/i, "").trim();
  const partes = token.split(".");
  if (partes.length !== 3) throw new Error("Token de autenticação malformado.");

  let header;
  let payload;
  try {
    header = base64urlParaJson(partes[0]);
    payload = base64urlParaJson(partes[1]);
  } catch (err) {
    throw new Error("Token de autenticação malformado.");
  }

  if (header.alg !== "RS256") throw new Error("Token de autenticação com algoritmo inesperado.");
  if (!header.kid) throw new Error("Token de autenticação sem kid.");

  const chaves = await carregarJwks();
  const jwk = chaves[header.kid];
  if (!jwk) throw new Error("Token de autenticação assinado por chave desconhecida.");

  const chave = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );

  const assinaturaValida = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    chave,
    base64urlParaBytes(partes[2]),
    new TextEncoder().encode(partes[0] + "." + partes[1])
  );
  if (!assinaturaValida) throw new Error("Assinatura do token de autenticação inválida.");

  const agoraSegundos = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp <= agoraSegundos) {
    throw new Error("Token de autenticação expirado.");
  }
  if (typeof payload.iat === "number" && payload.iat > agoraSegundos + 300) {
    throw new Error("Token de autenticação com data de emissão no futuro.");
  }
  if (payload.aud !== env.FIREBASE_PROJECT_ID) {
    throw new Error("Token de autenticação de outro projeto Firebase.");
  }
  if (payload.iss !== "https://securetoken.google.com/" + env.FIREBASE_PROJECT_ID) {
    throw new Error("Token de autenticação com emissor inválido.");
  }
  if (typeof payload.sub !== "string" || !payload.sub) {
    throw new Error("Token de autenticação sem usuário.");
  }

  return { uid: payload.sub };
}

export { verificarIdToken, limparCacheJwks };
