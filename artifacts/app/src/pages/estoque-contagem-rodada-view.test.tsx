import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import { warehouseBoxFromRecord } from "@/lib/warehouse-boxes";
import type { LinhaDeEntrada } from "@/lib/warehouse-ops/caixas-da-separacao";
import { prateleirasDaContagem, relatorioCaixasSaldo } from "@/lib/warehouse-ops/contagem-por-caixa";
import { rodadaDaContagem, type Recontagem } from "@/lib/warehouse-ops/recontagem-por-caixa";
import { telaDoWmsNaV3 } from "@/lib/wms-v3";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela } from "@/test/textos";

import { EstoqueContagemRodadaView, SEM_PRATELEIRAS_COM_CAIXA, type EstadoDaRodada } from "./estoque-contagem-rodada-view";

/**
 * Estoque › Contagem por caixa, a rodada (diagnóstico da Contagem cíclica,
 * seção 6, item 4; docs/mockups/WmsContagemRodada.dc.html): as prateleiras
 * por rua com o estado da recontagem do dia, o que impede recontá-las e o
 * "Caixas × saldo" ao lado. Dados sintéticos.
 */

const BTG = "BTG Pactual";
const RODADA = "recontagem-2026-11-17";
const AGORA = new Date("2026-11-17T12:30:00.000Z");
const P = { sku_code: "BTG-000121", client_item_code: "A.01.0806.005.P", product_name: "Polo Masculino Piquet Preto", size: "P" };
const M = { sku_code: "BTG-000123", client_item_code: "A.01.0806.005.M", product_name: "Polo Masculino Piquet Preto", size: "M" };

const posicao = (code: string, sequence: number) => ({ code, aisle: code.split("-")[0], shelf: Number(code.split("-")[1]), sequence, customer_code: BTG });
const caixa = (code: string, location_id: string, extra: Record<string, unknown> = {}) =>
  warehouseBoxFromRecord({ code, customer_code: BTG, status: "stored", location_id, stored_at: "2026-10-20T12:00:00.000Z", unit_count: 60, origin: { kind: "opening_inventory", session_id: "s1" }, ...extra });

const CAIXAS = [caixa("CX-000010", "A-01"), caixa("CX-000011", "A-01"), caixa("CX-000020", "A-02"), caixa("CX-000030", "B-09")];
const ABERTURA: LinhaDeEntrada[] = [
  { box_code: "CX-000010", ...P, counted_qty: 60 },
  { box_code: "CX-000011", ...M, counted_qty: 60 },
  { box_code: "CX-000020", ...M, counted_qty: 60 },
  { box_code: "CX-000030", ...P, counted_qty: 60 },
];
const PRATELEIRAS = prateleirasDaContagem({
  cliente: BTG,
  posicoes: [posicao("A-01", 1), posicao("A-02", 2), posicao("B-09", 20)],
  caixas: CAIXAS,
  abertura: ABERTURA,
  saldos: [
    { location_id: "A-01", sku_code: P.sku_code, qty_on_hand: 60, customer_code: BTG },
    { location_id: "A-01", sku_code: M.sku_code, qty_on_hand: 60, customer_code: BTG },
    { location_id: "A-02", sku_code: M.sku_code, qty_on_hand: 63, customer_code: BTG },
    { location_id: "B-09", sku_code: P.sku_code, qty_on_hand: 60, customer_code: BTG },
  ],
});

const recontada = (code: string, posicaoDaCaixa: string, quando: string, diferenca = 0): Recontagem => ({
  id: `brc_${code}`,
  caixa: code,
  posicao: posicaoDaCaixa,
  rodada: RODADA,
  quando,
  quem: "Guilherme Dantas",
  esperado: 60,
  contado: 60 + diferenca,
  diferenca,
  vazia: false,
  itens: [],
});

const RODADA_DO_DIA = rodadaDaContagem({
  cliente: BTG,
  prateleiras: PRATELEIRAS,
  caixas: CAIXAS,
  recontagens: [recontada("CX-000010", "A-01", "2026-11-17T11:10:00.000Z"), recontada("CX-000011", "A-01", "2026-11-17T11:22:00.000Z", -3)],
  guardas: [{ status: "planned", customer_code: BTG, destination_location_id: "A-02", receipt_number: "AVL-7C21A9F0" }],
  reservas: [{ sku_code: P.sku_code, location_id: "B-09", status: "picked", order_number: "PED-0002", customer_code: BTG }],
  rodada: RODADA,
  agora: AGORA,
});

function render(estado: EstadoDaRodada = "pronto", extra: Partial<Parameters<typeof EstoqueContagemRodadaView>[0]> = {}) {
  return renderToStaticMarkup(
    <Router ssrPath="/estoque/contagem/rodada">
      <EstoqueContagemRodadaView
        estado={estado}
        rodada={estado === "pronto" ? RODADA_DO_DIA : null}
        relatorio={estado === "pronto" ? relatorioCaixasSaldo(PRATELEIRAS) : null}
        hrefDaFolha="/estoque/contagem/folha?rua=A"
        {...extra}
      />
    </Router>,
  );
}

describe("Estoque › Contagem por caixa, a rodada", () => {
  it("a tela nova já entra na v3", () => {
    expect(telaDoWmsNaV3("/estoque/contagem/rodada")).toBe(true);
  });

  it("só rótulos, dados e ações: a rodada, as prateleiras por rua com o estado e o Caixas × saldo", () => {
    expect(textosDaTela(render())).toEqual([
      "Contagem",
      "Contagem por caixa",
      "Caixas × saldo",
      "Imprimir folha",
      "Continuar A-02",
      "Recontagem · 17/11/2026",
      "começou 08:10 · Guilherme Dantas",
      "prateleiras",
      "1",
      "de 3",
      "caixas",
      "2",
      "de 4",
      "caixas com diferença",
      "diferença líquida",
      "−3 un.",
      "Rua A",
      "2 prateleiras · 1 contada",
      "A-01",
      "2 caixas",
      "2 itens · 120 un.",
      "contada 08:22 · 1 diferença · −3 un.",
      "Ver",
      "A-02",
      "1 caixa",
      "1 item · 60 un.",
      "guarda aberta · AVL-7C21A9F0",
      "Contar",
      "Rua B",
      "1 prateleira · por contar",
      "B-09",
      "em separação · PED-0002",
      "2 prateleiras iguais · 1 diferente",
      "caixas 60 · saldo 63",
      "−3",
      "Relatório completo",
    ]);
  });

  it("cada prateleira leva à bancada dela, e Continuar à prateleira por contar", () => {
    const dom = new JSDOM(`<!doctype html><body>${render()}</body>`);
    const links = [...dom.window.document.querySelectorAll("a")].map((link) => [link.textContent, link.getAttribute("href"), link.getAttribute("aria-label")]);
    expect(links).toContainEqual(["Ver", "/estoque/contagem/prateleira?posicao=A-01", "Ver A-01"]);
    expect(links).toContainEqual(["Contar", "/estoque/contagem/prateleira?posicao=B-09", "Contar B-09"]);
    expect(links).toContainEqual(["Continuar A-02", "/estoque/contagem/prateleira?posicao=A-02", null]);
    expect(links).toContainEqual(["Contagem", "/wms/contagem", null]);
    expect(links).toContainEqual(["Relatório completo", "/estoque/contagem/caixas", null]);
    dom.window.close();
  });

  it("carregando: a forma final com as linhas-fantasma, e nenhum número antes de ler", async () => {
    const html = render("carregando");
    expect(textosDaTela(html)).toEqual(["Contagem", "Contagem por caixa", "Caixas × saldo", "Imprimir folha"]);
    expect(html).toContain("data-esqueleto");
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("a falha nunca vira as prateleiras todas por contar: o aviso com Tentar de novo", async () => {
    const erro = new Error("falhou");
    const daFolha = render("erro", { falha: { erro, leitura: { error: erro, refetch: async () => undefined } as never } });
    expect(textosDaTela(daFolha)).toEqual(["Contagem", "Contagem por caixa", "Caixas × saldo", "Imprimir folha", "Não consegui carregar as prateleiras.", "Tentar de novo"]);
    expect(await violacoesDeAcessibilidade(daFolha)).toEqual([]);
    const aoVivo = render("erro", { aoVivo: { tentando: false, tentar: () => undefined, falta: "servidor", lidaEm: null } });
    expect(textosDaTela(aoVivo)).toEqual(["Contagem", "Contagem por caixa", "Caixas × saldo", "Imprimir folha", "Não consegui carregar as prateleiras.", "Tentar de novo"]);
  });

  it("sem prateleira com caixa do cliente, a tela diz só depois de ler", async () => {
    const vazia = rodadaDaContagem({ cliente: BTG, prateleiras: [], caixas: [], recontagens: [], guardas: [], reservas: [], rodada: RODADA, agora: AGORA });
    const html = render("pronto", { rodada: vazia, relatorio: relatorioCaixasSaldo([]) });
    const textos = textosDaTela(html);
    expect(textos).toContain(SEM_PRATELEIRAS_COM_CAIXA);
    expect(textos).not.toContain("começou");
    expect(textos.some((texto) => texto.startsWith("Continuar"))).toBe(false);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("passa nas regras WCAG 2.1 A e AA do axe, e não leva valor", async () => {
    const html = render();
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
    expect(html).not.toMatch(/R\$|custo|preço|valor/i);
  });
});
