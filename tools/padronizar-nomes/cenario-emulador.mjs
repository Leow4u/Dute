#!/usr/bin/env node
/**
 * Cenário sintético para validar o relatório no emulador do Firestore: grava
 * uma família da BTG com os nomes fora do padrão, roda relatorio.mjs contra o
 * emulador e confere o CSV. Recusa rodar fora de 127.0.0.1 (nunca toca a nuvem).
 *
 *   npx firebase-tools emulators:exec --only firestore --project demo-nomes \
 *     "node tools/padronizar-nomes/cenario-emulador.mjs"
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const host = process.env.FIRESTORE_EMULATOR_HOST ?? "";
if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) {
  console.error(`FIRESTORE_EMULATOR_HOST precisa apontar para o emulador local (está "${host}").`);
  process.exit(2);
}
const PROJETO = "demo-nomes";
process.env.GCLOUD_PROJECT = PROJETO;
process.env.GOOGLE_CLOUD_PROJECT = PROJETO;
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
process.env.METADATA_SERVER_DETECTION = "none";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const requireWms = createRequire(path.join(raiz, "functions", "wms", "package.json"));
const { initializeApp } = requireWms("firebase-admin/app");
const { getFirestore } = requireWms("firebase-admin/firestore");
const db = getFirestore(initializeApp({ projectId: PROJETO }));

const sku = (id, codigo, produto, extra = {}) => ({ sku_code: id, cod_btg: id, customer_code: "BTG Pactual", cod_cliente: codigo, cod_cliente_key: codigo.toUpperCase(), produto, genero: "Masculino", categoria: "POLO", estoque_atual: 10, status: "active", archived: false, ...extra });
const familia = [
  ["BTG-000121", "A.01.0806.005.PP", "Polo masculino piquet preto"],
  ["BTG-000122", "A.01.0806.005.P", "Polo masculino piquet preto p"],
  ["BTG-000123", "A.01.0806.005.M", "Polo masculino piquet preto m"],
  ["BTG-000124", "A.01.0806.005.G", "Polo masculino piquet preto G"],
  ["BTG-000125", "A.01.0806.005.GG", "POLO MASCULINO PIQUET PRETO GG"],
  ["BTG-000126", "A.01.0806.005.XG", "Polo masculino piquet preto - XG"],
  ["BTG-000127", "A.01.0806.005.XGG", "Polo masculina piquet preto XGG"],
];
const lote = db.batch();
for (const [id, codigo, produto] of familia) {
  lote.set(db.collection("skus").doc(id), sku(id, codigo, produto));
  lote.set(db.collection("products").doc(codigo), { id: codigo, customer_code: "BTG Pactual", cod_cliente: codigo, cod_cliente_key: codigo.toUpperCase(), produto, genero: "Masculino", archived: false, status: "active" });
}
lote.set(db.collection("skus").doc("BTG-000998"), sku("BTG-000998", "C.0659.001.U", "Toalha de academia", { genero: "Outros", tamanho: "U" }));
lote.set(db.collection("products").doc("C.0659.001.U"), { id: "C.0659.001.U", customer_code: "BTG Pactual", cod_cliente: "C.0659.001.U", produto: "Toalha de academia" });
lote.set(db.collection("skus").doc("BTG-000999"), sku("BTG-000999", "A.01.0806.005.EG", "Polo masculino piquet preto EG", { archived: true, status: "archived" }));
await lote.commit();

const saida = path.join(raiz, "tmp", "cenario-emulador-nomes.csv");
const json = JSON.parse(
  execFileSync(process.execPath, [path.join(raiz, "tools", "padronizar-nomes", "relatorio.mjs"), "--projeto", PROJETO, "--json", "--saida", saida], {
    encoding: "utf8",
    env: process.env,
  }),
);
assert.equal(json.resumo.skus_lidos, 9);
assert.equal(json.resumo.products_lidos, 8);
assert.equal(json.resumo.arquivados_ignorados, 1);
assert.equal(json.resumo.linhas, 8);
assert.deepEqual(json.resumo.por_decisao, { aprovar: 8 });
const csv = readFileSync(saida, "utf8");
const linhas = csv.slice(1).trim().split("\r\n");
assert.equal(linhas.length, 9, "cabeçalho + 8 linhas");
assert.ok(linhas[1].startsWith("BTG Pactual;A.01.0806.005;A.01.0806.005.PP;BTG-000121;Polo masculino piquet preto;Polo Masculino Piquet Preto;"), linhas[1]);
assert.ok(linhas.slice(1, 8).every((l) => l.includes(";Polo Masculino Piquet Preto;")), "os sete tamanhos com o mesmo nome");
assert.ok(linhas[8].includes(";Toalha de Academia;"), linhas[8]);
console.log(`Cenário no emulador ok: ${json.resumo.linhas} linhas, ${json.resumo.familias} famílias, CSV em ${saida}`);
process.exit(0);
