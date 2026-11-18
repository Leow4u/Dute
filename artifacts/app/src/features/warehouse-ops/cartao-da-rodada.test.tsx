import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { RodadaDaContagem } from "@/lib/warehouse-ops/recontagem-por-caixa";
import { textosForaDaLista } from "@/test/textos";

import { CartaoDaRodada } from "./cartao-da-rodada";

/**
 * O cartão da rodada, o mesmo na Contagem por caixa (o cabeçalho, h2) e na
 * entrada da Contagem ("Em andamento", h3 com a fila de ações; desenho de
 * 18/11/2026). Dados sintéticos; o dia da tela é outro, então o começo sai com
 * o dia.
 */

const AGORA = new Date("2026-11-18T14:30:00.000Z");
const RODADA: RodadaDaContagem = {
  rodada: "recontagem-geral-2026-11-17",
  titulo: "Recontagem geral · 17/11/2026",
  comeco: { quando: "2026-11-17T11:10:00.000Z", quem: "Guilherme Dantas" },
  prateleiras: 5,
  prateleirasContadas: 2,
  caixas: 6,
  caixasConfirmadas: 3,
  caixasComDiferenca: 1,
  diferenca: -3,
  ruas: [],
  continuar: "B-10",
};
const TEXTOS = [
  "Recontagem geral · 17/11/2026",
  "começou 17/11 08:10 · Guilherme Dantas",
  "prateleiras",
  "2",
  "de 5",
  "caixas",
  "3",
  "de 6",
  "caixas com diferença",
  "1",
  "diferença líquida",
  "−3 un.",
];

describe("o cartão da rodada", () => {
  it("na rodada: h2 com o id padrão, os números e a barra, sem fila de ações", () => {
    const html = renderToStaticMarkup(<CartaoDaRodada rodada={RODADA} agora={AGORA} />);
    expect(html).toContain('<h2 id="rodada-titulo"');
    expect(html).toContain('aria-labelledby="rodada-titulo"');
    expect(html).toContain("width:50%");
    expect(textosForaDaLista(html, TEXTOS)).toEqual([]);
    expect(html).not.toContain("data-acoes-da-rodada");
  });

  it("na entrada: h3 com o id dado e a fila de ações entre os números e a barra", () => {
    const html = renderToStaticMarkup(
      <CartaoDaRodada rodada={RODADA} agora={AGORA} titulo="h3" id="contagem-em-andamento" acoes={<a href="#">Continuar B-10</a>} />,
    );
    expect(html).toContain('<h3 id="contagem-em-andamento"');
    expect(html).toContain('aria-labelledby="contagem-em-andamento"');
    expect(html).not.toContain("<h2");
    expect(html).toContain("data-acoes-da-rodada");
    expect(textosForaDaLista(html, [...TEXTOS, "Continuar B-10"])).toEqual([]);
    expect(html.indexOf("Continuar B-10")).toBeGreaterThan(html.indexOf("diferença líquida"));
    expect(html.indexOf("Continuar B-10")).toBeLessThan(html.indexOf("width:50%"));
  });

  it("sem começo, só o título; sem caixa, a barra em zero", () => {
    const html = renderToStaticMarkup(<CartaoDaRodada rodada={{ ...RODADA, comeco: null, caixas: 0, caixasConfirmadas: 0 }} agora={AGORA} />);
    expect(html).not.toContain("começou");
    expect(html).toContain("width:0%");
  });
});
