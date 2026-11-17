import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import { warehouseBoxFromRecord } from "@/lib/warehouse-boxes";
import { contagemLida, prateleirasDaContagem, relatorioCaixasSaldo, type ContagemDoDia } from "@/lib/warehouse-ops/contagem-por-caixa";
import { telaDoWmsNaV3 } from "@/lib/wms-v3";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela } from "@/test/textos";

import { EstoqueContagemCaixasView, SEM_CONTAGENS_HOJE, SEM_PRATELEIRAS, type ContagensDeHoje, type EstadoDoRelatorio } from "./estoque-contagem-caixas-view";

/**
 * Estoque › Contagem › Caixas × saldo (diagnóstico da Contagem cíclica, seção
 * 6, item 1; o cartão "Caixas × saldo" de docs/mockups/WmsContagemRodada
 * .dc.html): a regra de ouro por prateleira, as diferentes primeiro, e as
 * contagens de hoje. Antes, nenhuma tela confrontava caixas e razão (achado
 * F04). Dados sintéticos.
 */

const BTG = "BTG";
const FOLHA = "/estoque/contagem/folha?rua=A";

const posicao = (code: string, sequence: number) => ({ code, aisle: code.split("-")[0], shelf: Number(code.split("-")[1]), sequence, customer_code: BTG });

const caixa = (code: string, location_id: string, extra: Record<string, unknown> = {}) =>
  warehouseBoxFromRecord({ code, customer_code: BTG, status: "stored", location_id, stored_at: "2026-10-20T12:00:00.000Z", unit_count: 0, origin: { kind: "opening_inventory", session_id: "s1" }, ...extra });

const RELATORIO = relatorioCaixasSaldo(
  prateleirasDaContagem({
    cliente: BTG,
    posicoes: [posicao("A-01", 1), posicao("A-02", 2), posicao("B-05", 20)],
    caixas: [caixa("CX-000001", "A-01", { unit_count: 4 }), caixa("CX-000006", "A-02", { unit_count: 40, taken_lines: [{ sku_code: "BTG-000141", qty: 5 }], taken_units: 5 })],
    abertura: [
      { box_code: "CX-000001", sku_code: "BTG-000061", counted_qty: 4, client_item_code: "A.02.0813.005.G", product_name: "Camiseta Pima Masculino Preta", size: "G" },
      { box_code: "CX-000006", sku_code: "BTG-000141", counted_qty: 40, client_item_code: "A.01.0809.002.M", product_name: "Polo Masculino Piquet Cinza", size: "M" },
    ],
    saldos: [
      { location_id: "A-01", sku_code: "BTG-000061", qty_on_hand: 4, customer_code: BTG },
      { location_id: "A-02", sku_code: "BTG-000141", qty_on_hand: 32, qty_reserved: 20, customer_code: BTG },
      { location_id: "B-05", sku_code: "BTG-000200", qty_on_hand: 12, customer_code: BTG, product_name: "Mochila Executiva", client_item_code: "C.0900.001.U" },
      // O local fora do cadastro com saldo.
      { location_id: "DEVOLUCAO", sku_code: "BTG-000061", qty_on_hand: 1, customer_code: BTG },
    ],
  }),
);

const CONTAGENS: ContagemDoDia[] = [
  contagemLida("cc_1", {
    customer_code: BTG,
    location_id: "A-02",
    sku_code: "BTG-000141",
    client_item_code: "A.01.0809.002.M",
    product_name: "Polo Masculino Piquet Cinza",
    size: "M",
    counted_qty: 32,
    qty_before: 35,
    adjustment_delta: -3,
    actor: { uid: "u1", name: "Guilherme Dantas" },
    occurred_at: "2026-11-17T11:41:00.000Z",
  })!,
];

const PRONTAS: ContagensDeHoje = { estado: "pronto", itens: CONTAGENS };

function render(estado: EstadoDoRelatorio, contagens: ContagensDeHoje = PRONTAS, extra: Partial<Parameters<typeof EstoqueContagemCaixasView>[0]> = {}) {
  return renderToStaticMarkup(
    <Router ssrPath="/estoque/contagem/caixas">
      <EstoqueContagemCaixasView estado={estado} relatorio={estado === "pronto" ? RELATORIO : null} contagens={contagens} hrefDaFolha={FOLHA} {...extra} />
    </Router>,
  );
}

describe("Estoque › Contagem › Caixas × saldo", () => {
  it("a tela nova já entra na v3", () => {
    expect(telaDoWmsNaV3("/estoque/contagem/caixas")).toBe(true);
  });

  it("só rótulos, dados e ações: as prateleiras que diferem primeiro, pela diferença, e as contagens de hoje", () => {
    expect(textosDaTela(render("pronto"))).toEqual([
      "Contagem",
      "Caixas × saldo",
      "Folha de contagem",
      "1 prateleira igual · 3 diferentes",
      "B-05",
      "caixas 0 · saldo 12 · 1 item difere",
      "−12",
      "A-02",
      "caixas 35 · saldo 32 · 1 item difere",
      "+3",
      "DEVOLUCAO",
      "caixas 0 · saldo 1 · 1 item difere · fora do cadastro",
      "−1",
      "A-01",
      "caixas 4 · saldo 4",
      "0",
      "Contagens de hoje",
      "Prateleira",
      "Item",
      "Antes",
      "Contado",
      "Diferença",
      "Quem",
      "Hora",
      "Polo Masculino Piquet Cinza · M",
      "A.01.0809.002.M · BTG-000141",
      "35",
      "32",
      "−3",
      "Guilherme Dantas",
      "08:41",
    ]);
  });

  it("a lista das prateleiras tem nome, e a diferença leva a cor do sinal", () => {
    const dom = new JSDOM(`<!doctype html><body>${render("pronto")}</body>`);
    const { document } = dom.window;
    const lista = document.querySelector('section[aria-label="Prateleiras"]');
    expect(lista).not.toBeNull();
    const diferencas = [...lista!.querySelectorAll("li > span:last-child")];
    expect(diferencas.map((span) => span.textContent)).toEqual(["−12", "+3", "−1", "0"]);
    expect(diferencas[0].className).toContain("text-destructive-soft-foreground");
    expect(diferencas[1].className).toContain("text-success-soft-foreground");
    expect(diferencas[3].className).toContain("text-foreground/50");
    // A tabela das contagens: uma linha por contagem, com o cabeçalho.
    expect([...document.querySelectorAll("table thead th")].map((th) => th.textContent)).toEqual(["Prateleira", "Item", "Antes", "Contado", "Diferença", "Quem", "Hora"]);
    expect(document.querySelectorAll("table tbody tr")).toHaveLength(1);
    // A folha de contagem da primeira rua, e a volta à Contagem.
    expect(document.querySelector(`a[href="${FOLHA}"]`)?.textContent).toBe("Folha de contagem");
    expect(document.querySelector('a[href="/wms/contagem"]')?.textContent).toBe("Contagem");
    dom.window.close();
  });

  it("carregando: a forma final com as linhas-fantasma, fora da leitura, e nenhum número antes de ler", async () => {
    const html = render("carregando", { estado: "carregando", itens: [] });
    expect(textosDaTela(html)).toEqual(["Contagem", "Caixas × saldo", "Folha de contagem"]);
    expect(html).toContain("data-esqueleto");
    expect(html).not.toContain("Nenhuma");
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("a falha nunca vira vazio: o aviso com Tentar de novo no lugar da lista", async () => {
    const erro = new Error("falhou");
    const html = render("erro", PRONTAS, { falha: { erro, leitura: { error: erro, refetch: async () => undefined } as never } });
    expect(textosDaTela(html)).toEqual(["Contagem", "Caixas × saldo", "Folha de contagem", "Não consegui carregar as prateleiras.", "Tentar de novo"]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("sem prateleira do cliente e sem contagem hoje, a tela diz só depois de ler", async () => {
    const html = renderToStaticMarkup(
      <Router ssrPath="/estoque/contagem/caixas">
        <EstoqueContagemCaixasView estado="pronto" relatorio={relatorioCaixasSaldo([])} contagens={{ estado: "pronto", itens: [] }} hrefDaFolha="/estoque/contagem/folha" />
      </Router>,
    );
    expect(textosDaTela(html)).toEqual(["Contagem", "Caixas × saldo", "Folha de contagem", SEM_PRATELEIRAS, "Contagens de hoje", SEM_CONTAGENS_HOJE]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("as contagens que não chegaram: a espera, ou a falha na própria seção, com as prateleiras na tela", async () => {
    const esperando = render("pronto", { estado: "carregando", itens: [] });
    expect(esperando).toContain("data-carregando-na-regiao");
    expect(textosDaTela(esperando)).toContain("1 prateleira igual · 3 diferentes");
    expect(textosDaTela(esperando)).not.toContain(SEM_CONTAGENS_HOJE);
    const falhou = render("pronto", { estado: "erro", itens: [], tentando: false, onTentar: async () => undefined });
    const textos = textosDaTela(falhou);
    expect(textos).toContain("Não consegui carregar as contagens de hoje.");
    expect(textos).toContain("Tentar de novo");
    expect(textos).toContain("A-02");
    expect(await violacoesDeAcessibilidade(falhou)).toEqual([]);
  });

  it("o cliente que não veio e o catálogo que não chegou: a tela diz", async () => {
    const semCliente = render("pronto", PRONTAS, { clienteFalhou: true });
    expect(textosDaTela(semCliente)).toEqual(["Contagem", "Caixas × saldo", "Folha de contagem", "Não consegui carregar o cliente ativo.", "Tentar de novo"]);
    const semCatalogo = render("pronto", PRONTAS, { catalogoFalhou: true, onTentar: async () => undefined });
    expect(textosDaTela(semCatalogo).slice(3, 5)).toEqual(["Não consegui carregar o catálogo.", "Tentar de novo"]);
    expect(await violacoesDeAcessibilidade(semCatalogo)).toEqual([]);
  });

  it("passa nas regras WCAG 2.1 A e AA do axe, e não leva valor", async () => {
    const html = render("pronto");
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
    expect(html).not.toMatch(/R\$|custo|preço|valor/i);
  });
});
