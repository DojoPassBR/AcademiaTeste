document.getElementById("year").textContent = new Date().getFullYear();

const checkoutForm = document.getElementById("checkout-form");
const checkoutMessage = document.getElementById("checkout-message");
const pixResult = document.getElementById("pix-result");
const pixQr = document.getElementById("pix-qr");
const pixCode = document.getElementById("pix-code");
const checkoutLink = document.getElementById("checkout-link");

const WORKER_URL = window.DOJOPASS_WORKER_URL || (
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://127.0.0.1:8787"
    : "https://academiateste-financeiro.arnaldohungria.workers.dev"
);

function setCheckoutMessage(text, type) {
  checkoutMessage.textContent = text;
  checkoutMessage.className = "checkout-message show " + type;
}

function normalizarSlug(valor) {
  return valor
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

if (checkoutForm) {
  const slugInput = document.getElementById("academy-slug");
  slugInput.addEventListener("input", () => {
    slugInput.value = normalizarSlug(slugInput.value);
  });

  checkoutForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = checkoutForm.querySelector("button[type='submit']");
    const formData = new FormData(checkoutForm);
    const payload = Object.fromEntries(formData.entries());

    button.disabled = true;
    button.textContent = "Gerando assinatura...";
    pixResult.hidden = true;
    setCheckoutMessage("Conectando com o Asaas para gerar sua assinatura.", "info");

    try {
      const response = await fetch(WORKER_URL + "/assinatura-dojopass", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.erro || "Não foi possível gerar a assinatura.");

      setCheckoutMessage(data.mensagem || "Assinatura criada com sucesso.", "success");
      pixResult.hidden = false;
      if (data.pixQrCodeBase64) {
        pixQr.src = "data:image/png;base64," + data.pixQrCodeBase64;
        pixQr.hidden = false;
      } else {
        pixQr.hidden = true;
      }
      pixCode.value = data.pixCopiaECola || "Código Pix ainda não disponível. Use o link de pagamento ou entre em contato.";
      if (data.checkoutUrl) {
        checkoutLink.href = data.checkoutUrl;
        checkoutLink.hidden = false;
      } else {
        checkoutLink.hidden = true;
      }
    } catch (err) {
      setCheckoutMessage(err.message || "Não foi possível gerar a assinatura. Entre em contato com a DojoPass.", "error");
    } finally {
      button.disabled = false;
      button.textContent = "Assinar por R$ 99/mês";
    }
  });
}
