import { patchDocument } from "./firestore.js";
import { criarPagamentoPix, consultarPagamento } from "./mercadopago.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS }
  });
}

function credenciaisFaltando(env) {
  const faltando = ["MP_ACCESS_TOKEN", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY"].filter((k) => !env[k]);
  return faltando.length ? faltando : null;
}

async function handleCriarCobranca(request, env) {
  const faltando = credenciaisFaltando(env);
  if (faltando) {
    return json({ erro: "Worker ainda não configurado. Faltam os segredos: " + faltando.join(", ") }, 501);
  }

  const body = await request.json();
  const { alunoId, alunoNome, valor, mesReferencia } = body;

  if (!alunoId || !alunoNome || !valor || valor <= 0 || !mesReferencia) {
    return json({ erro: "Campos obrigatórios: alunoId, alunoNome, valor, mesReferencia." }, 400);
  }

  const pagamento = await criarPagamentoPix(env, { alunoId, alunoNome, valor, mesReferencia });

  await patchDocument(env, "cobrancas/" + pagamento.id, {
    alunoId,
    alunoNome,
    valor,
    mesReferencia,
    status: "pendente",
    pixCopiaECola: pagamento.pixCopiaECola,
    pixQrCodeBase64: pagamento.pixQrCodeBase64,
    mpPaymentId: pagamento.id,
    criadoEm: new Date()
  });

  return json({ ok: true, pixCopiaECola: pagamento.pixCopiaECola });
}

async function handleWebhookMercadoPago(request, env) {
  const faltando = credenciaisFaltando(env);
  if (faltando) return json({ erro: "Worker ainda não configurado." }, 501);

  const url = new URL(request.url);
  let paymentId = url.searchParams.get("data.id") || url.searchParams.get("id");

  if (!paymentId) {
    const body = await request.json().catch(() => ({}));
    paymentId = body?.data?.id;
  }

  if (!paymentId) return json({ ok: true }); // notificação que não é de pagamento; só confirma recebimento

  // Nunca confia no conteúdo da notificação em si — sempre confirma o status direto na API do Mercado Pago.
  const pagamento = await consultarPagamento(env, paymentId);

  if (pagamento.status === "approved") {
    const alunoId = pagamento.external_reference;

    await patchDocument(env, "cobrancas/" + paymentId, {
      status: "pago",
      pagoEm: new Date()
    });

    if (alunoId) {
      await patchDocument(env, "alunos/" + alunoId, {
        mensalidadeStatus: "pago",
        mensalidadeAtualizadoEm: new Date()
      });
    }
  }

  return json({ ok: true });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const { pathname } = new URL(request.url);

    try {
      if (pathname === "/criar-cobranca" && request.method === "POST") {
        return await handleCriarCobranca(request, env);
      }
      if (pathname === "/webhook-mercadopago" && request.method === "POST") {
        return await handleWebhookMercadoPago(request, env);
      }
      if (pathname === "/" && request.method === "GET") {
        return json({ status: "ok", service: "academiateste-financeiro" });
      }
      return json({ erro: "Rota não encontrada." }, 404);
    } catch (err) {
      return json({ erro: String(err.message || err) }, 500);
    }
  }
};
