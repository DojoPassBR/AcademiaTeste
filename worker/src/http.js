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

function corsHeaders(request, env) {
  const headers = {
    // DELETE entrou na Fase 5 (DELETE /config/credencial-asaas, que remove a chave de
    // API do Asaas cadastrada pelo professor).
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    Vary: "Origin"
  };
  const origin = request.headers.get("Origin");
  if (origin && origensPermitidas(env).includes(origin)) {
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

export { origensPermitidas, corsHeaders, json, campoString };
