import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import {
  doc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  updateDoc,
  collection,
  serverTimestamp
} from "firebase/firestore";
import { criarAmbiente, semear, semearAdmin, semearAluno } from "./setup.js";

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

// IDs no formato real usado pelo Worker: "<alunoId>_<mesReferencia>" (ver CONTEXT.md,
// seção "Migração Mercado Pago → Asaas") — antes eram IDs de payment do Mercado Pago.
const MES = "2026-09";
const COBRANCA_ALUNO = ALUNO_UID + "_" + MES;
const COBRANCA_OUTRO = OUTRO_UID + "_" + MES;

async function semearCobrancas() {
  await semear(ambiente, async (db) => {
    await setDoc(doc(db, "cobrancas", COBRANCA_ALUNO), {
      alunoId: ALUNO_UID,
      valor: 150,
      mesReferencia: MES,
      status: "pendente"
    });
    await setDoc(doc(db, "cobrancas", COBRANCA_OUTRO), {
      alunoId: OUTRO_UID,
      valor: 150,
      mesReferencia: MES,
      status: "pendente"
    });
  });
}

describe("admins — cliente nunca escreve", () => {
  it("usuário comum não cria documento em admins", async () => {
    const db = ambiente.authenticatedContext(ALUNO_UID).firestore();
    await assertFails(setDoc(doc(db, "admins", ALUNO_UID), { promovido: true }));
  });

  it("nem mesmo um admin já existente escreve em admins", async () => {
    await semearAdmin(ambiente, ADMIN_UID);
    const db = ambiente.authenticatedContext(ADMIN_UID).firestore();
    await assertFails(setDoc(doc(db, "admins", OUTRO_UID), { promovido: true }));
    await assertFails(deleteDoc(doc(db, "admins", ADMIN_UID)));
  });

  it("admin lê o próprio documento e não o de outro", async () => {
    await semearAdmin(ambiente, ADMIN_UID);
    await semearAdmin(ambiente, OUTRO_UID);
    const db = ambiente.authenticatedContext(ADMIN_UID).firestore();
    await assertSucceeds(getDoc(doc(db, "admins", ADMIN_UID)));
    await assertFails(getDoc(doc(db, "admins", OUTRO_UID)));
  });
});

// Cobrança manual válida: ID = "<alunoId>_<mesReferencia>", origem 'manual',
// status 'pendente' e criadoEm carimbado pelo servidor (a rule exige request.time).
function cobrancaManualValida(alunoId = ALUNO_UID, extras = {}) {
  return {
    alunoId,
    alunoNome: "João da Silva",
    valor: 150,
    mesReferencia: MES,
    status: "pendente",
    origem: "manual",
    criadoPorUid: ADMIN_UID,
    criadoEm: serverTimestamp(),
    ...extras
  };
}

async function semearCobrancaManual() {
  await semear(ambiente, async (db) => {
    await setDoc(doc(db, "cobrancas", COBRANCA_ALUNO), {
      alunoId: ALUNO_UID,
      alunoNome: "João da Silva",
      valor: 150,
      mesReferencia: MES,
      status: "pendente",
      origem: "manual",
      criadoPorUid: ADMIN_UID,
      criadoEm: new Date()
    });
  });
}

// Estado em que o Worker deixa a cobrança depois do upload do comprovante (POST
// /comprovante). Semeado com privilégios de admin porque o Worker usa service account e
// não passa pelas rules.
async function semearCobrancaAguardando() {
  await semear(ambiente, async (db) => {
    await setDoc(doc(db, "cobrancas", COBRANCA_ALUNO), {
      alunoId: ALUNO_UID,
      alunoNome: "João da Silva",
      valor: 150,
      mesReferencia: MES,
      status: "aguardando_confirmacao",
      origem: "manual",
      comprovantePath: "comprovantes/" + ALUNO_UID + "/" + COBRANCA_ALUNO + ".pdf",
      comprovanteContentType: "application/pdf",
      comprovanteEnviadoEm: new Date(),
      criadoPorUid: ADMIN_UID,
      criadoEm: new Date()
    });
  });
}

describe("cobrancas — só o Worker escreve", () => {
  it("cliente nunca escreve em cobrancas, nem sendo admin", async () => {
    await semearAdmin(ambiente, ADMIN_UID);

    const dbAluno = ambiente.authenticatedContext(ALUNO_UID).firestore();
    await assertFails(
      setDoc(doc(dbAluno, "cobrancas", "forjada"), { alunoId: ALUNO_UID, status: "pago" })
    );

    const dbAdmin = ambiente.authenticatedContext(ADMIN_UID).firestore();
    await assertFails(
      setDoc(doc(dbAdmin, "cobrancas", "forjada"), { alunoId: ALUNO_UID, status: "pago" })
    );
  });

  it("aluno lê a própria cobrança e não a de outro", async () => {
    await semearCobrancas();
    const db = ambiente.authenticatedContext(ALUNO_UID).firestore();
    await assertSucceeds(getDoc(doc(db, "cobrancas", COBRANCA_ALUNO)));
    await assertFails(getDoc(doc(db, "cobrancas", COBRANCA_OUTRO)));
  });

  it("admin lê todas as cobranças", async () => {
    await semearCobrancas();
    await semearAdmin(ambiente, ADMIN_UID);
    const db = ambiente.authenticatedContext(ADMIN_UID).firestore();
    const snap = await assertSucceeds(getDocs(collection(db, "cobrancas")));
    expect(snap.size).toBe(2);
  });
});

describe("cobrancas manuais — admin cria/edita direto, sem Worker", () => {
  it("admin cria cobrança manual válida", async () => {
    await semearAdmin(ambiente, ADMIN_UID);
    await semearAluno(ambiente, ALUNO_UID);
    const db = ambiente.authenticatedContext(ADMIN_UID).firestore();
    await assertSucceeds(
      setDoc(doc(db, "cobrancas", COBRANCA_ALUNO), cobrancaManualValida())
    );
  });

  it("aluno não cria cobrança nenhuma, nem manual", async () => {
    await semearAluno(ambiente, ALUNO_UID);
    const db = ambiente.authenticatedContext(ALUNO_UID).firestore();
    await assertFails(
      setDoc(doc(db, "cobrancas", COBRANCA_ALUNO), {
        ...cobrancaManualValida(),
        criadoPorUid: ALUNO_UID
      })
    );
  });

  it("admin não cria cobrança com origem 'asaas' (só o Worker cria essas)", async () => {
    await semearAdmin(ambiente, ADMIN_UID);
    await semearAluno(ambiente, ALUNO_UID);
    const db = ambiente.authenticatedContext(ADMIN_UID).firestore();
    await assertFails(
      setDoc(doc(db, "cobrancas", COBRANCA_ALUNO), cobrancaManualValida(ALUNO_UID, { origem: "asaas" }))
    );
  });

  it("admin não cria cobrança já paga, nem com valor fora da faixa", async () => {
    await semearAdmin(ambiente, ADMIN_UID);
    await semearAluno(ambiente, ALUNO_UID);
    const db = ambiente.authenticatedContext(ADMIN_UID).firestore();
    await assertFails(
      setDoc(doc(db, "cobrancas", COBRANCA_ALUNO), cobrancaManualValida(ALUNO_UID, { status: "pago" }))
    );
    await assertFails(
      setDoc(doc(db, "cobrancas", COBRANCA_ALUNO), cobrancaManualValida(ALUNO_UID, { valor: 99999 }))
    );
  });

  it("admin não cria cobrança com ID fora do padrão <alunoId>_<mes> nem pra aluno inexistente", async () => {
    await semearAdmin(ambiente, ADMIN_UID);
    await semearAluno(ambiente, ALUNO_UID);
    const db = ambiente.authenticatedContext(ADMIN_UID).firestore();

    await assertFails(setDoc(doc(db, "cobrancas", "id-qualquer"), cobrancaManualValida()));
    // Aluno OUTRO_UID não foi semeado: o exists() da rule barra.
    await assertFails(
      setDoc(doc(db, "cobrancas", COBRANCA_OUTRO), cobrancaManualValida(OUTRO_UID))
    );
  });

  it("admin não edita cobrança de origem 'asaas' (nem uma antiga, sem o campo)", async () => {
    await semearCobrancas(); // semeadas sem 'origem' → contam como 'asaas'
    await semearAdmin(ambiente, ADMIN_UID);
    const db = ambiente.authenticatedContext(ADMIN_UID).firestore();
    await assertFails(
      updateDoc(doc(db, "cobrancas", COBRANCA_ALUNO), {
        status: "pago",
        atualizadoEm: serverTimestamp()
      })
    );
  });

  it("admin atualiza o status de uma cobrança manual existente", async () => {
    await semearCobrancaManual();
    await semearAdmin(ambiente, ADMIN_UID);
    const db = ambiente.authenticatedContext(ADMIN_UID).firestore();
    await assertSucceeds(
      updateDoc(doc(db, "cobrancas", COBRANCA_ALUNO), {
        status: "pago",
        atualizadoEm: serverTimestamp()
      })
    );
  });

  it("admin não muda alunoId nem origem numa cobrança manual (hasOnly do update)", async () => {
    await semearCobrancaManual();
    await semearAdmin(ambiente, ADMIN_UID);
    const db = ambiente.authenticatedContext(ADMIN_UID).firestore();

    await assertFails(
      updateDoc(doc(db, "cobrancas", COBRANCA_ALUNO), {
        alunoId: OUTRO_UID,
        atualizadoEm: serverTimestamp()
      })
    );
    await assertFails(
      updateDoc(doc(db, "cobrancas", COBRANCA_ALUNO), {
        origem: "asaas",
        atualizadoEm: serverTimestamp()
      })
    );
  });

  it("aluno não atualiza a própria cobrança manual", async () => {
    await semearCobrancaManual();
    const db = ambiente.authenticatedContext(ALUNO_UID).firestore();
    await assertFails(
      updateDoc(doc(db, "cobrancas", COBRANCA_ALUNO), {
        status: "pago",
        atualizadoEm: serverTimestamp()
      })
    );
  });

  it("admin confirma pagamento de cobrança com comprovante (aguardando_confirmacao → pago)", async () => {
    await semearCobrancaAguardando();
    await semearAdmin(ambiente, ADMIN_UID);
    const db = ambiente.authenticatedContext(ADMIN_UID).firestore();
    await assertSucceeds(
      updateDoc(doc(db, "cobrancas", COBRANCA_ALUNO), {
        status: "pago",
        confirmadoPorUid: ADMIN_UID,
        confirmadoEm: serverTimestamp(),
        atualizadoEm: serverTimestamp()
      })
    );
  });

  it("admin não grava confirmadoPorUid de outro uid", async () => {
    await semearCobrancaAguardando();
    await semearAdmin(ambiente, ADMIN_UID);
    const db = ambiente.authenticatedContext(ADMIN_UID).firestore();
    await assertFails(
      updateDoc(doc(db, "cobrancas", COBRANCA_ALUNO), {
        status: "pago",
        confirmadoPorUid: OUTRO_UID,
        confirmadoEm: serverTimestamp(),
        atualizadoEm: serverTimestamp()
      })
    );
  });

  it("admin não reescreve os campos de comprovante gravados pelo Worker", async () => {
    await semearCobrancaAguardando();
    await semearAdmin(ambiente, ADMIN_UID);
    const db = ambiente.authenticatedContext(ADMIN_UID).firestore();
    await assertFails(
      updateDoc(doc(db, "cobrancas", COBRANCA_ALUNO), {
        comprovantePath: "comprovantes/outro/arquivo.pdf",
        atualizadoEm: serverTimestamp()
      })
    );
  });

  it("aluno não atualiza cobrancas pelo SDK, nem a própria com comprovante enviado", async () => {
    await semearCobrancaAguardando();
    const db = ambiente.authenticatedContext(ALUNO_UID).firestore();

    await assertFails(
      updateDoc(doc(db, "cobrancas", COBRANCA_ALUNO), {
        status: "pago",
        atualizadoEm: serverTimestamp()
      })
    );
    // Nem o próprio rastro de comprovante — quem grava isso é o Worker (service account).
    await assertFails(
      updateDoc(doc(db, "cobrancas", COBRANCA_ALUNO), {
        status: "aguardando_confirmacao",
        comprovantePath: "comprovantes/" + ALUNO_UID + "/forjado.pdf",
        atualizadoEm: serverTimestamp()
      })
    );
    await assertFails(
      updateDoc(doc(db, "cobrancas", COBRANCA_ALUNO), {
        confirmadoPorUid: ALUNO_UID,
        confirmadoEm: serverTimestamp(),
        status: "pago",
        atualizadoEm: serverTimestamp()
      })
    );
  });

  it("ninguém apaga cobrança, nem admin", async () => {
    await semearCobrancaManual();
    await semearAdmin(ambiente, ADMIN_UID);
    const db = ambiente.authenticatedContext(ADMIN_UID).firestore();
    await assertFails(deleteDoc(doc(db, "cobrancas", COBRANCA_ALUNO)));
  });
});

describe("config/geral", () => {
  it("admin grava mensalidadeModo dentro do enum", async () => {
    await semearAdmin(ambiente, ADMIN_UID);
    const db = ambiente.authenticatedContext(ADMIN_UID).firestore();
    await assertSucceeds(setDoc(doc(db, "config", "geral"), { mensalidadeModo: "pix" }));
    await assertSucceeds(
      setDoc(doc(db, "config", "geral"), {
        mensalidadeModo: "manual",
        valorMensalidadePadrao: 150
      })
    );
  });

  it("aceita o modo pixManual", async () => {
    await semearAdmin(ambiente, ADMIN_UID);
    const db = ambiente.authenticatedContext(ADMIN_UID).firestore();
    await assertSucceeds(setDoc(doc(db, "config", "geral"), { mensalidadeModo: "pixManual" }));
  });

  it("recusa mensalidadeModo fora do enum", async () => {
    await semearAdmin(ambiente, ADMIN_UID);
    const db = ambiente.authenticatedContext(ADMIN_UID).firestore();
    await assertFails(setDoc(doc(db, "config", "geral"), { mensalidadeModo: "boleto" }));
    await assertFails(setDoc(doc(db, "config", "geral"), { mensalidadeModo: "pix-manual" }));
  });

  it("admin grava os campos novos de academia e lembrete", async () => {
    await semearAdmin(ambiente, ADMIN_UID);
    const db = ambiente.authenticatedContext(ADMIN_UID).firestore();
    await assertSucceeds(
      setDoc(doc(db, "config", "geral"), {
        mensalidadeModo: "pixManual",
        valorMensalidadePadrao: 180,
        academiaNome: "Academia Exemplo",
        pixChaveManual: "00020126580014BR.GOV.BCB.PIX0136chave-pix-da-academia",
        lembreteWhatsappAtivo: true,
        lembreteEmailAtivo: false,
        lembreteVisualAtivo: true,
        lembreteDiasParaAlerta: 5,
        lembreteTemplate: "Olá {nome}, a mensalidade de {mes} da {academia} (R$ {valor}) vence em breve. Pix: {pix}"
      })
    );
  });

  it("recusa tipo errado nos campos novos", async () => {
    await semearAdmin(ambiente, ADMIN_UID);
    const db = ambiente.authenticatedContext(ADMIN_UID).firestore();

    await assertFails(
      setDoc(doc(db, "config", "geral"), {
        mensalidadeModo: "pixManual",
        lembreteDiasParaAlerta: "5"
      })
    );
    await assertFails(
      setDoc(doc(db, "config", "geral"), {
        mensalidadeModo: "pixManual",
        lembreteWhatsappAtivo: "sim"
      })
    );
    await assertFails(
      setDoc(doc(db, "config", "geral"), {
        mensalidadeModo: "pixManual",
        academiaNome: "A".repeat(81)
      })
    );
    await assertFails(
      setDoc(doc(db, "config", "geral"), {
        mensalidadeModo: "pixManual",
        pixChaveManual: "P".repeat(201)
      })
    );
    await assertFails(
      setDoc(doc(db, "config", "geral"), {
        mensalidadeModo: "pixManual",
        lembreteTemplate: "T".repeat(501)
      })
    );
  });

  it("recusa lembreteDiasParaAlerta fora da faixa 1..60", async () => {
    await semearAdmin(ambiente, ADMIN_UID);
    const db = ambiente.authenticatedContext(ADMIN_UID).firestore();
    await assertFails(
      setDoc(doc(db, "config", "geral"), { mensalidadeModo: "manual", lembreteDiasParaAlerta: 0 })
    );
    await assertFails(
      setDoc(doc(db, "config", "geral"), { mensalidadeModo: "manual", lembreteDiasParaAlerta: 61 })
    );
  });

  // asaasDiasAvisoAntesVencimento é só o gatilho VISUAL do painel (destaque quando faltam
  // N dias pro vencimento de uma cobrança Asaas). O prazo de vencimento em si continua
  // sendo ASAAS_DUE_DATE_DIAS, var fixa do worker/wrangler.toml — este campo não muda
  // cobrança nenhuma nem dispara envio algum.
  it("admin grava asaasDiasAvisoAntesVencimento dentro da faixa 1..30", async () => {
    await semearAdmin(ambiente, ADMIN_UID);
    const db = ambiente.authenticatedContext(ADMIN_UID).firestore();
    await assertSucceeds(
      setDoc(doc(db, "config", "geral"), {
        mensalidadeModo: "pix",
        asaasDiasAvisoAntesVencimento: 5
      })
    );
    await assertSucceeds(
      setDoc(doc(db, "config", "geral"), {
        mensalidadeModo: "pix",
        asaasDiasAvisoAntesVencimento: 1
      })
    );
    await assertSucceeds(
      setDoc(doc(db, "config", "geral"), {
        mensalidadeModo: "pix",
        asaasDiasAvisoAntesVencimento: 30
      })
    );
  });

  it("recusa asaasDiasAvisoAntesVencimento fora da faixa 1..30", async () => {
    await semearAdmin(ambiente, ADMIN_UID);
    const db = ambiente.authenticatedContext(ADMIN_UID).firestore();
    await assertFails(
      setDoc(doc(db, "config", "geral"), {
        mensalidadeModo: "pix",
        asaasDiasAvisoAntesVencimento: 0
      })
    );
    await assertFails(
      setDoc(doc(db, "config", "geral"), {
        mensalidadeModo: "pix",
        asaasDiasAvisoAntesVencimento: 31
      })
    );
  });

  it("recusa asaasDiasAvisoAntesVencimento com tipo errado (string ou float)", async () => {
    await semearAdmin(ambiente, ADMIN_UID);
    const db = ambiente.authenticatedContext(ADMIN_UID).firestore();
    await assertFails(
      setDoc(doc(db, "config", "geral"), {
        mensalidadeModo: "pix",
        asaasDiasAvisoAntesVencimento: "5"
      })
    );
    await assertFails(
      setDoc(doc(db, "config", "geral"), {
        mensalidadeModo: "pix",
        asaasDiasAvisoAntesVencimento: 5.5
      })
    );
  });

  it("não-admin não grava asaasDiasAvisoAntesVencimento", async () => {
    const db = ambiente.authenticatedContext(ALUNO_UID).firestore();
    await assertFails(
      setDoc(doc(db, "config", "geral"), {
        mensalidadeModo: "pix",
        asaasDiasAvisoAntesVencimento: 5
      })
    );
  });

  it("recusa campo extra em config/geral (hasOnly)", async () => {
    await semearAdmin(ambiente, ADMIN_UID);
    const db = ambiente.authenticatedContext(ADMIN_UID).firestore();
    await assertFails(
      setDoc(doc(db, "config", "geral"), { mensalidadeModo: "pix", workerUrl: "http://evil" })
    );
  });

  it("recusa write em documento de config diferente de 'geral'", async () => {
    await semearAdmin(ambiente, ADMIN_UID);
    const db = ambiente.authenticatedContext(ADMIN_UID).firestore();
    await assertFails(setDoc(doc(db, "config", "outro"), { mensalidadeModo: "pix" }));
  });

  it("recusa write de quem não é admin", async () => {
    const db = ambiente.authenticatedContext(ALUNO_UID).firestore();
    await assertFails(setDoc(doc(db, "config", "geral"), { mensalidadeModo: "pix" }));
  });

  it("qualquer autenticado lê config/geral; anônimo não", async () => {
    await semear(ambiente, async (db) => {
      await setDoc(doc(db, "config", "geral"), { mensalidadeModo: "manual" });
    });

    const dbAluno = ambiente.authenticatedContext(ALUNO_UID).firestore();
    await assertSucceeds(getDoc(doc(dbAluno, "config", "geral")));

    const dbAnon = ambiente.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(dbAnon, "config", "geral")));
  });
});
