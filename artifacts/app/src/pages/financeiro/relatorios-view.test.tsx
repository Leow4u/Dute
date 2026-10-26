import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import { colunasDoResumo } from "@/components/relatorios/tela-de-relatorios";
import { faturaDoFinanceiro } from "@/lib/financeiro/faturas";
import { nfsEmAberto, resumoAReceber, resumoDaReceitaPorServico, tabelaAReceber, tabelaDaReceitaPorServico } from "@/lib/financeiro/relatorios";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela } from "@/test/textos";

import { RelatoriosDoFinanceiroView, hrefDoRelatorioDoFinanceiro, type RelatoriosDoFinanceiroViewProps } from "./relatorios-view";

/** Os relatórios do Financeiro (parte 4.8b): a lista, os filtros, os números e a tabela em reais; `axe`. */

const HOJE = "2026-10-23";
const FATURAS = [
  faturaDoFinanceiro(`fat_${"1".padStart(24, "0")}`, { customer_code: "ITAU", customer_name: "Itaú Unibanco", status: "emitida", valor_cents: 1_000_000, nf: { numero: "1001", emitida_em: "2026-10-01" }, vencimento: "2026-10-10" })!,
];
const ABERTAS = nfsEmAberto(FATURAS);
const noop = () => undefined;

function render(props: Partial<RelatoriosDoFinanceiroViewProps> = {}) {
  return renderToStaticMarkup(
    <Router ssrPath="/financeiro/relatorios">
      <RelatoriosDoFinanceiroView
        relatorio="a_receber"
        filtro={{ de: "2026-08-01", ate: HOJE, cliente: null }}
        hoje={HOJE}
        clientes={[{ code: "ITAU", nome: "Itaú Unibanco" }]}
        estado="pronto"
        problema={null}
        resumo={resumoAReceber(ABERTAS, HOJE)}
        tabela={tabelaAReceber(ABERTAS, HOJE)}
        acoes={{ mudarFiltro: noop, exportar: noop, imprimir: noop }}
        {...props}
      />
    </Router>,
  );
}

describe("Relatórios do Financeiro", () => {
  it("as contas a receber: a posição de hoje, sem período, com a idade em reais", () => {
    const textos = textosDaTela(render()).map((texto) => texto.replace(/\u00a0/g, " "));
    expect(textos.slice(0, 7)).toEqual(["Relatórios", "Excel", "PDF", "Receita por cliente", "Receita por serviço", "NFs emitidas por mês", "Contas a receber"]);
    expect(textos).not.toContain("De");
    expect(textos).toContain("Posição em 23/10/2026");
    expect(textos).toContain("1 a 30 dias");
    expect(textos).toContain("R$ 10.000,00");
  });

  it("a receita tem o período", () => {
    const textos = textosDaTela(render({ relatorio: "receita", resumo: null, tabela: { colunas: ["Cliente", "Pagamentos", "Recebido"], linhas: [], total: null } }));
    expect(textos).toContain("De");
    expect(textos).toContain("01/08/2026 a 23/10/2026");
    expect(textos).toContain("Nenhum pagamento no período.");
  });

  it("a receita por serviço: o recebido, os serviços, os pagamentos e o sem orçamento; a participação com a barra (pergunta 26)", async () => {
    const linhas = [
      { servico: "Transporte", cents: 6_230_000, pagamentos: 14 },
      { servico: "Montagem", cents: 4_188_000, pagamentos: 9 },
      { servico: "Sem orçamento", cents: 210_000, pagamentos: 1 },
    ];
    const html = render({ relatorio: "servico", resumo: resumoDaReceitaPorServico(linhas, 23), tabela: tabelaDaReceitaPorServico(linhas, 23) });
    const textos = textosDaTela(html).map((texto) => texto.replace(/\u00a0/g, " "));
    for (const texto of ["Receita por serviço", "Recebido", "R$ 106.280,00", "Serviços", "2", "Pagamentos", "23", "Sem orçamento", "R$ 2.100,00", "Serviço", "Participação (%)", "Transporte", "14", "R$ 62.300,00", "59%", "Total", "100%"]) {
      expect(textos, texto).toContain(texto);
    }
    expect(html).toContain('<a aria-current="page" href="/financeiro/relatorios?relatorio=servico"');
    // A barra é decoração: o leitor de tela lê o número.
    expect(html).toMatch(/<span aria-hidden="true" class="[^"]*"><span class="[^"]*" style="width:59%"><\/span><\/span>59%/);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("cada relatório tem o link dele", () => {
    expect(hrefDoRelatorioDoFinanceiro("receita")).toBe("/financeiro/relatorios");
    expect(hrefDoRelatorioDoFinanceiro("a_receber")).toBe("/financeiro/relatorios?relatorio=a_receber");
    expect(render()).toMatch(/<a aria-current="page" href="\/financeiro\/relatorios\?relatorio=a_receber"/);
  });

  it("valor em reais ocupa uma coluna no telefone; contagem cabe em duas", () => {
    const resumo = resumoAReceber(ABERTAS, HOJE);
    expect(colunasDoResumo(resumo)).toBe("grid-cols-1 @md:grid-cols-2 @5xl:grid-cols-4");
    expect(render()).toContain('class="grid gap-3 grid-cols-1 @md:grid-cols-2 @5xl:grid-cols-4"');
    expect(colunasDoResumo([{ rotulo: "OS no período", valor: "128" }, { rotulo: "No prazo", valor: "94%" }])).toBe("grid-cols-2 @3xl:grid-cols-4");
  });

  it("passa nas regras WCAG 2.1 A e AA do axe", async () => {
    expect(await violacoesDeAcessibilidade(render())).toEqual([]);
  });
});
