// Configuração pública do Firebase (não é segredo — a segurança é feita pelas Firestore Rules)
const firebaseConfig = {
  apiKey: "AIzaSyB2CfAlsM7RkDd1xE0em6FlRMDjpmxODH0",
  authDomain: "academiateste-56922.firebaseapp.com",
  projectId: "academiateste-56922",
  storageBucket: "academiateste-56922.firebasestorage.app",
  messagingSenderId: "558847205725",
  appId: "1:558847205725:web:138a38a4c8f51b6ed508b4"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// TODO(security): ativar Firebase App Check com ReCaptchaV3Provider aqui quando houver
// uma site key de produção (Firebase Console > App Check > registrar o app web com
// reCAPTCHA v3, e ativar enforcement em Firestore). Sem App Check, qualquer um com a
// apiKey pública consegue falar com o Firestore direto — as Firestore Rules continuam
// sendo a única barreira de autorização. Falta: (1) criar a site key reCAPTCHA v3 no
// Google, (2) registrá-la no App Check, (3) chamar firebase.appCheck().activate(...)
// logo depois do initializeApp acima, (4) ligar enforcement (começar em modo monitor).

// Coordenadas/raio da escola. Estes valores são replicados em firestore.rules (função
// dentroDoRaioDaEscola) e o CI compara os dois lados via scripts/check-geo-drift.mjs —
// os marcadores GEO-SYNC abaixo são o que o script parseia. Mudou aqui, muda lá.
// GEO-SYNC: SCHOOL_LAT = -23.58810289825024
const SCHOOL_LAT = -23.58810289825024;
// GEO-SYNC: SCHOOL_LNG = -48.067638301537485
const SCHOOL_LNG = -48.067638301537485;
// GEO-SYNC: CHECKIN_RADIUS_METERS = 150
const CHECKIN_RADIUS_METERS = 150;
// Intervalo mínimo entre check-ins, pra evitar check-ins repetidos em sequência.
// Vira o divisor da janela do checkinId (90 * 60 * 1000 = 5400000 ms), e a rule
// checkinIdValido em firestore.rules usa exatamente esse mesmo número.
// GEO-SYNC: CHECKIN_INTERVALO_MINUTOS = 90
const CHECKIN_INTERVALO_MINUTOS = 90;
// GEO-SYNC: CHECKIN_JANELA_MS = 5400000
const CHECKIN_JANELA_MS = CHECKIN_INTERVALO_MINUTOS * 60 * 1000;

// URL do Cloudflare Worker do módulo financeiro (gera cobrança Pix + recebe webhook do
// Asaas). Ver worker/ na raiz do repositório e config/geral.mensalidadeModo (o modo "pix"
// precisa estar ativo em config/geral pro botão de cobrança aparecer em admin.html).
const WORKER_URL = "https://academiateste-financeiro.arnaldohungria.workers.dev";

function distanceToSchoolMeters(lat, lng) {
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos(SCHOOL_LAT * Math.PI / 180);
  const dLat = (lat - SCHOOL_LAT) * metersPerDegLat;
  const dLng = (lng - SCHOOL_LNG) * metersPerDegLng;
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

function formatDateTime(timestamp) {
  if (!timestamp) return "-";
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

// Quantos dias inteiros já se passaram desde um Firestore Timestamp (ou Date/número).
// Devolve null quando não há data (ex.: aluno que nunca teve a mensalidade marcada) —
// quem chama decide o texto pra esse caso. Nunca devolve negativo: data futura = 0.
function diasDesde(timestamp) {
  if (timestamp === null || timestamp === undefined) return null;
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  const ms = date.getTime();
  if (!isFinite(ms)) return null;
  const diff = Date.now() - ms;
  if (diff <= 0) return 0;
  return Math.floor(diff / 86400000);
}

// Monta o link wa.me a partir de um telefone digitado à mão no cadastro (pode vir com
// parênteses, traço, espaço, +55...). Heurística de DDI: 10-11 dígitos = número BR sem
// DDI, então prefixa "55"; 12-13 dígitos = já veio com DDI, usa como está. Fora dessa
// faixa devolve null — melhor não abrir link nenhum do que abrir um link quebrado.
function montarLinkWhatsapp(telefone, texto) {
  if (typeof telefone !== "string" && typeof telefone !== "number") return null;
  const digitos = String(telefone).replace(/\D/g, "");
  let numero;
  if (digitos.length === 10 || digitos.length === 11) {
    numero = "55" + digitos;
  } else if (digitos.length === 12 || digitos.length === 13) {
    numero = digitos;
  } else {
    return null;
  }
  return "https://wa.me/" + numero + "?text=" + encodeURIComponent(texto === undefined || texto === null ? "" : String(texto));
}

// Substitui os placeholders {nome} {mes} {valor} {academia} {pix} do texto configurado
// em config/geral.lembreteTemplate. Placeholder sem valor correspondente vira string
// vazia (nunca deixa "{pix}" cru aparecer na mensagem enviada ao aluno).
const PLACEHOLDERS_LEMBRETE = ["nome", "mes", "valor", "academia", "pix"];

function preencherTemplate(template, dados) {
  if (typeof template !== "string") return "";
  const valores = dados && typeof dados === "object" ? dados : {};
  let saida = template;
  PLACEHOLDERS_LEMBRETE.forEach((chave) => {
    const bruto = valores[chave];
    const valor = bruto === undefined || bruto === null ? "" : String(bruto);
    saida = saida.split("{" + chave + "}").join(valor);
  });
  return saida;
}
