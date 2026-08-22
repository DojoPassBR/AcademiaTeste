// Cliente mínimo da API do Mercado Pago (Pix) — só o necessário pro módulo financeiro do DojoPass.

async function criarPagamentoPix(env, { alunoId, alunoNome, valor, mesReferencia }) {
  const resp = await fetch("https://api.mercadopago.com/v1/payments", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + env.MP_ACCESS_TOKEN,
      "Content-Type": "application/json",
      // Evita cobrar duas vezes se o admin clicar duas vezes sem querer.
      "X-Idempotency-Key": alunoId + "_" + mesReferencia
    },
    body: JSON.stringify({
      transaction_amount: valor,
      description: "Mensalidade " + mesReferencia + " - " + alunoNome,
      payment_method_id: "pix",
      external_reference: alunoId,
      payer: { email: alunoId + "@academiateste.invalid" } // MP exige e-mail do pagador; não usamos o e-mail real do aluno aqui
    })
  });

  if (!resp.ok) throw new Error("Falha ao criar pagamento Pix no Mercado Pago: " + (await resp.text()));

  const pagamento = await resp.json();
  const transactionData = pagamento.point_of_interaction?.transaction_data || {};

  return {
    id: String(pagamento.id),
    status: pagamento.status, // "pending" até ser pago
    pixCopiaECola: transactionData.qr_code || null,
    pixQrCodeBase64: transactionData.qr_code_base64 || null
  };
}

async function consultarPagamento(env, paymentId) {
  const resp = await fetch("https://api.mercadopago.com/v1/payments/" + paymentId, {
    headers: { Authorization: "Bearer " + env.MP_ACCESS_TOKEN }
  });

  if (!resp.ok) throw new Error("Falha ao consultar pagamento no Mercado Pago: " + (await resp.text()));
  return resp.json();
}

export { criarPagamentoPix, consultarPagamento };
