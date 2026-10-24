import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { FINANCEIRO_EVENT_PAYLOADS, FINANCEIRO_EVENT_SOURCE, FINANCEIRO_EVENT_TYPES, buildFinanceiroEvent, type FinanceiroEventType } from "./events.js";

/**
 * O evento do Financeiro não leva valor nem o número da NF: interno, wms e
 * suporte leem `events`, e o roteador de avisos do WMS não pode transformar o
 * tipo em aviso ao cliente.
 */

const EXEMPLOS: Record<FinanceiroEventType, Record<string, unknown>> = {
  "nf.registered": { id: "fat_0123456789abcdef01234567", demandas: ["10045"], autorizacoes: 1, emitida_em: "2026-10-23", vencimento: "2026-11-20", forma: "boleto" },
  "nf.sent": { id: "fat_0123456789abcdef01234567", enviada_em: "2026-10-23", meio: "email" },
  "nf.cancelled": { id: "fat_0123456789abcdef01234567", demandas: ["10045"] },
  "cobranca.payment_registered": { id: "fat_0123456789abcdef01234567", pagamento_id: "pag_0123456789abcdef01234567", recebido_em: "2026-10-23", forma: "pix", quitada: false },
  "cobranca.payment_reversed": { id: "fat_0123456789abcdef01234567", pagamento_id: "pag_0123456789abcdef01234567", reaberta: true },
  "nf.emission_requested": { id: "nfe_0123456789abcdef0123", demandas: ["10045"], competencias: ["2026-09"], vencimento: "2026-11-20", forma: "boleto" },
  "nf.emission_resumed": { id: "nfe_0123456789abcdef0123", etapa_antes: "parada", etapa_depois: "na_fila" },
  "nf.emission_abandoned": { id: "nfe_0123456789abcdef0123", demandas: ["10045"], competencias: [], cancela_na_omie: true },
  "nf.emission_authorized": { id: "nfe_0123456789abcdef0123", fatura_id: "fat_0123456789abcdef01234567" },
  "nf.emission_rejected": { id: "nfe_0123456789abcdef0123" },
  "nf.emission_stopped": { id: "nfe_0123456789abcdef0123", motivo: "ambiente_errado" },
  "nf.emission_released": { id: "nfe_0123456789abcdef0123", demandas: ["10045"], competencias: ["2026-09"] },
};

function wmsNoticeWords(): string[] {
  const source = readFileSync(fileURLToPath(new URL("../../../wms/src/index.ts", import.meta.url)), "utf8");
  const body = source.match(/function notificationKindForEvent\([^)]*\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(body, "notificationKindForEvent não encontrado em functions/wms/src/index.ts");
  return [...body[1].matchAll(/\.includes\("([^"]+)"\)/g)].map((match) => match[1].toLowerCase());
}

describe("eventos do Financeiro", () => {
  it("todo tipo tem payload strict, sem valor nem número da NF", () => {
    assert.deepEqual([...FINANCEIRO_EVENT_TYPES].sort(), Object.keys(EXEMPLOS).sort());
    for (const type of FINANCEIRO_EVENT_TYPES) {
      const schema = FINANCEIRO_EVENT_PAYLOADS[type] as z.ZodTypeAny;
      assert.ok(schema instanceof z.ZodObject, type);
      assert.equal(FINANCEIRO_EVENT_PAYLOADS[type].safeParse(EXEMPLOS[type]).success, true, type);
      for (const extra of [{ valor_cents: 100 }, { nf: "1234" }, { numero: "1234" }, { customer_name: "Itaú" }, { motivo: "Valor de R$ 100,00 errado" }, { saldo_cents: 1 }]) {
        assert.equal(FINANCEIRO_EVENT_PAYLOADS[type].safeParse({ ...EXEMPLOS[type], ...extra }).success, false, `${type} ${Object.keys(extra)[0]}`);
      }
    }
  });

  it("a NF registrada e a cancelada levam as competências de armazenagem, só o mês (parte 7.2a)", () => {
    for (const type of ["nf.registered", "nf.cancelled"] as const) {
      const schema = FINANCEIRO_EVENT_PAYLOADS[type];
      assert.equal(schema.safeParse({ ...EXEMPLOS[type], demandas: [], competencias: ["2026-09"] }).success, true, type);
      assert.equal(schema.safeParse({ ...EXEMPLOS[type], competencias: ["BTG_Pactual__2026-09"] }).success, false, type);
      assert.equal(schema.safeParse({ ...EXEMPLOS[type], competencias: ["2026-13"] }).success, false, type);
    }
  });

  it("título e descrição fixos; o evento é da fatura, com o cliente", () => {
    const event = buildFinanceiroEvent({
      operation_id: "op_teste",
      type: "nf.registered",
      entity_id: EXEMPLOS["nf.registered"].id as string,
      payload: EXEMPLOS["nf.registered"] as never,
      actor: { uid: "fin-1", role: "financeiro", name: "Carla" },
      customer_code: "ITAU",
      occurred_at: "2026-10-23T15:00:00.000Z",
    });
    assert.deepEqual([event.source, event.entity_type, event.customer_code, event.severity], [FINANCEIRO_EVENT_SOURCE, "fatura", "ITAU", "info"]);
    assert.doesNotMatch(`${event.title} ${event.description} ${JSON.stringify(event.payload)}`, /R\$|\d+,\d{2}|valor|cents/);
  });

  it("o evento da emissão pela Omie é da emissão, com o cliente (parte 7.4c)", () => {
    const event = buildFinanceiroEvent({
      operation_id: "op_teste",
      type: "nf.emission_requested",
      entity_id: "nfe_0123456789abcdef0123",
      payload: EXEMPLOS["nf.emission_requested"] as never,
      actor: { uid: "fin-1", role: "financeiro", name: "Carla" },
      customer_code: "ITAU",
      occurred_at: "2026-10-24T15:00:00.000Z",
    });
    assert.deepEqual([event.entity_type, event.entity_id, event.customer_code], ["nf_emissao", "nfe_0123456789abcdef0123", "ITAU"]);
    assert.equal(FINANCEIRO_EVENT_PAYLOADS["nf.emission_requested"].safeParse({ ...EXEMPLOS["nf.emission_requested"], cnpj: "11222333000181" }).success, false);
    assert.equal(FINANCEIRO_EVENT_PAYLOADS["nf.emission_resumed"].safeParse({ ...EXEMPLOS["nf.emission_resumed"], etapa_antes: "autorizada" }).success, false);
  });

  it("nenhum tipo contém as palavras do roteador de avisos do WMS", () => {
    const words = wmsNoticeWords();
    for (const expected of ["order", "invoice", "receb", "inventory", "billing"]) assert.ok(words.includes(expected), words.join(", "));
    for (const type of FINANCEIRO_EVENT_TYPES) {
      for (const word of words) assert.equal(type.toLowerCase().includes(word), false, `${type} ${word}`);
    }
  });
});
