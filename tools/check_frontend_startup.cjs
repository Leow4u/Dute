#!/usr/bin/env node
// Executa o bundle de produção em Chromium sem entrar em nenhuma conta.
// Playwright é instalado somente no diretório temporário do runner.
const assert = require("node:assert/strict");
const { mkdir, writeFile } = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require(path.join(process.env.SMOKE_TOOL_DIR, "node_modules/playwright"));

async function main() {
  const baseUrl = process.argv[2];
  const output = process.argv[3];
  assert(baseUrl && output, "Uso: node tools/check_frontend_startup.cjs <url> <diretório de evidências>");
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const viewport of [{ name: "desktop", width: 1440, height: 900 }, { name: "mobile", width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport, serviceWorkers: "block" });
      const page = await context.newPage();
      const errors = [];
      const consoleErrors = [];
      const assets = [];
      page.on("pageerror", (error) => errors.push(error.stack || error.message));
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      page.on("response", (response) => {
        if (["script", "stylesheet"].includes(response.request().resourceType()) && response.status() >= 400) {
          assets.push(response.status() + " " + response.url());
        }
      });
      page.on("requestfailed", (request) => {
        if (["script", "stylesheet"].includes(request.resourceType())) {
          assets.push(request.url() + " " + request.failure()?.errorText);
        }
      });
      let failure;
      try {
        await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.getByRole("heading", { name: "Entrar", exact: true }).waitFor({ state: "visible", timeout: 20000 });
        const email = page.getByLabel("E-mail", { exact: true });
        const password = page.getByLabel("Senha", { exact: true });
        await email.fill("smoke@example.invalid");
        await password.fill("nao-enviar");
        assert.equal(await email.inputValue(), "smoke@example.invalid");
        assert.equal(await password.inputValue(), "nao-enviar");
        assert(await page.getByRole("button", { name: "Entrar", exact: true }).isEnabled(), "Login desabilitado");
        await email.fill("");
        await password.fill("");
        assert.equal(await page.locator("vite-error-overlay").count(), 0);
        assert.equal(errors.length, 0, "Erros JavaScript: " + errors.join("\n"));
        assert.equal(assets.length, 0, "Assets indisponíveis: " + assets.join("\n"));
        assert.equal(consoleErrors.length, 0, "Erros no console: " + consoleErrors.join("\n"));
      } catch (error) {
        failure = error;
      } finally {
        const evidence = {
          viewport: viewport.name, url: page.url(), title: await page.title(),
          body: (await page.locator("body").innerText()).slice(0, 2000),
          errors, consoleErrors, assets, failure: failure?.message || null,
        };
        await page.screenshot({ path: path.join(output, viewport.name + ".png"), fullPage: false });
        await writeFile(path.join(output, viewport.name + ".json"), JSON.stringify(evidence, null, 2));
        console.log(JSON.stringify(evidence));
        await context.close();
      }
      if (failure) throw failure;
    }
  } finally {
    await browser.close();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
