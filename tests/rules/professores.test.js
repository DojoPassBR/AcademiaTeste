// Rules do papel "professor" (tenants/{t}/professores, membership role 'professor' e o
// vínculo alunos/{id}.professorId).
//
// O teste mais importante deste arquivo é o primeiro: professor NÃO lista a base de
// alunos da academia. A permissão de leitura dele existe só documento a documento, por
// igualdade de professorId — se um dia alguém trocar aquele disjunto por um
// isTenantProfessor(tenantId) solto, todo aluno da academia vaza, e é aqui que isso
// tem que estourar.
import { describe, it, beforeAll, beforeEach, afterAll, expect } from "vitest";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
  setDoc,
  updateDoc,
  deleteField,
  serverTimestamp
} from "firebase/firestore";
import { criarAmbiente, semear, ALUNO_VALIDO, checkinIdValido } from "./setup.js";

const TENANT = "jairo";
const ADMIN = "admin000000000000000001";
const PROF_A = "prof0000000000000000001";
const PROF_B = "prof0000000000000000002";
const ALUNO_A = "aluno000000000000000001"; // vinculado ao PROF_A
const ALUNO_B = "aluno000000000000000002"; // vinculado ao PROF_B
const ALUNO_SEM = "aluno000000000000000003"; // sem professor
const NAO_PROFESSOR = "fantasma00000000000001"; // membership de aluno, sem doc em professores/

// Geofence do tenant, pro teste de regressão de check-in (o professor que também treina
// continua fazendo check-in normalmente).
const CHECKIN_LAT = -22.0;
const CHECKIN_LNG = -47.0;

let ambiente;

function dbAuth(uid) {
  return ambiente.authenticatedContext(uid).firestore();
}

async function semearBase() {
  await semear(ambiente, async (db) => {
    await setDoc(doc(db, "tenants", TENANT), { tenantSlug: TENANT, nome: "Jairo", status: "ativo" });
    await setDoc(doc(db, "tenantSlugs", TENANT), { tenantId: TENANT, tenantSlug: TENANT, status: "ativo" });

    await setDoc(doc(db, "tenants", TENANT, "config", "geral"), {
      mensalidadeModo: "manual",
      checkinLat: CHECKIN_LAT,
      checkinLng: CHECKIN_LNG,
      checkinRaioMetros: 150
    });
    // Negado pra todo cliente, inclusive admin — semeado só pra provar isso.
    await setDoc(doc(db, "tenants", TENANT, "config", "credenciais"), {
      asaasApiKeyCipher: "nao-importa",
      ambiente: "sandbox"
    });

    await setDoc(doc(db, "tenants", TENANT, "memberships", ADMIN), { role: "admin", status: "ativo" });
    await setDoc(doc(db, "tenants", TENANT, "memberships", PROF_A), { role: "professor", status: "ativo" });
    await setDoc(doc(db, "tenants", TENANT, "memberships", PROF_B), { role: "professor", status: "ativo" });
    await setDoc(doc(db, "tenants", TENANT, "memberships", ALUNO_A), { role: "aluno", status: "ativo" });
    await setDoc(doc(db, "tenants", TENANT, "memberships", ALUNO_B), { role: "aluno", status: "ativo" });
    await setDoc(doc(db, "tenants", TENANT, "memberships", ALUNO_SEM), { role: "aluno", status: "ativo" });
    await setDoc(doc(db, "tenants", TENANT, "memberships", NAO_PROFESSOR), { role: "aluno", status: "ativo" });

    // Só o Worker escreve aqui; no teste, semear ignora as rules de propósito.
    await setDoc(doc(db, "tenants", TENANT, "professores", PROF_A), {
      nome: "Professora Ana", email: "ana@example.com", status: "ativo", ehAlunoTambem: true
    });
    await setDoc(doc(db, "tenants", TENANT, "professores", PROF_B), {
      nome: "Professor Bruno", email: "bruno@example.com", status: "ativo", ehAlunoTambem: false
    });

    // PROF_A também treina: tem documento próprio em alunos/ e mensalidade em dia.
    await setDoc(doc(db, "tenants", TENANT, "alunos", PROF_A), {
      ...ALUNO_VALIDO, nome: "Ana Souza", email: "ana@example.com", mensalidadeStatus: "pago"
    });
    await setDoc(doc(db, "tenants", TENANT, "alunos", ALUNO_A), {
      ...ALUNO_VALIDO, mensalidadeStatus: "pago", professorId: PROF_A
    });
    await setDoc(doc(db, "tenants", TENANT, "alunos", ALUNO_B), {
      ...ALUNO_VALIDO, nome: "Bento Lima", mensalidadeStatus: "pendente", professorId: PROF_B
    });
    await setDoc(doc(db, "tenants", TENANT, "alunos", ALUNO_SEM), {
      ...ALUNO_VALIDO, nome: "Carla Dias", mensalidadeStatus: "pendente"
    });

    // Cobrança de terceiro, pro teste de regressão de isolamento financeiro.
    await setDoc(doc(db, "tenants", TENANT, "cobrancas", ALUNO_B + "_2026-09"), {
      alunoId: ALUNO_B,
      alunoNome: "Bento Lima",
      valor: 150,
      mesReferencia: "2026-09",
      status: "pendente",
      origem: "manual",
      criadoPorUid: ADMIN,
      criadoEm: new Date()
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

describe("professor: leitura de alunos", () => {
  // 1
  it("professor NÃO lista todos os alunos da academia", async () => {
    const db = dbAuth(PROF_A);
    await assertFails(getDocs(collection(db, "tenants", TENANT, "alunos")));
  });

  it("professor lista apenas com o filtro professorId == próprio uid", async () => {
    const db = dbAuth(PROF_A);
    const snap = await assertSucceeds(getDocs(query(
      collection(db, "tenants", TENANT, "alunos"),
      where("professorId", "==", PROF_A)
    )));
    expect(snap.docs.map((d) => d.id)).toEqual([ALUNO_A]);
  });

  it("professor não consegue listar filtrando pelo uid de OUTRO professor", async () => {
    const db = dbAuth(PROF_A);
    await assertFails(getDocs(query(
      collection(db, "tenants", TENANT, "alunos"),
      where("professorId", "==", PROF_B)
    )));
  });

  // 2
  it("professor lê o aluno vinculado a ele e é negado no aluno de outro professor", async () => {
    const db = dbAuth(PROF_A);
    await assertSucceeds(getDoc(doc(db, "tenants", TENANT, "alunos", ALUNO_A)));
    await assertFails(getDoc(doc(db, "tenants", TENANT, "alunos", ALUNO_B)));
    // Aluno sem professor nenhum: o disjunto compara com '' e nunca bate num uid.
    await assertFails(getDoc(doc(db, "tenants", TENANT, "alunos", ALUNO_SEM)));
  });

  // 3
  it("professor NÃO escreve em nenhum campo de alunos (nem do aluno dele)", async () => {
    const db = dbAuth(PROF_A);
    await assertFails(updateDoc(doc(db, "tenants", TENANT, "alunos", ALUNO_A), {
      mensalidadeStatus: "pago",
      mensalidadeAtualizadoEm: serverTimestamp()
    }));
    await assertFails(updateDoc(doc(db, "tenants", TENANT, "alunos", ALUNO_A), {
      nome: "Nome trocado pelo professor",
      telefone: ALUNO_VALIDO.telefone,
      nascimento: ALUNO_VALIDO.nascimento,
      faixa: "Preta",
      email: ALUNO_VALIDO.email
    }));
    // Auto-atribuição: puxar um aluno de outro professor pra si.
    await assertFails(updateDoc(doc(db, "tenants", TENANT, "alunos", ALUNO_B), {
      professorId: PROF_A,
      professorAtribuidoEm: serverTimestamp()
    }));
    await assertFails(updateDoc(doc(db, "tenants", TENANT, "alunos", ALUNO_SEM), {
      professorId: PROF_A,
      professorAtribuidoEm: serverTimestamp()
    }));
  });
});

describe("professores/ e memberships/: write:false para todo cliente", () => {
  // 4
  it("nem admin, nem professor, nem aluno escrevem em professores/", async () => {
    const novo = { nome: "Auto promovido", email: "x@example.com", status: "ativo", ehAlunoTambem: false };

    await assertFails(setDoc(doc(dbAuth(ADMIN), "tenants", TENANT, "professores", NAO_PROFESSOR), novo));
    await assertFails(setDoc(doc(dbAuth(PROF_A), "tenants", TENANT, "professores", NAO_PROFESSOR), novo));
    await assertFails(setDoc(doc(dbAuth(ALUNO_A), "tenants", TENANT, "professores", ALUNO_A), novo));
    // Nem mesmo mexer no próprio registro (trocar o equipeId, por exemplo).
    await assertFails(updateDoc(doc(dbAuth(PROF_A), "tenants", TENANT, "professores", PROF_A), {
      equipeId: "equipeQualquer"
    }));
  });

  it("nem admin, nem professor, nem aluno escrevem em memberships/", async () => {
    const membership = { role: "professor", status: "ativo" };

    await assertFails(setDoc(doc(dbAuth(ADMIN), "tenants", TENANT, "memberships", NAO_PROFESSOR), membership));
    await assertFails(setDoc(doc(dbAuth(PROF_A), "tenants", TENANT, "memberships", PROF_A), membership));
    await assertFails(setDoc(doc(dbAuth(ALUNO_A), "tenants", TENANT, "memberships", ALUNO_A), membership));
    // Auto-promoção pelo espelho users/{uid}/memberships/{tenantId} também é negada.
    await assertFails(setDoc(doc(dbAuth(ALUNO_A), "users", ALUNO_A, "memberships", TENANT), membership));
  });

  it("professor lê o próprio registro; não lê o de outro professor", async () => {
    const db = dbAuth(PROF_A);
    await assertSucceeds(getDoc(doc(db, "tenants", TENANT, "professores", PROF_A)));
    await assertFails(getDoc(doc(db, "tenants", TENANT, "professores", PROF_B)));
    // Admin lê todos (é o que monta a tabela do card-professores).
    await assertSucceeds(getDoc(doc(dbAuth(ADMIN), "tenants", TENANT, "professores", PROF_B)));
  });
});

describe("admin: vínculo aluno→professor", () => {
  // 5
  it("admin vincula a professor existente e é negado em uid sem doc em professores/", async () => {
    const db = dbAuth(ADMIN);
    await assertSucceeds(updateDoc(doc(db, "tenants", TENANT, "alunos", ALUNO_SEM), {
      professorId: PROF_A,
      professorAtribuidoEm: serverTimestamp()
    }));
    // Referência órfã: uid real da academia, mas sem registro em professores/.
    await assertFails(updateDoc(doc(db, "tenants", TENANT, "alunos", ALUNO_SEM), {
      professorId: NAO_PROFESSOR,
      professorAtribuidoEm: serverTimestamp()
    }));
  });

  it("admin não escapa do hasOnly nem do carimbo de servidor", async () => {
    const db = dbAuth(ADMIN);
    // Sem o carimbo == request.time.
    await assertFails(updateDoc(doc(db, "tenants", TENANT, "alunos", ALUNO_SEM), {
      professorId: PROF_A,
      professorAtribuidoEm: new Date("2020-01-01")
    }));
    // Misturar vínculo com mensalidade na mesma escrita: são disjuntos separados.
    await assertFails(updateDoc(doc(db, "tenants", TENANT, "alunos", ALUNO_SEM), {
      professorId: PROF_A,
      professorAtribuidoEm: serverTimestamp(),
      mensalidadeStatus: "pago",
      mensalidadeAtualizadoEm: serverTimestamp()
    }));
  });

  // 6
  it("admin remove o vínculo com FieldValue.delete()", async () => {
    const db = dbAuth(ADMIN);
    await assertSucceeds(updateDoc(doc(db, "tenants", TENANT, "alunos", ALUNO_A), {
      professorId: deleteField(),
      professorAtribuidoEm: serverTimestamp()
    }));
  });
});

describe("regressões do papel professor", () => {
  // 7
  it("professor que também é aluno continua fazendo check-in e editando o próprio cadastro", async () => {
    const db = dbAuth(PROF_A);

    await assertSucceeds(setDoc(doc(db, "tenants", TENANT, "checkins", checkinIdValido(PROF_A)), {
      alunoId: PROF_A,
      nome: "Ana Souza",
      lat: CHECKIN_LAT,
      lng: CHECKIN_LNG,
      timestamp: serverTimestamp(),
      tenantId: TENANT
    }));

    await assertSucceeds(updateDoc(doc(db, "tenants", TENANT, "alunos", PROF_A), {
      nome: "Ana Souza Lima",
      telefone: "15999998888",
      nascimento: ALUNO_VALIDO.nascimento,
      faixa: "Preta",
      email: "ana@example.com"
    }));

    // E continua lendo os eventos, como qualquer aluno da academia.
    await assertSucceeds(getDocs(collection(db, "tenants", TENANT, "eventos")));
  });

  // 8
  it("professor não lê credenciais nem cobranças de terceiros", async () => {
    const db = dbAuth(PROF_A);
    await assertFails(getDoc(doc(db, "tenants", TENANT, "config", "credenciais")));
    await assertFails(getDoc(doc(db, "tenants", TENANT, "cobrancas", ALUNO_B + "_2026-09")));
    await assertFails(getDocs(collection(db, "tenants", TENANT, "cobrancas")));
    // config/geral continua legível (é o que diz o modo de mensalidade da academia).
    await assertSucceeds(getDoc(doc(db, "tenants", TENANT, "config", "geral")));
  });
});
