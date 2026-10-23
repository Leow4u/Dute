import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";

import { getFirestore, type Firestore } from "firebase-admin/firestore";

import { competenciaFromDate, emissionAvailableFrom } from "./billing.js";
import { billingDocumentId } from "./domain/billing-scope.js";

/**
 * As trilhas de dinheiro do WMS (parte 7.1,
 * docs/plataforma/fase-7-financeiro-unificado.md): as callables de verdade,
 * pelo `.run` do `onCall`, no emulador. Fixam o comportamento de hoje antes de
 * a Fase 7 mexer no faturamento; os números estão resolvidos à mão.
 */

const PROJECT_ID = "demo-dute-operations";
const BTG = "BTG Pactual";
const SAFRA = "Banco Safra";
const SETEMBRO = "2026-09";
const ID_BTG = billingDocumentId(BTG, SETEMBRO);
const ID_SAFRA = billingDocumentId(SAFRA, SETEMBRO);

type Wms = typeof import("./index.js");
type Callable = { run: (request: never) => unknown };

type Linha = {
  price_list_id: number | string;
  qtde: number;
  valor_unit: number;
  total_cents: number;
};

type Previa = {
  competencia: string;
  status: string;
  fatura_id: string | null;
  pago_em: string | null;
  emission: { can_emit: boolean; available_from: string };
  custo_estoque: number;
  ad_valorem_rate: number;
  grupos: Array<{ grupo: string; itens: Linha[] }>;
  total: number;
  total_cents: number;
  calculated_at: string | null;
};

type Emissao = {
  ok: true;
  invoice: { total_cents: number; total: number; issued_at: string; status: string };
  email: { sent: boolean };
};

let wms: Wms;
let db: Firestore;

before(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("FIRESTORE_EMULATOR_HOST não definido.");
  }
  wms = await import("./index.js");
  db = getFirestore();
});

beforeEach(async () => {
  await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  await semear();
});

async function chamar<T>(
  callable: Callable,
  uid: string | null,
  data: Record<string, unknown>,
): Promise<T> {
  const request = {
    auth: uid ? { uid, token: { email: `${uid}@dutelog.com.br` } } : undefined,
    data,
    rawRequest: {},
  };
  return (await callable.run(request as never)) as T;
}

const previa = (data: Record<string, unknown>, uid = "fin") =>
  chamar<Previa>(wms.getBillingPreview, uid, data);
const emitir = (data: Record<string, unknown>, uid = "fin") =>
  chamar<Emissao>(wms.emitBillingInvoice, uid, data);
const pagar = (data: Record<string, unknown>, uid = "fin") =>
  chamar<{ status: string; pago_em: string }>(wms.payBillingInvoice, uid, data);
const salvarManual = (data: Record<string, unknown>, uid = "fin") =>
  chamar<{ ok: boolean; status: string }>(wms.saveBillingManual, uid, data);

/** A competência de setembro aberta, com a hora extra (item 7) em 2,5. */
const abrirSetembro = () =>
  salvarManual({
    competencia: SETEMBRO,
    idempotency_key: "abrir-setembro",
    items: [{ price_list_id: 7, qtde: 2.5, observacao: null }],
  });

async function recusa(
  promessa: Promise<unknown>,
  code: string,
  billingCode?: string,
) {
  await assert.rejects(promessa, (error: unknown) => {
    const erro = error as { code?: string; details?: { billing_code?: string } };
    assert.equal(erro.code, code);
    if (billingCode) assert.equal(erro.details?.billing_code, billingCode);
    return true;
  });
}

function linhas(resultado: Pick<Previa, "grupos">): Map<string, Linha> {
  return new Map(
    resultado.grupos.flatMap((grupo) =>
      grupo.itens.map((linha) => [String(linha.price_list_id), linha] as const),
    ),
  );
}

async function contar(colecao: string, campo: string, valor: string) {
  return (await db.collection(colecao).where(campo, "==", valor).get()).size;
}

/**
 * A BTG em setembro de 2026:
 *
 * - Valor da mercadoria: 10 × 100 (preço unitário) + 250 (total do preço; o
 *   total legado de 9999 não vale) + 75 (sem preço, total legado) = 1325.
 * - Entradas: 20 + 5 (tipo ENTRADA sem sinal) + 2 (22h30 de 30/09 em São
 *   Paulo, 01/10 em UTC) = 27 peças.
 * - Saídas: 8 + 4 (quantidade negativa conta pelo módulo) = 12 peças.
 * - Movimentos: 5. Ficam de fora o `billable: false`, o de outubro, o das 23h
 *   de 31/08 (01/09 em UTC) e o do Safra.
 *
 * Linhas: ad valorem 1325 × 0,004 = 5,30; entradas 27 × 1,25 = 33,75; saídas
 * 12 × 2,10 = 25,20; movimentos 5 × 0,50 = 2,50; pallet 0 × 15 = 0; hora extra
 * 2,5 × 3,333 = 8,3325 → 8,33. Total 75,08. O item inativo e o do Safra saem.
 */
const TOTAL_BTG = 7508;

async function semear() {
  const lote = db.batch();
  const pessoas: Record<string, Record<string, unknown>> = {
    fin: { role: "financeiro", nome: "Financeiro" },
    sup: { role: "suporte", nome: "Suporte" },
    arm: { role: "wms", nome: "Armazém" },
    cli: { role: "cliente", nome: "Cliente", customer_code: BTG },
  };
  for (const [uid, perfil] of Object.entries(pessoas)) {
    lote.set(db.collection("users").doc(uid), { ...perfil, email: `${uid}@dutelog.com.br` });
  }

  lote.set(db.collection("billing_config").doc("default"), { ad_valorem_rate: 0.004 });

  const lpu: Array<Record<string, unknown>> = [
    { doc: "btg_1", id: 1, customer_code: BTG, grupo: "Armazenagem", item: "Ad valorem", valor_unit: 0, auto_source: "ad_valorem", ordem: 1 },
    { doc: "btg_2", id: 2, customer_code: BTG, grupo: "Movimentação", item: "Entrada por peça", valor_unit: 1.25, auto_source: "mov_entrada_pecas", ordem: 2 },
    { doc: "btg_3", id: 3, customer_code: BTG, grupo: "Movimentação", item: "Saída por peça", valor_unit: 2.1, auto_source: "mov_saida_pecas", ordem: 3 },
    // Criado antes de 01/10/2026, sem cliente: vale para a BTG.
    { doc: "btg_4", id: 4, grupo: "Movimentação", item: "Movimento", valor_unit: 0.5, auto_source: "mov_count", ordem: 4 },
    { doc: "btg_5", id: 5, customer_code: BTG, grupo: "Armazenagem", item: "Pallet", valor_unit: 15, auto_source: "pallet", ordem: 5 },
    { doc: "btg_7", id: 7, customer_code: BTG, grupo: "Serviços", item: "Hora extra", unidade: "h", valor_unit: 3.333, auto_source: null, ordem: 7 },
    { doc: "btg_8", id: 8, customer_code: BTG, grupo: "Serviços", item: "Inativo", valor_unit: 99, auto_source: "mov_count", ordem: 8, ativo: false },
    // O mesmo id em outro cliente: a lista de cada um é só dele.
    { doc: "safra_1", id: 1, customer_code: SAFRA, grupo: "Movimentação", item: "Entrada por peça", valor_unit: 1, auto_source: "mov_entrada_pecas", ordem: 1 },
  ];
  for (const { doc, ...item } of lpu) {
    lote.set(db.collection("billing_price_list").doc(String(doc)), item);
  }

  const estoque: Array<[string, Record<string, unknown>]> = [
    ["inv_a", { customer_code: BTG, sku_code: "BTG-000001", qty_on_hand: 10 }],
    ["inv_b", { customer_code: BTG, sku_code: "BTG-000002", qty_on_hand: 5, total_cost: 9999 }],
    ["inv_c", { customer_code: BTG, sku_code: "BTG-000003", qty_on_hand: 3, total_cost: 75 }],
    ["inv_s", { customer_code: SAFRA, sku_code: "SAF-000001", qty_on_hand: 1000 }],
  ];
  for (const [id, linha] of estoque) lote.set(db.collection("client_inventory").doc(id), linha);

  const precos: Array<[string, Record<string, unknown>]> = [
    ["BTG-000001", { customer_code: BTG, sku_code: "BTG-000001", preco_unit: 100 }],
    ["BTG-000002", { customer_code: BTG, sku_code: "BTG-000002", preco_unit: 50, total_cost: 250 }],
    ["SAF-000001", { customer_code: SAFRA, sku_code: "SAF-000001", total_cost: 100000 }],
  ];
  for (const [id, preco] of precos) lote.set(db.collection("catalog_prices").doc(id), preco);

  const movimentos: Array<[string, Record<string, unknown>]> = [
    ["m1", { customer_code: BTG, occurred_at: "2026-09-10T13:00:00.000Z", sinal: 1, qtde: 20, tipo_mov: "ENTRADA" }],
    ["m2", { customer_code: BTG, occurred_at: "2026-09-12T13:00:00.000Z", qtde: 5, tipo_mov: "ENTRADA" }],
    ["m3", { customer_code: BTG, occurred_at: "2026-10-01T02:30:00.000Z", sinal: 1, qtde: 2 }],
    ["m4", { customer_code: BTG, occurred_at: "2026-09-15T13:00:00.000Z", sinal: -1, qtde: 8, tipo_mov: "SAIDA" }],
    ["m5", { customer_code: BTG, occurred_at: "2026-09-20T13:00:00.000Z", sinal: -1, qtde: -4 }],
    ["x1", { customer_code: BTG, occurred_at: "2026-09-11T13:00:00.000Z", sinal: 1, qtde: 100, billable: false }],
    ["x2", { customer_code: BTG, occurred_at: "2026-10-05T13:00:00.000Z", sinal: 1, qtde: 50 }],
    ["x3", { customer_code: BTG, occurred_at: "2026-09-01T02:00:00.000Z", sinal: 1, qtde: 60 }],
    ["x4", { customer_code: SAFRA, occurred_at: "2026-09-10T13:00:00.000Z", sinal: 1, qtde: 30 }],
  ];
  for (const [id, movimento] of movimentos) lote.set(db.collection("movements").doc(id), movimento);

  await lote.commit();
}

describe("a prévia do mês fechado", () => {
  it("soma as linhas da LPU com o uso do mês no horário de São Paulo", async () => {
    await abrirSetembro();
    const resultado = await previa({ competencia: SETEMBRO });

    assert.equal(resultado.status, "aberto");
    assert.equal(resultado.fatura_id, null);
    assert.deepEqual(resultado.emission, { can_emit: true, available_from: "2026-10-01" });
    assert.equal(resultado.custo_estoque, 1325);
    assert.equal(resultado.ad_valorem_rate, 0.004);

    // Por grupo, na ordem em que o grupo aparece na LPU.
    assert.deepEqual(
      resultado.grupos.map((grupo) => [grupo.grupo, grupo.itens.map((linha) => linha.price_list_id)]),
      [
        ["Armazenagem", [1, 5]],
        ["Movimentação", [2, 3, 4]],
        ["Serviços", [7]],
      ],
    );
    const porItem = linhas(resultado);
    const esperado: Record<string, [qtde: number, valorUnit: number, centavos: number]> = {
      1: [1325, 0.004, 530],
      2: [27, 1.25, 3375],
      3: [12, 2.1, 2520],
      4: [5, 0.5, 250],
      5: [0, 15, 0],
      7: [2.5, 3.333, 833],
    };
    for (const [id, [qtde, valorUnit, centavos]] of Object.entries(esperado)) {
      const linha = porItem.get(id);
      assert.ok(linha, `linha ${id}`);
      assert.deepEqual([linha.qtde, linha.valor_unit, linha.total_cents], [qtde, valorUnit, centavos], `linha ${id}`);
    }
    assert.equal(resultado.total_cents, TOTAL_BTG);
    assert.equal(resultado.total, 75.08);
  });

  it("sem a BTG pedida, o papel interno fatura a BTG", async () => {
    const semCliente = await previa({ competencia: SETEMBRO });
    const comCliente = await previa({ competencia: SETEMBRO, customer_code: BTG });
    assert.equal(semCliente.total_cents, comCliente.total_cents);
  });
});

describe("o uso congelado", () => {
  it("a primeira prévia grava a foto uma vez; o movimento que chega depois não muda nada", async () => {
    await abrirSetembro();
    await previa({ competencia: SETEMBRO });

    const foto = await db.collection("billing_operational_snapshots").doc(ID_BTG).get();
    assert.equal(foto.get("mode"), "frozen");
    assert.equal(foto.get("customer_code"), BTG);
    assert.deepEqual(foto.get("usage"), {
      custo_estoque: 1325,
      entradas_pecas: 27,
      saidas_pecas: 12,
      movimentacoes: 5,
    });

    await db.collection("movements").doc("m6").set({
      customer_code: BTG,
      occurred_at: "2026-09-25T13:00:00.000Z",
      sinal: 1,
      qtde: 40,
    });
    await db.collection("client_inventory").doc("inv_a").update({ qty_on_hand: 100 });
    assert.equal((await previa({ competencia: SETEMBRO })).total_cents, TOTAL_BTG);

    // O preço não é congelado: vale o da LPU até a emissão (27 × 2,00 = 54,00).
    await db.collection("billing_price_list").doc("btg_2").update({ valor_unit: 2 });
    const comPrecoNovo = TOTAL_BTG - 3375 + 5400;
    assert.equal((await previa({ competencia: SETEMBRO })).total_cents, comPrecoNovo);
    assert.equal((await emitir({ competencia: SETEMBRO })).invoice.total_cents, comPrecoNovo);
  });

  it("a emissão sem prévia também congela o uso antes de calcular", async () => {
    await abrirSetembro();
    await emitir({ competencia: SETEMBRO });
    const foto = await db.collection("billing_operational_snapshots").doc(ID_BTG).get();
    assert.equal(foto.get("mode"), "frozen");
    assert.equal(foto.get("usage.entradas_pecas"), 27);
  });
});

describe("a emissão", () => {
  it("congela a fatura com o total da prévia, publica no portal e grava o evento uma vez", async () => {
    await abrirSetembro();
    const antes = await previa({ competencia: SETEMBRO });
    const emitida = await emitir({ competencia: SETEMBRO });

    assert.equal(emitida.ok, true);
    assert.equal(emitida.email.sent, false);
    assert.equal(emitida.invoice.status, "emitido");
    assert.equal(emitida.invoice.total_cents, antes.total_cents);
    assert.equal(emitida.invoice.total, 75.08);

    const periodo = await db.collection("billing_periods").doc(ID_BTG).get();
    assert.equal(periodo.get("status"), "emitido");
    assert.equal(periodo.get("customer_code"), BTG);
    assert.equal(periodo.get("total_cents"), TOTAL_BTG);
    assert.equal(periodo.get("emitido_em"), emitida.invoice.issued_at);
    assert.equal(periodo.get("invoice_snapshot.total_cents"), TOTAL_BTG);
    assert.equal(periodo.get("invoice_snapshot.custo_estoque"), 1325);
    assert.equal(periodo.get("invoice_snapshot.currency"), "BRL");
    assert.equal(periodo.get("invoice_snapshot.linhas").length, 6);

    const portal = await db.collection("client_invoices").doc(ID_BTG).get();
    assert.equal(portal.get("customer_code"), BTG);
    assert.equal(portal.get("competencia"), SETEMBRO);
    assert.equal(portal.get("status"), "emitido");
    assert.equal(portal.get("payment_status"), "issued");
    assert.equal(portal.get("total_cents"), TOTAL_BTG);
    assert.equal(portal.get("total"), 75.08);
    assert.equal(portal.get("emitido_em"), emitida.invoice.issued_at);

    const evento = await db.collection("events").where("type", "==", "billing.invoice_emitted").get();
    assert.equal(evento.size, 1);
    assert.equal(evento.docs[0].get("customer_code"), BTG);
    assert.equal(evento.docs[0].get("entity_id"), SETEMBRO);
    assert.deepEqual(evento.docs[0].get("payload"), { total_cents: TOTAL_BTG, total: 75.08 });

    const deNovo = await emitir({ competencia: SETEMBRO });
    assert.equal(deNovo.invoice.issued_at, emitida.invoice.issued_at);
    assert.equal(deNovo.invoice.total_cents, TOTAL_BTG);
    assert.equal(await contar("events", "type", "billing.invoice_emitted"), 1);
  });

  it("depois de emitida, a prévia é a foto, mesmo com o preço e o uso mudados", async () => {
    await abrirSetembro();
    const emitida = await emitir({ competencia: SETEMBRO });
    await db.collection("billing_price_list").doc("btg_2").update({ valor_unit: 9 });
    await db.collection("billing_operational_snapshots").doc(ID_BTG).update({ "usage.entradas_pecas": 1000 });

    const resultado = await previa({ competencia: SETEMBRO });
    assert.equal(resultado.status, "emitido");
    assert.equal(resultado.emission.can_emit, false);
    assert.equal(resultado.total_cents, TOTAL_BTG);
    assert.equal(resultado.calculated_at, emitida.invoice.issued_at);
    assert.equal(linhas(resultado).get("2")?.valor_unit, 1.25);
  });

  it("a competência que ninguém abriu não emite, mas o uso do mês fechado fica congelado", async () => {
    await recusa(emitir({ competencia: "2026-08" }), "failed-precondition", "PERIOD_NOT_FOUND");
    const foto = await db
      .collection("billing_operational_snapshots")
      .doc(billingDocumentId(BTG, "2026-08"))
      .get();
    assert.equal(foto.get("mode"), "frozen");
    assert.equal((await db.collection("billing_periods").get()).size, 0);
    assert.equal((await db.collection("client_invoices").get()).size, 0);
  });
});

describe("o mês em aberto", () => {
  it("não emite, e a prévia dele não congela nada", async () => {
    const atual = competenciaFromDate(new Date());
    await salvarManual({ competencia: atual, idempotency_key: "abrir-atual", items: [] });

    const resultado = await previa({ competencia: atual });
    assert.equal(resultado.status, "aberto");
    assert.deepEqual(resultado.emission, {
      can_emit: false,
      available_from: emissionAvailableFrom(atual),
    });
    await recusa(emitir({ competencia: atual }), "failed-precondition", "COMPETENCIA_NOT_CLOSED");

    const id = billingDocumentId(BTG, atual);
    assert.equal((await db.collection("billing_operational_snapshots").doc(id).get()).exists, false);
    assert.equal((await db.collection("billing_periods").doc(id).get()).get("status"), "aberto");
  });

  it("o mês que ainda não começou não abre", async () => {
    const seguinte = emissionAvailableFrom(competenciaFromDate(new Date())).slice(0, 7);
    await recusa(
      salvarManual({ competencia: seguinte, idempotency_key: "abrir-seguinte", items: [] }),
      "failed-precondition",
      "FUTURE_COMPETENCIA",
    );
  });
});

describe("as quantidades manuais", () => {
  it("a mesma chave não grava duas vezes, com outro conteúdo recusa, e depois da emissão recusa", async () => {
    const pedido = {
      competencia: SETEMBRO,
      idempotency_key: "k1",
      items: [{ price_list_id: 7, qtde: 2.5, observacao: "Inventário" }],
    };
    assert.deepEqual(await salvarManual(pedido), { competencia: SETEMBRO, status: "aberto", ok: true });
    assert.deepEqual(await salvarManual(pedido), { competencia: SETEMBRO, status: "aberto", ok: true });
    assert.equal(await contar("operational_operations", "kind", "billing.manual_quantities"), 1);
    assert.equal(await contar("events", "type", "billing.manual_quantities_saved"), 1);

    await recusa(
      salvarManual({ ...pedido, items: [{ price_list_id: 7, qtde: 3, observacao: null }] }),
      "already-exists",
    );

    // Outra chave troca a lista inteira: 4 × 3,333 = 13,332 → 13,33.
    await salvarManual({ ...pedido, idempotency_key: "k2", items: [{ price_list_id: 7, qtde: 4, observacao: null }] });
    const manual = await db.collection("billing_manual").doc(ID_BTG).get();
    assert.deepEqual(manual.get("items"), [{ price_list_id: 7, qtde: 4, observacao: null }]);
    const resultado = await previa({ competencia: SETEMBRO });
    assert.equal(linhas(resultado).get("7")?.total_cents, 1333);
    assert.equal(resultado.total_cents, TOTAL_BTG - 833 + 1333);

    await emitir({ competencia: SETEMBRO });
    await recusa(
      salvarManual({ ...pedido, idempotency_key: "k3" }),
      "failed-precondition",
      "PERIOD_NOT_OPEN",
    );
    assert.equal((await db.collection("billing_manual").doc(ID_BTG).get()).get("items")[0].qtde, 4);
  });
});

describe("o pagamento", () => {
  it("só da emitida e uma vez, com o portal em pago", async () => {
    await recusa(pagar({ competencia: SETEMBRO }), "failed-precondition", "PERIOD_NOT_FOUND");
    await abrirSetembro();
    await recusa(pagar({ competencia: SETEMBRO }), "failed-precondition", "INVALID_STATUS_TRANSITION");

    await emitir({ competencia: SETEMBRO });
    const paga = await pagar({ competencia: SETEMBRO });
    assert.equal(paga.status, "pago");

    const periodo = await db.collection("billing_periods").doc(ID_BTG).get();
    assert.equal(periodo.get("status"), "pago");
    assert.equal(periodo.get("pago_em"), paga.pago_em);
    assert.equal(periodo.get("paid_by"), "fin");
    assert.equal(periodo.get("invoice_snapshot.total_cents"), TOTAL_BTG);

    const portal = await db.collection("client_invoices").doc(ID_BTG).get();
    assert.equal(portal.get("status"), "pago");
    assert.equal(portal.get("payment_status"), "paid");
    assert.equal(portal.get("total_cents"), TOTAL_BTG);
    assert.equal(await contar("events", "type", "billing.invoice_paid"), 1);

    await recusa(pagar({ competencia: SETEMBRO }), "failed-precondition", "INVALID_STATUS_TRANSITION");
    await recusa(emitir({ competencia: SETEMBRO }), "failed-precondition", "PERIOD_NOT_OPEN");
    assert.equal(await contar("events", "type", "billing.invoice_paid"), 1);

    const resultado = await previa({ competencia: SETEMBRO });
    assert.equal(resultado.status, "pago");
    assert.equal(resultado.pago_em, paga.pago_em);
    assert.equal(resultado.total_cents, TOTAL_BTG);
  });

  it("a competência numa NF do Financeiro não se paga no WMS (parte 7.2a)", async () => {
    await abrirSetembro();
    await emitir({ competencia: SETEMBRO });
    await db.collection("billing_periods").doc(ID_BTG).update({
      faturamento: { fatura_id: "fat_0123456789abcdef01234567", vencimento: "2026-11-10" },
    });
    await recusa(pagar({ competencia: SETEMBRO }), "failed-precondition", "PERIOD_INVOICED");
    // A prévia diz em que NF ela está (parte 7.2c).
    assert.equal((await previa({ competencia: SETEMBRO })).fatura_id, "fat_0123456789abcdef01234567");
    assert.equal((await db.collection("billing_periods").doc(ID_BTG).get()).get("status"), "emitido");
    assert.equal((await db.collection("client_invoices").doc(ID_BTG).get()).get("payment_status"), "issued");
    assert.equal(await contar("events", "type", "billing.invoice_paid"), 0);
  });

  it("a competência antiga da BTG, no id do mês, é paga no mesmo documento", async () => {
    const snapshot = {
      schema_version: 1,
      competencia: "2026-08",
      status: "emitido",
      currency: "BRL",
      issued_at: "2026-09-02T12:00:00.000Z",
      emitted_by: "fin@dutelog.com.br",
      custo_estoque: 0,
      ad_valorem_rate: 0.004,
      linhas: [],
      grupos: [],
      total_cents: 1234,
      total: 12.34,
    };
    await db.collection("billing_periods").doc("2026-08").set({
      competencia: "2026-08",
      status: "emitido",
      total_cents: 1234,
      invoice_snapshot: snapshot,
    });
    await db.collection("client_invoices").doc("2026-08").set({
      competencia: "2026-08",
      status: "emitido",
      payment_status: "issued",
      total_cents: 1234,
    });

    const resultado = await previa({ competencia: "2026-08" });
    assert.equal(resultado.status, "emitido");
    assert.equal(resultado.total_cents, 1234);

    await pagar({ competencia: "2026-08" });
    assert.equal((await db.collection("billing_periods").doc("2026-08").get()).get("status"), "pago");
    const portal = await db.collection("client_invoices").doc("2026-08").get();
    assert.equal(portal.get("payment_status"), "paid");
    assert.equal(portal.get("customer_code"), BTG);
    const id = billingDocumentId(BTG, "2026-08");
    assert.equal((await db.collection("billing_periods").doc(id).get()).exists, false);
    assert.equal((await db.collection("client_invoices").doc(id).get()).exists, false);
  });
});

describe("a virada", () => {
  it("com a foto baseline, só o recebimento e a expedição do WMS somam ao que a foto trouxe", async () => {
    const usage = { custo_estoque: 900, entradas_pecas: 100, saidas_pecas: 40, movimentacoes: 10 };
    await db.collection("billing_operational_snapshots").doc(ID_BTG).set({
      mode: "baseline",
      customer_code: BTG,
      competencia: SETEMBRO,
      usage,
    });
    await db.collection("movements").doc("r1").set({
      customer_code: BTG,
      occurred_at: "2026-09-26T13:00:00.000Z",
      sinal: 1,
      qtde: 6,
      source: "wms_receiving",
    });
    await db.collection("movements").doc("s1").set({
      customer_code: BTG,
      occurred_at: "2026-09-27T13:00:00.000Z",
      sinal: -1,
      qtde: 3,
      source: "wms_shipping",
    });

    // Custo de agora (1325 × 0,004 = 5,30); entradas 106 × 1,25 = 132,50;
    // saídas 43 × 2,10 = 90,30; movimentos 12 × 0,50 = 6,00. Sem hora extra.
    const baseline = await previa({ competencia: SETEMBRO });
    assert.equal(baseline.custo_estoque, 1325);
    assert.equal(linhas(baseline).get("2")?.qtde, 106);
    assert.equal(linhas(baseline).get("3")?.qtde, 43);
    assert.equal(linhas(baseline).get("4")?.qtde, 12);
    assert.equal(baseline.total_cents, 530 + 13250 + 9030 + 600);
    assert.equal(
      (await db.collection("billing_operational_snapshots").doc(ID_BTG).get()).get("mode"),
      "baseline",
    );

    // Com a abertura do estoque em curso, o custo é o da foto: 900 × 0,004 = 3,60.
    await db.collection("system_controls").doc("inventory").set({ opening_inventory_required: true });
    assert.equal((await previa({ competencia: SETEMBRO })).total_cents, 360 + 13250 + 9030 + 600);

    // replace: só a foto, sem o que veio depois.
    await db.collection("billing_operational_snapshots").doc(ID_BTG).update({ mode: "replace" });
    assert.equal((await previa({ competencia: SETEMBRO })).total_cents, 360 + 12500 + 8400 + 500);
  });
});

describe("o isolamento", () => {
  it("cada cliente fatura o dele, no documento dele", async () => {
    // Safra: só a entrada de 30 peças × 1,00. O valor da mercadoria entra na
    // prévia, mas a LPU dele não tem ad valorem.
    const safra = await previa({ competencia: SETEMBRO, customer_code: SAFRA });
    assert.equal(safra.custo_estoque, 100000);
    assert.deepEqual([...linhas(safra).keys()], ["1"]);
    assert.equal(linhas(safra).get("1")?.qtde, 30);
    assert.equal(safra.total_cents, 3000);
    const foto = await db.collection("billing_operational_snapshots").doc(ID_SAFRA).get();
    assert.deepEqual(foto.get("usage"), {
      custo_estoque: 100000,
      entradas_pecas: 30,
      saidas_pecas: 0,
      movimentacoes: 1,
    });

    await salvarManual({ competencia: SETEMBRO, customer_code: SAFRA, idempotency_key: "safra", items: [] });
    await emitir({ competencia: SETEMBRO, customer_code: SAFRA });
    const portal = await db.collection("client_invoices").doc(ID_SAFRA).get();
    assert.equal(portal.get("customer_code"), SAFRA);
    assert.equal(portal.get("total_cents"), 3000);
    assert.equal((await db.collection("billing_periods").doc(ID_SAFRA).get()).get("status"), "emitido");

    // A BTG segue aberta e sem a hora extra: 75,08 − 8,33 = 66,75.
    assert.equal((await db.collection("client_invoices").doc(ID_BTG).get()).exists, false);
    assert.equal((await db.collection("client_invoices").doc(SETEMBRO).get()).exists, false);
    const btg = await previa({ competencia: SETEMBRO });
    assert.equal(btg.status, "aberto");
    assert.equal(btg.total_cents, TOTAL_BTG - 833);
  });
});

describe("quem fatura", () => {
  it("o armazém e o cliente não veem a prévia; o suporte vê e não grava", async () => {
    await recusa(previa({ competencia: SETEMBRO }, "arm"), "permission-denied");
    await recusa(emitir({ competencia: SETEMBRO }, "arm"), "permission-denied");
    await recusa(previa({ competencia: SETEMBRO }, "cli"), "permission-denied");
    await recusa(pagar({ competencia: SETEMBRO }, "cli"), "permission-denied");
    await recusa(previa({ competencia: SETEMBRO }, "sem-perfil"), "permission-denied");
    await recusa(chamar(wms.getBillingPreview, null, { competencia: SETEMBRO }), "unauthenticated");

    assert.equal((await previa({ competencia: SETEMBRO }, "sup")).total_cents, TOTAL_BTG - 833);
    await recusa(
      salvarManual({ competencia: SETEMBRO, idempotency_key: "sup", items: [] }, "sup"),
      "permission-denied",
    );
    await recusa(emitir({ competencia: SETEMBRO }, "sup"), "permission-denied");
    await recusa(pagar({ competencia: SETEMBRO }, "sup"), "permission-denied");

    assert.equal((await db.collection("billing_periods").get()).size, 0);
    assert.equal((await db.collection("client_invoices").get()).size, 0);
  });
});

describe("o preço pela tabela do Comercial (parte 7.3a)", () => {
  const precos = (lista: Record<string, string>) =>
    Object.fromEntries(Object.entries(lista).map(([item, preco]) => [item, { codigo: "", descricao_cliente: "", preco }]));
  const tabelas = async (extra: Array<[string, Record<string, unknown>]> = []) => {
    const lote = db.batch();
    for (const [id, tabela] of [
      ["pt_a", { customer_code: BTG, contract_id: null, variante: "Armazenagem", vigente_de: "2026-01-01", vigente_ate: "2026-09-15", status: "encerrada", precos: precos({ lpu_entrada: "1.0000", lpu_hora: "3.0000" }) }],
      ["pt_b", { customer_code: BTG, contract_id: null, variante: "Armazenagem", vigente_de: "2026-09-16", vigente_ate: null, status: "ativa", precos: precos({ lpu_entrada: "1.5000", lpu_hora: "4.0000" }) }],
      ["pt_safra", { customer_code: SAFRA, contract_id: null, variante: "Armazenagem", vigente_de: "2026-01-01", vigente_ate: null, status: "ativa", precos: precos({ lpu_entrada: "9.0000", lpu_hora: "9.0000" }) }],
      ...extra,
    ] as Array<[string, Record<string, unknown>]>) {
      lote.set(db.collection("price_tables").doc(id), tabela);
    }
    await lote.commit();
  };
  const ligar = async (doc: string, lpuItemId: string) =>
    db.collection("billing_price_list").doc(doc).update({ lpu_item_id: lpuItemId });

  /**
   * A tabela vigente em 30/09 é a pt_b: entradas 27 × 1,50 = 40,50 e a hora
   * extra 2,5 × 4,00 = 10,00, no lugar de 33,75 e 8,33. O resto não muda:
   * 75,08 − 33,75 + 40,50 − 8,33 + 10,00 = 83,50.
   */
  const COM_A_TABELA = TOTAL_BTG - 3375 + 4050 - 833 + 1000;

  it("o item ligado tira o preço da tabela vigente no último dia; o resto calcula igual", async () => {
    await tabelas();
    await ligar("btg_2", "lpu_entrada");
    await ligar("btg_7", "lpu_hora");
    // O ad valorem ligado segue com a taxa do billing_config.
    await ligar("btg_1", "lpu_sem_preco");
    await abrirSetembro();

    const resultado = await previa({ competencia: SETEMBRO });
    const porItem = linhas(resultado);
    assert.deepEqual(
      [porItem.get("2")?.valor_unit, porItem.get("2")?.total_cents, (porItem.get("2") as Record<string, unknown>)?.tabela_id],
      [1.5, 4050, "pt_b"],
    );
    assert.deepEqual([porItem.get("7")?.valor_unit, porItem.get("7")?.total_cents], [4, 1000]);
    assert.deepEqual([porItem.get("1")?.valor_unit, porItem.get("1")?.total_cents], [0.004, 530]);
    assert.equal("tabela_id" in (porItem.get("3") as object), false);
    assert.equal(resultado.total_cents, COM_A_TABELA);

    const emitida = await emitir({ competencia: SETEMBRO });
    assert.equal(emitida.invoice.total_cents, COM_A_TABELA);
    const foto = (await db.collection("billing_periods").doc(ID_BTG).get()).get("invoice_snapshot.linhas") as Array<Record<string, unknown>>;
    assert.equal(foto.find((linha) => linha.price_list_id === 2)?.tabela_id, "pt_b");
  });

  it("o mesmo item na tabela do outro cliente não vale para este", async () => {
    await tabelas();
    await ligar("btg_2", "lpu_entrada");
    await db.collection("price_tables").doc("pt_b").delete();
    await db.collection("price_tables").doc("pt_a").update({ vigente_ate: "2026-08-31" });
    await recusa(previa({ competencia: SETEMBRO }), "failed-precondition", "PRICE_NOT_IN_TABLE");
  });

  it("sem a tabela com o item, ou com duas no mesmo dia, a conta recusa e nada se emite", async () => {
    await tabelas([["pt_n", { customer_code: BTG, contract_id: null, variante: "Noturna", vigente_de: "2026-01-01", vigente_ate: null, status: "ativa", precos: precos({ lpu_entrada: "2.0000" }) }]]);
    await abrirSetembro();
    await ligar("btg_3", "lpu_saida");
    await assert.rejects(previa({ competencia: SETEMBRO }), (error: unknown) => {
      const erro = error as { code?: string; message?: string; details?: { billing_code?: string } };
      assert.equal(erro.details?.billing_code, "PRICE_NOT_IN_TABLE");
      assert.equal(erro.message, "O item Saída por peça não tem preço numa tabela do Comercial vigente em 30/09/2026.");
      return true;
    });
    // O uso do mês fechado congela mesmo sem o preço.
    assert.equal((await db.collection("billing_operational_snapshots").doc(ID_BTG).get()).get("mode"), "frozen");
    await db.collection("billing_price_list").doc("btg_3").update({ lpu_item_id: null });
    await ligar("btg_2", "lpu_entrada");
    await recusa(emitir({ competencia: SETEMBRO }), "failed-precondition", "PRICE_TABLE_AMBIGUOUS");
    assert.equal((await db.collection("billing_periods").doc(ID_BTG).get()).get("status"), "aberto");
  });

  it("o preço do item ligado não se muda no WMS", async () => {
    await ligar("btg_2", "lpu_entrada");
    const mudar = (valor: number, chave: string) =>
      chamar(wms.mutateManagedEntity, "fin", {
        resource: "billing_price_list",
        action: "update",
        id: "btg_2",
        idempotency_key: chave,
        data: { valor_unit: valor },
      });
    await recusa(mudar(2, "m-1"), "failed-precondition");
    assert.equal((await db.collection("billing_price_list").doc("btg_2").get()).get("valor_unit"), 1.25);
  });
});

