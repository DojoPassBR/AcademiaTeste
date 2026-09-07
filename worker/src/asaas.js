// Cliente mínimo da API do Asaas (Pix) — só o necessário pro módulo financeiro do DojoPass.
//
// Substituiu worker/src/mercadopago.js na migração de provedor (ver CONTEXT.md).
// Autenticação é por header "access_token" (NÃO "Authorization: Bearer") e a base URL
// vem de env.ASAAS_BASE_URL (sandbox no piloto, produção depois) — nada hardcoded aqui.
//
// A apiKey é PARÂMETRO EXPLÍCITO de toda função exportada (Fase 5), não mais lida de
// env.ASAAS_API_KEY aqui dentro: desde que o professor pode cadastrar a própria chave
// pelo painel (guardada cifrada em config/credenciais), quem resolve qual chave usar é
// worker/src/credenciais.js — este módulo só a recebe pronta e a usa no header. A chave
// NUNCA é logada, nem inteira nem em pedaço.
//
// Padrão de erro, igual ao cliente antigo: o corpo da resposta de erro do Asaas pode
// conter detalhes da conta/credencial, então vai SÓ pro console.error. A exceção que
// sobe pro index.js carrega uma mensagem genérica, porque ela pode acabar virando
// resposta HTTP pro navegador.

function baseUrl(env) {
  return String(env.ASAAS_BASE_URL || "").replace(/\/+$/, "");
}

function headersAsaas(apiKey, comCorpo) {
  const headers = { access_token: apiKey, Accept: "application/json" };
  if (comCorpo) headers["Content-Type"] = "application/json";
  return headers;
}

async function falhar(resp, contexto) {
  let corpo = "";
  try {
    corpo = await resp.text();
  } catch (err) {
    corpo = "(corpo ilegível)";
  }
  console.error("Falha no Asaas (" + contexto + "):", resp.status, corpo);
  throw new Error("Falha ao " + contexto + " no Asaas.");
}

/**
 * POST /customers — cria (ou registra) o pagador no Asaas.
 * O cpfCnpj é usado só aqui, em trânsito; nunca é logado nem persistido no Firestore.
 * @returns {Promise<{id: string}>} id no formato "cus_..."
 */
async function criarCustomer(env, apiKey, { nome, cpfCnpj, email, externalReference }) {
  const corpo = { name: nome, cpfCnpj };
  if (email) corpo.email = email;
  if (externalReference) corpo.externalReference = externalReference;

  const resp = await fetch(baseUrl(env) + "/customers", {
    method: "POST",
    headers: headersAsaas(apiKey, true),
    body: JSON.stringify(corpo)
  });

  if (!resp.ok) await falhar(resp, "criar cliente");

  const customer = await resp.json();
  if (!customer || !customer.id) {
    console.error("Asaas devolveu customer sem id.");
    throw new Error("Falha ao criar cliente no Asaas.");
  }
  return { id: String(customer.id) };
}

/**
 * POST /payments — cria a cobrança Pix.
 * @returns {Promise<{id: string, status: string}>} id no formato "pay_...", status "PENDING"
 */
async function criarPagamentoPix(env, apiKey, { customerId, valor, dueDate, descricao, externalReference }) {
  const resp = await fetch(baseUrl(env) + "/payments", {
    method: "POST",
    headers: headersAsaas(apiKey, true),
    body: JSON.stringify({
      customer: customerId,
      billingType: "PIX",
      value: valor,
      dueDate,
      description: descricao,
      externalReference
    })
  });

  if (!resp.ok) await falhar(resp, "criar cobrança Pix");

  const pagamento = await resp.json();
  if (!pagamento || !pagamento.id) {
    console.error("Asaas devolveu payment sem id.");
    throw new Error("Falha ao criar cobrança Pix no Asaas.");
  }
  return { id: String(pagamento.id), status: pagamento.status || null };
}

/**
 * POST /subscriptions — cria assinatura mensal do plano DojoPass.
 * billingType usa os valores aceitos pelo Asaas para assinaturas neste fluxo:
 * PIX ou CREDIT_CARD. Dados de cartão, quando enviados, só passam em trânsito.
 */
async function criarAssinatura(env, apiKey, {
  customerId,
  valor,
  nextDueDate,
  descricao,
  externalReference,
  billingType,
  creditCard,
  creditCardHolderInfo,
  remoteIp
}) {
  const corpo = {
    customer: customerId,
    billingType,
    value: valor,
    nextDueDate,
    cycle: "MONTHLY",
    description: descricao,
    externalReference
  };

  if (billingType === "CREDIT_CARD") {
    corpo.creditCard = creditCard;
    corpo.creditCardHolderInfo = creditCardHolderInfo;
    if (remoteIp) corpo.remoteIp = remoteIp;
  }

  const resp = await fetch(baseUrl(env) + "/subscriptions", {
    method: "POST",
    headers: headersAsaas(apiKey, true),
    body: JSON.stringify(corpo)
  });

  if (!resp.ok) await falhar(resp, "criar assinatura");

  const assinatura = await resp.json();
  if (!assinatura || !assinatura.id) {
    console.error("Asaas devolveu assinatura sem id.");
    throw new Error("Falha ao criar assinatura no Asaas.");
  }
  return {
    id: String(assinatura.id),
    status: assinatura.status || null,
    nextDueDate: assinatura.nextDueDate || nextDueDate
  };
}

/**
 * GET /subscriptions/{id}/payments — localiza a cobrança inicial da assinatura.
 */
async function listarPagamentosAssinatura(env, apiKey, subscriptionId) {
  const resp = await fetch(
    baseUrl(env) + "/subscriptions/" + encodeURIComponent(subscriptionId) + "/payments?limit=10&offset=0",
    { headers: headersAsaas(apiKey, false) }
  );

  if (!resp.ok) await falhar(resp, "listar pagamentos da assinatura");

  const dados = await resp.json();
  const lista = Array.isArray(dados?.data) ? dados.data : [];
  return lista
    .filter((pagamento) => pagamento && pagamento.id)
    .map((pagamento) => ({
      id: String(pagamento.id),
      status: pagamento.status || null,
      dueDate: pagamento.dueDate || null,
      externalReference: pagamento.externalReference || null
    }));
}

/**
 * GET /payments/{id}/pixQrCode — o copia-e-cola (payload) e o QR em base64 (encodedImage).
 * @returns {Promise<{payload: string|null, encodedImage: string|null, expirationDate: string|null}>}
 */
async function obterQrCodePix(env, apiKey, paymentId) {
  const resp = await fetch(baseUrl(env) + "/payments/" + encodeURIComponent(paymentId) + "/pixQrCode", {
    headers: headersAsaas(apiKey, false)
  });

  if (!resp.ok) await falhar(resp, "obter QR Code Pix");

  const qr = await resp.json();
  return {
    payload: qr?.payload || null,
    encodedImage: qr?.encodedImage || null,
    expirationDate: qr?.expirationDate || null
  };
}

/**
 * GET /payments/{id} — fonte autoritativa do status. Usado pelo webhook, que nunca
 * confia no status que veio no payload da notificação.
 * @returns {Promise<object>} o objeto de pagamento completo
 */
async function consultarPagamento(env, apiKey, paymentId) {
  const resp = await fetch(baseUrl(env) + "/payments/" + encodeURIComponent(paymentId), {
    headers: headersAsaas(apiKey, false)
  });

  if (!resp.ok) await falhar(resp, "consultar cobrança");
  return resp.json();
}

export {
  criarCustomer,
  criarPagamentoPix,
  criarAssinatura,
  listarPagamentosAssinatura,
  obterQrCodePix,
  consultarPagamento
};
