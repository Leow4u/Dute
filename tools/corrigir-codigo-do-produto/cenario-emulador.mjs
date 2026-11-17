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
 * 7. O PED-0001 (16/11/2026): o tamanho trocado (XG lançado como XGG) na
 *    caixa que a separação já abriu para outro item, com a XGG certa em outra
 *    caixa da mesma prateleira e a feminina nascida na chegada. A correção
 *    recusa enquanto o pedido reserva as peças e diz qual pedido; "Separar
 *    menos" e a conclusão pela coordenação soltam a reserva; a correção passa
 *    as peças para o XG, e o cadastro errado só sai depois da entrega.
 * 8. A correção pendente: o dry-run mostra o que gravaria, e --aplicar não
 *    grava nada; sem o campo, grava.
 * 9. O SKU certo criado pelo acerto (o criar_sku do bloco feminina-xg), como
 *    a feminina XG do PED-0001: a transferência passa as peças para ele.
 * 10. A caixa recontada (17/11/2026), com as escritas da recountWarehouseBox
 *    simuladas (o ajuste na caixa e a diferença na prateleira): o ajuste de
 *    outro item fica; a correção recusa o item que a recontagem ajustou, o
 *    errado ou o certo, também na retomada do plano congelado; e o acerto
 *    recusa no dry-run o que mexeria no item ajustado ou na caixa inteira, e
 *    grava o que mexe em outro item sem tocar o ajuste.
 *
 *   npm --prefix functions/wms ci && npm --prefix functions/wms run build
 *   cd functions/wms
 *   npx firebase-tools emulators:exec --only firestore --project demo-corrigir-codigo "node ../../tools/corrigir-codigo-do-produto/cenario-emulador.mjs"
 */

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
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
const { contaDoSku, textoDaCaixa, textoDaConta } = await import("./ler-estoque.mjs");
const { saldoDaCaixa } = await import("./saldo-da-caixa.mjs");

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
// Só a correção da CX-000229: as outras de correcoes.mjs são da produção e não têm o que corrigir no cenário.
const SO_A_229 = ["--correcao", CORRECOES[0].id];
const rodar = (...extra) => JSON.parse(execFileSync(process.execPath, [cli, "--projeto", PROJETO, "--json", ...SO_A_229, ...extra], { encoding: "utf8", env: process.env }));

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
console.log(execFileSync(process.execPath, [cli, "--projeto", PROJETO, ...SO_A_229], { encoding: "utf8", env: process.env }));

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

// --- 7. O PED-0001: o XG lançado como XGG, com a separação no meio -----------------------

const PRETA_M = "Polo Masculino Piquet Preto";
const PRETA_F = "Polo Feminino Piquet Preto";
await posicoes.upsertWarehousePositions(
  db,
  { positions: [2, 4].map((shelf) => ({ aisle: "B", shelf, length_m: 1.8, depth_m: 0.75, height_m: 0.65, customer_code: BTG })) },
  coordenacao,
);
// A polo preta piquet como veio da abertura: a masculina GG, XG e XGG e a feminina XG.
const lote7 = db.batch();
for (const [id, codigo, produto, genero] of [
  ["BTG-000090", "A.01.0806.005.GG", PRETA_M, "Masculino"],
  ["BTG-000074", "A.01.0806.005.XG", PRETA_M, "Masculino"],
  ["BTG-000092", "A.01.0806.005.XGG", PRETA_M, "Masculino"],
  ["BTG-000080", "A.02.0806.005.XG", PRETA_F, "Feminino"],
]) {
  const comum = { customer_code: BTG, cod_cliente: codigo, cod_cliente_key: codigo, produto, genero, tamanho: tamanho(codigo), size: tamanho(codigo), category: "Uniformes", status: "active", archived: false, source: "opening_inventory" };
  lote7.set(db.collection("skus").doc(id), { id, ...comum, cod_btg: id, sku_code: id, sku_code_key: id, estoque_atual: 0, estoque_reservado: 0, estoque_disponivel: 0 });
  lote7.set(db.collection("products").doc(codigo), { id: codigo, ...comum, estoque_btg: 0, num_skus: 1 });
}
await lote7.commit();
// A XGG certa: 10 numa caixa guardada antes em B-02, como a CX-000215.
const r13 = await chegada([{ codigo: "A.01.0806.005.XGG", nome: PRETA_M, qtd: 10, sku: "BTG-000092" }], { prateleira: "B-02" });
// A caixa do erro, como a CX-000227: 30 GG certas e 41 XG lançadas como XGG, também em B-02.
const r14 = await chegada(
  [
    { codigo: "A.01.0806.005.GG", nome: PRETA_M, qtd: 30, sku: "BTG-000090" },
    { codigo: "A.01.0806.005.XGG", nome: PRETA_M, qtd: 41, sku: "BTG-000092" },
  ],
  { prateleira: "B-02" },
);
// A feminina, como a CX-000221: 12 XG lançadas como XGG, produto novo nesta chegada, em B-04.
const r15 = await chegada([{ codigo: "A.02.0806.005.XGG", nome: PRETA_F, qtd: 12 }], { prateleira: "B-04" });
const XGG_F = r15.skus[0];
assert.deepEqual(await saldos("BTG-000092"), [["B-02", 51], ["RECEBIMENTO", 0]]);

// O pedido: as 30 GG, 51 XGG (as 10 certas e as 41 que são XG) e as 12 XGG femininas.
const pedido7 = await operations.createCustomerRequestTransaction(
  db,
  {
    type: "retirada",
    priority: "normal",
    title: "Uniformes",
    customer_code: BTG,
    idempotency_key: chave("pedido"),
    items: [
      { sku_code: "BTG-000090", product_name: PRETA_M, quantity: 30 },
      { sku_code: "BTG-000092", product_name: PRETA_M, quantity: 51 },
      { sku_code: XGG_F, product_name: PRETA_F, quantity: 12 },
    ],
  },
  cliente,
);
const aprovado7 = await aprovar(String(pedido7.id));
const tarefa7 = String(aprovado7.pick_task_id);
const ordem7 = String(aprovado7.order_id);
const numero7 = String((await dado("orders", ordem7)).order_number);
const linhas7 = (await db.collection("pick_lines").where("pick_task_id", "==", tarefa7).get()).docs;
assert.deepEqual(linhas7.map((d) => [d.get("sku_code"), d.get("location_id"), d.get("qty_to_pick")]).sort(), [["BTG-000090", "B-02", 30], ["BTG-000092", "B-02", 51], [XGG_F, "B-04", 12]].sort());
const linha7 = (sku) => linhas7.find((d) => d.get("sku_code") === sku).id;
const separar7 = (sku, extra = {}) => separacao.setPickLineSeparated(db, { pick_task_id: tarefa7, pick_line_id: linha7(sku), separated: true, ...extra, idempotency_key: chave("separar") }, guilherme);
// As 30 GG saem da caixa do erro: ela fica aberta, com o retirado delas.
await separar7("BTG-000090");
// A XGG separa as 10 da caixa certa (a mais antiga da prateleira) e registra a falta das 41.
await separar7("BTG-000092", { separated_qty: 10, shortage_reason: "falta", shortage_detail: "as 41 da outra caixa são XG" });
// A feminina XGG não tem peça: 0, com a falta.
await separar7(XGG_F, { separated_qty: 0, shortage_reason: "falta", shortage_detail: "a caixa tem XG" });
assert.deepEqual((await dado("warehouse_boxes", r13.caixas[0])).taken_lines, [{ sku_code: "BTG-000092", qty: 10 }], "a XGG saiu da caixa certa");
assert.deepEqual((await dado("warehouse_boxes", r14.caixas[0])).taken_lines, [{ sku_code: "BTG-000090", qty: 30 }], "da caixa do erro, só as GG");
assert.equal((await dado("warehouse_boxes", r15.caixas[0])).taken_lines, undefined, "da feminina, nada");

// Enquanto o pedido reserva as peças, a correção recusa e diz qual pedido.
const cx227 = correcao("cenario-ped-0001-masculina", "A.01.0806.005.XGG", "A.01.0806.005.XG", r14.caixas);
const cx221 = correcao("cenario-ped-0001-feminina", "A.02.0806.005.XGG", "A.02.0806.005.XG", r15.caixas, { genero: "Feminino" });
await recusa(cx227, new RegExp(`tem 0 livre em B-02, e as caixas pedem 41 \\(reservado: 51, ${numero7} 51\\)\\. A reserva sai antes`), { transferencia: true });
await recusa(cx221, new RegExp(`tem 0 livre em B-04, e as caixas pedem 12 \\(reservado: 12, ${numero7} 12\\)`), { transferencia: true });
// No mesmo SKU o tamanho não muda: com o código certo fora do cadastro (o PP), a correção recusa.
const paraPP = correcao("cenario-tamanho-no-mesmo-sku", "A.01.0806.005.XGG", "A.01.0806.005.PP", r14.caixas);
assert.equal(await modoDaCorrecao(leitorDoBanco(), db, paraPP), "mesmo_sku");
await recusa(paraPP, /o tamanho muda \(A\.01\.0806\.005\.XGG → A\.01\.0806\.005\.PP\), e o A\.01\.0806\.005\.PP não está no cadastro/);

// A coordenação conclui a separação com a diferença: as 41 XGG e as 12 femininas ficam livres.
const concluido7 = await separacao.completeOrderSeparation(db, { pick_task_id: tarefa7, seal_code: "L-0001", idempotency_key: chave("concluir") }, coordenacao);
const livre = async (sku, local) => {
  const d = (await db.collection("stock_balances").where("sku_code", "==", sku).where("location_id", "==", local).get()).docs[0];
  return Number(d.get("qty_on_hand")) - Number(d.get("qty_reserved"));
};
assert.deepEqual([await livre("BTG-000092", "B-02"), await livre(XGG_F, "B-04")], [41, 12]);

// A masculina: dry-run, transferência para o XG, e o XGG continua (as 10 certas, já separadas).
const mostra7 = await lerTransferencia(leitorDoBanco(), db, cx227, { info: true });
assert.deepEqual(mostra7.plano.transferencias, [{ posicao: "B-02", qtde: 41 }]);
assert.deepEqual(mostra7.plano.alvo, { sku: "BTG-000074", codigo: "A.01.0806.005.XG", nome: PRETA_M, tamanho: "XG" });
assert.equal(mostra7.remocao.apaga, false);
assert.ok(mostra7.remocao.motivos.includes(`está no pedido ${numero7}, ainda não entregue`), mostra7.remocao.motivos.join("; "));
const feita7 = await aplicarTransferencia(db, FieldValue, cx227, { operations });
assert.deepEqual([feita7.estado, feita7.apagado], ["corrigido", false]);
assert.deepEqual(await saldos("BTG-000092"), [["B-02", 10], ["RECEBIMENTO", 0]]);
assert.deepEqual(await saldos("BTG-000074"), [["B-02", 41]]);
const caixa227 = await dado("warehouse_boxes", r14.caixas[0]);
assert.deepEqual(caixa227.lines.map((l) => [l.sku_code, l.client_item_code, l.size, l.counted_qty]), [["BTG-000090", "A.01.0806.005.GG", "GG", 30], ["BTG-000074", "A.01.0806.005.XG", "XG", 41]]);
assert.deepEqual(caixa227.taken_lines, [{ sku_code: "BTG-000090", qty: 30 }], "o retirado das GG fica como estava");
assert.deepEqual([[...caixa227.sku_codes].sort(), caixa227.status, caixa227.unit_count], [["BTG-000074", "BTG-000090"], "stored", 71]);
const nf227 = await dado("inbound_items", r14.linhas[1]);
assert.deepEqual([nf227.sku_code, nf227.client_item_code, nf227.size], ["BTG-000074", "A.01.0806.005.XG", "XG"]);
assert.equal(await existe("skus", "BTG-000092"), true, "a XGG de verdade fica");

// A feminina: as 12 passam para o XG; o cadastro errado fica enquanto o pedido não é entregue.
const feita221 = await aplicarTransferencia(db, FieldValue, cx221, { operations });
assert.deepEqual([feita221.estado, feita221.apagado], ["corrigido", false]);
assert.deepEqual(feita221.nao_apagado, [`está no pedido ${numero7}, ainda não entregue`]);
assert.deepEqual(await saldos("BTG-000080"), [["B-04", 12]]);
assert.equal(await existe("skus", XGG_F), true);

// A entrega do pedido baixa o separado, e a correção feminina termina: o cadastro errado sai.
const remessa7 = String(concluido7.shipment_id);
await operations.advanceWarehouseTaskTransaction(db, { task_uid: `shipping:${remessa7}`, expected_status: "ready_to_dispatch", operation: { carrier: "Dutelog", driver_name: "Rafael", vehicle_plate: "DUTE-001" }, idempotency_key: chave("despachar") }, guilherme);
await operations.advanceWarehouseTaskTransaction(db, { task_uid: `shipping:${remessa7}`, expected_status: "dispatched", operation: { proof_reference: "Carlos Lima", delivery_notes: "Recebido." }, idempotency_key: chave("entregar") }, guilherme);
assert.equal((await dado("orders", ordem7)).status, "ENTREGUE");
const depoisDaEntrega = await lerTransferencia(leitorDoBanco(), db, cx221, { info: true });
assert.deepEqual([depoisDaEntrega.jaAplicado, depoisDaEntrega.soRemocao, depoisDaEntrega.remocao.apaga], [false, true, true], JSON.stringify(depoisDaEntrega.remocao));
const terminou7 = await aplicarTransferencia(db, FieldValue, cx221, { operations });
assert.deepEqual([terminou7.estado, terminou7.apagado], ["corrigido", true]);
assert.equal(await existe("skus", XGG_F), false, "o cadastro errado saiu depois da entrega");

// A operação segue: o pedido de XG acha as 41 na caixa do erro, em B-02.
const aprovadoXg = await aprovar(await pedidoDoPortal("BTG-000074", PRETA_M, 41));
const linhaXg = (await db.collection("pick_lines").where("pick_task_id", "==", String(aprovadoXg.pick_task_id)).get()).docs[0];
assert.equal(linhaXg.get("location_id"), "B-02");
await separacao.setPickLineSeparated(db, { pick_task_id: String(aprovadoXg.pick_task_id), pick_line_id: linhaXg.id, separated: true, idempotency_key: chave("separar") }, guilherme);
const caixaDepois = await dado("warehouse_boxes", r14.caixas[0]);
assert.deepEqual([caixaDepois.taken_lines, caixaDepois.status], [[{ sku_code: "BTG-000090", qty: 30 }, { sku_code: "BTG-000074", qty: 41 }], "emptied"], "a linha de XG saiu da caixa do erro, que esvaziou");

// A correção pendente: o dry-run mostra o que gravaria, e --aplicar não grava nada; sem o campo, grava. A lista vem de
// um arquivo só do emulador (CORRECOES_ARQUIVO), com uma correção que passaria.
const r16 = await chegada([{ codigo: "A.02.0810.002.P", nome: FEMININA, qtd: 5 }], { prateleira: "B-11" });
const umaCorrecao = (extra) => ({ id: "cenario-pendente", cliente: BTG, de: "A.02.0810.002.P", para: "A.01.0810.002.P", caixas: r16.caixas, genero: "Masculino", referencia: "cenário", motivo: "cenário", decisao: "cenário", ...extra });
const listaDoEmulador = async (correcoes) => {
  const arquivo = path.join(os.tmpdir(), `correcoes-cenario-${process.pid}-${++contador}.mjs`);
  writeFileSync(arquivo, `export const CORRECOES = ${JSON.stringify(correcoes)};\n`);
  return arquivo;
};
const comLista = async (correcoes, ...extra) =>
  JSON.parse(execFileSync(process.execPath, [cli, "--projeto", PROJETO, "--json", ...extra], { encoding: "utf8", env: { ...process.env, CORRECOES_ARQUIVO: await listaDoEmulador(correcoes) } }));
const antesDaPendente = await contarTudo();
const pendente = (await comLista([umaCorrecao({ pendente: "teste" })], "--aplicar")).correcoes[0];
assert.deepEqual([pendente.estado, pendente.pendente, pendente.grava?.[0]], ["pendente", "teste", `SAIDA 5 de ${r16.skus[0]} (A.02.0810.002.P) em B-11 · Ajuste −, não cobra`]);
assert.deepEqual(await contarTudo(), antesDaPendente, "a correção pendente não grava, nem com --aplicar");
assert.equal((await comLista([umaCorrecao({})], "--aplicar")).correcoes[0].estado, "corrigido", "sem o campo, grava");

// --- 9. O SKU certo criado pelo acerto (a feminina XG do PED-0001) ----------------------
// Na produção, o A.02.0806.005.XG não existia: o acerto (bloco feminina-xg) cria o SKU, copiando o XGG, e a correção
// passa as peças para ele. Aqui, com outra família, pelo acerto de verdade e por um plano só do emulador (ACERTO_PLANO).
const r17 = await chegada([{ codigo: "A.02.0807.005.XGG", nome: PRETA_F, qtd: 12 }], { prateleira: "B-04" });
const XGG_F9 = r17.skus[0];
const planoDoAcerto = path.join(os.tmpdir(), `plano-acerto-cenario-${process.pid}.mjs`);
writeFileSync(
  planoDoAcerto,
  `export const PLANO = ${JSON.stringify({ id: "cenario-corrigir-codigo", cliente: BTG, referencia: "cenário", ator: { uid: "script:acerto-cenario", role: "admin", name: "Acerto do cenário", email: "ops@dutelog.com.br" } })};\n` +
    `export const BLOCOS = ${JSON.stringify([{ id: "feminina-xg", titulo: "cenário", ops: [{ id: "criar-xg-cenario", tipo: "criar_sku", codigo: "A.02.0807.005.XG", copiar_de: "A.02.0807.005.XGG", tamanho: "XG", manter_nome: true, motivo: "cenário" }] }])};\n`,
);
execFileSync(process.execPath, [path.join(raiz, "tools", "acerto-btg-2026-10", "acerto.mjs"), "--projeto", PROJETO, "--aplicar"], { encoding: "utf8", env: { ...process.env, ACERTO_PLANO: planoDoAcerto } });
const doAcerto = (await db.collection("skus").where("cod_cliente", "==", "A.02.0807.005.XG").get()).docs;
assert.equal(doAcerto.length, 1, "o acerto criou o XG");
const XG_F9 = doAcerto[0].id;
assert.deepEqual([doAcerto[0].get("tamanho"), doAcerto[0].get("produto")], ["XG", (await dado("skus", XGG_F9)).produto]);
const c9 = { id: "cenario-feminina-xg", cliente: BTG, de: "A.02.0807.005.XGG", para: "A.02.0807.005.XG", caixas: r17.caixas, genero: "Feminino", referencia: "cenário", motivo: "cenário", decisao: "cenário" };
const dry9 = (await comLista([c9])).correcoes[0];
assert.deepEqual([dry9.modo, dry9.estado, dry9.alvo?.sku, dry9.alvo?.tamanho], ["transferencia", "a_gravar", XG_F9, "XG"]);
assert.ok(dry9.grava.some((g) => g.includes(`tamanho XGG → XG`)), dry9.grava.join("\n"));
const feito9 = (await comLista([c9], "--aplicar")).correcoes[0];
assert.deepEqual([feito9.estado, feito9.resultado?.apagado], ["corrigido", true], JSON.stringify(feito9));
assert.deepEqual(await saldos(XG_F9), [["B-04", 12]]);
const caixa9 = await dado("warehouse_boxes", r17.caixas[0]);
assert.deepEqual(caixa9.lines.map((l) => [l.sku_code, l.client_item_code, l.size, l.counted_qty]), [[XG_F9, "A.02.0807.005.XG", "XG", 12]]);
assert.equal(await existe("skus", XGG_F9), false, "sem pedido, o cadastro errado sai");
const portal9 = (await db.collection("client_inventory").where("sku_code", "==", XG_F9).get()).docs;
assert.deepEqual(portal9.map((d) => [d.get("qty_on_hand"), d.get("qty_available"), d.get("size")]), [[12, 12, "XG"]], "um item do portal, com as 12 no XG");

// --- 10. A caixa recontada (17/11/2026) ----------------------------------------------------
// A recontagem por caixa (recountWarehouseBox, PR 618) grava na caixa um ajuste com sinal por item (count_adjustments,
// com o id da contagem e a hora) e acerta o saldo da prateleira junto. Aqui ela é simulada com as mesmas escritas: o
// ajuste na caixa (o item fora da lista também em sku_codes) e o movimento na prateleira. As ferramentas leem o ajuste
// pela regra do saldo da caixa, recusam mexer no item que a recontagem ajustou e não apagam ajuste nenhum.

const CINZA_M = "Polo Masculino Piquet Cinza";
const CINZA_F = "Polo Feminino Piquet Cinza";
await posicoes.upsertWarehousePositions(
  db,
  { positions: [7, 8, 9, 10, 11, 12].map((shelf) => ({ aisle: "C", shelf, length_m: 1.8, depth_m: 0.75, height_m: 0.65, customer_code: BTG })) },
  coordenacao,
);
const lote10 = db.batch();
for (const [id, codigo] of [
  ["BTG-000300", "A.01.0820.003.P"],
  ["BTG-000301", "A.01.0820.003.M"],
  ["BTG-000302", "A.01.0820.003.G"],
  ["BTG-000303", "A.01.0820.003.GG"],
]) {
  const comum = { customer_code: BTG, cod_cliente: codigo, cod_cliente_key: codigo, produto: CINZA_M, genero: "Masculino", tamanho: tamanho(codigo), size: tamanho(codigo), category: "Uniformes", status: "active", archived: false, source: "opening_inventory" };
  lote10.set(db.collection("skus").doc(id), { id, ...comum, cod_btg: id, sku_code: id, sku_code_key: id, estoque_atual: 0, estoque_reservado: 0, estoque_disponivel: 0 });
  lote10.set(db.collection("products").doc(codigo), { id: codigo, ...comum, estoque_btg: 0, num_skus: 1 });
}
await lote10.commit();

let recontagens = 0;
/** A recontagem simulada: os ajustes na caixa, como a recountWarehouseBox grava, e a diferença no saldo da prateleira. */
async function recontar(codigo, itens) {
  const caixaAntes = await dado("warehouse_boxes", codigo);
  const recountId = `brc_cenario_${++recontagens}`;
  const at = new Date().toISOString();
  const ajustes = itens.map((i) => ({ recount_id: recountId, sku_code: i.sku, qty: i.qty, at, round_id: "rodada-cenario", ...(i.fora_da_lista ? { client_item_code: i.codigo, product_name: i.nome } : {}) }));
  const foraDaLista = itens.filter((i) => i.fora_da_lista).map((i) => i.sku);
  await db
    .collection("warehouse_boxes")
    .doc(codigo)
    .update({
      count_adjustments: [...(caixaAntes.count_adjustments ?? []), ...ajustes],
      balance_at: at,
      last_recount_id: recountId,
      last_recounted_at: at,
      ...(foraDaLista.length ? { sku_codes: FieldValue.arrayUnion(...foraDaLista) } : {}),
    });
  for (const i of itens) {
    await operations.createInventoryMovementTransaction(
      db,
      { type: i.qty > 0 ? "ENTRADA" : "SAIDA", quantity: Math.abs(i.qty), customer_code: BTG, sku_code: i.sku, location_id: caixaAntes.location_id, reason: `Recontagem da ${codigo} (cenário)`, idempotency_key: `${recountId}-${i.sku}` },
      coordenacao,
    );
  }
  return recountId;
}
const linhasDaCaixa = (caixa) => (Array.isArray(caixa.lines) ? caixa.lines : []);
const entradaDe = (caixa) => linhasDaCaixa(caixa).map((l) => ({ sku_code: l.sku_code, qty: l.counted_qty }));

// a) O ajuste de outro item da caixa fica: a transferência passa a linha do código errado e não toca a recontagem.
const r18 = await chegada(
  [
    { codigo: "A.02.0820.003.M", nome: CINZA_F, qtd: 12 },
    { codigo: "A.01.0820.003.G", nome: CINZA_M, qtd: 10, sku: "BTG-000302" },
  ],
  { prateleira: "C-07" },
);
const cx18 = r18.caixas[0];
await recontar(cx18, [{ sku: "BTG-000302", qty: -1 }]);
const ajustes18 = (await dado("warehouse_boxes", cx18)).count_adjustments;
// O leitor mostra o ajuste e o que fica pela regra.
assert.equal(textoDaConta(contaDoSku(await dado("warehouse_boxes", cx18), [], "BTG-000302")).replace(/ em [^,]+, [^,]+, /, " em …, "), "entrou 10 · separação tirou 0 · recontagem −1 em …, contagem brc_cenario_1 · fica 9");
const c18 = correcao("cenario-recontada-outro-item", "A.02.0820.003.M", "A.01.0820.003.M", r18.caixas);
const leitura18 = await lerTransferencia(leitorDoBanco(), db, c18, { info: true });
assert.ok(leitura18.estado.some((l) => l.startsWith(cx18) && l.includes("recontagem em outro item, que fica: BTG-000302 −1 em")), leitura18.estado.join("\n"));
assert.equal((await aplicarTransferencia(db, FieldValue, c18, { operations })).estado, "corrigido");
const caixa18 = await dado("warehouse_boxes", cx18);
assert.deepEqual(caixa18.count_adjustments, ajustes18, "o ajuste da recontagem fica como estava");
assert.deepEqual(linhasDaCaixa(caixa18).map((l) => [l.sku_code, l.counted_qty]), [["BTG-000301", 12], ["BTG-000302", 10]]);
assert.deepEqual(saldoDaCaixa(entradaDe(caixa18), caixa18.taken_lines ?? [], caixa18.count_adjustments), [{ sku_code: "BTG-000301", qty: 12 }, { sku_code: "BTG-000302", qty: 9 }]);
assert.deepEqual([await saldos("BTG-000301"), await saldos("BTG-000302")], [[["C-07", 12]], [["C-07", 9], ["RECEBIMENTO", 0]]], "a caixa e a prateleira batem pela regra");
assert.match(textoDaCaixa(cx18, caixa18, []), /· recontagem: A\.01\.0820\.003\.G −1 em .* · fica: A\.01\.0820\.003\.M 12, A\.01\.0820\.003\.G 9$/);

// b) O SKU errado que a recontagem ajustou: a transferência recusa antes de qualquer movimento.
const r19 = await chegada([{ codigo: "A.02.0820.003.G", nome: CINZA_F, qtd: 8 }], { prateleira: "C-08" });
await recontar(r19.caixas[0], [{ sku: r19.skus[0], qty: -2 }]);
await recusa(
  correcao("cenario-recontada-no-errado", "A.02.0820.003.G", "A.01.0820.003.G", r19.caixas),
  new RegExp(`^a recontagem já ajustou A\\.02\\.0820\\.003\\.G \\(${r19.skus[0]}\\) na caixa ${r19.caixas[0]} \\(−2 em .*, contagem brc_cenario_2\\): as peças da caixa nesse item não são mais as da linha`),
  { transferencia: true },
);

// c) O SKU certo que a recontagem pôs na caixa (fora da lista): ela pode já ter corrigido o código.
const r20 = await chegada([{ codigo: "A.02.0820.003.P", nome: CINZA_F, qtd: 5 }], { prateleira: "C-09" });
await recontar(r20.caixas[0], [{ sku: "BTG-000300", qty: 2, fora_da_lista: true, codigo: "A.01.0820.003.P", nome: CINZA_M }]);
await recusa(
  correcao("cenario-recontada-no-certo", "A.02.0820.003.P", "A.01.0820.003.P", r20.caixas),
  /^a recontagem já ajustou A\.01\.0820\.003\.P \(BTG-000300\) na caixa CX-\d+ \(\+2 em .*\): confira se ela já não pôs o código certo na caixa antes de corrigir$/,
  { transferencia: true },
);

// d) No mesmo SKU: o ajuste da recontagem recusa, com a frase dele, antes do movimento de fora da chegada.
const r21 = await chegada([{ codigo: "A.02.0821.003.M", nome: CINZA_F, qtd: 6 }], { prateleira: "C-10" });
await recontar(r21.caixas[0], [{ sku: r21.skus[0], qty: -1 }]);
const c21 = correcao("cenario-recontada-mesmo-sku", "A.02.0821.003.M", "A.01.0821.003.M", r21.caixas);
assert.equal(await modoDaCorrecao(leitorDoBanco(), db, c21), "mesmo_sku");
await recusa(c21, new RegExp(`^a recontagem já ajustou A\\.02\\.0821\\.003\\.M \\(${r21.skus[0]}\\) na caixa ${r21.caixas[0]} \\(−1 em .*\\): o conteúdo da caixa nesse item não é mais o da chegada`));

// e) A recontagem no meio da transferência (plano congelado, saída feita): a retomada recusa antes de mexer na caixa.
const r22 = await chegada([{ codigo: "A.02.0820.003.GG", nome: CINZA_F, qtd: 4 }], { prateleira: "C-11" });
const c22 = correcao("cenario-recontada-no-meio", "A.02.0820.003.GG", "A.01.0820.003.GG", r22.caixas);
await assert.rejects(aplicarTransferencia(db, FieldValue, c22, { operations, depoisDaSaida: () => { throw new Error("queda simulada"); } }), /queda simulada/);
await recontar(r22.caixas[0], [{ sku: "BTG-000303", qty: 1, fora_da_lista: true, codigo: "A.01.0820.003.GG", nome: CINZA_M }]);
await assert.rejects(lerTransferencia(leitorDoBanco(), db, c22), (erro) => erro instanceof ErroDaCorrecao && /confira se ela já não pôs o código certo na caixa antes de corrigir \(a recontagem veio depois de a correção começar/.test(erro.message));
await assert.rejects(aplicarTransferencia(db, FieldValue, c22, { operations }), ErroDaCorrecao);
assert.deepEqual(linhasDaCaixa(await dado("warehouse_boxes", r22.caixas[0])).map((l) => l.sku_code), [r22.skus[0]], "a linha da caixa não mudou");

// f) O acerto (tools/acerto-btg-2026-10) numa caixa da abertura recontada: o que mexe no item ajustado ou na caixa
// inteira recusa no dry-run; o que mexe em outro item grava e deixa o ajuste como estava.
const SESSAO10 = "opening_cenario_recontagem";
const lote10b = db.batch();
lote10b.set(db.collection("warehouse_boxes").doc("CX-000900"), {
  code: "CX-000900",
  customer_code: BTG,
  status: "stored",
  location_id: "C-12",
  stored_at: "2026-10-16T12:00:00.000Z",
  line_count: 2,
  unit_count: 30,
  sku_codes: ["BTG-000300", "BTG-000301"],
  origin: { kind: "opening_inventory", session_id: SESSAO10 },
});
for (const [id, sku, codigo, qtd] of [
  ["line_cenario_900_p", "BTG-000300", "A.01.0820.003.P", 20],
  ["line_cenario_900_m", "BTG-000301", "A.01.0820.003.M", 10],
]) {
  lote10b.set(db.collection("opening_inventory_lines").doc(id), { id, session_id: SESSAO10, customer_code: BTG, sku_code: sku, client_item_code: codigo, product_name: CINZA_M, location_id: "C-12", box_code: "CX-000900", counted_qty: qtd, status: "counted" });
}
await lote10b.commit();
for (const [sku, qtd] of [["BTG-000300", 20], ["BTG-000301", 10]]) {
  await operations.createInventoryMovementTransaction(db, { type: "ENTRADA", quantity: qtd, customer_code: BTG, sku_code: sku, location_id: "C-12", reason: "Abertura do cenário", idempotency_key: `abertura-900-${sku}` }, coordenacao);
}
await recontar("CX-000900", [
  { sku: "BTG-000300", qty: -2 },
  { sku: "BTG-000302", qty: 1, fora_da_lista: true, codigo: "A.01.0820.003.G", nome: CINZA_M },
]);
const ajustes900 = (await dado("warehouse_boxes", "CX-000900")).count_adjustments;
const acertoCli = path.join(raiz, "tools", "acerto-btg-2026-10", "acerto.mjs");
const planoRecontada = path.join(os.tmpdir(), `plano-acerto-recontada-${process.pid}.mjs`);
const op = (id, tipo, extra) => ({ id, tipo, motivo: "cenário", ...extra });
writeFileSync(
  planoRecontada,
  `export const PLANO = ${JSON.stringify({ id: "cenario-recontada", cliente: BTG, referencia: "cenário", ator: { uid: "script:acerto-cenario", role: "admin", name: "Acerto do cenário", email: "ops@dutelog.com.br" } })};\n` +
    `export const BLOCOS = ${JSON.stringify([
      {
        id: "recontada",
        titulo: "cenário",
        ops: [
          op("baixa-item-recontado", "baixar_caixa", { caixa: "CX-000900", itens: [{ codigo: "BTG-000300", qtde: 5 }] }),
          op("baixa-caixa-inteira", "baixar_caixa", { caixa: "CX-000900" }),
          op("ajustar-item-recontado", "ajustar_linha", { caixa: "CX-000900", codigo: "BTG-000300", delta: -1 }),
          op("adicionar-fora-da-lista", "adicionar_linha", { caixa: "CX-000900", codigo: "A.01.0820.003.G", qtde: 1 }),
          op("zerar-item-recontado", "zerar_sku", { codigo: "BTG-000300" }),
          op("remover-recontada", "remover_caixa", { caixa: "CX-000900" }),
          op("ajustar-outro-item", "ajustar_linha", { caixa: "CX-000900", codigo: "BTG-000301", delta: 1 }),
        ],
      },
    ])};\n`,
);
const acerto = (...extra) => spawnSync(process.execPath, [acertoCli, "--projeto", PROJETO, ...extra], { encoding: "utf8", env: { ...process.env, ACERTO_PLANO: planoRecontada } });
/** As linhas de uma operação no dry-run do acerto: do "[id]" até a próxima operação. */
const daOp = (saida, id) => {
  const linhas = saida.split(/\r?\n/);
  const inicio = linhas.findIndex((l) => l.startsWith(`[${id}]`));
  assert.ok(inicio >= 0, `a operação ${id} não está na saída:\n${saida}`);
  const fim = linhas.findIndex((l, i) => i > inicio && (l.startsWith("[") || !l.trim()));
  return linhas.slice(inicio, fim < 0 ? undefined : fim).join("\n");
};
const antesDoAcerto = await contarTudo();
const seco = acerto();
assert.equal(seco.status, 1, `o dry-run com recusa sai com 1:\n${seco.stdout}\n${seco.stderr}`);
for (const [id, frase] of [
  ["baixa-item-recontado", /ERRO {4}: a recontagem já ajustou BTG-000300 \(A\.01\.0820\.003\.P\) na caixa CX-000900 \(−2 em .*\): a baixa pela linha da abertura contaria de novo o que ela acertou\. Confira com --caixa CX-000900/],
  ["baixa-caixa-inteira", /ERRO {4}: a recontagem já ajustou a caixa CX-000900 \(BTG-000300 −2 em .*; BTG-000302 \+1 em .*\): a baixa da caixa inteira tira o que as linhas da abertura têm/],
  ["ajustar-item-recontado", /ERRO {4}: a recontagem já ajustou BTG-000300 .*: ajustar a linha da abertura contaria de novo o que ela acertou/],
  ["adicionar-fora-da-lista", /ERRO {4}: a recontagem já ajustou BTG-000302 \(A\.01\.0820\.003\.G\) na caixa CX-000900 \(\+1 em .*\): a linha nova contaria de novo o que ela pôs na caixa/],
  ["zerar-item-recontado", /ERRO {4}: a recontagem já ajustou A?.*BTG-000300.* na caixa CX-\d+ .*: zerar o SKU tira o saldo e as linhas da abertura, e o ajuste dela ficaria sozinho na caixa/],
  ["remover-recontada", /ERRO {4}: a recontagem já ajustou a caixa CX-000900 .*: remover ou esvaziar zera o registro da caixa por cima do que a recontagem acertou, e remover apaga o ajuste/],
]) {
  assert.match(daOp(seco.stdout, id), frase, daOp(seco.stdout, id));
}
assert.match(daOp(seco.stdout, "ajustar-outro-item"), /grava {3}: linha e caixa 10 → 11/, daOp(seco.stdout, "ajustar-outro-item"));
assert.deepEqual(await contarTudo(), antesDoAcerto, "o dry-run não grava");
// O --caixa mostra a recontagem e o que fica pela regra.
const listagem = acerto("--caixa", "CX-000900");
assert.equal(listagem.status, 0, listagem.stderr);
assert.match(listagem.stdout, /recontagem: BTG-000300 \(A\.01\.0820\.003\.P\) −2 em .*; BTG-000302 \(A\.01\.0820\.003\.G\) \+1 em /);
// Na ordem das linhas da abertura (o id delas), e o item que só a recontagem pôs na caixa por último.
assert.match(listagem.stdout, /fica pela regra \(entrada − retirado \+ ajustes\): BTG-000301 \(A\.01\.0820\.003\.M\) 10, BTG-000300 \(A\.01\.0820\.003\.P\) 18, BTG-000302 \(A\.01\.0820\.003\.G\) 1\n/);
assert.match(acerto("--buscar", "BTG-000300").stdout, /recontagem na CX-000900 \(C-12\): −2 em /);
// Só a operação no outro item grava, e o ajuste da recontagem fica como estava.
const grava900 = acerto("--op", "ajustar-outro-item", "--aplicar");
assert.equal(grava900.status, 0, `${grava900.stdout}\n${grava900.stderr}`);
const caixa900 = await dado("warehouse_boxes", "CX-000900");
assert.deepEqual([caixa900.unit_count, caixa900.status, (await dado("opening_inventory_lines", "line_cenario_900_m")).counted_qty], [31, "stored", 11]);
assert.deepEqual(caixa900.count_adjustments, ajustes900, "o ajuste da recontagem fica como estava");

console.log("Cenário da correção de código no emulador ok: a CX-000229 por transferência, com o cadastro errado apagado e o código só no histórico, a retomada depois da queda, antes da guarda e antes da entrada, o SKU com outra vida que fica, o caminho no mesmo SKU, as recusas, o PED-0001 (o XG lançado como XGG, com a separação no meio), a correção pendente, o SKU certo criado pelo acerto e a caixa recontada (o ajuste de outro item fica; o item ajustado recusa, na correção e no acerto).");
process.exit(0);
