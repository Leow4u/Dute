import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CostSettingsSchema, costOf, summarizeUsage, usageKind, usageOutcome, type UsageRow } from "./domain/system-dashboard.js";

const settings = { input_per_million: 2, output_per_million: 10, monthly_budget: 50 };
// 2026-10-03 12:00 em São Paulo (15:00 UTC): 2,5 dias do mês já passaram.
const now = new Date("2026-10-03T15:00:00Z");

function row(patch: Partial<UsageRow>): UsageRow {
  return { created_at_iso: "2026-10-03T13:00:00Z", source: "genkit_gemini-3.5-flash", role: "cliente", model: "gemini-3.5-flash", input_tokens: 1_000_000, output_tokens: 100_000, latency_ms: 4000, error: null, ...patch };
}

describe("painel do sistema: custo e uso do Agent Dute", () => {
  it("separa chat, rotinas e leitura de NF; sem resposta, reserva e normal", () => {
    assert.equal(usageKind("rotina"), "rotinas");
    assert.equal(usageKind("leitura_nota_chat"), "leitura_nota");
    assert.equal(usageKind("genkit_gemini-3.5-flash"), "chat");
    assert.equal(usageOutcome(row({ source: "fallback_indisponivel", error: "x" })), "failed");
    assert.equal(usageOutcome(row({ error: "gemini-3.5-flash: 503" })), "fallback");
    assert.equal(usageOutcome(row({})), "ok");
    assert.equal(costOf({ input_tokens: 1_000_000, output_tokens: 100_000 }, settings), 3);
  });

  it("mês, projeção, orçamento, perfis e o que deu errado", () => {
    const rows = [
      row({}),
      row({ source: "rotina", role: "owner" }),
      row({ source: "leitura_nota", input_tokens: 500_000, output_tokens: 0 }),
      row({ created_at_iso: "2026-10-03T14:00:00Z", error: "gemini-3.5-flash: 503" }),
      row({ created_at_iso: "2026-10-03T14:30:00Z", source: "fallback_indisponivel", input_tokens: 0, output_tokens: 0, latency_ms: null, error: "os dois falharam" }),
      // setembro: entra nos 14 dias e na semana, não no mês
      row({ created_at_iso: "2026-09-30T13:00:00Z", role: "financeiro" }),
    ];
    const summary = summarizeUsage(rows, settings, now);
    assert.equal(summary.priced, true);
    assert.deepEqual(summary.month.by_kind, { chat: 6, rotinas: 3, leitura_nota: 1 });
    assert.equal(summary.month.cost, 10);
    // R$ 10 em 2,5 dias × 31 dias
    assert.equal(summary.month.projection, 124);
    assert.equal(summary.month.over_budget, true);
    assert.equal(summary.days.length, 14);
    assert.equal(summary.days.at(-1)!.day, "2026-10-03");
    assert.equal(summary.days.at(-1)!.count, 5);
    assert.deepEqual(summary.today, { count: 5, fallback: 1, failed: 1 });
    assert.deepEqual(
      summary.week.by_role.map((entry) => [entry.role, entry.count]),
      [["cliente", 4], ["owner", 1], ["financeiro", 1]],
    );
    assert.equal(summary.week.avg_latency_ms, 4000);
    assert.deepEqual(summary.problems.map((problem) => problem.outcome), ["failed", "fallback"]);
  });

  it("sem preço informado o custo fica zerado e o painel avisa", () => {
    const summary = summarizeUsage([row({})], { input_per_million: 0, output_per_million: 0, monthly_budget: null }, now);
    assert.equal(summary.priced, false);
    assert.equal(summary.month.cost, 0);
    assert.equal(summary.month.over_budget, false);
  });

  it("preços e orçamento aceitam null no orçamento, como o SDK envia", () => {
    assert.equal(CostSettingsSchema.safeParse({ input_per_million: 1.5, output_per_million: 12, monthly_budget: null }).success, true);
    assert.equal(CostSettingsSchema.safeParse({ input_per_million: -1, output_per_million: 12 }).success, false);
  });
});
