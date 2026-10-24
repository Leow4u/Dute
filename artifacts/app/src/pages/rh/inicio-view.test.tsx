import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import { painelLido } from "@/lib/rh/ficha";
import { itensDoInicioDoRh } from "@/lib/rh/inicio";
import type { InicioDoRh } from "@/lib/rh/use-rh";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela, textosForaDaLista } from "@/test/textos";

import { InicioDoRhView } from "./inicio-view";

/**
 * Início do RH (parte 8.2c): quem tem registro vencido ou vencendo e, ao
 * lado, as pessoas ativas em números. Sem legenda. Dados sintéticos.
 */

// Sexta, 23/10/2026, 9h no fuso de quem roda: a saudação é "Bom dia".
const HOJE = new Date(2026, 9, 23, 9, 0);

const PAINEL = painelLido({
  hoje: "2026-10-23",
  colaboradores: [
    { id: "col_aaaaaaaaaaaaaaaa", nome: "Ana Souza", funcao: "Montadora", vinculo: "proprio", ativo: true, registros: 3, vencendo: 1, vencidos: 1, proximo_vencimento: "2026-11-01" },
    { id: "col_bbbbbbbbbbbbbbbb", nome: "Bruno Lima", funcao: "Motorista", vinculo: "terceiro", ativo: true, registros: 1, vencendo: 1, vencidos: 0, proximo_vencimento: "2026-10-28" },
    { id: "col_cccccccccccccccc", nome: "Carla Dias", funcao: "Ajudante", vinculo: "freelancer", ativo: true, registros: 0, vencendo: 0, vencidos: 0, proximo_vencimento: null },
  ],
  vencimentos: [
    { registro_id: "reg_aaaaaaaaaaaaaaa1", colaborador_id: "col_aaaaaaaaaaaaaaaa", nome: "Ana Souza", categoria: "treinamento", tipo: "nr35", descricao: null, vence_em: "2026-10-01", dias: -22 },
    { registro_id: "reg_bbbbbbbbbbbbbbb1", colaborador_id: "col_bbbbbbbbbbbbbbbb", nome: "Bruno Lima", categoria: "exame", tipo: "periodico", descricao: null, vence_em: "2026-10-28", dias: 5 },
    { registro_id: "reg_aaaaaaaaaaaaaaa2", colaborador_id: "col_aaaaaaaaaaaaaaaa", nome: "Ana Souza", categoria: "exame", tipo: "periodico", descricao: null, vence_em: "2026-11-01", dias: 9 },
  ],
})!;

function render(inicio: Partial<InicioDoRh> = {}) {
  const completo: InicioDoRh = { painel: PAINEL, itens: itensDoInicioDoRh(PAINEL.vencimentos), carregando: false, falhas: [], ...inicio };
  return renderToStaticMarkup(
    <Router ssrPath="/rh">
      <InicioDoRhView nome="Marina Alves" hoje={HOJE} inicio={completo} />
    </Router>,
  );
}

describe("Início do RH", () => {
  it("data, saudação, quantas pessoas esperam, os vencimentos por pessoa e os números", () => {
    expect(textosDaTela(render())).toEqual([
      "Sexta-feira, 23 de outubro",
      "Bom dia, Marina",
      "2 coisas",
      "precisam de você no RH.",
      "Precisa de você",
      "Ana Souza",
      "NR-35 (trabalho em altura) venceu há 22 dias · ASO periódico vence em 9 dias",
      "Abrir a ficha",
      "Bruno Lima",
      "ASO periódico vence em 5 dias",
      "Pessoas ativas",
      "3",
      "Registros vencidos",
      "1",
      "Vencem em 30 dias",
      "2",
      "Sem registro",
      "Abrir Pessoas",
    ]);
  });

  it("só rótulos, dados e ações: nenhum texto fora da lista", () => {
    const permitidos = [
      "Sexta-feira, 23 de outubro",
      "Bom dia, Marina",
      /^\d+ coisas?$/,
      /^precisam? de você no RH\.$/,
      "Nada parado no RH.",
      "Precisa de você",
      "Ana Souza",
      "Bruno Lima",
      /^[^·]+ (vence em \d+ dias|vence hoje|vence amanhã|venceu ontem|venceu há \d+ dias)( · [^·]+ (vence em \d+ dias|vence hoje|vence amanhã|venceu ontem|venceu há \d+ dias))*$/,
      "Abrir a ficha",
      "Pessoas ativas",
      /^\d+$/,
      "Registros vencidos",
      "Vencem em 30 dias",
      "Sem registro",
      "Abrir Pessoas",
    ];
    expect(textosForaDaLista(render(), permitidos)).toEqual([]);
    const vazio = render({ painel: { hoje: "2026-10-23", colaboradores: [], vencimentos: [] }, itens: [] });
    expect(textosForaDaLista(vazio, permitidos)).toEqual([]);
    expect(textosDaTela(vazio)).toContain("Nada parado no RH.");
  });

  it("a primeira ação é a principal e abre a ficha de quem tem o vencido; a falha da leitura diz o que não carregou", () => {
    const html = render();
    const acoes = [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*class="([^"]*)"[^>]*>(Abrir a ficha|Abrir Pessoas)<\/a>/g)];
    expect(acoes.map(([, href, , rotulo]) => [rotulo, href])).toEqual([
      ["Abrir a ficha", "/rh/ficha?colaborador=col_aaaaaaaaaaaaaaaa"],
      ["Abrir a ficha", "/rh/ficha?colaborador=col_bbbbbbbbbbbbbbbb"],
      ["Abrir Pessoas", "/rh/pessoas"],
    ]);
    expect(acoes[0][2]).toContain("bg-primary");
    for (const acao of acoes.slice(1)) expect(acao[2]).not.toContain("bg-primary");
    const falha = render({ painel: undefined, itens: [], falhas: ["pessoas e vencimentos"] });
    expect(textosDaTela(falha)).toContain("Não foi possível carregar: pessoas e vencimentos.");
  });

  it("acessibilidade: WCAG 2.1 A e AA", async () => {
    expect(await violacoesDeAcessibilidade(render())).toEqual([]);
  });
});
