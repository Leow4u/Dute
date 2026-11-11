#!/usr/bin/env node
/**
 * Cenário no emulador do Firestore, com o fluxo de verdade do Receber por
 * caixa (as funções de domínio de functions/wms/lib). Recusa rodar fora de
 * 127.0.0.1 (nunca toca a nuvem).
 *
 * 1. O caso da produção (dry-run de 11/11/2026): a família masculina
 *    A.01.0810.002 já tem o M, com saldo em A-03; uma primeira chegada criou o
 *    A.02.0810.002.M (BTG-000213) e foi cancelada; a segunda usou o
 *    A.02.0810.002.M e a CX-000229 foi guardada em B-07. corrigir.mjs escolhe
 *    a transferência: dry-run sem gravar, gravação, o cadastro errado apagado,
 *    o código errado só no histórico, a retomada sem repetir e a operação
 *    seguindo (pedido, separação pela CX-000229, a feminina M de verdade
 *    entrando depois com outro SKU).
 * 2. A transferência com a caixa por guardar, com uma queda entre a saída e a
 *    entrada; 3. antes da entrada; 4. o SKU errado com outra vida, que não sai.
 * 5. No mesmo SKU, quando o código certo está livre: tudo o que o mesmo SKU
 *    grava, antes da guarda e antes da entrada.
 * 6. As recusas.
 *
 *   npm --prefix functions/wms ci && npm --prefix functions/wms run build
 *   cd functions/wms
 *   npx firebase-tools emulators:exec --only firestore --project demo-corrigir-codigo "node ../../tools/corrigir-codigo-do-produto/cenario-emulador.mjs"
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const host = process.env.FIRESTORE_EMULATOR_HOST ?? "";
if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) {
  console.error(`FIRESTORE_EMULATOR_HOST precisa apontar para o emulador local (está "${host}").`);
  process.exit(2);
}
const PROJETO = "demo-corrigir-codigo";
process.env.GCLOUD_PROJECT = PROJETO;
process.env.GOOGLE_CLOUD_PROJECT = PROJETO;
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
process.env.METADATA_SERVER_DETECTION = "none";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const wms = path.join(raiz, "functions", "wms");
const requireWms = createRequire(path.join(wms, "package.json"));
const { initializeApp } = requireWms("firebase-admin/app");
const { FieldPath, FieldValue, getFirestore } = requireWms("firebase-admin/firestore");
const db = getFirestore(initializeApp({ projectId: PROJETO }));
const dominio = (arquivo) => import(pathToFileURL(path.join(wms, "lib", "domain", arquivo)).href);
const operations = await dominio("operations.js");
const caixasDoRecebimento = await dominio("inbound-boxes.js");
const cancelamento = await dominio("inbound-cancel.js");
const posicoes = await dominio("warehouse-positions.js");
const separacao = await dominio("pick-progress.js");
const { ErroDaCorrecao, aplicar, idDoItemParado, idDoRecibo, leitorDoBanco, modoDaCorrecao, planejar, prepararNome } = await import("./corrigir.mjs");
const { aplicarTransferencia, lerTransferencia } = await import("./transferir.mjs");
const { CORRECOES } = await import("./correcoes.mjs");

const BTG = "BTG Pactual";
const guilherme = { uid: "wms-guilherme", name: "Guilherme", role: "wms", email: "guilherme@dutelog.com.br" };
const coordenacao = { uid: "ops-1", name: "Coordenação", role: "interno", email: "ops@dutelog.com.br" };
const cliente = { uid: "cli-1", name: "Cliente BTG", role: "cliente", customer_code: BTG };
const CAIXA = { length_m: 0.48, width_m: 0.38, height_m: 0.3, gross_weight_kg: 9.4 };
const FOTO = "https://firebasestorage.googleapis.com/v0/b/demo-corrigir-codigo.appspot.com/o/product-photos%2FBTG_Pactual%2Fpolo.jpg?alt=media";
const ERRADO = "A.02.0810.002.M";
const CERTO = "A.01.0810.002.M";
const FEMININA = "Polo Feminino Piquet Azul-Gralha";
const MASCULINA = "Polo Masculino Piquet Azul-Gralha";

let contador = 0;
const chave = (rotulo) => `${rotulo}-${String(++contador).padStart(4, "0")}`;
const dado = async (colecao, id) => (await db.collection(colecao).doc(id).get()).data();
const existe = async (colecao, id) => (await db.collection(colecao).doc(id).get()).exists;
const tamanho = (codigo) => codigo.split(".").pop();
const rev = async (codigo) => Number((await dado("warehouse_boxes", codigo))?.conference_revision ?? 0);
const doScript = async (colecao) => (await db.collection(colecao).where("source", "==", "script_corrigir_codigo_do_produto").get()).size;
const saldos = async (sku) => (await db.collection("stock_balances").where("sku_code", "==", sku).get()).docs.map((d) => [d.get("location_id"), d.get("qty_on_hand")]).sort();
const correcao = (id, de, para, caixas, extra = {}) => ({ id, cliente: BTG, de, para, caixas, genero: "Masculino", nome: "familia", referencia: "cenário", motivo: "Correção do cenário", decisao: "cenário", ...extra });

// --- O banco: layout, cliente, catálogo -----------------------------------------------

const limpar = await fetch(`http://${host}/emulator/v1/projects/${PROJETO}/databases/(default)/documents`, { method: "DELETE" });
assert.equal(limpar.ok, true, await limpar.text());
await posicoes.seedDefaultWarehouseLayout(db, coordenacao);
await posicoes.upsertWarehousePositions(
  db,
  {
    positions: [
      ...[3, 4].map((shelf) => ({ aisle: "A", shelf, length_m: 1.8, depth_m: 0.75, height_m: 0.65, customer_code: BTG })),
      ...[5, 6, 7, 8, 9, 10, 11, 12].map((shelf) => ({ aisle: "B", shelf, length_m: 1.8, depth_m: 0.75, height_m: 0.65, customer_code: BTG })),
      ...[1, 2, 3, 4, 5, 6].map((shelf) => ({ aisle: "C", shelf, length_m: 1.8, depth_m: 0.75, height_m: 0.65, customer_code: BTG })),
    ],
  },
  coordenacao,
);
const lote = db.batch();
lote.set(db.collection("customers").doc("btg"), { code: BTG, customer_code: BTG, name: BTG, sku_prefix: "BTG", status: "active", operation_template: "uniformes" });
lote.set(db.collection("sku_counters").doc("BTG"), { prefix: "BTG", customer_code: BTG, last: 212 });
lote.set(db.collection("warehouse_counters").doc("boxes"), { last: 228 });
const cadastro = [
  // A família masculina, como a produção mostrou: PP a XGG, um tamanho com o nome sem hífen.
  ["BTG-000140", "A.01.0810.002.PP", MASCULINA, "Masculino"],
  ["BTG-000141", "A.01.0810.002.P", MASCULINA, "Masculino"],
  ["BTG-000142", CERTO, MASCULINA, "Masculino"],
  ["BTG-000143", "A.01.0810.002.G", MASCULINA, "Masculino"],
  ["BTG-000144", "A.01.0810.002.GG", MASCULINA, "Masculino"],
  ["BTG-000145", "A.01.0810.002.XG", MASCULINA, "Masculino"],
  ["BTG-000146", "A.01.0810.002.XGG", "Polo Masculino Piquet Azul Gralha", "Masculino"],
  // Para o caminho no mesmo SKU: a família A.01.0830.001 sem o M.
  ["BTG-000150", "A.01.0830.001.P", "Polo Masculino Piquet Preto", "Masculino"],
  ["BTG-000151", "A.01.0830.001.G", "Polo Masculino Piquet Preto", "Masculino"],
  // Um SKU antigo, da abertura, e o código certo dele livre.
  ["BTG-000160", "A.02.0899.001.P", "Camisa Feminino Social Bege", "Feminino"],
];
for (const [id, codigo, produto, genero] of cadastro) {
  const comum = { customer_code: BTG, cod_cliente: codigo, cod_cliente_key: codigo, produto, genero, tamanho: tamanho(codigo), size: tamanho(codigo), category: "Uniformes", status: "active", archived: false, source: "opening_inventory" };
  lote.set(db.collection("skus").doc(id), { id, ...comum, cod_btg: id, sku_code: id, sku_code_key: id, estoque_atual: 0, estoque_reservado: 0, estoque_disponivel: 0 });
  lote.set(db.collection("products").doc(codigo), { id: codigo, ...comum, estoque_btg: 0, num_skus: 1 });
}
await lote.commit();
// O M masculino com 20 em A-03, a R$ 40, como veio da abertura.
await operations.createInventoryMovementTransaction(db, { type: "ENTRADA", quantity: 20, customer_code: BTG, sku_code: "BTG-000142", client_item_code: CERTO, product_name: MASCULINA, location_id: "A-03", reason: "Saldo da abertura", unit_cost: 40, idempotency_key: "abertura-m" }, coordenacao);

/**
 * Uma chegada por caixa pelo caminho da tela. `itens`: { codigo, nome, qtd, sku?, custo? }
 * (com `sku`, produto do cadastro; sem, produto novo). `caixas`: o que vai em cada
 * caixa, [[índice do item, quantidade]]; sem, uma caixa com tudo. `ate`: "criada"
 * (sem caixa), "fechada", "destino", "entrada" ou "guardada".
 */
async function chegada(itens, { caixas, ate = "guardada", prateleira = "B-07" } = {}) {
  const criada = await operations.createInboundReceiptTransaction(
    db,
    {
      customer_code: BTG,
      supplier: "Confecção Polo",
      invoice_number: String(48230 + contador),
      idempotency_key: chave("nf"),
      conference_mode: "per_box",
      items: itens.map((item, i) =>
        item.sku
          ? { line_number: i + 1, product_registration: "existing", sku_code: item.sku, client_item_code: item.codigo, product_name: item.nome, size: tamanho(item.codigo), location_id: "RECEBIMENTO", quantity: item.qtd, ...(item.custo ? { unit_cost: item.custo } : {}) }
          : { line_number: i + 1, product_registration: "new", client_item_code: item.codigo, product_name: item.nome, size: tamanho(item.codigo), category: "Uniformes", unit_cost: item.custo ?? 45.5, photo_urls: [FOTO], location_id: "RECEBIMENTO", quantity: item.qtd },
      ),
    },
    guilherme,
    { boxReceivingEnabled: true },
  );
  const receiptId = String(criada.receipt_id);
  const linhas = (await db.collection("inbound_items").where("receipt_id", "==", receiptId).get()).docs.sort((a, b) => a.get("line_number") - b.get("line_number"));
  const codigos = [];
  if (ate !== "criada") {
    for (const conteudo of caixas ?? [itens.map((item, i) => [i, item.qtd])]) {
      const codigo = String((await caixasDoRecebimento.startInboundBox(db, { receipt_id: receiptId, idempotency_key: chave("iniciar") }, guilherme)).box.code);
      for (const [i, qtd] of conteudo) {
        await caixasDoRecebimento.saveInboundBoxLine(db, { receipt_id: receiptId, box_code: codigo, inbound_item_id: linhas[i].id, counted_qty: qtd, expected_revision: await rev(codigo), idempotency_key: chave("linha") }, guilherme);
      }
      await caixasDoRecebimento.setInboundBoxState(db, { action: "close", receipt_id: receiptId, box_code: codigo, ...CAIXA, expected_revision: await rev(codigo), idempotency_key: chave("fechar") }, guilherme);
      if (ate !== "fechada") await destino(receiptId, codigo, prateleira);
      codigos.push(codigo);
    }
  }
  if (ate === "entrada" || ate === "guardada") await entrada(receiptId);
  if (ate === "guardada") for (const codigo of codigos) await guardar(receiptId, codigo, prateleira);
  return { receiptId, receiptNumber: String(criada.receipt_number), caixas: codigos, linhas: linhas.map((d) => d.id), skus: criada.items.map((i) => i.sku_code) };
}
async function destino(receiptId, codigo, prateleira) {
  await caixasDoRecebimento.confirmInboundBoxDestination(db, { receipt_id: receiptId, box_code: codigo, location_id: prateleira, expected_revision: await rev(codigo), idempotency_key: chave("destino") }, guilherme);
  await caixasDoRecebimento.recordInboundBoxLabelPrint(db, { receipt_id: receiptId, box_code: codigo, location_id: prateleira, idempotency_key: chave("etiqueta") }, guilherme);
}
const entrada = (receiptId) => caixasDoRecebimento.completeInboundBoxReceipt(db, { receipt_id: receiptId, expected_status: "created", idempotency_key: chave("entrada") }, guilherme);
const guardar = async (receiptId, codigo, prateleira) =>
  caixasDoRecebimento.storeInboundBox(db, { receipt_id: receiptId, box_code: codigo, location_id: prateleira, expected_revision: await rev(codigo), idempotency_key: chave("guardar") }, guilherme);
const pedidoDoPortal = async (sku, nome, quantidade) => {
  const pedido = await operations.createCustomerRequestTransaction(db, { type: "retirada", priority: "normal", title: "Pedido do cenário", customer_code: BTG, idempotency_key: chave("pedido"), items: [{ sku_code: sku, product_name: nome, quantity: quantidade }] }, cliente);
  return String(pedido.id);
};
const aprovar = (requestId) => operations.decideCustomerRequestTransaction(db, { request_id: requestId, action: "approve", expected_status: "open", idempotency_key: chave("aprovar") }, coordenacao);

const cli = path.join(raiz, "tools", "corrigir-codigo-do-produto", "corrigir.mjs");
const rodar = (...extra) => JSON.parse(execFileSync(process.execPath, [cli, "--projeto", PROJETO, "--json", ...extra], { encoding: "utf8", env: process.env }));

/** Onde um texto aparece no banco inteiro: coleção/documento:campo. */
async function ondeAparece(alvo) {
  const achados = [];
  const visitar = (valor, onde) => {
    if (typeof valor === "string") {
      if (valor.includes(alvo)) achados.push(onde);
    } else if (Array.isArray(valor)) valor.forEach((v, i) => visitar(v, `${onde}[${i}]`));
    else if (valor && typeof valor === "object" && typeof valor.toDate !== "function") for (const [k, v] of Object.entries(valor)) visitar(v, `${onde}.${k}`);
  };
  for (const colecao of await db.listCollections()) {
    for (const doc of (await colecao.get()).docs) {
      if (doc.id.includes(alvo)) achados.push(`${colecao.id}/${doc.id}`);
      visitar(doc.data(), `${colecao.id}/${doc.id}:`);
    }
  }
  return achados;
}
const historico = (onde) => /^(movements|events|operational_operations)\//.test(onde) || /:\.acerto_codigo\./.test(onde);

// --- 1. O caso da produção: CX-000229 --------------------------------------------------

// A primeira chegada cria o A.02.0810.002.M (BTG-000213) e é cancelada antes de qualquer caixa.
const primeira = await chegada([{ codigo: ERRADO, nome: FEMININA, qtd: 12 }], { ate: "criada" });
assert.equal(primeira.skus[0], "BTG-000213");
await cancelamento.cancelInboundReceiptTransaction(db, { receipt_id: primeira.receiptId, customer_code: BTG, expected_status: "created", reason: "mistake", idempotency_key: chave("cancelar") }, guilherme);
// A segunda usa o A.02.0810.002.M que ficou, com o G masculino, na CX-000229 guardada em B-07.
const segunda = await chegada([
  { codigo: ERRADO, nome: FEMININA, qtd: 12, sku: "BTG-000213", custo: 45.5 },
  { codigo: "A.01.0810.002.G", nome: MASCULINA, qtd: 10, sku: "BTG-000143" },
]);
assert.deepEqual(segunda.caixas, ["CX-000229"]);
assert.equal((await dado("warehouse_boxes", "CX-000229")).status, "stored");
assert.equal((await dado("skus", "BTG-000213")).source_receipt_id, primeira.receiptId, "o SKU errado nasceu na primeira chegada, como na produção");
assert.deepEqual(await saldos("BTG-000213"), [["B-07", 12], ["RECEBIMENTO", 0]]);
const recebidas = async () => (await db.collection("movements").where("source", "==", "wms_receiving").get()).docs.reduce((s, d) => s + Number(d.get("quantity")), 0);
const pecasDeEntrada = await recebidas();
assert.equal(pecasDeEntrada, 22);

// Dry-run: a transferência, sem gravar.
assert.equal(await modoDaCorrecao(leitorDoBanco(), db, CORRECOES[0]), "transferencia");
const contarTudo = async () => Promise.all(["events", "movements", "operational_operations", "skus", "products", "stock_balances"].map(async (c) => (await db.collection(c).get()).size));
const antes = await contarTudo();
const mostra = rodar().correcoes[0];
assert.equal(mostra.modo, "transferencia");
assert.equal(mostra.estado, "a_gravar", JSON.stringify(mostra));
assert.equal(mostra.sku, "BTG-000213");
assert.deepEqual(mostra.alvo, { sku: "BTG-000142", codigo: CERTO, nome: MASCULINA, tamanho: "M" });
assert.ok(mostra.estado_hoje.some((l) => l.includes(`nasceu na chegada ${primeira.receiptNumber}`) && l.includes("cancelada")), mostra.estado_hoje.join("\n"));
assert.ok(mostra.estado_hoje.some((l) => l.startsWith("SKU certo BTG-000142") && l.includes("A-03 20")), mostra.estado_hoje.join("\n"));
assert.deepEqual(mostra.grava.slice(0, 2), [
  "SAIDA 12 de BTG-000213 (A.02.0810.002.M) em B-07 · Ajuste −, não cobra",
  "ENTRADA 12 em BTG-000142 (A.01.0810.002.M) em B-07 · Ajuste +, não cobra",
]);
assert.ok(mostra.grava.some((l) => l.startsWith("apaga o cadastro errado BTG-000213") && l.includes(`a linha 1 da chegada cancelada ${primeira.receiptNumber} passa para BTG-000142`)), mostra.grava.join("\n"));
assert.deepEqual(await contarTudo(), antes, "o dry-run não grava");
console.log(execFileSync(process.execPath, [cli, "--projeto", PROJETO], { encoding: "utf8", env: process.env }));

// Grava.
const movimentosDaSegunda = (await db.collection("movements").where("sku_code", "==", "BTG-000213").get()).docs.map((d) => JSON.stringify(d.data())).sort();
const grava = rodar("--aplicar").correcoes[0];
assert.equal(grava.estado, "corrigido", JSON.stringify(grava));
assert.equal(grava.resultado.apagado, true, JSON.stringify(grava.resultado));
// O cadastro errado saiu inteiro; o código e o SKU não aparecem fora do histórico.
for (const [colecao, id] of [["skus", "BTG-000213"], ["products", ERRADO], ["client_inventory", "cinv_BTG_Pactual__BTG-000213"], ["catalog_prices", "cprice_BTG_Pactual__BTG-000213"]]) {
  assert.equal(await existe(colecao, id), false, `${colecao}/${id} saiu`);
}
assert.deepEqual(await saldos("BTG-000213"), [], "os saldos zerados saem");
// O certo: 20 em A-03 e 12 em B-07, no portal, no cartão e no preço guardado.
assert.deepEqual(await saldos("BTG-000142"), [["A-03", 20], ["B-07", 12]]);
const portal = await dado("client_inventory", "cinv_BTG_Pactual__BTG-000142");
assert.deepEqual([portal.client_item_code, portal.product_name, portal.qty_on_hand, portal.qty_available], [CERTO, MASCULINA, 32, 32]);
assert.equal((await dado("products", CERTO)).estoque_btg, 32);
assert.equal((await dado("skus", "BTG-000142")).estoque_atual, 32);
const preco = await dado("catalog_prices", "cprice_BTG_Pactual__BTG-000142");
assert.deepEqual([preco.preco_unit, preco.total_cost], [45.5, 800 + 12 * 45.5], "o valor das 12 peças foi junto");
// A caixa, a tarefa de guarda e a linha da NF apontam para o certo.
const caixa = await dado("warehouse_boxes", "CX-000229");
assert.deepEqual(caixa.lines.map((l) => [l.sku_code, l.client_item_code, l.product_name, l.size, l.counted_qty]), [["BTG-000142", CERTO, MASCULINA, "M", 12], ["BTG-000143", "A.01.0810.002.G", MASCULINA, "G", 10]]);
assert.deepEqual([...caixa.sku_codes].sort(), ["BTG-000142", "BTG-000143"]);
assert.deepEqual([caixa.status, caixa.location_id, caixa.unit_count], ["stored", "B-07", 22]);
assert.deepEqual(caixa.acerto_codigo.antes, { inbound_item_id: segunda.linhas[0], sku_code: "BTG-000213", client_item_code: ERRADO, product_name: FEMININA });
const tarefa = (await db.collection("putaway_tasks").where("box_code", "==", "CX-000229").get()).docs[0].data();
assert.deepEqual(tarefa.lines.map((l) => l.sku_code), ["BTG-000142", "BTG-000143"]);
assert.deepEqual([...tarefa.sku_codes].sort(), ["BTG-000142", "BTG-000143"]);
const linhaDaNf = await dado("inbound_items", segunda.linhas[0]);
assert.deepEqual([linhaDaNf.sku_code, linhaDaNf.client_item_code, linhaDaNf.product_name], ["BTG-000142", CERTO, MASCULINA]);
assert.deepEqual(linhaDaNf.acerto_codigo.antes, { sku_code: "BTG-000213", client_item_code: ERRADO, product_name: FEMININA });
// A linha da primeira chegada (cancelada) guardava o número BTG-000213: passa para o certo, para ele não voltar.
const linhaCancelada = await dado("inbound_items", primeira.linhas[0]);
assert.deepEqual([linhaCancelada.sku_code, linhaCancelada.client_item_code, linhaCancelada.status], ["BTG-000142", CERTO, "cancelled"]);
assert.deepEqual(linhaCancelada.acerto_codigo.antes, { sku_code: "BTG-000213", client_item_code: ERRADO, product_name: FEMININA });
// O razão: o da segunda chegada como estava, mais a saída e a entrada da correção, fora da cobrança.
assert.deepEqual(
  (await db.collection("movements").where("sku_code", "==", "BTG-000213").get()).docs.filter((d) => d.get("source") !== "functions_manual_inventory").map((d) => JSON.stringify(d.data())).sort(),
  movimentosDaSegunda,
);
const daCorrecao = (await db.collection("movements").where("source", "==", "functions_manual_inventory").get()).docs.map((d) => d.data()).filter((m) => String(m.reason).includes("cx-000229"));
assert.deepEqual(daCorrecao.map((m) => [m.tipo_mov, m.sku_code, m.location_id, m.quantity]).sort(), [["ENTRADA", "BTG-000142", "B-07", 12], ["SAIDA", "BTG-000213", "B-07", 12]]);
assert.equal(await recebidas(), pecasDeEntrada, "as peças de entrada da cobrança não mudam");
const tipos = (await db.collection("events").where("source", "==", "script_corrigir_codigo_do_produto").get()).docs.map((d) => [d.get("type"), d.get("entity_id")]).sort();
assert.deepEqual(tipos, [["catalog.removed_by_correcao", "BTG-000213"], ["inbound.item_corrected", segunda.receiptId], ["warehouse.box_content_corrected", "CX-000229"]]);
const apagados = (await dado("operational_operations", idDoRecibo(CORRECOES[0], "apagar"))).result.apagados;
assert.deepEqual(apagados.map((a) => a.caminho.split("/")[0]).sort(), ["catalog_prices", "client_inventory", "products", "skus", "stock_balances", "stock_balances"], "o recibo guarda o que saiu");
assert.equal(apagados.find((a) => a.caminho === `products/${ERRADO}`).dados.source_receipt_id, primeira.receiptId);
// Nenhuma cópia esquecida: o código errado e o SKU dele só no histórico, no acerto_codigo e no
// contador de SKU. Os avisos dos movimentos manuais na caixa antiga do agente também são
// histórico, e já resolvidos.
const permitido = (onde) => historico(onde) || onde.startsWith("sku_counters/") || onde.startsWith("ai_agent_inbox/");
for (const alvo of [ERRADO, "BTG-000213"]) {
  const sobrou = (await ondeAparece(alvo)).filter((onde) => !permitido(onde));
  assert.deepEqual(sobrou, [], `${alvo} ainda está em: ${sobrou.join(", ")}`);
}
const avisosAbertos = (await db.collection("ai_agent_inbox").where("status", "==", "open").get()).docs.filter((d) => JSON.stringify(d.data()).includes("BTG-000213"));
assert.deepEqual(avisosAbertos.map((d) => d.id), [], "os avisos dos movimentos da correção ficam resolvidos");

// De novo: já aplicada, nada repetido.
const recibosAntes = (await db.collection("operational_operations").get()).size;
assert.equal(rodar().correcoes[0].estado, "ja_aplicado");
assert.equal(rodar("--aplicar").correcoes[0].estado, "ja_aplicado");
assert.equal((await db.collection("operational_operations").get()).size, recibosAntes);
assert.equal(await doScript("events"), 3);

// A operação segue: o pedido do portal reserva das duas prateleiras, e a separação em B-07 baixa a CX-000229.
const pedido = await pedidoDoPortal("BTG-000142", MASCULINA, 25);
const aprovado = await aprovar(pedido);
const linhas = (await db.collection("pick_lines").where("pick_task_id", "==", String(aprovado.pick_task_id)).get()).docs;
const emB07 = linhas.find((d) => d.get("location_id") === "B-07");
assert.ok(emB07, `linhas: ${linhas.map((d) => `${d.get("location_id")} ${d.get("quantity") ?? d.get("qty")}`).join(", ")}`);
await separacao.setPickLineSeparated(db, { pick_task_id: String(aprovado.pick_task_id), pick_line_id: emB07.id, separated: true, idempotency_key: chave("separar") }, guilherme);
assert.deepEqual((await dado("warehouse_boxes", "CX-000229")).taken_lines.map((t) => t.sku_code), ["BTG-000142"], "a separação achou o M na CX-000229");
// O código errado ficou livre: a feminina M de verdade entra depois como produto novo, com outro SKU.
const feminina = await chegada([{ codigo: ERRADO, nome: FEMININA, qtd: 3 }], { ate: "criada" });
assert.equal(feminina.skus[0], "BTG-000214");

// --- 2. Transferência com a caixa por guardar, com queda entre a saída e a entrada --------

const r2 = await chegada([{ codigo: "A.02.0810.002.P", nome: FEMININA, qtd: 6 }], { ate: "entrada", prateleira: "B-09" });
const c2 = correcao("cenario-por-guardar", "A.02.0810.002.P", "A.01.0810.002.P", r2.caixas);
assert.equal(await modoDaCorrecao(leitorDoBanco(), db, c2), "transferencia");
await assert.rejects(
  aplicarTransferencia(db, FieldValue, c2, { operations, depoisDaSaida: () => { throw new Error("queda simulada"); } }),
  /queda simulada/,
);
const meio = await lerTransferencia(leitorDoBanco(), db, c2, { info: true });
assert.equal(meio.congelado, true);
assert.deepEqual(meio.passos.movimentos.map((m) => [m.posicao, m.qtde, m.saida, m.entrada]), [["RECEBIMENTO", 6, true, false]]);
assert.ok(meio.estado.some((l) => l.startsWith("a aplicação já começou")));
const c2feita = await aplicarTransferencia(db, FieldValue, c2, { operations });
assert.equal(c2feita.estado, "corrigido");
assert.equal(c2feita.apagado, true);
assert.deepEqual(await saldos("BTG-000141"), [["RECEBIMENTO", 6]]);
assert.equal(await existe("skus", r2.skus[0]), false);
await guardar(r2.receiptId, r2.caixas[0], "B-09");
assert.deepEqual(await saldos("BTG-000141"), [["B-09", 6], ["RECEBIMENTO", 0]]);
const avisoR2 = (await db.collection("events").where("type", "==", "inventory.arrival_stored").get()).docs.find((d) => d.get("payload.receipt_id") === r2.receiptId).data();
assert.deepEqual(avisoR2.payload.items.map((i) => [i.sku_code, i.client_item_code]), [["BTG-000141", "A.01.0810.002.P"]], "o aviso ao cliente sai com o certo");
assert.equal((await aplicarTransferencia(db, FieldValue, c2, { operations })).estado, "ja_aplicado");

// --- 3. Transferência antes da entrada: nenhum movimento ----------------------------------

const r3 = await chegada([{ codigo: "A.02.0810.002.GG", nome: FEMININA, qtd: 4 }], { ate: "fechada", prateleira: "B-10" });
const c3 = correcao("cenario-antes-da-entrada", "A.02.0810.002.GG", "A.01.0810.002.GG", r3.caixas);
const l3 = await lerTransferencia(leitorDoBanco(), db, c3);
assert.deepEqual(l3.plano.transferencias, []);
const c3feita = await aplicarTransferencia(db, FieldValue, c3, { operations });
assert.deepEqual([c3feita.estado, c3feita.apagado], ["corrigido", true]);
await destino(r3.receiptId, r3.caixas[0], "B-10");
await entrada(r3.receiptId);
await guardar(r3.receiptId, r3.caixas[0], "B-10");
assert.deepEqual(await saldos("BTG-000144"), [["B-10", 4], ["RECEBIMENTO", 0]]);

// --- 4. O SKU errado com outra vida: as peças da caixa vão, o cadastro fica ----------------

const r4 = await chegada([{ codigo: "A.02.0810.002.XG", nome: FEMININA, qtd: 3 }], { ate: "guardada", prateleira: "B-11" });
await operations.createInventoryMovementTransaction(db, { type: "ENTRADA", quantity: 1, customer_code: BTG, sku_code: r4.skus[0], location_id: "C-01", reason: "Peça achada", idempotency_key: "achada-r4" }, coordenacao);
const c4 = correcao("cenario-outra-vida", "A.02.0810.002.XG", "A.01.0810.002.XG", r4.caixas);
const l4 = await lerTransferencia(leitorDoBanco(), db, c4);
assert.equal(l4.remocao.apaga, false);
const c4feita = await aplicarTransferencia(db, FieldValue, c4, { operations });
assert.deepEqual([c4feita.estado, c4feita.apagado], ["corrigido", false]);
assert.ok(c4feita.nao_apagado.some((m) => m.startsWith("fica com 1")), c4feita.nao_apagado.join("; "));
assert.ok(c4feita.nao_apagado.some((m) => m.includes("movimento(s) fora desta chegada")), c4feita.nao_apagado.join("; "));
assert.equal(await existe("skus", r4.skus[0]), true, "o cadastro com outra vida fica");
assert.deepEqual(await saldos(r4.skus[0]), [["B-11", 0], ["C-01", 1], ["RECEBIMENTO", 0]]);
assert.deepEqual(await saldos("BTG-000145"), [["B-11", 3]]);

// O cadastro errado preso a uma chegada aberta: a correção grava sem apagar e termina depois que ela é cancelada.
const r4a = await chegada([{ codigo: "A.02.0810.002.G", nome: FEMININA, qtd: 5 }], { ate: "criada" });
const r4b = await chegada([{ codigo: "A.02.0810.002.G", nome: FEMININA, qtd: 5, sku: r4a.skus[0] }], { ate: "guardada", prateleira: "B-08" });
const c4b = correcao("cenario-chegada-aberta", "A.02.0810.002.G", "A.01.0810.002.G", r4b.caixas);
const l4b = await lerTransferencia(leitorDoBanco(), db, c4b);
assert.deepEqual(l4b.remocao.motivos, [`está na chegada ${r4a.receiptNumber}, ainda sem entrada (cancele ou corrija a chegada antes)`]);
assert.deepEqual([(await aplicarTransferencia(db, FieldValue, c4b, { operations })).apagado, await existe("skus", r4a.skus[0])], [false, true]);
assert.equal((await lerTransferencia(leitorDoBanco(), db, c4b)).jaAplicado, true, "com a chegada aberta, nada mais a fazer");
await cancelamento.cancelInboundReceiptTransaction(db, { receipt_id: r4a.receiptId, customer_code: BTG, expected_status: "created", reason: "mistake", idempotency_key: chave("cancelar") }, guilherme);
const depois = await lerTransferencia(leitorDoBanco(), db, c4b, { info: true });
assert.deepEqual([depois.jaAplicado, depois.soRemocao, depois.remocao.apaga], [false, true, true]);
const terminou = await aplicarTransferencia(db, FieldValue, c4b, { operations });
assert.deepEqual([terminou.estado, terminou.apagado], ["corrigido", true]);
assert.equal(await existe("skus", r4a.skus[0]), false);
assert.equal((await dado("inbound_items", r4a.linhas[0])).sku_code, "BTG-000143", "a linha da chegada cancelada passou para o certo");
assert.equal((await dado("operational_operations", idDoRecibo(c4b))).result.apagado, true);
assert.equal((await aplicarTransferencia(db, FieldValue, c4b, { operations })).estado, "ja_aplicado");
assert.deepEqual(await saldos("BTG-000143"), [["B-07", 10], ["B-08", 5], ["RECEBIMENTO", 0]]);

// --- 5. No mesmo SKU: o código certo livre ------------------------------------------------

const r5 = await chegada([{ codigo: "A.02.0830.001.M", nome: "Polo Feminino Piquet Preto", qtd: 12 }], { ate: "guardada", prateleira: "B-12" });
const SKU5 = r5.skus[0];
await db.collection("ai_stock_age").doc(idDoItemParado(BTG, SKU5)).set({ tipo: "item", customer_code: BTG, sku_code: SKU5, client_item_code: "A.02.0830.001.M", product_name: "Polo Feminino Piquet Preto", saldo: 12 });
const c5 = correcao("cenario-mesmo-sku", "A.02.0830.001.M", "A.01.0830.001.M", r5.caixas);
assert.equal(await modoDaCorrecao(leitorDoBanco(), db, c5), "mesmo_sku");
const movimentos5 = (await db.collection("movements").where("sku_code", "==", SKU5).get()).docs.map((d) => JSON.stringify(d.data())).sort();
const nome5 = await prepararNome(db, FieldPath, c5);
assert.deepEqual([nome5.nome, nome5.origem], ["Polo Masculino Piquet Preto", "família A.01.0830.001 (P, G)"]);
assert.equal((await aplicar(db, FieldValue, c5, nome5)).estado, "corrigido");
assert.equal(await modoDaCorrecao(leitorDoBanco(), db, c5), "mesmo_sku");
const sku5 = await dado("skus", SKU5);
assert.deepEqual([sku5.cod_cliente, sku5.cod_cliente_key, sku5.produto, sku5.genero, sku5.estoque_atual], ["A.01.0830.001.M", "A.01.0830.001.M", "Polo Masculino Piquet Preto", "Masculino", 12]);
assert.equal(await existe("products", "A.02.0830.001.M"), false);
assert.deepEqual([(await dado("products", "A.01.0830.001.M")).estoque_btg, (await dado("products", "A.01.0830.001.M")).source_receipt_id], [12, r5.receiptId]);
assert.deepEqual((await db.collection("stock_balances").where("sku_code", "==", SKU5).get()).docs.map((d) => [d.get("location_id"), d.get("client_item_code")]).sort(), [["B-12", "A.01.0830.001.M"], ["RECEBIMENTO", "A.01.0830.001.M"]]);
assert.equal((await dado("client_inventory", `cinv_BTG_Pactual__${SKU5}`)).client_item_code, "A.01.0830.001.M");
assert.equal((await dado("catalog_prices", `cprice_BTG_Pactual__${SKU5}`)).item_code, "A.01.0830.001.M");
assert.equal((await dado("ai_stock_age", idDoItemParado(BTG, SKU5))).client_item_code, "A.01.0830.001.M");
assert.equal((await dado("warehouse_boxes", r5.caixas[0])).lines[0].client_item_code, "A.01.0830.001.M");
assert.equal((await dado("inbound_items", r5.linhas[0])).client_item_code, "A.01.0830.001.M");
assert.deepEqual((await db.collection("movements").where("sku_code", "==", SKU5).get()).docs.map((d) => JSON.stringify(d.data())).sort(), movimentos5, "o razão não muda");
assert.deepEqual((await ondeAparece("A.02.0830.001.M")).filter((onde) => !historico(onde)), []);
// No mesmo SKU antes da guarda e antes da entrada.
const r6 = await chegada([{ codigo: "A.02.0815.001.M", nome: "Camisa Feminino Social Branca", qtd: 5 }], { ate: "entrada", prateleira: "C-02" });
const c6 = correcao("cenario-mesmo-sku-por-guardar", "A.02.0815.001.M", "A.01.0815.001.M", r6.caixas);
const n6 = await prepararNome(db, FieldPath, c6);
assert.equal(n6.nome, "Camisa Masculino Social Branca", "sem família: o nome de hoje com Masculino");
assert.equal((await aplicar(db, FieldValue, c6, n6)).estado, "corrigido");
await guardar(r6.receiptId, r6.caixas[0], "C-02");
assert.equal((await db.collection("stock_balances").where("sku_code", "==", r6.skus[0]).where("location_id", "==", "C-02").get()).docs[0].get("client_item_code"), "A.01.0815.001.M");
const r7 = await chegada([{ codigo: "A.02.0816.001.M", nome: "Camisa Feminino Social Preta", qtd: 3 }], { ate: "fechada", prateleira: "C-03" });
const c7 = correcao("cenario-mesmo-sku-antes-da-entrada", "A.02.0816.001.M", "A.01.0816.001.M", r7.caixas);
assert.equal((await aplicar(db, FieldValue, c7, await prepararNome(db, FieldPath, c7))).estado, "corrigido");
await destino(r7.receiptId, r7.caixas[0], "C-03");
await entrada(r7.receiptId);
await guardar(r7.receiptId, r7.caixas[0], "C-03");
assert.equal((await dado("client_inventory", `cinv_BTG_Pactual__${r7.skus[0]}`)).client_item_code, "A.01.0816.001.M");

// --- 6. As recusas: nada gravado ----------------------------------------------------------

async function recusa(caso, padrao, { transferencia = false } = {}) {
  const eventos = (await db.collection("events").get()).size;
  const tentar = transferencia ? aplicarTransferencia(db, FieldValue, caso, { operations }) : prepararNome(db, FieldPath, caso).then((nome) => aplicar(db, FieldValue, caso, nome));
  await assert.rejects(tentar, (erro) => erro instanceof ErroDaCorrecao && padrao.test(erro.message));
  assert.equal((await db.collection("events").get()).size, eventos, `${caso.id}: nada gravado`);
}
// No mesmo SKU: o SKU que já existia antes da chegada.
const r8 = await chegada([{ codigo: "A.02.0899.001.P", nome: "Camisa Feminino Social Bege", qtd: 2, sku: "BTG-000160" }], { ate: "fechada", prateleira: "C-04" });
await recusa(correcao("cenario-sku-antigo", "A.02.0899.001.P", "A.01.0899.001.P", r8.caixas), /não nasceu na chegada/);
// No mesmo SKU: movimento de fora da chegada.
const r9 = await chegada([{ codigo: "A.02.0818.001.M", nome: "Camisa Feminino Social Verde", qtd: 4 }], { ate: "guardada", prateleira: "C-05" });
await operations.createInventoryMovementTransaction(db, { type: "SAIDA", quantity: 1, customer_code: BTG, sku_code: r9.skus[0], location_id: "C-05", reason: "Saldão", idempotency_key: "saida-r9" }, coordenacao);
await recusa(correcao("cenario-movimento-de-fora", "A.02.0818.001.M", "A.01.0818.001.M", r9.caixas), /movimento\(s\) fora da chegada/);
// No mesmo SKU: pedido aberto e reserva.
const r10 = await chegada([{ codigo: "A.02.0820.001.M", nome: "Camisa Feminino Social Lilás", qtd: 3 }], { ate: "guardada", prateleira: "C-06" });
const pedido10 = await pedidoDoPortal(r10.skus[0], "Camisa Feminino Social Lilás", 1);
await recusa(correcao("cenario-pedido-aberto", "A.02.0820.001.M", "A.01.0820.001.M", r10.caixas), /solicitação do portal em aberto/);
await aprovar(pedido10);
await recusa(correcao("cenario-reserva", "A.02.0820.001.M", "A.01.0820.001.M", r10.caixas), /reserva\(s\) em stock_reservations/);
// Os dois caminhos: a caixa sem o código.
await recusa(correcao("cenario-caixa-sem-codigo", "A.02.9999.999.M", "A.01.9999.999.M", ["CX-000229"]), /0 linha\(s\) com A\.02\.9999\.999\.M/);
await recusa(correcao("cenario-transferencia-caixa-sem-codigo", "A.02.0810.002.PP", "A.01.0810.002.PP", ["CX-000229"]), /0 linha\(s\) com A\.02\.0810\.002\.PP/, { transferencia: true });
// Transferência: o SKU errado em duas caixas da chegada, e a correção com uma.
const r11 = await chegada([{ codigo: "A.02.0810.002.PP", nome: FEMININA, qtd: 4 }], { caixas: [[[0, 2]], [[0, 2]]], ate: "destino", prateleira: "B-05" });
await recusa(correcao("cenario-outra-caixa", "A.02.0810.002.PP", "A.01.0810.002.PP", [r11.caixas[0]]), /também está na\(s\) caixa\(s\) /, { transferencia: true });
// Transferência: o que a caixa tem está reservado na prateleira.
const r12 = await chegada([{ codigo: "A.02.0810.002.XGG", nome: FEMININA, qtd: 2 }], { ate: "guardada", prateleira: "B-06" });
await aprovar(await pedidoDoPortal(r12.skus[0], FEMININA, 1));
await recusa(correcao("cenario-reservado", "A.02.0810.002.XGG", "A.01.0810.002.XGG", r12.caixas), /tem 1 livre em B-06, e as caixas pedem 2/, { transferencia: true });
// Estoque congelado.
await db.collection("system_controls").doc("inventory").set({ movements_frozen: true });
await recusa(correcao("cenario-congelado", "A.02.0810.002.PP", "A.01.0810.002.PP", r11.caixas), /congeladas/, { transferencia: true });
await db.collection("system_controls").doc("inventory").delete();
// Com as duas caixas, a transferência passa.
assert.equal((await aplicarTransferencia(db, FieldValue, correcao("cenario-duas-caixas", "A.02.0810.002.PP", "A.01.0810.002.PP", r11.caixas), { operations })).estado, "corrigido");
// O plano lido com o banco é o mesmo da transação: a do mesmo SKU já aplicada diz isso.
assert.equal((await planejar(leitorDoBanco(), db, FieldValue, c5, { nome: nome5 })).jaAplicado, true);

console.log("Cenário da correção de código no emulador ok: a CX-000229 por transferência, com o cadastro errado apagado e o código só no histórico, a retomada depois da queda, antes da guarda e antes da entrada, o SKU com outra vida que fica, o caminho no mesmo SKU e as recusas.");
process.exit(0);
