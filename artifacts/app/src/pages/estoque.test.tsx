import { readFileSync } from "node:fs";

import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StockToolbar } from "@/components/stock/stock-workbench";
import type { StockItem } from "@/lib/stock-items";
import { telaDoWmsNaV3 } from "@/lib/wms-v3";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import type { LocalComDatas } from "@/lib/datas-de-entrada";
import { functionRoute } from "@/lib/functions-api";
import { textosDaTela, textosForaDaLista } from "@/test/textos";

import { ItemList, SecaoDoGiro, SecaoOndeEsta, buscarDatasDaFicha } from "./estoque";
import { payloadDaMovimentacao } from "./movements";

/**
 * O Estoque na v3 (parte 4.7d): a lista de itens com o código, o nome, o
 * endereço e os saldos; a busca com rótulo; o código sem o vermelho, que na
 * v3 é só da ação principal e do alerta. Os dias parado (parte 5.4c): as
 * etiquetas na lista e o giro e as caixas na ficha.
 */

const item = (key: string, extra: Partial<StockItem> = {}): StockItem => ({
  key,
  skuCode: `BTG-${key}`,
  name: "Camisa polo",
  detail: "M · azul",
  onHand: 12,
  reserved: 0,
  available: 12,
  locations: [{ id: "A-01-02", qty: 12 }],
  photos: ["foto.jpg"],
  low: false,
  zero: false,
  sku: {},
  ...extra,
} as StockItem);

const ITENS = [
  item("000001", { clientCode: "POLO-M-AZ" }),
  item("000002", { name: "Calça social", detail: "42", onHand: 0, available: 0, zero: true, photos: [], locations: [] }),
];

function lista(selectedKey?: string) {
  return renderToStaticMarkup(
    <div className="v3">
      <ItemList items={ITENS} selectedKey={selectedKey} onSelect={() => undefined} />
    </div>,
  );
}

describe("Estoque na v3", () => {
  it("a tela está na lista da v3; o Mapa, as Posições e as Etiquetas, ainda não", () => {
    expect(telaDoWmsNaV3("/estoque")).toBe(true);
    for (const tela of ["/estoque/mapa", "/estoque/posicoes", "/estoque/etiquetas"]) expect(telaDoWmsNaV3(tela), tela).toBe(false);
  });

  it("cada item com o código, o nome, o endereço, os saldos e o selo", () => {
    expect(textosDaTela(lista())).toEqual([
      "Item",
      "Endereço",
      "Saldo",
      "Disponível",
      "POLO-M-AZ",
      "Camisa polo",
      "· M · azul",
      "A-01-02",
      "12",
      "BTG-000002",
      "Calça social",
      "· 42",
      "Zerado",
      "Sem foto",
      "Sem endereço",
      "0",
    ]);
  });

  it("o código fica no texto, sem o vermelho da ação principal", () => {
    const html = lista();
    expect(html).toMatch(/<p class="font-mono text-sm font-bold text-foreground">POLO-M-AZ<\/p>/);
    expect(html).not.toMatch(/text-primary[^"]*">POLO-M-AZ/);
  });

  it("a busca do Estoque e do Histórico tem rótulo", () => {
    expect(readFileSync(new URL("./estoque.tsx", import.meta.url), "utf8")).toMatch(/<span className="sr-only">Buscar por código, nome ou endereço<\/span>/);
    const barra = renderToStaticMarkup(<StockToolbar search="" onSearchChange={() => undefined} placeholder="Buscar por SKU interno da movimentação" />);
    expect(barra).toMatch(/<label[^>]*><span class="sr-only">Buscar por SKU interno da movimentação<\/span>/);
  });

  it("quem só consulta (o suporte) não vê a Contagem, Registrar movimentação nem as ações da ficha", () => {
    const fonte = readFileSync(new URL("./estoque.tsx", import.meta.url), "utf8");
    expect(fonte.match(/href="\/wms\/contagem"/g)).toHaveLength(3);
    expect(fonte).toMatch(/\{warehouseWriter \? \(\s*<Button asChild variant="outline">\s*<Link href="\/wms\/contagem">/);
    expect(fonte).toMatch(/warehouseWriter \? \(\s*<Button asChild variant="outline" size="sm">\s*<Link href="\/wms\/contagem">/);
    expect(fonte).toMatch(/\{warehouseWriter \? \(\s*<div className="mt-auto flex/);
    expect(fonte).toContain('{tab === "history" && warehouseWriter ? (');
  });

  it("sem exemplo no motivo da movimentação", () => {
    expect(readFileSync(new URL("./movements.tsx", import.meta.url), "utf8")).not.toContain("Ex.:");
  });

  it("a movimentação vai para o cliente ativo, com o sinal do tipo", () => {
    const valores = {
      data: "2026-10-25T10:00",
      tipo_mov: "AJUSTE_ENTRADA",
      cod_sku: "ITAU-000001",
      produto: "Cadeira",
      qtde: 2,
      sinal: -1,
      origem: "",
      destino: "A-01-02",
      responsavel: "",
      doc_nf: "",
      motivo: "Contagem física",
    };
    expect(payloadDaMovimentacao(valores, "Itaú", "chave-1")).toEqual({
      ...valores,
      data: new Date("2026-10-25T10:00").toISOString(),
      sinal: 1,
      customer_code: "Itaú",
      idempotency_key: "chave-1",
    });
    expect(payloadDaMovimentacao({ ...valores, tipo_mov: "SAIDA" }, "Itaú", "chave-2")).toMatchObject({ sinal: -1, customer_code: "Itaú" });
  });

  it("passa nas regras WCAG 2.1 A e AA do axe", async () => {
    expect(await violacoesDeAcessibilidade(lista("000001"))).toEqual([]);
    expect(await violacoesDeAcessibilidade(renderToStaticMarkup(<StockToolbar search="" onSearchChange={() => undefined} placeholder="Buscar por SKU interno da movimentação" />))).toEqual([]);
  });
});

const GIRO = {
  relogio: { primeira_entrada: "2026-04-03T15:00:00.000Z", ultima_entrada: "2026-04-03T15:00:00.000Z", ultima_saida: "2026-07-12T15:00:00.000Z" },
  diasParado: 100,
  etiquetas: ["parado" as const, "sem_giro" as const],
  rotulos: ["Parado 90+ dias", "Sem giro"],
};

const CAIXAS = [
  { code: "CX-000001", posicao: "A-01", diasParado: 100, parada: true },
  { code: "CX-000003", posicao: "B-09", diasParado: 19, parada: false },
];

function giro(semGiro = false) {
  return renderToStaticMarkup(
    <div className="v3">
      {semGiro ? <SecaoDoGiro caixas={[]} rotuloDaCaixaParada="Parado 90+ dias" /> : <SecaoDoGiro giro={GIRO} caixas={CAIXAS} rotuloDaCaixaParada="Parado 90+ dias" />}
    </div>,
  );
}

describe("os dias parado no Estoque (parte 5.4c)", () => {
  it("a etiqueta na lista, junto das outras do item, sem o vermelho", () => {
    const html = renderToStaticMarkup(
      <div className="v3">
        <ItemList items={[item("000001", { clientCode: "POLO-M-AZ", giro: GIRO })]} onSelect={() => undefined} />
      </div>,
    );
    expect(textosDaTela(html)).toEqual(["Item", "Endereço", "Saldo", "Disponível", "POLO-M-AZ", "Camisa polo", "· M · azul", "A-01-02", "Parado 90+ dias", "Sem giro", "12"]);
    expect(html).toMatch(/bg-warning-soft text-warning-soft-foreground">Parado 90\+ dias</);
    expect(html).not.toMatch(/destructive[^"]*">Parado/);
  });

  it("a ficha mostra o giro e as caixas, com os dias de cada uma", () => {
    expect(textosDaTela(giro())).toEqual([
      "Giro",
      "Última entrada",
      "03/04/2026",
      "Última saída",
      "12/07/2026",
      "Sem movimento",
      "100 dias",
      "Parado 90+ dias",
      "Sem giro",
      "Caixas",
      "CX-000001",
      "A-01",
      "CX-000003",
      "B-09",
      "19 dias",
    ]);
  });

  it("sem a memória do item e sem caixa, a ficha não mostra nada", () => {
    expect(textosDaTela(giro(true))).toEqual([]);
  });

  it("passa nas regras WCAG 2.1 A e AA do axe", async () => {
    expect(await violacoesDeAcessibilidade(giro())).toEqual([]);
  });
});

describe("as datas de entrada na ficha (FIFO por data, parte 6)", () => {
  // A tela aprovada (docs/mockups/WmsItemDatas.dc.html), com o RECEBIMENTO a mais.
  const LOCAIS: LocalComDatas[] = [
    { local: "B-05", pecas: 16, datas: [{ desde: "2026-10-22", pecas: 16 }] },
    {
      local: "B-02",
      pecas: 90,
      datas: [
        { desde: "2026-10-30", pecas: 30 },
        { desde: "2026-11-03", pecas: 60 },
      ],
    },
    { local: "RECEBIMENTO", pecas: 40, datas: [] },
  ];
  const LOCATIONS = [
    { id: "B-02", qty: 90 },
    { id: "RECEBIMENTO", qty: 40 },
    { id: "B-05", qty: 16 },
  ];
  const secao = (locais: LocalComDatas[] | null, podeGuardar = false) =>
    renderToStaticMarkup(
      <div className="v3">
        <SecaoOndeEsta locations={LOCATIONS} locais={locais} podeGuardar={podeGuardar} onGuardar={() => undefined} />
      </div>,
    );
  /** Cada linha de "Onde está": o local, a data e a quantidade. */
  const linhas = (html: string) => {
    const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
    const resultado = [...dom.window.document.querySelectorAll("section li, section > div")].map((linha) =>
      [...linha.children].map((celula) => celula.textContent?.trim() ?? ""),
    );
    dom.window.close();
    return resultado;
  };

  afterEach(() => vi.unstubAllGlobals());

  it("uma linha por prateleira e data, a de data mais antiga primeiro, e o RECEBIMENTO no fim, sem data", () => {
    expect(linhas(secao(LOCAIS))).toEqual([
      ["B-05", "desde 22/10/2026", "16 un."],
      ["B-02", "desde 30/10/2026", "30 un."],
      ["B-02", "desde 03/11/2026", "60 un."],
      ["RECEBIMENTO", "", "40 un."],
    ]);
  });

  it("sem as datas (carregando, sem leitura ou com erro), a quantidade de cada local, como antes", () => {
    expect(linhas(secao(null))).toEqual([
      ["B-02", "90 un."],
      ["RECEBIMENTO", "40 un."],
      ["B-05", "16 un."],
    ]);
    expect(linhas(secao([]))).toHaveLength(3);
  });

  it("com as datas, a área continua com o Guardar para a coordenação (parte 7e), e a prateleira não", () => {
    const html = secao(LOCAIS, true);
    const botoes = [...html.matchAll(/aria-label="([^"]+)"[^>]*>Guardar<\/button>/g)].map((match) => match[1]);
    expect(botoes).toEqual(["Guardar do RECEBIMENTO"]);
    expect(html).toMatch(/bg-warning-soft text-warning-soft-foreground"[^>]*>RECEBIMENTO</);
    expect(html).toMatch(/bg-info-soft text-info-soft-foreground"[^>]*>B-05</);
  });

  it("o que as entradas não cobrem diz sem data", () => {
    const html = secao([{ local: "A-01", pecas: 25, datas: [{ desde: null, pecas: 10 }, { desde: "2026-10-30", pecas: 15 }] }], true);
    expect(linhas(html)).toEqual([
      ["A-01", "sem data", "10 un."],
      ["A-01", "desde 30/10/2026", "15 un."],
    ]);
  });

  it("só rótulos e dados, sem legenda, e passa no axe", async () => {
    const html = secao(LOCAIS, true);
    expect(textosForaDaLista(html, ["Onde está", "B-05", "B-02", "RECEBIMENTO", "Guardar", /^desde \d{2}\/\d{2}\/\d{4}$/, /^\d[\d.]* un\.$/])).toEqual([]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("a leitura vai ao getStockDates com o cliente ativo e o SKU no caminho, e deixa de fora o que não é local", async () => {
    const caminho = "/api/warehouse/stock-dates/BTG%20Pactual/BTG-000214";
    const route = functionRoute(caminho, "GET");
    expect(route?.name).toBe("getStockDates");
    expect(await route?.payload(caminho)).toEqual({ customer_code: "BTG Pactual", sku_code: "BTG-000214" });
    expect(functionRoute(caminho, "POST")).toBeNull();

    const chamadas: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      chamadas.push(url);
      return new Response(
        JSON.stringify({ datas: [], locais: [...LOCAIS, { local: "", pecas: 3, datas: [] }, { local: "C-01", pecas: 0, datas: [] }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    expect(await buscarDatasDaFicha("BTG Pactual", "BTG-000214")).toEqual(LOCAIS);
    expect(chamadas).toEqual([caminho]);
  });
});

describe("o Guardar do saldo parado numa área (decisão 16, parte 7e)", () => {
  const locais = [
    { id: "A-03", qty: 12 },
    { id: "RECEBIMENTO", qty: 30 },
    { id: "Expedição", qty: 2 },
    { id: "EXPEDICAO", qty: 0 },
  ];
  const secao = (podeGuardar: boolean) =>
    renderToStaticMarkup(<SecaoOndeEsta locations={locais} podeGuardar={podeGuardar} onGuardar={() => undefined} />);

  it("a coordenação vê o Guardar só no saldo de uma área, em qualquer grafia, e com peça", () => {
    const html = secao(true);
    const botoes = [...html.matchAll(/aria-label="([^"]+)"[^>]*>Guardar<\/button>/g)].map((match) => match[1]);
    expect(botoes).toEqual(["Guardar do RECEBIMENTO", "Guardar do Expedição"]);
  });

  it("quem não coordena não vê o Guardar", () => {
    expect(secao(false)).not.toContain(">Guardar</button>");
  });

  it("a área fica em âmbar e a prateleira, como antes", () => {
    const html = secao(true);
    expect(html).toMatch(/bg-warning-soft text-warning-soft-foreground"[^>]*>RECEBIMENTO</);
    expect(html).toMatch(/bg-info-soft text-info-soft-foreground"[^>]*>A-03</);
  });

  it("mostra só rótulos, dados e ações e passa no axe", async () => {
    const html = secao(true);
    expect(textosDaTela(html)).toEqual(["Onde está", "A-03", "12 un.", "RECEBIMENTO", "30 un.", "Guardar", "Expedição", "2 un.", "EXPEDICAO", "0 un."]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });
});

/** Sem rede (docs/plataforma/diagnostico-carregamento.md, decisão 2 do celular, de 06/11/2026). */
describe("Estoque sem conexão", () => {
  const fonte = readFileSync(new URL("./estoque.tsx", import.meta.url), "utf8");

  it("a lista lida fica com a hora; sem nada lido, o aviso; a falta de conexão não troca a lista pelo erro", () => {
    expect(fonte).toContain("const semRede = semConexaoNaLeitura(skus, balances, products);");
    expect(fonte).toMatch(/!skus\.isLoading && semRede && semRede\.lidaEm !== null \? \(\s*<FaixaSemConexao lidaEm=\{semRede\.lidaEm\} tentando=\{relendo\} onTentar=\{reler\} \/>/);
    const aviso = fonte.indexOf(") : semRede && semRede.lidaEm === null ? (");
    expect(aviso).toBeGreaterThan(fonte.indexOf("Carregando estoque..."));
    expect(aviso).toBeLessThan(fonte.indexOf("Não consegui carregar o estoque."));
    expect(fonte).toContain(") : skus.error && !semRede ? (");
  });
});
