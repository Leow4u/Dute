import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import * as regra from "@workspace/dominio";
import {
  ajusteParaOContado,
  conferirCaixasInformadas,
  ordemDeSaida,
  retiradoCom,
  saldoDaCaixa,
  sugerirCaixas,
  unidadesAjustadas,
  unidadesDaCaixa,
  type CaixaComOItem,
  type CaixasDaLinha,
  type LinhaDaCaixa,
} from "@workspace/dominio";

/**
 * O saldo da caixa (lib/dominio/src/saldo-da-caixa.ts, separação com caixas,
 * parte 3, e a contagem por caixa): a entrada menos o retirado mais os
 * ajustes da recontagem, o ajuste que leva ao contado, a sugestão da caixa
 * mais antiga e a conferência de "Outra caixa". Os casos ficam num JSON que functions/wms
 * também roda, contra a cópia de lá.
 */

type Casos = {
  saldos: { caso: string; entrada: unknown[]; retirado: unknown[]; ajustes?: unknown[]; saldo: LinhaDaCaixa[]; unidades: number }[];
  ajustadas: { caso: string; ajustes: unknown[]; unidades: number }[];
  paraOContado: { caso: string; entrada: unknown[]; retirado: unknown[]; ajustes: unknown[]; sku_code: string; contado: number; ajuste: number }[];
  retirados: { caso: string; retirado: LinhaDaCaixa[]; sku_code: string; qty: number; resultado: LinhaDaCaixa[] }[];
  sugestoes: { caso: string; pedido: number; caixas: CaixaComOItem[]; resultado: CaixasDaLinha }[];
  informadas: { caso: string; pedido: number; informadas: { box_code: string; qty: number }[]; caixas: CaixaComOItem[]; resultado: CaixasDaLinha | { problema: string } }[];
};

const here = dirname(fileURLToPath(import.meta.url));
const casos = JSON.parse(readFileSync(resolve(here, "../../../../lib/dominio/src/saldo-da-caixa.casos.json"), "utf8")) as Casos;

describe("saldo da caixa: casos de referência", () => {
  it("o JSON de casos foi lido", () => {
    expect(casos.saldos.length).toBeGreaterThanOrEqual(12);
    expect(casos.ajustadas.length).toBeGreaterThanOrEqual(3);
    expect(casos.paraOContado.length).toBeGreaterThanOrEqual(6);
    expect(casos.sugestoes.length).toBeGreaterThanOrEqual(8);
    expect(casos.informadas.length).toBeGreaterThanOrEqual(8);
  });

  for (const caso of casos.saldos) {
    it(`saldo: ${caso.caso}`, () => {
      const saldo = saldoDaCaixa(caso.entrada as LinhaDaCaixa[], caso.retirado as LinhaDaCaixa[], (caso.ajustes ?? []) as LinhaDaCaixa[]);
      expect(saldo).toEqual(caso.saldo);
      expect(unidadesDaCaixa(saldo)).toBe(caso.unidades);
    });
  }
  for (const caso of casos.ajustadas) {
    it(`ajustadas: ${caso.caso}`, () => expect(unidadesAjustadas(caso.ajustes as LinhaDaCaixa[])).toBe(caso.unidades));
  }
  for (const caso of casos.paraOContado) {
    it(`para o contado: ${caso.caso}`, () => {
      const ajuste = ajusteParaOContado(caso.entrada as LinhaDaCaixa[], caso.retirado as LinhaDaCaixa[], caso.ajustes as LinhaDaCaixa[], caso.sku_code, caso.contado);
      expect(ajuste).toBe(caso.ajuste);
      // Com o ajuste gravado, a conta fecha no contado.
      if (caso.sku_code) {
        const depois = saldoDaCaixa(caso.entrada as LinhaDaCaixa[], caso.retirado as LinhaDaCaixa[], [...(caso.ajustes as LinhaDaCaixa[]), { sku_code: caso.sku_code, qty: ajuste }]);
        expect(depois.find((linha) => linha.sku_code === caso.sku_code)?.qty ?? 0).toBe(caso.contado);
      }
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

describe("saldo da caixa: a cópia das ferramentas é a gerada deste arquivo", () => {
  const RAIZ = resolve(here, "../../../..");
  const COPIA = resolve(RAIZ, "tools/corrigir-codigo-do-produto/saldo-da-caixa.mjs");

  it("tools/corrigir-codigo-do-produto/saldo-da-caixa.mjs é o que gerar-saldo-da-caixa.mjs produz de lib/dominio", async () => {
    const ts = await import("typescript");
    const gerador = (await import(/* @vite-ignore */ pathToFileURL(resolve(RAIZ, "tools/corrigir-codigo-do-produto/gerar-saldo-da-caixa.mjs")).href)) as {
      gerar: (fonte: string, typescript: unknown) => string;
    };
    const fonte = readFileSync(resolve(RAIZ, "lib/dominio/src/saldo-da-caixa.ts"), "utf8");
    const esperado = gerador.gerar(fonte, ts.default ?? ts);
    expect(readFileSync(COPIA, "utf8").replace(/\r\n/g, "\n"), "saldo-da-caixa.mjs desatualizado: rode node tools/corrigir-codigo-do-produto/gerar-saldo-da-caixa.mjs").toBe(esperado);
  });

  it("as mesmas saídas nos casos com os ajustes da recontagem", async () => {
    const copia = (await import(/* @vite-ignore */ pathToFileURL(COPIA).href)) as typeof regra;
    for (const caso of casos.saldos) {
      const ajustes = (caso.ajustes ?? []) as LinhaDaCaixa[];
      expect(copia.saldoDaCaixa(caso.entrada as LinhaDaCaixa[], caso.retirado as LinhaDaCaixa[], ajustes), caso.caso).toEqual(
        regra.saldoDaCaixa(caso.entrada as LinhaDaCaixa[], caso.retirado as LinhaDaCaixa[], ajustes),
      );
    }
    for (const caso of casos.paraOContado) {
      expect(copia.ajusteParaOContado(caso.entrada as LinhaDaCaixa[], caso.retirado as LinhaDaCaixa[], caso.ajustes as LinhaDaCaixa[], caso.sku_code, caso.contado), caso.caso).toBe(caso.ajuste);
    }
  });
});
