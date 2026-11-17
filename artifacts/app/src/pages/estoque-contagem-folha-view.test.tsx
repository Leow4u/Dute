import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import { LINHAS_DA_PRATELEIRA_INTEIRA, cssDaFolha } from "@/features/warehouse-ops/lista-de-separacao-documento";
import { warehouseBoxFromRecord } from "@/lib/warehouse-boxes";
import { folhaDeContagem, prateleirasDaContagem, ruasDaContagem, type PrateleiraDaContagem } from "@/lib/warehouse-ops/contagem-por-caixa";
import { telaDoWmsNaV3 } from "@/lib/wms-v3";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela } from "@/test/textos";

import { EstoqueContagemFolhaView, RUA_NAO_ENCONTRADA, SEM_CATALOGO, SEM_PRATELEIRAS, type EstadoDaFolha } from "./estoque-contagem-folha-view";

/**
 * Estoque › Contagem › Folha de contagem (diagnóstico da Contagem cíclica,
 * seção 6, item 1; docs/mockups/WmsContagemFolha.dc.html): a folha A4 por rua
 * que quem conta leva ao corredor. Antes, não havia folha do que o sistema
 * espera em cada caixa (achado F04). Dados sintéticos.
 */

const noop = () => undefined;
const AGORA = new Date("2026-11-17T10:55:00.000Z"); // 07:55 em São Paulo
const BTG = "BTG";

const posicao = (code: string, sequence: number) => ({ code, aisle: code.split("-")[0], shelf: Number(code.split("-")[1]), sequence, customer_code: BTG });

const caixa = (code: string, location_id: string, extra: Record<string, unknown> = {}) =>
  warehouseBoxFromRecord({ code, customer_code: BTG, status: "stored", location_id, stored_at: "2026-10-20T12:00:00.000Z", unit_count: 0, origin: { kind: "opening_inventory", session_id: "s1" }, ...extra });

const PRATELEIRAS = prateleirasDaContagem({
  cliente: BTG,
  posicoes: [posicao("A-01", 1), posicao("A-02", 2), posicao("B-05", 20)],
  caixas: [
    caixa("CX-000001", "A-01", { unit_count: 4 }),
    // A caixa do recebimento com o destino confirmado, ainda a caminho.
    caixa("CX-000230", "A-01", {
      status: "committing",
      stored_at: null,
      unit_count: 10,
      origin: { kind: "receipt", receipt_id: "inb_2", invoice_number: "48.401" },
      lines: [{ sku_code: "BTG-000064", client_item_code: "A.01.0821.003.GG", product_name: "Camiseta Mescla Masculino Preta", size: "GG", counted_qty: 10 }],
    }),
    // A caixa aberta pela separação: saíram 5.
    caixa("CX-000006", "A-02", { unit_count: 40, taken_lines: [{ sku_code: "BTG-000141", qty: 5 }], taken_units: 5 }),
    // A caixa cadastrada à mão, sem conteúdo registrado.
    caixa("CX-000077", "B-05", { origin: { kind: "manual" } }),
  ],
  abertura: [
    { box_code: "CX-000001", sku_code: "BTG-000061", counted_qty: 4, client_item_code: "A.02.0813.005.G", product_name: "Camiseta Pima Masculino Preta", size: "G" },
    { box_code: "CX-000006", sku_code: "BTG-000141", counted_qty: 40, client_item_code: "A.01.0809.002.M", product_name: "Polo Masculino Piquet Cinza", size: "M" },
  ],
  saldos: [
    { location_id: "A-01", sku_code: "BTG-000061", qty_on_hand: 4, customer_code: BTG },
    // As caixas dizem 35; o razão tem 32, com 20 reservadas.
    { location_id: "A-02", sku_code: "BTG-000141", qty_on_hand: 32, qty_reserved: 20, customer_code: BTG },
    // O saldo sem caixa que o tenha.
    { location_id: "B-05", sku_code: "BTG-000200", qty_on_hand: 12, customer_code: BTG, product_name: "Mochila Executiva", client_item_code: "C.0900.001.U" },
  ],
});
const RUAS = ruasDaContagem(PRATELEIRAS);
const folhaDa = (rua: string, prateleiras: readonly PrateleiraDaContagem[] = PRATELEIRAS) =>
  folhaDeContagem({ rua, prateleiras, cliente: "BTG Pactual", por: "Guilherme Dantas", agora: AGORA });
const FOLHA_A = folhaDa("A");

function render(estado: EstadoDaFolha, rua: string | null, extra: Partial<Parameters<typeof EstoqueContagemFolhaView>[0]> = {}) {
  const folha = estado === "pronto" && rua && RUAS.includes(rua) ? folhaDa(rua) : null;
  return renderToStaticMarkup(
    <Router ssrPath="/estoque/contagem/folha">
      <EstoqueContagemFolhaView estado={estado} folha={folha} ruas={estado === "pronto" ? RUAS : []} rua={rua} onRua={noop} onImprimir={noop} {...extra} />
    </Router>,
  );
}

describe("Estoque › Contagem › Folha de contagem", () => {
  it("a tela nova já entra na v3", () => {
    expect(telaDoWmsNaV3("/estoque/contagem/folha?rua=A")).toBe(true);
  });

  it("só rótulos, dados e ações: a barra com as ruas, o cabeçalho da folha e as prateleiras da rua na ordem de caminhada", () => {
    expect(textosDaTela(render("pronto", "A"))).toEqual([
      "Contagem",
      "Folha de contagem",
      "Imprimir",
      "Rua A",
      "Rua B",
      "Cliente",
      "BTG Pactual",
      "Rodada",
      "Recontagem · 17/11/2026",
      "Prateleiras",
      "A-01 a A-02 · 2 caixas",
      "Impressa em",
      "17/11/2026 07:55",
      "Por",
      "Guilherme Dantas",
      "Caixa",
      "Produto",
      "Código",
      "Entrou",
      "Saiu",
      "Esperado",
      "Reserva",
      "Contado",
      "A-01",
      "1 caixa · 1 item · 4 un. · 1 a caminho",
      "caixas 4 · saldo 4",
      "CX-000001",
      "Camiseta Pima Masculino Preta · G",
      "A.02.0813.005.G",
      "BTG-000061",
      "4",
      "0",
      "—",
      "CX-000230",
      "a caminho",
      "Camiseta Mescla Masculino Preta · GG",
      "A.01.0821.003.GG",
      "BTG-000064",
      "10",
      "Fora da lista",
      "A-02",
      "1 caixa · 1 item · 35 un.",
      "caixas 35 · saldo 32",
      "CX-000006",
      "Polo Masculino Piquet Cinza · M",
      "A.01.0809.002.M",
      "BTG-000141",
      "40",
      "5",
      "35",
      "20",
      "app.dutelog.com.br",
    ]);
  });

  it("a rua sem caixa com saldo: a linha sem caixa com o saldo no esperado, e a caixa sem conteúdo registrado", () => {
    const textos = textosDaTela(render("pronto", "B"));
    expect(textos.slice(textos.indexOf("B-05"))).toEqual([
      "B-05",
      "1 caixa · 0 itens · 0 un.",
      "caixas 0 · saldo 12",
      "CX-000077",
      "sem conteúdo registrado",
      "—",
      "0",
      "sem caixa",
      "Mochila Executiva",
      "C.0900.001.U",
      "BTG-000200",
      "12",
      "Fora da lista",
      "app.dutelog.com.br",
    ]);
    expect(textos).toContain("B-05 · 1 caixa");
  });

  it("a folha: uma tabela, o cabeçalho que se repete, um grupo por prateleira com caixas × saldo, e Contado em branco", () => {
    const dom = new JSDOM(`<!doctype html><body>${render("pronto", "A")}</body>`);
    const { document } = dom.window;
    expect(document.querySelector("article.print-area")?.getAttribute("aria-label")).toBe("Folha de contagem Rua A");
    expect(document.querySelectorAll("table")).toHaveLength(1);
    expect([...document.querySelectorAll("thead th")].map((th) => th.textContent)).toEqual(["Caixa", "Produto", "Código", "Entrou", "Saiu", "Esperado", "Reserva", "Contado"]);
    const grupos = [...document.querySelectorAll("tbody")];
    expect(grupos.map((grupo) => grupo.querySelector("th")?.getAttribute("scope"))).toEqual(["rowgroup", "rowgroup"]);
    // A-01: o cabeçalho, a caixa guardada, a caixa a caminho e a "Fora da lista"; A-02: o cabeçalho, a caixa e a "Fora da lista".
    expect(grupos.map((grupo) => grupo.querySelectorAll("tr").length)).toEqual([4, 3]);
    // A linha não se parte entre duas folhas, e o cabeçalho da prateleira não fica sozinho no fim da folha.
    for (const tr of document.querySelectorAll("tbody tr")) expect(tr.className).toContain("break-inside-avoid");
    for (const grupo of grupos) expect(grupo.querySelector("tr")?.className).toContain("break-after-avoid");
    for (const grupo of grupos) expect(grupo.className).toBe("break-inside-avoid");
    // A prateleira que fecha, em tinta; a que não fecha, em vermelho.
    const regraDeOuro = grupos.map((grupo) => grupo.querySelector("th > span > span:last-child"));
    expect(regraDeOuro.map((span) => span?.textContent)).toEqual(["caixas 4 · saldo 4", "caixas 35 · saldo 32"]);
    expect(regraDeOuro[0]?.className).toContain("text-[#161616]");
    expect(regraDeOuro[1]?.className).toContain("text-[#8E1016]");
    // A linha da caixa: oito células; o "Contado" em branco é desenho, fora da leitura.
    const linha = grupos[0].querySelectorAll("tr")[1];
    const celulas = [...linha.querySelectorAll("td")];
    expect(celulas).toHaveLength(8);
    expect(celulas.map((td) => td.textContent)).toEqual(["CX-000001", "Camiseta Pima Masculino Preta · G", "A.02.0813.005.GBTG-000061", "4", "0", "4", "—", ""]);
    expect(celulas[7].querySelector("span")?.getAttribute("aria-hidden")).toBe("true");
    // A "Fora da lista": o produto, o código e o contado em branco.
    const fora = [...grupos[0].querySelectorAll("tr")].at(-1)!;
    expect(fora.querySelector("td")?.textContent).toBe("Fora da lista");
    expect(fora.querySelectorAll("td span[aria-hidden]")).toHaveLength(3);
    dom.window.close();
  });

  it("a barra e o rodapé da tela não saem no papel; o rodapé de cada página vem do @page, com a rua e a página", () => {
    const html = render("pronto", "A");
    const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
    const { document } = dom.window;
    expect(document.querySelector("h1")?.closest(".no-print")).not.toBeNull();
    expect(document.querySelector("footer")?.className).toContain("no-print");
    expect(document.querySelector("article style")?.textContent).toBe(cssDaFolha("Rua A"));
    dom.window.close();
    expect(cssDaFolha("Rua A")).toContain('@bottom-right { content: "Rua A · página " counter(page) " de " counter(pages);');
  });

  it("a prateleira com muitas linhas quebra onde a folha acabar; a pequena fica inteira", () => {
    const muitas = prateleirasDaContagem({
      cliente: BTG,
      posicoes: [posicao("A-01", 1), posicao("A-02", 2)],
      caixas: [caixa("CX-000001", "A-01", { unit_count: 1 }), ...Array.from({ length: LINHAS_DA_PRATELEIRA_INTEIRA }, (_, indice) => caixa(`CX-0001${String(indice).padStart(2, "0")}`, "A-02", { unit_count: 1 }))],
      abertura: [],
      saldos: [],
    });
    const dom = new JSDOM(`<!doctype html><body>${render("pronto", "A", { folha: folhaDa("A", muitas) })}</body>`);
    expect([...dom.window.document.querySelectorAll("tbody")].map((grupo) => [grupo.querySelector("th > span > span > span")?.textContent, grupo.className])).toEqual([
      ["A-01", "break-inside-avoid"],
      ["A-02", ""],
    ]);
    dom.window.close();
  });

  it("a rua escolhida fica em tinta e as outras levam à busca delas", () => {
    const dom = new JSDOM(`<!doctype html><body>${render("pronto", "B")}</body>`);
    const chips = [...dom.window.document.querySelectorAll('[role="group"][aria-label="Rua"] button')];
    expect(chips.map((chip) => [chip.textContent, chip.getAttribute("aria-pressed")])).toEqual([
      ["Rua A", "false"],
      ["Rua B", "true"],
    ]);
    dom.window.close();
  });

  it("carregando: a espera em bloco no lugar da folha, sem Imprimir", async () => {
    const html = render("carregando", null);
    expect(textosDaTela(html)).toEqual(["Contagem", "Folha de contagem", "Imprimir"]);
    expect(html).toContain("data-carregando-na-regiao");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Imprimir<\/button>/s);
    expect(html).not.toContain("print-area");
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("a falha nunca vira vazio: o aviso com Tentar de novo, e Imprimir desligado", async () => {
    const erro = new Error("falhou");
    const html = render("erro", null, { falha: { erro, leitura: { error: erro, refetch: async () => undefined } as never } });
    expect(textosDaTela(html)).toEqual(["Contagem", "Folha de contagem", "Imprimir", "Não consegui carregar a folha de contagem.", "Tentar de novo"]);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Imprimir<\/button>/s);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("sem prateleira do cliente, e com a rua que não existe, a tela diz; o cliente que não veio também", async () => {
    const semNada = renderToStaticMarkup(
      <Router ssrPath="/estoque/contagem/folha">
        <EstoqueContagemFolhaView estado="pronto" folha={null} ruas={[]} rua={null} onRua={noop} onImprimir={noop} />
      </Router>,
    );
    expect(textosDaTela(semNada)).toEqual(["Contagem", "Folha de contagem", "Imprimir", SEM_PRATELEIRAS]);
    expect(textosDaTela(render("pronto", "Z"))).toEqual(["Contagem", "Folha de contagem", "Imprimir", "Rua A", "Rua B", RUA_NAO_ENCONTRADA]);
    const semCliente = render("pronto", "A", { clienteFalhou: true });
    expect(textosDaTela(semCliente)).toEqual(["Contagem", "Folha de contagem", "Imprimir", "Rua A", "Rua B", "Não consegui carregar o cliente ativo.", "Tentar de novo"]);
    expect(semCliente).toMatch(/<button[^>]*disabled=""[^>]*>.*Imprimir<\/button>/s);
    expect(await violacoesDeAcessibilidade(semCliente)).toEqual([]);
  });

  it("o catálogo que não chegou vira aviso acima da folha, fora do papel; a folha continua para imprimir", async () => {
    const html = render("pronto", "A", { catalogoFalhou: true, onTentar: async () => undefined });
    const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
    const aviso = dom.window.document.querySelector('[role="alert"]');
    expect(aviso?.textContent).toContain(SEM_CATALOGO);
    expect(aviso?.closest(".no-print")).not.toBeNull();
    expect(aviso?.closest(".print-area")).toBeNull();
    dom.window.close();
    expect(html).toContain("print-area");
    expect(html).not.toMatch(/<button[^>]*disabled=""/);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("a caixa que rola a folha é uma região com nome, no Tab, com o anel; voltar leva à Contagem", () => {
    const html = render("pronto", "A");
    const caixa = new JSDOM(html).window.document.querySelector<HTMLElement>(".overflow-x-auto")!;
    expect(caixa.getAttribute("role")).toBe("region");
    expect(caixa.getAttribute("tabindex")).toBe("0");
    expect(caixa.getAttribute("aria-label")).toBe("Folha de contagem");
    expect(caixa.className).toContain("focus-visible:ring-foco");
    expect(html).toMatch(/<a [^>]*href="\/wms\/contagem"[^>]*>.*Contagem<\/a>/s);
  });

  it("passa nas regras WCAG 2.1 A e AA do axe", async () => {
    expect(await violacoesDeAcessibilidade(render("pronto", "A"))).toEqual([]);
    expect(await violacoesDeAcessibilidade(render("pronto", "B"))).toEqual([]);
    expect(await violacoesDeAcessibilidade(render("pronto", "Z"))).toEqual([]);
  });

  it("a folha não leva valor: nenhum R$, custo ou preço", () => {
    const html = render("pronto", "A");
    expect(html).not.toMatch(/R\$|custo|preço|valor/i);
    expect(FOLHA_A.grupos.flatMap((grupo) => grupo.caixas).every((caixaDaFolha) => !("total_cost" in caixaDaFolha))).toBe(true);
  });
});
