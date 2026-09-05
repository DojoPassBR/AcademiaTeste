import { beforeAll, afterAll, beforeEach, describe, it } from "vitest";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
import { criarAmbiente, semearAluno, semearAdmin, ALUNO_VALIDO } from "./setup.js";

const ALUNO_UID = "aluno000000000000000001";
const OUTRO_UID = "aluno000000000000000002";
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

function comoAluno(uid = ALUNO_UID) {
  return ambiente.authenticatedContext(uid).firestore();
}

describe("alunos — create (cadastro do próprio aluno)", () => {
  it("aceita um cadastro válido do próprio usuário", async () => {
    const db = comoAluno();
    await assertSucceeds(
      setDoc(doc(db, "alunos", ALUNO_UID), { ...ALUNO_VALIDO, criadoEm: serverTimestamp() })
    );
  });

  it("aceita cadastro sem criadoEm (campo opcional)", async () => {
    const db = comoAluno();
    await assertSucceeds(setDoc(doc(db, "alunos", ALUNO_UID), { ...ALUNO_VALIDO }));
  });

  it("recusa cadastro em documento de outro usuário", async () => {
    const db = comoAluno();
    await assertFails(setDoc(doc(db, "alunos", OUTRO_UID), { ...ALUNO_VALIDO }));
  });

  it("recusa cadastro que já traz mensalidadeStatus", async () => {
    const db = comoAluno();
    await assertFails(
      setDoc(doc(db, "alunos", ALUNO_UID), { ...ALUNO_VALIDO, mensalidadeStatus: "pago" })
    );
  });

  it("recusa cadastro com campo extra (hasOnly)", async () => {
    const db = comoAluno();
    await assertFails(
      setDoc(doc(db, "alunos", ALUNO_UID), { ...ALUNO_VALIDO, admin: true })
    );
  });

  it("recusa cadastro sem um campo obrigatório (hasAll)", async () => {
    const db = comoAluno();
    const { faixa, ...semFaixa } = ALUNO_VALIDO;
    await assertFails(setDoc(doc(db, "alunos", ALUNO_UID), semFaixa));
  });

  it("recusa e-mail em formato inválido", async () => {
    const db = comoAluno();
    await assertFails(
      setDoc(doc(db, "alunos", ALUNO_UID), { ...ALUNO_VALIDO, email: "joao-arroba-example" })
    );
  });

  it("recusa nascimento fora do formato YYYY-MM-DD", async () => {
    const db = comoAluno();
    await assertFails(
      setDoc(doc(db, "alunos", ALUNO_UID), { ...ALUNO_VALIDO, nascimento: "14/03/1995" })
    );
  });

  it("recusa faixa fora da lista", async () => {
    const db = comoAluno();
    await assertFails(
      setDoc(doc(db, "alunos", ALUNO_UID), { ...ALUNO_VALIDO, faixa: "Dourada" })
    );
  });

  it("recusa criadoEm que não é o timestamp do servidor", async () => {
    const db = comoAluno();
    await assertFails(
      setDoc(doc(db, "alunos", ALUNO_UID), { ...ALUNO_VALIDO, criadoEm: new Date(0) })
    );
  });
});

describe("alunos — update", () => {
  it("aluno edita os próprios dados de cadastro", async () => {
    await semearAluno(ambiente, ALUNO_UID);
    const db = comoAluno();
    await assertSucceeds(updateDoc(doc(db, "alunos", ALUNO_UID), { telefone: "15988887777" }));
  });

  it("aluno NÃO consegue mudar a própria mensalidade", async () => {
    await semearAluno(ambiente, ALUNO_UID);
    const db = comoAluno();
    await assertFails(updateDoc(doc(db, "alunos", ALUNO_UID), { mensalidadeStatus: "pago" }));
  });

  it("admin NÃO consegue editar nome ou faixa do aluno", async () => {
    await semearAluno(ambiente, ALUNO_UID);
    await semearAdmin(ambiente, ADMIN_UID);
    const db = ambiente.authenticatedContext(ADMIN_UID).firestore();
    await assertFails(updateDoc(doc(db, "alunos", ALUNO_UID), { nome: "Outro Nome" }));
    await assertFails(updateDoc(doc(db, "alunos", ALUNO_UID), { faixa: "Preta" }));
  });

  it("admin marca mensalidadeStatus como pago com carimbo do servidor", async () => {
    await semearAluno(ambiente, ALUNO_UID);
    await semearAdmin(ambiente, ADMIN_UID);
    const db = ambiente.authenticatedContext(ADMIN_UID).firestore();
    await assertSucceeds(
      updateDoc(doc(db, "alunos", ALUNO_UID), {
        mensalidadeStatus: "pago",
        mensalidadeAtualizadoEm: serverTimestamp()
      })
    );
  });

  it("admin recebe recusa com mensalidadeStatus fora do enum", async () => {
    await semearAluno(ambiente, ALUNO_UID);
    await semearAdmin(ambiente, ADMIN_UID);
    const db = ambiente.authenticatedContext(ADMIN_UID).firestore();
    await assertFails(
      updateDoc(doc(db, "alunos", ALUNO_UID), {
        mensalidadeStatus: "isento",
        mensalidadeAtualizadoEm: serverTimestamp()
      })
    );
  });

  it("admin recebe recusa sem mensalidadeAtualizadoEm do servidor", async () => {
    await semearAluno(ambiente, ALUNO_UID);
    await semearAdmin(ambiente, ADMIN_UID);
    const db = ambiente.authenticatedContext(ADMIN_UID).firestore();
    await assertFails(updateDoc(doc(db, "alunos", ALUNO_UID), { mensalidadeStatus: "pago" }));
    await assertFails(
      updateDoc(doc(db, "alunos", ALUNO_UID), {
        mensalidadeStatus: "pago",
        mensalidadeAtualizadoEm: new Date(0)
      })
    );
  });

  it("usuário comum não edita o cadastro de outro aluno", async () => {
    await semearAluno(ambiente, OUTRO_UID);
    const db = comoAluno();
    await assertFails(updateDoc(doc(db, "alunos", OUTRO_UID), { telefone: "15911112222" }));
  });
});

describe("alunos — delete", () => {
  it("delete é sempre negado, inclusive pro admin", async () => {
    await semearAluno(ambiente, ALUNO_UID);
    await semearAdmin(ambiente, ADMIN_UID);

    const dbAluno = comoAluno();
    await assertFails(deleteDoc(doc(dbAluno, "alunos", ALUNO_UID)));

    const dbAdmin = ambiente.authenticatedContext(ADMIN_UID).firestore();
    await assertFails(deleteDoc(doc(dbAdmin, "alunos", ALUNO_UID)));
  });
});

// asaasCustomerId / customerCriadoEm são escritos SÓ pelo Worker (service account, que
// passa por cima das rules). Nenhum dos hasOnly de alunos lista esses campos — estes
// testes travam esse contrato pra ninguém afrouxar as listas sem perceber.
describe("alunos — campos do Asaas só o Worker escreve", () => {
  it("aluno não grava asaasCustomerId no próprio documento", async () => {
    await semearAluno(ambiente, ALUNO_UID);
    const db = comoAluno();
    await assertFails(updateDoc(doc(db, "alunos", ALUNO_UID), { asaasCustomerId: "cus_forjado" }));
  });

  it("aluno não traz asaasCustomerId já no cadastro", async () => {
    const db = comoAluno();
    await assertFails(
      setDoc(doc(db, "alunos", ALUNO_UID), { ...ALUNO_VALIDO, asaasCustomerId: "cus_forjado" })
    );
  });

  it("admin também não grava asaasCustomerId nem customerCriadoEm", async () => {
    await semearAluno(ambiente, ALUNO_UID);
    await semearAdmin(ambiente, ADMIN_UID);
    const db = ambiente.authenticatedContext(ADMIN_UID).firestore();
    await assertFails(updateDoc(doc(db, "alunos", ALUNO_UID), { asaasCustomerId: "cus_forjado" }));
    await assertFails(
      updateDoc(doc(db, "alunos", ALUNO_UID), { customerCriadoEm: serverTimestamp() })
    );
  });
});

// criadoPorAdmin / criadoPorUid são o RASTRO de que o cadastro veio do endpoint
// POST /criar-aluno do Worker (service account). Se um cliente conseguisse escrevê-los,
// o rastro deixaria de valer como auditoria: qualquer aluno poderia se declarar
// "cadastrado pelo professor fulano". Nenhum hasOnly de /alunos lista esses campos —
// estes testes travam esse contrato.
describe("alunos — carimbo de cadastro pelo admin só o Worker escreve", () => {
  it("aluno não traz criadoPorAdmin/criadoPorUid já no cadastro", async () => {
    const db = comoAluno();
    await assertFails(
      setDoc(doc(db, "alunos", ALUNO_UID), { ...ALUNO_VALIDO, criadoPorAdmin: true })
    );
    await assertFails(
      setDoc(doc(db, "alunos", ALUNO_UID), { ...ALUNO_VALIDO, criadoPorUid: ADMIN_UID })
    );
  });

  it("aluno não grava criadoPorAdmin/criadoPorUid por update", async () => {
    await semearAluno(ambiente, ALUNO_UID);
    const db = comoAluno();
    await assertFails(updateDoc(doc(db, "alunos", ALUNO_UID), { criadoPorAdmin: true }));
    await assertFails(updateDoc(doc(db, "alunos", ALUNO_UID), { criadoPorUid: ADMIN_UID }));
  });

  it("admin não grava criadoPorAdmin/criadoPorUid (nem no próprio create de outro uid)", async () => {
    await semearAluno(ambiente, ALUNO_UID);
    await semearAdmin(ambiente, ADMIN_UID);
    const db = ambiente.authenticatedContext(ADMIN_UID).firestore();

    await assertFails(updateDoc(doc(db, "alunos", ALUNO_UID), { criadoPorAdmin: true }));
    await assertFails(updateDoc(doc(db, "alunos", ALUNO_UID), { criadoPorUid: ADMIN_UID }));

    // E o admin também não cria o documento de outro aluno — esse caminho é exclusivo do
    // Worker (POST /criar-aluno).
    await assertFails(
      setDoc(doc(db, "alunos", OUTRO_UID), {
        ...ALUNO_VALIDO,
        criadoPorAdmin: true,
        criadoPorUid: ADMIN_UID
      })
    );
  });
});
