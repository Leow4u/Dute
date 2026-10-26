import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { RH_EVENT_PAYLOADS, RH_EVENT_TYPES, buildRhEvent, rhEventId } from "./events.js";
import type { RhActor } from "./operations.js";

/**
 * Os eventos do RH (parte 8.2a): o payload sem nome, resultado nem arquivo,
 * a rotina com o ator sistema e quem grava com o papel rh.
 */

const RH: RhActor = { uid: "rh-1", role: "rh", email: "rh@dutelog.com.br", name: "Pessoa rh" };
const ROTINA: RhActor = { uid: "rotina-rh", role: "sistema", name: "Rotina diária do RH" };
const REGISTRO = { id: "reg_aaaaaaaaaaaaaaaa", colaborador_id: "col_0123456789abcdef", categoria: "exame", tipo: "periodico" } as const;

describe("eventos do RH", () => {
  it("o payload é estrito: o resultado do exame, o nome do registro e o arquivo não entram", () => {
    for (const tipo of RH_EVENT_TYPES) assert.equal(RH_EVENT_PAYLOADS[tipo]._def.unknownKeys, "strict");
    const criado = { ...REGISTRO, emitido_em: "2025-11-01", vence_em: "2026-11-01", situacao: "vigente" };
    assert.equal(RH_EVENT_PAYLOADS["rh.record_created"].safeParse(criado).success, true);
    for (const extra of [{ resultado: "apto" }, { descricao: "Curso" }, { arquivo: "rh/x.pdf" }]) {
      assert.equal(RH_EVENT_PAYLOADS["rh.record_created"].safeParse({ ...criado, ...extra }).success, false);
    }
  });

  it("o evento sai com o texto fixo, a fonte e o id determinístico", () => {
    const evento = buildRhEvent({
      operation_id: "op_1",
      type: "rh.record_archived",
      entity_id: REGISTRO.id,
      payload: REGISTRO,
      actor: RH,
      occurred_at: "2026-10-23T12:00:00.000Z",
    });
    assert.equal(evento.id, rhEventId("op_1", "rh.record_archived"));
    assert.equal(evento.title, "Registro da ficha arquivado");
    assert.equal(evento.source, "functions_rh");
    assert.equal(evento.entity_type, "rh_record");
    assert.deepEqual(evento.actor, { uid: "rh-1", email: "rh@dutelog.com.br", name: "Pessoa rh", role: "rh" });
  });

  it("o vencimento é só da rotina, e o resto só de quem grava no RH", () => {
    const vencendo = { ...REGISTRO, vence_em: "2026-11-01", dias: 9 };
    assert.throws(() => buildRhEvent({ operation_id: "op", type: "rh.record_expiring", entity_id: REGISTRO.id, payload: vencendo, actor: RH }), /rotina diária/);
    assert.equal(buildRhEvent({ operation_id: "op", type: "rh.record_expiring", entity_id: REGISTRO.id, payload: vencendo, actor: ROTINA }).actor.role, "sistema");
    for (const actor of [ROTINA, { uid: "owner-1", role: "owner" }]) {
      assert.throws(() => buildRhEvent({ operation_id: "op", type: "rh.record_archived", entity_id: REGISTRO.id, payload: REGISTRO, actor }), /quem grava no RH/);
    }
  });

  it("o vencido tem dias negativos, o vencendo não", () => {
    const base = { ...REGISTRO, vence_em: "2026-10-20" };
    assert.equal(RH_EVENT_PAYLOADS["rh.record_expired"].safeParse({ ...base, dias: -3 }).success, true);
    assert.equal(RH_EVENT_PAYLOADS["rh.record_expired"].safeParse({ ...base, dias: 0 }).success, false);
    assert.equal(RH_EVENT_PAYLOADS["rh.record_expiring"].safeParse({ ...base, dias: -1 }).success, false);
    assert.equal(RH_EVENT_PAYLOADS["rh.record_expiring"].safeParse({ ...base, dias: 31 }).success, false);
  });

  it("a exportação: só contagens no payload, o rh gera, quem lê o RH baixa, e a entidade é a exportação", () => {
    const EXPORTACAO = { id: "exp_2026-10_v2", competencia: "2026-10", versao: 2 };
    const gerada = { ...EXPORTACAO, exames: 3, colaboradores: 12 };
    assert.equal(RH_EVENT_PAYLOADS["rh.export_created"].safeParse(gerada).success, true);
    for (const extra of [{ cpf: "52998224725" }, { nome: "Ana" }, { exames: [] }]) {
      assert.equal(RH_EVENT_PAYLOADS["rh.export_created"].safeParse({ ...gerada, ...extra }).success, false);
    }
    const criado = buildRhEvent({ operation_id: "op", type: "rh.export_created", entity_id: EXPORTACAO.id, payload: gerada, actor: RH });
    assert.equal(criado.entity_type, "rh_export");
    assert.throws(() => buildRhEvent({ operation_id: "op", type: "rh.export_created", entity_id: EXPORTACAO.id, payload: gerada, actor: { uid: "admin-1", role: "admin" } }), /quem grava no RH/);
    const baixada = { ...EXPORTACAO, arquivo: "exames" as const };
    for (const role of ["owner", "admin", "rh"]) {
      assert.equal(buildRhEvent({ operation_id: "op", type: "rh.export_downloaded", entity_id: EXPORTACAO.id, payload: baixada, actor: { uid: `${role}-1`, role } }).entity_type, "rh_export");
    }
    assert.throws(() => buildRhEvent({ operation_id: "op", type: "rh.export_downloaded", entity_id: EXPORTACAO.id, payload: baixada, actor: { uid: "op-1", role: "operacao" } }), /quem grava no RH/);
  });

  it("as datas do vínculo: o colaborador, as duas datas e as edições; só o rh grava, e a entidade é o vínculo", () => {
    const gravado = { id: REGISTRO.colaborador_id, admissao: "2025-02-03", desligamento: null, edicao_antes: null, edicao_depois: 1 };
    assert.equal(RH_EVENT_PAYLOADS["rh.vinculo_saved"].safeParse(gravado).success, true);
    assert.equal(RH_EVENT_PAYLOADS["rh.vinculo_saved"].safeParse({ ...gravado, id: REGISTRO.id }).success, false);
    for (const extra of [{ nome: "Ana" }, { cpf: "52998224725" }, { salario: 3000 }]) {
      assert.equal(RH_EVENT_PAYLOADS["rh.vinculo_saved"].safeParse({ ...gravado, ...extra }).success, false);
    }
    const evento = buildRhEvent({ operation_id: "op", type: "rh.vinculo_saved", entity_id: gravado.id, payload: gravado, actor: RH });
    assert.equal(evento.entity_type, "rh_vinculo");
    assert.equal(evento.title, "Datas do vínculo gravadas");
    for (const actor of [ROTINA, { uid: "admin-1", role: "admin" }]) {
      assert.throws(() => buildRhEvent({ operation_id: "op", type: "rh.vinculo_saved", entity_id: gravado.id, payload: gravado, actor }), /quem grava no RH/);
    }
  });
});
