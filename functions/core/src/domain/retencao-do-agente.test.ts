import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CORE_EVENT_PAYLOADS, buildCoreEvent } from "./eventos.js";
import { RETENCAO_AMBIENTES_LIBERADOS, retencaoLiberada } from "./liberacao.js";
import { MESES_DO_AGENTE, contagemPorCliente, idDaRetencao, limiteDoAgente } from "./retencao-do-agente.js";
import { RETENCAO_DO_AGENTE } from "./retencao-do-agente-gravacao.js";

/** A regra da retenção do Agent Dute (LGPD, decisão 8), sem o banco. */

const payload = { id: "ret_20261026T064000", antes_de: "2025-10-26", mensagens: 3, conversas: 1, usos: 2, conversas_limpas: 1 };

describe("a retenção do Agent Dute", () => {
  it("o prazo é de 12 meses, no mesmo dia do ano anterior", () => {
    assert.equal(MESES_DO_AGENTE, 12);
    assert.equal(limiteDoAgente(new Date("2026-10-26T06:40:00.000Z")).toISOString(), "2025-10-26T06:40:00.000Z");
  });

  it("o id da rodada sai do instante e passa no evento", () => {
    assert.equal(idDaRetencao(new Date("2026-10-26T06:40:05.900Z")), "ret_20261026T064005");
    assert.equal(CORE_EVENT_PAYLOADS["agente.retencao_aplicada"].safeParse(payload).success, true);
  });

  it("conta por cliente e por tipo, na ordem do código", () => {
    assert.deepEqual(
      contagemPorCliente([
        { cliente: "SAFRA", tipo: "mensagens" },
        { cliente: "ITAU", tipo: "usos" },
        { cliente: "ITAU", tipo: "mensagens" },
        { cliente: "ITAU", tipo: "mensagens" },
        { cliente: "ITAU", tipo: "conversas" },
        { cliente: "SAFRA", tipo: "conversas_limpas" },
      ]),
      [
        { cliente: "ITAU", mensagens: 2, conversas: 1, usos: 1, conversas_limpas: 0 },
        { cliente: "SAFRA", mensagens: 1, conversas: 0, usos: 0, conversas_limpas: 1 },
      ],
    );
  });

  it("o evento leva só contagens: o texto da conversa ou o e-mail não passam", () => {
    const schema = CORE_EVENT_PAYLOADS["agente.retencao_aplicada"];
    assert.equal(schema.safeParse({ ...payload, titulo: "Quantas caixas?" }).success, false);
    assert.equal(schema.safeParse({ ...payload, usuario: "ana@itau.com" }).success, false);
    assert.equal(schema.safeParse({ ...payload, mensagens: -1 }).success, false);
    const semAsLimpas: Record<string, unknown> = { ...payload };
    delete semAsLimpas.conversas_limpas;
    assert.equal(schema.safeParse(semAsLimpas).success, false);
  });

  it("só a rotina grava o evento da retenção, e a rotina não grava os outros", () => {
    const evento = buildCoreEvent({ type: "agente.retencao_aplicada", payload, customer_code: "ITAU", actor: RETENCAO_DO_AGENTE, occurred_at: "2026-10-26T06:40:00.000Z", chave: "ITAU" });
    assert.deepEqual([evento.entity_type, evento.customer_code, evento.actor], ["retencao_do_agente", "ITAU", { uid: RETENCAO_DO_AGENTE.uid, role: "sistema", name: RETENCAO_DO_AGENTE.name }]);
    const equipe = { uid: "ops-1", role: "interno" as const, name: "Ops" };
    assert.throws(() => buildCoreEvent({ type: "agente.retencao_aplicada", payload, customer_code: "ITAU", actor: equipe, occurred_at: "2026-10-26T06:40:00.000Z" }), /autor errado/);
    assert.throws(
      () => buildCoreEvent({ type: "agente.anotacao_aprovada", payload: { id: `note_${"a".repeat(24)}` }, customer_code: "ITAU", actor: RETENCAO_DO_AGENTE, occurred_at: "2026-10-26T06:40:00.000Z" }),
      /autor errado/,
    );
  });

  it("só a homologação apaga, até o OK do Leonardo para a produção", () => {
    assert.deepEqual([...RETENCAO_AMBIENTES_LIBERADOS], ["dute-homolog"]);
    assert.equal(retencaoLiberada("dute-homolog"), true);
    for (const projeto of ["dute-prod", "dute-btg", "demo-dute-core", "", null, undefined]) assert.equal(retencaoLiberada(projeto), false, String(projeto));
  });
});
