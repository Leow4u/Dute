import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildRoutineSuggestion, nextRun, RoutineInputSchema, routinesRunInCore, scheduleOf } from "./domain/agent-routines.js";

// 2026-10-02 é sexta-feira. 11:00 UTC = 08:00 em São Paulo.
const friday0700 = new Date("2026-10-02T10:00:00Z");

describe("próxima execução da rotina (horário de São Paulo)", () => {
  it("todo dia: hoje se ainda não passou, senão amanhã", () => {
    const daily = scheduleOf({ frequency: "daily", time: "08:00" });
    assert.equal(nextRun(daily, friday0700).toISOString(), "2026-10-02T11:00:00.000Z");
    assert.equal(nextRun(daily, new Date("2026-10-02T11:00:00Z")).toISOString(), "2026-10-03T11:00:00.000Z");
  });

  it("dia útil pula o fim de semana", () => {
    const weekdays = scheduleOf({ frequency: "weekdays", time: "07:30" });
    assert.equal(nextRun(weekdays, new Date("2026-10-02T12:00:00Z")).toISOString(), "2026-10-05T10:30:00.000Z");
  });

  it("semanal nos dias escolhidos; noite de domingo em SP ainda é domingo", () => {
    const monday = scheduleOf({ frequency: "weekly", days: [1], time: "08:00" });
    assert.equal(nextRun(monday, friday0700).toISOString(), "2026-10-05T11:00:00.000Z");
    const sunday2300 = scheduleOf({ frequency: "weekly", days: [0], time: "23:00" });
    assert.equal(nextRun(sunday2300, friday0700).toISOString(), "2026-10-05T02:00:00.000Z");
  });

  it("mensal no dia escolhido", () => {
    const first = scheduleOf({ frequency: "monthly", day_of_month: 1, time: "09:00" });
    assert.equal(nextRun(first, friday0700).toISOString(), "2026-11-01T12:00:00.000Z");
  });
});

describe("entrada da rotina", () => {
  const base = { name: "Resumo", prompt: "Resumo da semana passada", time: "08:00" };
  it("aceita null nos opcionais, como o SDK do Firebase envia", () => {
    assert.equal(RoutineInputSchema.safeParse({ ...base, frequency: "daily", id: null, days: null, day_of_month: null, active: null, agent_message_id: null }).success, true);
  });
  it("semanal precisa de dia; mensal precisa do dia do mês; horário de 15 em 15", () => {
    assert.equal(RoutineInputSchema.safeParse({ ...base, frequency: "weekly", days: [] }).success, false);
    assert.equal(RoutineInputSchema.safeParse({ ...base, frequency: "monthly" }).success, false);
    assert.equal(RoutineInputSchema.safeParse({ ...base, frequency: "daily", time: "08:10" }).success, false);
  });
});

describe("sugestão de rotina no chat", () => {
  it("converte dias e arredonda o horário para 15 minutos", () => {
    const suggestion = buildRoutineSuggestion({ nome: "Resumo da semana", pergunta: "Resumo da semana passada", frequencia: "semanal", dias: ["Segunda", "sex"], horario: "8:07" });
    assert.deepEqual(
      { tipo: suggestion.tipo, frequency: suggestion.frequency, days: suggestion.days, time: suggestion.time },
      { tipo: "rotina", frequency: "weekly", days: [1, 5], time: "08:00" },
    );
    assert.match(suggestion.instrucao, /Criar rotina/);
  });
  it("semanal sem dia vira segunda; mensal limita a 28", () => {
    assert.deepEqual(buildRoutineSuggestion({ nome: "x", pergunta: "y", frequencia: "semanal" }).days, [1]);
    assert.equal(buildRoutineSuggestion({ nome: "x", pergunta: "y", frequencia: "mensal", dia_do_mes: 31 }).day_of_month, 28);
  });
});

describe("quem roda as rotinas agendadas", () => {
  it("onde o agente do núcleo está liberado, o WMS não roda; na produção, roda", () => {
    assert.equal(routinesRunInCore("dute-homolog"), true);
    assert.equal(routinesRunInCore("dute-prod"), false);
    assert.equal(routinesRunInCore("dute-btg"), false);
    assert.equal(routinesRunInCore(undefined), false);
  });
});
