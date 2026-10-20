import { describe, expect, it } from "vitest";

import { formatMoney, problemList, roleLabel, routineSchedule, type SystemDashboard } from "./system-dashboard";

describe("painel do sistema na tela", () => {
  it("textos de dinheiro, perfil e agenda", () => {
    expect(formatMoney(3.8)).toBe("R$ 3,80");
    expect(roleLabel("interno")).toBe("Coordenação");
    expect(roleLabel("novo")).toBe("novo");
    expect(routineSchedule({ frequency: "weekly", days: [1], day_of_month: null, time: "10:00" })).toBe("Toda segunda · 10:00");
  });

  it("junta falhas do Agent Dute e das rotinas, da mais recente para a mais antiga", () => {
    const dashboard = {
      usage: {
        problems: [
          { kind: "chat", outcome: "fallback", at: "2026-10-03T11:12:00Z", error: "503" },
          { kind: "chat", outcome: "failed", at: "2026-10-03T09:00:00Z", error: "os dois" },
        ],
      },
      routines: { problems: [{ name: "Abaixo do mínimo", at: "2026-10-03T10:45:00Z", error: "modelo indisponível" }] },
    } as unknown as SystemDashboard;
    expect(problemList(dashboard).map((problem) => [problem.tag, problem.tone, problem.text])).toEqual([
      ["Agent Dute", "warn", "Respondeu pelo modelo reserva (o principal falhou)"],
      ["Rotina", "bad", '"Abaixo do mínimo" não rodou'],
      ["Agent Dute", "bad", "Não respondeu: o modelo principal e o reserva falharam"],
    ]);
  });
});
