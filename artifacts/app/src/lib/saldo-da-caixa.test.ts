import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  conferirCaixasInformadas,
  ordemDeSaida,
  retiradoCom,
  saldoDaCaixa,
  sugerirCaixas,
  unidadesDaCaixa,
  type CaixaComOItem,
  type CaixasDaLinha,
  type LinhaDaCaixa,
} from "@workspace/dominio";

/**
 * O saldo da caixa (lib/dominio/src/saldo-da-caixa.ts, separação com caixas,
 * parte 3): a entrada menos o retirado, a sugestão da caixa mais antiga e a
 * conferência de "Outra caixa". Os casos ficam num JSON que functions/wms
 * também roda, contra a cópia de lá.
 */

type Casos = {
  saldos: { caso: string; entrada: unknown[]; retirado: unknown[]; saldo: LinhaDaCaixa[]; unidades: number }[];
  retirados: { caso: string; retirado: LinhaDaCaixa[]; sku_code: string; qty: number; resultado: LinhaDaCaixa[] }[];
  sugestoes: { caso: string; pedido: number; caixas: CaixaComOItem[]; resultado: CaixasDaLinha }[];
  informadas: { caso: string; pedido: number; informadas: { box_code: string; qty: number }[]; caixas: CaixaComOItem[]; resultado: CaixasDaLinha | { problema: string } }[];
};

const here = dirname(fileURLToPath(import.meta.url));
const casos = JSON.parse(readFileSync(resolve(here, "../../../../lib/dominio/src/saldo-da-caixa.casos.json"), "utf8")) as Casos;

describe("saldo da caixa: casos de referência", () => {
  it("o JSON de casos foi lido", () => {
    expect(casos.saldos.length).toBeGreaterThanOrEqual(5);
    expect(casos.sugestoes.length).toBeGreaterThanOrEqual(8);
    expect(casos.informadas.length).toBeGreaterThanOrEqual(8);
  });

  for (const caso of casos.saldos) {
    it(`saldo: ${caso.caso}`, () => {
      const saldo = saldoDaCaixa(caso.entrada as LinhaDaCaixa[], caso.retirado as LinhaDaCaixa[]);
      expect(saldo).toEqual(caso.saldo);
      expect(unidadesDaCaixa(saldo)).toBe(caso.unidades);
    });
  }
  for (const caso of casos.retirados) {
    it(`retirado: ${caso.caso}`, () => expect(retiradoCom(caso.retirado, caso.sku_code, caso.qty)).toEqual(caso.resultado));
  }
  for (const caso of casos.sugestoes) {
    it(`sugestão: ${caso.caso}`, () => expect(sugerirCaixas(caso.pedido, caso.caixas)).toEqual(caso.resultado));
  }
  for (const caso of casos.informadas) {
    it(`outra caixa: ${caso.caso}`, () => expect(conferirCaixasInformadas(caso.pedido, caso.informadas, caso.caixas)).toEqual(caso.resultado));
  }

  it("a ordem de saída não muda a lista que recebeu", () => {
    const caixas = [
      { code: "CX-000002", stored_at: "2026-10-22T13:00:00.000Z" },
      { code: "CX-000001", stored_at: "2026-10-22T13:00:00.000Z" },
    ];
    expect(ordemDeSaida(caixas).map((caixa) => caixa.code)).toEqual(["CX-000001", "CX-000002"]);
    expect(caixas.map((caixa) => caixa.code)).toEqual(["CX-000002", "CX-000001"]);
  });
});
