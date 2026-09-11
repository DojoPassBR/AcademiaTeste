import { getDocument, listDocuments, createDocument, patchDocument, tenantPath } from "./firestore.js";
import {
  criarCustomer,
  criarPagamentoPix,
  obterQrCodePix,
  consultarPagamento
} from "./asaas.js";
import { verificarIdToken } from "./auth.js";
import { validarTokenWebhook } from "./webhook-token.js";
import { corsHeaders, json, campoString, origensPermitidas, origemDojopassPermitida, fixarCorsOrigin } from "./http.js";
import {
  obterConfigAsaas,
  salvarAsaasApiKey,
  obterMetadadosCredencial,
  apagarCredencial,
  ambienteValido,
  baseUrlDoAmbiente
} from "./credenciais.js";
import { handleUploadComprovante, handleBaixarComprovante } from "./comprovante.js";
import { enviarEmail, preencherTemplate } from "./email.js";
import {
  alunoIdValido,
  mesReferenciaValido,
  valorValido,
  alunoNomeValido,
  emailValido,
  derivarCobrancaId,
  derivarCobrancaExternalReference,
  separarCobrancaExternalReference,
  tenantIdDoPayload,
  tenantIdValido,
  cpfCnpjValido,
  nomeAlunoCadastroValido,
  telefoneValido,
  nascimentoValido,
  faixaValida,
  grauValido,
  valorMensalidadeValido,
  responsaveisValidos,
  senhaInicialValida,
  equipeIdValido,
  acaoProfessorValida
} from "./validacao.js";
import { criarUsuarioAuth } from "./identity.js";


function tenantPadrao(env) {
  return env.DEFAULT_TENANT_ID || "jairo";
}

function caminhoTenant(tenantId, path) {
  return tenantPath(tenantId, path);
}

function tenantDocPath(tenantId) {
  if (!tenantIdValido(tenantId)) throw new Error("tenantId inválido.");
  return "tenants/" + tenantId;
}

async function resolverTenantAtivo(env, tenantId) {
  if (!tenantIdValido(tenantId)) throw new Error("tenantId inválido.");
  const tenant = await getDocument(env, tenantDocPath(tenantId));
  if (!tenant || campoString(tenant, "status") !== "ativo") {
    const err = new Error("Tenant inativo ou inexistente.");
    err.tenantInativo = true;
    throw err;
  }
  return tenantId;
}

async function resolverTenantAtivoDoPayload(body, env) {
  return resolverTenantAtivo(env, tenantIdDoPayload(body));
}

async function resolverTenantAtivoDaUrl(request, env) {
  const tenantId = new URL(request.url).searchParams.get("tenantId");
  return resolverTenantAtivo(env, tenantId);
}

function origemHost(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return null;
  try {
    const url = new URL(origin);
    return { origin, protocol: url.protocol, host: url.hostname.toLowerCase() };
  } catch (err) {
    return null;
  }
}

function roleMembership(doc) {
  return campoString(doc, "role");
}

async function usuarioEhAdminTenant(env, uid, tenantId) {
  if (!tenantIdValido(tenantId)) return false;
  const membership = await getDocument(env, caminhoTenant(tenantId, "memberships/" + uid));
  const role = membership ? roleMembership(membership) : null;
  const status = membership ? campoString(membership, "status") : null;
  if ((role === "admin" || role === "owner") && status === "ativo") return true;
  return false;
}

// Confere se a ORIGEM da requisição pertence de fato à academia (tenantId) que o corpo/URL
// diz. É o único vínculo que o Worker tem entre "de onde veio a chamada" e "de qual
// academia é o dado" — a service account passa por cima das rules do Firestore, então
// nenhuma outra camada faz essa checagem.
//
// FAIL-CLOSED: sem header Origin (curl, script, app não-browser) a resposta é NÃO.
// Antes isto devolvia `true` quando não havia Origin, o que anulava a checagem inteira pra
// qualquer cliente que simplesmente não mandasse o header — inclusive no /completar-cadastro,
// onde o tenantId vem do corpo da requisição.
async function origemAutorizaTenant(request, env, tenantId) {
  const info = origemHost(request);
  if (!info) return false;

  const permitidoExato = origensPermitidas(env).includes(info.origin);
  if (permitidoExato && (info.host === "localhost" || info.host === "127.0.0.1")) {
    fixarCorsOrigin(request, info.origin);
    return true;
  }
  if (permitidoExato && tenantId === tenantPadrao(env)) {
    fixarCorsOrigin(request, info.origin);
    return true;
  }

  const domainDoc = await getDocument(env, "tenantDomains/" + info.host);
  if (domainDoc && campoString(domainDoc, "status") === "ativo" && campoString(domainDoc, "tenantId") === tenantId) {
    fixarCorsOrigin(request, info.origin);
    return true;
  }

  const sufixo = ".dojopass.com.br";
  if (info.host.endsWith(sufixo) && info.host !== "www.dojopass.com.br") {
    const slug = info.host.slice(0, -sufixo.length);
    const slugDoc = await getDocument(env, "tenantSlugs/" + slug);
    const permitido = !!(slugDoc && campoString(slugDoc, "status") === "ativo" && campoString(slugDoc, "tenantId") === tenantId);
    if (permitido) fixarCorsOrigin(request, info.origin);
    return permitido;
  }

  return false;
}

async function corsHeadersPreflight(request, env) {
  const headers = corsHeaders(request, env);
  const info = origemHost(request);
  if (!info) return headers;
  if (headers["Access-Control-Allow-Origin"]) return headers;
  if (info.protocol !== "https:") return headers;

  const domainDoc = await getDocument(env, "tenantDomains/" + info.host);
  if (domainDoc && campoString(domainDoc, "status") === "ativo" && campoString(domainDoc, "tenantId")) {
    fixarCorsOrigin(request, info.origin);
    return corsHeaders(request, env);
  }

  if (origemDojopassPermitida(info.origin)) {
    fixarCorsOrigin(request, info.origin);
    return corsHeaders(request, env);
  }

  return headers;
}

async function exigirOrigemTenant(request, env, tenantId) {
  if (await origemAutorizaTenant(request, env, tenantId)) return null;
  return json({ erro: "Origem não autorizada para esta academia." }, 403, request, env);
}

// Grava o membership do usuário nos DOIS espelhos que as rules usam:
//
// - tenants/{tenantId}/memberships/{uid} → fonte de autorização (isTenantAluno,
//   isTenantAdmin, isTenantProfessor em firestore.rules);
// - users/{uid}/memberships/{tenantId}   → o que o próprio usuário consegue ler pra
//   descobrir o papel dele naquela academia (login.html/admin.html/professor.html).
//
// Os dois são `allow write: if false` para todo cliente. Este é o ÚNICO caminho que
// escreve um role — é por isso que "virar admin/professor" nunca depende de nada que o
// navegador mande: só deste handler, atrás de exigirAdminTenant + exigirOrigemTenant.
async function gravarMembership(env, tenantId, uid, { role, status = "ativo", extras = {} } = {}) {
  const agora = new Date();
  const dados = {
    role,
    status,
    tenantId,
    uid,
    criadoEm: agora,
    atualizadoEm: agora,
    ...extras
  };

  await patchDocument(env, caminhoTenant(tenantId, "memberships/" + uid), dados);
  await patchDocument(env, "users/" + uid + "/memberships/" + tenantId, dados);
}

// Wrapper fino, mantido pra não mudar as chamadas já existentes do cadastro de aluno.
async function criarOuAtualizarMembershipAluno(env, tenantId, uid, dadosExtras = {}) {
  await gravarMembership(env, tenantId, uid, { role: "aluno", status: "ativo", extras: dadosExtras });
}

async function exigirAdminTenant(request, env, acao, tenantId) {
  let uid;
  try {
    ({ uid } = await verificarIdToken(env, request.headers.get("Authorization")));
  } catch (err) {
    console.error("Falha na verificação do ID token:", err);
    return { resposta: json({ erro: "Não autenticado." }, 401, request, env) };
  }

  if (!(await usuarioEhAdminTenant(env, uid, tenantId))) {
    return { resposta: json({ erro: "Sem permissão para " + acao + " nesta academia." }, 403, request, env) };
  }

  return { uid, tenantId };
}

// ASAAS_API_KEY saiu desta lista na Fase 5: a chave do Asaas pode vir do documento
// cifrado config/credenciais (cadastrada pelo professor) OU da secret legada, então a
// checagem dela deixou de ser estática e virou o resolverApiKeyAsaas() abaixo.
function credenciaisFaltando(env) {
  const faltando = [
    "ASAAS_WEBHOOK_TOKEN",
    "FIREBASE_CLIENT_EMAIL",
    "FIREBASE_PRIVATE_KEY"
  ].filter((k) => !env[k]);
  return faltando.length ? faltando : null;
}

function credenciaisFirebaseFaltando(env) {
  const faltando = ["FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY"].filter((k) => !env[k]);
  return faltando.length ? faltando : null;
}

// Resolve a chave de API do Asaas (credencial cadastrada > secret legada) e devolve
// { apiKey, envAsaas } ou { resposta } com um 501 já pronto. Chamado ANTES de qualquer
// chamada ao Asaas — sem chave, a requisição morre aqui em vez de virar um 500 genérico
// lá na frente.
//
// envAsaas é o env com ASAAS_BASE_URL ajustada pro ambiente da credencial cadastrada
// (worker/src/asaas.js lê a base URL de lá). Sem isso, uma chave de PRODUÇÃO cadastrada
// pelo painel seria usada contra a URL de SANDBOX do wrangler.toml — e vice-versa.
async function resolverApiKeyAsaas(request, env, tenantId) {
  let apiKey;
  let baseUrl;
  try {
    ({ apiKey, baseUrl } = await obterConfigAsaas(env, tenantId));
  } catch (err) {
    // Erro típico: CREDENCIAL_CRYPTO_KEY trocada/ausente. O detalhe (que nunca contém a
    // chave em si — ver worker/src/cripto.js) fica no log do Worker.
    console.error("Falha ao resolver a credencial do Asaas:", err);
    return {
      resposta: json(
        { erro: "Credencial de pagamento indisponível. Recadastre a chave do Asaas no painel." },
        501,
        request,
        env
      )
    };
  }

  if (typeof apiKey !== "string" || !apiKey.trim()) {
    return {
      resposta: json(
        { erro: "Nenhuma chave de API do Asaas configurada. Cadastre a chave no painel do professor." },
        501,
        request,
        env
      )
    };
  }

  const envAsaas = baseUrl && baseUrl !== env.ASAAS_BASE_URL
    ? { ...env, ASAAS_BASE_URL: baseUrl }
    : env;

  return { apiKey, envAsaas };
}

// Vencimento da cobrança: hoje + ASAAS_DUE_DATE_DIAS (default 5), em "YYYY-MM-DD" UTC.
function calcularDueDate(env) {
  const dias = Number(env.ASAAS_DUE_DATE_DIAS);
  const offset = Number.isFinite(dias) && dias >= 0 ? Math.floor(dias) : 5;
  const data = new Date(Date.now() + offset * 24 * 60 * 60 * 1000);
  return data.toISOString().slice(0, 10);
}

async function handleCriarCobranca(request, env) {
  const faltando = credenciaisFaltando(env);
  if (faltando) {
    return json(
      { erro: "Worker ainda não configurado. Faltam os segredos: " + faltando.join(", ") },
      501,
      request,
      env
    );
  }

  const body = await request.json().catch(() => null);
  if (!body) return json({ erro: "Corpo da requisição inválido." }, 400, request, env);

  let tenantId;
  try {
    tenantId = await resolverTenantAtivoDoPayload(body, env);
  } catch (err) {
    return json({ erro: "Academia inválida." }, 400, request, env);
  }

  const origemNegada = await exigirOrigemTenant(request, env, tenantId);
  if (origemNegada) return origemNegada;

  const { uid, resposta } = await exigirAdminTenant(request, env, "gerar cobranças", tenantId);
  if (resposta) return resposta;

  // Chave do Asaas por academia (credencial cadastrada > secret legada).
  const { apiKey, envAsaas, resposta: semChave } = await resolverApiKeyAsaas(request, env, tenantId);
  if (semChave) return semChave;

  const { alunoId, alunoNome, valor, mesReferencia, cpfCnpj } = body;

  if (
    !alunoIdValido(alunoId) ||
    !alunoNomeValido(alunoNome) ||
    !valorValido(valor) ||
    !mesReferenciaValido(mesReferencia)
  ) {
    return json(
      { erro: "Campos obrigatórios: alunoId, alunoNome, valor (0 a 5000), mesReferencia (YYYY-MM)." },
      400,
      request,
      env
    );
  }

  // 3) O aluno tem que existir de verdade — nada de cobrança pra ID inventado.
  const alunoDoc = await getDocument(env, caminhoTenant(tenantId, "alunos/" + alunoId));
  if (!alunoDoc) return json({ erro: "Aluno não encontrado." }, 404, request, env);

  // 4) Customer do Asaas: criado uma vez por aluno e reusado dali em diante.
  // O CPF é pedido só nessa primeira vez, viaja só até o Asaas e NUNCA é gravado no
  // Firestore — o único resíduo é o asaasCustomerId devolvido pela API.
  let asaasCustomerId = campoString(alunoDoc, "asaasCustomerId");

  if (!asaasCustomerId) {
    if (cpfCnpj === undefined || cpfCnpj === null || cpfCnpj === "") {
      // 422 antes de qualquer chamada externa: o admin ainda precisa informar o CPF.
      return json(
        { erro: "CPF do aluno necessário para a primeira cobrança.", precisaCpf: true },
        422,
        request,
        env
      );
    }

    // Nunca logar o valor recebido aqui (nem em caso de erro) — ver worker/src/cpf.js.
    if (!cpfCnpjValido(cpfCnpj)) {
      return json({ erro: "CPF/CNPJ inválido." }, 400, request, env);
    }

    const emailAluno = campoString(alunoDoc, "email");
    const customer = await criarCustomer(envAsaas, apiKey, {
      nome: alunoNome,
      cpfCnpj: String(cpfCnpj),
      email: emailAluno || undefined,
      externalReference: tenantId + ":" + alunoId
    });
    asaasCustomerId = customer.id;

    // exigirExistente: true — o doc do aluno já foi lido acima; isso só garante que um
    // PATCH nunca crie um "aluno fantasma" caso ele suma no meio do caminho.
    await patchDocument(
      env,
      caminhoTenant(tenantId, "alunos/" + alunoId),
      { asaasCustomerId, customerCriadoEm: new Date(), tenantId },
      { exigirExistente: true }
    );
  }

  // 5) Idempotência: o ID do documento é "<alunoId>_<mesReferencia>". O Asaas não tem
  // X-Idempotency-Key nativo, então o guard é aqui — ANTES de qualquer chamada à API.
  const cobrancaId = derivarCobrancaId(alunoId, mesReferencia);
  const cobrancaPath = caminhoTenant(tenantId, "cobrancas/" + cobrancaId);
  const cobrancaExistente = await getDocument(env, cobrancaPath);
  const statusExistente = cobrancaExistente ? campoString(cobrancaExistente, "status") : null;

  if (statusExistente === "pendente") {
    return json(
      {
        ok: true,
        jaExistia: true,
        pixCopiaECola: campoString(cobrancaExistente, "pixCopiaECola")
      },
      200,
      request,
      env
    );
  }

  if (statusExistente === "pago") {
    return json({ erro: "Este mês já está pago." }, 409, request, env);
  }

  // 6) Cria a cobrança no Asaas.
  const dueDate = calcularDueDate(env);
  const pagamento = await criarPagamentoPix(envAsaas, apiKey, {
    customerId: asaasCustomerId,
    valor,
    dueDate,
    descricao: "Mensalidade " + mesReferencia + " - " + alunoNome,
    externalReference: derivarCobrancaExternalReference(tenantId, alunoId, mesReferencia)
  });

  // O QR Code é uma segunda chamada. Se ela falhar, o payment JÁ existe no Asaas — então
  // grava a cobrança mesmo assim (com os campos Pix nulos) e só depois responde 502.
  // Um payment sem rastro no Firestore seria um pagamento impossível de conciliar.
  let qr = { payload: null, encodedImage: null, expirationDate: null };
  let qrFalhou = false;
  try {
    qr = await obterQrCodePix(envAsaas, apiKey, pagamento.id);
  } catch (err) {
    console.error("Falha ao obter QR Code do Asaas para o payment:", pagamento.id, err);
    qrFalhou = true;
  }

  const agora = new Date();
  const dados = {
    alunoId,
    alunoNome,
    valor,
    mesReferencia,
    status: "pendente",
    pixCopiaECola: qr.payload,
    pixQrCodeBase64: qr.encodedImage,
    asaasPaymentId: pagamento.id,
    asaasCustomerId,
    dueDate,
    pixExpiraEm: qr.expirationDate,
    criadoPorUid: uid,
    criadoEm: agora,
    atualizadoEm: agora,
    tenantId
  };

  if (cobrancaExistente) {
    // Só chega aqui se a cobrança anterior estava "cancelado" — reaproveita o mesmo ID.
    await patchDocument(env, cobrancaPath, dados, { exigirExistente: true });
  } else {
    // createDocument (currentDocument.exists=false): se dois cliques simultâneos passarem
    // pelo guard acima, o segundo falha em vez de sobrescrever a cobrança do primeiro.
    await createDocument(env, cobrancaPath, dados);
  }

  await patchDocument(env, "asaasPayments/" + pagamento.id, {
    tenantId,
    alunoId,
    cobrancaId,
    mesReferencia,
    asaasPaymentId: pagamento.id,
    atualizadoEm: agora
  });

  if (qrFalhou) {
    return json(
      { erro: "Cobrança criada, mas o código Pix não pôde ser gerado. Tente de novo em instantes." },
      502,
      request,
      env
    );
  }

  return json({ ok: true, pixCopiaECola: qr.payload }, 200, request, env);
}

async function handleWebhookAsaas(request, env) {
  const faltando = credenciaisFaltando(env);
  if (faltando) return json({ erro: "Worker ainda não configurado." }, 501, request, env);

  // Token ANTES de ler o corpo e ANTES de qualquer chamada externa — senão o endpoint
  // vira amplificador de requisições pra quem descobrir a URL.
  let tokenOk = false;
  try {
    tokenOk = await validarTokenWebhook(request, env);
  } catch (err) {
    console.error("Falha ao validar o token do webhook:", err);
    tokenOk = false;
  }
  if (!tokenOk) return json({ erro: "Token inválido." }, 401, request, env);

  const corpoTexto = await request.text();
  let corpo = {};
  if (corpoTexto) {
    try {
      corpo = JSON.parse(corpoTexto);
    } catch (err) {
      corpo = {};
    }
  }

  const paymentId = corpo?.payment?.id;

  // Notificação que não é de pagamento; só confirma recebimento pro Asaas não reenfileirar.
  if (!paymentId) return json({ ok: true }, 200, request, env);

  const indicePagamento = await getDocument(env, "asaasPayments/" + paymentId);
  let tenantIdWebhook = indicePagamento ? campoString(indicePagamento, "tenantId") : null;

  if (!tenantIdWebhook) {
    const urlTenant = new URL(request.url).searchParams.get("tenantId");
    if (tenantIdValido(urlTenant)) tenantIdWebhook = urlTenant;
  }

  if (!tenantIdWebhook) {
    const referenciaPayload = corpo?.payment?.externalReference;
    const partesPayload = separarCobrancaExternalReference(referenciaPayload, env);
    if (partesPayload && partesPayload.tenantId) tenantIdWebhook = partesPayload.tenantId;
  }


  if (!tenantIdWebhook) {
    console.error("Webhook: paymentId sem índice, sem tenantId e sem externalReference tenantizado:", paymentId);
    return json({ ok: true }, 200, request, env);
  }

  try {
    await resolverTenantAtivo(env, tenantIdWebhook);
  } catch (err) {
    console.error("Webhook: tenant inativo ou inválido para paymentId:", paymentId);
    return json({ ok: true }, 200, request, env);
  }

  // Nunca confia no status que veio no payload — sempre reconsulta a API do Asaas usando
  // a credencial do tenant encontrado pelo índice paymentId -> tenantId.
  const { apiKey, envAsaas, resposta: semChave } = await resolverApiKeyAsaas(request, env, tenantIdWebhook);
  if (semChave) return semChave;

  const pagamento = await consultarPagamento(envAsaas, apiKey, paymentId);

  if (pagamento.status === "RECEIVED" || pagamento.status === "CONFIRMED") {
    // O externalReference também vem da RESPOSTA da consulta, não do payload do webhook.
    const referencia = pagamento.externalReference;

    if (typeof referencia !== "string" || !referencia.includes("_")) {
      console.error("Webhook: externalReference em formato inesperado:", referencia);
      return json({ ok: true }, 200, request, env);
    }

    const partesReferencia = separarCobrancaExternalReference(referencia, env);
    if (!partesReferencia) {
      console.error("Webhook: externalReference em formato inesperado:", referencia);
      return json({ ok: true }, 200, request, env);
    }

    const { tenantId, alunoId, mesReferencia, cobrancaId } = partesReferencia;
    if (tenantId !== tenantIdWebhook) {
      console.error("Webhook: tenant do externalReference difere do tenant do paymentId:", paymentId);
      return json({ ok: true }, 200, request, env);
    }
    const agora = new Date();

    // exigirExistente: true nos dois PATCHs. Sem isso, o upsert cego criava
    // "alunos/<qualquer coisa>" a partir do externalReference do pagamento.
    try {
      await patchDocument(
        env,
        caminhoTenant(tenantId, "cobrancas/" + cobrancaId),
        {
          status: "pago",
          pagoEm: agora,
          atualizadoEm: agora,
          asaasPaymentId: String(paymentId)
        },
        { exigirExistente: true }
      );
    } catch (err) {
      if (!err.naoEncontrado) throw err;
      console.error("Webhook: cobrança não encontrada no Firestore:", cobrancaId);
    }

    try {
      await patchDocument(
        env,
        caminhoTenant(tenantId, "alunos/" + alunoId),
        { mensalidadeStatus: "pago", mensalidadeAtualizadoEm: agora },
        { exigirExistente: true }
      );
    } catch (err) {
      if (!err.naoEncontrado) throw err;
      console.error("Webhook: aluno não encontrado no Firestore:", alunoId);
    }
  }

  return json({ ok: true }, 200, request, env);
}

// ---------------------------------------------------------------------------
// Lembrete de mensalidade por e-mail (POST /enviar-lembrete).
// ---------------------------------------------------------------------------

// Teto de envios por dia da academia inteira. É proteção de custo e de reputação do
// remetente: mesmo que alguém com conta de admin fique clicando, o Worker para aqui.
const LEMBRETES_LIMITE_DIARIO = 200;

// Contador diário. "config/lembretes" é um DOCUMENTO e "dias" a subcoleção dentro dele —
// caminho de documento no Firestore precisa de um número par de segmentos, então
// "config/lembretes/{data}" (3 segmentos) seria uma coleção, não um documento.
// Subcoleção de config/ também fica fora do match /config/{docId} das rules, ou seja,
// invisível pro cliente; quem escreve aqui é só o Worker (service account).
function caminhoContadorLembretes(dataISO) {
  return "config/lembretes/dias/" + dataISO;
}

// Defaults embutidos, usados quando config/geral ainda não existe (ou não tem o campo).
// Espelham os defaults do cliente em app/admin.html (LEMBRETE_TEMPLATE_PADRAO).
const LEMBRETE_TEMPLATE_PADRAO =
  "Olá {nome}, tudo bem? Passando pra lembrar da mensalidade de {mes} da {academia}. " +
  "Valor: {valor}. Pix: {pix}";
const ACADEMIA_NOME_PADRAO = "a academia";

const MESES_PT_BR = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];

// Equivalentes a mesAtualPtBr() e valorMensalidadeTexto() de app/admin.html, escritos
// à mão em vez de via Intl pra não depender do ICU disponível no runtime do Worker.
function mesAtualPtBr(agora) {
  return MESES_PT_BR[agora.getUTCMonth()] + " de " + agora.getUTCFullYear();
}

function valorMensalidadeTexto(valor) {
  if (typeof valor !== "number" || !Number.isFinite(valor) || valor <= 0) return "a combinar";
  const inteiro = Math.floor(valor);
  const centavos = Math.round((valor - inteiro) * 100);
  const milhar = String(inteiro).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return "R$ " + milhar + "," + String(centavos).padStart(2, "0");
}

// Lê um campo numérico de um documento cru da REST API (integerValue vem como string).
function campoNumero(doc, nome) {
  const valor = doc?.fields?.[nome];
  if (!valor) return null;
  if (typeof valor.doubleValue === "number") return valor.doubleValue;
  if (valor.integerValue !== undefined) {
    const n = Number(valor.integerValue);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

async function handleEnviarLembrete(request, env) {
  // Checagem específica deste endpoint: a falta das credenciais de e-mail NÃO pode
  // derrubar /criar-cobranca, /webhook-asaas ou /comprovante, que não mandam e-mail.
  if (!env.RESEND_API_KEY || !env.EMAIL_REMETENTE) {
    return json({ erro: "Lembrete por e-mail ainda não configurado." }, 501, request, env);
  }
  const faltando = credenciaisFaltando(env);
  if (faltando) {
    return json(
      { erro: "Worker ainda não configurado. Faltam os segredos: " + faltando.join(", ") },
      501,
      request,
      env
    );
  }

  const body = await request.json().catch(() => null);
  if (!body) return json({ erro: "Corpo da requisição inválido." }, 400, request, env);

  let tenantId;
  try {
    tenantId = await resolverTenantAtivoDoPayload(body, env);
  } catch (err) {
    return json({ erro: "Academia inválida." }, 400, request, env);
  }

  const origemNegada = await exigirOrigemTenant(request, env, tenantId);
  if (origemNegada) return origemNegada;

  const { resposta } = await exigirAdminTenant(request, env, "enviar lembretes", tenantId);
  if (resposta) return resposta;

  const { alunoId } = body;
  if (!alunoIdValido(alunoId)) {
    return json({ erro: "Campo obrigatório: alunoId." }, 400, request, env);
  }

  const alunoDoc = await getDocument(env, caminhoTenant(tenantId, "alunos/" + alunoId));
  if (!alunoDoc) return json({ erro: "Aluno não encontrado." }, 404, request, env);

  // 2) O destinatário SEMPRE sai do documento do aluno, nunca do corpo da requisição —
  // se viesse do cliente, o endpoint seria um relay de e-mail arbitrário assinado com
  // o remetente da academia.
  const emailAluno = campoString(alunoDoc, "email");
  if (!emailValido(emailAluno)) {
    return json(
      { erro: "Este aluno não tem um e-mail válido cadastrado." },
      400,
      request,
      env
    );
  }

  if (campoString(alunoDoc, "mensalidadeStatus") === "pago") {
    return json({ erro: "A mensalidade deste aluno já está em dia." }, 400, request, env);
  }

  // 3) Rate limit diário (contador por dia, UTC). Sem transação: duas requisições
  // simultâneas podem contar como uma só — é um teto de proteção, não um contábil.
  const agora = new Date();
  const dataISO = agora.toISOString().slice(0, 10);
  const contadorPath = caminhoTenant(tenantId, caminhoContadorLembretes(dataISO));
  const contadorDoc = await getDocument(env, contadorPath);
  const contagemAtual = contadorDoc ? campoNumero(contadorDoc, "contagem") || 0 : 0;

  if (contagemAtual >= LEMBRETES_LIMITE_DIARIO) {
    return json(
      { erro: "Limite diário de lembretes por e-mail atingido. Tente amanhã." },
      429,
      request,
      env
    );
  }

  // 4) Texto do lembrete, com o mesmo template do botão de WhatsApp.
  const configDoc = await getDocument(env, caminhoTenant(tenantId, "config/geral"));
  const academiaNome = (configDoc && campoString(configDoc, "academiaNome")) || ACADEMIA_NOME_PADRAO;
  const template = (configDoc && campoString(configDoc, "lembreteTemplate")) || LEMBRETE_TEMPLATE_PADRAO;
  const pixChave = (configDoc && campoString(configDoc, "pixChaveManual")) || "";
  const valorPadrao = configDoc ? campoNumero(configDoc, "valorMensalidadePadrao") : null;
  const alunoNome = campoString(alunoDoc, "nome") || "";
  const mes = mesAtualPtBr(agora);

  const texto = preencherTemplate(template, {
    nome: alunoNome,
    mes,
    valor: valorMensalidadeTexto(valorPadrao),
    academia: academiaNome,
    pix: pixChave
  });
  const assunto = "Mensalidade de " + mes + " - " + academiaNome;

  // 5) Conta ANTES de enviar: se a gravação falhasse depois do envio, o teto perderia
  // o sentido. Um envio que falhe depois disso só "gasta" uma unidade do limite.
  const novaContagem = contagemAtual + 1;
  if (contadorDoc) {
    await patchDocument(env, contadorPath, { contagem: novaContagem, atualizadoEm: agora });
  } else {
    await createDocument(env, contadorPath, {
      contagem: novaContagem,
      data: dataISO,
      atualizadoEm: agora
    });
  }

  try {
    await enviarEmail(env, { para: emailAluno, assunto, texto });
  } catch (err) {
    // O detalhe do provedor já foi pro console.error dentro de email.js.
    console.error("Falha ao enviar lembrete por e-mail para o aluno:", alunoId);
    return json(
      { erro: "Não foi possível enviar o e-mail agora. Tente novamente em instantes." },
      502,
      request,
      env
    );
  }

  return json({ ok: true }, 200, request, env);
}

// ---------------------------------------------------------------------------
// Cadastro de aluno pelo professor (POST /criar-aluno).
//
// Cria a conta no Firebase Auth (via service account, ver worker/src/identity.js) E o
// documento alunos/{uid} — coisa que o cliente NÃO consegue fazer: a rule de create em
// /alunos exige request.auth.uid == alunoId, ou seja, só o próprio aluno cria o próprio
// documento. Esse caminho de terceiro existe só aqui, exige admin autenticado e deixa
// rastro (criadoPorAdmin/criadoPorUid).
//
// A alternativa preferida continua sendo o link de convite (o professor não fica
// sabendo a senha do aluno) — a UI diz isso explicitamente.
// ---------------------------------------------------------------------------

// Mapeia o código do Identity Toolkit pro par (status HTTP, mensagem pro professor).
// O erro cru do Google NUNCA é devolvido ao cliente.
function respostaErroIdentity(codigo, request, env) {
  if (codigo === "EMAIL_EXISTS") {
    return json({ erro: "Este e-mail já está cadastrado." }, 409, request, env);
  }
  if (codigo === "WEAK_PASSWORD" || codigo === "INVALID_PASSWORD") {
    return json({ erro: "Senha muito fraca (mínimo 6 caracteres)." }, 400, request, env);
  }
  if (codigo === "INVALID_EMAIL") {
    return json({ erro: "E-mail inválido." }, 400, request, env);
  }
  return json(
    { erro: "Não foi possível criar a conta agora. Tente novamente em instantes." },
    500,
    request,
    env
  );
}

async function handleCriarAluno(request, env) {
  const faltando = credenciaisFaltando(env);
  if (faltando) {
    return json(
      { erro: "Worker ainda não configurado. Faltam os segredos: " + faltando.join(", ") },
      501,
      request,
      env
    );
  }

  const body = await request.json().catch(() => null);
  if (!body) return json({ erro: "Corpo da requisição inválido." }, 400, request, env);

  let tenantId;
  try {
    tenantId = await resolverTenantAtivoDoPayload(body, env);
  } catch (err) {
    return json({ erro: "Academia inválida." }, 400, request, env);
  }

  const origemNegada = await exigirOrigemTenant(request, env, tenantId);
  if (origemNegada) return origemNegada;

  const { uid: adminUid, resposta } = await exigirAdminTenant(request, env, "cadastrar alunos", tenantId);
  if (resposta) return resposta;

  const { nome, email, senha, telefone, nascimento, faixa, grau, valorMensalidade, kids, responsaveis } = body;

  // 2) TODA a validação acontece antes de qualquer chamada externa — um payload inválido
  // não chega a criar conta no Google nem a gastar quota.
  if (!nomeAlunoCadastroValido(nome)) {
    return json({ erro: "Nome inválido (1 a 99 caracteres)." }, 400, request, env);
  }
  if (!emailValido(email)) {
    return json({ erro: "E-mail inválido." }, 400, request, env);
  }
  if (!senhaInicialValida(senha)) {
    // Nunca ecoar a senha recebida, nem o tamanho dela, em log ou resposta.
    return json({ erro: "Senha inválida (6 a 128 caracteres)." }, 400, request, env);
  }
  if (!telefoneValido(telefone)) {
    return json({ erro: "Telefone inválido (até 29 caracteres)." }, 400, request, env);
  }
  if (!nascimentoValido(nascimento)) {
    return json({ erro: "Data de nascimento inválida (use AAAA-MM-DD)." }, 400, request, env);
  }
  if (!faixaValida(faixa)) {
    return json({ erro: "Faixa inválida." }, 400, request, env);
  }
  if (!grauValido(grau)) {
    return json({ erro: "Grau inválido." }, 400, request, env);
  }
  if (!valorMensalidadeValido(valorMensalidade)) {
    return json({ erro: "Mensalidade individual inválida." }, 400, request, env);
  }
  if (kids !== undefined && kids !== null && typeof kids !== "boolean") {
    return json({ erro: "Campo kids inválido." }, 400, request, env);
  }
  if (!responsaveisValidos(responsaveis)) {
    return json({ erro: "Dados do responsável inválidos." }, 400, request, env);
  }
  if (kids === true && (!Array.isArray(responsaveis) || responsaveis.length === 0)) {
    return json({ erro: "Cadastro kids exige ao menos um responsável." }, 400, request, env);
  }

  // 3) Conta no Firebase Auth.
  let uid;
  try {
    ({ uid } = await criarUsuarioAuth(env, { email, senha, nomeExibicao: nome }));
  } catch (err) {
    return respostaErroIdentity(err.codigoGoogle || "ERRO_DESCONHECIDO", request, env);
  }

  // 4) Defesa em profundidade: o UID vira caminho de documento ("alunos/" + uid). Mesmo
  // vindo do Google, é validado antes de ser concatenado.
  if (!alunoIdValido(uid)) {
    console.error("Identity Toolkit devolveu um UID em formato inesperado para:", email);
    return json(
      { erro: "Conta criada, mas o cadastro não pôde ser salvo. Contate o suporte." },
      500,
      request,
      env
    );
  }

  // 5) Documento do aluno. Os campos de dados espelham exatamente dadosAlunoValidos das
  // rules, pra que o aluno consiga editar o próprio cadastro depois.
  try {
    const alunoDados = {
      nome,
      telefone,
      nascimento,
      faixa,
      email,
      criadoEm: new Date(),
      criadoPorAdmin: true,
      criadoPorUid: adminUid,
      tenantId
    };
    if (grau !== undefined && grau !== null) {
      alunoDados.grau = grau;
      alunoDados.grauAtualizadoEm = new Date();
      alunoDados.ultimaGraduacaoEm = new Date();
    }
    if (valorMensalidade !== undefined && valorMensalidade !== null) alunoDados.valorMensalidade = valorMensalidade;
    if (kids === true) {
      alunoDados.kids = true;
      alunoDados.responsaveis = responsaveis;
    }
    await createDocument(env, caminhoTenant(tenantId, "alunos/" + uid), alunoDados);
    await criarOuAtualizarMembershipAluno(env, tenantId, uid, {
      criadoPorAdmin: true,
      criadoPorUid: adminUid
    });
  } catch (err) {
    // A conta JÁ existe no Auth neste ponto. Devolver um 500 genérico faria o professor
    // tentar de novo e bater em EMAIL_EXISTS pra sempre — então o UID órfão vai na
    // mensagem (e no log) pra dar o que fazer ao suporte.
    console.error(
      "Aluno criado no Auth mas SEM documento no Firestore (uid órfão):",
      uid,
      email,
      err
    );
    return json(
      {
        erro:
          "Conta criada mas cadastro não foi salvo — contate o suporte com este código: " +
          uid
      },
      500,
      request,
      env
    );
  }

  return json({ ok: true, alunoId: uid }, 200, request, env);
}

async function handleCompletarCadastroAluno(request, env) {
  const faltando = credenciaisFaltando(env);
  if (faltando) {
    return json(
      { erro: "Worker ainda não configurado. Faltam os segredos: " + faltando.join(", ") },
      501,
      request,
      env
    );
  }

  let uid;
  try {
    ({ uid } = await verificarIdToken(env, request.headers.get("Authorization")));
  } catch (err) {
    console.error("Falha na verificação do ID token no cadastro do aluno:", err);
    return json({ erro: "Não autenticado." }, 401, request, env);
  }

  const body = await request.json().catch(() => null);
  if (!body) return json({ erro: "Corpo da requisição inválido." }, 400, request, env);

  let tenantId;
  try {
    tenantId = await resolverTenantAtivoDoPayload(body, env);
  } catch (err) {
    return json({ erro: "Academia inválida ou inativa." }, 400, request, env);
  }

  // O tenantId chega no CORPO da requisição, ou seja: é texto escolhido pelo cliente.
  // Sozinho ele não vale nada — este handler concede membership de aluno (e cria o
  // documento em tenants/{tenantId}/alunos/{uid}) usando a service account, que passa por
  // cima das rules. Sem a checagem abaixo, qualquer usuário autenticado do projeto viraria
  // aluno de QUALQUER academia só trocando um campo do JSON.
  //
  // A validação é a origem da requisição: exigirOrigemTenant resolve o Origin contra
  // tenantDomains/{host} e tenantSlugs/{slug} e só libera se o tenant resolvido for
  // exatamente o tenantId do corpo. Sem header Origin, origemAutorizaTenant é fail-closed
  // (ver comentário lá em cima) — então curl/script também não passa.
  //
  // Exige-se o Origin explicitamente antes, só pra devolver 400 com motivo claro em vez de
  // um 403 genérico: chamada sem Origin nunca é um navegador legítimo neste endpoint.
  if (!origemHost(request)) {
    return json({ erro: "Requisição sem origem identificável." }, 400, request, env);
  }
  const origemNegada = await exigirOrigemTenant(request, env, tenantId);
  if (origemNegada) return origemNegada;

  const { nome, email, telefone, nascimento, faixa, kids, responsaveis } = body;
  if (!alunoIdValido(uid)) {
    return json({ erro: "Usuário inválido." }, 400, request, env);
  }
  if (!nomeAlunoCadastroValido(nome)) {
    return json({ erro: "Nome inválido (1 a 99 caracteres)." }, 400, request, env);
  }
  if (!emailValido(email)) {
    return json({ erro: "E-mail inválido." }, 400, request, env);
  }
  if (!telefoneValido(telefone)) {
    return json({ erro: "Telefone inválido (até 29 caracteres)." }, 400, request, env);
  }
  if (!nascimentoValido(nascimento)) {
    return json({ erro: "Data de nascimento inválida (use AAAA-MM-DD)." }, 400, request, env);
  }
  if (!faixaValida(faixa)) {
    return json({ erro: "Faixa inválida." }, 400, request, env);
  }
  if (kids !== undefined && kids !== null && typeof kids !== "boolean") {
    return json({ erro: "Campo kids inválido." }, 400, request, env);
  }
  if (!responsaveisValidos(responsaveis)) {
    return json({ erro: "Dados do responsável inválidos." }, 400, request, env);
  }
  if (kids === true && (!Array.isArray(responsaveis) || responsaveis.length === 0)) {
    return json({ erro: "Cadastro kids exige ao menos um responsável." }, 400, request, env);
  }

  try {
    const alunoDados = {
      nome,
      telefone,
      nascimento,
      faixa,
      email,
      criadoEm: new Date(),
      tenantId
    };
    if (kids === true) {
      alunoDados.kids = true;
      alunoDados.responsaveis = responsaveis;
    }
    await createDocument(env, caminhoTenant(tenantId, "alunos/" + uid), alunoDados);
    await criarOuAtualizarMembershipAluno(env, tenantId, uid, {
      criadoPorAdmin: false
    });
  } catch (err) {
    if (err.jaExiste) {
      await criarOuAtualizarMembershipAluno(env, tenantId, uid, {
        criadoPorAdmin: false
      });
      return json({ ok: true, alunoId: uid }, 200, request, env);
    }
    console.error("Cadastro do aluno autenticado falhou no Firestore:", uid, err);
    return json({ erro: "Cadastro criado no login, mas não foi concluído. Tente novamente." }, 500, request, env);
  }

  return json({ ok: true, alunoId: uid }, 200, request, env);
}

// ---------------------------------------------------------------------------
// Papel "professor" — POST /criar-professor e POST /gerenciar-professor.
//
// Por que pelo Worker, e não pelo cliente:
// tenants/{t}/memberships/{uid} e tenants/{t}/professores/{uid} são `allow write: if false`
// para TODO cliente (inclusive admin) em firestore.rules. Conceder um papel é escalada de
// privilégio por definição — deixar isso no navegador significaria que a única barreira
// seria uma rule que precisa, ela mesma, ler o papel de quem escreve. Aqui a barreira é
// a mesma cadeia dos outros endpoints administrativos:
//
//   resolverTenantAtivoDoPayload -> exigirOrigemTenant (fail-closed sem Origin)
//   -> exigirAdminTenant -> validação -> escrita com service account.
//
// O tenantId chega no CORPO da requisição, ou seja, é texto escolhido pelo cliente:
// sozinho não vale nada. Quem o legitima é exigirOrigemTenant, que resolve o Origin
// contra tenantDomains/tenantSlugs e só libera se bater com o tenantId do corpo.
// ---------------------------------------------------------------------------

async function handleCriarProfessor(request, env) {
  const faltando = credenciaisFaltando(env);
  if (faltando) {
    return json(
      { erro: "Worker ainda não configurado. Faltam os segredos: " + faltando.join(", ") },
      501,
      request,
      env
    );
  }

  const body = await request.json().catch(() => null);
  if (!body) return json({ erro: "Corpo da requisição inválido." }, 400, request, env);

  let tenantId;
  try {
    tenantId = await resolverTenantAtivoDoPayload(body, env);
  } catch (err) {
    return json({ erro: "Academia inválida." }, 400, request, env);
  }

  const origemNegada = await exigirOrigemTenant(request, env, tenantId);
  if (origemNegada) return origemNegada;

  const { uid: adminUid, resposta } = await exigirAdminTenant(request, env, "cadastrar professores", tenantId);
  if (resposta) return resposta;

  const { nome, email, senha, telefone, equipeId } = body;

  // Toda a validação antes de qualquer chamada externa — payload inválido não chega a
  // criar conta no Google nem a gastar quota.
  if (!nomeAlunoCadastroValido(nome)) {
    return json({ erro: "Nome inválido (1 a 99 caracteres)." }, 400, request, env);
  }
  if (!emailValido(email)) {
    return json({ erro: "E-mail inválido." }, 400, request, env);
  }
  if (!senhaInicialValida(senha)) {
    // Nunca ecoar a senha recebida, nem o tamanho dela, em log ou resposta.
    return json({ erro: "Senha inválida (6 a 128 caracteres)." }, 400, request, env);
  }
  const telefoneNormalizado = telefone === undefined || telefone === null ? "" : telefone;
  if (!telefoneValido(telefoneNormalizado)) {
    return json({ erro: "Telefone inválido (até 29 caracteres)." }, 400, request, env);
  }

  const temEquipe = equipeId !== undefined && equipeId !== null && equipeId !== "";
  if (temEquipe && !equipeIdValido(equipeId)) {
    return json({ erro: "Perfil da equipe inválido." }, 400, request, env);
  }
  if (temEquipe) {
    // Mesma disciplina do exists() de horarios.turmaId nas rules: vínculo órfão não entra.
    const equipeDoc = await getDocument(env, caminhoTenant(tenantId, "equipe/" + equipeId));
    if (!equipeDoc) {
      return json({ erro: "Perfil da equipe não encontrado nesta academia." }, 400, request, env);
    }
  }

  let uid;
  try {
    ({ uid } = await criarUsuarioAuth(env, { email, senha, nomeExibicao: nome }));
  } catch (err) {
    return respostaErroIdentity(err.codigoGoogle || "ERRO_DESCONHECIDO", request, env);
  }

  // Defesa em profundidade: o UID vira caminho de documento. Mesmo vindo do Google,
  // é validado antes de ser concatenado.
  if (!alunoIdValido(uid)) {
    console.error("Identity Toolkit devolveu um UID em formato inesperado ao criar professor.");
    return json(
      { erro: "Conta criada, mas o cadastro não pôde ser salvo. Contate o suporte." },
      500,
      request,
      env
    );
  }

  const agora = new Date();
  const dadosProfessor = {
    nome,
    email,
    telefone: telefoneNormalizado,
    status: "ativo",
    // Professor criado do zero por aqui não tem documento em alunos/{uid}: ele não
    // treina na academia (ainda). Quem vira professor sendo aluno entra por
    // /gerenciar-professor, que carimba este campo como true.
    ehAlunoTambem: false,
    criadoEm: agora,
    criadoPorUid: adminUid,
    atualizadoEm: agora,
    atualizadoPorUid: adminUid,
    tenantId
  };
  if (temEquipe) dadosProfessor.equipeId = equipeId;

  try {
    await createDocument(env, caminhoTenant(tenantId, "professores/" + uid), dadosProfessor);
    await gravarMembership(env, tenantId, uid, {
      role: "professor",
      status: "ativo",
      extras: { criadoPorAdmin: true, criadoPorUid: adminUid }
    });
  } catch (err) {
    // A conta JÁ existe no Auth neste ponto (mesmo caso de handleCriarAluno): devolver
    // um 500 genérico faria o admin tentar de novo e bater em EMAIL_EXISTS pra sempre.
    console.error("Professor criado no Auth mas SEM documento no Firestore (uid órfão):", uid, err);
    return json(
      {
        erro:
          "Conta criada mas cadastro não foi salvo — contate o suporte com este código: " +
          uid
      },
      500,
      request,
      env
    );
  }

  return json({ ok: true, professorId: uid }, 200, request, env);
}

async function handleGerenciarProfessor(request, env) {
  const faltando = credenciaisFaltando(env);
  if (faltando) {
    return json(
      { erro: "Worker ainda não configurado. Faltam os segredos: " + faltando.join(", ") },
      501,
      request,
      env
    );
  }

  const body = await request.json().catch(() => null);
  if (!body) return json({ erro: "Corpo da requisição inválido." }, 400, request, env);

  let tenantId;
  try {
    tenantId = await resolverTenantAtivoDoPayload(body, env);
  } catch (err) {
    return json({ erro: "Academia inválida." }, 400, request, env);
  }

  const origemNegada = await exigirOrigemTenant(request, env, tenantId);
  if (origemNegada) return origemNegada;

  const { uid: adminUid, resposta } = await exigirAdminTenant(request, env, "gerenciar professores", tenantId);
  if (resposta) return resposta;

  const { uid, acao, equipeId } = body;

  if (!alunoIdValido(uid)) {
    return json({ erro: "Usuário inválido." }, 400, request, env);
  }
  if (!acaoProfessorValida(acao)) {
    return json({ erro: "Ação inválida. Use 'promover' ou 'remover'." }, 400, request, env);
  }
  const temEquipe = equipeId !== undefined && equipeId !== null && equipeId !== "";
  if (temEquipe && !equipeIdValido(equipeId)) {
    return json({ erro: "Perfil da equipe inválido." }, 400, request, env);
  }

  // O alvo precisa já pertencer a ESTA academia. Sem isso, um admin conseguiria criar
  // membership (e, portanto, acesso) pra um uid qualquer do projeto Firebase inteiro.
  const membershipDoc = await getDocument(env, caminhoTenant(tenantId, "memberships/" + uid));
  if (!membershipDoc || campoString(membershipDoc, "status") !== "ativo") {
    return json(
      { erro: "Este usuário não tem cadastro ativo nesta academia." },
      400,
      request,
      env
    );
  }

  // Este endpoint só sabe gravar role 'professor' ou 'aluno', e memberships é write:if false
  // nas rules — ou seja, rebaixar um admin/owner por aqui seria um caminho SEM VOLTA pelo app
  // (lockout do painel administrativo). Nenhuma das duas ações pode tocar em admin/owner,
  // nem sobre outro admin nem sobre o próprio autor da chamada.
  const roleAtual = campoString(membershipDoc, "role");
  if (roleAtual === "admin" || roleAtual === "owner") {
    return json(
      { erro: "Não é possível alterar o papel de um administrador por este endpoint." },
      403,
      request,
      env
    );
  }

  if (temEquipe) {
    const equipeDoc = await getDocument(env, caminhoTenant(tenantId, "equipe/" + equipeId));
    if (!equipeDoc) {
      return json({ erro: "Perfil da equipe não encontrado nesta academia." }, 400, request, env);
    }
  }

  const agora = new Date();
  const alunoDoc = await getDocument(env, caminhoTenant(tenantId, "alunos/" + uid));

  if (acao === "remover") {
    // Remover só faz sentido sobre quem é professor de verdade: sem isso, um patchDocument
    // criaria um registro órfão em professores/{uid} pra quem nunca deu aula, e ainda
    // reescreveria a membership de um aluno comum sem motivo.
    const professorDoc = await getDocument(env, caminhoTenant(tenantId, "professores/" + uid));
    if (roleAtual !== "professor" && !professorDoc) {
      return json({ erro: "Este uid não é um professor." }, 400, request, env);
    }
  }

  if (acao === "promover") {
    const dados = {
      status: "ativo",
      // Professor que também treina: mantém o documento em alunos/{uid} intacto (é ele
      // que continua liberando o check-in) e só ganha o papel novo.
      ehAlunoTambem: !!alunoDoc,
      atualizadoEm: agora,
      atualizadoPorUid: adminUid,
      tenantId
    };
    if (alunoDoc) {
      dados.nome = campoString(alunoDoc, "nome") || "";
      dados.email = campoString(alunoDoc, "email") || "";
      dados.telefone = campoString(alunoDoc, "telefone") || "";
    }
    if (temEquipe) dados.equipeId = equipeId;

    // Upsert: promover alguém já promovido (ex.: só pra trocar o equipeId) não pode falhar.
    await patchDocument(env, caminhoTenant(tenantId, "professores/" + uid), dados);
    await gravarMembership(env, tenantId, uid, { role: "professor", status: "ativo" });

    return json({ ok: true, uid, role: "professor" }, 200, request, env);
  }

  // acao === "remover": o registro em professores/ NÃO é apagado (é rastro de quem já
  // deu aula na academia) — vira status 'inativo'. O que muda de verdade é o membership,
  // que volta a ser 'aluno'. Sem documento em alunos/{uid} a pessoa não treina aqui,
  // então a membership volta inativa em vez de dar acesso de aluno a quem nunca teve.
  await patchDocument(env, caminhoTenant(tenantId, "professores/" + uid), {
    status: "inativo",
    atualizadoEm: agora,
    atualizadoPorUid: adminUid,
    tenantId
  });
  await gravarMembership(env, tenantId, uid, {
    role: "aluno",
    status: alunoDoc ? "ativo" : "inativo"
  });

  return json({ ok: true, uid, role: "aluno" }, 200, request, env);
}

async function handleDisparoMassa(request, env) {
  const faltando = credenciaisFirebaseFaltando(env);
  if (faltando) {
    return json({ erro: "Worker ainda não configurado. Faltam os segredos: " + faltando.join(", ") }, 501, request, env);
  }
  const body = await request.json().catch(() => null);
  if (!body) return json({ erro: "Corpo da requisição inválido." }, 400, request, env);

  let tenantId;
  try {
    tenantId = await resolverTenantAtivoDoPayload(body, env);
  } catch (err) {
    return json({ erro: "Academia inválida." }, 400, request, env);
  }
  const origemNegada = await exigirOrigemTenant(request, env, tenantId);
  if (origemNegada) return origemNegada;
  const { uid, resposta } = await exigirAdminTenant(request, env, "registrar disparos", tenantId);
  if (resposta) return resposta;

  const canal = body.canal === "whatsapp-link" ? "whatsapp-link" : null;
  const filtros = ["todos", "pendentes", "professor", "parceiro"];
  const filtro = filtros.includes(body.filtro) ? body.filtro : null;
  const total = Number(body.totalDestinatarios);
  const preview = typeof body.mensagemPreview === "string" ? body.mensagemPreview : "";
  if (!canal || !filtro || !Number.isInteger(total) || total < 1 || total > 2000 || preview.length > 120) {
    return json({ erro: "Payload de disparo inválido." }, 400, request, env);
  }

  const id = crypto.randomUUID();
  const agora = new Date();
  await createDocument(env, caminhoTenant(tenantId, "disparos/" + id), {
    canal,
    filtro,
    totalDestinatarios: total,
    mensagemPreview: preview,
    status: "links_gerados",
    criadoPorUid: uid,
    criadoEm: agora,
    tenantId
  });
  return json({ ok: true, disparoId: id }, 200, request, env);
}

function dataCampo(doc, nome) {
  const valor = doc?.data?.[nome];
  return valor instanceof Date ? valor : null;
}

async function handleRecalcularRanking(request, env) {
  const faltando = credenciaisFirebaseFaltando(env);
  if (faltando) {
    return json({ erro: "Worker ainda não configurado. Faltam os segredos: " + faltando.join(", ") }, 501, request, env);
  }
  const body = await request.json().catch(() => null);
  if (!body) return json({ erro: "Corpo da requisição inválido." }, 400, request, env);

  let tenantId;
  try {
    tenantId = await resolverTenantAtivoDoPayload(body, env);
  } catch (err) {
    return json({ erro: "Academia inválida." }, 400, request, env);
  }
  const origemNegada = await exigirOrigemTenant(request, env, tenantId);
  if (origemNegada) return origemNegada;
  const { uid, resposta } = await exigirAdminTenant(request, env, "recalcular ranking", tenantId);
  if (resposta) return resposta;

  const periodo = typeof body.periodo === "string" && /^[0-9]{4}-(0[1-9]|1[0-2])$/.test(body.periodo)
    ? body.periodo
    : new Date().toISOString().slice(0, 7);

  const [alunos, checkins] = await Promise.all([
    listDocuments(env, caminhoTenant(tenantId, "alunos")),
    listDocuments(env, caminhoTenant(tenantId, "checkins"))
  ]);

  const inicio = new Date(periodo + "-01T00:00:00.000Z");
  const fim = new Date(inicio);
  fim.setUTCMonth(fim.getUTCMonth() + 1);
  const contagens = {};
  checkins.forEach((doc) => {
    const alunoId = doc.data.alunoId;
    const timestamp = dataCampo(doc, "timestamp");
    if (typeof alunoId !== "string" || !timestamp || timestamp < inicio || timestamp >= fim) return;
    contagens[alunoId] = (contagens[alunoId] || 0) + 1;
  });

  const agora = new Date();
  const itens = alunos.map((doc) => {
    const aluno = doc.data;
    const totalCheckins = contagens[doc.id] || 0;
    const pago = (aluno.mensalidadeStatus || "pendente") === "pago";
    const pontos = totalCheckins * 10 + (pago ? 15 : 0);
    return {
      id: doc.id,
      nomePublico: aluno.nome || "Aluno",
      faixa: aluno.faixa || "",
      grau: Number.isInteger(aluno.grau) ? aluno.grau : 0,
      totalCheckins,
      pontos,
      atualizadoEm: agora,
      atualizadoPorUid: uid,
      tenantId
    };
  }).sort((a, b) => b.pontos - a.pontos || a.nomePublico.localeCompare(b.nomePublico));

  await patchDocument(env, caminhoTenant(tenantId, "ranking/" + periodo), {
    periodo,
    totalAlunos: itens.length,
    atualizadoEm: agora,
    atualizadoPorUid: uid,
    tenantId
  });
  await Promise.all(itens.map((item, indice) => patchDocument(env, caminhoTenant(tenantId, "ranking/" + periodo + "/alunos/" + item.id), {
    nomePublico: item.nomePublico,
    faixa: item.faixa,
    grau: item.grau,
    totalCheckins: item.totalCheckins,
    pontos: item.pontos,
    posicao: indice + 1,
    atualizadoEm: item.atualizadoEm,
    atualizadoPorUid: item.atualizadoPorUid,
    tenantId
  })));

  return json({ ok: true, periodo, total: itens.length }, 200, request, env);
}

// ---------------------------------------------------------------------------
// Credencial do Asaas do próprio professor (Fase 5) — /config/credencial-asaas.
//
// GET    → metadados (configurada?, últimos 4 dígitos, ambiente, quando)
// POST   → valida a chave contra a API do Asaas e grava CIFRADA em config/credenciais
// DELETE → remove a credencial (volta ao fallback da secret legada ASAAS_API_KEY)
//
// A chave em texto plano NUNCA sai daqui: nenhuma das três respostas devolve o valor,
// nem o ciphertext. E nada dela vai pra console.log/console.error em lugar nenhum.
// ---------------------------------------------------------------------------

// Limites de tamanho da chave. Não dá pra validar o formato exato do Asaas (varia entre
// sandbox/produção e pode mudar), então aqui é só tipo/tamanho — a validação de verdade é
// a chamada ao /myAccount logo abaixo.
const ASAAS_API_KEY_MIN = 10;
const ASAAS_API_KEY_MAX = 200;

// Autenticação + admin, o mesmo padrão dos outros handlers. Devolve { uid } ou
// { resposta } com o 401/403 pronto.
async function exigirAdmin(request, env, acao, tenantId = tenantPadrao(env)) {
  return exigirAdminTenant(request, env, acao, tenantId);
}

// Confere a chave contra a própria API do Asaas antes de gravar qualquer coisa: pega
// erro de digitação e ambiente trocado na hora, em vez de deixar a academia com uma
// credencial quebrada que só falha na primeira cobrança de verdade.
// A URL vem do AMBIENTE escolhido (ver baseUrlDoAmbiente em credenciais.js), não de
// env.ASAAS_BASE_URL — validar chave de produção contra a URL de sandbox falharia sempre.
async function validarChaveNoAsaas(apiKey, ambiente) {
  const base = baseUrlDoAmbiente(ambiente);
  if (!base) return false;

  try {
    const resp = await fetch(base + "/myAccount", {
      headers: { access_token: apiKey, Accept: "application/json" }
    });
    // Nada do corpo da resposta é lido nem logado: ele descreve a conta do professor.
    return resp.ok;
  } catch (err) {
    console.error("Falha de rede ao validar a chave no Asaas (ambiente " + ambiente + ").");
    return false;
  }
}

async function handleSalvarCredencialAsaas(request, env) {
  if (!env.CREDENCIAL_CRYPTO_KEY) {
    return json(
      { erro: "Worker sem CREDENCIAL_CRYPTO_KEY configurada — não é possível guardar a chave com segurança." },
      501,
      request,
      env
    );
  }

  const body = await request.json().catch(() => null);
  if (!body) return json({ erro: "Corpo da requisição inválido." }, 400, request, env);

  let tenantId;
  try {
    tenantId = await resolverTenantAtivoDoPayload(body, env);
  } catch (err) {
    return json({ erro: "Academia inválida." }, 400, request, env);
  }

  const origemNegada = await exigirOrigemTenant(request, env, tenantId);
  if (origemNegada) return origemNegada;

  const { uid, resposta } = await exigirAdminTenant(request, env, "configurar a credencial de pagamento", tenantId);
  if (resposta) return resposta;

  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  const ambiente = body.ambiente;

  if (apiKey.length < ASAAS_API_KEY_MIN || apiKey.length > ASAAS_API_KEY_MAX) {
    return json(
      { erro: "Chave de API inválida (deve ter entre " + ASAAS_API_KEY_MIN + " e " + ASAAS_API_KEY_MAX + " caracteres)." },
      400,
      request,
      env
    );
  }

  if (!ambienteValido(ambiente)) {
    return json({ erro: "Ambiente inválido. Use 'sandbox' ou 'producao'." }, 400, request, env);
  }

  const valida = await validarChaveNoAsaas(apiKey, ambiente);
  if (!valida) {
    return json({ erro: "Chave inválida ou ambiente incorreto." }, 400, request, env);
  }

  await salvarAsaasApiKey(env, { apiKeyPlana: apiKey, ambiente, atualizadoPorUid: uid, tenantId });

  // Só os 4 últimos dígitos voltam pro painel — o suficiente pro professor reconhecer
  // qual chave está ali, inútil pra quem interceptar.
  return json({ ok: true, ultimos4: apiKey.slice(-4), ambiente }, 200, request, env);
}

async function tenantIdDaUrl(request, env) {
  return resolverTenantAtivoDaUrl(request, env);
}

async function handleLerCredencialAsaas(request, env) {
  let tenantId;
  try {
    tenantId = await tenantIdDaUrl(request, env);
  } catch (err) {
    return json({ erro: "Academia inválida." }, 400, request, env);
  }

  const origemNegada = await exigirOrigemTenant(request, env, tenantId);
  if (origemNegada) return origemNegada;

  const { resposta } = await exigirAdminTenant(request, env, "ver a credencial de pagamento", tenantId);
  if (resposta) return resposta;

  const metadados = await obterMetadadosCredencial(env, tenantId);
  return json(metadados, 200, request, env);
}

async function handleApagarCredencialAsaas(request, env) {
  let tenantId;
  try {
    tenantId = await tenantIdDaUrl(request, env);
  } catch (err) {
    return json({ erro: "Academia inválida." }, 400, request, env);
  }

  const origemNegada = await exigirOrigemTenant(request, env, tenantId);
  if (origemNegada) return origemNegada;

  const { resposta } = await exigirAdminTenant(request, env, "remover a credencial de pagamento", tenantId);
  if (resposta) return resposta;

  await apagarCredencial(env, tenantId);
  return json({ ok: true }, 200, request, env);
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: await corsHeadersPreflight(request, env) });
    }

    const { pathname } = new URL(request.url);

    try {
      if (pathname === "/criar-cobranca" && request.method === "POST") {
        return await handleCriarCobranca(request, env);
      }
      if (pathname === "/webhook-asaas" && request.method === "POST") {
        return await handleWebhookAsaas(request, env);
      }
      // Lembrete de mensalidade por e-mail (um aluno por chamada).
      if (pathname === "/enviar-lembrete" && request.method === "POST") {
        return await handleEnviarLembrete(request, env);
      }
      // Cadastro de aluno pelo professor (cria conta no Auth + documento). Só admin.
      if (pathname === "/criar-aluno" && request.method === "POST") {
        return await handleCriarAluno(request, env);
      }
      // Papel professor: criar do zero (conta no Auth + professores/{uid} + membership)
      // ou promover/rebaixar quem já pertence à academia. Só admin — ver o bloco de
      // comentários acima de handleCriarProfessor.
      if (pathname === "/criar-professor" && request.method === "POST") {
        return await handleCriarProfessor(request, env);
      }
      if (pathname === "/gerenciar-professor" && request.method === "POST") {
        return await handleGerenciarProfessor(request, env);
      }
      if (pathname === "/disparo-massa" && request.method === "POST") {
        return await handleDisparoMassa(request, env);
      }
      if (pathname === "/recalcular-ranking" && request.method === "POST") {
        return await handleRecalcularRanking(request, env);
      }
      // Cadastro feito pelo próprio aluno: Auth acontece no navegador, Firestore e
      // memberships são finalizados aqui com service account.
      if (pathname === "/completar-cadastro" && request.method === "POST") {
        return await handleCompletarCadastroAluno(request, env);
      }
      // Comprovante de pagamento do modo Pix manual (ver worker/src/comprovante.js).
      if (pathname === "/comprovante" && request.method === "POST") {
        return await handleUploadComprovante(request, env);
      }
      if (pathname.startsWith("/comprovante/") && request.method === "GET") {
        const bruto = pathname.slice("/comprovante/".length);
        let cobrancaId;
        try {
          cobrancaId = decodeURIComponent(bruto);
        } catch (err) {
          cobrancaId = bruto; // percent-encoding inválido: cai na validação do handler.
        }
        return await handleBaixarComprovante(request, env, cobrancaId);
      }
      // Credencial do Asaas cadastrada pelo professor (Fase 5). Só admin.
      if (pathname === "/config/credencial-asaas") {
        if (request.method === "POST") return await handleSalvarCredencialAsaas(request, env);
        if (request.method === "GET") return await handleLerCredencialAsaas(request, env);
        if (request.method === "DELETE") return await handleApagarCredencialAsaas(request, env);
        return json({ erro: "Método não permitido." }, 405, request, env);
      }
      if (pathname === "/" && request.method === "GET") {
        return json({ status: "ok", service: "academiateste-financeiro" }, 200, request, env);
      }
      return json({ erro: "Rota não encontrada." }, 404, request, env);
    } catch (err) {
      // Detalhe completo vai só pro log do Worker; o cliente recebe uma mensagem genérica
      // (antes, String(err.message) devolvia corpo de erro do provedor/Firestore).
      console.error(err);
      return json({ erro: "Erro interno." }, 500, request, env);
    }
  }
};
