import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import { LINHAS_DA_PRATELEIRA_INTEIRA, cssDaFolha } from "@/features/warehouse-ops/lista-de-separacao-documento";
import { folhaDaLista, gruposDaSeparacao, type CaixaDaLista, type FolhaDaLista } from "@/lib/warehouse-ops/lista-de-separacao";
import type { WarehouseTaskItem } from "@/lib/warehouse-ops/model";
import { telaDoWmsNaV3 } from "@/lib/wms-v3";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela } from "@/test/textos";

import { PedidosListaView, type EstadoDaLista } from "./pedidos-lista-view";

/**
 * Pedidos › Lista de separação (separação com caixas, parte 1b;
 * docs/mockups/WmsSepararListaImpressa.dc.html): a folha A4 que quem separa
 * leva ao corredor. Antes, a lista não imprimia. Dados sintéticos.
 */

const noop = () => undefined;
const AGORA = new Date("2026-11-10T17:20:00.000Z"); // 14:20 em São Paulo

function linha(numero: number, location: string | null, nome: string, codigo: string, sku: string, quantidade: number): WarehouseTaskItem {
  return { id: `pli_ord_1_${String(numero).padStart(2, "0")}`, line_number: numero, location, product_name: nome, client_item_code: codigo, sku_code: sku, expected_quantity: quantidade };
}

function caixa(code: string, location: string, skus: string[]): CaixaDaLista {
  return { code, customer_code: "BTG", status: "stored", location_id: location, sku_codes: skus, stored_at: "2026-10-20T12:00:00.000Z" };
}

const ITENS = [
  linha(1, "B-09", "Porta Cartão Couro", "B.0567.005.U", "BTG-000211", 6),
  linha(2, "A-03", "Polo Masculino Piquet Preto M", "A.01.0806.005.M", "BTG-000123", 1200),
  linha(3, "A-03", "Polo Masculino Piquet Preto P", "A.01.0806.005.P", "BTG-000122", 60),
  linha(4, null, "Caneca Térmica Fokus", "C.0734.003.U", "BTG-000193", 1),
];

const FOLHA = folhaDaLista({
  numero: "PED-0001",
  cliente: "BTG Pactual",
  destino: "Agência Faria Lima",
  paraQuando: "2026-11-16T14:36:00.000Z",
  por: "Guilherme Dantas",
  agora: AGORA,
  grupos: gruposDaSeparacao(
    ITENS,
    [
      { code: "A-03", sequence: 3 },
      { code: "B-09", sequence: 24 },
    ],
    {
      cliente: "BTG",
      caixas: [caixa("CX-000010", "A-03", ["BTG-000122"]), caixa("CX-000011", "A-03", ["BTG-000123"]), caixa("CX-000012", "A-03", ["BTG-000123"]), caixa("CX-000190", "B-09", ["BTG-000211"])],
    },
  ),
});

function render(estado: EstadoDaLista, folha: FolhaDaLista | null, avisos?: string[]) {
  return renderToStaticMarkup(
    <Router ssrPath="/pedidos/lista">
      <PedidosListaView estado={estado} folha={folha} avisos={avisos} onImprimir={noop} />
    </Router>,
  );
}

describe("Pedidos › Lista de separação", () => {
  it("a tela nova já entra na v3", () => {
    expect(telaDoWmsNaV3("/pedidos/lista?pedido=ord_1")).toBe(true);
  });

  it("só rótulos, dados e ações: a barra, o cabeçalho do pedido e as prateleiras na ordem de caminhada", () => {
    expect(textosDaTela(render("pronto", FOLHA))).toEqual([
      "Pedidos",
      "Lista de separação",
      "Imprimir",
      "PED-0001",
      "Cliente",
      "BTG Pactual",
      "Destino",
      "Agência Faria Lima",
      "Para quando",
      "Seg 16/11/2026 11:36",
      "Pedido",
      "4 itens · 1.267 un.",
      "Impressa em",
      "10/11/2026 14:20",
      "Por",
      "Guilherme Dantas",
      "Conferido",
      "Produto",
      "Código",
      "Caixa",
      "Qtd.",
      "Separado",
      "A-03",
      "2 itens · 1.260 un.",
      "Polo Masculino Piquet Preto · P",
      // O código do cliente e o SKU: cada um num pedaço que não quebra, o separador junto do primeiro.
      "A.01.0806.005.P ·",
      "BTG-000122",
      "CX-000010",
      "60",
      "Polo Masculino Piquet Preto · M",
      "A.01.0806.005.M ·",
      "BTG-000123",
      "CX-000011 ·",
      "CX-000012",
      "1.200",
      "B-09",
      "1 item · 6 un.",
      "Porta Cartão Couro",
      "B.0567.005.U ·",
      "BTG-000211",
      "CX-000190",
      "6",
      "sem endereço",
      "1 item · 1 un.",
      "Caneca Térmica Fokus",
      "C.0734.003.U ·",
      "BTG-000193",
      "1",
      "app.dutelog.com.br",
    ]);
  });

  it("a folha: uma tabela, o cabeçalho que se repete, um grupo por prateleira, o quadrado para marcar e Separado em branco", () => {
    const dom = new JSDOM(`<!doctype html><body>${render("pronto", FOLHA)}</body>`);
    const { document } = dom.window;
    const folha = document.querySelector("article.print-area");
    expect(folha?.getAttribute("aria-label")).toBe("Lista de separação PED-0001");
    expect(document.querySelectorAll("table")).toHaveLength(1);
    expect([...document.querySelectorAll("thead th")].map((th) => th.textContent)).toEqual(["Conferido", "Produto", "Código", "Caixa", "Qtd.", "Separado"]);
    const grupos = [...document.querySelectorAll("tbody")];
    expect(grupos.map((grupo) => grupo.querySelector("th")?.getAttribute("scope"))).toEqual(["rowgroup", "rowgroup", "rowgroup"]);
    expect(grupos.map((grupo) => grupo.querySelectorAll("tr").length)).toEqual([3, 2, 2]);
    // A linha não se parte entre duas folhas, e o cabeçalho da prateleira não fica sozinho no fim da folha.
    for (const tr of document.querySelectorAll("tbody tr")) expect(tr.className).toContain("break-inside-avoid");
    for (const grupo of grupos) expect(grupo.querySelector("tr")?.className).toContain("break-after-avoid");
    // A prateleira pequena fica inteira numa folha.
    for (const grupo of grupos) expect(grupo.className).toBe("break-inside-avoid");
    // Cada código fica inteiro na linha, e o separador vai junto do código anterior, nunca no começo da linha.
    const [, , codigos, caixas] = [...grupos[0].querySelectorAll("tr")[2].querySelectorAll("td")];
    expect(caixas.textContent).toBe("CX-000011 · CX-000012");
    expect([...caixas.querySelectorAll("span")].map((span) => [span.textContent, span.className])).toEqual([
      ["CX-000011 ·", "whitespace-nowrap"],
      ["CX-000012", "whitespace-nowrap"],
    ]);
    expect(codigos.textContent).toBe("A.01.0806.005.M · BTG-000123");
    expect([...codigos.querySelectorAll("span")].map((span) => span.textContent)).toEqual(["A.01.0806.005.M ·", "BTG-000123"]);
    const primeira = grupos[0].querySelectorAll("tr")[1];
    const celulas = [...primeira.querySelectorAll("td")];
    expect(celulas).toHaveLength(6);
    // O quadrado e a linha em branco são desenho: não têm texto nem entram na leitura.
    expect(celulas[0].textContent).toBe("");
    expect(celulas[0].querySelector("span")?.getAttribute("aria-hidden")).toBe("true");
    expect(celulas[5].textContent).toBe("");
    expect(celulas[5].querySelector("span")?.getAttribute("aria-hidden")).toBe("true");
    dom.window.close();
  });

  it("a barra e o rodapé da tela não saem no papel; o rodapé de cada página vem do @page, com o pedido e a página", () => {
    const html = render("pronto", FOLHA);
    const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
    const { document } = dom.window;
    expect(document.querySelector("h1")?.closest(".no-print")).not.toBeNull();
    expect(document.querySelector("footer")?.className).toContain("no-print");
    expect(document.querySelector("article style")?.textContent).toBe(cssDaFolha("PED-0001"));
    dom.window.close();
    const css = cssDaFolha("PED-0001");
    expect(css).toContain("size: A4;");
    expect(css).toContain('@bottom-left { content: "app.dutelog.com.br";');
    expect(css).toContain('@bottom-right { content: "PED-0001 · página " counter(page) " de " counter(pages);');
    // O número do pedido entra numa string do CSS: aspas e barra não fecham a string.
    expect(cssDaFolha('PED"} body{display:none}\\')).toContain('content: "PED } body{display:none} · página "');
  });

  it("a prateleira com muitas linhas quebra onde a folha acabar; a pequena fica inteira", () => {
    const muitas = Array.from({ length: LINHAS_DA_PRATELEIRA_INTEIRA + 1 }, (_, indice) => linha(indice + 1, "B-09", `Copo ${indice + 1}`, `B.${indice + 1}.U`, `BTG-${indice + 1}`, 1));
    const folha = folhaDaLista({ numero: "PED-0003", agora: AGORA, grupos: gruposDaSeparacao([...muitas, linha(99, "A-03", "Polo", "A.1.M", "BTG-99", 1)]) });
    const dom = new JSDOM(`<!doctype html><body>${render("pronto", folha)}</body>`);
    const grupos = [...dom.window.document.querySelectorAll("tbody")];
    expect(grupos.map((grupo) => [grupo.querySelector("th span")?.textContent, grupo.className])).toEqual([
      ["A-03", "break-inside-avoid"],
      ["B-09", ""],
    ]);
    dom.window.close();
  });

  it("sem destino, sem prazo e sem o nome de quem imprime, o campo fica com o traço", () => {
    const semDados = folhaDaLista({ numero: "PED-0002", agora: AGORA, grupos: gruposDaSeparacao([ITENS[0]]) });
    const textos = textosDaTela(render("pronto", semDados));
    expect(textos).toContain("—");
    expect(textos).toContain("1 item · 6 un.");
    expect(textos.filter((texto) => texto.startsWith("CX-"))).toEqual([]);
  });

  it("carregando, pedido não encontrado e erro: a mensagem no lugar da folha, com Imprimir desligado", () => {
    for (const [estado, mensagem] of [
      ["nao_encontrado", "Pedido não encontrado"],
      ["erro", "Não foi possível carregar o pedido."],
    ] as const) {
      const html = render(estado, null);
      expect(textosDaTela(html)).toEqual(["Pedidos", "Lista de separação", "Imprimir", mensagem]);
      expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Imprimir<\/button>/s);
      expect(html).not.toContain("print-area");
    }
    expect(render("erro", null)).toContain('role="alert"');
    expect(render("pronto", FOLHA)).not.toMatch(/<button[^>]*disabled=""/);
  });

  it("a leitura que falhou vira aviso acima da folha, fora do papel; a folha continua para imprimir", async () => {
    const html = render("pronto", FOLHA, ["Não foi possível carregar as caixas."]);
    const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
    const aviso = dom.window.document.querySelector('[role="alert"]');
    expect(aviso?.textContent).toBe("Não foi possível carregar as caixas.");
    expect(aviso?.className).toContain("no-print");
    expect(aviso?.closest(".print-area")).toBeNull();
    dom.window.close();
    expect(html).toContain("print-area");
    expect(html).not.toMatch(/<button[^>]*disabled=""/);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("voltar leva a Pedidos", () => {
    expect(render("pronto", FOLHA)).toMatch(/<a [^>]*href="\/pedidos"[^>]*>.*Pedidos<\/a>/s);
  });

  it("passa nas regras WCAG 2.1 A e AA do axe", async () => {
    expect(await violacoesDeAcessibilidade(render("pronto", FOLHA))).toEqual([]);
    expect(await violacoesDeAcessibilidade(render("nao_encontrado", null))).toEqual([]);
    expect(await violacoesDeAcessibilidade(render("erro", null))).toEqual([]);
  });
});

describe("a lista de separação carregando (carregamento v2, parte 13c)", () => {
  it("a espera em bloco no lugar da folha, sem o \"Carregando\" seco, e Imprimir desligado", async () => {
    const html = render("carregando", null);
    expect(textosDaTela(html)).toEqual(["Pedidos", "Lista de separação", "Imprimir"]);
    expect(html).toContain("data-carregando-na-regiao");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Imprimir<\/button>/s);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });
});
