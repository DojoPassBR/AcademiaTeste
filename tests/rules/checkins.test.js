import { beforeAll, afterAll, beforeEach, describe, it } from "vitest";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
import {
  criarAmbiente,
  semearAluno,
  checkinIdValido,
  DENTRO_DO_RAIO,
  FORA_DO_RAIO,
  JANELA_CHECKIN_MS
} from "./setup.js";

const ALUNO_UID = "aluno000000000000000001";
const OUTRO_UID = "aluno000000000000000002";

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

function checkinValido(extra = {}) {
  return {
    alunoId: ALUNO_UID,
    nome: "João da Silva",
    lat: DENTRO_DO_RAIO.lat,
    lng: DENTRO_DO_RAIO.lng,
    timestamp: serverTimestamp(),
    ...extra
  };
}

async function alunoPago() {
  await semearAluno(ambiente, ALUNO_UID, { mensalidadeStatus: "pago" });
  return ambiente.authenticatedContext(ALUNO_UID).firestore();
}

describe("checkins — create", () => {
  it("aceita check-in dentro do raio, com mensalidade paga e checkinId correto", async () => {
    const db = await alunoPago();
    await assertSucceeds(
      setDoc(doc(db, "checkins", checkinIdValido(ALUNO_UID)), checkinValido())
    );
  });

  it("recusa check-in fora do raio da escola", async () => {
    const db = await alunoPago();
    await assertFails(
      setDoc(
        doc(db, "checkins", checkinIdValido(ALUNO_UID)),
        checkinValido({ lat: FORA_DO_RAIO.lat, lng: FORA_DO_RAIO.lng })
      )
    );
  });

  it("recusa check-in de aluno com mensalidade pendente", async () => {
    await semearAluno(ambiente, ALUNO_UID); // sem mensalidadeStatus = pendente
    const db = ambiente.authenticatedContext(ALUNO_UID).firestore();
    await assertFails(
      setDoc(doc(db, "checkins", checkinIdValido(ALUNO_UID)), checkinValido())
    );
  });

  it("recusa check-in com alunoId diferente do usuário autenticado", async () => {
    await semearAluno(ambiente, OUTRO_UID, { mensalidadeStatus: "pago" });
    const db = await alunoPago();
    await assertFails(
      setDoc(
        doc(db, "checkins", checkinIdValido(ALUNO_UID)),
        checkinValido({ alunoId: OUTRO_UID })
      )
    );
  });

  it("recusa checkinId fora do padrão uid_janela (cooldown no servidor)", async () => {
    const db = await alunoPago();
    await assertFails(setDoc(doc(db, "checkins", "qualquer-id"), checkinValido()));
    await assertFails(setDoc(doc(db, "checkins", ALUNO_UID + "_0"), checkinValido()));
  });

  it("recusa checkinId de uma janela futura", async () => {
    const db = await alunoPago();
    const idFuturo = checkinIdValido(ALUNO_UID, Date.now() + JANELA_CHECKIN_MS);
    await assertFails(setDoc(doc(db, "checkins", idFuturo), checkinValido()));
  });

  it("recusa um segundo check-in na mesma janela (o doc já existe e update é negado)", async () => {
    const db = await alunoPago();
    const id = checkinIdValido(ALUNO_UID);
    await assertSucceeds(setDoc(doc(db, "checkins", id), checkinValido()));
    await assertFails(setDoc(doc(db, "checkins", id), checkinValido()));
  });

  it("recusa campo extra no check-in (hasOnly)", async () => {
    const db = await alunoPago();
    await assertFails(
      setDoc(
        doc(db, "checkins", checkinIdValido(ALUNO_UID)),
        checkinValido({ pontos: 10 })
      )
    );
  });

  it("recusa check-in sem um campo obrigatório (hasAll)", async () => {
    const db = await alunoPago();
    const dados = checkinValido();
    delete dados.nome;
    await assertFails(setDoc(doc(db, "checkins", checkinIdValido(ALUNO_UID)), dados));
  });

  it("recusa lat/lng que não são números", async () => {
    const db = await alunoPago();
    await assertFails(
      setDoc(
        doc(db, "checkins", checkinIdValido(ALUNO_UID)),
        checkinValido({ lat: String(DENTRO_DO_RAIO.lat) })
      )
    );
  });

  it("recusa timestamp forjado pelo cliente", async () => {
    const db = await alunoPago();
    await assertFails(
      setDoc(
        doc(db, "checkins", checkinIdValido(ALUNO_UID)),
        checkinValido({ timestamp: new Date(0) })
      )
    );
  });

  it("recusa check-in de usuário não autenticado", async () => {
    await semearAluno(ambiente, ALUNO_UID, { mensalidadeStatus: "pago" });
    const db = ambiente.unauthenticatedContext().firestore();
    await assertFails(
      setDoc(doc(db, "checkins", checkinIdValido(ALUNO_UID)), checkinValido())
    );
  });
});

describe("checkins — update e delete", () => {
  it("update e delete são sempre negados", async () => {
    const id = checkinIdValido(ALUNO_UID);
    const db = await alunoPago();
    await assertSucceeds(setDoc(doc(db, "checkins", id), checkinValido()));

    await assertFails(updateDoc(doc(db, "checkins", id), { lat: FORA_DO_RAIO.lat }));
    await assertFails(deleteDoc(doc(db, "checkins", id)));
  });
});
