import { describe, expect, it } from "vitest";

import {
  ROUTINE_TEMPLATES,
  routineHistory,
  showTemplatesInMine,
  templateForm,
  templatesFor,
  describeSchedule,
  editingRoutine,
  isUnreadRoutine,
  markSeen,
  routineFormFromSuggestion,
  routinePayload,
  routineProblem,
  routineStatusLine,
  TIME_OPTIONS,
  type Routine,
} from "./agent-routines";

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value) };
}

const routine: Routine = {
  id: "rot_1",
  name: "Resumo da semana",
  prompt: "Resumo da semana passada",
  frequency: "weekly",
  days: [5, 1],
  day_of_month: null,
  time: "08:00",
  active: true,
  next_run_at: "2026-10-05T11:00:00.000Z",
  last_run_at: "2026-09-28T11:01:00.000Z",
  last_status: "ok",
  conversation_id: "routine_rot_1",
};

describe("rotinas do Agent Dute na tela", () => {
  it("descreve a agenda como as pessoas falam", () => {
    expect(describeSchedule(routine)).toBe("Toda segunda e sexta · 08:00");
    expect(describeSchedule({ ...routine, days: [6] })).toBe("Todo sábado · 08:00");
    expect(describeSchedule({ ...routine, frequency: "monthly", day_of_month: 1, time: "09:00" })).toBe("Todo dia 1 · 09:00");
    expect(describeSchedule({ ...routine, frequency: "weekdays", time: "07:30" })).toBe("Todo dia útil · 07:30");
    expect(TIME_OPTIONS).toHaveLength(96);
  });

  it("linha de estado: próxima, última, falha e pausa", () => {
    expect(routineStatusLine(routine)).toBe("Próxima: seg, 05/10, 08:00 · última: 28/09");
    expect(routineStatusLine({ ...routine, last_status: "failed" })).toContain("não rodou na última vez");
    expect(routineStatusLine({ ...routine, active: false })).toBe("Pausada");
    expect(routineStatusLine({ ...routine, active: false, last_status: "no_access" })).toMatch(/acesso/);
  });

  it("sugestão do agente vira formulário; o corpo leva só o que a frequência usa", () => {
    const form = routineFormFromSuggestion({ tipo: "rotina", nome: "Resumo", pergunta: "Resumo da semana", frequency: "weekly", days: [1], time: "08:00" })!;
    expect(form).toMatchObject({ frequency: "weekly", days: [1], time: "08:00", active: true });
    expect(routinePayload(form, "msg_1")).toEqual({
      name: "Resumo",
      prompt: "Resumo da semana",
      frequency: "weekly",
      days: [1],
      time: "08:00",
      active: true,
      agent_message_id: "msg_1",
    });
    expect(routinePayload({ ...form, id: "rot_1", frequency: "monthly", day_of_month: 5 })).toMatchObject({ id: "rot_1", day_of_month: 5 });
    expect(routinePayload({ ...form, frequency: "daily" })).not.toHaveProperty("days");
    expect(routineFormFromSuggestion({ frequency: "anual" })).toBeNull();
  });

  it("o editor lê a rotina pela versão atual da lista (depois de rodar, mostra a última execução)", () => {
    const before = [{ ...routine, last_run_at: null }];
    const after = [{ ...routine, last_run_at: "2026-10-02T20:10:00.000Z" }];
    expect(editingRoutine(before, "rot_1")?.last_run_at).toBeNull();
    expect(editingRoutine(after, "rot_1")?.last_run_at).toBe("2026-10-02T20:10:00.000Z");
    expect(editingRoutine(after, "new")).toBeNull();
    expect(editingRoutine(after, "apagada")).toBeNull();
    expect(editingRoutine(after, null)).toBeNull();
  });

  it("diz o que falta antes de salvar", () => {
    const form = routineFormFromSuggestion({ nome: "Resumo", pergunta: "Resumo da semana", frequency: "weekly", days: [1] })!;
    expect(routineProblem(form)).toBeNull();
    expect(routineProblem({ ...form, name: "" })).toBe("Dê um nome à rotina.");
    expect(routineProblem({ ...form, days: [] })).toBe("Escolha ao menos um dia da semana.");
  });

  it("resposta nova de rotina fica como não lida até abrir a conversa", () => {
    const storage = memoryStorage();
    const conversation = { id: "routine_rot_1", last_message_at: "2026-10-05T11:01:00Z", routine_id: "rot_1" };
    expect(isUnreadRoutine(conversation, storage)).toBe(true);
    markSeen(conversation.id, conversation.last_message_at, storage);
    expect(isUnreadRoutine(conversation, storage)).toBe(false);
    expect(isUnreadRoutine({ ...conversation, last_message_at: "2026-10-12T11:01:00Z" }, storage)).toBe(true);
    expect(isUnreadRoutine({ id: "c1", last_message_at: "2026-10-12T11:01:00Z" }, storage)).toBe(false);
  });

  it("modelos prontos por perfil, cada um já válido para salvar", () => {
    expect(templatesFor("cliente").map((template) => template.name)).toEqual([
      "Resumo do estoque",
      "Itens abaixo do mínimo",
      "Pedidos em andamento",
      "Entregas da semana",
      "Fechamento do mês",
      "Faturas a vencer",
    ]);
    const team = templatesFor("interno").map((template) => template.name);
    expect(team).toContain("Solicitações esperando aprovação");
    expect(team).toContain("Fila do WMS");
    expect(team).not.toContain("Faturas a vencer");
    expect(team).not.toContain("Entregas da semana");
    for (const template of [...ROUTINE_TEMPLATES.customer, ...ROUTINE_TEMPLATES.team]) {
      const form = templateForm(template);
      expect(routineProblem(form), template.name).toBeNull();
      expect(form.id).toBeUndefined();
      expect(TIME_OPTIONS).toContain(form.time);
    }
  });

  it("em Minhas rotinas, os modelos só aparecem enquanto não há nenhuma rotina", () => {
    expect(showTemplatesInMine([])).toBe(true);
    expect(showTemplatesInMine([routine])).toBe(false);
  });

  it("histórico das rotinas: uma linha por rotina, a de resposta mais recente primeiro", () => {
    const conversations = [
      { id: "c1", title: "quanto tenho de polo?", last_message_at: "2026-10-03T12:00:00Z" },
      { id: "routine_rot_1", title: "Rotina: Resumo do estoque", last_message_at: "2026-10-02T13:00:00Z", routine_id: "rot_1" },
      { id: "routine_rot_2", title: "Rotina: Abaixo do mínimo", last_message_at: "2026-10-03T10:30:00Z", routine_id: "rot_2" },
    ];
    const routines = [{ ...routine, id: "rot_1", name: "Resumo do estoque" }];
    expect(routineHistory(conversations, routines).map((item) => [item.id, item.label])).toEqual([
      // Rotina apagada continua no histórico, com o título da conversa sem "Rotina:".
      ["routine_rot_2", "Abaixo do mínimo"],
      ["routine_rot_1", "Resumo do estoque"],
    ]);
  });
});
