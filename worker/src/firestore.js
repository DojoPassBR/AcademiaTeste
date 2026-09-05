// Cliente mínimo do Firestore REST API pra rodar em Cloudflare Workers (sem Node/firebase-admin).
// Autentica como service account: monta um JWT, assina com a chave privada (RS256) via Web Crypto,
// troca por um access token OAuth2 no Google, e usa esse token pra chamar a REST API do Firestore.
// Esse token tem permissão de admin — é por isso que as Firestore Rules podem bloquear o cliente
// (`allow write: if false`) e mesmo assim o Worker consegue escrever.

function base64url(bytes) {
  let str = typeof bytes === "string" ? bytes : String.fromCharCode(...new Uint8Array(bytes));
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function importPrivateKey(pem) {
  const pemBody = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const der = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

// Cache de módulo do Worker: o access token vale 1h, então gerar um novo (com uma
// assinatura RSA + um round-trip ao Google) a cada chamada era desperdício puro.
// Reusa enquanto faltar mais de 60s pra expirar.
let tokenCache = null; // { token: string, expiraEm: number }

async function getAccessToken(env) {
  if (tokenCache && tokenCache.expiraEm - 60000 > Date.now()) return tokenCache.token;

  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: env.FIREBASE_CLIENT_EMAIL,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: nowSeconds,
    exp: nowSeconds + 3600
  };

  const unsigned = base64url(JSON.stringify(header)) + "." + base64url(JSON.stringify(claims));
  const key = await importPrivateKey(env.FIREBASE_PRIVATE_KEY);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned)
  );
  const jwt = unsigned + "." + base64url(signature);

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=" + encodeURIComponent(jwt)
  });

  if (!resp.ok) {
    console.error("Falha ao obter access token do Google:", await resp.text());
    throw new Error("Falha ao autenticar no Google.");
  }

  const data = await resp.json();
  const expiresIn = Number(data.expires_in) || 3600;
  tokenCache = { token: data.access_token, expiraEm: Date.now() + expiresIn * 1000 };
  return tokenCache.token;
}

// Exportado só pra testes/depuração.
function limparCacheToken() {
  tokenCache = null;
}

function baseUrl(env, path) {
  return `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`;
}

// Converte um objeto JS simples (sem aninhamento) pro formato de "fields" da REST API do Firestore.
function toFirestoreFields(obj) {
  const fields = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
      fields[key] = { nullValue: null };
    } else if (typeof value === "string") {
      fields[key] = { stringValue: value };
    } else if (typeof value === "number") {
      fields[key] = { doubleValue: value };
    } else if (typeof value === "boolean") {
      fields[key] = { booleanValue: value };
    } else if (value instanceof Date) {
      fields[key] = { timestampValue: value.toISOString() };
    }
  }
  return fields;
}

function erroNaoEncontrado(mensagem) {
  const err = new Error(mensagem);
  err.naoEncontrado = true;
  return err;
}

function updateMaskQuery(data) {
  return Object.keys(data)
    .map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`)
    .join("&");
}

// GET de um documento. Devolve o objeto cru da REST API, ou null se não existir.
async function getDocument(env, path) {
  const accessToken = await getAccessToken(env);
  const resp = await fetch(baseUrl(env, path), {
    headers: { Authorization: "Bearer " + accessToken }
  });

  if (resp.status === 404) return null;
  if (!resp.ok) {
    console.error("Falha ao ler no Firestore (" + path + "):", await resp.text());
    throw new Error("Falha ao ler no Firestore.");
  }
  return resp.json();
}

// Cria um documento com ID definido pelo chamador (o último segmento de `path`),
// falhando se ele já existir (currentDocument.exists=false). Diferente de patchDocument,
// que é upsert — aqui um ID repetido é erro, não sobrescrita silenciosa.
async function createDocument(env, path, data) {
  const accessToken = await getAccessToken(env);
  const url = baseUrl(env, path) + "?currentDocument.exists=false&" + updateMaskQuery(data);

  const resp = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: "Bearer " + accessToken,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ fields: toFirestoreFields(data) })
  });

  if (!resp.ok) {
    const texto = await resp.text();
    console.error("Falha ao criar no Firestore (" + path + "):", texto);
    if (resp.status === 409 || resp.status === 400) {
      const err = new Error("Documento já existe no Firestore.");
      err.jaExiste = true;
      throw err;
    }
    throw new Error("Falha ao gravar no Firestore.");
  }
  return resp.json();
}

// PATCH com updateMask. Por padrão é upsert (cria se não existir).
// Com { exigirExistente: true }, só atualiza um documento que já existe — usado pelo
// webhook pra nunca criar um "aluno fantasma" a partir de um external_reference qualquer.
// Nesse caso, documento inexistente vira um Error com .naoEncontrado = true.
async function patchDocument(env, path, data, opcoes = {}) {
  const accessToken = await getAccessToken(env);
  const url =
    baseUrl(env, path) +
    "?" +
    (opcoes.exigirExistente ? "currentDocument.exists=true&" : "") +
    updateMaskQuery(data);

  const resp = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: "Bearer " + accessToken,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ fields: toFirestoreFields(data) })
  });

  if (!resp.ok) {
    const texto = await resp.text();
    console.error("Falha ao gravar no Firestore (" + path + "):", texto);
    // A REST API responde 404 (NOT_FOUND) ou 400 (FAILED_PRECONDITION) quando a
    // precondition currentDocument.exists=true não é satisfeita.
    if (opcoes.exigirExistente && (resp.status === 404 || resp.status === 400)) {
      throw erroNaoEncontrado("Documento não encontrado no Firestore: " + path);
    }
    throw new Error("Falha ao gravar no Firestore.");
  }
  return resp.json();
}

export { getDocument, createDocument, patchDocument, limparCacheToken };
