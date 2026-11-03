import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { Timestamp, getFirestore } from "firebase-admin/firestore";

/**
 * As datas de entrada do estoque (getStockDates, docs/plataforma/fifo-por-data.md,
 * seções 3.3 e 3.4, parte 5): o cliente recebe as do próprio item, por dia e
 * sem prateleira nem caixa, e não lê as de outro cliente; a equipe recebe
 * também por prateleira, na ordem do pedido. A callable de verdade, pelo
 * `.run`, no emulador. O razão é semeado com o created_at do dia de cada
 * caso, como em domain/fifo-por-data.integration.test.ts.
 */

const PROJECT_ID = "demo-dute-operations";
const BTG = "BTG Pactual";
const ITAU = "Itaú";
/** O mesmo código nos dois clientes: a fronteira é o customer_code, não o SKU. */
const SKU = "POLO-GG";

type Callable = { run: (request: never) => Promise<unknown> };
type Datas = { datas: Array<{ desde: string | null; pecas: number }>; locais?: Array<{ local: string; pecas: number; datas: unknown[] }> };

let getStockDates: Callable;
let sequencia = 0;

function datas(uid: string, data: Record<string, unknown>) {
  return getStockDates.run({
    auth: { uid, token: { email: `${uid}@dutelog.com.br` } },
    data,
    rawRequest: { headers: {} },
  } as never) as Promise<Datas>;
}

function saldo(cliente: string, local: string, quantidade: number, reservado = 0) {
  const id = `bal-${cliente}-${SKU}-${local}`.replace(/[^\w.-]/g, "_");
  return getFirestore().collection("stock_balances").doc(id).set({
    id,
    customer_code: cliente,
    sku_code: SKU,
    client_item_code: "A.01.0806.004.GG",
    product_name: "POLO MASCULINO PIQUET PRETO GG",
    location_id: local,
    qty_on_hand: quantidade,
    qty_reserved: reservado,
    qty_available: quantidade - reservado,
  });
}

/** Uma ENTRADA do razão com o created_at (a hora do servidor) do dia do caso. */
function entrada(cliente: string, local: string, quantidade: number, quando: string, extra: Record<string, unknown> = {}) {
  sequencia += 1;
  const id = `mov-datas-${sequencia}`;
  return getFirestore().collection("movements").doc(id).set({
    id,
    tipo_mov: "ENTRADA",
    quantity: quantidade,
    qtde: quantidade,
    customer_code: cliente,
    sku_code: SKU,
    client_item_code: "A.01.0806.004.GG",
    location_id: local,
    source: "wms_putaway",
    ...extra,
    created_at: Timestamp.fromDate(new Date(quando)),
  });
}

before(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  }
  getStockDates = (await import("./index.js")).getStockDates as unknown as Callable;
  await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  const db = getFirestore();
  const users = db.collection("users");
  await Promise.all([
    users.doc("cliente-btg").set({ role: "cliente", nome: "Compras BTG", customer_code: BTG }),
    users.doc("cliente-itau").set({ role: "cliente", nome: "Compras Itaú", customer_code: ITAU }),
    users.doc("wms-a").set({ role: "wms", nome: "Guilherme" }),
    users.doc("financeiro-a").set({ role: "financeiro", nome: "Financeiro" }),
  ]);
  await Promise.all([
    // As telas aprovadas: 16 de 22/10 em B-05 (10 reservadas), 30 de 30/10 e 60 de 03/11 em B-02.
    saldo(BTG, "B-05", 16, 10),
    saldo(BTG, "B-02", 90),
    saldo(BTG, "RECEBIMENTO", 40),
    entrada(BTG, "B-05", 30, "2026-10-24T15:00:00-03:00", { opening_inventory_session_id: "opening_BTG_Pactual" }),
    entrada(BTG, "B-02", 30, "2026-10-30T10:00:00-03:00"),
    entrada(BTG, "B-02", 60, "2026-11-03T09:00:00-03:00"),
    entrada(BTG, "RECEBIMENTO", 40, "2026-11-03T16:00:00-03:00"),
    // A contagem de abertura começou em 22/10: as peças dela valem esse dia, não o da ENTRADA.
    db.collection("opening_inventory_sessions").doc("opening_BTG_Pactual").set({
      customer_code: BTG,
      status: "completed",
      started_at: Timestamp.fromDate(new Date("2026-10-22T08:30:00-03:00")),
    }),
    saldo(ITAU, "A-01", 7),
    entrada(ITAU, "A-01", 7, "2026-10-25T11:00:00-03:00"),
  ]);
});

describe("as datas de entrada do estoque (getStockDates)", () => {
  it("o cliente recebe as datas do próprio item, por dia e sem prateleira", async () => {
    const resposta = await datas("cliente-btg", { sku_code: SKU });
    assert.deepEqual(resposta, {
      datas: [
        { desde: "2026-10-22", pecas: 16 },
        { desde: "2026-10-30", pecas: 30 },
        { desde: "2026-11-03", pecas: 60 },
      ],
    });
    const texto = JSON.stringify(resposta);
    for (const local of ["B-05", "B-02", "RECEBIMENTO"]) assert.equal(texto.includes(local), false, `${local} na resposta do cliente`);
  });

  it("o cliente não lê as datas de outro cliente, nem com o mesmo código de SKU", async () => {
    await assert.rejects(datas("cliente-btg", { customer_code: ITAU, sku_code: SKU }), {
      code: "permission-denied",
      message: "Cliente não pode agir em outro contrato.",
    });
    assert.deepEqual(await datas("cliente-itau", { sku_code: SKU }), { datas: [{ desde: "2026-10-25", pecas: 7 }] });
  });

  it("a equipe recebe também por prateleira, a de data livre mais antiga primeiro, e o RECEBIMENTO sem data", async () => {
    const resposta = await datas("wms-a", { customer_code: BTG, sku_code: SKU });
    assert.deepEqual(resposta.locais, [
      { local: "B-05", pecas: 16, datas: [{ desde: "2026-10-22", pecas: 16 }] },
      {
        local: "B-02",
        pecas: 90,
        datas: [
          { desde: "2026-10-30", pecas: 30 },
          { desde: "2026-11-03", pecas: 60 },
        ],
      },
      { local: "RECEBIMENTO", pecas: 40, datas: [] },
    ]);
    assert.equal(resposta.datas.length, 3);
  });

  it("quem não lê o estoque por local nem é o cliente não recebe as datas", async () => {
    await assert.rejects(datas("financeiro-a", { customer_code: BTG, sku_code: SKU }), {
      code: "permission-denied",
      message: "Datas do estoque visíveis somente para a operação ou o cliente.",
    });
  });

  it("sem o SKU, a callable pede o SKU", async () => {
    await assert.rejects(datas("cliente-btg", {}), { code: "invalid-argument", message: "Informe o SKU do item." });
  });
});
