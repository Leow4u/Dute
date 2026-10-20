import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DecidePlaybookSchema,
  INITIAL_PLAYBOOKS,
  initialPlaybookId,
  playbookIndexText,
  PlaybookInputSchema,
  playbookVisibleTo,
} from "./domain/agent-playbooks.js";

describe("playbooks do Agent Dute", () => {
  it("os sete iniciais são válidos e só os do portal vão para o cliente", () => {
    assert.deepEqual(
      INITIAL_PLAYBOOKS.map((item) => [item.slug, item.audience]),
      [
        ["aprovar", "equipe"],
        ["receber", "equipe"],
        ["divergencia", "equipe"],
        ["separar", "equipe"],
        ["entregar", "equipe"],
        ["pedido-portal", "todos"],
        ["envio-portal", "todos"],
      ],
    );
    for (const item of INITIAL_PLAYBOOKS) {
      const parsed = PlaybookInputSchema.parse(item);
      assert.equal(parsed.steps.length, item.steps.length, item.slug);
      assert.ok(item.open_points.length > 0, `${item.slug} sem pontos para a equipe completar`);
      // Telas que não fazem parte da operação (03/10/2026) não aparecem nos passos.
      assert.doesNotMatch(item.steps.join(" "), /Exceç|Devoluç|\/wms\/|putaway/i, item.slug);
    }
  });

  it("id fixo por cliente: carregar de novo não duplica", () => {
    assert.equal(initialPlaybookId("BTG Pactual", "receber"), "pb_ini_btg_pactual_receber");
    assert.equal(initialPlaybookId("Ação & Cia", "aprovar"), "pb_ini_acao_cia_aprovar");
  });

  it("entrada: tira passos vazios, exige pelo menos um, aceita null do SDK", () => {
    const parsed = PlaybookInputSchema.parse({ id: null, title: " Receber ", when: "Chegou mercadoria", steps: [" Conte ", "", "  "], open_points: null, audience: "equipe" });
    assert.deepEqual([parsed.title, parsed.steps, parsed.open_points], ["Receber", ["Conte"], []]);
    assert.equal(PlaybookInputSchema.safeParse({ title: "x", when: "y", steps: ["", " "], audience: "equipe" }).success, false);
    assert.equal(PlaybookInputSchema.safeParse({ title: "x", when: "y", steps: ["a"], audience: "cliente" }).success, false);
    assert.equal(DecidePlaybookSchema.safeParse({ id: "pb", action: "apagar" }).success, false);
  });

  it("cliente só vê playbook para todos; o índice do prompt leva id, nome e quando usar", () => {
    assert.equal(playbookVisibleTo("equipe", "customer"), false);
    assert.equal(playbookVisibleTo("todos", "customer"), true);
    assert.equal(playbookVisibleTo("equipe", "internal"), true);
    assert.equal(
      playbookIndexText([
        { id: "pb_1", title: "Receber mercadoria", when: "A mercadoria chegou" },
        { id: "pb_2", title: "Entregar um pedido", when: "Pedido em Para entregar" },
      ]),
      "- [pb_1] Receber mercadoria: A mercadoria chegou\n- [pb_2] Entregar um pedido: Pedido em Para entregar",
    );
  });
});
