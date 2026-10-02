import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import type { AgentScope } from "./agent-dute.js";
import { buildOrderDraft, buildShipmentDraft, draftFromToolResponses, sendOrderDraft } from "./agent-drafts.js";

const PROJECT_ID = "demo-dute-operations";
const BTG = "BTG Pactual";
const cliente: AgentScope = { customerCode: BTG, audience: "customer" };
let db: Firestore;
let app: ReturnType<typeof initializeApp>;

async function seed() {
  const inventory = db.collection("client_inventory");
  await inventory.doc("polo-p").set({
    customer_code: BTG, sku_code: "S1", client_item_code: "A.01.0594.005.P", product_name: "POLO PIQUET MESCLA", size: "P",
    qty_on_hand: 30, qty_reserved: 0, qty_available: 30,
  });
  await inventory.doc("polo-gg").set({
    customer_code: BTG, sku_code: "S2", client_item_code: "A.01.0594.005.GG", product_name: "POLO PIQUET MESCLA", size: "GG",
    qty_on_hand: 8, qty_reserved: 0, qty_available: 8,
  });
  await inventory.doc("caneca").set({
    customer_code: BTG, sku_code: "S3", client_item_code: "C.0659", product_name: "Caneca térmica", qty_on_hand: 0, qty_available: 0,
  });
  await inventory.doc("arquivado").set({
    customer_code: BTG, sku_code: "S4", client_item_code: "Z.1", product_name: "Item arquivado", qty_available: 50, client_archived: true,
  });
  await inventory.doc("outro").set({
    customer_code: "Outro", sku_code: "X1", client_item_code: "B.99", product_name: "Bolsa de outro cliente", qty_available: 99,
  });
}

before(() => {
  app = initializeApp({ projectId: PROJECT_ID }, "agent-drafts-test");
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

describe("rascunho de pedido", () => {
  it("acha por código ou por nome com tamanho, limita ao disponível e aponta pendências", async () => {
    const draft = await buildOrderDraft(db, cliente, {
      itens: [
        { item: "a.01.0594.005.p", quantidade: 20 },
        { item: "polo gg", quantidade: 10 },
        { item: "polo", quantidade: 5 },
        { item: "caneca", quantidade: 2 },
        { item: "bolsa", quantidade: 1 },
        { item: "item arquivado", quantidade: 1 },
      ],
      destino: "Loja Faria Lima",
      prazo: "2026-10-04",
    });
    assert.deepEqual(draft.linhas.map((line) => [line.sku_code, line.quantidade, line.disponivel]), [
      ["S1", 20, 30],
      ["S2", 8, 8],
    ]);
    assert.deepEqual(draft.pendencias.map((item) => [item.item, item.motivo.split(";")[0]]), [
      ["polo gg", "só 8 disponíveis"],
      ["polo", "mais de um item combina"],
      ["caneca", "sem saldo disponível"],
      ["bolsa", "não encontrei no estoque"],
      ["item arquivado", "não encontrei no estoque"],
    ]);
    assert.equal(draft.pendencias[1]?.opcoes?.length, 2);
    assert.equal(draft.destino, "Loja Faria Lima");
    assert.equal(draft.prazo, "2026-10-04");
    assert.equal(draft.falta_destino, false);
  });

  it("prazo fora do formato fica de fora; sem destino avisa", async () => {
    const draft = await buildOrderDraft(db, cliente, { itens: [{ item: "C.0659", quantidade: 1 }], prazo: "sexta" });
    assert.equal(draft.prazo, undefined);
    assert.equal(draft.falta_destino, true);
  });

  it("hora só com data válida e no formato HH:MM", async () => {
    const item = [{ item: "C.0659", quantidade: 1 }];
    assert.equal((await buildOrderDraft(db, cliente, { itens: item, prazo: "2026-10-06", hora: "11:00" })).hora, "11:00");
    assert.equal((await buildOrderDraft(db, cliente, { itens: item, prazo: "2026-10-06", hora: "manhã" })).hora, undefined);
    assert.equal((await buildOrderDraft(db, cliente, { itens: item, hora: "11:00" })).hora, undefined);
  });
});

describe("enviar o pedido do cartão", () => {
  const messageId = "msg_a1";
  const owner = { messageId, uid: "u-btg", customerCode: BTG };

  async function seedMessage(extra: Record<string, unknown> = {}) {
    await db.collection("agent_messages").doc(messageId).set({
      id: messageId, conversation_id: "conv_1", customer_code: BTG, user_id: "u-btg", role: "assistant",
      content: "Montei o pedido.", draft: { tipo: "pedido", linhas: [{ sku_code: "S1", quantidade: 5 }] }, ...extra,
    });
  }

  it("cria com a chave da mensagem e marca a mensagem como enviada", async () => {
    await seedMessage();
    const keys: string[] = [];
    const result = await sendOrderDraft(db, owner, async (key) => {
      keys.push(key);
      return { id: "creq_1", request_number: "PED-0045" };
    });
    assert.deepEqual(keys, ["agent_draft_msg_a1"]);
    assert.equal(result.request_number, "PED-0045");
    const sent = (await db.collection("agent_messages").doc(messageId).get()).data()?.draft_sent;
    assert.equal(sent.request_id, "creq_1");
    assert.equal(sent.request_number, "PED-0045");
    assert.ok(sent.sent_at);
  });

  it("não envia de novo a mesma mensagem", async () => {
    await seedMessage({ draft_sent: { request_id: "creq_1", request_number: "PED-0045", sent_at: "2026-10-02T15:00:00Z" } });
    let called = false;
    await assert.rejects(
      sendOrderDraft(db, owner, async () => {
        called = true;
        return { id: "x" };
      }),
      /já foi enviado \(PED-0045\)/,
    );
    assert.equal(called, false);
  });

  it("recusa mensagem de outra pessoa, de outro cliente ou sem pedido", async () => {
    const create = async () => ({ id: "x" });
    await seedMessage();
    await assert.rejects(sendOrderDraft(db, { ...owner, uid: "outra" }, create), /não é desta conversa/);
    await assert.rejects(sendOrderDraft(db, { ...owner, customerCode: "Outro" }, create), /não é desta conversa/);
    await assert.rejects(sendOrderDraft(db, { ...owner, messageId: "nao-existe" }, create), /não é desta conversa/);
    await seedMessage({ draft: { tipo: "envio", linhas: [] } });
    await assert.rejects(sendOrderDraft(db, owner, create), /não tem um pedido/);
  });

  it("falha na criação não marca a mensagem", async () => {
    await seedMessage();
    await assert.rejects(
      sendOrderDraft(db, owner, async () => {
        throw new Error("Saldo insuficiente para o SKU S1.");
      }),
      /Saldo insuficiente/,
    );
    assert.equal((await db.collection("agent_messages").doc(messageId).get()).data()?.draft_sent, undefined);
  });
});

describe("rascunho de aviso de envio", () => {
  it("marca o que já está no estoque, o que é novo e o que fica com código a definir", async () => {
    const draft = await buildShipmentDraft(db, cliente, {
      fornecedor: "Uniformes Elegância",
      nota_fiscal: "2471",
      chegada: "2026-10-06",
      itens: [
        { codigo: "a.01.0594.005.p", quantidade: 120 },
        { codigo: "NOVO-1", nome: "Camiseta nova", quantidade: 50 },
        { nome: "Boné", quantidade: 30 },
        { quantidade: 5 },
      ],
    });
    assert.deepEqual(draft.linhas, [
      { codigo: "A.01.0594.005.P", nome: "POLO PIQUET MESCLA", quantidade: 120, situacao: "no_estoque" },
      { codigo: "NOVO-1", nome: "Camiseta nova", quantidade: 50, situacao: "novo" },
      { codigo: undefined, nome: "Boné", quantidade: 30, situacao: "codigo_a_definir" },
    ]);
    assert.equal(draft.chegada, "2026-10-06");
  });
});

describe("rascunho na resposta", () => {
  it("pega o último rascunho, sem a instrução ao modelo e sem undefined", () => {
    const draft = draftFromToolResponses([
      { content: [{ toolResponse: { name: "buscar_itens", output: { x: 1 } } }] },
      { content: [{ toolResponse: { name: "rascunho_pedido", output: { tipo: "pedido", linhas: [], instrucao: "x", nome: undefined } } }] },
    ]);
    assert.deepEqual(draft, { tipo: "pedido", linhas: [] });
    assert.equal(draftFromToolResponses([{ content: [{ text: "oi" }] }]), undefined);
  });
});
