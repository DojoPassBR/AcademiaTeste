// Credencial do Asaas cadastrada pelo próprio professor (Fase 5).
//
// Antes, a chave de API do Asaas era SÓ a secret ASAAS_API_KEY do Worker — ou seja, quem
// mexia nela era quem tinha acesso ao Cloudflare (o dev), não o dono da academia. Agora o
// professor cadastra a própria chave pelo painel e ela fica CIFRADA no Firestore, no
// documento `config/credenciais`.
//
// Camadas de proteção desse documento:
//   1. firestore.rules NEGA read e write de `config/credenciais` pra qualquer cliente
//      (inclusive admin) — só o Worker, via service account, enxerga o documento.
//   2. Mesmo lendo o documento, o valor está cifrado com AES-GCM (worker/src/cripto.js);
//      abrir exige a secret CREDENCIAL_CRYPTO_KEY, que vive só no Cloudflare.
//   3. A chave em texto plano só existe em memória, durante a requisição. Nunca é logada
//      nem devolvida por nenhum endpoint — o painel só recebe os últimos 4 dígitos.
//
// FALLBACK (retrocompatibilidade): se `config/credenciais` não existir (ou não tiver
// cipher), obterAsaasApiKey devolve env.ASAAS_API_KEY. É o que mantém o piloto atual
// funcionando sem nenhuma migração.

import { getDocument, createDocument, patchDocument, tenantPath } from "./firestore.js";
import { campoString } from "./http.js";
import { cifrar, decifrar } from "./cripto.js";

const CAMINHO_CREDENCIAIS = "config/credenciais";

function caminhoCredenciais(tenantId) {
  return tenantId ? tenantPath(tenantId, CAMINHO_CREDENCIAIS) : CAMINHO_CREDENCIAIS;
}

const AMBIENTES = {
  sandbox: "https://sandbox.asaas.com/api/v3",
  producao: "https://api.asaas.com/v3"
};

// Cache de módulo (vive enquanto a isolate do Worker estiver quente). Sem ele, TODA
// cobrança e TODO webhook pagariam um GET no Firestore + uma decifragem. TTL curto e
// burro de propósito: quem grava/apaga chama invalidarCacheCredencial() na hora, então o
// TTL é só a rede de segurança pro caso de outra isolate ter feito a alteração.
const CACHE_TTL_MS = 5 * 60 * 1000;
let cacheCredencial = new Map(); // chave -> { apiKey: string|undefined, baseUrl: string, expiraEm: number }

function chaveCache(tenantId) {
  return tenantId || "__global__";
}

function invalidarCacheCredencial(tenantId) {
  if (tenantId) cacheCredencial.delete(chaveCache(tenantId));
  else cacheCredencial.clear();
}

// Lê um campo timestamp de um documento cru da REST API do Firestore.
function campoTimestamp(doc, nome) {
  const valor = doc?.fields?.[nome];
  return typeof valor?.timestampValue === "string" ? valor.timestampValue : null;
}

/**
 * URL base da API do Asaas para um ambiente.
 *
 * DECISÃO: a URL é derivada do AMBIENTE escolhido pelo professor, não de
 * env.ASAAS_BASE_URL. Motivo: quando o professor troca de sandbox pra produção pelo
 * painel, a chave nova só funciona na URL correspondente — depender da var do
 * wrangler.toml significaria pedir um deploy do Worker a cada troca, e uma chave de
 * produção validada contra a URL de sandbox falharia sem explicação.
 * env.ASAAS_BASE_URL continua sendo a base usada pelas chamadas de cobrança quando não
 * há credencial cadastrada (modo legado).
 */
function baseUrlDoAmbiente(ambiente) {
  return AMBIENTES[ambiente] || null;
}

function ambienteValido(ambiente) {
  return Object.prototype.hasOwnProperty.call(AMBIENTES, ambiente);
}

/**
 * Configuração efetiva do Asaas: { apiKey, baseUrl }.
 *
 * - Com credencial cadastrada: a chave decifrada + a base URL DO AMBIENTE escolhido pelo
 *   professor. A base URL tem que acompanhar a chave — uma chave de produção usada contra
 *   a URL de sandbox (ou vice-versa) falha em toda cobrança, e é exatamente o que
 *   aconteceria se aqui se usasse env.ASAAS_BASE_URL, que só muda com deploy do Worker.
 * - Sem credencial (modo legado): a secret env.ASAAS_API_KEY + env.ASAAS_BASE_URL, o par
 *   que o piloto sempre usou.
 *
 * apiKey pode vir undefined (nenhuma das duas existe) — quem chama TEM que tratar isso
 * antes de falar com o Asaas.
 */
async function obterConfigAsaas(env, tenantId) {
  const cacheKey = chaveCache(tenantId);
  const emCache = cacheCredencial.get(cacheKey);
  if (emCache && emCache.expiraEm > Date.now()) {
    return { apiKey: emCache.apiKey, baseUrl: emCache.baseUrl };
  }

  let apiKey;
  let baseUrl;
  const doc = await getDocument(env, caminhoCredenciais(tenantId));
  const cipher = doc ? campoString(doc, "asaasApiKeyCipher") : null;
  const iv = doc ? campoString(doc, "asaasApiKeyIv") : null;

  if (cipher && iv) {
    // Se a decifragem falhar (secret trocada, dado adulterado), o erro SOBE. Cair
    // silenciosamente no fallback aqui seria pior: a academia passaria a cobrar pela
    // conta Asaas do dev sem ninguém perceber.
    apiKey = await decifrar(env, { cipher, iv });
    baseUrl = baseUrlDoAmbiente(campoString(doc, "asaasAmbiente")) || env.ASAAS_BASE_URL;
  } else {
    const tenantPadrao = env && typeof env.DEFAULT_TENANT_ID === "string" ? env.DEFAULT_TENANT_ID : "jairo";
    const fallbackLegadoAtivo = env && env.ALLOW_LEGACY_ASAAS_FALLBACK === "true";
    if (fallbackLegadoAtivo && tenantId === tenantPadrao) {
      apiKey = env.ASAAS_API_KEY || undefined;
      baseUrl = env.ASAAS_BASE_URL;
    } else {
      apiKey = undefined;
      baseUrl = env.ASAAS_BASE_URL;
    }
  }

  cacheCredencial.set(cacheKey, { apiKey, baseUrl, expiraEm: Date.now() + CACHE_TTL_MS });
  return { apiKey, baseUrl };
}

/** Atalho pra quem só precisa da chave. */
async function obterAsaasApiKey(env, tenantId) {
  const { apiKey } = await obterConfigAsaas(env, tenantId);
  return apiKey;
}

/**
 * Cifra e grava a credencial. O documento pode já existir de um cadastro anterior, então
 * trata os dois casos (create x patch). NUNCA grava a chave em texto plano — só o
 * ciphertext, o IV e os 4 últimos dígitos (que existem só pra o professor reconhecer
 * qual chave está ali).
 */
async function salvarAsaasApiKey(env, { apiKeyPlana, ambiente, atualizadoPorUid, tenantId }) {
  if (typeof apiKeyPlana !== "string" || !apiKeyPlana) {
    throw new Error("Chave de API ausente.");
  }
  if (!ambienteValido(ambiente)) {
    throw new Error("Ambiente inválido.");
  }

  const { cipher, iv } = await cifrar(env, apiKeyPlana);

  const dados = {
    asaasApiKeyCipher: cipher,
    asaasApiKeyIv: iv,
    asaasApiKeyUltimos4: apiKeyPlana.slice(-4),
    asaasAmbiente: ambiente,
    atualizadoPorUid: typeof atualizadoPorUid === "string" ? atualizadoPorUid : null,
    atualizadoEm: new Date()
  };

  const caminho = caminhoCredenciais(tenantId);
  const existente = await getDocument(env, caminho);
  if (existente) {
    await patchDocument(env, caminho, dados, { exigirExistente: true });
  } else {
    await createDocument(env, caminho, dados);
  }

  invalidarCacheCredencial(tenantId);
}

/**
 * Metadados seguros da credencial, pro painel mostrar o status.
 * NUNCA devolve o cipher, o IV nem a chave decifrada.
 */
async function obterMetadadosCredencial(env, tenantId) {
  const doc = await getDocument(env, caminhoCredenciais(tenantId));
  const cipher = doc ? campoString(doc, "asaasApiKeyCipher") : null;

  if (!doc || !cipher) {
    return { configurada: false, ultimos4: null, ambiente: null, atualizadoEm: null };
  }

  return {
    configurada: true,
    ultimos4: campoString(doc, "asaasApiKeyUltimos4"),
    ambiente: campoString(doc, "asaasAmbiente"),
    atualizadoEm: campoTimestamp(doc, "atualizadoEm")
  };
}

/**
 * Apaga a credencial.
 *
 * DECISÃO: em vez de deletar o documento (a REST API pediria um método DELETE que
 * firestore.js ainda não expõe), os campos são sobrescritos com null. O efeito prático é
 * o mesmo — obterAsaasApiKey e obterMetadadosCredencial tratam cipher nulo como "não
 * configurada", e o sistema volta ao fallback env.ASAAS_API_KEY. O ciphertext antigo é
 * de fato substituído, não fica escondido no documento.
 */
async function apagarCredencial(env, tenantId) {
  const caminho = caminhoCredenciais(tenantId);
  const existente = await getDocument(env, caminho);

  if (existente) {
    await patchDocument(
      env,
      caminho,
      {
        asaasApiKeyCipher: null,
        asaasApiKeyIv: null,
        asaasApiKeyUltimos4: null,
        asaasAmbiente: null,
        atualizadoPorUid: null,
        atualizadoEm: new Date()
      },
      { exigirExistente: true }
    );
  }

  invalidarCacheCredencial(tenantId);
}

export {
  obterConfigAsaas,
  obterAsaasApiKey,
  salvarAsaasApiKey,
  obterMetadadosCredencial,
  apagarCredencial,
  invalidarCacheCredencial,
  baseUrlDoAmbiente,
  ambienteValido,
  AMBIENTES
};
