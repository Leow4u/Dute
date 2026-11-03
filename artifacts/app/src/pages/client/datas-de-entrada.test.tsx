import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { functionRoute } from "@/lib/functions-api";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela, textosForaDaLista } from "@/test/textos";

import { DatasDeEntrada, buscarDatasDeEntrada, diaEmTexto, pecasEmTexto } from "./datas-de-entrada";

/**
 * As datas de entrada no detalhe do produto do portal
 * (docs/plataforma/fifo-por-data.md, parte 5; tela aprovada em
 * docs/mockups/PortalEstoqueDatas.dc.html).
 */

const TELA = [
  { desde: "2026-10-22", pecas: 16 },
  { desde: "2026-10-30", pecas: 30 },
  { desde: "2026-11-03", pecas: 60 },
];

describe("as datas de entrada do item no portal", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uma linha por dia, da mais antiga para a mais nova, como na tela aprovada", () => {
    expect(textosDaTela(renderToStaticMarkup(<DatasDeEntrada datas={TELA} />))).toEqual([
      "Por data de entrada",
      "desde 22/10/2026",
      "16 peças",
      "desde 30/10/2026",
      "30 peças",
      "desde 03/11/2026",
      "60 peças",
    ]);
  });

  it("o que as entradas não cobrem diz sem data; uma peça no singular; milhar com ponto", () => {
    const html = renderToStaticMarkup(
      <DatasDeEntrada datas={[{ desde: null, pecas: 1 }, { desde: "2026-10-30", pecas: 1200 }]} />,
    );
    expect(textosDaTela(html)).toEqual(["Por data de entrada", "sem data", "1 peça", "desde 30/10/2026", "1.200 peças"]);
    expect([diaEmTexto("2026-01-05"), pecasEmTexto(2)]).toEqual(["05/01/2026", "2 peças"]);
  });

  it("só rótulos e dados, sem legenda, e passa no axe", async () => {
    const html = renderToStaticMarkup(<DatasDeEntrada datas={[{ desde: null, pecas: 3 }, ...TELA]} />);
    expect(textosForaDaLista(html, ["Por data de entrada", "sem data", /^desde \d{2}\/\d{2}\/\d{4}$/, /^[\d.]+ peças?$/])).toEqual([]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("sem datas, nada aparece", () => {
    expect(renderToStaticMarkup(<DatasDeEntrada datas={[]} />)).toBe("");
  });

  it("a leitura vai ao getStockDates com o SKU do item e deixa de fora o que não é data", async () => {
    const route = functionRoute("/api/client/inventory/dates/BTG-000214", "GET");
    expect(route?.name).toBe("getStockDates");
    expect(await route?.payload("/api/client/inventory/dates/BTG-000214")).toEqual({ sku_code: "BTG-000214" });
    expect(functionRoute("/api/client/inventory/dates/BTG-000214", "POST")).toBeNull();

    const chamadas: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      chamadas.push(url);
      return new Response(
        JSON.stringify({
          datas: [...TELA, { desde: "ontem", pecas: 2 }, { desde: "2026-11-01", pecas: 0 }, { desde: null, pecas: 4 }],
          locais: [{ local: "B-05" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    expect(await buscarDatasDeEntrada("BTG 214/GG")).toEqual([...TELA, { desde: null, pecas: 4 }]);
    expect(chamadas).toEqual(["/api/client/inventory/dates/BTG%20214%2FGG"]);
  });

  it("a leitura que falha não vira data nenhuma: o erro sobe para a tela esconder a seção", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ message: "Falha" }), { status: 500 }));
    await expect(buscarDatasDeEntrada("BTG-000214")).rejects.toThrow("Não consegui carregar as datas de entrada.");
  });
});
