import { test, expect } from "@playwright/test";

test("landing direciona para aquisição e conclui checkout mockado", async ({ page }) => {
  await page.route("http://127.0.0.1:8787/assinatura-dojopass", async (route) => {
    const body = route.request().postDataJSON();
    expect(body.academia).toBe("Dojo Teste");
    expect(body.slugDesejado).toBe("dojo-teste");

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        valor: 99,
        assinaturaId: "sub_mock",
        pagamentoId: "pay_mock",
        checkoutUrl: "https://sandbox.asaas.com/i/mock",
        pixCopiaECola: "00020101021226880014br.gov.bcb.pix",
        pixQrCodeBase64: "",
        mensagem: "Assinatura criada. Conclua o pagamento inicial para ativarmos sua academia."
      })
    });
  });

  await page.goto(process.env.BASE_URL || "http://127.0.0.1:8010/");

  await expect(page.getByRole("link", { name: "Adquirir", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Entrar", exact: true })).toHaveCount(0);

  await page.getByRole("link", { name: "Adquirir", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Assine o DojoPass por R$ 99/mês." })).toBeVisible();

  await page.getByLabel("Nome da academia").fill("Dojo Teste");
  await page.getByLabel("Responsável").fill("Tainá Vidal");
  await page.getByLabel("E-mail").fill("teste@dojopass.com.br");
  await page.getByLabel("Telefone").fill("(11) 99999-9999");
  await page.getByLabel("CPF ou CNPJ").fill("11.444.777/0001-61");
  await page.getByLabel("Subdomínio desejado").fill("Dojo Teste");

  await expect(page.getByLabel("Subdomínio desejado")).toHaveValue("dojo-teste");

  await page.getByRole("button", { name: "Assinar por R$ 99/mês" }).click();

  await expect(page.getByText("Assinatura criada. Conclua o pagamento inicial")).toBeVisible();
  await expect(page.getByText("Pix gerado com sucesso")).toBeVisible();
  await expect(page.locator("#pix-code")).toHaveValue(/000201/);
  await expect(page.getByRole("link", { name: "Abrir pagamento" })).toHaveAttribute("href", "https://sandbox.asaas.com/i/mock");
});
