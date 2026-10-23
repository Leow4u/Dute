import { describe, expect, it } from "vitest";

import { routinePayload, routineProblem, templateForm, templatesFor } from "../agent-routines";
import { MODULOS_DO_AGENTE } from "./cliente";
import { ID_DO_RESUMO_DO_DIA, modelosDoAgente, resumoDoDia } from "./resumo-do-dia";

/**
 * O Resumo do dia (parte 5.5l): uma rotina pronta por módulo, nos dias úteis
 * às 7h, que a pessoa confirma na tela Rotinas. O agente do WMS segue com os
 * modelos de sempre.
 */

describe("o Resumo do dia", () => {
  it("no agente do WMS, os modelos de sempre", () => {
    expect(modelosDoAgente("interno", { tipo: "wms" })).toEqual(templatesFor("interno"));
    expect(modelosDoAgente("cliente", { tipo: "wms" })).toEqual(templatesFor("cliente"));
  });

  it("no núcleo, o Resumo do dia do módulo primeiro; na Armazenagem, os de sempre depois", () => {
    expect(modelosDoAgente("comercial", { tipo: "nucleo", modulo: "comercial", customerCode: "ITAU" }).map((modelo) => modelo.id)).toEqual([ID_DO_RESUMO_DO_DIA]);
    expect(modelosDoAgente("interno", { tipo: "nucleo", modulo: "wms", customerCode: "ITAU" })).toEqual([resumoDoDia("wms", false), ...templatesFor("interno")]);
    expect(modelosDoAgente("cliente", { tipo: "nucleo", modulo: "wms", customerCode: "ITAU" })[0]!.prompt).toMatch(/^Resumo do dia: meus pedidos/);
  });

  it("cada módulo tem o dele, nos dias úteis às 7h, e vira uma rotina válida sem gravar nada", () => {
    const perguntas = new Set<string>();
    for (const modulo of MODULOS_DO_AGENTE) {
      for (const cliente of [false, true]) {
        const modelo = resumoDoDia(modulo, cliente);
        expect([modelo.name, modelo.frequency, modelo.time, modelo.hint]).toEqual(["Resumo do dia", "weekdays", "07:00", ""]);
        expect(modelo.prompt).toMatch(/Comece pelo mais urgente\.$/);
        // O núcleo aceita até 600 caracteres na pergunta da rotina.
        expect(modelo.prompt.length).toBeLessThanOrEqual(600);
        const form = templateForm(modelo);
        expect(routineProblem(form)).toBeNull();
        expect(routinePayload(form)).toEqual({ name: "Resumo do dia", prompt: modelo.prompt, frequency: "weekdays", time: "07:00", active: true });
        perguntas.add(modelo.prompt);
      }
    }
    // Um por módulo para a equipe, e o do cliente.
    expect(perguntas.size).toBe(MODULOS_DO_AGENTE.length + 1);
  });
});
