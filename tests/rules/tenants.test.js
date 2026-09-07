import { describe, it, beforeAll, beforeEach, afterAll, expect } from "vitest";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, getDocs, collection, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { criarAmbiente, semear, ALUNO_VALIDO } from "./setup.js";

const TENANT_A = "jairo";
const TENANT_B = "outra-academia";
const ADMIN_A = "admin000000000000000001";
const ADMIN_B = "admin000000000000000002";
const ALUNO_A = "aluno000000000000000001";
const ALUNO_SEM_MEMBERSHIP = "aluno000000000000000099";

let ambiente;

function dbAuth(uid) {
  return ambiente.authenticatedContext(uid).firestore();
}

async function semearTenantBase() {
  await semear(ambiente, async (db) => {
    await setDoc(doc(db, "tenants", TENANT_A), { tenantSlug: TENANT_A, nome: "Jairo", status: "ativo" });
    await setDoc(doc(db, "tenants", TENANT_B), { tenantSlug: TENANT_B, nome: "Outra", status: "ativo" });
    await setDoc(doc(db, "tenantSlugs", TENANT_A), { tenantId: TENANT_A, tenantSlug: TENANT_A, status: "ativo" });
    await setDoc(doc(db, "tenantDomains", "jairo.dojopass.com.br"), { tenantId: TENANT_A, tenantSlug: TENANT_A, status: "ativo" });
    await setDoc(doc(db, "tenants", TENANT_A, "memberships", ADMIN_A), { role: "admin", status: "ativo" });
    await setDoc(doc(db, "tenants", TENANT_B, "memberships", ADMIN_B), { role: "admin", status: "ativo" });
    await setDoc(doc(db, "tenants", TENANT_A, "memberships", ALUNO_A), { role: "aluno", status: "ativo" });
    await setDoc(doc(db, "users", ALUNO_A, "memberships", TENANT_A), { role: "aluno", status: "ativo", tenantSlug: TENANT_A });
    await setDoc(doc(db, "tenants", TENANT_A, "alunos", ALUNO_A), { ...ALUNO_VALIDO, mensalidadeStatus: "pago" });
  });
}

beforeAll(async () => {
  ambiente = await criarAmbiente();
});

beforeEach(async () => {
  await ambiente.clearFirestore();
  await semearTenantBase();
});

afterAll(async () => {
  await ambiente.cleanup();
});

describe("tenant resolver público", () => {
  it("visitante lê slug/domínio ativo, mas não escreve", async () => {
    const db = ambiente.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(db, "tenantSlugs", TENANT_A)));
    await assertSucceeds(getDoc(doc(db, "tenantDomains", "jairo.dojopass.com.br")));
    await assertFails(setDoc(doc(db, "tenantSlugs", "evil"), { tenantId: "evil", status: "ativo" }));
  });

  it("visitante não lê resolver suspenso", async () => {
    await semear(ambiente, async (db) => {
      await setDoc(doc(db, "tenantSlugs", "suspenso"), { tenantId: "suspenso", tenantSlug: "suspenso", status: "suspenso" });
    });
    const db = ambiente.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, "tenantSlugs", "suspenso")));
  });

  it("visitante não lê resolver aguardando pagamento", async () => {
    await semear(ambiente, async (db) => {
      await setDoc(doc(db, "tenantSlugs", "nova-academia"), {
        tenantId: "nova-academia",
        tenantSlug: "nova-academia",
        status: "aguardando_pagamento"
      });
      await setDoc(doc(db, "tenantDomains", "nova-academia.dojopass.com.br"), {
        tenantId: "nova-academia",
        tenantSlug: "nova-academia",
        status: "aguardando_pagamento"
      });
    });
    const db = ambiente.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, "tenantSlugs", "nova-academia")));
    await assertFails(getDoc(doc(db, "tenantDomains", "nova-academia.dojopass.com.br")));
  });

  it("visitante não lê o documento raiz do tenant", async () => {
    const db = ambiente.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, "tenants", TENANT_A)));
  });

  it("índice Asaas é privado para qualquer cliente", async () => {
    await semear(ambiente, async (db) => {
      await setDoc(doc(db, "asaasPayments", "pay_123"), {
        tenantId: TENANT_A,
        alunoId: ALUNO_A,
        cobrancaId: ALUNO_A + "_2026-09"
      });
    });

    const visitante = ambiente.unauthenticatedContext().firestore();
    const admin = dbAuth(ADMIN_A);
    await assertFails(getDoc(doc(visitante, "asaasPayments", "pay_123")));
    await assertFails(getDoc(doc(admin, "asaasPayments", "pay_123")));
  });

  it("aluno/admin não leem o documento raiz do tenant", async () => {
    await assertFails(getDoc(doc(dbAuth(ALUNO_A), "tenants", TENANT_A)));
    await assertFails(getDoc(doc(dbAuth(ADMIN_A), "tenants", TENANT_A)));
  });
});

// REGRESSÃO DA CORREÇÃO 5 (scripts/migrate-global-to-tenant.mjs).
//
// A migração para tenants/{id}/... carimbava tenantId + migradoDeGlobal em TODOS os
// documentos copiados. Nas coleções lidas sem login pelo site institucional (turmas,
// equipe, horarios, academia/perfil) a rule valida o documento com keys().hasOnly([...])
// na LEITURA — e esses dois campos não estão na lista. Resultado: o documento migrado
// ficava ilegível pro visitante e o site da academia aparecia vazio.
//
// O script agora não grava esses campos nessas 4 coleções (o tenant já está no path).
// Se alguém reintroduzir o carimbo lá, o segundo teste abaixo quebra.
describe("leitura pública tenantizada (regressão da migração)", () => {
  const TURMA_PUBLICA = {
    nome: "Turma Infantil",
    nivel: "Infantil",
    cor: "white",
    ativo: true,
    ordem: 0,
    criadoPor: ADMIN_A,
    criadoEm: new Date()
  };

  it("visitante lê turma pública do tenant quando ela tem só os campos previstos", async () => {
    await semear(ambiente, async (db) => {
      await setDoc(doc(db, "tenants", TENANT_A, "turmas", "turma-ok"), TURMA_PUBLICA);
    });

    const db = ambiente.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(db, "tenants", TENANT_A, "turmas", "turma-ok")));
  });

  it("visitante NÃO lê turma com os campos extras tenantId/migradoDeGlobal", async () => {
    await semear(ambiente, async (db) => {
      await setDoc(doc(db, "tenants", TENANT_A, "turmas", "turma-migrada"), {
        ...TURMA_PUBLICA,
        tenantId: TENANT_A,
        migradoDeGlobal: true
      });
      await setDoc(doc(db, "tenants", TENANT_A, "equipe", "professor-migrado"), {
        tipo: "professor",
        nome: "Jairo",
        ativo: true,
        ordem: 0,
        criadoPor: ADMIN_A,
        criadoEm: new Date(),
        tenantId: TENANT_A,
        migradoDeGlobal: true
      });
      await setDoc(doc(db, "tenants", TENANT_A, "academia", "perfil"), {
        endereco: "Rua Teste, 100",
        atualizadoPor: ADMIN_A,
        atualizadoEm: new Date(),
        tenantId: TENANT_A,
        migradoDeGlobal: true
      });
    });

    const db = ambiente.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, "tenants", TENANT_A, "turmas", "turma-migrada")));
    await assertFails(getDoc(doc(db, "tenants", TENANT_A, "equipe", "professor-migrado")));
    await assertFails(getDoc(doc(db, "tenants", TENANT_A, "academia", "perfil")));
  });
});

describe("isolamento por tenant", () => {
  it("aluno lê o próprio cadastro no tenant A, mas não no tenant B", async () => {
    const db = dbAuth(ALUNO_A);
    await assertSucceeds(getDoc(doc(db, "tenants", TENANT_A, "alunos", ALUNO_A)));
    await assertFails(getDoc(doc(db, "tenants", TENANT_B, "alunos", ALUNO_A)));
  });

  it("admin do tenant A lista alunos do tenant A, mas não lista dados do tenant B", async () => {
    const db = dbAuth(ADMIN_A);
    const snap = await assertSucceeds(getDocs(collection(db, "tenants", TENANT_A, "alunos")));
    expect(snap.size).toBe(1);
    await assertFails(getDocs(collection(db, "tenants", TENANT_B, "alunos")));
  });

  it("admin do tenant B não altera cobrança do tenant A", async () => {
    await semear(ambiente, async (db) => {
      await setDoc(doc(db, "tenants", TENANT_A, "cobrancas", ALUNO_A + "_2026-09"), {
        alunoId: ALUNO_A,
        alunoNome: ALUNO_VALIDO.nome,
        valor: 120,
        mesReferencia: "2026-09",
        status: "pendente",
        origem: "manual",
        criadoPorUid: ADMIN_A,
        criadoEm: new Date(),
        atualizadoEm: new Date()
      });
    });

    const db = dbAuth(ADMIN_B);
    await assertFails(updateDoc(doc(db, "tenants", TENANT_A, "cobrancas", ALUNO_A + "_2026-09"), {
      status: "pago",
      atualizadoEm: serverTimestamp(),
      confirmadoPorUid: ADMIN_B,
      confirmadoEm: serverTimestamp()
    }));
  });

  it("config/credenciais do tenant continua invisível até para admin", async () => {
    await semear(ambiente, async (db) => {
      await setDoc(doc(db, "tenants", TENANT_A, "config", "credenciais"), { asaasApiKeyCipher: "cipher" });
    });
    const db = dbAuth(ADMIN_A);
    await assertFails(getDoc(doc(db, "tenants", TENANT_A, "config", "credenciais")));
    await assertFails(setDoc(doc(db, "tenants", TENANT_A, "config", "credenciais"), { asaasApiKeyCipher: "x" }));
  });

  it("documento de aluno sem membership ativa não autoriza acesso no tenant", async () => {
    await semear(ambiente, async (db) => {
      await setDoc(doc(db, "tenants", TENANT_A, "alunos", ALUNO_SEM_MEMBERSHIP), {
        ...ALUNO_VALIDO,
        email: "sem-membership@example.com",
        mensalidadeStatus: "pago"
      });
    });

    const db = dbAuth(ALUNO_SEM_MEMBERSHIP);
    await assertFails(getDoc(doc(db, "tenants", TENANT_A, "alunos", ALUNO_SEM_MEMBERSHIP)));
  });

  it("membership inativa não autoriza leitura nem check-in", async () => {
    await semear(ambiente, async (db) => {
      await setDoc(doc(db, "tenants", TENANT_A, "memberships", ALUNO_A), { role: "aluno", status: "inativo" });
      await setDoc(doc(db, "tenants", TENANT_A, "config", "geral"), {
        mensalidadeModo: "manual",
        checkinLat: -22.0,
        checkinLng: -47.0,
        checkinRaioMetros: 120
      });
    });

    const db = dbAuth(ALUNO_A);
    await assertFails(getDoc(doc(db, "tenants", TENANT_A, "alunos", ALUNO_A)));
    const janela = Math.floor(Date.now() / 5400000);
    await assertFails(setDoc(doc(db, "tenants", TENANT_A, "checkins", ALUNO_A + "_" + janela), {
      alunoId: ALUNO_A,
      nome: ALUNO_VALIDO.nome,
      lat: -22.0,
      lng: -47.0,
      timestamp: serverTimestamp(),
      tenantId: TENANT_A
    }));
  });

  it("cliente não cria nem altera memberships para elevar role", async () => {
    const dbAluno = dbAuth(ALUNO_A);
    await assertFails(setDoc(doc(dbAluno, "tenants", TENANT_A, "memberships", ALUNO_A), { role: "admin", status: "ativo" }));
    await assertFails(updateDoc(doc(dbAluno, "users", ALUNO_A, "memberships", TENANT_A), { role: "admin" }));

    const dbAdmin = dbAuth(ADMIN_A);
    await assertFails(setDoc(doc(dbAdmin, "tenants", TENANT_A, "memberships", ALUNO_SEM_MEMBERSHIP), { role: "admin", status: "ativo" }));
  });


  it("cliente não cria aluno direto no tenant; cadastro completo fica para o Worker", async () => {
    const db = dbAuth(ALUNO_SEM_MEMBERSHIP);
    await assertFails(setDoc(doc(db, "tenants", TENANT_A, "alunos", ALUNO_SEM_MEMBERSHIP), {
      ...ALUNO_VALIDO,
      email: "novo@example.com",
      criadoEm: serverTimestamp(),
      tenantId: TENANT_A
    }));
  });

  it("check-in usa geofence configurado no tenant", async () => {
    await semear(ambiente, async (db) => {
      await setDoc(doc(db, "tenants", TENANT_A, "config", "geral"), {
        mensalidadeModo: "manual",
        checkinLat: -22.0,
        checkinLng: -47.0,
        checkinRaioMetros: 120
      });
    });

    const db = dbAuth(ALUNO_A);
    const janela = Math.floor(Date.now() / 5400000);
    await assertSucceeds(setDoc(doc(db, "tenants", TENANT_A, "checkins", ALUNO_A + "_" + janela), {
      alunoId: ALUNO_A,
      nome: ALUNO_VALIDO.nome,
      lat: -22.0,
      lng: -47.0,
      timestamp: serverTimestamp(),
      tenantId: TENANT_A
    }));
  });

  // Os testes de "lista" acima cobrem list; estes cobrem GET de documento específico, que
  // é o caminho realmente perigoso: quem já sabe (ou adivinha) o ID de um documento não
  // precisa de permissão de list pra ler o conteúdo.
  it("admin do tenant B não LÊ documentos específicos do tenant A", async () => {
    const cobrancaId = ALUNO_A + "_2026-09";
    const janela = Math.floor(Date.now() / 5400000);
    const checkinId = ALUNO_A + "_" + janela;

    await semear(ambiente, async (db) => {
      await setDoc(doc(db, "tenants", TENANT_A, "config", "geral"), {
        mensalidadeModo: "manual",
        checkinLat: -22.0,
        checkinLng: -47.0,
        checkinRaioMetros: 120
      });
      await setDoc(doc(db, "tenants", TENANT_A, "eventos", "evento-a"), {
        nome: "Campeonato",
        data: "2026-10-01",
        local: "Ginásio",
        criadoPor: ADMIN_A,
        criadoEm: new Date()
      });
      await setDoc(doc(db, "tenants", TENANT_A, "checkins", checkinId), {
        alunoId: ALUNO_A,
        nome: ALUNO_VALIDO.nome,
        lat: -22.0,
        lng: -47.0,
        timestamp: new Date(),
        tenantId: TENANT_A
      });
      await setDoc(doc(db, "tenants", TENANT_A, "cobrancas", cobrancaId), {
        alunoId: ALUNO_A,
        alunoNome: ALUNO_VALIDO.nome,
        valor: 120,
        mesReferencia: "2026-09",
        status: "pendente",
        origem: "manual",
        criadoPorUid: ADMIN_A,
        criadoEm: new Date()
      });
    });

    const db = dbAuth(ADMIN_B);
    await assertFails(getDoc(doc(db, "tenants", TENANT_A, "alunos", ALUNO_A)));
    await assertFails(getDoc(doc(db, "tenants", TENANT_A, "config", "geral")));
    await assertFails(getDoc(doc(db, "tenants", TENANT_A, "eventos", "evento-a")));
    await assertFails(getDoc(doc(db, "tenants", TENANT_A, "checkins", checkinId)));
    await assertFails(getDoc(doc(db, "tenants", TENANT_A, "cobrancas", cobrancaId)));
  });

  it("aluno do tenant A não lê nada do tenant B", async () => {
    const cobrancaId = ALUNO_A + "_2026-09";

    await semear(ambiente, async (db) => {
      await setDoc(doc(db, "tenants", TENANT_B, "alunos", ALUNO_A), { ...ALUNO_VALIDO, email: "b@example.com" });
      await setDoc(doc(db, "tenants", TENANT_B, "config", "geral"), { mensalidadeModo: "manual" });
      await setDoc(doc(db, "tenants", TENANT_B, "eventos", "evento-b"), {
        nome: "Interno B",
        data: "2026-11-01",
        local: "Tatame",
        criadoPor: ADMIN_B,
        criadoEm: new Date()
      });
      await setDoc(doc(db, "tenants", TENANT_B, "cobrancas", cobrancaId), {
        alunoId: ALUNO_A,
        alunoNome: ALUNO_VALIDO.nome,
        valor: 120,
        mesReferencia: "2026-09",
        status: "pendente",
        origem: "manual",
        criadoPorUid: ADMIN_B,
        criadoEm: new Date()
      });
    });

    // Existe até um documento tenants/B/alunos/{ALUNO_A} com o MESMO uid — o que barra a
    // leitura não é o ID do documento, é a ausência de membership ativa no tenant B.
    const db = dbAuth(ALUNO_A);
    await assertFails(getDoc(doc(db, "tenants", TENANT_B, "alunos", ALUNO_A)));
    await assertFails(getDoc(doc(db, "tenants", TENANT_B, "config", "geral")));
    await assertFails(getDoc(doc(db, "tenants", TENANT_B, "eventos", "evento-b")));
    await assertFails(getDoc(doc(db, "tenants", TENANT_B, "cobrancas", cobrancaId)));
    await assertFails(getDoc(doc(db, "tenants", TENANT_B, "memberships", ALUNO_A)));
  });

  it("check-in tenantizado falha se a academia não configurou geofence", async () => {
    const db = dbAuth(ALUNO_A);
    const janela = Math.floor(Date.now() / 5400000);
    await assertFails(setDoc(doc(db, "tenants", TENANT_A, "checkins", ALUNO_A + "_" + janela), {
      alunoId: ALUNO_A,
      nome: ALUNO_VALIDO.nome,
      lat: -23.58810289825024,
      lng: -48.067638301537485,
      timestamp: serverTimestamp(),
      tenantId: TENANT_A
    }));
  });
});
