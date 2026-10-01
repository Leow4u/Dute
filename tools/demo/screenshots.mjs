// Gera capturas de tela do app em modo demo (dados fictícios).
//
// Pré-requisitos (ver docs/modo-demo.md):
//   1. emuladores rodando:  firebase emulators:start --project demo-dute --only firestore,auth
//   2. seed aplicado:       npm --prefix functions run demo:seed  (com *_EMULATOR_HOST)
//   3. app em modo demo:    VITE_DEMO_MODE=true corepack pnpm --filter "@workspace/btg-inventory" run dev
//
// Uso: NODE_PATH="$(npm root -g)" node tools/demo/screenshots.mjs [pasta-de-saida]
// O Playwright não é dependência do repositório: use uma instalação global
// (npm i -g playwright). Variáveis: DEMO_APP_URL (padrão http://localhost:5173).
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

// require (e não import) para respeitar NODE_PATH.
const { chromium } = createRequire(import.meta.url)("playwright");

const APP_URL = process.env.DEMO_APP_URL ?? "http://localhost:5173";
const OUT_DIR = path.resolve(process.argv[2] ?? "tmp/demo-screenshots");
const PASSWORD = "demo-dute-2026";
const ASSET_HOST = "https://demo-assets.dutelog.local";

const SHOTS = [
  {
    user: "cliente@demo.dutelog.com.br",
    pages: [
      ["01-portal-inicio", "/portal"],
      ["02-portal-estoque", "/portal/estoque"],
      ["04-portal-pedidos", "/portal/pedidos"],
      ["05-portal-faturas", "/portal/faturas"],
    ],
  },
  {
    user: "operacao@demo.dutelog.com.br",
    pages: [
      ["06-interno-inicio", "/dashboard"],
      ["07-interno-estoque", "/estoque"],
      ["08-interno-pedidos", "/pedidos"],
      ["09-interno-solicitacoes", "/solicitacoes"],
      ["10-interno-movimentacoes", "/movements"],
    ],
  },
];

// Ilustrações das fotos dos itens demo, servidas no lugar do host fictício.
const PALETTE = {
  "DM-10": ["#E8EEF7", "#1F3A5F"],
  "DM-20": ["#F3EEE6", "#6B4F2A"],
};
const LABELS = {
  "DM-1001": "Polo M",
  "DM-1002": "Polo G",
  "DM-1003": "Camisa",
  "DM-1004": "Moletom",
  "DM-1005": "Jaqueta",
  "DM-1006": "Boné",
  "DM-1007": "Mochila",
  "DM-1008": "Garrafa",
  "DM-1009": "Caderno",
  "DM-1010": "Caneta",
  "DM-1011": "Guarda-chuva",
  "DM-2001": "Mesa bistrô",
  "DM-2002": "Banqueta",
  "DM-2003": "Balcão",
  "DM-2004": "Backdrop",
};

function illustration(sku) {
  const [bg, fg] = PALETTE[sku.slice(0, 5)] ?? ["#EEF0F2", "#3A4450"];
  const label = LABELS[sku] ?? sku;
  // Quadrado com o conteúdo no centro: o app recorta com object-cover tanto
  // na miniatura quanto no card largo.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480" viewBox="0 0 480 480">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="#FFFFFF"/>
  </linearGradient></defs>
  <rect width="480" height="480" fill="url(#g)"/>
  <text x="240" y="250" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="44" font-weight="700" fill="${fg}">${label}</text>
  <text x="240" y="290" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="22" fill="${fg}" opacity="0.55">${sku}</text>
</svg>`;
}

// O canal em tempo real do Firestore nunca deixa a rede ociosa, então
// networkidle não serve: espera o DOM e um intervalo fixo para skeletons e
// animações de entrada.
async function settle(page) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(3500);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const { user, pages } of SHOTS) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
        locale: "pt-BR",
        timezoneId: "America/Sao_Paulo",
      });
      await context.route(`${ASSET_HOST}/**`, (route) => {
        const sku = path.basename(new URL(route.request().url()).pathname, ".svg");
        return route.fulfill({
          status: 200,
          contentType: "image/svg+xml",
          body: illustration(sku),
        });
      });
      const page = await context.newPage();
      await page.goto(`${APP_URL}/sign-in`, { waitUntil: "domcontentloaded" });
      await page.fill("#email", user);
      await page.fill("#senha", PASSWORD);
      await page.click('button[type="submit"]');
      await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), {
        timeout: 30_000,
      });
      await settle(page);

      for (const [name, route] of pages) {
        await page.goto(`${APP_URL}${route}`, { waitUntil: "domcontentloaded" });
        await settle(page);
        const file = path.join(OUT_DIR, `${name}.png`);
        await page.screenshot({ path: file });
        console.log(file);
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
