import { describe, expect, it } from "vitest";

import { toolLabel } from "./agent-chat";
import { playbookPayload, groupPlaybooks, playbookProblem, stepsFromText, stepsToText, type Playbook } from "./agent-playbooks";
import { functionRoute } from "./functions-api";

const base: Playbook = {
  id: "pb_1",
  title: "Receber mercadoria",
  when: "A mercadoria chegou",
  steps: ["Abra Estoque › Receber.", "Conte cada item."],
  open_points: ["Horário de recebimento."],
  audience: "equipe",
  status: "pending",
  source: "inicial",
  updated_by_name: null,
  decided_by_name: null,
  updated_at: null,
  use_count: 0,
};

describe("playbooks na tela Conhecimento", () => {
  it("rotas vão para as callables certas", async () => {
    expect(functionRoute("/api/agent-dute/playbooks", "GET")?.name).toBe("listAgentPlaybooks");
    expect(functionRoute("/api/agent-dute/playbooks", "POST")?.name).toBe("saveAgentPlaybook");
    expect(functionRoute("/api/agent-dute/playbooks/seed", "POST")?.name).toBe("seedAgentPlaybooks");
    const decide = functionRoute("/api/agent-dute/playbooks/pb_ini_x/approve", "POST");
    expect(decide?.name).toBe("decideAgentPlaybook");
    expect(await decide?.payload("/api/agent-dute/playbooks/pb_ini_x/approve", { method: "POST", body: "{}" })).toEqual({ id: "pb_ini_x", action: "approve" });
  });

  it("passos: um por linha, sem a numeração que a pessoa digitar", () => {
    expect(stepsFromText("1. Abra Pedidos\n\n2) Confira os itens\n- Clique em Aprovar\n  ")).toEqual(["Abra Pedidos", "Confira os itens", "Clique em Aprovar"]);
    expect(stepsToText(["Abra", "Confira"])).toBe("Abra\nConfira");
  });

  it("diz o que falta antes de salvar e monta o corpo sem undefined", () => {
    expect(playbookProblem({ title: "", when: "x", stepsText: "a" })).toBe("Dê um nome ao playbook.");
    expect(playbookProblem({ title: "Receber", when: "", stepsText: "a" })).toBe("Diga quando usar.");
    expect(playbookProblem({ title: "Receber", when: "Chegou", stepsText: " \n " })).toBe("Escreva pelo menos um passo.");
    expect(playbookProblem({ title: "Receber", when: "Chegou", stepsText: "Conte" })).toBeNull();
    expect(playbookPayload({ title: " Receber ", when: " Chegou ", stepsText: "1. Conte", openText: "", audience: "todos" })).toEqual({
      title: "Receber",
      when: "Chegou",
      steps: ["Conte"],
      open_points: [],
      audience: "todos",
    });
    expect(playbookPayload({ id: "pb_1", title: "R", when: "C", stepsText: "a", openText: "Horário\n", audience: "equipe" }).id).toBe("pb_1");
  });

  it("separa para aprovar e valendo; a consulta do agente tem rótulo próprio", () => {
    const groups = groupPlaybooks([{ ...base, id: "b", title: "B", status: "active" }, base, { ...base, id: "c", title: "A", status: "active" }]);
    expect(groups.pending.map((item) => item.id)).toEqual(["pb_1"]);
    expect(groups.active.map((item) => item.title)).toEqual(["A", "B"]);
    expect(toolLabel("consultar_playbook")).toBe("Seguiu um playbook da coordenação");
  });
});
