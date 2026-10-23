import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  BILLING_PERIODS_COLLECTION,
  CLIENT_INVOICES_COLLECTION,
  LEGACY_BILLING_CUSTOMER,
  PERIODO_ID,
  armazenagemNaFatura,
  billingDocumentId,
  idsDoPortal,
  periodoLido,
  problemaDaArmazenagem,
  problemaDoPeriodoNaFatura,
} from "./armazenagem.js";

/**
 * A armazenagem na NF (parte 7.2a): a competência emitida no WMS, pelo total
 * congelado na emissão. Dados sintéticos.
 */

const wms = (caminho: string) => readFileSync(fileURLToPath(new URL(`../../../wms/src/${caminho}`, import.meta.url)), "utf8");

const EMITIDA = {
  customer_code: "BTG Pactual",
  competencia: "2026-09",
  status: "emitido",
  total_cents: 7508,
  invoice_snapshot: { competencia: "2026-09", status: "emitido", total_cents: 7508, total: 75.08 },
};

describe("a competência do WMS", () => {
  it("as cópias do WMS são literais: as coleções, o cliente do id antigo e o formato do id", () => {
    assert.match(wms("index.ts"), new RegExp(`\\n  periods: "${BILLING_PERIODS_COLLECTION}",\\n`));
    assert.match(wms("index.ts"), new RegExp(`\\n  clientInvoices: "${CLIENT_INVOICES_COLLECTION}",\\n`));
    assert.match(wms("domain/billing-scope.ts"), new RegExp(`export const LEGACY_BILLING_CUSTOMER = "${LEGACY_BILLING_CUSTOMER}";`));
    assert.match(wms("domain/billing-scope.ts"), /return `\$\{customer\}__\$\{competencia\}`;/);
    assert.match(wms("domain/billing-scope.ts"), /replace\(\/\[\^\\w\.-\]\/g, "_"\)\.slice\(0, 200\)/);
  });

  it("o id do portal é o do WMS: o novo e, só na BTG, o antigo", () => {
    assert.equal(billingDocumentId(" Banco Safra ", "2026-09"), "Banco_Safra__2026-09");
    assert.equal(billingDocumentId("ITAÚ/SP", "2026-09"), "ITA__SP__2026-09");
    assert.deepEqual(idsDoPortal("BTG Pactual", "2026-09"), ["BTG_Pactual__2026-09", "2026-09"]);
    assert.deepEqual(idsDoPortal("Banco Safra", "2026-09"), ["Banco_Safra__2026-09"]);
  });

  it("aceita o id novo e o antigo, e nada mais", () => {
    for (const id of ["BTG_Pactual__2026-09", "Banco_Safra__2026-12", "2026-08"]) assert.match(id, PERIODO_ID, id);
    for (const id of ["BTG Pactual__2026-09", "BTG_Pactual__2026-13", "2026-9", "../2026-09", "BTG_Pactual_2026-09x"]) assert.doesNotMatch(id, PERIODO_ID, id);
  });

  it("lê o cliente, o mês, o status, o total da foto e a NF", () => {
    assert.deepEqual(periodoLido("BTG_Pactual__2026-09", EMITIDA), {
      id: "BTG_Pactual__2026-09",
      customer_code: "BTG Pactual",
      competencia: "2026-09",
      status: "emitido",
      valor_cents: 7508,
      fatura_id: null,
    });
    // O id antigo é só da BTG, que nem sempre gravou o cliente.
    const antiga = periodoLido("2026-08", { status: "emitido", invoice_snapshot: { total_cents: 1234 } });
    assert.deepEqual([antiga.customer_code, antiga.competencia, antiga.valor_cents], ["BTG Pactual", "2026-08", 1234]);
    assert.equal(periodoLido("Banco_Safra__2026-09", { status: "emitido" }).customer_code, "");
    assert.equal(periodoLido("BTG_Pactual__2026-09", { ...EMITIDA, faturamento: { fatura_id: "fat_1" } }).fatura_id, "fat_1");
  });

  it("o total é o da foto, nunca o do período nem o recalculado", () => {
    assert.equal(periodoLido("BTG_Pactual__2026-09", { ...EMITIDA, total_cents: 99, invoice_snapshot: undefined }).valor_cents, null);
    assert.equal(periodoLido("BTG_Pactual__2026-09", { ...EMITIDA, invoice_snapshot: { total_cents: 75.08 } }).valor_cents, null);
    assert.deepEqual(armazenagemNaFatura(periodoLido("BTG_Pactual__2026-09", EMITIDA)), {
      periodo_id: "BTG_Pactual__2026-09",
      competencia: "2026-09",
      valor_cents: 7508,
    });
  });

  it("só a emitida, com a foto, com cliente e fora de NF entra", () => {
    const lido = (extra: Record<string, unknown>, id = "BTG_Pactual__2026-09") => problemaDaArmazenagem(periodoLido(id, { ...EMITIDA, ...extra }));
    assert.equal(lido({}), null);
    assert.equal(lido({ status: "aberto" }), "A armazenagem de 09/2026 ainda não foi emitida no WMS.");
    assert.equal(lido({ status: "pago" }), "A armazenagem de 09/2026 já está paga no WMS.");
    assert.equal(lido({ faturamento: { fatura_id: "fat_1" } }), "A armazenagem de 09/2026 já está numa NF.");
    assert.equal(lido({ invoice_snapshot: null }), "A armazenagem de 09/2026 não tem o total congelado da emissão.");
    assert.equal(lido({ customer_code: "" }, "Banco_Safra__2026-09"), "A armazenagem de 09/2026 não tem cliente.");
  });

  it("na cobrança, a competência tem de estar nesta NF e no status que a ação pede", () => {
    const naNf = { ...EMITIDA, faturamento: { fatura_id: "fat_1" } };
    assert.equal(problemaDoPeriodoNaFatura("BTG_Pactual__2026-09", naNf, "fat_1", "emitido"), null);
    assert.equal(problemaDoPeriodoNaFatura("BTG_Pactual__2026-09", { ...naNf, status: "pago" }, "fat_1", "pago"), null);
    assert.equal(problemaDoPeriodoNaFatura("BTG_Pactual__2026-09", { ...naNf, status: "pago" }, "fat_1", "emitido"), "A armazenagem de 09/2026 não está emitida no WMS.");
    assert.equal(problemaDoPeriodoNaFatura("BTG_Pactual__2026-09", naNf, "fat_1", "pago"), "A armazenagem de 09/2026 não está paga no WMS.");
    assert.equal(problemaDoPeriodoNaFatura("BTG_Pactual__2026-09", { ...EMITIDA, faturamento: { fatura_id: "fat_2" } }, "fat_1", "emitido"), "A armazenagem de 09/2026 não está nesta NF.");
    assert.equal(problemaDoPeriodoNaFatura("BTG_Pactual__2026-09", null, "fat_1", "emitido"), "A competência de armazenagem BTG_Pactual__2026-09 não foi encontrada.");
  });
});
