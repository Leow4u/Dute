import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { perguntaDaRotina } from "./agente-conversa.js";
import { agendaDe, proximaVez, saveDuteRoutineFor } from "./agente-rotinas.js";
import { bancoFalso } from "./agente-banco-falso.test.js";
import type { CoreProfile } from "./profile.js";

/**
 * As rotinas do Agent Dute no núcleo (parte 5.5g): a agenda é a do WMS
 * (functions/wms/src/domain/agent-routines.ts, nextRun), no horário de São
 * Paulo, e a entrada recusa o que a tela não manda. Os mesmos casos do teste
 * do WMS (agent-routines.test.ts).
 */

// 2026-10-02 é sexta-feira. 11:00 UTC = 08:00 em São Paulo.
const sexta0700 = new Date("2026-10-02T10:00:00Z");

describe("a próxima vez da rotina (horário de São Paulo)", () => {
  it("todo dia: hoje se ainda não passou, senão amanhã", () => {
    const diaria = agendaDe({ frequency: "daily", time: "08:00" });
    assert.equal(proximaVez(diaria, sexta0700).toISOString(), "2026-10-02T11:00:00.000Z");
    assert.equal(proximaVez(diaria, new Date("2026-10-02T11:00:00Z")).toISOString(), "2026-10-03T11:00:00.000Z");
  });

  it("dia útil pula o fim de semana", () => {
    const util = agendaDe({ frequency: "weekdays", time: "07:30" });
    assert.equal(proximaVez(util, new Date("2026-10-02T12:00:00Z")).toISOString(), "2026-10-05T10:30:00.000Z");
  });

  it("semanal nos dias escolhidos; noite de domingo em SP ainda é domingo", () => {
    const semanal = agendaDe({ frequency: "weekly", days: [3, 1, 1], time: "22:45" });
    assert.deepEqual(semanal.days, [1, 3]);
    // Domingo 04/10 às 22:00 em SP é segunda 01:00 UTC; a próxima é segunda 22:45 em SP.
    assert.equal(proximaVez(semanal, new Date("2026-10-05T01:00:00Z")).toISOString(), "2026-10-06T01:45:00.000Z");
  });

  it("mensal no dia escolhido; a agenda guarda só o que vale para a frequência", () => {
    const mensal = agendaDe({ frequency: "monthly", days: [1], day_of_month: 5, time: "09:00" });
    assert.deepEqual(mensal, { frequency: "monthly", days: [], day_of_month: 5, time: "09:00" });
    assert.equal(proximaVez(mensal, sexta0700).toISOString(), "2026-10-05T12:00:00.000Z");
    assert.equal(proximaVez(mensal, new Date("2026-10-05T12:00:00Z")).toISOString(), "2026-11-05T12:00:00.000Z");
  });
});

describe("a pergunta da rotina ao modelo", () => {
  it("leva o texto, o nome e o dia, e pede resposta direta", () => {
    const pergunta = perguntaDaRotina({ nome: "Saldo da semana" }, "Quanto tenho de polo M?", new Date("2026-10-05T11:00:00Z"));
    assert.match(pergunta, /^Quanto tenho de polo M\?\n\n\(Rotina agendada "Saldo da semana", segunda-feira, 05\/10\/2026\./);
    assert.match(pergunta, /ninguém está esperando na conversa agora\.\)$/);
  });
});

describe("a entrada da rotina", () => {
  const cliente: CoreProfile = { uid: "cli-itau", role: "cliente", customerCode: "ITAU" };
  // A entrada recusa antes de ler o escopo; o banco falso está vazio e recusa gravação.
  const { db } = bancoFalso({});
  const base = { modulo: "wms", name: "Saldo", prompt: "Quanto tenho de polo M?", frequency: "daily", time: "08:00" };

  async function recusa(dados: Record<string, unknown>, mensagem: RegExp) {
    await assert.rejects(saveDuteRoutineFor(db, cliente, dados), (erro: Error & { code?: string }) => erro.code === "invalid-argument" && mensagem.test(erro.message));
  }

  it("horário de 15 em 15; semanal pede dia; mensal pede o dia do mês", async () => {
    await recusa({ ...base, time: "08:10" }, /15 em 15 minutos/);
    await recusa({ ...base, frequency: "weekly", days: [] }, /dia da semana/);
    await recusa({ ...base, frequency: "monthly" }, /dia do mês/);
  });

  it("recusa campo a mais, id fora do formato e o cartão com id de rotina existente", async () => {
    await recusa({ ...base, user_id: "outra" }, /./);
    await recusa({ ...base, id: "rot_../../x" }, /Rotina inválida/);
    await recusa({ ...base, id: "rot_0123456789abcdef0123", agent_message_id: "msg_agent_1" }, /cartão cria uma rotina nova/);
  });
});
