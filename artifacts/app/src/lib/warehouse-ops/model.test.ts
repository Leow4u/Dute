import { describe, expect, it } from "vitest";

import { canAdvanceTask, canRegisterException, getErrorMessage, normalizeQueues, somenteConsulta } from "./model";

describe("mensagem de erro das Functions", () => {
  it("mostra só a mensagem quando o corpo do erro vem em JSON", () => {
    const body = JSON.stringify({
      message: "Não foi possível conferir a qualidade da foto agora. A proposta não foi salva; tente novamente.",
      code: "unavailable",
    });
    expect(getErrorMessage(new Error(body))).toBe(
      "Não foi possível conferir a qualidade da foto agora. A proposta não foi salva; tente novamente.",
    );
  });

  it("mantém o texto quando o erro não é JSON", () => {
    expect(getErrorMessage(new Error("HTTP 500"))).toBe("HTTP 500");
    expect(getErrorMessage("falhou")).toBe("Erro inesperado");
  });
});

describe("a tarefa só para consulta", () => {
  it("quem não opera o armazém não avança nem registra exceção; a tarefa segue a mesma", () => {
    const queue = normalizeQueues({ receiving: { key: "receiving", name: "Recebimento", tasks: [{ id: "inb_1", status: "checking", can_advance: true }] } }).find(
      (entry) => entry.key === "receiving",
    )!;
    const entrada = { task: queue.tasks[0]!, queue };
    expect(canAdvanceTask(entrada.task)).toBe(true);
    expect(canRegisterException(entrada.task)).toBe(true);
    const consulta = somenteConsulta(entrada);
    expect(canAdvanceTask(consulta.task)).toBe(false);
    expect(canRegisterException(consulta.task)).toBe(false);
    expect({ ...consulta.task, can_advance: true, can_register_exception: undefined }).toMatchObject({ id: "inb_1", status: "checking" });
    expect(entrada.task.can_advance).toBe(true);
  });
});
