import { getDocument, createDocument, patchDocument } from "./firestore.js";
import { criarCustomer, criarPagamentoPix, obterQrCodePix, consultarPagamento } from "./asaas.js";
import { verificarIdToken } from "./auth.js";
import { validarTokenWebhook } from "./webhook-token.js";
import { corsHeaders, json, campoString } from "./http.js";
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
  cpfCnpjValido,
  nomeAlunoCadastroValido,
  telefoneValido,
  nascimentoValido,
  faixaValida,
  senhaInicialValida
} from "./validacao.js";
import { criarUsuarioAuth } from "./identity.js";

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

// Resolve a chave de API do Asaas (credencial cadastrada > secret legada) e devolve
// { apiKey, envAsaas } ou { resposta } com um 501 já pronto. Chamado ANTES de qualquer
// chamada ao Asaas — sem chave, a requisição morre aqui em vez de virar um 500 genérico
// lá na frente.
//
// envAsaas é o env com ASAAS_BASE_URL ajustada pro ambiente da credencial cadastrada
// (worker/src/asaas.js lê a base URL de lá). Sem isso, uma chave de PRODUÇÃO cadastrada
// pelo painel seria usada contra a URL de SANDBOX do wrangler.toml — e vice-versa.
async function resolverApiKeyAsaas(request, env) {
  let apiKey;
  let baseUrl;
  try {
    ({ apiKey, baseUrl } = await obterConfigAsaas(env));
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

  // 1) Quem está chamando? Só um ID token válido do Firebase passa daqui.
  let uid;
  try {
    ({ uid } = await verificarIdToken(env, request.headers.get("Authorization")));
  } catch (err) {
    console.error("Falha na verificação do ID token:", err);
    return json({ erro: "Não autenticado." }, 401, request, env);
  }

  // 2) Esse usuário é professor? A coleção admins é a mesma fonte de verdade das rules.
  const adminDoc = await getDocument(env, "admins/" + uid);
  if (!adminDoc) {
    return json({ erro: "Sem permissão para gerar cobranças." }, 403, request, env);
  }

  // 2.1) Qual chave do Asaas usar? (credencial cadastrada pelo professor > secret legada)
  const { apiKey, envAsaas, resposta: semChave } = await resolverApiKeyAsaas(request, env);
  if (semChave) return semChave;

  const body = await request.json().catch(() => null);
  if (!body) return json({ erro: "Corpo da requisição inválido." }, 400, request, env);

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
  const alunoDoc = await getDocument(env, "alunos/" + alunoId);
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
      externalReference: alunoId
    });
    asaasCustomerId = customer.id;

    // exigirExistente: true — o doc do aluno já foi lido acima; isso só garante que um
    // PATCH nunca crie um "aluno fantasma" caso ele suma no meio do caminho.
    await patchDocument(
      env,
      "alunos/" + alunoId,
      { asaasCustomerId, customerCriadoEm: new Date() },
      { exigirExistente: true }
    );
  }

  // 5) Idempotência: o ID do documento é "<alunoId>_<mesReferencia>". O Asaas não tem
  // X-Idempotency-Key nativo, então o guard é aqui — ANTES de qualquer chamada à API.
  const cobrancaId = derivarCobrancaId(alunoId, mesReferencia);
  const cobrancaPath = "cobrancas/" + cobrancaId;
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
    externalReference: cobrancaId
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
    atualizadoEm: agora
  };

  if (cobrancaExistente) {
    // Só chega aqui se a cobrança anterior estava "cancelado" — reaproveita o mesmo ID.
    await patchDocument(env, cobrancaPath, dados, { exigirExistente: true });
  } else {
    // createDocument (currentDocument.exists=false): se dois cliques simultâneos passarem
    // pelo guard acima, o segundo falha em vez de sobrescrever a cobrança do primeiro.
    await createDocument(env, cobrancaPath, dados);
  }

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

  // Nunca confia no status que veio no payload — sempre reconsulta a API do Asaas.
  // A chave é resolvida só agora, depois do token válido e de haver um paymentId: assim
  // um webhook forjado nem chega a tocar no Firestore/credencial.
  const { apiKey, envAsaas, resposta: semChave } = await resolverApiKeyAsaas(request, env);
  if (semChave) return semChave;

  const pagamento = await consultarPagamento(envAsaas, apiKey, paymentId);

  if (pagamento.status === "RECEIVED" || pagamento.status === "CONFIRMED") {
    // O externalReference também vem da RESPOSTA da consulta, não do payload do webhook.
    const referencia = pagamento.externalReference;

    if (typeof referencia !== "string" || !referencia.includes("_")) {
      console.error("Webhook: externalReference em formato inesperado:", referencia);
      return json({ ok: true }, 200, request, env);
    }

    // "<alunoId>_<mesReferencia>": corta no ÚLTIMO "_" (o alunoId pode conter "_").
    const corte = referencia.lastIndexOf("_");
    const alunoId = referencia.slice(0, corte);
    const mesReferencia = referencia.slice(corte + 1);

    // Valida os dois pedaços antes de montar qualquer caminho de documento.
    if (!alunoIdValido(alunoId) || !mesReferenciaValido(mesReferencia)) {
      console.error("Webhook: externalReference em formato inesperado:", referencia);
      return json({ ok: true }, 200, request, env);
    }

    const cobrancaId = derivarCobrancaId(alunoId, mesReferencia);
    const agora = new Date();

    // exigirExistente: true nos dois PATCHs. Sem isso, o upsert cego criava
    // "alunos/<qualquer coisa>" a partir do externalReference do pagamento.
    try {
      await patchDocument(
        env,
        "cobrancas/" + cobrancaId,
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
        "alunos/" + alunoId,
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

  // 1) Autenticação + admin, mesmo padrão de handleCriarCobranca.
  let uid;
  try {
    ({ uid } = await verificarIdToken(env, request.headers.get("Authorization")));
  } catch (err) {
    console.error("Falha na verificação do ID token:", err);
    return json({ erro: "Não autenticado." }, 401, request, env);
  }

  const adminDoc = await getDocument(env, "admins/" + uid);
  if (!adminDoc) {
    return json({ erro: "Sem permissão para enviar lembretes." }, 403, request, env);
  }

  const body = await request.json().catch(() => null);
  if (!body) return json({ erro: "Corpo da requisição inválido." }, 400, request, env);

  const { alunoId } = body;
  if (!alunoIdValido(alunoId)) {
    return json({ erro: "Campo obrigatório: alunoId." }, 400, request, env);
  }

  const alunoDoc = await getDocument(env, "alunos/" + alunoId);
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
  const contadorPath = caminhoContadorLembretes(dataISO);
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
  const configDoc = await getDocument(env, "config/geral");
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

  // 1) Autenticação + admin, mesmo padrão de handleCriarCobranca.
  const { uid: adminUid, resposta } = await exigirAdmin(request, env, "cadastrar alunos");
  if (resposta) return resposta;

  const body = await request.json().catch(() => null);
  if (!body) return json({ erro: "Corpo da requisição inválido." }, 400, request, env);

  const { nome, email, senha, telefone, nascimento, faixa } = body;

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
    await createDocument(env, "alunos/" + uid, {
      nome,
      telefone,
      nascimento,
      faixa,
      email,
      criadoEm: new Date(),
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
async function exigirAdmin(request, env, acao) {
  let uid;
  try {
    ({ uid } = await verificarIdToken(env, request.headers.get("Authorization")));
  } catch (err) {
    console.error("Falha na verificação do ID token:", err);
    return { resposta: json({ erro: "Não autenticado." }, 401, request, env) };
  }

  const adminDoc = await getDocument(env, "admins/" + uid);
  if (!adminDoc) {
    return { resposta: json({ erro: "Sem permissão para " + acao + "." }, 403, request, env) };
  }

  return { uid };
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
  const { uid, resposta } = await exigirAdmin(request, env, "configurar a credencial de pagamento");
  if (resposta) return resposta;

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

  await salvarAsaasApiKey(env, { apiKeyPlana: apiKey, ambiente, atualizadoPorUid: uid });

  // Só os 4 últimos dígitos voltam pro painel — o suficiente pro professor reconhecer
  // qual chave está ali, inútil pra quem interceptar.
  return json({ ok: true, ultimos4: apiKey.slice(-4), ambiente }, 200, request, env);
}

async function handleLerCredencialAsaas(request, env) {
  const { resposta } = await exigirAdmin(request, env, "ver a credencial de pagamento");
  if (resposta) return resposta;

  const metadados = await obterMetadadosCredencial(env);
  return json(metadados, 200, request, env);
}

async function handleApagarCredencialAsaas(request, env) {
  const { resposta } = await exigirAdmin(request, env, "remover a credencial de pagamento");
  if (resposta) return resposta;

  await apagarCredencial(env);
  return json({ ok: true }, 200, request, env);
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(request, env) });
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
