import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import { filtroInicial, osDoRelatorio, resumoDasOs, tabelaDaEquipe, tabelaPorPeriodo, type OsDoRelatorio } from "@/lib/operacao/relatorios";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela, textosForaDaLista } from "@/test/textos";

import { RelatoriosView, hrefDoRelatorio, resumoDasOsEmTexto, type RelatoriosViewProps } from "./relatorios-view";

/**
 * Os relatórios da Operação (parte 4.8a; docs/mockups/Relatorios.dc.html):
 * a lista, os filtros, os números e a tabela, com Excel e PDF. Sem valor e
 * sem legenda.
 */

const os = (numero: string, extra: Record<string, unknown> = {}) =>
  osDoRelatorio(numero, {
    numero,
    customer_code: "ITAU",
    cliente_nome: "Itaú Unibanco",
    status: "revisada",
    servicos: ["transporte"],
    janela: { data: "2026-10-06", fim: "12:00" },
    conclusao: { instante: "2026-10-06T14:30:00.000Z" },
    equipe: [{ colaborador_id: "col_ana", nome: "Ana Lima" }],
    veiculos: [{ veiculo_id: "vei_van", placa: "ABC1D23" }],
    valor_cents: 123456,
    ...extra,
  })!;

const OSS: OsDoRelatorio[] = [os("10050-01"), os("10050-02", { status: "cancelada", conclusao: null, janela: { data: "2026-10-14" } })];
const FILTRO = { ...filtroInicial("2026-10-23"), de: "2026-10-01" };
const noop = () => undefined;

function render(props: Partial<RelatoriosViewProps> = {}) {
  const base: RelatoriosViewProps = {
    relatorio: "periodo",
    filtro: FILTRO,
    clientes: [{ code: "ITAU", nome: "Itaú Unibanco" }],
    estado: "pronto",
    problema: null,
    resumo: resumoDasOsEmTexto(resumoDasOs(OSS)),
    tabela: tabelaPorPeriodo(OSS, "semana"),
    acoes: { mudarFiltro: noop, exportar: noop, imprimir: noop },
  };
  return renderToStaticMarkup(
    <Router ssrPath="/operacao/relatorios">
      <RelatoriosView {...base} {...props} />
    </Router>,
  );
}

describe("Relatórios da Operação", () => {
  it("o título, as exportações, a lista, os filtros, os números e a tabela, na ordem", () => {
    expect(textosDaTela(render())).toEqual([
      "Relatórios",
      "Excel",
      "PDF",
      "OS por período",
      "OS por cliente",
      "OS por tipo",
      "Produtividade da equipe",
      "Uso dos veículos",
      "Solicitações do portal",
      "De",
      "Até",
      "Cliente",
      "Todos",
      "Itaú Unibanco",
      "Agrupar",
      "Semana",
      "Mês",
      "01/10/2026 a 23/10/2026",
      "OS no período",
      "2",
      "Concluídas",
      "1",
      "Canceladas",
      "No prazo",
      "100%",
      "OS",
      "No prazo (%)",
      "05/10 – 11/10",
      "0",
      "12/10 – 18/10",
      "—",
      "Total",
    ]);
  });

  it("nenhum valor, mesmo com valor no documento da OS", () => {
    const html = render();
    expect(html).not.toMatch(/R\$|1\.234,56|123456/);
    expect(textosForaDaLista(html, [/^[^$]*$/])).toEqual([]);
  });

  it("o relatório aberto fica marcado; cada um tem o link dele", () => {
    const html = render({ relatorio: "equipe", resumo: resumoDasOsEmTexto(resumoDasOs(OSS)), tabela: tabelaDaEquipe(OSS) });
    expect(html).toMatch(/<a aria-current="page" href="\/operacao\/relatorios\?relatorio=equipe"/);
    expect(hrefDoRelatorio("periodo")).toBe("/operacao/relatorios");
    expect(textosDaTela(html)).toContain("Ana Lima");
    expect(textosDaTela(html)).not.toContain("Agrupar");
  });

  it("só o relatório vai para o PDF: os filtros, a lista e os botões ficam fora da impressão", () => {
    const html = render();
    expect(html).toMatch(/<section aria-labelledby="titulo-do-relatorio" class="print-area/);
    expect(html).toMatch(/<header class="no-print/);
    expect(html).toMatch(/<nav aria-label="Relatórios da Operação" class="no-print/);
  });

  it("filtro errado diz o que corrigir e não exporta; carregando e erro também não", () => {
    const comProblema = render({ problema: "O início vem antes do fim.", tabela: null, resumo: null });
    expect(comProblema).toMatch(/<p role="alert"[^>]*>O início vem antes do fim\.<\/p>/);
    for (const html of [comProblema, render({ estado: "carregando", tabela: null }), render({ estado: "erro", tabela: null })]) {
      expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*?Excel<\/button>/);
      expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*?PDF<\/button>/);
    }
    expect(render({ estado: "erro", tabela: null })).toContain("Não foi possível carregar.");
  });

  it("sem OS no período, a tabela diz que não há", () => {
    expect(textosDaTela(render({ tabela: tabelaPorPeriodo([], "semana"), resumo: resumoDasOsEmTexto(resumoDasOs([])) }))).toContain("Nenhuma OS no período.");
  });

  it("passa nas regras WCAG 2.1 A e AA do axe", async () => {
    expect(await violacoesDeAcessibilidade(render())).toEqual([]);
    expect(await violacoesDeAcessibilidade(render({ relatorio: "equipe", tabela: tabelaDaEquipe(OSS) }))).toEqual([]);
  });
});
