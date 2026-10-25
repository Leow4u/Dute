import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BILLING_AUTO_SOURCES,
  BillingDomainError,
  aggregateBillingMetrics,
  assertBillingStatus,
  assertBillingStatusTransition,
  assertCompetenciaCanBeOpen,
  assertCompetenciaClosed,
  billingCustomerOf,
  competenciaOfInstant,
  emissionAvailableFrom,
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
// Emitir julho exige o mês fechado: a partir de 01/08 no horário de Brasília.
const AFTER_CLOSE = new Date("2026-08-01T12:00:00.000Z");

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
      issuedAt: AFTER_CLOSE,
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
      { issuedAt: AFTER_CLOSE, emittedBy: "financeiro@example.com" },
    );
    assert.equal(initial.idempotent, false);
    assert.equal(initial.periodUpdate?.status, "emitido");

    const changedInput = calculationInput();
    changedInput.priceList[0]!.valor_unit = 999_999;
    const repeated = prepareInvoiceEmission(
      initial.periodUpdate,
      changedInput,
      { issuedAt: new Date("2026-08-02T12:00:00.000Z") },
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
          { issuedAt: AFTER_CLOSE },
        ),
      errorWithCode("SNAPSHOT_ALREADY_EXISTS"),
    );
  });

  it("recusa emitir com a quantidade salva de um item que saiu da tabela", () => {
    const emitir = (input: BillingCalculationInput) =>
      prepareInvoiceEmission({ competencia: "2026-07", status: "aberto" }, input, { issuedAt: AFTER_CLOSE });
    const arquivado = {
      ...calculationInput(),
      priceList: calculationInput().priceList.map((item) => (item.id === 7 ? { ...item, ativo: false } : item)),
    };
    assert.throws(
      () => emitir(arquivado),
      (error) =>
        error instanceof BillingDomainError &&
        error.code === "MANUAL_ITEM_NOT_BILLED" &&
        error.message ===
          "A quantidade salva de Servico manual não entra na fatura: o item saiu da Tabela de preços. Salve as quantidades de novo ou reative o item.",
    );
    const apagado = {
      ...calculationInput(),
      priceList: calculationInput().priceList.filter((item) => item.id !== 7),
    };
    assert.throws(() => emitir(apagado), errorWithCode("MANUAL_ITEM_NOT_BILLED"));
    // Zerada, a quantidade não cobra nada, e a emissão segue sem a linha.
    const zerada = { ...arquivado, manualQuantities: [{ price_list_id: 7, qtde: "0", observacao: null }] };
    assert.equal(emitir(zerada).snapshot.linhas.some((linha) => linha.price_list_id === 7), false);
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
      { issuedAt: AFTER_CLOSE },
    ] as const;
    const first = await emitInvoiceInTransaction(...args);
    const second = await emitInvoiceInTransaction(...args);

    assert.equal(writes, 1);
    assert.equal(first.total, 326.33);
    assert.equal(second.total, first.total);
    assert.equal(persisted.status, "emitido");
  });
});

describe("regras de competência", () => {
  it("só emite depois que o mês fecha no horário de Brasília", () => {
    // 31/07 23:30 em Brasília = 01/08 02:30 UTC: julho ainda não fechou.
    assert.throws(
      () => assertCompetenciaClosed("2026-07", new Date("2026-08-01T02:30:00.000Z")),
      errorWithCode("COMPETENCIA_NOT_CLOSED"),
    );
    assert.throws(
      () => assertCompetenciaClosed("2026-07", NOW),
      errorWithCode("COMPETENCIA_NOT_CLOSED"),
    );
    // 01/08 00:00 em Brasília.
    assertCompetenciaClosed("2026-07", new Date("2026-08-01T03:00:00.000Z"));
    assert.equal(emissionAvailableFrom("2026-12"), "2027-01-01");
  });

  it("recusa emitir o mês corrente", () => {
    assert.throws(
      () =>
        prepareInvoiceEmission(
          { competencia: "2026-07", status: "aberto" },
          calculationInput(),
          { issuedAt: NOW },
        ),
      errorWithCode("COMPETENCIA_NOT_CLOSED"),
    );
  });

  it("classifica o instante pela data de Brasília, não UTC", () => {
    // 30/09 22:00 em Brasília é setembro, embora em UTC já seja outubro.
    assert.equal(competenciaOfInstant("2026-10-01T01:00:00.000Z"), "2026-09");
    assert.equal(competenciaOfInstant("2026-10-01T03:00:00.000Z"), "2026-10");
    assert.equal(competenciaOfInstant("2026-09-30T22:00:00-03:00"), "2026-09");
    // Sem fuso (legado) vale a data escrita.
    assert.equal(competenciaOfInstant("2026-09-30"), "2026-09");
    assert.equal(competenciaOfInstant("2026-10-01T00:30:00"), "2026-10");
    assert.equal(competenciaOfInstant(""), null);
    assert.equal(competenciaOfInstant("ontem"), null);
  });

  it("item da tabela sem cliente pertence ao cliente padrão", () => {
    assert.equal(billingCustomerOf(undefined, "BTG Pactual"), "BTG Pactual");
    assert.equal(billingCustomerOf("  ", "BTG Pactual"), "BTG Pactual");
    assert.equal(billingCustomerOf("Outro", "BTG Pactual"), "Outro");
  });
});
