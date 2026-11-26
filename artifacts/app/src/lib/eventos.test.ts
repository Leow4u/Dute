import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  STATUS_DA_EDICAO,
  TIPOS_DE_MOMENTO,
  edicaoAberta,
  labelPadrao,
  naoVoltaram,
  podeTransitar,
  problemaDoCronograma,
  type MomentoPrevisto,
  type StatusDaEdicao,
} from "@workspace/dominio";

/**
 * Os Eventos do portal, do portal ao histórico (lib/dominio/src/eventos.ts,
 * eventos, parte 1): os status da edição e quem vai para onde, o cronograma e
 * as recusas dele, a conta do que não voltou e o label padrão. Os casos ficam
 * num JSON que functions/wms também roda, contra a cópia de lá.
 */

type Casos = {
  transicoes: { de: StatusDaEdicao; para: StatusDaEdicao; pode: boolean }[];
  cronogramas: {
    caso: string;
    momentos: MomentoPrevisto[];
    contexto: { comItensDoEstoque: boolean; comColeta: boolean };
    problema: string | null;
  }[];
  retornos: { caso: string; foi: number; voltou: number; avariadas: number; naoVoltaram: number }[];
  labels: { caso: string; momentos: MomentoPrevisto[]; label: string | null }[];
};

const here = dirname(fileURLToPath(import.meta.url));
const casos = JSON.parse(readFileSync(resolve(here, "../../../../lib/dominio/src/eventos.casos.json"), "utf8")) as Casos;

describe("eventos: casos de referência", () => {
  it("os status e os tipos de momento são os da spec, e o JSON foi lido", () => {
    expect([...STATUS_DA_EDICAO]).toEqual(["rascunho", "enviado", "confirmado", "separado", "no_evento", "retornado", "fechado", "cancelado"]);
    expect([...TIPOS_DE_MOMENTO]).toEqual(["coleta_no_cliente", "entrega_no_local", "montagem", "evento", "desmontagem", "retorno_ao_estoque", "entrega_de_volta", "outro"]);
    expect(casos.transicoes.length).toBeGreaterThanOrEqual(12);
    expect(casos.cronogramas.length).toBeGreaterThanOrEqual(12);
  });

  for (const caso of casos.transicoes) {
    it(`transição: ${caso.de} → ${caso.para}`, () => expect(podeTransitar(caso.de, caso.para)).toBe(caso.pode));
  }
  for (const caso of casos.cronogramas) {
    it(`cronograma: ${caso.caso}`, () => expect(problemaDoCronograma(caso.momentos, caso.contexto)).toBe(caso.problema));
  }
  for (const caso of casos.retornos) {
    it(`não voltaram: ${caso.caso}`, () => expect(naoVoltaram(caso.foi, caso.voltou, caso.avariadas)).toBe(caso.naoVoltaram));
  }
  for (const caso of casos.labels) {
    it(`label: ${caso.caso}`, () => expect(labelPadrao(caso.momentos)).toBe(caso.label));
  }

  it("edicaoAberta é verdadeiro de rascunho a retornado", () => {
    expect(STATUS_DA_EDICAO.map(edicaoAberta)).toEqual([true, true, true, true, true, true, false, false]);
  });

  it("edicaoAberta é falso para o que não é status da edição", () => {
    expect([undefined, null, "", "arquivado", "RASCUNHO", 1].map(edicaoAberta)).toEqual([false, false, false, false, false, false]);
  });
});
