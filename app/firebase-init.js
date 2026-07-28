// TODO: substituir pela config do NOVO projeto Firebase deste teste (não usar o do app em produção).
// Console: https://console.firebase.google.com > Configurações do projeto > Seus apps > Web
const firebaseConfig = {
  apiKey: "SUBSTITUA_AQUI",
  authDomain: "SUBSTITUA_AQUI.firebaseapp.com",
  projectId: "SUBSTITUA_AQUI",
  storageBucket: "SUBSTITUA_AQUI.firebasestorage.app",
  messagingSenderId: "SUBSTITUA_AQUI",
  appId: "SUBSTITUA_AQUI"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

const SCHOOL_LAT = -23.5872555;
const SCHOOL_LNG = -48.0212186;
const CHECKIN_RADIUS_METERS = 150;

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
