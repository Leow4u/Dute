import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore, type Firestore } from "firebase-admin/firestore";

import {
  documents,
  invoices,
  listOrders,
  movementSummary,
  orderDetails,
  recentHistory,
  searchItems,
  stockSummary,
  type AgentScope,
} from "./agent-dute.js";

const PROJECT_ID = "demo-dute-operations";
const BTG = "BTG Pactual";
const cliente: AgentScope = { customerCode: BTG, audience: "customer" };
let db: Firestore;
let app: ReturnType<typeof initializeApp>;

const at = (iso: string) => Timestamp.fromDate(new Date(iso));

async function seed() {
  const inventory = db.collection("client_inventory");
  await inventory.doc("polo-p").set({
    customer_code: BTG, sku_code: "S1", client_item_code: "A.01.0594.005.P", product_name: "POLO PIQUET MESCLA",
    size: "P", qty_on_hand: 96, qty_reserved: 10, qty_available: 86, estoque_minimo: 40,
  });
  await inventory.doc("polo-gg").set({
    customer_code: BTG, sku_code: "S2", client_item_code: "A.01.0594.005.GG", product_name: "POLO PIQUET MESCLA",
    size: "GG", qty_on_hand: 18, qty_reserved: 0, qty_available: 18, estoque_minimo: 40,
  });
  await inventory.doc("caneca").set({
    customer_code: BTG, sku_code: "S3", client_item_code: "C.0659.001.U", product_name: "Caneca térmica 500 ml",
    qty_on_hand: 0, qty_reserved: 0, qty_available: 0, client_archived: true,
  });
  await inventory.doc("outro").set({
    customer_code: "Outro", sku_code: "X1", product_name: "POLO PIQUET OUTRO CLIENTE", qty_on_hand: 999,
  });

  const status = db.collection("client_request_status");
  await status.doc("req-faria").set({
    customer_code: BTG, type: "retirada", title: "Abastecimento loja Faria Lima", status: "approved",
    operational_status: "separating", item_count: 2, quantity_total: 140,
    created_at: at("2026-09-30T12:00:00Z"), updated_at: at("2026-10-01T10:00:00Z"),
  });
  await status.doc("req-evento").set({
    customer_code: BTG, type: "retirada", title: "Reposição evento SP", status: "closed",
    operational_status: "delivered", created_at: at("2026-09-20T12:00:00Z"), updated_at: at("2026-09-26T18:00:00Z"),
  });
  await status.doc("req-recusado").set({
    customer_code: BTG, type: "retirada", title: "Pedido grande", status: "rejected",
    decision_reason: "saldo insuficiente", created_at: at("2026-09-24T12:00:00Z"), updated_at: at("2026-09-24T15:00:00Z"),
  });
  await status.doc("req-outro").set({
    customer_code: "Outro", type: "retirada", title: "Faria Lima do outro", status: "open",
    created_at: at("2026-10-01T11:00:00Z"), updated_at: at("2026-10-01T11:00:00Z"),
  });
  await db.collection("customer_requests").doc("req-faria").set({
    customer_code: BTG,
    items: [
      { client_item_code: "A.01.0594.005.P", product_name: "POLO PIQUET MESCLA", quantity: 100 },
      { sku_code: "S3", product_name: "Caneca térmica 500 ml", quantity: 40 },
    ],
  });
  await db.collection("customer_requests").doc("req-outro").set({
    customer_code: "Outro", items: [{ product_name: "segredo", quantity: 1 }],
  });

  const movements = db.collection("movements");
  const movement = (id: string, data: string, tipo: "ENTRADA" | "SAIDA", qty: number, code: string, customer = BTG) =>
    movements.doc(id).set({
      data, tipo_mov: tipo, sign: tipo === "ENTRADA" ? 1 : -1, quantity: qty, customer_code: customer,
      client_item_code: code, product_name: "POLO PIQUET MESCLA", actor: { name: "Operador interno" }, location_id: "R1-A",
    });
  await movement("m1", "2026-09-02T13:00:00.000Z", "SAIDA", 41, "A.01.0594.005.P");
  await movement("m2", "2026-09-15T13:00:00.000Z", "SAIDA", 30, "A.01.0594.005.GG");
  await movement("m3", "2026-09-10T13:00:00.000Z", "ENTRADA", 200, "A.01.0594.005.P");
  // 01/10 00:30 em São Paulo = fora de setembro.
  await movement("m4", "2026-10-01T03:30:00.000Z", "SAIDA", 7, "A.01.0594.005.P");
  await movement("m5", "2026-09-05T13:00:00.000Z", "SAIDA", 500, "X1", "Outro");

  await db.collection("client_invoices").doc("BTG_2026-08").set({ customer_code: BTG, competencia: "2026-08", total: 18420, status: "emitida" });
  await db.collection("client_invoices").doc("BTG_2026-07").set({ customer_code: BTG, competencia: "2026-07", total: 17000, status: "pago" });
  await db.collection("client_invoices").doc("OUT_2026-08").set({ customer_code: "Outro", competencia: "2026-08", total: 1 });

  await db.collection("client_documents").doc("doc-contrato").set({
    customer_code: BTG, title: "Contrato BTG x Dutelog", customer_visible: true, visibility: "customer", status: "published",
  });
  await db.collection("client_documents").doc("doc-oculto").set({
    customer_code: BTG, title: "Contrato rascunho interno", customer_visible: false, visibility: "internal", status: "archived", archived: true,
  });
}

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "agent-dute-test");
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

describe("estoque", () => {
  it("resumo só do próprio cliente, sem arquivados, com itens abaixo do mínimo", async () => {
    const summary = await stockSummary(db, cliente);
    assert.equal(summary.itens, 2);
    assert.equal(summary.pecas_em_estoque, 114);
    assert.equal(summary.pecas_reservadas, 10);
    assert.equal(summary.pecas_disponiveis, 104);
    assert.deepEqual(summary.itens_abaixo_do_minimo.map((item) => item.codigo), ["A.01.0594.005.GG"]);
  });

  it("busca sem acento e sem misturar clientes", async () => {
    const polo = await searchItems(db, cliente, "polo piquet");
    assert.deepEqual(polo.itens.map((item) => item.codigo).sort(), ["A.01.0594.005.GG", "A.01.0594.005.P"]);
    const caneca = await searchItems(db, cliente, "caneca termica");
    assert.equal(caneca.itens[0]?.arquivado, true);
    assert.equal((await searchItems(db, cliente, "outro cliente")).encontrados, 0);
  });

  it("busca traz o total de todos os itens encontrados e o resumo por produto", async () => {
    const polo = await searchItems(db, cliente, "polo", 1);
    assert.equal(polo.itens.length, 1);
    assert.deepEqual(polo.total, { pecas_em_estoque: 114, pecas_reservadas: 10, pecas_disponiveis: 104 });
    assert.deepEqual(polo.por_produto, [
      { nome: "POLO PIQUET MESCLA", itens: 2, em_estoque: 114, disponivel: 104, abaixo_do_minimo: 1 },
    ]);
  });
});

describe("pedidos", () => {
  it("lista do mais recente para o mais antigo com a etapa do portal", async () => {
    const result = await listOrders(db, cliente);
    assert.deepEqual(
      result.pedidos.map((order) => [order.id, order.etapa]),
      [["req-faria", "Separando"], ["req-evento", "Entregue"], ["req-recusado", "Recusado"]],
    );
    assert.equal(result.pedidos[2].motivo_recusa, "saldo insuficiente");
    const active = await listOrders(db, cliente, { situacao: "andamento" });
    assert.deepEqual(active.pedidos.map((order) => order.id), ["req-faria"]);
  });

  it("detalhe por palavras do título traz os itens; id de outro cliente não é encontrado", async () => {
    const detail = await orderDetails(db, cliente, "faria lima");
    assert.equal(detail.encontrado, true);
    assert.equal(detail.pedido?.id, "req-faria");
    assert.deepEqual(detail.itens?.map((item) => item.quantidade), [100, 40]);
    assert.deepEqual(await orderDetails(db, cliente, "req-outro"), { encontrado: false });
  });
});

describe("movimentações", () => {
  it("soma por item no período de São Paulo, só do próprio cliente e sem dados internos", async () => {
    const result = await movementSummary(db, cliente, { de: "2026-09-01", ate: "2026-09-30" });
    assert.equal(result.pecas_que_sairam, 71);
    assert.equal(result.pecas_que_entraram, 200);
    assert.deepEqual(result.por_item?.[0], { codigo: "A.01.0594.005.P", nome: "POLO PIQUET MESCLA", entradas: 200, saidas: 41 });
    assert.ok(!JSON.stringify(result).includes("Operador interno"));
    assert.ok(!JSON.stringify(result).includes("R1-A"));
  });

  it("recusa período inválido", async () => {
    assert.ok("erro" in (await movementSummary(db, cliente, { de: "2026-09-30", ate: "2026-09-01" })));
    assert.ok("erro" in (await movementSummary(db, cliente, { de: "2026-01-01", ate: "2026-09-30" })));
  });
});

describe("faturas e documentos", () => {
  it("faturas do cliente, da mais recente para a mais antiga", async () => {
    const result = await invoices(db, cliente);
    assert.deepEqual(result.faturas.map((invoice) => [invoice.competencia, invoice.situacao]), [
      ["2026-08", "emitida"],
      ["2026-07", "paga"],
    ]);
  });

  it("cliente não vê documento oculto; equipe interna vê", async () => {
    const customer = await documents(db, cliente, "contrato");
    assert.deepEqual(customer.documentos.map((document) => document.titulo), ["Contrato BTG x Dutelog"]);
    const internal = await documents(db, { customerCode: BTG, audience: "internal" }, "contrato");
    assert.equal(internal.documentos.length, 2);
  });
});

describe("memória da conversa", () => {
  it("mensagens antigas com o mesmo horário: a pergunta vem antes da resposta", async () => {
    // Antes do v2 a pergunta e a resposta eram gravadas com o mesmo horário.
    const batch = db.batch();
    for (const [id, role, content, iso] of [
      ["msg_user_1", "user", "pergunta antiga", "2026-10-01T01:42:00.000Z"],
      ["msg_agent_1", "assistant", "resposta antiga", "2026-10-01T01:42:00.000Z"],
      ["msg_user_2", "user", "outra pergunta", "2026-10-01T01:50:00.000Z"],
      ["msg_agent_2", "assistant", "outra resposta", "2026-10-01T01:50:00.000Z"],
    ]) {
      batch.set(db.collection("agent_messages").doc(id), {
        conversation_id: "c2", customer_code: BTG, user_id: "u1", role, content, created_at_iso: iso,
      });
    }
    await batch.commit();
    const history = await recentHistory(db, { conversationId: "c2", customerCode: BTG, userId: "u1" });
    assert.deepEqual(history.map((message) => message.content), [
      "pergunta antiga", "resposta antiga", "outra pergunta", "outra resposta",
    ]);
  });

  it("devolve as últimas mensagens em ordem, mesmo com mais de 30", async () => {
    const batch = db.batch();
    for (let index = 0; index < 40; index += 1) {
      const minute = String(index).padStart(2, "0");
      const role = index % 2 === 0 ? "user" : "assistant";
      // Ids reais têm prefixo por papel: sem orderBy, msg_agent_* viria antes.
      const id = `msg_${role === "user" ? "user" : "agent"}_${minute}`;
      batch.set(db.collection("agent_messages").doc(id), {
        conversation_id: "c1", customer_code: BTG, user_id: "u1", role,
        content: `m${minute}`, created_at_iso: `2026-10-01T10:${minute}:00.000Z`,
      });
    }
    await batch.commit();
    const history = await recentHistory(db, { conversationId: "c1", customerCode: BTG, userId: "u1" });
    assert.equal(history.length, 20);
    assert.equal(history[0].content, "m20");
    assert.equal(history[19].content, "m39");
    assert.equal(history[0].role, "user");
  });
});
