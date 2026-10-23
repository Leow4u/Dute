import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import {
  OPERACAO_EVENT_PAYLOADS,
  OPERACAO_EVENT_SOURCE,
  OPERACAO_EVENT_TYPES,
  buildOperacaoEvent,
  type OperacaoEventType,
} from "./events.js";

/**
 * O evento do cadastro não carrega a pessoa nem o veículo: quem lê `events`
 * inclui wms e suporte, e o roteador de avisos do WMS não pode transformar
 * o tipo em aviso ao cliente.
 */

const EXEMPLOS: Record<OperacaoEventType, Record<string, unknown>> = {
  "collaborator.created": { id: "col_aaaaaaaaaaaaaaaa" },
  "collaborator.updated": { id: "col_aaaaaaaaaaaaaaaa", edicao_antes: 1, edicao_depois: 2 },
  "collaborator.deactivated": { id: "col_aaaaaaaaaaaaaaaa" },
  "collaborator.reactivated": { id: "col_aaaaaaaaaaaaaaaa" },
  "vehicle.created": { id: "vei_aaaaaaaaaaaaaaaa" },
  "vehicle.updated": { id: "vei_aaaaaaaaaaaaaaaa", edicao_antes: 2, edicao_depois: 3 },
  "vehicle.deactivated": { id: "vei_aaaaaaaaaaaaaaaa" },
  "vehicle.reactivated": { id: "vei_aaaaaaaaaaaaaaaa" },
  "os.created": { id: "10045-01", demanda: "10045", seq: 1, linhas: 2 },
  "os.planned": {
    id: "10045-02",
    demanda: "10045",
    seq: 2,
    linhas: 3,
    data: null,
    equipe: [{ colaborador_id: "col_aaaaaaaaaaaaaaaa", papel: "lider", vinculo: "proprio" }],
    veiculos: [],
  },
  "os.scheduled": {
    id: "10045-01",
    demanda: "10045",
    data: "2026-10-22",
    inicio: "07:30",
    fim: "18:00",
    equipe: [
      { colaborador_id: "col_aaaaaaaaaaaaaaaa", papel: "motorista", vinculo: "proprio" },
      { colaborador_id: "col_bbbbbbbbbbbbbbbb", papel: null, vinculo: "terceiro" },
    ],
    veiculos: ["vei_aaaaaaaaaaaaaaaa"],
  },
  "os.items_changed": { id: "10045-01", demanda: "10045", linhas: 2, edicao_antes: 2, edicao_depois: 3 },
  "os.cancelled": { id: "10045-01", demanda: "10045" },
  "demand.direct_opened": { id: "10053", tipo: "paraquedas", tipo_calculado: "emergencial", linhas: 1 },
};

function wmsNoticeWords(): string[] {
  const source = readFileSync(fileURLToPath(new URL("../../../wms/src/index.ts", import.meta.url)), "utf8");
  const body = source.match(/function notificationKindForEvent\([^)]*\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(body, "notificationKindForEvent não encontrado em functions/wms/src/index.ts");
  return [...body[1].matchAll(/\.includes\("([^"]+)"\)/g)].map((match) => match[1].toLowerCase());
}

describe("eventos do cadastro da Operação", () => {
  it("todo tipo tem payload strict e o exemplo passa", () => {
    assert.deepEqual([...OPERACAO_EVENT_TYPES].sort(), Object.keys(EXEMPLOS).sort());
    for (const type of OPERACAO_EVENT_TYPES) {
      const schema = OPERACAO_EVENT_PAYLOADS[type] as z.ZodTypeAny;
      assert.ok(schema instanceof z.ZodObject, type);
      const parsed = OPERACAO_EVENT_PAYLOADS[type].safeParse(EXEMPLOS[type]);
      assert.equal(parsed.success, true, type);
      assert.equal(OPERACAO_EVENT_PAYLOADS[type].safeParse({ ...EXEMPLOS[type], cpf: "52998224725" }).success, false, type);
      assert.equal(OPERACAO_EVENT_PAYLOADS[type].safeParse({ ...EXEMPLOS[type], nome: "Ana Souza" }).success, false, type);
      assert.equal(OPERACAO_EVENT_PAYLOADS[type].safeParse({ ...EXEMPLOS[type], placa: "ABC1D23" }).success, false, type);
    }
  });

  it("título e descrição são fixos, sem nome, documento ou valor", () => {
    for (const type of OPERACAO_EVENT_TYPES) {
      const event = buildOperacaoEvent({
        operation_id: "op_teste",
        type,
        entity_id: EXEMPLOS[type].id as string,
        payload: EXEMPLOS[type] as never,
        actor: { uid: "u1", role: "interno", name: "Leonardo", email: "leonardo@dutelog.com.br" },
        customer_code: type.startsWith("os.") || type.startsWith("demand.") ? "ITAU" : null,
        occurred_at: "2026-10-22T03:00:00.000Z",
      });
      assert.equal(event.source, OPERACAO_EVENT_SOURCE);
      assert.equal(event.customer_code, type.startsWith("os.") || type.startsWith("demand.") ? "ITAU" : null);
      assert.equal(event.severity, "info");
      for (const text of [event.title, event.description, JSON.stringify(event.payload)]) {
        assert.equal(text.includes("Ana"), false, text);
        assert.equal(text.includes("529"), false, text);
        assert.equal(text.includes("ABC"), false, text);
        assert.equal(/R\$/.test(text), false, text);
      }
    }
  });

  it("nenhum tipo contém as palavras do roteador de avisos do WMS", () => {
    const words = wmsNoticeWords();
    for (const expected of ["order", "invoice", "receb", "inventory", "billing"]) {
      assert.ok(words.includes(expected), words.join(", "));
    }
    for (const type of OPERACAO_EVENT_TYPES) {
      for (const word of words) assert.equal(type.toLowerCase().includes(word), false, `${type} ${word}`);
    }
  });
});
