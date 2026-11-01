import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

import {
  advanceWarehouseTaskTransaction,
  createCustomerRequestTransaction,
  createInboundReceiptTransaction,
  decideCustomerRequestTransaction,
  updateInboundReceiptConferenceTransaction,
  type CreateInboundReceiptOptions,
  type OperationalActor,
} from "./operations.js";

/**
 * O modo da chegada no banco (docs/plataforma/recebimento-com-caixas.md,
 * parte 2): por linha sem o campo; por caixa só com a liberação e o modelo
 * que confere por caixa; a chegada por caixa fora da conferência e da entrada
 * por linha. A liberação chega como opção da porta, porque nos testes o
 * projeto é sempre o demo (a callable passa boxReceivingEnabled(PROJECT_ID)).
 */

const PROJECT_ID = "demo-dute-operations";
const UNIFORMES = "Uniformes Alfa";
const MOVEIS = "Moveis Beta";
const SEM_MODELO = "Cadastro Antigo";
const operacao: OperationalActor = { uid: "op-1", role: "wms", name: "Operação" };
const coordenacao: OperationalActor = { uid: "coord-1", role: "admin", name: "Coordenação" };
const LIBERADO: CreateInboundReceiptOptions = { boxReceivingEnabled: true };
const DESLIGADO: CreateInboundReceiptOptions = { boxReceivingEnabled: false };
const CLIENTES = [
  { code: UNIFORMES, id: "uniformes_alfa", prefix: "UNI", template: "uniformes" },
  { code: MOVEIS, id: "moveis_beta", prefix: "MOV", template: "mobiliario" },
  // Cadastro anterior ao campo: vale o modelo padrão (uniformes).
  { code: SEM_MODELO, id: "cadastro_antigo", prefix: "ANT", template: undefined },
];
let db: Firestore;
let app: ReturnType<typeof initializeApp>;

function prefixOf(customer: string) {
  return CLIENTES.find((cliente) => cliente.code === customer)!.prefix;
}
const skuOf = (customer: string) => `${prefixOf(customer)}-000001`;
const itemOf = (customer: string) => `${prefixOf(customer)}-ITEM-1`;

async function seed() {
  await Promise.all(
    CLIENTES.flatMap((cliente) => [
      db.collection("customers").doc(cliente.id).set({
        code: cliente.code,
        customer_code: cliente.code,
        name: cliente.code,
        sku_prefix: cliente.prefix,
        status: "active",
        ...(cliente.template ? { operation_template: cliente.template } : {}),
      }),
      db.collection("products").doc(itemOf(cliente.code)).set({
        id: itemOf(cliente.code),
        customer_code: cliente.code,
        cod_cliente: itemOf(cliente.code),
        produto: "Camisa polo",
        status: "active",
      }),
      db.collection("skus").doc(skuOf(cliente.code)).set({
        id: skuOf(cliente.code),
        customer_code: cliente.code,
        cod_cliente: itemOf(cliente.code),
        cod_btg: skuOf(cliente.code),
        sku_code: skuOf(cliente.code),
        produto: "Camisa polo",
        status: "active",
      }),
    ]),
  );
}

/** Chegada avulsa com uma linha de produto existente, pela porta da tela. */
function arrival(customer: string, key: string, mode?: string, options?: CreateInboundReceiptOptions) {
  return createInboundReceiptTransaction(
    db,
    {
      customer_code: customer,
      supplier: "Confecções Alfa",
      invoice_number: `NF-${key}`,
      idempotency_key: key,
      ...(mode === undefined ? {} : { conference_mode: mode }),
      items: [
        {
          line_number: 1,
          sku_code: skuOf(customer),
          client_item_code: itemOf(customer),
          product_name: "Camisa polo",
          product_registration: "existing",
          location_id: "RECEBIMENTO",
          quantity: 10,
        },
      ],
    },
    operacao,
    options,
  ) as Promise<Record<string, unknown>>;
}

async function receiptOf(receiptId: string) {
  return (await db.collection("inbound_receipts").doc(receiptId).get()).data() ?? {};
}

async function createdEvent(receiptId: string) {
  const snapshot = await db.collection("events").where("entity_id", "==", receiptId).get();
  const events = snapshot.docs.map((doc) => doc.data()).filter((event) => event.type === "inbound.created");
  assert.equal(events.length, 1, `inbound.created de ${receiptId}`);
  return events[0]!;
}

function advance(receiptId: string, expected: string) {
  return advanceWarehouseTaskTransaction(
    db,
    { task_uid: `receiving:${receiptId}`, expected_status: expected, idempotency_key: `${receiptId}:${expected}` },
    operacao,
  );
}

async function conference(receiptId: string) {
  const rows = await db.collection("inbound_items").where("receipt_id", "==", receiptId).get();
  return updateInboundReceiptConferenceTransaction(
    db,
    {
      receipt_id: receiptId,
      expected_status: "checking",
      idempotency_key: `conferencia-${receiptId}`,
      lines: rows.docs.map((doc) => ({
        inbound_item_id: doc.id,
        received_qty: Number(doc.get("expected_qty")),
        location_id: "RECEBIMENTO",
      })),
    },
    operacao,
  );
}

async function sizeOf(collection: string) {
  return (await db.collection(collection).get()).size;
}

before(() => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "Execute este teste pelo Firebase Emulator.");
  app = initializeApp({ projectId: PROJECT_ID }, `inbound-mode-${Date.now()}`);
  db = getFirestore(app);
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  const response = await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, {
    method: "DELETE",
  });
  assert.equal(response.ok, true, await response.text());
  await seed();
});

after(async () => {
  await deleteApp(app);
});

describe("o modo da chegada (recebimento com caixas, parte 2)", () => {
  it("a chegada avulsa sem modo nasce por linha: no documento, no evento e no resultado", async () => {
    const created = await arrival(UNIFORMES, "linha-1");
    const receiptId = String(created.receipt_id);
    assert.equal(created.conference_mode, "per_line");
    assert.equal((await receiptOf(receiptId)).conference_mode, "per_line");
    assert.equal((await createdEvent(receiptId)).payload.conference_mode, "per_line");
  });

  it("com a liberação, o cliente de uniformes recebe por caixa; o cadastro sem modelo vale uniformes", async () => {
    for (const [customer, key] of [
      [UNIFORMES, "caixa-1"],
      [SEM_MODELO, "caixa-2"],
    ] as const) {
      const created = await arrival(customer, key, "per_box", LIBERADO);
      const receiptId = String(created.receipt_id);
      assert.equal(created.conference_mode, "per_box", customer);
      assert.equal((await receiptOf(receiptId)).conference_mode, "per_box", customer);
      assert.equal((await createdEvent(receiptId)).payload.conference_mode, "per_box", customer);
    }
  });

  it("sem a liberação, a chegada por caixa é recusada e nada é gravado; por linha segue", async () => {
    for (const options of [DESLIGADO, undefined]) {
      await assert.rejects(arrival(UNIFORMES, "caixa-3", "per_box", options), {
        code: "failed-precondition",
        message: "A conferência por caixa ainda não está liberada neste ambiente.",
      });
    }
    for (const collection of ["inbound_receipts", "inbound_items", "operational_operations", "events"]) {
      assert.equal(await sizeOf(collection), 0, collection);
    }
    assert.equal((await arrival(UNIFORMES, "linha-2", "per_line", DESLIGADO)).conference_mode, "per_line");
  });

  it("o cliente de outro modelo recebe por linha, mesmo com a liberação", async () => {
    await assert.rejects(arrival(MOVEIS, "caixa-4", "per_box", LIBERADO), {
      code: "failed-precondition",
      message: `${MOVEIS} usa o modelo de operação mobiliario, que confere a chegada por linha.`,
    });
    assert.equal(await sizeOf("inbound_receipts"), 0);
    assert.equal((await arrival(MOVEIS, "linha-3", undefined, LIBERADO)).conference_mode, "per_line");
  });

  it("modo fora da lista é recusado antes de gravar", async () => {
    await assert.rejects(arrival(UNIFORMES, "caixa-5", "box", LIBERADO), { code: "invalid-argument" });
    assert.equal(await sizeOf("operational_operations"), 0);
  });

  it("repetir a mesma chave devolve a chegada gravada, mesmo depois de a liberação sair; outro modo na mesma chave é recusado", async () => {
    const created = await arrival(UNIFORMES, "caixa-6", "per_box", LIBERADO);
    assert.deepEqual(await arrival(UNIFORMES, "caixa-6", "per_box", DESLIGADO), created);
    await assert.rejects(arrival(UNIFORMES, "caixa-6", undefined, LIBERADO), { code: "already-exists" });
    assert.equal(await sizeOf("inbound_receipts"), 1);
  });

  it("a chegada por caixa não passa pela conferência nem pela entrada por linha", async () => {
    const created = await arrival(UNIFORMES, "caixa-7", "per_box", LIBERADO);
    const receiptId = String(created.receipt_id);
    const receiptNumber = String(created.receipt_number);
    await advance(receiptId, "created");
    assert.equal((await receiptOf(receiptId)).status, "checking");
    await assert.rejects(conference(receiptId), {
      code: "failed-precondition",
      message: `A chegada ${receiptNumber} é conferida por caixa: a quantidade de cada linha vem das caixas.`,
    });
    await assert.rejects(advance(receiptId, "checking"), {
      code: "failed-precondition",
      message: `A chegada ${receiptNumber} é conferida por caixa: concluir a entrada pede as caixas fechadas e com destino.`,
    });
    const lines = await db.collection("inbound_items").where("receipt_id", "==", receiptId).get();
    assert.equal(lines.size, 1);
    for (const line of lines.docs) {
      assert.equal(line.get("received_qty"), 0);
      assert.equal(line.get("status"), "expected");
    }
    assert.equal((await receiptOf(receiptId)).status, "checking");
    for (const collection of ["movements", "stock_balances", "putaway_tasks"]) {
      assert.equal(await sizeOf(collection), 0, collection);
    }
  });

  it("a chegada por linha segue como sempre: conferência e entrada", async () => {
    const created = await arrival(UNIFORMES, "linha-4");
    const receiptId = String(created.receipt_id);
    await advance(receiptId, "created");
    await conference(receiptId);
    await advance(receiptId, "checking");
    const receipt = await receiptOf(receiptId);
    assert.equal(receipt.status, "received");
    assert.equal(receipt.conference_mode, "per_line");
    assert.equal(await sizeOf("putaway_tasks"), 1);
  });

  it("a chegada aprovada do aviso do portal nasce por linha", async () => {
    const request = await createCustomerRequestTransaction(
      db,
      {
        type: "recebimento",
        priority: "normal",
        title: "Entrega de camisas",
        customer_code: UNIFORMES,
        supplier: "Confecções Alfa",
        invoice_number: "1842",
        idempotency_key: "aviso-1",
        items: [
          {
            line_number: 1,
            sku_code: skuOf(UNIFORMES),
            client_item_code: itemOf(UNIFORMES),
            product_name: "Camisa polo",
            product_registration: "existing",
            location_id: "RECEBIMENTO",
            quantity: 10,
          },
        ],
      },
      { uid: "cli-1", role: "cliente", customer_code: UNIFORMES, name: "Cristiane" },
    );
    const requestId = String((request as { id: unknown }).id);
    await decideCustomerRequestTransaction(
      db,
      { request_id: requestId, action: "approve", expected_status: "open", idempotency_key: `approve-${requestId}` },
      coordenacao,
    );
    const receiptId = `inb_${requestId}`;
    assert.equal((await receiptOf(receiptId)).conference_mode, "per_line");
    assert.equal((await createdEvent(receiptId)).payload.conference_mode, "per_line");
  });
});
