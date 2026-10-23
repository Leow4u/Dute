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
      for (const extra of [{ valor_cents: 100 }, { nf: "1234" }, { numero: "1234" }, { customer_name: "Itaú" }]) {
        assert.equal(FINANCEIRO_EVENT_PAYLOADS[type].safeParse({ ...EXEMPLOS[type], ...extra }).success, false, `${type} ${Object.keys(extra)[0]}`);
      }
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

  it("nenhum tipo contém as palavras do roteador de avisos do WMS", () => {
    const words = wmsNoticeWords();
    for (const expected of ["order", "invoice", "receb", "inventory", "billing"]) assert.ok(words.includes(expected), words.join(", "));
    for (const type of FINANCEIRO_EVENT_TYPES) {
      for (const word of words) assert.equal(type.toLowerCase().includes(word), false, `${type} ${word}`);
    }
  });
});
