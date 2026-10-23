import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { HttpsError } from "firebase-functions/https";

import { INITIAL_PLAYBOOKS } from "./agente-playbooks-iniciais.js";
import { idDaNota, idDoPlaybookInicial, limparNota } from "./agente-revisao.js";
import { buildCoreEvent, coreEventId } from "./eventos.js";
import { AGENTE_REVISAO_ROLES, PLATFORM_ROLES, revisaoDoAgenteProblem } from "./platform-roles.js";

/**
 * As anotações e os playbooks do Agent Dute no núcleo (parte 5.5f), nas
 * partes puras: a cópia dos playbooks iniciais e dos papéis de quem revisa,
 * travadas contra o WMS; os ids iguais aos do WMS, para o núcleo não repetir
 * o que ele já gravou; e os eventos `agente.*`, só com o id.
 */

const ler = (relativo: string) => readFileSync(fileURLToPath(new URL(relativo, import.meta.url)), "utf8");
const playbooksDoWms = ler("../../../wms/src/domain/agent-playbooks.ts");
const notasDoWms = ler("../../../wms/src/domain/agent-notes.ts");
const playbooksDoNucleo = ler("../../src/domain/agente-playbooks-iniciais.ts");

function bloco(fonte: string): string {
  const inicio = fonte.indexOf("export const INITIAL_PLAYBOOKS: InitialPlaybook[] = [");
  assert.ok(inicio >= 0, "INITIAL_PLAYBOOKS");
  return fonte.slice(inicio, fonte.indexOf("\n];\n", inicio));
}

describe("as cópias do WMS", () => {
  it("os playbooks iniciais são os do WMS, letra por letra", () => {
    assert.equal(bloco(playbooksDoNucleo), bloco(playbooksDoWms));
    assert.equal(INITIAL_PLAYBOOKS.length, 7);
    assert.equal(new Set(INITIAL_PLAYBOOKS.map((item) => item.slug)).size, 7);
  });

  it("quem revisa é quem aprova as anotações no WMS", () => {
    const doWms = notasDoWms.match(/NOTE_REVIEWER_ROLES = \[([^\]]*)\]/)?.[1];
    assert.ok(doWms);
    assert.deepEqual([...AGENTE_REVISAO_ROLES], [...doWms.matchAll(/"([^"]+)"/g)].map((item) => item[1]));
    for (const role of PLATFORM_ROLES) assert.equal(revisaoDoAgenteProblem(role) === null, (AGENTE_REVISAO_ROLES as readonly string[]).includes(role), role);
  });

  it("o id da anotação e o do playbook inicial são os do WMS", () => {
    const doWms = createHash("sha256")
      .update("ITAU|Entregas só pela manhã".toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " "))
      .digest("hex")
      .slice(0, 24);
    assert.equal(idDaNota("ITAU", "Entregas só pela manhã"), `note_${doWms}`);
    assert.equal(idDaNota("ITAU", "Entregas só pela manhã"), idDaNota("ITAU", "entregas SO pela  manha"));
    assert.equal(idDoPlaybookInicial("BTG Pactual", "aprovar"), "pb_ini_btg_pactual_aprovar");
    assert.equal(limparNota("  a   b  "), "a b");
    assert.equal(limparNota("x".repeat(400)).length, 300);
  });
});

describe("os eventos das anotações e dos playbooks", () => {
  const equipe = { uid: "ops-1", role: "interno" as const, name: "Ops" };
  const cliente = { uid: "cli-1", role: "cliente" as const, customerCode: "ITAU" };
  const quando = "2026-10-23T15:00:00.000Z";
  const nota = `note_${"a".repeat(24)}`;

  it("só o id, e a anotação sugerida é o único que o cliente grava", () => {
    const sugerida = buildCoreEvent({ type: "agente.anotacao_sugerida", payload: { id: nota, conversa: "conv_1" }, customer_code: "ITAU", actor: cliente, occurred_at: quando, chave: "msg_1" });
    assert.deepEqual([sugerida.entity_type, sugerida.payload, sugerida.actor], ["anotacao_do_agente", { id: nota, conversa: "conv_1" }, { uid: "cli-1", role: "cliente" }]);
    assert.throws(
      () => buildCoreEvent({ type: "agente.anotacao_aprovada", payload: { id: nota }, customer_code: "ITAU", actor: cliente, occurred_at: quando }),
      (erro: unknown) => erro instanceof HttpsError && erro.code === "permission-denied",
    );
    // O texto da anotação não vai ao evento.
    assert.throws(() => buildCoreEvent({ type: "agente.anotacao_aprovada", payload: { id: nota, texto: "Contato: Cristiane" } as never, customer_code: "ITAU", actor: equipe, occurred_at: quando }), /payload inválido/);
    const playbook = buildCoreEvent({ type: "agente.playbook_criado", payload: { id: "pb_0123456789ab", passos: 3, publico: "equipe" }, customer_code: "ITAU", actor: equipe, occurred_at: quando, chave: "k1" });
    assert.equal(playbook.entity_type, "playbook_do_agente");
  });

  it("a chave distingue duas edições; sem ela, o id é o do alerta de antes", () => {
    assert.notEqual(coreEventId("agente.playbook_editado", "pb_0123456789ab", "k1"), coreEventId("agente.playbook_editado", "pb_0123456789ab", "k2"));
    assert.equal(
      coreEventId("estoque_parado.aprovado", "alerta_x"),
      `evt_${createHash("sha256").update(JSON.stringify(["estoque_parado.aprovado", "alerta_x"])).digest("hex").slice(0, 32)}`,
    );
  });
});
