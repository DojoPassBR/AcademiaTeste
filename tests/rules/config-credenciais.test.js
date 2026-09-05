// Firestore Rules — documento config/credenciais (Fase 5).
//
// Esse documento guarda a chave de API do Asaas do professor, CIFRADA (AES-GCM). Quem
// lê e escreve nele é SÓ o Worker, via service account, que não passa pelas rules.
// Nenhum cliente pode tocar nele — nem um admin.
//
// Estes testes existem porque a proteção depende de uma exclusão explícita dentro do
// match /config/{docId} (as rules são união permissiva: um bloco separado com
// `if false` NÃO cancelaria o `allow read: if isSignedIn()` do bloco genérico).
// Se alguém remover o `!ehDocCredenciais(docId)`, é aqui que quebra.

import { beforeAll, afterAll, beforeEach, describe, it } from "vitest";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, setDoc, getDoc, updateDoc, deleteDoc } from "firebase/firestore";
import { criarAmbiente, semear, semearAdmin } from "./setup.js";

const ALUNO_UID = "aluno000000000000000001";
const ADMIN_UID = "admin000000000000000001";

let ambiente;

beforeAll(async () => {
  ambiente = await criarAmbiente();
});

afterAll(async () => {
  await ambiente.cleanup();
});

beforeEach(async () => {
  await ambiente.clearFirestore();
});

// Semeia o documento como o Worker faria (ignorando as rules): só ciphertext, IV e
// metadados — a chave em texto plano nunca é gravada em lugar nenhum.
async function semearCredencial() {
  await semear(ambiente, async (db) => {
    await setDoc(doc(db, "config", "credenciais"), {
      asaasApiKeyCipher: "Y2lwaGVydGV4dC1kZS1tZW50aXJh",
      asaasApiKeyIv: "aXYtZmFsc28xMjM0",
      asaasApiKeyUltimos4: "1234",
      asaasAmbiente: "sandbox",
      atualizadoPorUid: ADMIN_UID,
      atualizadoEm: new Date()
    });
  });
}

describe("config/credenciais — invisível e intocável pelo cliente", () => {
  it("admin NÃO lê config/credenciais", async () => {
    await semearAdmin(ambiente, ADMIN_UID);
    await semearCredencial();

    const db = ambiente.authenticatedContext(ADMIN_UID).firestore();
    await assertFails(getDoc(doc(db, "config", "credenciais")));
  });

  it("admin NÃO escreve em config/credenciais (create, update nem delete)", async () => {
    await semearAdmin(ambiente, ADMIN_UID);
    const db = ambiente.authenticatedContext(ADMIN_UID).firestore();

    // create, com o documento ainda inexistente
    await assertFails(
      setDoc(doc(db, "config", "credenciais"), {
        asaasApiKeyCipher: "qualquer",
        asaasApiKeyIv: "qualquer",
        asaasAmbiente: "sandbox"
      })
    );

    // update e delete, com o documento já semeado pelo "Worker"
    await semearCredencial();
    await assertFails(updateDoc(doc(db, "config", "credenciais"), { asaasAmbiente: "producao" }));
    await assertFails(deleteDoc(doc(db, "config", "credenciais")));
  });

  it("aluno NÃO lê nem escreve config/credenciais", async () => {
    await semearCredencial();
    const db = ambiente.authenticatedContext(ALUNO_UID).firestore();

    await assertFails(getDoc(doc(db, "config", "credenciais")));
    await assertFails(
      setDoc(doc(db, "config", "credenciais"), { asaasApiKeyCipher: "roubado" })
    );
  });

  it("anônimo NÃO lê config/credenciais", async () => {
    await semearCredencial();
    const db = ambiente.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, "config", "credenciais")));
  });

  it("a exclusão não quebrou config/geral: admin ainda escreve e aluno ainda lê", async () => {
    await semearAdmin(ambiente, ADMIN_UID);
    const dbAdmin = ambiente.authenticatedContext(ADMIN_UID).firestore();
    await assertSucceeds(setDoc(doc(dbAdmin, "config", "geral"), { mensalidadeModo: "pix" }));

    const dbAluno = ambiente.authenticatedContext(ALUNO_UID).firestore();
    await assertSucceeds(getDoc(doc(dbAluno, "config", "geral")));
  });
});
