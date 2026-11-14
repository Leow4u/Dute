import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { textosDaTela } from "@/test/textos";

import { PageHeader } from "./page-header";

/**
 * O cabeçalho com a linha de estado (carregamento v2, seção 5.3; parte 7b):
 * a linha fica sob o título, numa fila só dela, da largura do cabeçalho, e
 * sempre abaixo das ações, nunca por baixo delas (nem quando elas quebram em
 * duas linhas); as ações são pintadas por cima do toque estendido do "Tentar
 * de novo". Sem a linha, o cabeçalho de sempre.
 */

/** As classes do elemento que contém o texto dado (o filho direto da grade do cabeçalho). */
function classesDe(html: string, marca: string): string {
  const fim = html.indexOf(marca);
  const inicio = html.lastIndexOf("<div class=\"", fim);
  return html.slice(inicio + '<div class="'.length, html.indexOf('"', inicio + '<div class="'.length));
}

describe("o cabeçalho de página", () => {
  const comLinha = renderToStaticMarkup(
    <PageHeader title="Pedidos" estado={<span>linha</span>} actions={<button type="button">Atualizar</button>} />,
  );

  it("com a linha de estado: no computador, uma grade em que a linha ocupa a segunda fila inteira, a 6 px do título", () => {
    // O título nunca fica mais estreito que ele mesmo: as ações quebram antes de cobri-lo.
    expect(comLinha).toMatch(/<div class="[^"]*\bsm:grid\b[^"]*\bsm:grid-cols-\[minmax\(min-content,1fr\)_auto\][^"]*\bsm:gap-y-1\.5\b/);
    const linha = classesDe(comLinha, "<span>linha</span>");
    expect(linha.split(" ")).toEqual(expect.arrayContaining(["sm:col-span-full", "sm:row-start-2", "min-w-0"]));
  });

  it("no celular, a linha fica 2 px sob o título (os 12 px da coluna menos 10), antes das ações", () => {
    expect(classesDe(comLinha, "<span>linha</span>").split(" ")).toEqual(expect.arrayContaining(["-mt-2.5", "sm:mt-0"]));
    expect(comLinha.indexOf("<h1")).toBeLessThan(comLinha.indexOf("<span>linha</span>"));
    expect(comLinha.indexOf("<span>linha</span>")).toBeLessThan(comLinha.indexOf("Atualizar"));
  });

  it("as ações ficam só na primeira fila, à direita, e a linha começa abaixo delas; elas ficam em cima do toque estendido do Tentar de novo", () => {
    const acoes = classesDe(comLinha, "<button").split(" ");
    expect(acoes).toEqual(expect.arrayContaining(["relative", "sm:col-start-2", "sm:row-start-1", "sm:self-start"]));
    // Nunca nas duas filas: quando quebram em duas linhas, a fila do título cresce e a linha desce com ela.
    expect(acoes.some((classe) => classe.startsWith("sm:row-span") || classe.startsWith("sm:row-end"))).toBe(false);
    // Entram 6 px na folga entre as filas (os 40 px delas contra os 36 do título): a linha fica a 6 px do título.
    expect(acoes).toContain("sm:-mb-1.5");
    // Posicionadas e depois da linha no HTML: são pintadas por cima do ::before do Tentar de novo.
    expect(comLinha.indexOf("<span>linha</span>")).toBeLessThan(comLinha.indexOf("<button"));
    expect(textosDaTela(comLinha)).toEqual(["Pedidos", "linha", "Atualizar"]);
  });

  it("sem a linha de estado, o cabeçalho de sempre, sem a grade", () => {
    const html = renderToStaticMarkup(<PageHeader title="Clientes" actions={<button type="button">Novo</button>} />);
    expect(html).not.toContain("sm:grid");
    expect(html).not.toContain("relative");
    expect(html).toContain('class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"');
  });
});
