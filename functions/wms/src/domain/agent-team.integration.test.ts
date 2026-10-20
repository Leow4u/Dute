import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore, type Firestore } from "firebase-admin/firestore";

import type { AgentScope } from "./agent-dute.js";
import { itemLocations, pendingRequests, receipts, recentEvents, warehouseTasks } from "./agent-team.js";

const PROJECT_ID = "demo-dute-operations";
const BTG = "BTG Pactual";
const equipe: AgentScope = { customerCode: BTG, audience: "internal" };
const NOW = new Date("2026-10-02T12:00:00Z");
let db: Firestore;
let app: ReturnType<typeof initializeApp>;

const at = (iso: string) => Timestamp.fromDate(new Date(iso));

async function seed() {
  const requests = db.collection("customer_requests");
  await requests.doc("creq_a").set({
    customer_code: BTG, request_number: "PED-0044", type: "retirada", title: "Loja Faria Lima", status: "open",
    requested_by: { name: "Cristiane Souza" }, item_count: 2, quantity_total: 40, created_at: at("2026-09-29T12:00:00Z"),
  });
  await requests.doc("creq_b").set({
    customer_code: BTG, request_number: "ENV-0013", type: "recebimento", supplier: "Gráfica Alfa", status: "open",
    created_at: at("2026-10-02T09:00:00Z"),
  });
  await requests.doc("creq_c").set({
    customer_code: BTG, request_number: "PED-0043", type: "retirada", status: "approved", created_at: at("2026-09-28T12:00:00Z"),
  });
  await requests.doc("creq_outro").set({
    customer_code: "Outro", request_number: "PED-9999", type: "retirada", status: "open", created_at: at("2026-09-01T12:00:00Z"),
  });

  const inbound = db.collection("inbound_receipts");
  await inbound.doc("inb_1").set({
    customer_code: BTG, receipt_number: "ENV-0012", status: "checking", supplier: "Uniformes Elegância", invoice_number: "2471",
    qty_expected: 120, qty_received: 80, created_at: at("2026-10-01T12:00:00Z"),
  });
  await inbound.doc("inb_2").set({
    customer_code: BTG, receipt_number: "ENV-0010", status: "received", supplier: "Gráfica Alfa",
    qty_expected: 50, qty_received: 50, created_at: at("2026-09-20T12:00:00Z"),
  });
  await inbound.doc("inb_outro").set({
    customer_code: "Outro", receipt_number: "ENV-9999", status: "created", created_at: at("2026-10-01T12:00:00Z"),
  });

  await db.collection("pick_tasks").doc("pick_1").set({
    customer_code: BTG, order_number: "PED-0043", status: "planned", total_units: 40, picked_units: 0,
    created_at: at("2026-09-30T12:00:00Z"), updated_at: at("2026-09-30T12:00:00Z"),
  });
  await db.collection("pick_tasks").doc("pick_done").set({
    customer_code: BTG, order_number: "PED-0040", status: "completed", created_at: at("2026-09-20T12:00:00Z"), updated_at: at("2026-09-21T12:00:00Z"),
  });
  await db.collection("putaway_tasks").doc("put_1").set({
    customer_code: BTG, receipt_number: "ENV-0012", product_name: "Camisa social", destination_location_id: "R01-P02",
    status: "planned", quantity: 80, created_at: at("2026-10-01T12:00:00Z"), updated_at: at("2026-10-01T12:00:00Z"),
  });

  const balances = db.collection("stock_balances");
  await balances.doc("b1").set({
    customer_code: BTG, sku_code: "S1", client_item_code: "CAM-01", product_name: "Camisa social", location_id: "R01-P02",
    qty_on_hand: 30, qty_reserved: 10, qty_available: 20, unit_cost: 55,
  });
  await balances.doc("b2").set({
    customer_code: BTG, sku_code: "S1", client_item_code: "CAM-01", product_name: "Camisa social", location_id: "R03-P01",
    qty_on_hand: 12, qty_reserved: 0,
  });
  await balances.doc("b-vazio").set({
    customer_code: BTG, sku_code: "S1", client_item_code: "CAM-01", location_id: "R09-P09", qty_on_hand: 0, qty_reserved: 0,
  });
  await balances.doc("b-outro").set({
    customer_code: "Outro", sku_code: "X1", client_item_code: "CAM-01", location_id: "Z99", qty_on_hand: 999,
  });

  const events = db.collection("events");
  await events.doc("evt_1").set({
    customer_code: BTG, type: "request.approved", title: "Solicitação aprovada", description: "PED-0043 aprovado",
    entity_id: "creq_c", actor: { name: "Leonardo", role: "owner" }, occurred_at: "2026-09-28T15:00:00.000Z",
  });
  await events.doc("evt_2").set({
    customer_code: BTG, type: "inbound.checked", title: "Conferência iniciada", description: "ENV-0012",
    actor: { name: "Rafael", role: "wms" }, occurred_at: "2026-10-01T15:00:00.000Z",
  });
  await events.doc("evt_outro").set({
    customer_code: "Outro", type: "request.approved", title: "Solicitação aprovada", description: "PED-0043 de outro cliente",
    actor: { name: "Alguém" }, occurred_at: "2026-10-01T16:00:00.000Z",
  });
}

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "agent-team-test");
  db = getFirestore(app);
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  await seed();
});

after(async () => {
  await deleteApp(app);
});

describe("consultas da equipe", () => {
  it("fila: só as abertas do cliente, a mais antiga primeiro", async () => {
    const queue = await pendingRequests(db, equipe, NOW);
    assert.equal(queue.aguardando_aprovacao, 2);
    assert.deepEqual(queue.solicitacoes.map((item) => item.numero), ["PED-0044", "ENV-0013"]);
    assert.equal(queue.solicitacoes[0]?.dias_esperando, 3);
    assert.equal(queue.solicitacoes[0]?.pedido_por, "Cristiane Souza");
  });

  it("recebimentos: abertos por padrão, todos quando pedido, sem outro cliente", async () => {
    const open = await receipts(db, equipe);
    assert.deepEqual(open.recebimentos.map((item) => [item.numero, item.situacao, item.pecas_recebidas]), [["ENV-0012", "em conferência", 80]]);
    const all = await receipts(db, equipe, { situacao: "todos" });
    assert.deepEqual(all.recebimentos.map((item) => item.numero), ["ENV-0012", "ENV-0010"]);
    assert.equal((await receipts(db, equipe, { situacao: "todos", texto: "grafica" })).encontrados, 1);
  });

  it("tarefas: separação e guarda abertas, sem as concluídas", async () => {
    const tasks = await warehouseTasks(db, equipe, NOW);
    assert.equal(tasks.separacao_abertas, 1);
    assert.equal(tasks.guarda_abertas, 1);
    assert.deepEqual(tasks.tarefas.map((task) => [task.tipo, task.pedido ?? task.recebimento, task.aberta_ha_dias]), [
      ["separação", "PED-0043", 2],
      ["guarda", "ENV-0012", 1],
    ]);
  });

  it("endereços: saldo por endereço do cliente, sem vazios e sem custo", async () => {
    const found = await itemLocations(db, equipe, "cam-01");
    assert.deepEqual(found.enderecos.map((item) => [item.endereco, item.em_estoque, item.disponivel]), [
      ["R01-P02", 30, 20],
      ["R03-P01", 12, 12],
    ]);
    assert.equal(JSON.stringify(found).includes("55"), false);
  });

  it("eventos: quem fez o quê, filtrando por referência, sem outro cliente", async () => {
    const found = await recentEvents(db, equipe, { referencia: "PED-0043" });
    assert.deepEqual(found.eventos.map((event) => [event.o_que, event.quem]), [["Solicitação aprovada", "Leonardo"]]);
    const latest = await recentEvents(db, equipe);
    assert.deepEqual(latest.eventos.map((event) => event.o_que), ["Conferência iniciada", "Solicitação aprovada"]);
  });
});
