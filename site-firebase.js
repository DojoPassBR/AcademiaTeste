// ============================================================
// site-firebase.js — inicialização do Firebase para o SITE INSTITUCIONAL PÚBLICO
// (index.html na raiz). NÃO é o mesmo arquivo de app/firebase-init.js: aqui não
// existe autenticação nenhuma. O site nunca loga ninguém, só LÊ as quatro coleções
// públicas (turmas, equipe, horarios, academia/perfil), que têm `allow read: if true`
// em firestore.rules. Por isso este arquivo NUNCA chama firebase.auth() — carregar o
// SDK de auth na home seria peso e superfície de ataque sem nenhum ganho.
//
// A config abaixo é DUPLICADA de app/firebase-init.js de propósito (o app e o site
// são dois bundles independentes, sem build step). Os marcadores FIREBASE-CONFIG-SYNC
// seguem o mesmo espírito dos GEO-SYNC já usados no projeto: marcam uma duplicação
// consciente, pra quem mudar de um lado saber que precisa mudar do outro.
// Mudou em app/firebase-init.js, muda aqui.
//
// Estes valores não são segredo: a apiKey do Firebase Web é pública por design e a
// segurança de verdade está nas Firestore Rules.
// ============================================================

// FIREBASE-CONFIG-SYNC: início (espelha firebaseConfig de app/firebase-init.js)
var firebaseConfigPublico = {
  // FIREBASE-CONFIG-SYNC: apiKey = AIzaSyB2CfAlsM7RkDd1xE0em6FlRMDjpmxODH0
  apiKey: "AIzaSyB2CfAlsM7RkDd1xE0em6FlRMDjpmxODH0",
  // FIREBASE-CONFIG-SYNC: authDomain = academiateste-56922.firebaseapp.com
  authDomain: "academiateste-56922.firebaseapp.com",
  // FIREBASE-CONFIG-SYNC: projectId = academiateste-56922
  projectId: "academiateste-56922",
  // FIREBASE-CONFIG-SYNC: storageBucket = academiateste-56922.firebasestorage.app
  storageBucket: "academiateste-56922.firebasestorage.app",
  // FIREBASE-CONFIG-SYNC: messagingSenderId = 558847205725
  messagingSenderId: "558847205725",
  // FIREBASE-CONFIG-SYNC: appId = 1:558847205725:web:138a38a4c8f51b6ed508b4
  appId: "1:558847205725:web:138a38a4c8f51b6ed508b4"
};
// FIREBASE-CONFIG-SYNC: fim

// Fica null se o SDK não carregou (offline, CDN bloqueada, bloqueador de scripts).
// site-publico.js checa isso e simplesmente não mexe no HTML — o conteúdo estático
// de fallback continua na tela.
var dbPublico = null;

try {
  if (typeof firebase !== "undefined" && typeof firebase.initializeApp === "function") {
    firebase.initializeApp(firebaseConfigPublico);
    dbPublico = firebase.firestore();
    window.dbPublico = dbPublico;
  }
} catch (erro) {
  // Nunca deixar um erro de inicialização quebrar a home. O site é estático primeiro.
  dbPublico = null;
  window.dbPublico = dbPublico;
  if (typeof console !== "undefined" && console.warn) {
    console.warn("[site] Firebase não inicializou; mantendo conteúdo estático.", erro);
  }
}
