import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BILLING_AUTO_SOURCES,
  BillingDomainError,
  aggregateBillingMetrics,
  assertBillingStatus,
  assertBillingStatusTransition,
  assertCompetenciaCanBeOpen,
  buildInvoiceSnapshot,
  calculateBillingPeriod,
  calculateLpuLines,
  competenciaFromDate,
  createOpenBillingPeriod,
  emitInvoiceInTransaction,
  prepareInvoiceEmission,
  type BillingCalculationInput,
} from "./billing.js";

const NOW = new Date("2026-07-10T12:00:00.000Z");

function errorWithCode(code: string): (error: unknown) => boolean {
  return (error) => error instanceof BillingDomainError && error.code === code;
}

function calculationInput(): BillingCalculationInput {
  return {
    competencia: "2026-07",
    adValoremRate: "0.005",
    usage: {
      custo_estoque: 10_000,
      entradas_pecas: 10,
      saidas_pecas: 4,
      pallets: 3,
      transportes: 2,
      etiquetas: 7,
    },
    manualQuantities: [
      { price_list_id: 7, qtde: "2.5", observacao: "Servico avulso" },
    ],
    priceList: [
      {
        id: 7,
        grupo: "servicos",
        item: "Servico manual",
        valor_unit: "3.333",
        ordem: 7,
      },
      {
        id: 3,
        grupo: "expedicao",
        item: "Saida de pecas",
        valor_unit: "2.10",
        auto_source: BILLING_AUTO_SOURCES.outgoingPieces,
        ordem: 3,
      },
      {
        id: 1,
        grupo: "ad_valorem",
        item: "Ad valorem",
        valor_unit: 0,
        auto_source: BILLING_AUTO_SOURCES.adValorem,
        ordem: 1,
      },
      {
        id: 6,
        grupo: "servicos",
        item: "Etiquetagem",
        valor_unit: "0.30",
        auto_source: BILLING_AUTO_SOURCES.labels,
        ordem: 6,
      },
      {
        id: 4,
        grupo: "armazenamento",
        item: "Pallet",
        valor_unit: 15,
        auto_source: BILLING_AUTO_SOURCES.pallets,
        ordem: 4,
      },
      {
        id: 2,
        grupo: "recebimento",
        item: "Entrada de pecas",
        valor_unit: "1.25",
        auto_source: BILLING_AUTO_SOURCES.incomingPieces,
        ordem: 2,
      },
      {
        id: 5,
        grupo: "transporte",
        item: "Transporte",
        valor_unit: 100,
        auto_source: BILLING_AUTO_SOURCES.transport,
        ordem: 5,
      },
    ],
  };
}

describe("competencia e status", () => {
  it("usa o fuso de Sao Paulo e impede competencia futura em aberto", () => {
    const beforeMidnightInSaoPaulo = new Date("2026-08-01T02:30:00.000Z");
    assert.equal(competenciaFromDate(beforeMidnightInSaoPaulo), "2026-07");
    assert.doesNotThrow(() =>
      assertCompetenciaCanBeOpen("2026-07", beforeMidnightInSaoPaulo),
    );
    assert.throws(
      () => assertCompetenciaCanBeOpen("2026-08", beforeMidnightInSaoPaulo),
      errorWithCode("FUTURE_COMPETENCIA"),
    );
  });

  it("cria apenas periodo aberto atual ou passado", () => {
    const period = createOpenBillingPeriod("2026-07", {
      now: NOW,
      customerCode: "BTG Pactual",
    });
    assert.deepEqual(period, {
      competencia: "2026-07",
      status: "aberto",
      total_cents: 0,
      total: 0,
      opened_at: NOW.toISOString(),
      customer_code: "BTG Pactual",
    });
    assert.throws(
      () => createOpenBillingPeriod("2026-08", { now: NOW }),
      errorWithCode("FUTURE_COMPETENCIA"),
    );
  });

  it("aceita somente aberto -> emitido -> pago", () => {
    assert.doesNotThrow(() => assertBillingStatus("aberto"));
    assert.throws(
      () => assertBillingStatus("cancelado"),
      errorWithCode("INVALID_STATUS"),
    );
    assert.doesNotThrow(() =>
      assertBillingStatusTransition("aberto", "emitido", {
        competencia: "2026-07",
        now: NOW,
      }),
    );
    assert.doesNotThrow(() =>
      assertBillingStatusTransition("emitido", "pago", {
        competencia: "2026-07",
        now: NOW,
      }),
    );
    assert.throws(
      () =>
        assertBillingStatusTransition("pago", "aberto", {
          competencia: "2026-07",
          now: NOW,
        }),
      errorWithCode("INVALID_STATUS_TRANSITION"),
    );
  });
});

describe("calculo da LPU", () => {
  it("agrega fontes genericas por competencia sem depender da ordem", () => {
    assert.deepEqual(
      aggregateBillingMetrics("2026-07", [
        { competencia: "2026-07", source: "pallet", quantity: "1.5" },
        { competencia: "2026-06", source: "pallet", quantity: 99 },
        { competencia: "2026-07", source: "etiquetagem", quantity: 4 },
        { competencia: "2026-07", source: "pallet", quantity: "2.5" },
      ]),
      { etiquetagem: 4, pallet: 4 },
    );
  });

  it("calcula entradas, saidas, pallet, transporte, etiquetas e item manual", () => {
    const input = calculationInput();
    const originalOrder = input.priceList.map((item) => item.id);
    const result = calculateBillingPeriod(input);

    assert.deepEqual(
      result.linhas.map((line) => line.price_list_id),
      [1, 2, 3, 4, 5, 6, 7],
    );
    assert.deepEqual(
      result.linhas.map((line) => line.total),
      [50, 12.5, 8.4, 45, 200, 2.1, 8.33],
    );
    assert.equal(result.total_cents, 32_633);
    assert.equal(result.total, 326.33);
    assert.equal(
      result.grupos.reduce((total, group) => total + group.total_cents, 0),
      32_633,
    );
    assert.deepEqual(
      input.priceList.map((item) => item.id),
      originalOrder,
    );
  });

  it("soma centavos arredondados por linha para um total deterministico", () => {
    const lines = calculateLpuLines({
      competencia: "2026-07",
      manualQuantities: [
        { price_list_id: 1, qtde: 1 },
        { price_list_id: 2, qtde: 1 },
        { price_list_id: 3, qtde: 1 },
      ],
      priceList: [1, 2, 3].map((id) => ({
        id,
        grupo: "servicos",
        item: `Linha ${id}`,
        valor_unit: "0.335",
        ordem: id,
      })),
    });
    const result = calculateBillingPeriod({
      competencia: "2026-07",
      manualQuantities: lines.map((line) => ({
        price_list_id: line.price_list_id,
        qtde: 1,
      })),
      priceList: [1, 2, 3].map((id) => ({
        id,
        grupo: "servicos",
        item: `Linha ${id}`,
        valor_unit: "0.335",
        ordem: id,
      })),
    });

    assert.deepEqual(
      lines.map((line) => line.total_cents),
      [34, 34, 34],
    );
    assert.equal(result.total, 1.02);
  });

  it("aceita uma nova auto_source por metrics e rejeita ids manuais duplicados", () => {
    const customLines = calculateLpuLines({
      competencia: "2026-07",
      usage: { metrics: { seguro: 2 } },
      priceList: [
        {
          id: "seguro",
          grupo: "servicos",
          item: "Seguro",
          valor_unit: 12,
          auto_source: "seguro",
        },
      ],
    });
    assert.equal(customLines[0]?.total, 24);

    assert.throws(
      () =>
        calculateLpuLines({
          competencia: "2026-07",
          priceList: [{ id: 1, grupo: "x", item: "x", valor_unit: 1 }],
          manualQuantities: [
            { price_list_id: 1, qtde: 1 },
            { price_list_id: 1, qtde: 2 },
          ],
        }),
      errorWithCode("DUPLICATE_MANUAL_QUANTITY"),
    );
  });
});

describe("snapshot e emissao", () => {
  it("produz snapshot profundamente imutavel", () => {
    const input = calculationInput();
    const snapshot = buildInvoiceSnapshot(input, {
      issuedAt: NOW,
      emittedBy: "financeiro@example.com",
      customerCode: "BTG Pactual",
    });

    assert.equal(Object.isFrozen(snapshot), true);
    assert.equal(Object.isFrozen(snapshot.linhas), true);
    assert.equal(Object.isFrozen(snapshot.linhas[0]), true);
    assert.equal(Object.isFrozen(snapshot.grupos[0]?.itens), true);
    assert.equal(snapshot.total, 326.33);
    assert.throws(() => {
      (snapshot.linhas[0] as { total: number }).total = 0;
    }, TypeError);
  });

  it("nao recalcula uma fatura ja emitida", () => {
    const initial = prepareInvoiceEmission(
      { competencia: "2026-07", status: "aberto" },
      calculationInput(),
      { issuedAt: NOW, emittedBy: "financeiro@example.com" },
    );
    assert.equal(initial.idempotent, false);
    assert.equal(initial.periodUpdate?.status, "emitido");

    const changedInput = calculationInput();
    changedInput.priceList[0]!.valor_unit = 999_999;
    const repeated = prepareInvoiceEmission(
      initial.periodUpdate,
      changedInput,
      { issuedAt: new Date("2026-07-11T12:00:00.000Z") },
    );

    assert.equal(repeated.idempotent, true);
    assert.equal(repeated.periodUpdate, null);
    assert.equal(repeated.snapshot.total, 326.33);
    assert.notEqual(repeated.snapshot, initial.snapshot);
  });

  it("recusa snapshot preexistente em periodo ainda aberto", () => {
    assert.throws(
      () =>
        prepareInvoiceEmission(
          {
            competencia: "2026-07",
            status: "aberto",
            invoice_snapshot: { total: 1 },
          },
          calculationInput(),
          { issuedAt: NOW },
        ),
      errorWithCode("SNAPSHOT_ALREADY_EXISTS"),
    );
  });

  it("grava uma vez na transacao e a repeticao e somente leitura", async () => {
    let persisted: Record<string, unknown> = {
      competencia: "2026-07",
      status: "aberto",
    };
    let writes = 0;
    const periodRef = {};
    const transaction = {
      async get() {
        return { exists: true, data: () => persisted };
      },
      set(_ref: unknown, value: Readonly<Record<string, unknown>>) {
        writes += 1;
        persisted = { ...persisted, ...value };
        return this;
      },
    };

    const args = [
      transaction as unknown as Parameters<typeof emitInvoiceInTransaction>[0],
      periodRef as Parameters<typeof emitInvoiceInTransaction>[1],
      calculationInput(),
      { issuedAt: NOW },
    ] as const;
    const first = await emitInvoiceInTransaction(...args);
    const second = await emitInvoiceInTransaction(...args);

    assert.equal(writes, 1);
    assert.equal(first.total, 326.33);
    assert.equal(second.total, first.total);
    assert.equal(persisted.status, "emitido");
  });
});
