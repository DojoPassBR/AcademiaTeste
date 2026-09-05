// Helpers compartilhados pelos testes das Firestore Rules.
//
// Rodam contra o emulador do Firestore (firebase emulators:exec, ver tests/package.json).
// O emulador carrega o firestore.rules real da raiz do repositório — nenhuma cópia,
// pra nunca testar uma versão diferente da que vai pra produção.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, "..", "..");

export const PROJECT_ID = "academiateste-tests";

// Mesmas coordenadas de firestore.rules / app/firebase-init.js.
export const SCHOOL_LAT = -23.58810289825024;
export const SCHOOL_LNG = -48.067638301537485;

// ~11m ao norte da escola: bem dentro do raio de 150m.
export const DENTRO_DO_RAIO = { lat: SCHOOL_LAT + 0.0001, lng: SCHOOL_LNG };
// +0.01 grau de latitude ≈ 1,1km: claramente fora dos 150m.
export const FORA_DO_RAIO = { lat: SCHOOL_LAT + 0.01, lng: SCHOOL_LNG };

// Tem que ser igual ao divisor de checkinIdValido em firestore.rules
// e ao CHECKIN_JANELA_MS de app/firebase-init.js.
export const JANELA_CHECKIN_MS = 5400000;

export function checkinIdValido(uid, agoraMs = Date.now()) {
  return uid + "_" + Math.floor(agoraMs / JANELA_CHECKIN_MS);
}

export async function criarAmbiente() {
  return initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(join(RAIZ, "firestore.rules"), "utf8"),
      host: "127.0.0.1",
      port: 8080
    }
  });
}

export const ALUNO_VALIDO = {
  nome: "João da Silva",
  telefone: "15999990000",
  nascimento: "1995-03-14",
  faixa: "Azul",
  email: "joao@example.com"
};

// Semeia dados ignorando as rules (é assim que se monta o estado inicial de um teste:
// um admin de verdade só existe se alguém criar pelo Console, e um aluno "pago" só
// existe depois de um admin marcar).
export async function semear(ambiente, escrever) {
  await ambiente.withSecurityRulesDisabled(async (contexto) => {
    await escrever(contexto.firestore());
  });
}

export async function semearAluno(ambiente, uid, dados = {}) {
  const { doc, setDoc } = await import("firebase/firestore");
  await semear(ambiente, async (db) => {
    await setDoc(doc(db, "alunos", uid), { ...ALUNO_VALIDO, ...dados });
  });
}

export async function semearAdmin(ambiente, uid) {
  const { doc, setDoc } = await import("firebase/firestore");
  await semear(ambiente, async (db) => {
    await setDoc(doc(db, "admins", uid), { criadoEm: new Date() });
  });
}
