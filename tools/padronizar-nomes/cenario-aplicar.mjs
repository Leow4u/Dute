#!/usr/bin/env node
/**
 * Cenário sintético do passo 3 no emulador do Firestore: grava produtos fora
 * do padrão (com saldos, linhas da abertura e a projeção do portal), roda
 * aplicar.mjs sem gravar e gravando, e confere cada coleção, o recibo, o
 * evento, a retomada sem repetir, o SKU que mudou no meio e o cliente que não
 * é o do SKU. Recusa rodar fora de 127.0.0.1 (nunca toca a nuvem).
 *
 *   npx firebase-tools emulators:exec --only firestore --project demo-nomes \
 *     "node tools/padronizar-nomes/cenario-aplicar.mjs"
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
const { FieldValue, getFirestore } = requireWms("firebase-admin/firestore");
const db = getFirestore(initializeApp({ projectId: PROJETO }));
const { aplicarUm, OPERACAO } = await import("./aplicar.mjs");

const BTG = "BTG Pactual";
const sku = (id, codigo, produto, extra = {}) => ({ sku_code: id, customer_code: BTG, cod_cliente: codigo, cod_cliente_key: codigo.toUpperCase(), produto, genero: "Masculino", estoque_atual: 10, status: "active", archived: false, ...extra });
const product = (codigo, produto, extra = {}) => ({ id: codigo, customer_code: BTG, cod_cliente: codigo, cod_cliente_key: codigo.toUpperCase(), produto, status: "active", archived: false, ...extra });

const lote = db.batch();
const cadastro = [
  ["BTG-000104", "A.01.0809.002.PP", "POLO MASCULINO PIQUET ARPOARDOR PP", {}],
  ["BTG-000107", "A.01.0809.002.P", "POLO MASCULINA PIQUET ARPOARDOR P", { tamanho: "P" }],
  ["BTG-000075", "A.01.0809.002.M", "POLO MASCULINO PIQUET ARPOADOR M", { tamanho: "M" }],
  ["BTG-000203", "B.0003.006.U", "GARRAFA INOX - BTG", { genero: "", tamanho: "500ML" }],
  ["BTG-000201", "B.0790.005.U", "COPO CAFÉ - P", { genero: "" }],
  ["BTG-000202", "B.0791.005.U", "COPO CAFÉ - G", { genero: "" }],
];
for (const [id, codigo, produto, extra] of cadastro) {
  lote.set(db.collection("skus").doc(id), sku(id, codigo, produto, extra));
  lote.set(db.collection("products").doc(codigo), product(codigo, produto, extra.tamanho ? { tamanho: extra.tamanho } : {}));
}
// Cadastro antigo, com name e size no lugar de produto e tamanho.
lote.set(db.collection("skus").doc("BTG-000078"), { sku_code: "BTG-000078", customer_code: BTG, cod_cliente: "C.0659.001.U", cod_cliente_key: "C.0659.001.U", name: "toalha de academia", size: "ÚNICO", status: "active" });
// Arquivado: fica como está.
lote.set(db.collection("skus").doc("BTG-000999"), sku("BTG-000999", "A.01.0809.002.EG", "POLO MASCULINO PIQUET ARPOARDOR EG", { archived: true, status: "archived" }));
// Outro cliente com o mesmo código: o products dele não é do SKU da BTG.
lote.set(db.collection("skus").doc("PAN-000001"), sku("PAN-000001", "A.01.0809.002.PP", "Polo Masculino Piquet Arpoador", { customer_code: "PAN", tamanho: "PP" }));
lote.set(db.collection("products").doc("PAN__A.01.0809.002.PP"), product("A.01.0809.002.PP", "POLO PAN ANTIGO", { customer_code: "PAN" }));
// Saldos, linhas da abertura e a projeção do portal do PP.
lote.set(db.collection("stock_balances").doc("bal_pp_a01"), { customer_code: BTG, sku_code: "BTG-000104", client_item_code: "A.01.0809.002.PP", product_name: "POLO MASCULINO PIQUET ARPOARDOR PP", location_id: "A-01", qty_on_hand: 5 });
lote.set(db.collection("stock_balances").doc("bal_pp_a02"), { customer_code: BTG, sku_code: "BTG-000104", client_item_code: "A.01.0809.002.PP", product_name: "POLO MASCULINO PIQUET ARPOARDOR PP", location_id: "A-02", qty_on_hand: 3 });
lote.set(db.collection("opening_inventory_lines").doc("line_pp_1"), { customer_code: BTG, sku_code: "BTG-000104", product_name: "POLO MASCULINO PIQUET ARPOARDOR PP", box_code: "CX-000001", status: "committed" });
lote.set(db.collection("opening_inventory_lines").doc("line_pp_2"), { customer_code: BTG, sku_code: "BTG-000104", product_name: "POLO MASCULINO PIQUET ARPOARDOR PP", box_code: "CX-000002", status: "removed" });
lote.set(db.collection("client_inventory").doc("cinv_BTG_Pactual__BTG-000104"), { customer_code: BTG, sku_code: "BTG-000104", product_name: "POLO MASCULINO PIQUET ARPOARDOR PP", size: "", qty_on_hand: 8 });
await lote.commit();

const rodar = (...extra) =>
  JSON.parse(
    execFileSync(process.execPath, [path.join(raiz, "tools", "padronizar-nomes", "aplicar.mjs"), "--projeto", PROJETO, "--json", ...extra], { encoding: "utf8", env: process.env }),
  );
const dado = async (colecao, id) => (await db.collection(colecao).doc(id).get()).data();
const contar = async (colecao) => (await db.collection(colecao).where("source", "==", "script_padronizar_nomes").get()).size;

// 1. Só mostra: nada grava.
const mostra = rodar();
assert.equal(mostra.aplicar, false);
assert.equal(mostra.mudam, 7, JSON.stringify(mostra));
assert.equal(mostra.com_escolha, 5, "a família da Arpoador e os dois copos");
assert.deepEqual(mostra.fora, []);
assert.equal((await dado("skus", "BTG-000104")).produto, "POLO MASCULINO PIQUET ARPOARDOR PP");
assert.equal(await contar("events"), 0);

// 2. Grava.
const grava = rodar("--aplicar");
assert.equal(grava.resultado.renomeado, 7, JSON.stringify(grava.resultado));
assert.deepEqual([grava.resultado.fora, grava.resultado.erro], [[], []]);
for (const id of ["BTG-000104", "BTG-000107", "BTG-000075"]) assert.equal((await dado("skus", id)).produto, "Polo Masculino Piquet Arpoador", id);
assert.equal((await dado("skus", "BTG-000104")).tamanho, "PP", "o tamanho vem do código");
assert.equal((await dado("skus", "BTG-000104")).updated_by.uid, "script:padronizar-nomes");
assert.equal((await dado("products", "A.01.0809.002.PP")).produto, "Polo Masculino Piquet Arpoador");
assert.equal((await dado("products", "A.01.0809.002.PP")).tamanho, "PP");
assert.equal((await dado("products", "PAN__A.01.0809.002.PP")).produto, "POLO PAN ANTIGO", "o products de outro cliente não muda");
assert.equal((await dado("stock_balances", "bal_pp_a01")).product_name, "Polo Masculino Piquet Arpoador");
assert.equal((await dado("stock_balances", "bal_pp_a02")).product_name, "Polo Masculino Piquet Arpoador");
assert.equal((await dado("opening_inventory_lines", "line_pp_1")).product_name, "Polo Masculino Piquet Arpoador");
assert.equal((await dado("opening_inventory_lines", "line_pp_2")).product_name, "POLO MASCULINO PIQUET ARPOARDOR PP", "a linha removida fica como estava");
assert.deepEqual(
  [(await dado("client_inventory", "cinv_BTG_Pactual__BTG-000104")).product_name, (await dado("client_inventory", "cinv_BTG_Pactual__BTG-000104")).size],
  ["Polo Masculino Piquet Arpoador", "PP"],
);
assert.deepEqual([(await dado("skus", "BTG-000203")).produto, (await dado("skus", "BTG-000203")).tamanho], ["Garrafa Inox - BTG", "500ML"], "a capacidade fica");
assert.equal((await dado("skus", "BTG-000201")).produto, "Copo Café Pequeno");
assert.equal((await dado("skus", "BTG-000202")).produto, "Copo Café Grande");
const toalha = await dado("skus", "BTG-000078");
assert.deepEqual([toalha.produto, toalha.name, toalha.tamanho, toalha.size], ["Toalha de Academia", "Toalha de Academia", "U", "U"], "o cadastro antigo muda nos campos que tem");
assert.equal((await dado("skus", "BTG-000999")).produto, "POLO MASCULINO PIQUET ARPOARDOR EG", "o arquivado fica como estava");
assert.equal(await contar("events"), 7);
assert.equal(await contar("operational_operations"), 7);
const evento = (await db.collection("events").where("entity_id", "==", "BTG-000104").get()).docs[0].data();
assert.equal(evento.type, "catalog.renamed");
assert.deepEqual(evento.payload.antes, { produto: "POLO MASCULINO PIQUET ARPOARDOR PP", tamanho: null });
assert.deepEqual(evento.payload.depois, { produto: "Polo Masculino Piquet Arpoador", tamanho: "PP" });
assert.equal(evento.payload.escolha, true);
assert.equal((await dado("operational_operations", `${OPERACAO}_BTG-000104`)).kind, "padronizar_nomes.renomear");

// 3. De novo: nada a gravar, nada repetido.
const deNovo = rodar("--aplicar");
assert.equal(deNovo.mudam, 0, JSON.stringify(deNovo));
assert.equal(deNovo.resultado.renomeado, 0);
assert.deepEqual(deNovo.escolhas_sem_uso, ['nome "Polo Masculino Basica Preta"', 'nome "Copo Termico Thermocup"', 'nome "Lancheira Grande Az"'], "as escolhas aplicadas contam como achadas");
assert.equal(await contar("events"), 7);

// 4. Retomada com o plano antigo: o recibo impede repetir.
const antigo = { cliente: BTG, sku: "BTG-000104", codigo: "A.01.0809.002.PP", nome_hoje: "POLO MASCULINO PIQUET ARPOARDOR PP", tamanho_hoje: "", nome: "Polo Masculino Piquet Arpoador", tamanho: "PP", escolha: true };
assert.equal((await aplicarUm(db, FieldValue, antigo)).estado, "ja_aplicado");

// 5. O SKU que mudou entre a leitura e a gravação fica de fora, sem gravar nada.
await db.collection("skus").doc("BTG-000500").set(sku("BTG-000500", "A.01.0500.001.M", "CAMISA SOCIAL BRANCA M", { tamanho: "M" }));
const lido = { cliente: BTG, sku: "BTG-000500", codigo: "A.01.0500.001.M", nome_hoje: "CAMISA SOCIAL BRANCA M", tamanho_hoje: "M", nome: "Camisa Social Branca", tamanho: "M", escolha: false };
await db.collection("skus").doc("BTG-000500").update({ produto: "Camisa Social Branca Masculino" });
const mudou = await aplicarUm(db, FieldValue, lido);
assert.equal(mudou.estado, "fora");
assert.match(mudou.motivo, /mudou desde a leitura: "Camisa Social Branca Masculino"/);
assert.equal((await dado("skus", "BTG-000500")).produto, "Camisa Social Branca Masculino");
assert.equal(await contar("events"), 7);

console.log(`Cenário do passo 3 no emulador ok: ${grava.resultado.renomeado} renomeados, retomada sem repetir, SKU alterado no meio de fora.`);
process.exit(0);
