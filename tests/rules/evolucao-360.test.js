import { describe, it, beforeAll, beforeEach, afterAll } from "vitest";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from "firebase/firestore";
import { criarAmbiente, semear, ALUNO_VALIDO } from "./setup.js";

const TENANT = "jairo";
const ADMIN = "admin000000000000000001";
const ALUNO = "aluno000000000000000001";
const OUTRO_ALUNO = "aluno000000000000000002";
const PROF = "prof0000000000000000001";
const PROF_OUTRO = "prof0000000000000000002";

let ambiente;

function dbAuth(uid) {
  return ambiente.authenticatedContext(uid).firestore();
}

async function semearBase() {
  await semear(ambiente, async (db) => {
    await setDoc(doc(db, "tenants", TENANT), { tenantSlug: TENANT, status: "ativo" });
    await setDoc(doc(db, "tenants", TENANT, "memberships", ADMIN), { role: "admin", status: "ativo" });
    await setDoc(doc(db, "tenants", TENANT, "memberships", ALUNO), { role: "aluno", status: "ativo" });
    await setDoc(doc(db, "tenants", TENANT, "memberships", OUTRO_ALUNO), { role: "aluno", status: "ativo" });
    await setDoc(doc(db, "tenants", TENANT, "memberships", PROF), { role: "professor", status: "ativo" });
    await setDoc(doc(db, "tenants", TENANT, "memberships", PROF_OUTRO), { role: "professor", status: "ativo" });
    await setDoc(doc(db, "tenants", TENANT, "professores", PROF), { nome: "Professor", status: "ativo" });
    await setDoc(doc(db, "tenants", TENANT, "professores", PROF_OUTRO), { nome: "Professor sem vínculo", status: "ativo" });
    await setDoc(doc(db, "tenants", TENANT, "alunos", ALUNO), {
      ...ALUNO_VALIDO,
      professorIds: [PROF],
      professorId: PROF,
      mensalidadeStatus: "pago"
    });
    await setDoc(doc(db, "tenants", TENANT, "alunos", OUTRO_ALUNO), {
      ...ALUNO_VALIDO,
      nome: "Maria da Silva",
      email: "maria@example.com",
      professorIds: [PROF_OUTRO],
      professorId: PROF_OUTRO,
      mensalidadeStatus: "pago"
    });
    await setDoc(doc(db, "tenants", TENANT, "evolucoes", "evo-semeada"), {
      alunoId: ALUNO,
      titulo: "Arm lock da guarda",
      status: "desenvolvimento",
      observacao: "Ajustar quadril",
      criadoPor: ADMIN,
      criadoEm: new Date("2026-09-01T12:00:00Z"),
      atualizadoEm: new Date("2026-09-02T12:00:00Z")
    });
    await setDoc(doc(db, "tenants", TENANT, "metasAluno", "meta-semeada"), {
      alunoId: ALUNO,
      tipo: "tecnica",
      titulo: "Finalizar arm lock com controle",
      status: "ativa",
      progresso: 35,
      alvo: "3 repetições boas por treino",
      prazo: new Date("2026-10-10T12:00:00Z"),
      criadoPor: ADMIN,
      criadoEm: new Date("2026-09-01T12:00:00Z"),
      atualizadoEm: new Date("2026-09-02T12:00:00Z")
    });
    await setDoc(doc(db, "tenants", TENANT, "evolucoes", "evo-outro"), {
      alunoId: OUTRO_ALUNO,
      titulo: "Queda",
      status: "apto",
      criadoPor: ADMIN,
      criadoEm: new Date("2026-09-01T12:00:00Z"),
      atualizadoEm: new Date("2026-09-02T12:00:00Z")
    });
    await setDoc(doc(db, "tenants", TENANT, "conquistas", "freq-10"), {
      titulo: "10 treinos no mês",
      descricao: "Boa frequência dentro do mês.",
      tipo: "frequencia",
      regra: "10 check-ins no mês",
      pontos: 50,
      ativo: true,
      criadoPor: ADMIN,
      criadoEm: new Date("2026-09-01T12:00:00Z"),
      atualizadoEm: new Date("2026-09-02T12:00:00Z")
    });
    await setDoc(doc(db, "tenants", TENANT, "conquistas", "inativa"), {
      titulo: "Desafio arquivado",
      tipo: "manual",
      pontos: 5,
      ativo: false,
      criadoPor: ADMIN,
      criadoEm: new Date("2026-09-01T12:00:00Z"),
      atualizadoEm: new Date("2026-09-02T12:00:00Z")
    });
    await setDoc(doc(db, "tenants", TENANT, "conquistasAluno", "aluno-freq-10"), {
      alunoId: ALUNO,
      conquistaId: "freq-10",
      pontos: 50,
      origem: "manual",
      desbloqueadoPor: ADMIN,
      desbloqueadoEm: new Date("2026-09-03T12:00:00Z")
    });
    await setDoc(doc(db, "tenants", TENANT, "conquistasAluno", "outro-freq-10"), {
      alunoId: OUTRO_ALUNO,
      conquistaId: "freq-10",
      pontos: 50,
      origem: "manual",
      desbloqueadoPor: ADMIN,
      desbloqueadoEm: new Date("2026-09-03T12:00:00Z")
    });
    await setDoc(doc(db, "tenants", TENANT, "crmInteracoes", "crm-semeada"), {
      alunoId: ALUNO,
      canal: "whatsapp",
      status: "aberto",
      mensagem: "Chamado para voltar aos treinos.",
      criadoPor: ADMIN,
      criadoEm: new Date("2026-09-04T12:00:00Z")
    });
    await setDoc(doc(db, "tenants", TENANT, "turmas", "turma-recorrente"), {
      nome: "Jiu-jitsu manhã",
      descricao: "Turma recorrente para alunos adultos.",
      nivel: "Livre",
      modalidade: "jiu-jitsu",
      cor: "red",
      diasSemana: [1, 3, 5],
      horarioInicio: "08:00",
      horarioFim: "09:00",
      capacidade: 20,
      professorIds: [PROF],
      ativo: true,
      ordem: 1,
      criadoPor: ADMIN,
      criadoEm: new Date("2026-09-04T12:00:00Z")
    });
    await setDoc(doc(db, "tenants", TENANT, "reservasAula", "reserva-aluno"), {
      alunoId: ALUNO,
      turmaId: "turma-recorrente",
      dataAula: new Date("2026-09-21T11:00:00Z"),
      status: "solicitada",
      criadoPor: ALUNO,
      criadoEm: new Date("2026-09-04T12:00:00Z")
    });
    await setDoc(doc(db, "tenants", TENANT, "reservasAula", "reserva-outro"), {
      alunoId: OUTRO_ALUNO,
      turmaId: "turma-recorrente",
      dataAula: new Date("2026-09-21T11:00:00Z"),
      status: "solicitada",
      criadoPor: OUTRO_ALUNO,
      criadoEm: new Date("2026-09-04T12:00:00Z")
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

describe("evolução 360 — etapa 1", () => {
  it("admin cria evolução técnica e meta com campos válidos", async () => {
    const dbAdmin = dbAuth(ADMIN);

    await assertSucceeds(addDoc(collection(dbAdmin, "tenants", TENANT, "evolucoes"), {
      alunoId: ALUNO,
      titulo: "Passagem de guarda em pé",
      status: "revisar",
      observacao: "Precisa firmar a pegada da calça.",
      criadoPor: ADMIN,
      criadoEm: serverTimestamp(),
      atualizadoEm: serverTimestamp()
    }));

    await assertSucceeds(addDoc(collection(dbAdmin, "tenants", TENANT, "metasAluno"), {
      alunoId: ALUNO,
      tipo: "frequencia",
      titulo: "Treinar 12 vezes no mês",
      status: "ativa",
      progresso: 20,
      prazo: new Date("2026-10-15T12:00:00Z"),
      criadoPor: ADMIN,
      criadoEm: serverTimestamp(),
      atualizadoEm: serverTimestamp()
    }));
  });

  it("professor vinculado cria e lê registros do aluno; professor sem vínculo não acessa", async () => {
    const dbProf = dbAuth(PROF);
    const dbProfOutro = dbAuth(PROF_OUTRO);

    await assertSucceeds(addDoc(collection(dbProf, "tenants", TENANT, "evolucoes"), {
      alunoId: ALUNO,
      titulo: "Raspagem da meia-guarda",
      status: "desenvolvimento",
      criadoPor: PROF,
      criadoEm: serverTimestamp(),
      atualizadoEm: serverTimestamp()
    }));

    await assertSucceeds(getDocs(query(
      collection(dbProf, "tenants", TENANT, "evolucoes"),
      where("alunoId", "==", ALUNO)
    )));
    await assertFails(getDoc(doc(dbProfOutro, "tenants", TENANT, "evolucoes", "evo-semeada")));
    await assertFails(addDoc(collection(dbProfOutro, "tenants", TENANT, "metasAluno"), {
      alunoId: ALUNO,
      tipo: "tecnica",
      titulo: "Meta indevida",
      status: "ativa",
      progresso: 0,
      criadoPor: PROF_OUTRO,
      criadoEm: serverTimestamp(),
      atualizadoEm: serverTimestamp()
    }));
  });

  it("aluno lê apenas evolução própria e não escreve campos técnicos", async () => {
    const dbAluno = dbAuth(ALUNO);

    await assertSucceeds(getDoc(doc(dbAluno, "tenants", TENANT, "evolucoes", "evo-semeada")));
    await assertSucceeds(getDocs(query(
      collection(dbAluno, "tenants", TENANT, "metasAluno"),
      where("alunoId", "==", ALUNO)
    )));
    await assertFails(getDoc(doc(dbAluno, "tenants", TENANT, "evolucoes", "evo-outro")));
    await assertFails(addDoc(collection(dbAluno, "tenants", TENANT, "evolucoes"), {
      alunoId: ALUNO,
      titulo: "Me declarei apto",
      status: "apto",
      criadoPor: ALUNO,
      criadoEm: serverTimestamp(),
      atualizadoEm: serverTimestamp()
    }));
    await assertFails(updateDoc(doc(dbAluno, "tenants", TENANT, "metasAluno", "meta-semeada"), {
      progresso: 100,
      atualizadoEm: serverTimestamp()
    }));
  });

  it("bloqueia campo extra, status inválido e aluno inexistente", async () => {
    const dbAdmin = dbAuth(ADMIN);

    await assertFails(addDoc(collection(dbAdmin, "tenants", TENANT, "evolucoes"), {
      alunoId: ALUNO,
      titulo: "Campo extra",
      status: "apto",
      nivelSecreto: "x",
      criadoPor: ADMIN,
      criadoEm: serverTimestamp(),
      atualizadoEm: serverTimestamp()
    }));

    await assertFails(addDoc(collection(dbAdmin, "tenants", TENANT, "evolucoes"), {
      alunoId: ALUNO,
      titulo: "Status ruim",
      status: "perfeito",
      criadoPor: ADMIN,
      criadoEm: serverTimestamp(),
      atualizadoEm: serverTimestamp()
    }));

    await assertFails(addDoc(collection(dbAdmin, "tenants", TENANT, "metasAluno"), {
      alunoId: "aluno-inexistente",
      tipo: "tecnica",
      titulo: "Meta fantasma",
      status: "ativa",
      progresso: 0,
      criadoPor: ADMIN,
      criadoEm: serverTimestamp(),
      atualizadoEm: serverTimestamp()
    }));
  });
});

describe("evolução 360 — etapa 3 CRM", () => {
  it("aluno não lê histórico interno de CRM", async () => {
    const dbAluno = dbAuth(ALUNO);

    await assertFails(getDoc(doc(dbAluno, "tenants", TENANT, "crmInteracoes", "crm-semeada")));
    await assertFails(getDocs(query(
      collection(dbAluno, "tenants", TENANT, "crmInteracoes"),
      where("alunoId", "==", ALUNO)
    )));
  });

  it("professor sem vínculo não lê nem registra CRM do aluno", async () => {
    const dbProfOutro = dbAuth(PROF_OUTRO);

    await assertFails(getDoc(doc(dbProfOutro, "tenants", TENANT, "crmInteracoes", "crm-semeada")));
    await assertFails(addDoc(collection(dbProfOutro, "tenants", TENANT, "crmInteracoes"), {
      alunoId: ALUNO,
      canal: "telefone",
      status: "aberto",
      mensagem: "Tentativa indevida.",
      criadoPor: PROF_OUTRO,
      criadoEm: serverTimestamp()
    }));
  });

  it("professor vinculado registra interação e atualiza campos CRM seguros", async () => {
    const dbProf = dbAuth(PROF);

    await assertSucceeds(addDoc(collection(dbProf, "tenants", TENANT, "crmInteracoes"), {
      alunoId: ALUNO,
      canal: "whatsapp",
      status: "respondido",
      mensagem: "Aluno confirmou que volta amanhã.",
      criadoPor: PROF,
      criadoEm: serverTimestamp()
    }));

    await assertSucceeds(updateDoc(doc(dbProf, "tenants", TENANT, "alunos", ALUNO), {
      statusComercial: "risco",
      tagsCrm: ["sumido", "manha"],
      ultimaInteracaoEm: serverTimestamp(),
      crmAtualizadoPor: PROF,
      crmAtualizadoEm: serverTimestamp()
    }));
  });

  it("professor vinculado não mistura CRM com mensalidade, faixa ou nome", async () => {
    const dbProf = dbAuth(PROF);

    await assertFails(updateDoc(doc(dbProf, "tenants", TENANT, "alunos", ALUNO), {
      statusComercial: "recuperacao",
      tagsCrm: ["retorno"],
      ultimaInteracaoEm: serverTimestamp(),
      crmAtualizadoPor: PROF,
      crmAtualizadoEm: serverTimestamp(),
      mensalidadeStatus: "pendente"
    }));

    await assertFails(updateDoc(doc(dbProf, "tenants", TENANT, "alunos", ALUNO), {
      statusComercial: "acompanhar",
      tagsCrm: ["teste"],
      ultimaInteracaoEm: serverTimestamp(),
      crmAtualizadoPor: PROF,
      crmAtualizadoEm: serverTimestamp(),
      faixa: "Preta",
      nome: "Nome alterado"
    }));
  });

  it("bloqueia campos extras, tags inválidas e status fora do enum", async () => {
    const dbProf = dbAuth(PROF);

    await assertFails(addDoc(collection(dbProf, "tenants", TENANT, "crmInteracoes"), {
      alunoId: ALUNO,
      canal: "sms",
      status: "aberto",
      mensagem: "Canal inválido.",
      criadoPor: PROF,
      criadoEm: serverTimestamp()
    }));

    await assertFails(addDoc(collection(dbProf, "tenants", TENANT, "crmInteracoes"), {
      alunoId: ALUNO,
      canal: "whatsapp",
      status: "aberto",
      mensagem: "Campo extra.",
      segredo: true,
      criadoPor: PROF,
      criadoEm: serverTimestamp()
    }));

    await assertFails(updateDoc(doc(dbProf, "tenants", TENANT, "alunos", ALUNO), {
      statusComercial: "super quente",
      tagsCrm: ["sumido"],
      ultimaInteracaoEm: serverTimestamp(),
      crmAtualizadoPor: PROF,
      crmAtualizadoEm: serverTimestamp()
    }));

    await assertFails(updateDoc(doc(dbProf, "tenants", TENANT, "alunos", ALUNO), {
      statusComercial: "risco",
      tagsCrm: ["tag inválida!"],
      ultimaInteracaoEm: serverTimestamp(),
      crmAtualizadoPor: PROF,
      crmAtualizadoEm: serverTimestamp()
    }));
  });
});

describe("evolução 360 — etapa 2", () => {
  it("admin gerencia catálogo de conquistas com campos válidos", async () => {
    const dbAdmin = dbAuth(ADMIN);

    await assertSucceeds(addDoc(collection(dbAdmin, "tenants", TENANT, "conquistas"), {
      titulo: "Sequência de 7 dias",
      descricao: "Treinou com constância na semana.",
      tipo: "streak",
      regra: "7 dias seguidos",
      pontos: 80,
      ativo: true,
      criadoPor: ADMIN,
      criadoEm: serverTimestamp(),
      atualizadoEm: serverTimestamp()
    }));

    await assertSucceeds(updateDoc(doc(dbAdmin, "tenants", TENANT, "conquistas", "freq-10"), {
      pontos: 60,
      ativo: true,
      atualizadoEm: serverTimestamp()
    }));

    await assertFails(addDoc(collection(dbAdmin, "tenants", TENANT, "conquistas"), {
      titulo: "Campo extra",
      tipo: "manual",
      pontos: 10,
      ativo: true,
      segredo: "x",
      criadoPor: ADMIN,
      criadoEm: serverTimestamp(),
      atualizadoEm: serverTimestamp()
    }));
  });

  it("aluno lê catálogo ativo e conquistas próprias, mas não escreve pontos", async () => {
    const dbAluno = dbAuth(ALUNO);

    await assertSucceeds(getDocs(query(
      collection(dbAluno, "tenants", TENANT, "conquistas"),
      where("ativo", "==", true)
    )));
    await assertSucceeds(getDocs(query(
      collection(dbAluno, "tenants", TENANT, "conquistasAluno"),
      where("alunoId", "==", ALUNO)
    )));
    await assertSucceeds(getDoc(doc(dbAluno, "tenants", TENANT, "conquistasAluno", "aluno-freq-10")));
    await assertFails(getDoc(doc(dbAluno, "tenants", TENANT, "conquistasAluno", "outro-freq-10")));

    await assertFails(addDoc(collection(dbAluno, "tenants", TENANT, "conquistasAluno"), {
      alunoId: ALUNO,
      conquistaId: "freq-10",
      pontos: 50,
      origem: "manual",
      desbloqueadoPor: ALUNO,
      desbloqueadoEm: serverTimestamp()
    }));

    await assertFails(updateDoc(doc(dbAluno, "tenants", TENANT, "conquistasAluno", "aluno-freq-10"), {
      pontos: 999
    }));
  });

  it("professor vinculado desbloqueia conquista; professor sem vínculo não lê nem escreve", async () => {
    const dbProf = dbAuth(PROF);
    const dbProfOutro = dbAuth(PROF_OUTRO);

    await assertSucceeds(addDoc(collection(dbProf, "tenants", TENANT, "conquistasAluno"), {
      alunoId: ALUNO,
      conquistaId: "freq-10",
      pontos: 50,
      origem: "manual",
      desbloqueadoPor: PROF,
      desbloqueadoEm: serverTimestamp()
    }));

    await assertSucceeds(getDocs(query(
      collection(dbProf, "tenants", TENANT, "conquistasAluno"),
      where("alunoId", "==", ALUNO)
    )));

    await assertFails(getDoc(doc(dbProfOutro, "tenants", TENANT, "conquistasAluno", "aluno-freq-10")));
    await assertFails(addDoc(collection(dbProfOutro, "tenants", TENANT, "conquistasAluno"), {
      alunoId: ALUNO,
      conquistaId: "freq-10",
      pontos: 50,
      origem: "manual",
      desbloqueadoPor: PROF_OUTRO,
      desbloqueadoEm: serverTimestamp()
    }));
  });

  it("bloqueia conquista inativa, pontos divergentes e edição por professor no catálogo", async () => {
    const dbAdmin = dbAuth(ADMIN);
    const dbProf = dbAuth(PROF);

    await assertFails(addDoc(collection(dbAdmin, "tenants", TENANT, "conquistasAluno"), {
      alunoId: ALUNO,
      conquistaId: "inativa",
      pontos: 5,
      origem: "manual",
      desbloqueadoPor: ADMIN,
      desbloqueadoEm: serverTimestamp()
    }));

    await assertFails(addDoc(collection(dbAdmin, "tenants", TENANT, "conquistasAluno"), {
      alunoId: ALUNO,
      conquistaId: "freq-10",
      pontos: 999,
      origem: "manual",
      desbloqueadoPor: ADMIN,
      desbloqueadoEm: serverTimestamp()
    }));

    await assertFails(updateDoc(doc(dbProf, "tenants", TENANT, "conquistas", "freq-10"), {
      titulo: "Professor tentou editar",
      atualizadoEm: serverTimestamp()
    }));
  });
});

describe("evolução 360 — etapa 4 agendamentos inteligentes", () => {
  it("admin cria e atualiza turma recorrente com campos de agenda", async () => {
    const dbAdmin = dbAuth(ADMIN);
    const dbProf = dbAuth(PROF);

    await assertSucceeds(addDoc(collection(dbAdmin, "tenants", TENANT, "turmas"), {
      nome: "Muay thai noite",
      descricao: "Treino técnico e sparring leve.",
      nivel: "Livre",
      modalidade: "muay-thai",
      cor: "yellow",
      diasSemana: [2, 4],
      horarioInicio: "19:00",
      horarioFim: "20:30",
      capacidade: 30,
      professorIds: [PROF],
      ativo: true,
      ordem: 2,
      criadoPor: ADMIN,
      criadoEm: serverTimestamp()
    }));

    await assertSucceeds(updateDoc(doc(dbAdmin, "tenants", TENANT, "turmas", "turma-recorrente"), {
      capacidade: 24,
      diasSemana: [1, 3, 5],
      horarioInicio: "08:30",
      horarioFim: "09:30",
      atualizadoEm: serverTimestamp()
    }));

    await assertFails(addDoc(collection(dbProf, "tenants", TENANT, "turmas"), {
      nome: "Turma indevida",
      nivel: "Livre",
      modalidade: "jiu-jitsu",
      cor: "red",
      diasSemana: [1],
      horarioInicio: "10:00",
      horarioFim: "11:00",
      capacidade: 10,
      professorIds: [PROF],
      ativo: true,
      ordem: 3,
      criadoPor: PROF,
      criadoEm: serverTimestamp()
    }));
  });

  it("bloqueia turma com horários, dias ou professores inválidos", async () => {
    const dbAdmin = dbAuth(ADMIN);

    await assertFails(addDoc(collection(dbAdmin, "tenants", TENANT, "turmas"), {
      nome: "Horário quebrado",
      nivel: "Livre",
      modalidade: "jiu-jitsu",
      cor: "red",
      diasSemana: [1],
      horarioInicio: "11:00",
      horarioFim: "10:00",
      capacidade: 10,
      professorIds: [PROF],
      ativo: true,
      ordem: 3,
      criadoPor: ADMIN,
      criadoEm: serverTimestamp()
    }));

    await assertFails(updateDoc(doc(dbAdmin, "tenants", TENANT, "turmas", "turma-recorrente"), {
      diasSemana: [7],
      atualizadoEm: serverTimestamp()
    }));

    await assertFails(updateDoc(doc(dbAdmin, "tenants", TENANT, "turmas", "turma-recorrente"), {
      professorIds: Array.from({ length: 21 }, (_, index) => "prof-" + index),
      atualizadoEm: serverTimestamp()
    }));
  });

  it("aluno cria reserva somente para si e com status solicitado", async () => {
    const dbAluno = dbAuth(ALUNO);

    await assertSucceeds(addDoc(collection(dbAluno, "tenants", TENANT, "reservasAula"), {
      alunoId: ALUNO,
      turmaId: "turma-recorrente",
      dataAula: new Date("2026-09-23T11:00:00Z"),
      status: "solicitada",
      criadoPor: ALUNO,
      criadoEm: serverTimestamp()
    }));

    await assertFails(addDoc(collection(dbAluno, "tenants", TENANT, "reservasAula"), {
      alunoId: OUTRO_ALUNO,
      turmaId: "turma-recorrente",
      dataAula: new Date("2026-09-23T11:00:00Z"),
      status: "solicitada",
      criadoPor: ALUNO,
      criadoEm: serverTimestamp()
    }));

    await assertFails(addDoc(collection(dbAluno, "tenants", TENANT, "reservasAula"), {
      alunoId: ALUNO,
      turmaId: "turma-recorrente",
      dataAula: new Date("2026-09-23T11:00:00Z"),
      status: "confirmada",
      criadoPor: ALUNO,
      criadoEm: serverTimestamp()
    }));
  });

  it("aluno lê apenas as próprias reservas", async () => {
    const dbAluno = dbAuth(ALUNO);

    await assertSucceeds(getDoc(doc(dbAluno, "tenants", TENANT, "reservasAula", "reserva-aluno")));
    await assertSucceeds(getDocs(query(
      collection(dbAluno, "tenants", TENANT, "reservasAula"),
      where("alunoId", "==", ALUNO)
    )));
    await assertFails(getDoc(doc(dbAluno, "tenants", TENANT, "reservasAula", "reserva-outro")));
  });

  it("professor vinculado confirma reserva; professor sem vínculo não acessa", async () => {
    const dbProf = dbAuth(PROF);
    const dbProfOutro = dbAuth(PROF_OUTRO);

    await assertSucceeds(getDoc(doc(dbProf, "tenants", TENANT, "reservasAula", "reserva-aluno")));
    await assertSucceeds(updateDoc(doc(dbProf, "tenants", TENANT, "reservasAula", "reserva-aluno"), {
      status: "confirmada",
      gerenciadoPor: PROF,
      gerenciadoEm: serverTimestamp(),
      atualizadoEm: serverTimestamp()
    }));

    await assertFails(getDoc(doc(dbProfOutro, "tenants", TENANT, "reservasAula", "reserva-aluno")));
    await assertFails(updateDoc(doc(dbProfOutro, "tenants", TENANT, "reservasAula", "reserva-aluno"), {
      status: "cancelada",
      gerenciadoPor: PROF_OUTRO,
      gerenciadoEm: serverTimestamp(),
      atualizadoEm: serverTimestamp()
    }));
  });

  it("admin gerencia e remove reservas, mas não altera vínculos imutáveis", async () => {
    const dbAdmin = dbAuth(ADMIN);

    await assertSucceeds(updateDoc(doc(dbAdmin, "tenants", TENANT, "reservasAula", "reserva-aluno"), {
      status: "lista_espera",
      gerenciadoPor: ADMIN,
      gerenciadoEm: serverTimestamp(),
      atualizadoEm: serverTimestamp()
    }));

    await assertFails(updateDoc(doc(dbAdmin, "tenants", TENANT, "reservasAula", "reserva-aluno"), {
      turmaId: "outra-turma",
      status: "confirmada",
      gerenciadoPor: ADMIN,
      gerenciadoEm: serverTimestamp(),
      atualizadoEm: serverTimestamp()
    }));

    await assertSucceeds(deleteDoc(doc(dbAdmin, "tenants", TENANT, "reservasAula", "reserva-aluno")));
  });
});
