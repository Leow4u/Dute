import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  MODELOS_DE_OPERACAO,
  RELOGIO_VAZIO,
  REGRAS_DE_PARADO,
  diaEmSaoPaulo,
  diasCorridos,
  idadeDoItem,
  marcarMovimento,
  regraDoModelo,
  regraEmTexto,
  rotuloDaEtiqueta,
  sentidoDoMovimento,
  type EtiquetaDeParado,
  type IdadeDoItem,
  type RegraDeParado,
  type RelogioDoItem,
  type SentidoDoMovimento,
} from "@workspace/dominio";

import { OPERATION_TEMPLATE_KEYS, operationTemplate } from "./operations";

/**
 * Os dias parado do estoque (lib/dominio/src/parados.ts, parte 5.4a): a regra
 * de cada modelo, os movimentos que contam, o relógio e as etiquetas. Os casos
 * ficam num JSON que functions/core também roda, contra a cópia de lá.
 */

type Casos = {
  regras: { caso: string; modelo: string | null; regra: RegraDeParado }[];
  sentidos: { caso: string; origem: string | null; tipo_mov: string | null; sentido: SentidoDoMovimento | null }[];
  relogios: { caso: string; movimentos: { sentido: SentidoDoMovimento; em: string | null }[]; relogio: RelogioDoItem }[];
  dias: { caso: string; instante: string; dia: string | null }[];
  dias_corridos: { caso: string; de: string; ate: string; dias?: number; erro?: boolean }[];
  idades: { caso: string; relogio: RelogioDoItem; saldo: number; modelo: string; hoje?: string; idade?: IdadeDoItem; erro?: boolean }[];
  rotulos: { caso: string; etiqueta: EtiquetaDeParado; modelo: string; rotulo: string }[];
};

const HOJE = "2026-10-20";

const here = dirname(fileURLToPath(import.meta.url));
const casos = JSON.parse(readFileSync(resolve(here, "../../../../lib/dominio/src/parados.casos.json"), "utf8")) as Casos;

describe("dias parado: casos de referência", () => {
  it("o JSON de casos foi lido", () => {
    expect(casos.idades.length).toBeGreaterThanOrEqual(10);
    expect(casos.sentidos.length).toBeGreaterThanOrEqual(10);
  });

  for (const caso of casos.regras) {
    it(`regra: ${caso.caso}`, () => expect(regraDoModelo(caso.modelo)).toEqual(caso.regra));
  }

  for (const caso of casos.sentidos) {
    it(`sentido: ${caso.caso}`, () => expect(sentidoDoMovimento(caso.origem, caso.tipo_mov)).toBe(caso.sentido));
  }

  for (const caso of casos.relogios) {
    it(`relógio: ${caso.caso}`, () => {
      const relogio = caso.movimentos.reduce((atual, movimento) => marcarMovimento(atual, movimento.sentido, movimento.em), RELOGIO_VAZIO);
      expect(relogio).toEqual(caso.relogio);
    });
  }

  for (const caso of casos.dias) {
    it(`dia: ${caso.caso}`, () => expect(diaEmSaoPaulo(caso.instante)).toBe(caso.dia));
  }

  for (const caso of casos.dias_corridos) {
    it(`dias corridos: ${caso.caso}`, () => {
      if (caso.erro) expect(() => diasCorridos(caso.de, caso.ate)).toThrow();
      else expect(diasCorridos(caso.de, caso.ate)).toBe(caso.dias);
    });
  }

  for (const caso of casos.idades) {
    it(`idade: ${caso.caso}`, () => {
      const calcular = () => idadeDoItem(caso.relogio, caso.saldo, regraDoModelo(caso.modelo), caso.hoje ?? HOJE);
      if (caso.erro) expect(calcular).toThrow();
      else expect(calcular()).toEqual(caso.idade);
    });
  }

  for (const caso of casos.rotulos) {
    it(`rótulo: ${caso.caso}`, () => expect(rotuloDaEtiqueta(caso.etiqueta, regraDoModelo(caso.modelo))).toBe(caso.rotulo));
  }
});

describe("dias parado: a regra é a do modelo de operação", () => {
  it("os modelos da regra são os do registro de modelos", () => {
    expect([...MODELOS_DE_OPERACAO].sort()).toEqual([...OPERATION_TEMPLATE_KEYS].sort());
  });

  it("a ficha de cada modelo mostra a regra dele", () => {
    for (const key of OPERATION_TEMPLATE_KEYS) {
      const define = operationTemplate(key)?.defines.find((item) => item.label === "Dias parado");
      expect(define?.value).toBe(regraEmTexto(REGRAS_DE_PARADO[key]));
    }
    expect(regraEmTexto(REGRAS_DE_PARADO.uniformes)).toBe("Parado 90+ dias sem entrada nem saída; sem giro aos 180 dias sem saída");
  });
});
