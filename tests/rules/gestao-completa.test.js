import { describe, it, beforeAll, beforeEach, afterAll } from "vitest";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
  limit,
  setDoc,
  updateDoc,
  addDoc,
  serverTimestamp
} from "firebase/firestore";
import { criarAmbiente, semear, ALUNO_VALIDO } from "./setup.js";

const TENANT = "jairo";
const ADMIN = "admin000000000000000001";
const ALUNO = "aluno000000000000000001";
const PROF = "prof0000000000000000001";

let ambiente;

function dbAuth(uid) {
  return ambiente.authenticatedContext(uid).firestore();
}

async function semearBase() {
  await semear(ambiente, async (db) => {
    await setDoc(doc(db, "tenants", TENANT), { tenantSlug: TENANT, status: "ativo" });
    await setDoc(doc(db, "tenants", TENANT, "memberships", ADMIN), { role: "admin", status: "ativo" });
    await setDoc(doc(db, "tenants", TENANT, "memberships", ALUNO), { role: "aluno", status: "ativo" });
    await setDoc(doc(db, "tenants", TENANT, "memberships", PROF), { role: "professor", status: "ativo" });
    await setDoc(doc(db, "tenants", TENANT, "professores", PROF), { nome: "Prof", status: "ativo" });
    await setDoc(doc(db, "tenants", TENANT, "alunos", ALUNO), {
      ...ALUNO_VALIDO,
      mensalidadeStatus: "pago"
    });
    await setDoc(doc(db, "tenants", TENANT, "parceiros", "parceiro1"), {
      nome: "Empresa",
      percentual: 10,
      status: "ativo",
      criadoPor: ADMIN,
      criadoEm: new Date()
    });
    await setDoc(doc(db, "tenants", TENANT, "ranking", "2026-09", "alunos", ALUNO), {
      nomePublico: "João",
      pontos: 30,
      totalCheckins: 3
    });
    await setDoc(doc(db, "tenants", TENANT, "disparos", "disp1"), {
      canal: "whatsapp-link",
      filtro: "todos",
      totalDestinatarios: 1,
      status: "links_gerados"
    });
  });
}

beforeAll(async () => {
  ambiente = await criarAmbiente();
});

beforeEach(async () => {
  await ambiente.clearFirestore();
  await semearBase();
});

afterAll(async () => {
  await ambiente.cleanup();
});

describe("gestão completa — campos administrativos do aluno", () => {
  it("admin atualiza graduação, parceiro, bolsa, valor e kids; aluno não altera esses campos", async () => {
    const dbAdmin = dbAuth(ADMIN);
    const dbAluno = dbAuth(ALUNO);
    const ref = doc(dbAdmin, "tenants", TENANT, "alunos", ALUNO);

    await assertSucceeds(updateDoc(ref, {
      grau: 2,
      grauAtualizadoEm: serverTimestamp(),
      ultimaGraduacaoEm: serverTimestamp(),
      bolsa: true,
      parceiroId: "parceiro1",
      valorMensalidade: 120,
      kids: true,
      responsaveis: [{ nome: "Responsável", telefone: "15999990000", parentesco: "mãe" }],
      adminAtualizadoEm: serverTimestamp()
    }));

    await assertFails(updateDoc(doc(dbAluno, "tenants", TENANT, "alunos", ALUNO), {
      grau: 4,
      adminAtualizadoEm: serverTimestamp()
    }));
  });

  it("professor lê aluno por professorIds e não lista alunos sem vínculo", async () => {
    await semear(ambiente, async (db) => {
      await updateDoc(doc(db, "tenants", TENANT, "alunos", ALUNO), { professorIds: [PROF] });
    });
    const dbProf = dbAuth(PROF);
    await assertSucceeds(getDocs(query(
      collection(dbProf, "tenants", TENANT, "alunos"),
      where("professorIds", "array-contains", PROF)
    )));
    await assertFails(getDocs(collection(dbProf, "tenants", TENANT, "alunos")));
  });
});

describe("gestão completa — coleções novas", () => {
  it("admin gerencia parceiros; aluno não lê parceiros", async () => {
    const dbAdmin = dbAuth(ADMIN);
    const dbAluno = dbAuth(ALUNO);
    await assertSucceeds(addDoc(collection(dbAdmin, "tenants", TENANT, "parceiros"), {
      nome: "Novo parceiro",
      percentual: 15,
      status: "ativo",
      criadoPor: ADMIN,
      criadoEm: serverTimestamp()
    }));
    await assertFails(getDoc(doc(dbAluno, "tenants", TENANT, "parceiros", "parceiro1")));
  });

  it("admin cria agendamento e aluno lê apenas quando está marcado", async () => {
    const dbAdmin = dbAuth(ADMIN);
    const dbAluno = dbAuth(ALUNO);
    const inicio = new Date("2026-09-20T12:00:00Z");
    const fim = new Date("2026-09-20T13:00:00Z");
    const agendamento = await assertSucceeds(addDoc(collection(dbAdmin, "tenants", TENANT, "agendamentos"), {
      titulo: "Aulão",
      tipo: "aula",
      dataInicio: inicio,
      dataFim: fim,
      status: "ativo",
      alunoIds: [ALUNO],
      capacidade: 2,
      criadoPor: ADMIN,
      criadoEm: serverTimestamp()
    }));
    await assertSucceeds(getDoc(doc(dbAluno, "tenants", TENANT, "agendamentos", agendamento.id)));
    await assertSucceeds(getDocs(query(
      collection(dbAluno, "tenants", TENANT, "agendamentos"),
      where("alunoIds", "array-contains", ALUNO),
      where("status", "==", "ativo"),
      limit(10)
    )));
    await assertFails(getDocs(collection(dbAluno, "tenants", TENANT, "agendamentos")));
    await assertFails(addDoc(collection(dbAluno, "tenants", TENANT, "agendamentos"), {
      titulo: "Forjado",
      tipo: "aula",
      dataInicio: inicio,
      dataFim: fim,
      status: "ativo",
      criadoPor: ALUNO,
      criadoEm: serverTimestamp()
    }));
    await assertFails(addDoc(collection(dbAdmin, "tenants", TENANT, "agendamentos"), {
      titulo: "Lotado",
      tipo: "aula",
      dataInicio: inicio,
      dataFim: fim,
      status: "ativo",
      alunoIds: [ALUNO, "outro"],
      capacidade: 1,
      criadoPor: ADMIN,
      criadoEm: serverTimestamp()
    }));
  });

  it("ranking é legível por aluno, mas ninguém escreve pelo cliente; disparos só admin lê", async () => {
    const dbAdmin = dbAuth(ADMIN);
    const dbAluno = dbAuth(ALUNO);
    await assertSucceeds(getDoc(doc(dbAluno, "tenants", TENANT, "ranking", "2026-09", "alunos", ALUNO)));
    await assertFails(setDoc(doc(dbAdmin, "tenants", TENANT, "ranking", "2026-09", "alunos", "x"), {
      nomePublico: "X",
      pontos: 999
    }));
    await assertSucceeds(getDoc(doc(dbAdmin, "tenants", TENANT, "disparos", "disp1")));
    await assertFails(getDoc(doc(dbAluno, "tenants", TENANT, "disparos", "disp1")));
    await assertFails(setDoc(doc(dbAdmin, "tenants", TENANT, "disparos", "disp2"), {
      canal: "whatsapp-link"
    }));
  });
});
