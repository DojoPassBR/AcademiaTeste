// Testes das 4 coleções PÚBLICAS do site institucional (turmas, equipe, horarios,
// academia/perfil) — as primeiras do projeto com `allow read: if true`.
//
// Além do comportamento normal (público lê, só admin escreve), este arquivo tem o
// bloco de REGRESSÃO no final, que é o mais importante daqui: ele prova que a
// leitura anônima NÃO vazou pra nenhuma outra coleção.

import { beforeAll, afterAll, beforeEach, describe, it } from "vitest";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import {
  doc,
  collection,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  where,
  serverTimestamp
} from "firebase/firestore";
import { criarAmbiente, semear, semearAdmin, semearAluno } from "./setup.js";

const ALUNO_UID = "aluno000000000000000001";
const ADMIN_UID = "admin000000000000000001";

const TURMA_ID = "turma000000000000000001";
const MEMBRO_ID = "membro00000000000000001";
const HORARIO_ID = "horario0000000000000001";

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

function comoPublico() {
  return ambiente.unauthenticatedContext().firestore();
}

// --- Campos editáveis (criadoPor/criadoEm entram por fora, como em eventos.test.js) ---

const TURMA_BASE = {
  nome: "Judô Infantil",
  descricao: "Turma para crianças de 6 a 10 anos",
  nivel: "Infantil",
  cor: "yellow",
  ativo: true,
  ordem: 1
};

const MEMBRO_BASE = {
  tipo: "professor",
  nome: "Sensei Fabrício",
  telefone: "15999990000",
  bio: "Faixa preta, 20 anos de tatame.",
  faixa: "Preta",
  redes: { instagram: "https://instagram.com/exemplo" },
  ativo: true,
  ordem: 0
};

const HORARIO_BASE = {
  diaSemana: 2,
  horaInicio: "19:00",
  horaFim: "20:30",
  turmaId: TURMA_ID,
  observacao: "Levar kimono",
  ativo: true
};

const PERFIL_BASE = {
  endereco: "Rua das Palmeiras, 100",
  complemento: "Ginásio nos fundos",
  cidadeUf: "Itapetininga/SP",
  cep: "18200-000",
  telefoneContato: "15999990000",
  emailContato: "contato@exemplo.com",
  horarioFuncionamento: "Seg a Sex, 8h às 22h",
  redes: { whatsapp: "https://wa.me/5515999990000" }
};

function turmaNova(extra = {}, uid = ADMIN_UID) {
  return { ...TURMA_BASE, criadoPor: uid, criadoEm: serverTimestamp(), ...extra };
}

function membroNovo(extra = {}, uid = ADMIN_UID) {
  return { ...MEMBRO_BASE, criadoPor: uid, criadoEm: serverTimestamp(), ...extra };
}

function horarioNovo(extra = {}, uid = ADMIN_UID) {
  return { ...HORARIO_BASE, criadoPor: uid, criadoEm: serverTimestamp(), ...extra };
}

function perfilNovo(extra = {}, uid = ADMIN_UID) {
  return { ...PERFIL_BASE, atualizadoPor: uid, atualizadoEm: serverTimestamp(), ...extra };
}

// Semeia o conteúdo público ignorando as rules, pro estado inicial dos testes.
async function semearConteudoPublico() {
  await semear(ambiente, async (db) => {
    await setDoc(doc(db, "turmas", TURMA_ID), {
      ...TURMA_BASE,
      criadoPor: ADMIN_UID,
      criadoEm: new Date("2026-09-01T12:00:00Z")
    });
    await setDoc(doc(db, "equipe", MEMBRO_ID), {
      ...MEMBRO_BASE,
      criadoPor: ADMIN_UID,
      criadoEm: new Date("2026-09-01T12:00:00Z")
    });
    await setDoc(doc(db, "horarios", HORARIO_ID), {
      ...HORARIO_BASE,
      criadoPor: ADMIN_UID,
      criadoEm: new Date("2026-09-01T12:00:00Z")
    });
    await setDoc(doc(db, "academia", "perfil"), {
      ...PERFIL_BASE,
      atualizadoPor: ADMIN_UID,
      atualizadoEm: new Date("2026-09-01T12:00:00Z")
    });
  });
}

describe("site público — leitura sem login", () => {
  it("visitante anônimo lê turmas, equipe, horarios e academia/perfil", async () => {
    await semearConteudoPublico();
    const db = comoPublico();
    await assertSucceeds(getDocs(query(collection(db, "turmas"), where("ativo", "==", true))));
    await assertSucceeds(getDocs(query(collection(db, "equipe"), where("ativo", "==", true))));
    await assertSucceeds(getDocs(query(collection(db, "horarios"), where("ativo", "==", true))));
    await assertSucceeds(getDoc(doc(db, "academia", "perfil")));
  });

  it("visitante anônimo lê um documento específico de cada coleção", async () => {
    await semearConteudoPublico();
    const db = comoPublico();
    await assertSucceeds(getDoc(doc(db, "turmas", TURMA_ID)));
    await assertSucceeds(getDoc(doc(db, "equipe", MEMBRO_ID)));
    await assertSucceeds(getDoc(doc(db, "horarios", HORARIO_ID)));
  });


  it("visitante anônimo não lê documento público com campo extra sensível", async () => {
    await semear(ambiente, async (db) => {
      await setDoc(doc(db, "turmas", "turma-com-extra"), {
        ...TURMA_BASE,
        criadoPor: ADMIN_UID,
        criadoEm: new Date("2026-09-01T12:00:00Z"),
        apiKey: "nao-pode-vazar"
      });
      await setDoc(doc(db, "academia", "perfil"), {
        ...PERFIL_BASE,
        atualizadoPor: ADMIN_UID,
        atualizadoEm: new Date("2026-09-01T12:00:00Z"),
        pixChaveManual: "chave-secreta"
      });
    });

    const db = comoPublico();
    await assertFails(getDoc(doc(db, "turmas", "turma-com-extra")));
    await assertFails(getDoc(doc(db, "academia", "perfil")));
  });
});

describe("site público — visitante anônimo nunca escreve", () => {
  it("não cria nas 4 coleções públicas", async () => {
    const db = comoPublico();
    await assertFails(addDoc(collection(db, "turmas"), turmaNova()));
    await assertFails(addDoc(collection(db, "equipe"), membroNovo()));
    await assertFails(addDoc(collection(db, "horarios"), horarioNovo()));
    await assertFails(setDoc(doc(db, "academia", "perfil"), perfilNovo()));
  });

  it("não atualiza nem apaga nas 4 coleções públicas", async () => {
    await semearConteudoPublico();
    const db = comoPublico();
    await assertFails(
      updateDoc(doc(db, "turmas", TURMA_ID), { nome: "Invadido", atualizadoEm: serverTimestamp() })
    );
    await assertFails(
      updateDoc(doc(db, "equipe", MEMBRO_ID), { nome: "Invadido", atualizadoEm: serverTimestamp() })
    );
    await assertFails(
      updateDoc(doc(db, "horarios", HORARIO_ID), { ativo: false, atualizadoEm: serverTimestamp() })
    );
    await assertFails(
      updateDoc(doc(db, "academia", "perfil"), {
        endereco: "Invadido",
        atualizadoEm: serverTimestamp()
      })
    );
    await assertFails(deleteDoc(doc(db, "turmas", TURMA_ID)));
    await assertFails(deleteDoc(doc(db, "equipe", MEMBRO_ID)));
    await assertFails(deleteDoc(doc(db, "horarios", HORARIO_ID)));
    await assertFails(deleteDoc(doc(db, "academia", "perfil")));
  });
});

describe("turmas — escrita de admin", () => {
  it("admin cria turma válida", async () => {
    await semearAdmin(ambiente, ADMIN_UID);
    const db = comoAdmin();
    await assertSucceeds(addDoc(collection(db, "turmas"), turmaNova()));
  });

  it("recusa create com campo extra (hasOnly)", async () => {
    await semearAdmin(ambiente, ADMIN_UID);
    const db = comoAdmin();
    await assertFails(addDoc(collection(db, "turmas"), turmaNova({ destaque: true })));
  });

  it("recusa cor fora do enum", async () => {
    await semearAdmin(ambiente, ADMIN_UID);
    const db = comoAdmin();
    await assertFails(addDoc(collection(db, "turmas"), turmaNova({ cor: "purple" })));
  });

  it("recusa nivel fora do enum", async () => {
    await semearAdmin(ambiente, ADMIN_UID);
    const db = comoAdmin();
    await assertFails(addDoc(collection(db, "turmas"), turmaNova({ nivel: "Faixa Preta" })));
  });

  it("admin atualiza e apaga turma", async () => {
    await semearConteudoPublico();
    await semearAdmin(ambiente, ADMIN_UID);
    const db = comoAdmin();
    await assertSucceeds(
      updateDoc(doc(db, "turmas", TURMA_ID), {
        nome: "Judô Infantil - Manhã",
        atualizadoEm: serverTimestamp()
      })
    );
    await assertSucceeds(deleteDoc(doc(db, "turmas", TURMA_ID)));
  });
});

describe("equipe — escrita de admin", () => {
  it("admin cria membro válido", async () => {
    await semearAdmin(ambiente, ADMIN_UID);
    const db = comoAdmin();
    await assertSucceeds(addDoc(collection(db, "equipe"), membroNovo()));
  });

  it("recusa create com campo extra (hasOnly)", async () => {
    await semearAdmin(ambiente, ADMIN_UID);
    const db = comoAdmin();
    await assertFails(addDoc(collection(db, "equipe"), membroNovo({ salario: 3000 })));
  });

  it("recusa rede que não é https", async () => {
    await semearAdmin(ambiente, ADMIN_UID);
    const db = comoAdmin();
    await assertFails(
      addDoc(collection(db, "equipe"), membroNovo({ redes: { instagram: "http://instagram.com/x" } }))
    );
    await assertFails(
      addDoc(collection(db, "equipe"), membroNovo({ redes: { site: "javascript:alert(1)" } }))
    );
  });

  it("recusa chave desconhecida dentro de redes", async () => {
    await semearAdmin(ambiente, ADMIN_UID);
    const db = comoAdmin();
    await assertFails(
      addDoc(collection(db, "equipe"), membroNovo({ redes: { linkedin: "https://linkedin.com/x" } }))
    );
  });

  it("recusa tipo fora do enum", async () => {
    await semearAdmin(ambiente, ADMIN_UID);
    const db = comoAdmin();
    await assertFails(addDoc(collection(db, "equipe"), membroNovo({ tipo: "diretor" })));
  });
});

describe("horarios — escrita de admin", () => {
  it("admin cria horário válido apontando pra turma existente", async () => {
    await semearConteudoPublico();
    await semearAdmin(ambiente, ADMIN_UID);
    const db = comoAdmin();
    await assertSucceeds(addDoc(collection(db, "horarios"), horarioNovo()));
  });

  it("admin cria horário com professorId de membro existente", async () => {
    await semearConteudoPublico();
    await semearAdmin(ambiente, ADMIN_UID);
    const db = comoAdmin();
    await assertSucceeds(
      addDoc(collection(db, "horarios"), horarioNovo({ professorId: MEMBRO_ID }))
    );
  });

  it("recusa turmaId inexistente", async () => {
    await semearAdmin(ambiente, ADMIN_UID);
    const db = comoAdmin();
    await assertFails(
      addDoc(collection(db, "horarios"), horarioNovo({ turmaId: "turma-que-nao-existe" }))
    );
  });

  it("recusa professorId inexistente", async () => {
    await semearConteudoPublico();
    await semearAdmin(ambiente, ADMIN_UID);
    const db = comoAdmin();
    await assertFails(
      addDoc(collection(db, "horarios"), horarioNovo({ professorId: "membro-que-nao-existe" }))
    );
  });

  it("recusa create com campo extra (hasOnly)", async () => {
    await semearConteudoPublico();
    await semearAdmin(ambiente, ADMIN_UID);
    const db = comoAdmin();
    await assertFails(addDoc(collection(db, "horarios"), horarioNovo({ vagas: 20 })));
  });

  it("recusa horaFim anterior ou igual a horaInicio", async () => {
    await semearConteudoPublico();
    await semearAdmin(ambiente, ADMIN_UID);
    const db = comoAdmin();
    await assertFails(
      addDoc(collection(db, "horarios"), horarioNovo({ horaInicio: "20:00", horaFim: "19:00" }))
    );
    await assertFails(
      addDoc(collection(db, "horarios"), horarioNovo({ horaInicio: "19:00", horaFim: "19:00" }))
    );
  });

  it("recusa hora fora do formato HH:MM", async () => {
    await semearConteudoPublico();
    await semearAdmin(ambiente, ADMIN_UID);
    const db = comoAdmin();
    await assertFails(addDoc(collection(db, "horarios"), horarioNovo({ horaInicio: "9:00" })));
    await assertFails(addDoc(collection(db, "horarios"), horarioNovo({ horaFim: "25:00" })));
  });

  it("recusa diaSemana fora de 0..6", async () => {
    await semearConteudoPublico();
    await semearAdmin(ambiente, ADMIN_UID);
    const db = comoAdmin();
    await assertFails(addDoc(collection(db, "horarios"), horarioNovo({ diaSemana: 7 })));
  });
});

describe("academia/perfil — escrita de admin", () => {
  it("admin grava o perfil válido", async () => {
    await semearAdmin(ambiente, ADMIN_UID);
    const db = comoAdmin();
    await assertSucceeds(setDoc(doc(db, "academia", "perfil"), perfilNovo()));
  });

  it("recusa write com campo extra (hasOnly)", async () => {
    await semearAdmin(ambiente, ADMIN_UID);
    const db = comoAdmin();
    await assertFails(
      setDoc(doc(db, "academia", "perfil"), perfilNovo({ pixChaveManual: "chave-secreta" }))
    );
  });

  it("recusa qualquer docId diferente de 'perfil'", async () => {
    await semearAdmin(ambiente, ADMIN_UID);
    const db = comoAdmin();
    await assertFails(setDoc(doc(db, "academia", "outro"), perfilNovo()));
  });

  it("recusa cep e email fora do formato", async () => {
    await semearAdmin(ambiente, ADMIN_UID);
    const db = comoAdmin();
    await assertFails(setDoc(doc(db, "academia", "perfil"), perfilNovo({ cep: "18200" })));
    await assertFails(
      setDoc(doc(db, "academia", "perfil"), perfilNovo({ emailContato: "sem-arroba" }))
    );
  });

  it("recusa perfil sem endereco", async () => {
    await semearAdmin(ambiente, ADMIN_UID);
    const db = comoAdmin();
    const { endereco, ...semEndereco } = perfilNovo();
    await assertFails(setDoc(doc(db, "academia", "perfil"), semEndereco));
  });
});

describe("site público — aluno autenticado (não-admin) não escreve", () => {
  it("aluno não cria em nenhuma das 4 coleções", async () => {
    await semearAluno(ambiente, ALUNO_UID);
    const db = comoAluno();
    await assertFails(addDoc(collection(db, "turmas"), turmaNova({}, ALUNO_UID)));
    await assertFails(addDoc(collection(db, "equipe"), membroNovo({}, ALUNO_UID)));
    await assertFails(addDoc(collection(db, "horarios"), horarioNovo({}, ALUNO_UID)));
    await assertFails(setDoc(doc(db, "academia", "perfil"), perfilNovo({}, ALUNO_UID)));
  });

  it("aluno não atualiza nem apaga em nenhuma das 4 coleções", async () => {
    await semearConteudoPublico();
    await semearAluno(ambiente, ALUNO_UID);
    const db = comoAluno();
    await assertFails(
      updateDoc(doc(db, "turmas", TURMA_ID), { nome: "Invadida", atualizadoEm: serverTimestamp() })
    );
    await assertFails(
      updateDoc(doc(db, "equipe", MEMBRO_ID), { nome: "Invadido", atualizadoEm: serverTimestamp() })
    );
    await assertFails(
      updateDoc(doc(db, "horarios", HORARIO_ID), { ativo: false, atualizadoEm: serverTimestamp() })
    );
    await assertFails(
      updateDoc(doc(db, "academia", "perfil"), {
        endereco: "Invadido",
        atualizadoEm: serverTimestamp()
      })
    );
    await assertFails(deleteDoc(doc(db, "turmas", TURMA_ID)));
    await assertFails(deleteDoc(doc(db, "equipe", MEMBRO_ID)));
    await assertFails(deleteDoc(doc(db, "horarios", HORARIO_ID)));
    await assertFails(deleteDoc(doc(db, "academia", "perfil")));
  });
});

// ============================================================
// REGRESSÃO CRÍTICA — o teste mais importante deste arquivo.
//
// As rules passaram a ter `allow read: if true` pela primeira vez no projeto (turmas,
// equipe, horarios, academia). Este bloco existe pra provar que essa abertura NÃO
// vazou pra nenhuma outra coleção: um visitante SEM LOGIN continua sem conseguir ler
// alunos, checkins, cobrancas, config/geral, config/credenciais, eventos e admins.
//
// Se algum destes `assertFails` começar a falhar (ou seja, a leitura passar), é
// porque alguém ampliou o escopo da leitura pública — NÃO relaxe o teste, conserte
// as rules.
// ============================================================
describe("REGRESSÃO — leitura pública não vazou pra nenhuma outra coleção", () => {
  beforeEach(async () => {
    await semearAluno(ambiente, ALUNO_UID);
    await semearAdmin(ambiente, ADMIN_UID);
    await semear(ambiente, async (db) => {
      await setDoc(doc(db, "checkins", ALUNO_UID + "_1"), {
        alunoId: ALUNO_UID,
        nome: "João da Silva",
        lat: 0,
        lng: 0,
        timestamp: new Date()
      });
      await setDoc(doc(db, "cobrancas", ALUNO_UID + "_2026-09"), {
        alunoId: ALUNO_UID,
        valor: 150,
        mesReferencia: "2026-09",
        status: "pendente"
      });
      await setDoc(doc(db, "config", "geral"), { mensalidadeModo: "manual" });
      await setDoc(doc(db, "config", "credenciais"), { asaasApiKeyCifrada: "xxx" });
      await setDoc(doc(db, "eventos", "evento1"), {
        nome: "Campeonato",
        data: "2026-11-20",
        local: "Ginásio",
        criadoPor: ADMIN_UID,
        criadoEm: new Date()
      });
    });
  });

  it("anônimo NÃO lê alunos", async () => {
    const db = comoPublico();
    await assertFails(getDocs(collection(db, "alunos")));
    await assertFails(getDoc(doc(db, "alunos", ALUNO_UID)));
  });

  it("anônimo NÃO lê checkins", async () => {
    const db = comoPublico();
    await assertFails(getDocs(collection(db, "checkins")));
    await assertFails(getDoc(doc(db, "checkins", ALUNO_UID + "_1")));
  });

  it("anônimo NÃO lê cobrancas", async () => {
    const db = comoPublico();
    await assertFails(getDocs(collection(db, "cobrancas")));
    await assertFails(getDoc(doc(db, "cobrancas", ALUNO_UID + "_2026-09")));
  });

  it("anônimo NÃO lê config/geral", async () => {
    const db = comoPublico();
    await assertFails(getDoc(doc(db, "config", "geral")));
  });

  it("anônimo NÃO lê config/credenciais (chave Asaas cifrada)", async () => {
    const db = comoPublico();
    await assertFails(getDoc(doc(db, "config", "credenciais")));
  });

  it("anônimo NÃO lê eventos", async () => {
    const db = comoPublico();
    await assertFails(getDocs(collection(db, "eventos")));
    await assertFails(getDoc(doc(db, "eventos", "evento1")));
  });

  it("anônimo NÃO lê admins", async () => {
    const db = comoPublico();
    await assertFails(getDocs(collection(db, "admins")));
    await assertFails(getDoc(doc(db, "admins", ADMIN_UID)));
  });

  // Nem o aluno autenticado passa a ler config/credenciais por causa da abertura.
  it("aluno autenticado continua sem ler config/credenciais", async () => {
    const db = comoAluno();
    await assertFails(getDoc(doc(db, "config", "credenciais")));
  });
});
