import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { RH_EVENT_PAYLOADS, buildRhEvent } from "./events.js";
import { RETENCAO_AMBIENTES_LIBERADOS, retencaoLiberada } from "./liberacao.js";
import { DIAS_DA_SUBSTITUIDA, substituidasParaLimpar, type VersaoGuardada } from "./retencao.js";
import { RETENCAO_DO_RH } from "./retencao-gravacao.js";

/** A regra da retenção da exportação do RH (LGPD, decisão 7), sem o banco. */

const AGORA = new Date("2026-11-30T07:00:00.000Z");

function versao(competencia: string, numero: number, gerada_em: string, limpa = false): VersaoGuardada {
  return { id: `exp_${competencia}_v${numero}`, competencia, versao: numero, gerada_em, limpa };
}

describe("a retenção da exportação do RH", () => {
  it("a substituída há mais de 30 dias perde as linhas; a última e a substituída há menos tempo ficam", () => {
    assert.equal(DIAS_DA_SUBSTITUIDA, 30);
    const devidas = substituidasParaLimpar(
      [
        versao("2026-10", 1, "2026-10-05T12:00:00.000Z"),
        versao("2026-10", 2, "2026-10-20T12:00:00.000Z"),
        versao("2026-10", 3, "2026-11-10T12:00:00.000Z"),
        versao("2026-09", 1, "2026-09-30T12:00:00.000Z"),
      ],
      AGORA,
    );
    // A v1 de outubro foi substituída em 20/10 (41 dias); a v2, em 10/11 (20 dias); a v3 é a última; setembro só tem uma.
    assert.deepEqual(devidas, [{ id: "exp_2026-10_v1", competencia: "2026-10", versao: 1, substituida_por: 2 }]);
  });

  it("conta os 30 dias da versão seguinte, e a já limpa não volta", () => {
    const seguinte = new Date(AGORA.getTime() - 30 * 86_400_000).toISOString();
    assert.deepEqual(substituidasParaLimpar([versao("2026-10", 1, "2026-09-01T00:00:00.000Z"), versao("2026-10", 2, seguinte)], AGORA), []);
    const antes = new Date(AGORA.getTime() - 30 * 86_400_000 - 1).toISOString();
    assert.equal(substituidasParaLimpar([versao("2026-10", 1, "2026-09-01T00:00:00.000Z"), versao("2026-10", 2, antes)], AGORA).length, 1);
    assert.deepEqual(substituidasParaLimpar([versao("2026-10", 1, "2026-09-01T00:00:00.000Z", true), versao("2026-10", 2, antes)], AGORA), []);
  });

  it("o evento leva a versão e a que a substituiu, e só a rotina o grava", () => {
    const payload = { id: "exp_2026-10_v1", competencia: "2026-10", versao: 1, substituida_por: 2 };
    assert.equal(RH_EVENT_PAYLOADS["rh.export_lines_removed"].safeParse(payload).success, true);
    for (const extra of [{ cpf: "52998224725" }, { nome: "Ana" }, { colaboradores: [] }]) {
      assert.equal(RH_EVENT_PAYLOADS["rh.export_lines_removed"].safeParse({ ...payload, ...extra }).success, false);
    }
    const evento = buildRhEvent({ operation_id: "retencao-rh:exp_2026-10_v1", type: "rh.export_lines_removed", entity_id: payload.id, payload, actor: RETENCAO_DO_RH });
    assert.deepEqual([evento.entity_type, evento.actor.role], ["rh_export", "sistema"]);
    assert.throws(
      () => buildRhEvent({ operation_id: "op", type: "rh.export_lines_removed", entity_id: payload.id, payload, actor: { uid: "rh-1", role: "rh" } }),
      /rotina diária/,
    );
  });

  it("só a homologação apaga, até o OK do Leonardo para a produção", () => {
    assert.deepEqual([...RETENCAO_AMBIENTES_LIBERADOS], ["dute-homolog"]);
    assert.equal(retencaoLiberada("dute-homolog"), true);
    for (const projeto of ["dute-prod", "dute-btg", "demo-dute-rh", "", null, undefined]) assert.equal(retencaoLiberada(projeto), false, String(projeto));
  });

  it("a rotina roda todo dia, uma instância de cada vez, e confere a liberação da retenção antes de tudo", () => {
    const index = readFileSync(fileURLToPath(new URL("../../src/index.ts", import.meta.url)), "utf8");
    assert.match(
      index,
      /export const runRhRetention = onSchedule\(\{[^}]*schedule: "every day 04:00"[^}]*timeZone: "America\/Sao_Paulo"[^}]*maxInstances: 1[^}]*\}, async \(\) => \{\s*if \(!retencaoLiberada\(PROJECT_ID\)\) return;\s*console\.info\("runRhRetention", await runRhRetentionFor\(rh\)\);/,
    );
  });
});
