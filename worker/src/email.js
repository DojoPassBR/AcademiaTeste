// Cliente mínimo do Resend — só o necessário pro lembrete de mensalidade por e-mail.
//
// Mesmo padrão de worker/src/asaas.js: o corpo da resposta de erro do provedor pode
// carregar detalhes da conta/credencial, então vai SÓ pro console.error. A exceção que
// sobe pro index.js leva mensagem genérica, porque ela pode virar resposta HTTP.
//
// O e-mail é enviado como TEXTO PURO (campo "text", nunca "html"). O corpo é montado a
// partir de config/geral.lembreteTemplate, que é texto livre escrito pelo admin — em
// texto puro não existe injeção de HTML, então não é preciso sanitizar nada.

/**
 * POST https://api.resend.com/emails
 * @returns {Promise<{id: string|null}>} id da mensagem no Resend
 */
async function enviarEmail(env, { para, assunto, texto }) {
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + env.RESEND_API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: env.EMAIL_REMETENTE,
      to: [para],
      subject: assunto,
      text: texto
    })
  });

  if (!resp.ok) {
    let corpo = "";
    try {
      corpo = await resp.text();
    } catch (err) {
      corpo = "(corpo ilegível)";
    }
    // Nunca logar o endereço do aluno junto — só status e corpo do provedor.
    console.error("Falha no Resend ao enviar e-mail:", resp.status, corpo);
    throw new Error("Falha ao enviar e-mail.");
  }

  const dados = await resp.json().catch(() => null);
  return { id: dados && dados.id ? String(dados.id) : null };
}

// ---------------------------------------------------------------------------
// ATENÇÃO: esta é a MESMA lógica de preencherTemplate() em app/firebase-init.js.
// O Worker não pode importar o arquivo do cliente (módulo de browser, servido pelo
// GitHub Pages), então a função está duplicada aqui de propósito. Se uma mudar, a
// outra PRECISA acompanhar — senão o lembrete por e-mail e o do WhatsApp passam a
// gerar textos diferentes a partir do mesmo template de config/geral.
// ---------------------------------------------------------------------------
const PLACEHOLDERS_LEMBRETE = ["nome", "mes", "valor", "academia", "pix"];

function preencherTemplate(template, dados) {
  if (typeof template !== "string") return "";
  const valores = dados && typeof dados === "object" ? dados : {};
  let saida = template;
  PLACEHOLDERS_LEMBRETE.forEach((chave) => {
    const bruto = valores[chave];
    const valor = bruto === undefined || bruto === null ? "" : String(bruto);
    saida = saida.split("{" + chave + "}").join(valor);
  });
  return saida;
}

export { enviarEmail, preencherTemplate, PLACEHOLDERS_LEMBRETE };
