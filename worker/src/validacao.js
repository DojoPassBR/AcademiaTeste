// Validação de entrada do Worker — funções puras, sem dependência de env/fetch.
//
// O ponto crítico é alunoIdValido: o alunoId vem do corpo da requisição e é concatenado
// direto no caminho do documento do Firestore ("alunos/" + alunoId). Sem a checagem de
// formato, uma barra no valor faria a escrita cair numa subcoleção arbitrária.

// UID do Firebase Auth: alfanumérico (o padrão tem 28 chars); nunca contém "/" nem ".".
function alunoIdValido(v) {
  return typeof v === "string" && /^[A-Za-z0-9_-]{20,64}$/.test(v);
}

// Mês de referência no formato "YYYY-MM" (mesmo que admin.html envia).
function mesReferenciaValido(v) {
  return typeof v === "string" && /^[0-9]{4}-(0[1-9]|1[0-2])$/.test(v);
}

// Valor da mensalidade: número finito, positivo, teto sanitário de R$ 5.000
// e no máximo 2 casas decimais (o Asaas rejeita mais que isso).
function valorValido(v) {
  return (
    typeof v === "number" &&
    Number.isFinite(v) &&
    v > 0 &&
    v <= 5000 &&
    Number(v.toFixed(2)) === v
  );
}

function alunoNomeValido(v) {
  return typeof v === "string" && v.length > 0 && v.length <= 100;
}

// Vencimento que vai pro Asaas: "YYYY-MM-DD" e uma data que existe de verdade
// (rejeita "2026-02-31", que casa com a regex mas não é um dia real).
function dueDateValido(v) {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const data = new Date(v + "T00:00:00Z");
  if (Number.isNaN(data.getTime())) return false;
  return data.toISOString().slice(0, 10) === v;
}

// E-mail do aluno. Mesma regra do firestore.rules ('^[^@]+@[^@]+[.][^@]+$' + tamanho
// máximo): é uma checagem de plausibilidade, não de existência. Aqui serve pra não
// mandar pro Resend um campo que claramente não é um endereço (aluno cadastrado antes
// das rules atuais, por exemplo).
function emailValido(v) {
  return typeof v === "string" && v.length > 0 && v.length < 100 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
}

// ID do documento de cobrança = "<alunoId>_<mesReferencia>".
// Esse esquema é o que dá idempotência à criação de cobrança (o Asaas não tem
// X-Idempotency-Key como o Mercado Pago tinha): duas chamadas pro mesmo aluno/mês
// caem no mesmo documento em vez de gerarem duas cobranças.
// Valida os dois pedaços ANTES de concatenar — o resultado vira caminho de documento
// no Firestore, então uma barra ou ponto aqui seria escrita em coleção arbitrária.
function derivarCobrancaId(alunoId, mesReferencia) {
  if (!alunoIdValido(alunoId)) throw new Error("alunoId inválido para montar o ID da cobrança.");
  if (!mesReferenciaValido(mesReferencia)) {
    throw new Error("mesReferencia inválido para montar o ID da cobrança.");
  }
  return alunoId + "_" + mesReferencia;
}

// Valida um ID de cobrança RECEBIDO do cliente (ex.: o campo cobrancaId do upload de
// comprovante). É o inverso de derivarCobrancaId: corta no ÚLTIMO "_" (o alunoId pode
// conter "_") e confere as duas metades. Sem isso, "../../alunos/x" viraria caminho de
// documento no Firestore e uma barra levaria a escrita pra coleção arbitrária.
function cobrancaIdValido(v) {
  if (typeof v !== "string") return false;
  const corte = v.lastIndexOf("_");
  if (corte <= 0) return false;
  return alunoIdValido(v.slice(0, corte)) && mesReferenciaValido(v.slice(corte + 1));
}


function tenantIdValido(v) {
  return typeof v === "string" && /^[A-Za-z0-9_-]{2,64}$/.test(v);
}

function tenantSlugValido(v) {
  return typeof v === "string" && /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(v);
}

function tenantHostValido(v) {
  return typeof v === "string" && /^[a-z0-9.-]{3,253}$/.test(v) && !v.includes("..");
}

function tenantIdDoPayload(body) {
  const tenantId = body && typeof body === "object" ? body.tenantId : null;
  if (!tenantIdValido(tenantId)) throw new Error("tenantId inválido.");
  return tenantId;
}

function derivarCobrancaExternalReference(tenantId, alunoId, mesReferencia) {
  if (!tenantIdValido(tenantId)) throw new Error("tenantId inválido para externalReference.");
  return tenantId + ":" + derivarCobrancaId(alunoId, mesReferencia);
}

function separarCobrancaExternalReference(referencia, env) {
  if (typeof referencia !== "string") return null;
  let tenantId = env && typeof env.DEFAULT_TENANT_ID === "string" ? env.DEFAULT_TENANT_ID : "jairo";
  let bruto = referencia;
  const pos = referencia.indexOf(":");
  if (pos > 0) {
    tenantId = referencia.slice(0, pos);
    bruto = referencia.slice(pos + 1);
  }
  const corte = bruto.lastIndexOf("_");
  if (corte <= 0) return null;
  const alunoId = bruto.slice(0, corte);
  const mesReferencia = bruto.slice(corte + 1);
  if (!tenantIdValido(tenantId) || !alunoIdValido(alunoId) || !mesReferenciaValido(mesReferencia)) return null;
  return { tenantId, alunoId, mesReferencia, cobrancaId: derivarCobrancaId(alunoId, mesReferencia) };
}

// ---------------------------------------------------------------------------
// Validadores do cadastro de aluno feito PELO PROFESSOR (POST /criar-aluno).
//
// ATENÇÃO: estes limites são um espelho da função `dadosAlunoValidos` de
// firestore.rules (e das opções do <select> de app/cadastro.html). Qualquer divergência
// aqui cria, via service account (que passa por cima das rules), um documento de aluno
// que o PRÓPRIO ALUNO depois não consegue editar — o update dele é revalidado por
// dadosAlunoValidos e falha em silêncio pra sempre. Mudou lá, muda aqui.
// ---------------------------------------------------------------------------

// nome: string, 1..99 (rules: size() > 0 && size() < 100). alunoNomeValido aceita 100,
// então não serve — daí o validador próprio.
function nomeAlunoCadastroValido(v) {
  return typeof v === "string" && v.length > 0 && v.length < 100;
}

// telefone: string com size() < 30 nas rules. Pode ser vazio (as rules não exigem > 0).
function telefoneValido(v) {
  return typeof v === "string" && v.length < 30;
}

// nascimento: "YYYY-MM-DD" nas rules (só formato). Aqui é mais estrito: tem que ser uma
// data que existe de verdade, mesma checagem de dueDateValido.
function nascimentoValido(v) {
  if (typeof v !== "string" || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v)) return false;
  const data = new Date(v + "T00:00:00Z");
  if (Number.isNaN(data.getTime())) return false;
  return data.toISOString().slice(0, 10) === v;
}

// Lista EXATA de dadosAlunoValidos (firestore.rules) e do <select> de app/cadastro.html.
const FAIXAS_VALIDAS = [
  "Branca",
  "Cinza",
  "Amarela",
  "Laranja",
  "Verde",
  "Azul",
  "Roxa",
  "Marrom",
  "Preta"
];

function faixaValida(v) {
  return typeof v === "string" && FAIXAS_VALIDAS.includes(v);
}

// Senha inicial escolhida pelo professor. Mínimo 6 é o piso do Firebase Auth (abaixo
// disso o Identity Toolkit devolve WEAK_PASSWORD); o teto de 128 é sanitário.
// O VALOR nunca é logado em lugar nenhum — só o resultado booleano desta função.
function senhaInicialValida(v) {
  return typeof v === "string" && v.length >= 6 && v.length <= 128;
}

// ---------------------------------------------------------------------------
// Validadores do papel "professor" (POST /criar-professor e /gerenciar-professor).
// ---------------------------------------------------------------------------

// ID do documento da vitrine pública em equipe/{id} — gerado por .add() do SDK, então
// é um ID de documento do Firestore (20 chars alfanuméricos), não um UID do Auth.
// Mesma preocupação de alunoIdValido: o valor é concatenado num caminho de documento,
// então uma barra aqui levaria a leitura/escrita pra uma coleção arbitrária.
function equipeIdValido(v) {
  return typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v);
}

// Ações aceitas por POST /gerenciar-professor. Enum fechado: qualquer outro valor é 400.
function acaoProfessorValida(v) {
  return v === "promover" || v === "remover";
}


// Reexportado daqui pro index.js importar todas as validações de um lugar só.
export { cpfCnpjValido } from "./cpf.js";

export {
  alunoIdValido,
  mesReferenciaValido,
  valorValido,
  alunoNomeValido,
  emailValido,
  dueDateValido,
  derivarCobrancaId,
  cobrancaIdValido,
  nomeAlunoCadastroValido,
  telefoneValido,
  nascimentoValido,
  faixaValida,
  senhaInicialValida,
  equipeIdValido,
  acaoProfessorValida,
  FAIXAS_VALIDAS,
  tenantIdValido,
  tenantSlugValido,
  tenantHostValido,
  tenantIdDoPayload,
  derivarCobrancaExternalReference,
  separarCobrancaExternalReference
};
