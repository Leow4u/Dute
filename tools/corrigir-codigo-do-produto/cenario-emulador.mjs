#!/usr/bin/env node
/**
 * Cenário no emulador do Firestore, com o fluxo de verdade do Receber por
 * caixa (as funções de domínio de functions/wms/lib): a chegada da BTG com
 * A.02.0810.002.M (produto novo) e A.01.0810.002.G na CX-000229, conferida,
 * com entrada, etiqueta e guarda em B-07. Roda corrigir.mjs sem gravar e
 * gravando, confere cada coleção e procura o código errado em todo o banco:
 * só o histórico (movimentos, eventos, recibos) e os campos acerto_codigo
 * podem guardá-lo. Depois, o que a operação faz com o produto (Ajuste,
 * pedido, separação pela caixa, chegada nova com cada código), a correção
 * antes da guarda e antes da entrada, e cada recusa. Recusa rodar fora de
 * 127.0.0.1 (nunca toca a nuvem).
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
const { FieldValue, getFirestore } = requireWms("firebase-admin/firestore");
const db = getFirestore(initializeApp({ projectId: PROJETO }));
const dominio = (arquivo) => import(pathToFileURL(path.join(wms, "lib", "domain", arquivo)).href);
const operations = await dominio("operations.js");
const caixasDoRecebimento = await dominio("inbound-boxes.js");
const posicoes = await dominio("warehouse-positions.js");
const separacao = await dominio("pick-progress.js");
const { ErroDaCorrecao, aplicar, idDoItemParado, idDoRecibo, leitorDoBanco, planejar, prepararNome } = await import("./corrigir.mjs");
const { CORRECOES } = await import("./correcoes.mjs");
const { FieldPath } = requireWms("firebase-admin/firestore");

const BTG = "BTG Pactual";
const guilherme = { uid: "wms-guilherme", name: "Guilherme", role: "wms", email: "guilherme@dutelog.com.br" };
const coordenacao = { uid: "ops-1", name: "Coordenação", role: "interno", email: "ops@dutelog.com.br" };
const cliente = { uid: "cli-1", name: "Cliente BTG", role: "cliente", customer_code: BTG };
const CAIXA = { length_m: 0.48, width_m: 0.38, height_m: 0.3, gross_weight_kg: 9.4 };
const FOTO = "https://firebasestorage.googleapis.com/v0/b/demo-corrigir-codigo.appspot.com/o/product-photos%2FBTG_Pactual%2Fpolo-m.jpg?alt=media";
const ERRADO = "A.02.0810.002.M";
const CERTO = "A.01.0810.002.M";
const NOME_ERRADO = "Polo Feminino Piquet Preto";
const NOME_CERTO = "Polo Masculino Piquet Preto";

let contador = 0;
const chave = (rotulo) => `${rotulo}-${++contador}`;
const dado = async (colecao, id) => (await db.collection(colecao).doc(id).get()).data();
const existe = async (colecao, id) => (await db.collection(colecao).doc(id).get()).exists;
const tamanho = (codigo) => codigo.split(".").pop();
const rev = async (codigo) => Number((await dado("warehouse_boxes", codigo))?.conference_revision ?? 0);
const doScript = async (colecao) => (await db.collection(colecao).where("source", "==", "script_corrigir_codigo_do_produto").get()).size;

// --- O banco: layout, cliente, catálogo -----------------------------------------------

const limpar = await fetch(`http://${host}/emulator/v1/projects/${PROJETO}/databases/(default)/documents`, { method: "DELETE" });
assert.equal(limpar.ok, true, await limpar.text());
await posicoes.seedDefaultWarehouseLayout(db, coordenacao);
await posicoes.upsertWarehousePositions(
  db,
  { positions: [5, 6, 7, 8, 9, 10, 11, 12].map((shelf) => ({ aisle: "B", shelf, length_m: 1.8, depth_m: 0.75, height_m: 0.65, customer_code: BTG })) },
  coordenacao,
);
const lote = db.batch();
lote.set(db.collection("customers").doc("btg"), { code: BTG, customer_code: BTG, name: BTG, sku_prefix: "BTG", status: "active", operation_template: "uniformes" });
lote.set(db.collection("sku_counters").doc("BTG"), { prefix: "BTG", customer_code: BTG, last: 180 });
lote.set(db.collection("warehouse_counters").doc("boxes"), { last: 228 });
const cadastro = [
  ["BTG-000150", "A.01.0810.002.P", "Polo Masculino Piquet Preto", "Masculino"],
  ["BTG-000151", "A.01.0810.002.G", "Polo Masculino Piquet Preto", "Masculino"],
  ["BTG-000160", "A.02.0810.002.P", "Polo Feminino Piquet Preto", "Feminino"],
  ["BTG-000170", "A.01.0817.001.M", "Camisa Masculino Social Azul", "Masculino"],
];
for (const [id, codigo, produto, genero] of cadastro) {
  const comum = { customer_code: BTG, cod_cliente: codigo, cod_cliente_key: codigo, produto, genero, tamanho: tamanho(codigo), size: tamanho(codigo), category: "Uniformes", status: "active", archived: false };
  lote.set(db.collection("skus").doc(id), { id, ...comum, cod_btg: id, sku_code: id, sku_code_key: id, estoque_atual: 0, estoque_reservado: 0, estoque_disponivel: 0 });
  lote.set(db.collection("products").doc(codigo), { id: codigo, ...comum, estoque_btg: 0, num_skus: 1 });
}
await lote.commit();

/**
 * Uma chegada por caixa pelo caminho da tela. `itens`: { codigo, nome, qtd, sku? }
 * (com `sku`, produto do cadastro; sem, produto novo). `caixas`: o que vai em cada
 * caixa, [[índice do item, quantidade]]; sem, uma caixa com tudo. `ate`: "fechada",
 * "destino", "entrada" ou "guardada".
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
          ? { line_number: i + 1, product_registration: "existing", sku_code: item.sku, client_item_code: item.codigo, product_name: item.nome, size: tamanho(item.codigo), location_id: "RECEBIMENTO", quantity: item.qtd }
          : { line_number: i + 1, product_registration: "new", client_item_code: item.codigo, product_name: item.nome, size: tamanho(item.codigo), category: "Uniformes", unit_cost: 45.9, photo_urls: [FOTO], location_id: "RECEBIMENTO", quantity: item.qtd },
      ),
    },
    guilherme,
    { boxReceivingEnabled: true },
  );
  const receiptId = String(criada.receipt_id);
  const linhas = (await db.collection("inbound_items").where("receipt_id", "==", receiptId).get()).docs.sort((a, b) => a.get("line_number") - b.get("line_number"));
  const codigos = [];
  for (const conteudo of caixas ?? [itens.map((item, i) => [i, item.qtd])]) {
    const codigo = String((await caixasDoRecebimento.startInboundBox(db, { receipt_id: receiptId, idempotency_key: chave("iniciar") }, guilherme)).box.code);
    for (const [i, qtd] of conteudo) {
      await caixasDoRecebimento.saveInboundBoxLine(db, { receipt_id: receiptId, box_code: codigo, inbound_item_id: linhas[i].id, counted_qty: qtd, expected_revision: await rev(codigo), idempotency_key: chave("linha") }, guilherme);
    }
    await caixasDoRecebimento.setInboundBoxState(db, { action: "close", receipt_id: receiptId, box_code: codigo, ...CAIXA, expected_revision: await rev(codigo), idempotency_key: chave("fechar") }, guilherme);
    if (ate !== "fechada") {
      await caixasDoRecebimento.confirmInboundBoxDestination(db, { receipt_id: receiptId, box_code: codigo, location_id: prateleira, expected_revision: await rev(codigo), idempotency_key: chave("destino") }, guilherme);
      await caixasDoRecebimento.recordInboundBoxLabelPrint(db, { receipt_id: receiptId, box_code: codigo, location_id: prateleira, idempotency_key: chave("etiqueta") }, guilherme);
    }
    codigos.push(codigo);
  }
  if (ate === "entrada" || ate === "guardada") await entrada(receiptId);
  if (ate === "guardada") for (const codigo of codigos) await guardar(receiptId, codigo, prateleira);
  return { receiptId, receiptNumber: String(criada.receipt_number), caixas: codigos, linhas: linhas.map((d) => d.id), skus: criada.items.map((i) => i.sku_code) };
}
const entrada = (receiptId) => caixasDoRecebimento.completeInboundBoxReceipt(db, { receipt_id: receiptId, expected_status: "created", idempotency_key: chave("entrada") }, guilherme);
const guardar = async (receiptId, codigo, prateleira) =>
  caixasDoRecebimento.storeInboundBox(db, { receipt_id: receiptId, box_code: codigo, location_id: prateleira, expected_revision: await rev(codigo), idempotency_key: chave("guardar") }, guilherme);

const rodar = (...extra) =>
  JSON.parse(execFileSync(process.execPath, [path.join(raiz, "tools", "corrigir-codigo-do-produto", "corrigir.mjs"), "--projeto", PROJETO, "--json", ...extra], { encoding: "utf8", env: process.env }));

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

// --- 1. A chegada de 10/11: A.02.0810.002.M (novo, errado) e A.01.0810.002.G na CX-000229, guardada em B-07 ------

const r1 = await chegada([
  { codigo: ERRADO, nome: NOME_ERRADO, qtd: 12 },
  { codigo: "A.01.0810.002.G", nome: "Polo Masculino Piquet Preto", qtd: 10, sku: "BTG-000151" },
]);
assert.deepEqual(r1.caixas, ["CX-000229"]);
const SKU = r1.skus[0];
assert.equal(SKU, "BTG-000181", "o produto novo ganhou o próximo SKU da BTG");
assert.equal((await dado("warehouse_boxes", "CX-000229")).status, "stored");
assert.equal((await dado("skus", SKU)).cod_cliente, ERRADO);
const arrival = (await db.collection("events").where("type", "==", "inventory.arrival_stored").get()).docs;
assert.equal(arrival.length, 1, "a última guarda gravou o aviso de chegada");
// O relógio de parados do núcleo (runMeasures, que não roda aqui) já leu os movimentos da chegada.
await db.collection("ai_stock_age").doc(idDoItemParado(BTG, SKU)).set({ tipo: "item", customer_code: BTG, sku_code: SKU, client_item_code: ERRADO, product_name: NOME_ERRADO, saldo: 12 });

// --- 2. Dry-run: mostra, não grava ---------------------------------------------------

const antesDoDryRun = JSON.stringify(await ondeAparece(ERRADO));
const mostra = rodar();
const [cx229] = mostra.correcoes;
assert.equal(mostra.aplicar, false);
assert.equal(cx229.estado, "a_gravar", JSON.stringify(cx229));
assert.equal(cx229.sku, SKU);
assert.equal(cx229.nome, NOME_CERTO);
assert.equal(cx229.nome_origem, "família A.01.0810.002 (P, G)");
assert.ok(cx229.estado_hoje.some((l) => /aviso de chegada ao cliente: gravado/.test(l)), cx229.estado_hoje.join("\n"));
assert.ok(cx229.grava.some((l) => l.startsWith(`products/${CERTO}`)));
assert.equal(JSON.stringify(await ondeAparece(ERRADO)), antesDoDryRun, "o dry-run não grava");
assert.equal(await doScript("events"), 0);
const texto = execFileSync(process.execPath, [path.join(raiz, "tools", "corrigir-codigo-do-produto", "corrigir.mjs"), "--projeto", PROJETO], { encoding: "utf8", env: process.env });
console.log(texto);
assert.match(texto, /DRY-RUN, nada será gravado/);
assert.match(texto, /Para gravar:/);

// --- 3. Grava ----------------------------------------------------------------------

const movimentosAntes = (await db.collection("movements").where("sku_code", "==", SKU).get()).docs.map((d) => JSON.stringify(d.data())).sort();
const grava = rodar("--aplicar");
assert.equal(grava.correcoes[0].estado, "corrigido", JSON.stringify(grava.correcoes[0]));

const skuDepois = await dado("skus", SKU);
assert.deepEqual([skuDepois.cod_cliente, skuDepois.cod_cliente_key, skuDepois.produto, skuDepois.genero, skuDepois.tamanho], [CERTO, CERTO, NOME_CERTO, "Masculino", "M"]);
assert.deepEqual(skuDepois.acerto_codigo.antes, { cod_cliente: ERRADO, produto: NOME_ERRADO, genero: null });
assert.equal(skuDepois.estoque_atual, 12, "o saldo do cadastro não muda");
assert.deepEqual(skuDepois.photo_urls, [FOTO], "as fotos ficam");
assert.equal(skuDepois.updated_by.uid, "script:corrigir-codigo-do-produto");
assert.equal(await existe("products", ERRADO), false, "o cartão com o código errado sai");
const cartao = await dado("products", CERTO);
assert.deepEqual([cartao.id, cartao.cod_cliente, cartao.cod_cliente_key, cartao.produto, cartao.genero, cartao.estoque_btg, cartao.source_receipt_id], [CERTO, CERTO, CERTO, NOME_CERTO, "Masculino", 12, r1.receiptId]);
assert.ok(cartao.created_at, "a criação original fica");
const saldos = (await db.collection("stock_balances").where("sku_code", "==", SKU).get()).docs.map((d) => d.data());
assert.deepEqual(saldos.map((s) => [s.location_id, s.qty_on_hand, s.client_item_code, s.product_name]).sort(), [["B-07", 12, CERTO, NOME_CERTO], ["RECEBIMENTO", 0, CERTO, NOME_CERTO]]);
const portal = await dado("client_inventory", `cinv_BTG_Pactual__${SKU}`);
assert.deepEqual([portal.client_item_code, portal.product_name, portal.qty_on_hand, portal.qty_available], [CERTO, NOME_CERTO, 12, 12]);
const idade = await dado("ai_stock_age", idDoItemParado(BTG, SKU));
assert.deepEqual([idade.client_item_code, idade.product_name, idade.saldo], [CERTO, NOME_CERTO, 12]);
const preco = await dado("catalog_prices", `cprice_BTG_Pactual__${SKU}`);
assert.deepEqual([preco.item_code, preco.preco_unit], [CERTO, 45.9]);
const caixa = await dado("warehouse_boxes", "CX-000229");
assert.deepEqual(caixa.lines.map((l) => [l.sku_code, l.client_item_code, l.product_name, l.counted_qty]), [[SKU, CERTO, NOME_CERTO, 12], ["BTG-000151", "A.01.0810.002.G", "Polo Masculino Piquet Preto", 10]]);
assert.deepEqual([caixa.status, caixa.location_id, caixa.unit_count], ["stored", "B-07", 22]);
assert.equal(caixa.acerto_codigo.antes.client_item_code, ERRADO);
const tarefa = (await db.collection("putaway_tasks").where("box_code", "==", "CX-000229").get()).docs[0].data();
assert.deepEqual(tarefa.lines.map((l) => l.client_item_code), [CERTO, "A.01.0810.002.G"]);
const linhaDaNf = await dado("inbound_items", r1.linhas[0]);
assert.deepEqual([linhaDaNf.client_item_code, linhaDaNf.product_name, linhaDaNf.sku_code], [CERTO, NOME_CERTO, SKU]);
assert.deepEqual(linhaDaNf.acerto_codigo.antes, { client_item_code: ERRADO, product_name: NOME_ERRADO });
const tipos = (await db.collection("events").where("source", "==", "script_corrigir_codigo_do_produto").get()).docs.map((d) => [d.get("type"), d.get("entity_id")]).sort();
assert.deepEqual(tipos, [["catalog.code_corrected", SKU], ["inbound.item_corrected", r1.receiptId], ["warehouse.box_content_corrected", "CX-000229"]]);
const recibo = await dado("operational_operations", idDoRecibo(CORRECOES[0]));
assert.equal(recibo.kind, "corrigir_codigo.trocar");
assert.equal(recibo.result.product_antes.cod_cliente, ERRADO, "o recibo guarda o cartão de antes");
const movimentosDepois = (await db.collection("movements").where("sku_code", "==", SKU).get()).docs.map((d) => JSON.stringify(d.data())).sort();
assert.deepEqual(movimentosDepois, movimentosAntes, "o razão não muda");

// Nenhuma cópia esquecida: o código errado só no histórico e no acerto_codigo.
const sobrou = (await ondeAparece(ERRADO)).filter((onde) => !historico(onde));
assert.deepEqual(sobrou, [], `o código errado ainda está em: ${sobrou.join(", ")}`);
const nomeSobrou = (await ondeAparece(NOME_ERRADO)).filter((onde) => !historico(onde) && !/BTG-000160|A\.02\.0810\.002\.P/.test(onde));
assert.deepEqual(nomeSobrou, [], `o nome errado ainda está em: ${nomeSobrou.join(", ")}`);
// Nem a família errada (o código sem o tamanho) ficou em algum campo derivado: só a feminina P, que é dela.
const familiaSobrou = (await ondeAparece("A.02.0810.002")).filter((onde) => !historico(onde) && !/^(skus\/BTG-000160|products\/A\.02\.0810\.002\.P)(:|$)/.test(onde));
assert.deepEqual(familiaSobrou, [], `a família errada ainda está em: ${familiaSobrou.join(", ")}`);

// --- 4. De novo: já aplicada, nada repetido -----------------------------------------

assert.equal(rodar().correcoes[0].estado, "ja_aplicado");
assert.equal(rodar("--aplicar").correcoes[0].estado, "ja_aplicado");
assert.equal(await doScript("events"), 3);
assert.equal(await doScript("operational_operations"), 1);

// --- 5. A operação com o produto corrigido -------------------------------------------

// Ajuste + e −: o cartão novo de products recebe o agregado.
for (const [type, idem] of [["ENTRADA", "aj-mais"], ["SAIDA", "aj-menos"]]) {
  await operations.createInventoryMovementTransaction(db, { type, quantity: 1, customer_code: BTG, sku_code: SKU, client_item_code: CERTO, product_name: NOME_CERTO, location_id: "B-07", reason: "Conferência do cenário", idempotency_key: idem }, coordenacao);
  assert.equal((await dado("products", CERTO)).estoque_btg, type === "ENTRADA" ? 13 : 12);
}
// Pedido do portal, aprovado, e a separação baixa a CX-000229 pelo SKU.
const pedido = await operations.createCustomerRequestTransaction(db, { type: "retirada", priority: "normal", title: "Polos do evento", customer_code: BTG, idempotency_key: "pedido-1", items: [{ sku_code: SKU, product_name: NOME_CERTO, quantity: 2 }] }, cliente);
const aprovado = await operations.decideCustomerRequestTransaction(db, { request_id: String(pedido.id), action: "approve", expected_status: "open", idempotency_key: "aprovar-1" }, coordenacao);
assert.equal((await dado("client_inventory", `cinv_BTG_Pactual__${SKU}`)).client_item_code, CERTO);
const linhaDoPedido = (await db.collection("pick_lines").where("pick_task_id", "==", String(aprovado.pick_task_id)).get()).docs[0];
await separacao.setPickLineSeparated(db, { pick_task_id: String(aprovado.pick_task_id), pick_line_id: linhaDoPedido.id, separated: true, idempotency_key: "separar-1" }, guilherme);
const separada = await dado("warehouse_boxes", "CX-000229");
assert.deepEqual(separada.taken_lines?.map((t) => [t.sku_code, t.qty]), [[SKU, 2]], "a separação achou a peça na CX-000229");
// O código errado ficou livre: a feminina M de verdade entra como produto novo, com outro SKU.
const feminina = await chegada([{ codigo: ERRADO, nome: NOME_ERRADO, qtd: 3 }], { ate: "fechada", prateleira: "B-08" });
assert.equal(feminina.skus[0], "BTG-000182");
// E o código certo já é do BTG-000181: produto novo com ele é recusado.
await assert.rejects(chegada([{ codigo: CERTO, nome: NOME_CERTO, qtd: 1 }], { ate: "fechada", prateleira: "B-08" }), /já existe no cadastro/);

// --- 6. Antes da guarda: a entrada concluída, a caixa reservada --------------------

async function corrigir(correcao) {
  const nome = await prepararNome(db, FieldPath, correcao);
  return aplicar(db, FieldValue, correcao, nome);
}
const correcao = (id, de, para, caixas, extra = {}) => ({ id, cliente: BTG, de, para, caixas, genero: "Masculino", nome: "familia", referencia: "cenário", motivo: "cenário", decisao: "cenário", ...extra });

const r2 = await chegada([{ codigo: "A.02.0815.001.M", nome: "Camisa Feminino Social Branca", qtd: 5 }], { ate: "entrada", prateleira: "B-09" });
const c2 = await corrigir(correcao("cenario-antes-da-guarda", "A.02.0815.001.M", "A.01.0815.001.M", r2.caixas));
assert.equal(c2.estado, "corrigido");
assert.equal(c2.nome, "Camisa Masculino Social Branca", "sem família: o nome de hoje com Masculino");
await guardar(r2.receiptId, r2.caixas[0], "B-09");
const saldoR2 = (await db.collection("stock_balances").where("sku_code", "==", r2.skus[0]).where("location_id", "==", "B-09").get()).docs[0].data();
assert.deepEqual([saldoR2.client_item_code, saldoR2.qty_on_hand], ["A.01.0815.001.M", 5]);
const avisoR2 = (await db.collection("events").where("type", "==", "inventory.arrival_stored").get()).docs.find((d) => d.get("payload.receipt_id") === r2.receiptId).data();
assert.deepEqual(avisoR2.payload.items.map((i) => [i.client_item_code, i.product_name]), [["A.01.0815.001.M", "Camisa Masculino Social Branca"]], "o aviso ao cliente sai com o código certo");

// --- 7. Antes da entrada: a caixa fechada, sem saldo ---------------------------------

const r3 = await chegada([{ codigo: "A.02.0816.001.M", nome: "Camisa Feminino Social Preta", qtd: 3 }], { ate: "fechada", prateleira: "B-10" });
const c3 = await corrigir(correcao("cenario-antes-da-entrada", "A.02.0816.001.M", "A.01.0816.001.M", r3.caixas));
assert.equal(c3.estado, "corrigido");
assert.equal(c3.documentos.saldos, 0);
await caixasDoRecebimento.confirmInboundBoxDestination(db, { receipt_id: r3.receiptId, box_code: r3.caixas[0], location_id: "B-10", expected_revision: await rev(r3.caixas[0]), idempotency_key: chave("destino") }, guilherme);
await entrada(r3.receiptId);
await guardar(r3.receiptId, r3.caixas[0], "B-10");
const portalR3 = await dado("client_inventory", `cinv_BTG_Pactual__${r3.skus[0]}`);
assert.deepEqual([portalR3.client_item_code, portalR3.product_name, portalR3.qty_on_hand], ["A.01.0816.001.M", "Camisa Masculino Social Preta", 3]);
assert.deepEqual((await ondeAparece("A.02.0816.001.M")).filter((onde) => !historico(onde)), []);

// --- 8. As recusas -------------------------------------------------------------------

async function recusa(correcaoDoCaso, padrao) {
  const nome = await prepararNome(db, FieldPath, correcaoDoCaso);
  const antes = JSON.stringify((await db.collection("events").get()).size);
  await assert.rejects(aplicar(db, FieldValue, correcaoDoCaso, nome), (erro) => erro instanceof ErroDaCorrecao && padrao.test(erro.message));
  assert.equal(JSON.stringify((await db.collection("events").get()).size), antes, `${correcaoDoCaso.id}: nada gravado`);
}
// O código certo já existe (BTG-000170): o caminho seria a transferência.
const r4 = await chegada([{ codigo: "A.02.0817.001.M", nome: "Camisa Feminino Social Azul", qtd: 2 }], { ate: "guardada", prateleira: "B-11" });
await recusa(correcao("cenario-certo-existe", "A.02.0817.001.M", "A.01.0817.001.M", r4.caixas), /já existe no cadastro: BTG-000170/);
// Movimento de fora da chegada.
const r5 = await chegada([{ codigo: "A.02.0818.001.M", nome: "Camisa Feminino Social Verde", qtd: 4 }], { ate: "guardada", prateleira: "B-12" });
await operations.createInventoryMovementTransaction(db, { type: "SAIDA", quantity: 1, customer_code: BTG, sku_code: r5.skus[0], location_id: "B-12", reason: "Saldão", idempotency_key: "saida-r5" }, coordenacao);
await recusa(correcao("cenario-movimento-de-fora", "A.02.0818.001.M", "A.01.0818.001.M", r5.caixas), /movimento\(s\) fora da chegada/);
// O SKU em duas caixas, a correção só com uma.
const r6 = await chegada([{ codigo: "A.02.0819.001.M", nome: "Camisa Feminino Social Rosa", qtd: 4 }], { caixas: [[[0, 2]], [[0, 2]]], ate: "destino", prateleira: "B-05" });
await recusa(correcao("cenario-outra-caixa", "A.02.0819.001.M", "A.01.0819.001.M", [r6.caixas[0]]), /também está na\(s\) caixa\(s\) /);
assert.equal((await corrigir(correcao("cenario-duas-caixas", "A.02.0819.001.M", "A.01.0819.001.M", r6.caixas))).estado, "corrigido", "com as duas caixas, corrige");
// O SKU que já existia antes da chegada (a feminina P): trocar levaria o que ele já era.
const r7 = await chegada([{ codigo: "A.02.0810.002.P", nome: "Polo Feminino Piquet Preto", qtd: 2, sku: "BTG-000160" }], { ate: "fechada", prateleira: "B-06" });
await recusa(correcao("cenario-sku-antigo", "A.02.0810.002.P", "A.01.0898.002.P", r7.caixas), /não nasceu na chegada/);
// A caixa sem o código.
await recusa(correcao("cenario-caixa-sem-codigo", "A.02.9999.999.M", "A.01.9999.999.M", ["CX-000229"]), /0 linha\(s\) com A\.02\.9999\.999\.M/);
// Com reserva.
const r8 = await chegada([{ codigo: "A.02.0820.001.M", nome: "Camisa Feminino Social Lilás", qtd: 3 }], { ate: "guardada", prateleira: "B-06" });
const pedidoR8 = await operations.createCustomerRequestTransaction(db, { type: "retirada", priority: "normal", title: "Camisas", customer_code: BTG, idempotency_key: "pedido-r8", items: [{ sku_code: r8.skus[0], product_name: "Camisa Feminino Social Lilás", quantity: 1 }] }, cliente);
await recusa(correcao("cenario-pedido-aberto", "A.02.0820.001.M", "A.01.0820.001.M", r8.caixas), /solicitação do portal em aberto/);
await operations.decideCustomerRequestTransaction(db, { request_id: String(pedidoR8.id), action: "approve", expected_status: "open", idempotency_key: "aprovar-r8" }, coordenacao);
await recusa(correcao("cenario-reserva", "A.02.0820.001.M", "A.01.0820.001.M", r8.caixas), /reserva\(s\) em stock_reservations/);
// Estoque congelado.
await db.collection("system_controls").doc("inventory").set({ movements_frozen: true });
await recusa(correcao("cenario-congelado", "A.02.0819.001.M", "A.01.0819.001.M", r6.caixas), /congeladas/);
await db.collection("system_controls").doc("inventory").delete();
// O plano lido com o banco é o mesmo da transação: o dry-run da correção já aplicada diz isso.
assert.equal((await planejar(leitorDoBanco(), db, FieldValue, CORRECOES[0], { nome: await prepararNome(db, FieldPath, CORRECOES[0]) })).jaAplicado, true);

console.log("Cenário da correção de código no emulador ok: dry-run sem gravar, CX-000229 corrigida sem sobrar cópia do código errado, retomada sem repetir, a operação seguindo com o produto, a correção antes da guarda e antes da entrada, e as 8 recusas.");
process.exit(0);
