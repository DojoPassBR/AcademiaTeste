import { beforeAll, afterAll, beforeEach, describe, it } from "vitest";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import {
  doc,
  collection,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  serverTimestamp,
  deleteField
} from "firebase/firestore";
import { criarAmbiente, semear, semearAdmin } from "./setup.js";

const ALUNO_UID = "aluno000000000000000001";
const ADMIN_UID = "admin000000000000000001";
const OUTRO_ADMIN_UID = "admin000000000000000002";

const EVENTO_ID = "evento000000000000000001";

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

function comoAdmin(uid = ADMIN_UID) {
  return ambiente.authenticatedContext(uid).firestore();
}

function comoAluno(uid = ALUNO_UID) {
  return ambiente.authenticatedContext(uid).firestore();
}

// Campos editáveis de um evento válido — criadoPor/criadoEm entram por fora porque
// dependem do contexto (uid de quem cria e o carimbo do servidor).
const EVENTO_BASE = {
  nome: "Campeonato Paulista",
  data: "2026-11-20",
  local: "Ginásio Municipal - Itapetininga/SP"
};

function eventoNovo(extra = {}, uid = ADMIN_UID) {
  return {
    ...EVENTO_BASE,
    criadoPor: uid,
    criadoEm: serverTimestamp(),
    ...extra
  };
}

// Semeia um evento já existente ignorando as rules, pro estado inicial dos testes
// de update/delete.
async function semearEvento(extra = {}) {
  await semear(ambiente, async (db) => {
    await setDoc(doc(db, "eventos", EVENTO_ID), {
      ...EVENTO_BASE,
      criadoPor: ADMIN_UID,
      criadoEm: new Date("2026-09-01T12:00:00Z"),
      ...extra
    });
  });
}

describe("eventos — read", () => {
  it("aluno autenticado lê a coleção", async () => {
    await semearEvento();
    const db = comoAluno();
    await assertSucceeds(getDocs(collection(db, "eventos")));
  });

  it("usuário não autenticado não lê", async () => {
    await semearEvento();
    const db = ambiente.unauthenticatedContext().firestore();
    await assertFails(getDocs(collection(db, "eventos")));
  });
});

describe("eventos — create", () => {
  it("admin cria evento válido com link", async () => {
    await semearAdmin(ambiente, ADMIN_UID);
    const db = comoAdmin();
    await assertSucceeds(
      addDoc(collection(db, "eventos"), eventoNovo({ link: "https://exemplo.com/inscricao" }))
    );
  });

  it("admin cria evento válido sem link", async () => {
    await semearAdmin(ambiente, ADMIN_UID);
    const db = comoAdmin();
    await assertSucceeds(addDoc(collection(db, "eventos"), eventoNovo()));
  });

  it("recusa create com campo extra (hasOnly)", async () => {
    await semearAdmin(ambiente, ADMIN_UID);
    const db = comoAdmin();
    await assertFails(
      addDoc(collection(db, "eventos"), eventoNovo({ destaque: true }))
    );
  });

  it("recusa create sem 'local' (hasAll)", async () => {
    await semearAdmin(ambiente, ADMIN_UID);
    const db = comoAdmin();
    const { local, ...semLocal } = eventoNovo();
    await assertFails(addDoc(collection(db, "eventos"), semLocal));
  });

  it("recusa data fora do formato YYYY-MM-DD", async () => {
    await semearAdmin(ambiente, ADMIN_UID);
    const db = comoAdmin();
    await assertFails(addDoc(collection(db, "eventos"), eventoNovo({ data: "02/09/2026" })));
  });

  it("recusa link que não é https", async () => {
    await semearAdmin(ambiente, ADMIN_UID);
    const db = comoAdmin();
    await assertFails(
      addDoc(collection(db, "eventos"), eventoNovo({ link: "http://exemplo.com" }))
    );
    await assertFails(
      addDoc(collection(db, "eventos"), eventoNovo({ link: "javascript:alert(1)" }))
    );
  });

  it("recusa criadoPor apontando pra outro uid", async () => {
    await semearAdmin(ambiente, ADMIN_UID);
    await semearAdmin(ambiente, OUTRO_ADMIN_UID);
    const db = comoAdmin();
    await assertFails(
      addDoc(collection(db, "eventos"), eventoNovo({ criadoPor: OUTRO_ADMIN_UID }))
    );
  });

  it("recusa criadoEm que não é o timestamp do servidor", async () => {
    await semearAdmin(ambiente, ADMIN_UID);
    const db = comoAdmin();
    await assertFails(
      addDoc(collection(db, "eventos"), eventoNovo({ criadoEm: new Date(0) }))
    );
  });

  it("aluno autenticado (não-admin) não cria evento", async () => {
    const db = comoAluno();
    await assertFails(addDoc(collection(db, "eventos"), eventoNovo({}, ALUNO_UID)));
  });
});

describe("eventos — update", () => {
  it("admin atualiza nome, data, local e link", async () => {
    await semearEvento();
    await semearAdmin(ambiente, ADMIN_UID);
    const db = comoAdmin();
    await assertSucceeds(
      updateDoc(doc(db, "eventos", EVENTO_ID), {
        nome: "Campeonato Paulista - Etapa 2",
        data: "2026-12-05",
        local: "Ginásio do Ibirapuera - São Paulo/SP",
        link: "https://exemplo.com/etapa2",
        atualizadoEm: serverTimestamp()
      })
    );
  });

  it("recusa update que tenta alterar criadoPor ou criadoEm", async () => {
    await semearEvento();
    await semearAdmin(ambiente, ADMIN_UID);
    const db = comoAdmin();

    await assertFails(
      updateDoc(doc(db, "eventos", EVENTO_ID), {
        criadoPor: OUTRO_ADMIN_UID,
        atualizadoEm: serverTimestamp()
      })
    );

    await assertFails(
      updateDoc(doc(db, "eventos", EVENTO_ID), {
        criadoEm: serverTimestamp(),
        atualizadoEm: serverTimestamp()
      })
    );
  });

  it("admin remove o link do evento (FieldValue.delete)", async () => {
    await semearEvento({ link: "https://exemplo.com/inscricao" });
    await semearAdmin(ambiente, ADMIN_UID);
    const db = comoAdmin();
    await assertSucceeds(
      updateDoc(doc(db, "eventos", EVENTO_ID), {
        link: deleteField(),
        atualizadoEm: serverTimestamp()
      })
    );
  });

  it("recusa update sem o carimbo atualizadoEm do servidor", async () => {
    await semearEvento();
    await semearAdmin(ambiente, ADMIN_UID);
    const db = comoAdmin();
    await assertFails(updateDoc(doc(db, "eventos", EVENTO_ID), { nome: "Sem carimbo" }));
  });

  it("aluno não atualiza evento", async () => {
    await semearEvento();
    const db = comoAluno();
    await assertFails(
      updateDoc(doc(db, "eventos", EVENTO_ID), {
        nome: "Invadido",
        atualizadoEm: serverTimestamp()
      })
    );
  });
});

describe("eventos — delete", () => {
  it("admin apaga um evento", async () => {
    await semearEvento();
    await semearAdmin(ambiente, ADMIN_UID);
    const db = comoAdmin();
    await assertSucceeds(deleteDoc(doc(db, "eventos", EVENTO_ID)));
  });

  it("aluno não apaga evento", async () => {
    await semearEvento();
    const db = comoAluno();
    await assertFails(deleteDoc(doc(db, "eventos", EVENTO_ID)));
  });
});
