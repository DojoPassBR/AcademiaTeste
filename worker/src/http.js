// Helpers de HTTP/CORS compartilhados pelos handlers do Worker.
//
// Estavam dentro de index.js até a Fase 3; foram extraídos porque o módulo de
// comprovantes (comprovante.js) precisa exatamente das mesmas funções, e importar
// de volta do index.js criaria dependência circular.

// CORS por lista branca: ALLOWED_ORIGINS (vars do wrangler.toml) é uma lista separada por
// vírgula. Antes o Worker respondia "Access-Control-Allow-Origin: *", ou seja, qualquer
// site conseguia chamar /criar-cobranca do navegador de um professor logado.
function origensPermitidas(env) {
  return String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

function origemDojopassPermitida(origin) {
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return host === "dojopass.com.br" || host.endsWith(".dojopass.com.br");
  } catch (err) {
    return false;
  }
}

function origemLocalPermitida(origin) {
  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();
    return url.protocol === "http:" && (host === "localhost" || host === "127.0.0.1");
  } catch (err) {
    return false;
  }
}

const corsOriginPorRequest = new WeakMap();

function origemPermitida(origin, env) {
  if (!origin) return false;
  if (origensPermitidas(env).includes(origin)) return true;
  if (origemLocalPermitida(origin)) return true;
  return origemDojopassPermitida(origin);
}

function fixarCorsOrigin(request, origin) {
  if (request && origin) corsOriginPorRequest.set(request, origin);
}

function corsHeaders(request, env) {
  const headers = {
    // DELETE entrou na Fase 5 (DELETE /config/credencial-asaas, que remove a chave de
    // API do Asaas cadastrada pelo professor).
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    Vary: "Origin"
  };
  const origin = corsOriginPorRequest.get(request) || request.headers.get("Origin");
  if (origemPermitida(origin, env) || corsOriginPorRequest.has(request)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function json(data, status = 200, request = null, env = null) {
  const cors = request && env ? corsHeaders(request, env) : {};
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors }
  });
}

// Lê um campo string de um documento cru da REST API do Firestore ({ fields: { x: { stringValue } } }).
function campoString(doc, nome) {
  const valor = doc?.fields?.[nome];
  return typeof valor?.stringValue === "string" ? valor.stringValue : null;
}

export {
  origensPermitidas,
  origemPermitida,
  origemDojopassPermitida,
  origemLocalPermitida,
  fixarCorsOrigin,
  corsHeaders,
  json,
  campoString
};
