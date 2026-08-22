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

const SCHOOL_LAT = -23.58810289825024;
const SCHOOL_LNG = -48.067638301537485;
const CHECKIN_RADIUS_METERS = 150;
const CHECKIN_INTERVALO_MINUTOS = 90; // intervalo mínimo entre check-ins, pra evitar check-ins repetidos em sequência

// URL do Cloudflare Worker do módulo financeiro (gera cobrança Pix + recebe webhook do
// Mercado Pago) — vazia até esse cliente ativar cobrança automática. Com WORKER_URL vazia,
// o botão de gerar cobrança em admin.html mostra um erro amigável em vez de falhar sem
// explicação. Ver worker/ na raiz do repositório e config/geral.mensalidadeModo.
const WORKER_URL = "";

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
