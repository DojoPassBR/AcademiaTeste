// Validação do webhook do Asaas (header "asaas-access-token").
//
// Substituiu worker/src/webhook-assinatura.js (HMAC do x-signature do Mercado Pago).
//
// Por que aqui NÃO há HMAC nem janela anti-replay:
// o Asaas não assina o corpo da notificação. O que ele oferece é um **token estático**,
// definido por nós no painel ao cadastrar a URL do webhook, e reenviado em todo POST no
// header "asaas-access-token". Não existe timestamp assinado pra comparar, então não há
// como implementar anti-replay criptográfico — reenviar o mesmo corpo com o mesmo token
// é indistinguível de uma reentrega legítima (e o Asaas reentrega mesmo, por design).
//
// As defesas que substituem o HMAC/anti-replay são, no index.js:
//   1) reconsulta autoritativa: GET /payments/{id} no Asaas define o status, nunca o
//      corpo do webhook — um replay só reafirma o que a API já diz;
//   2) idempotência de estado no Firestore: a cobrança só transiciona pra "pago" e os
//      PATCHs usam currentDocument.exists=true, então nada é criado do nada e reprocessar
//      a mesma notificação não produz efeito novo.
//
// O token em si tem que ser longo e aleatório (>= 32 chars) — ver worker/wrangler.toml.

// Comparação em tempo constante (não usa === pra não vazar o prefixo correto por timing).
// Herdada do antigo webhook-assinatura.js, agora sobre bytes UTF-8 do token.
function iguaisEmTempoConstante(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * @param {Request} request  a requisição do webhook (pra ler os headers)
 * @param {object} env       bindings do Worker (precisa de ASAAS_WEBHOOK_TOKEN)
 * @returns {Promise<boolean>} true se o header bate com o token configurado
 */
async function validarTokenWebhook(request, env) {
  const esperado = env.ASAAS_WEBHOOK_TOKEN;
  if (!esperado) {
    console.error("ASAAS_WEBHOOK_TOKEN não configurado no Worker.");
    return false;
  }

  const recebido = request.headers.get("asaas-access-token");
  if (!recebido) return false;

  const encoder = new TextEncoder();
  return iguaisEmTempoConstante(encoder.encode(recebido), encoder.encode(esperado));
}

export { validarTokenWebhook };
