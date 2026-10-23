import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import { autorizacaoDoFinanceiro, demandaDoFinanceiro, linhaAFaturar, pendenciasDoFinanceiro, type LinhaAFaturar } from "@/lib/financeiro/a-faturar";
import { ROTA_A_FATURAR } from "@/lib/financeiro/navegacao";
import type { InicioDoFinanceiro } from "@/lib/financeiro/use-a-faturar";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela, textosForaDaLista } from "@/test/textos";

import { InicioDoFinanceiroView } from "./inicio-view";

/**
 * Início do Financeiro (parte 4.1b): o que espera a pessoa e, ao lado, a fila
 * A faturar em números. Sem legenda. Dados sintéticos.
 */

// Sexta, 23/10/2026, 9h no fuso de quem roda: a saudação é "Bom dia".
const HOJE = new Date(2026, 9, 23, 9, 0);

const AUTORIZACOES = new Map([["aut_itau", autorizacaoDoFinanceiro("aut_itau", { customer_code: "ITAU", status: "registrada", pedido: "4500000009" })]]);

function linha(numero: string, extra: Record<string, unknown>, valor: number | null): LinhaAFaturar {
  const demanda = demandaDoFinanceiro(numero, {
    customer_code: "ITAU",
    customer_name: "Itaú Unibanco",
    etapa: "a_faturar",
    etapa_desde: "2026-10-20T12:00:00.000Z",
    validacao: { rv: 1, autorizacao: "pedido_aceite" },
    autorizacao_ids: ["aut_itau"],
    ...extra,
  })!;
  return linhaAFaturar(demanda, AUTORIZACOES, valor);
}

const LINHAS = [
  linha("10045", {}, 1_234_500),
  linha("10046", { customer_code: "SAFRA", customer_name: "Banco Safra", validacao: { rv: 0, autorizacao: "nenhuma" }, autorizacao_ids: [] }, 250_000),
  linha("10047", { etapa: "aguardando_autorizacao" }, 90_000),
];

function render(inicio: Partial<InicioDoFinanceiro> = {}, nome = "Carla Mendes") {
  const completo: InicioDoFinanceiro = {
    itens: pendenciasDoFinanceiro(LINHAS, new Date("2026-10-23T12:00:00.000Z"), ROTA_A_FATURAR),
    linhas: LINHAS,
    carregando: false,
    falhas: [],
    ...inicio,
  };
  return renderToStaticMarkup(
    <Router ssrPath="/financeiro">
      <InicioDoFinanceiroView nome={nome} hoje={HOJE} inicio={completo} />
    </Router>,
  );
}

describe("Início do Financeiro", () => {
  it("data, saudação, quantas coisas esperam, o que precisa de você e a fila em números, na ordem", () => {
    expect(textosDaTela(render())).toEqual([
      "Sexta-feira, 23 de outubro",
      "Bom dia, Carla",
      "2 coisas",
      "precisam de você no Financeiro.",
      "Precisa de você",
      "2 demandas a faturar",
      "Itaú Unibanco · Banco Safra · R$ 14.845,00",
      "Faturar",
      "1 demanda aguardando autorização",
      "Itaú Unibanco",
      "Ver",
      "A faturar",
      "R$ 14.845,00",
      "Prontas para faturar",
      "2",
      "Aguardando autorização",
      "1",
      "Sem valor para faturar",
      "0",
      "Abrir a fila",
    ]);
  });

  it("só rótulos, dados e ações: nenhum texto fora da lista", () => {
    const permitidos = [
      "Sexta-feira, 23 de outubro",
      "Bom dia, Carla",
      /^\d+ coisas?$/,
      /^precisam? de você no Financeiro\.$/,
      "Precisa de você",
      /^\d+ demandas? a faturar$/,
      /^\d+ demandas? aguardando autorização$/,
      /^[^·]+( · [^·]+)* · R\$ [\d.]+,\d{2}$/,
      "Itaú Unibanco",
      "Faturar",
      "Ver",
      "A faturar",
      /^R\$ [\d.]+,\d{2}$/,
      "Prontas para faturar",
      "Aguardando autorização",
      "Sem valor para faturar",
      "Abrir a fila",
      /^\d+$/,
    ];
    expect(textosForaDaLista(render(), permitidos)).toEqual([]);
  });

  it("a primeira ação é a principal e leva à fila; as outras, secundárias", () => {
    const html = render();
    const faturar = html.match(/<a [^>]*class="([^"]*)"[^>]*>Faturar<\/a>/);
    expect(faturar?.[1]).toContain("bg-primary");
    expect(html.match(/<a [^>]*class="([^"]*)"[^>]*>Ver<\/a>/)?.[1]).not.toContain("bg-primary");
    expect(html.match(/<a [^>]*class="([^"]*)"[^>]*>Abrir a fila<\/a>/)?.[1]).not.toContain("bg-primary");
    expect(html).toContain(`href="${ROTA_A_FATURAR}"`);
  });

  it("carregando não diz que não há nada; erro diz o que não carregou", () => {
    expect(textosDaTela(render({ itens: [], linhas: undefined, carregando: true }))).toEqual(["Sexta-feira, 23 de outubro", "Bom dia, Carla", "Precisa de você"]);
    const erro = render({ itens: [], linhas: undefined, falhas: ["autorizações"] });
    expect(erro).toMatch(/<p role="alert"[^>]*>Não foi possível carregar: autorizações\.<\/p>/);
    expect(textosDaTela(erro)).not.toContain("Prontas para faturar");
  });

  it("nada parado: a frase diz, e os números continuam", () => {
    const textos = textosDaTela(render({ itens: [], linhas: [] }));
    expect(textos).toContain("Nada parado no Financeiro.");
    expect(textos).not.toContain("Precisa de você");
    expect(textos).toContain("Prontas para faturar");
  });

  it("passa nas regras WCAG 2.1 A e AA do axe", async () => {
    expect(await violacoesDeAcessibilidade(render())).toEqual([]);
    expect(await violacoesDeAcessibilidade(render({ itens: [], linhas: undefined, carregando: true }))).toEqual([]);
  });
});
