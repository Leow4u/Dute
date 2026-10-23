import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import { faturaDoFinanceiro } from "@/lib/financeiro/faturas";
import { chaveDaRevisao, demonstrativoDaNf } from "@/lib/financeiro/nf-documento";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela } from "@/test/textos";

import { NfView, type EstadoDaVia } from "./nf-view";

/**
 * A via comercial da NF para imprimir (parte 4.2d): a barra (Faturas e
 * Imprimir, a única ação principal) e o papel com a cobrança, cada demanda
 * com as linhas e o total da NF. Sem legenda. Dados sintéticos.
 */

const FATURA = faturaDoFinanceiro("fat_000000000000000000001234", {
  customer_code: "ITAU",
  customer_name: "Itaú Unibanco",
  status: "emitida",
  valor_cents: 1_034_000,
  nf: { numero: "1234", serie: "1", emitida_em: "2026-10-20" },
  vencimento: "2026-11-20",
  forma: "pix",
  demandas: [{ numero: "10045", rv: 2, autorizacao_ids: ["aut_itau"], valor_cents: 1_034_000 }],
})!;

const DOCUMENTO = demonstrativoDaNf(FATURA, {
  demandas: new Map(),
  revisoes: new Map([
    [
      chaveDaRevisao("10045", 2),
      {
        demanda: { titulo: "Desmontagem de mobiliário", ref_cliente: "CE0045" },
        linhas: [
          { id: "l1", origem: "tabela", item: "Montador", descricao: "Montador de móveis", unidade: "h", quantidade: "12", preco: "88.50", total_cents: 106_200 },
          { id: "l2", origem: "tabela", item: "Caminhão 3/4", unidade: "diária", quantidade: "2", preco: "4638.90", total_cents: 927_800 },
        ],
      },
    ],
  ]),
  medicoes: new Map(),
  autorizacoes: new Map([["aut_itau", { pedido: "4500000009", aceite: "ACE-1" }]]),
});

function render(estado: EstadoDaVia = "pronto", documento = DOCUMENTO) {
  return renderToStaticMarkup(
    <Router ssrPath="/financeiro/nf">
      <NfView estado={estado} documento={estado === "pronto" ? documento : null} voltar={`/financeiro/faturas?nf=${FATURA.id}`} onImprimir={() => undefined} />
    </Router>,
  );
}

const PRINCIPAL = /<button[^>]*class="[^"]*bg-primary text-primary-foreground[^"]*"[^>]*>[\s\S]*?<\/button>/g;

describe("via comercial da NF", () => {
  it("a barra e o papel, na ordem, sem legenda", () => {
    expect(textosDaTela(render())).toEqual([
      "Faturas",
      "Via comercial da NF 1234",
      "Imprimir",
      "Dutelog Soluções Logísticas",
      "Demonstrativo de faturamento",
      "NF 1234",
      "Itaú Unibanco",
      "Cobrança",
      "Cliente",
      "Emissão",
      "20/10/2026",
      "Vencimento",
      "20/11/2026",
      "Forma de pagamento",
      "Pix",
      "Demanda 10045 – RV02",
      "Desmontagem de mobiliário · Ref. CE0045 · Pedido 4500000009 · aceite ACE-1",
      "Item",
      "Unid.",
      "Qtde",
      "Valor unit.",
      "Total",
      "Montador",
      "h",
      "12",
      "88,50",
      "1.062,00",
      "Caminhão 3/4",
      "diária",
      "2",
      "4.638,90",
      "9.278,00",
      "Total da demanda",
      "R$ 10.340,00",
      "Total da NF",
      "app.dutelog.com.br",
      "NF 1234 · via comercial",
    ]);
  });

  it("uma ação principal, Imprimir; Faturas volta à lista com a NF aberta; só o papel imprime", () => {
    const html = render();
    const principais = html.match(PRINCIPAL) ?? [];
    expect(principais).toHaveLength(1);
    expect(textosDaTela(principais[0] ?? "")).toEqual(["Imprimir"]);
    expect(html).toContain(`href="/financeiro/faturas?nf=${FATURA.id}"`);
    expect(html).toMatch(/<div class="no-print /);
    expect(html).toMatch(/<article aria-label="NF 1234" class="print-area /);
  });

  it("carregando, não encontrada e erro dizem o que é, e Imprimir fica desligado", () => {
    expect(textosDaTela(render("carregando"))).toEqual(["Faturas", "Via comercial", "Imprimir", "Carregando..."]);
    expect(textosDaTela(render("nao_encontrada"))).toEqual(["Faturas", "Via comercial", "Imprimir", "NF não encontrada"]);
    expect(render("erro")).toMatch(/<p role="alert"[^>]*>Não foi possível carregar a NF\.<\/p>/);
    expect(render("carregando")).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Imprimir/);
  });

  it("passa nas regras WCAG 2.1 A e AA do axe", async () => {
    expect(await violacoesDeAcessibilidade(render())).toEqual([]);
    expect(await violacoesDeAcessibilidade(render("carregando"))).toEqual([]);
  });
});
