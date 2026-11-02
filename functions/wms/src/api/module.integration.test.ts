import { createModuleHandler } from "./shared/handler.js";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { advanceWarehouseTaskTransaction } from "../domain/operations.js";
import { armazenagemApi } from "./module.js";
import type { ApiContext } from "./shared/core.js";
const project = "demo-dute-api-wms";
const app = initializeApp({ projectId: project }, "api-wms-tests");
const db = getFirestore(app);
const ctx: ApiContext = { db, project, actor: { uid: "api:wms-test", name: "API teste", role: "wms" }, integration: { id: "wms-test", delegated_by: "human", customers: ["A"], scopes: ["armazenagem:ler", "armazenagem:pedidos:gravar", "armazenagem:recebimentos:gravar", "armazenagem:estoque:movimentar"], write_policy: "scoped" }, idempotencyKey: "unused" };
async function run(method: string, path: string, body?: unknown, params: Record<string, string> = {}, key = path + JSON.stringify(body), context = ctx) {
  const route = armazenagemApi.routes.find((entry) => entry.method === method && entry.path === "/api/v1/armazenagem" + path)!;
  assert.ok(route, path);
  return await route.run({ ...context, idempotencyKey: key }, params, { method, path: route.path, headers: {}, query: { customer_code: "A" }, body }) as Record<string, any>;
}
before(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  assert.ok(host, "FIRESTORE_EMULATOR_HOST obrigatório; somente demo-dute-api-wms");
  assert.equal(app.options.projectId, project);
  const response = await fetch(`http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: "DELETE" });
  assert.equal(response.ok, true);
  await Promise.all([
    db.collection("customers").doc("A").set({ customer_code: "A", code: "A", name: "A", sku_prefix: "AAA", status: "active" }),
    db.collection("skus").doc("SKU-A").set({ customer_code: "A", sku_code: "SKU-A", cod_btg: "SKU-A", cod_cliente: "ITEM-A", produto: "Produto A" }),
    db.collection("products").doc("ITEM-A").set({ customer_code: "A", cod_cliente: "ITEM-A", produto: "Produto A" }),
    db.collection("skus").doc("SKU-B").set({ customer_code: "B", sku_code: "SKU-B", cod_btg: "SKU-B" }),
    db.collection("warehouse_positions").doc("A1").set({ customer_code: "A", code: "A1", status: "active" }),
    db.collection("warehouse_positions").doc("B1").set({ customer_code: "B", code: "B1", status: "active" }),
  ]);
});
after(async () => { await deleteApp(app); });
test("movimento usa razão, replay não duplica saldo/evento e isola SKU/local", async () => {
  const body = { customer_code: "A", type: "ENTRADA", quantity: 10, sku_code: "SKU-A", location_id: "A1", reason: "abertura API" };
  const first = await run("POST", "/movimentacoes", body, {}, "movement-one");
  assert.deepEqual(await run("POST", "/movimentacoes", body, {}, "movement-one"), first);
  assert.equal((await db.collection("movements").get()).size, 1);
  assert.equal((await db.collection("events").get()).size, 1);
  assert.equal((await run("GET", "/estoque")).data[0].qty_on_hand, 10);
  for (const change of [{ sku_code: "SKU-B" }, { location_id: "B1" }, { customer_code: "B" }]) await assert.rejects(run("POST", "/movimentacoes", { ...body, ...change }), { code: "permission-denied" });
  await assert.rejects(run("POST", "/movimentacoes", { ...body, quantity: 11 }, {}, "movement-one"), /[Ii]dempot|diferente|utilizada|conteúdo/);
  const listed = await run("GET", "/catalogo");
  assert.equal(listed.data.length, 1); assert.equal(listed.data[0].customer_code, "A");
});
test("pedido cria consulta aprova e controla edição", async () => {
  const input = { customer_code: "A", type: "solicitacao", title: "Pedido API", items: [{ sku_code: "SKU-A", quantity: 1 }] };
  const created = await run("POST", "/pedidos", input, {}, "request-one");
  const requestId = String(created.id || created.request_id);
  assert.equal((await run("GET", "/pedidos/{id}", undefined, { id: requestId })).data.status, "open");
  const decision = { action: "approve", expected_status: "open" };
  const updated = await run("PATCH", "/pedidos/{id}", decision, { id: requestId }, "approve-one");
  assert.deepEqual(await run("PATCH", "/pedidos/{id}", decision, { id: requestId }, "approve-one"), updated);
  assert.equal((await run("GET", "/pedidos/{id}", undefined, { id: requestId })).data.status, "approved");
  await assert.rejects(run("PATCH", "/pedidos/{id}", decision, { id: requestId }, "approve-two"), { code: "failed-precondition" });
});
test("recebimento cria consulta inicia e altera conferência com filhos isolados", async () => {
  const created = await run("POST", "/recebimentos", { customer_code: "A", items: [{ sku_code: "SKU-A", client_item_code: "ITEM-A", product_name: "Produto A", quantity: 3 }] }, {}, "receipt-one");
  const receiptId = String(created.id || created.receipt_id);
  const consulted = (await run("GET", "/recebimentos/{id}", undefined, { id: receiptId })).data;
  assert.equal(consulted.status, "created");
  // A integração cria por linha e o contrato da consulta não muda (recebimento com caixas, 4.10).
  assert.equal((await db.collection("inbound_receipts").doc(receiptId).get()).get("conference_mode"), "per_line");
  assert.equal("conference_mode" in consulted, false);
  await run("POST", "/recebimentos/{id}/avancar", { expected_status: "created" }, { id: receiptId }, "start-one");
  const rows = await run("GET", "/recebimentos/{id}/itens", undefined, { id: receiptId });
  assert.equal(rows.data.length, 1);
  const expectedVersion = (await run("GET", "/recebimentos/{id}", undefined, { id: receiptId })).data.expected_version;
  const body = { expected_version: expectedVersion, expected_status: "checking", lines: [{ inbound_item_id: rows.data[0].id, received_qty: 3, location_id: "A1" }] };
  const conference = await run("PATCH", "/recebimentos/{id}", body, { id: receiptId }, "conference-one");
  assert.deepEqual(await run("PATCH", "/recebimentos/{id}", body, { id: receiptId }, "conference-one"), conference);
  await db.collection("inbound_items").doc("foreign-line").set({ customer_code: "A", receipt_id: "another", sku_code: "SKU-A" });
  await assert.rejects(run("PATCH", "/recebimentos/{id}", { expected_version: expectedVersion, expected_status: "checking", lines: [{ inbound_item_id: "foreign-line", received_qty: 1 }] }, { id: receiptId }), { code: "permission-denied" });
  await run("POST", "/recebimentos/{id}/avancar", { expected_status: "checking" }, { id: receiptId }, "complete-one");
  assert.equal((await run("GET", "/recebimentos/{id}", undefined, { id: receiptId })).data.status, "received");
});

test("CAS da conferência: duas edições da mesma versão têm um vencedor e replay é preservado", async () => {
  const created = await run("POST", "/recebimentos", { customer_code: "A", items: [{ sku_code: "SKU-A", client_item_code: "ITEM-A", product_name: "Produto A", quantity: 3 }] }, {}, "cas-receipt");
  const receiptId = String(created.receipt_id);
  await run("POST", "/recebimentos/{id}/avancar", { expected_status: "created" }, { id: receiptId }, "cas-start");
  const detail = await run("GET", "/recebimentos/{id}", undefined, { id: receiptId });
  assert.match(detail.data.expected_version, /^\d+:\d+$/);
  const rows = await run("GET", "/recebimentos/{id}/itens", undefined, { id: receiptId });
  const bodies = [1, 2].map(received_qty => ({ expected_status: "checking", expected_version: detail.data.expected_version, lines: [{ inbound_item_id: rows.data[0].id, received_qty }] }));
  const results = await Promise.allSettled(bodies.map((body, i) => run("PATCH", "/recebimentos/{id}", body, { id: receiptId }, "cas-edit-" + i)));
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  const rejected = results.find(result => result.status === "rejected") as PromiseRejectedResult;
  assert.equal(rejected.reason.code, "aborted");
  const winner = results.findIndex(result => result.status === "fulfilled");
  const replay = await run("PATCH", "/recebimentos/{id}", bodies[winner], { id: receiptId }, "cas-edit-" + winner);
  assert.deepEqual(replay, (results[winner] as PromiseFulfilledResult<unknown>).value);
});
test("troca do cliente entre preflight e transação é recusada antes de qualquer efeito", async () => {
  const created = await run("POST", "/recebimentos", { customer_code: "A", items: [{ sku_code: "SKU-A", client_item_code: "ITEM-A", product_name: "Produto A", quantity: 3 }] }, {}, "race-receipt");
  const receiptId = String(created.receipt_id);
  await run("POST", "/recebimentos/{id}/avancar", { expected_status: "created" }, { id: receiptId }, "race-start");
  const detail = await run("GET", "/recebimentos/{id}", undefined, { id: receiptId });
  const rows = await run("GET", "/recebimentos/{id}/itens", undefined, { id: receiptId });
  const lineRef = db.collection("inbound_items").doc(rows.data[0].id);
  const before = (await lineRef.get()).data();
  let changed = false;
  const racingDb = new Proxy(db, { get(database, property) {
    if (property === "runTransaction") return async (work: Parameters<typeof db.runTransaction>[0]) => {
      if (!changed) { changed = true; await database.collection("inbound_receipts").doc(receiptId).update({ customer_code: "B" }); }
      return database.runTransaction(work);
    };
    const member = Reflect.get(database, property, database);
    return typeof member === "function" ? member.bind(database) : member;
  } });
  await assert.rejects(run("PATCH", "/recebimentos/{id}", { expected_status: "checking", expected_version: detail.data.expected_version, lines: [{ inbound_item_id: rows.data[0].id, received_qty: 2 }] }, { id: receiptId }, "race-edit", { ...ctx, db: racingDb }), { code: "permission-denied" });
  assert.equal(changed, true);
  assert.deepEqual((await lineRef.get()).data(), before);
});

test("handler pessoal wms: projeção, papel atual, cliente atual e bloqueio", async () => {
  const keyId = "a".repeat(32), token = `dute_${keyId}.${"s".repeat(43)}`;
  await db.doc("users/personal-human").set({ role: "cliente", customer_code: "PERSONAL", nome: "Pessoa" });
  await db.doc("client_access/PERSONAL").set({ modules: ["wms", "financeiro"] });
  await db.doc(`api_integrations/${keyId}`).set({ kind: "personal", permission: "full", delegated_by: "personal-human", scopes: [], customers: [], write_policy: "scoped", expires_at_ms: Date.now() + 600000, token_hash: createHash("sha256").update(token).digest("hex") });
  await db.doc("client_inventory/personal-row").set({ customer_code: "PERSONAL", name: "Pessoal", status: "open", secret: "never", created_by: { uid: `api:${keyId}` } });
  const handler = createModuleHandler(db, "dute-homolog", async () => ({ uid: "unused" }), armazenagemApi);
  const request = { method: "GET", path: "/api/v1/armazenagem/estoque", headers: { authorization: `Bearer ${token}` }, query: {} };
  const first = await handler(request);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.ok((first.body.data as any[]).some(row => row.id === "personal-row"));
  assert.ok((first.body.data as any[]).every(row => row.secret === undefined));
  assert.equal((await handler({ ...request, query: { customer_code: "OTHER" } })).status, 403);
  await db.doc("users/personal-human").update({ customer_code: "OTHER" });
  assert.equal(((await handler(request)).body.data as any[]).some(row => row.id === "personal-row"), false);
  await db.doc("users/personal-human").update({ customer_code: "PERSONAL" });
  await db.doc("client_access/PERSONAL").update({ modules: [] });
  assert.equal((await handler(request)).status, 403);
  await db.doc("client_access/PERSONAL").update({ modules: ["wms", "financeiro"] });
  await db.doc("users/personal-human").update({ role: "painel" });
  assert.equal((await handler(request)).status, 403);
  await db.doc("users/personal-human").update({ role: "cliente", access_disabled: true });
  assert.equal((await handler(request)).status, 403);
});

test("handler pessoal wms: grava com papel real e recibo de replay sem duplicar", async () => {
  const keyId = "b".repeat(32), token = `dute_${keyId}.${"s".repeat(43)}`;
  await db.doc("users/personal-writer").set({ role: "financeiro", nome: "Pessoa" });
  await db.doc(`api_integrations/${keyId}`).set({ kind: "personal", permission: "full", delegated_by: "personal-writer", scopes: [], customers: [], write_policy: "scoped", expires_at_ms: Date.now() + 600000, token_hash: createHash("sha256").update(token).digest("hex") });
  const handler = createModuleHandler(db, "dute-homolog", async () => ({ uid: "unused" }), armazenagemApi);
  const request = { method: "POST", path: "/api/v1/armazenagem/pedidos", headers: { authorization: `Bearer ${token}`, "idempotency-key": "personal-write" }, query: {}, body: { customer_code: "A", type: "solicitacao", title: "Pessoal", items: [{ sku_code: "SKU-A", quantity: 1 }] } };
  const first = await handler(request);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const replay = await handler(request);
  assert.equal(replay.status, 200, JSON.stringify(replay.body));
  assert.equal(replay.body.replayed, true);
  const events = await db.collection("events").get();
  const event = events.docs.find(doc => doc.get("actor.uid") === `api:${keyId}`);
  assert.ok(event, "evento com identidade da chave");
  assert.equal(event.get("actor.role"), "financeiro");
  const count = events.size;
  await db.doc("users/personal-writer").update({ role: "painel" });
  assert.equal((await handler(request)).status, 403);
  assert.equal((await db.collection("events").get()).size, count);
});

test("handler cliente pessoal: pedido valida tenant na transação e replay após troca de cliente", async () => {
  const keyId = "c".repeat(32), token = `dute_${keyId}.${"s".repeat(43)}`;
  await db.doc("users/personal-client-writer").set({ role: "cliente", customer_code: "A", nome: "Cliente" });
  for (const code of ["A", "B"]) await db.doc(`client_access/${code}`).set({ modules: ["wms"] });
  await db.doc(`api_integrations/${keyId}`).set({ kind: "personal", permission: "full", delegated_by: "personal-client-writer", scopes: [], customers: [], write_policy: "scoped", expires_at_ms: Date.now() + 600000, token_hash: createHash("sha256").update(token).digest("hex") });
  const handler = createModuleHandler(db, "dute-homolog", async () => ({ uid: "unused" }), armazenagemApi);
  const body = { customer_code: "A", type: "solicitacao", title: "Cliente pessoal", items: [{ sku_code: "SKU-A", quantity: 1 }] };
  const request = { method: "POST", path: "/api/v1/armazenagem/pedidos", headers: { authorization: `Bearer ${token}`, "idempotency-key": "client-personal-write" }, query: {}, body };
  assert.equal((await handler(request)).status, 201);
  assert.equal((await handler(request)).body.replayed, true);
  const badSku = await handler({ ...request, headers: { ...request.headers, "idempotency-key": "client-wrong-sku" }, body: { ...body, items: [{ sku_code: "SKU-B", quantity: 1 }] } });
  assert.equal(badSku.status, 403);
  await db.doc("users/personal-client-writer").update({ customer_code: "B" });
  assert.equal((await handler(request)).status, 403, "recibo antigo não abre cliente anterior");
});

async function saldos(skuCode: string) {
  const rows = await db.collection("stock_balances").where("customer_code", "==", "A").where("sku_code", "==", skuCode).get();
  return Object.fromEntries(rows.docs.map(doc => [doc.get("location_id"), [doc.get("qty_on_hand"), doc.get("qty_reserved"), doc.get("status")]]));
}
async function reservas(requestId: string) {
  const rows = await db.collection("stock_reservations").where("customer_request_id", "==", requestId).get();
  return rows.docs.map(doc => [doc.get("location_id"), doc.get("reserved_qty")]).sort();
}
async function produto(skuCode: string, itemCode: string) {
  await Promise.all([
    db.collection("skus").doc(skuCode).set({ customer_code: "A", sku_code: skuCode, cod_btg: skuCode, cod_cliente: itemCode, produto: `Produto ${skuCode}` }),
    db.collection("products").doc(itemCode).set({ customer_code: "A", cod_cliente: itemCode, produto: `Produto ${skuCode}` }),
  ]);
}

test("retirada pela API passa com o saldo zerado que a guarda deixa no RECEBIMENTO", async () => {
  await produto("SKU-R", "ITEM-R");
  // O Receber deixa a chegada na doca e abre a guarda; a guarda leva o item
  // à prateleira e deixa o saldo da doca zerado, sem apagá-lo.
  const receiptId = String((await run("POST", "/recebimentos", { customer_code: "A", items: [{ sku_code: "SKU-R", client_item_code: "ITEM-R", product_name: "Produto SKU-R", quantity: 4 }] }, {}, "dock-receipt")).receipt_id);
  await run("POST", "/recebimentos/{id}/avancar", { expected_status: "created" }, { id: receiptId }, "dock-start");
  const [linha] = (await run("GET", "/recebimentos/{id}/itens", undefined, { id: receiptId })).data;
  const versao = (await run("GET", "/recebimentos/{id}", undefined, { id: receiptId })).data.expected_version;
  await run("PATCH", "/recebimentos/{id}", { expected_version: versao, expected_status: "checking", lines: [{ inbound_item_id: linha.id, received_qty: 4 }] }, { id: receiptId }, "dock-conference");
  await run("POST", "/recebimentos/{id}/avancar", { expected_status: "checking" }, { id: receiptId }, "dock-complete");
  const [guarda] = (await db.collection("putaway_tasks").where("receipt_id", "==", receiptId).get()).docs;
  assert.ok(guarda, "a chegada na doca abre a guarda");
  await advanceWarehouseTaskTransaction(db, { task_uid: `putaway:${guarda.id}`, expected_status: "planned", operation: { destination_location_id: "A1" }, idempotency_key: "dock-putaway" }, { uid: "wms-1", role: "wms", name: "Armazém" });
  assert.deepEqual(await saldos("SKU-R"), { A1: [4, 0, "available"], RECEBIMENTO: [0, 0, "empty"] });

  const pedido = await run("POST", "/pedidos", { customer_code: "A", type: "retirada", title: "Retirada pela API", items: [{ sku_code: "SKU-R", quantity: 3 }] }, {}, "dock-request");
  const requestId = String(pedido.id);
  assert.deepEqual(await reservas(requestId), [["A1", 3]]);
  // A aprovação pela API confere o saldo do mesmo jeito.
  await run("PATCH", "/pedidos/{id}", { action: "approve", expected_status: "open" }, { id: requestId }, "dock-approve");
  assert.equal((await run("GET", "/pedidos/{id}", undefined, { id: requestId })).data.status, "approved");
});

test("retirada pela API confere só o saldo livre: a área sem posição passa como no portal, a prateleira de outra zona recusa", async () => {
  await produto("SKU-E", "ITEM-E");
  // A prateleira do cliente; zerado, um saldo na prateleira da zona de outro
  // cliente (o código em minúsculas é a mesma prateleira, como na guarda); uma
  // devolução disponível; uma doca digitada no Receber; e a sobra de um pedido
  // cancelado depois da separação.
  const locais = [["A1", 2], ["b1", 0], ["DEVOLUCAO", 1], ["DOCA 2", 1], ["EXPEDICAO", 2]] as const;
  await Promise.all(locais.map(([local, qty]) => db.collection("stock_balances").doc(`bal-e-${local}`).set({ customer_code: "A", sku_code: "SKU-E", client_item_code: "ITEM-E", product_name: "Produto SKU-E", location_id: local, qty_on_hand: qty, qty_reserved: 0, qty_available: qty, status: qty ? "available" : "empty" })));
  // O alocador usa o saldo livre de qualquer local, na ordem do código.
  const pedido = await run("POST", "/pedidos", { customer_code: "A", type: "retirada", title: "Retirada com áreas", items: [{ sku_code: "SKU-E", quantity: 6 }] }, {}, "area-request");
  assert.deepEqual(await reservas(String(pedido.id)), [["A1", 2], ["DEVOLUCAO", 1], ["DOCA 2", 1], ["EXPEDICAO", 2]]);
  // Com saldo livre, a prateleira da outra zona entra na conferência e recusa, sem reservar nada.
  await db.collection("stock_balances").doc("bal-e-b1").update({ qty_on_hand: 1, qty_available: 1, status: "available" });
  await assert.rejects(run("POST", "/pedidos", { customer_code: "A", type: "retirada", title: "Retirada da outra zona", items: [{ sku_code: "SKU-E", quantity: 1 }] }, {}, "area-request-b1"), { code: "permission-denied" });
  assert.equal((await db.collection("stock_reservations").where("sku_code", "==", "SKU-E").get()).size, 4);
});

test("retirada pela API de SKU com saldo sem local tem a recusa do alocador, como no portal", async () => {
  await produto("SKU-S", "ITEM-S");
  await Promise.all([
    db.collection("stock_balances").doc("bal-s-A1").set({ customer_code: "A", sku_code: "SKU-S", location_id: "A1", qty_on_hand: 2, qty_reserved: 0, qty_available: 2, status: "available" }),
    db.collection("stock_balances").doc("bal-s-sem-local").set({ customer_code: "A", sku_code: "SKU-S", qty_on_hand: 1, qty_reserved: 0, qty_available: 1, status: "available" }),
  ]);
  await assert.rejects(run("POST", "/pedidos", { customer_code: "A", type: "retirada", title: "Retirada sem local", items: [{ sku_code: "SKU-S", quantity: 1 }] }, {}, "no-location-request"), { code: "failed-precondition", message: /sem localização física/ });
});
