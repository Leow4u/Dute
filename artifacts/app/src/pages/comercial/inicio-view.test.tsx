import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import type { ResumoDoComercial } from "@/lib/comercial/inicio";
import { pendenciasDoComercial } from "@/lib/comercial/pendencias";
import type { InicioDoComercial } from "@/lib/comercial/use-inicio";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela, textosForaDaLista } from "@/test/textos";

import { InicioDoComercialView } from "./inicio-view";

/**
 * Início do Comercial (parte 2.5, docs/mockups/ModComInicio.dc.html): o que
 * espera a pessoa, os orçamentos por etapa e o mês. Sem legenda.
 */

// Sexta, 23/10/2026, 9h no fuso de quem roda: a saudação é "Bom dia".
const HOJE = new Date(2026, 9, 23, 9, 0);

const RESUMO: ResumoDoComercial = {
  competencia: "2026-10",
  porEtapa: {
    em_montagem: 3,
    para_aprovar: 1,
    para_enviar: 0,
    aguardando_cliente: 5,
    para_planejar: 2,
    execucao_a_orcar: 0,
    aguardando_autorizacao: 4,
    a_faturar: 1,
  },
  mes: { enviados: 7, fechados: 3, perdidos: 1 },
  semResposta: [{ numero: "10052", cliente: "Clínica Vida Plena", enviadaEm: "2026-10-17", dias: 6 }],
};

const ITENS = pendenciasDoComercial({
  role: "comercial",
  devolvidos: [{ numero: "10046", rotulo: "10046 – RV01", nota: "Confirme a quantidade de lockers", em: "2026-10-22T18:10:00.000Z" }],
  semResposta: RESUMO.semResposta,
  comercialLiberado: true,
});

function render(inicio: Partial<InicioDoComercial> = {}, nome = "Guilherme Souza") {
  const completo: InicioDoComercial = { itens: ITENS, resumo: RESUMO, carregando: false, falhas: [], ...inicio };
  return renderToStaticMarkup(
    <Router ssrPath="/comercial">
      <InicioDoComercialView nome={nome} hoje={HOJE} inicio={completo} />
    </Router>,
  );
}

const ETAPAS = [
  "Em montagem",
  "Para aprovar",
  "Para enviar",
  "Aguardando cliente",
  "Para planejar",
  "Execução a orçar",
  "Aguardando autorização",
  "A faturar",
];

describe("Início do Comercial", () => {
  it("data, saudação, quantas coisas esperam, o que precisa de você e os números, na ordem", () => {
    expect(textosDaTela(render())).toEqual([
      "Sexta-feira, 23 de outubro",
      "Bom dia, Guilherme",
      "2 coisas",
      "precisam de você no Comercial.",
      "Precisa de você",
      "Orçamento 10046 – RV01 devolvido",
      "“Confirme a quantidade de lockers” · 22/10 15:10",
      "Abrir orçamento",
      "10052 aguardando o cliente há 6 dias",
      "Clínica Vida Plena · enviado 17/10/2026",
      "Orçamentos por etapa",
      "Em montagem",
      "3",
      "Para aprovar",
      "1",
      "Para enviar",
      "0",
      "Aguardando cliente",
      "5",
      "Para planejar",
      "2",
      "Execução a orçar",
      "Aguardando autorização",
      "4",
      "A faturar",
      "Abrir a fila",
      "Outubro",
      "Enviados",
      "7",
      "Fechados",
      "Perdidos",
    ]);
  });

  it("só rótulos, dados e ações: nenhum texto fora da lista", () => {
    const permitidos = [
      "Sexta-feira, 23 de outubro",
      "Bom dia, Guilherme",
      "2 coisas",
      "precisam de você no Comercial.",
      "Precisa de você",
      /^Orçamento \d+( – RV\d{2})? devolvido$/,
      /^“.+” · \d{2}\/\d{2} \d{2}:\d{2}$/,
      /^\d+ aguardando o cliente há \d+ dias$/,
      /^.+ · enviado \d{2}\/\d{2}\/\d{4}$/,
      "Abrir orçamento",
      "Orçamentos por etapa",
      ...ETAPAS,
      "Abrir a fila",
      "Outubro",
      "Enviados",
      "Fechados",
      "Perdidos",
      /^\d+$/,
    ];
    expect(textosForaDaLista(render(), permitidos)).toEqual([]);
  });

  it("a primeira ação é a principal; as outras, secundárias", () => {
    const acoes = [...render().matchAll(/<a [^>]*class="([^"]*)"[^>]*>Abrir orçamento<\/a>/g)].map(([, classes]) => classes);
    expect(acoes).toHaveLength(2);
    expect(acoes[0]).toContain("bg-primary");
    expect(acoes[1]).not.toContain("bg-primary");
    expect(render()).toContain('href="/comercial/orcamento?numero=10046"');
    expect(render()).toContain('href="/comercial/orcamentos"');
  });

  it("nada parado: a frase diz, e o Precisa de você some", () => {
    const html = render({ itens: [] });
    const textos = textosDaTela(html);
    expect(textos).toContain("Nada parado no Comercial.");
    expect(textos).not.toContain("Precisa de você");
    expect(textos).toContain("Orçamentos por etapa");
  });

  it("uma coisa só: singular", () => {
    const textos = textosDaTela(render({ itens: ITENS.slice(0, 1) }));
    expect(textos.slice(2, 4)).toEqual(["1 coisa", "precisa de você no Comercial."]);
  });

  it("carregando não diz que não há nada; erro diz o que não carregou", () => {
    const carregando = textosDaTela(render({ itens: [], resumo: undefined, carregando: true }));
    expect(carregando).toEqual(["Sexta-feira, 23 de outubro", "Bom dia, Guilherme", "Precisa de você"]);
    const erro = render({ falhas: ["medições", "orçamentos por etapa"], resumo: undefined });
    expect(erro).toMatch(/<p role="alert"[^>]*>Não foi possível carregar: medições, orçamentos por etapa\.<\/p>/);
    expect(textosDaTela(erro)).not.toContain("Orçamentos por etapa");
  });

  it("sem nome, só a saudação", () => {
    expect(textosDaTela(render({}, ""))[1]).toBe("Bom dia");
  });

  it("passa nas regras WCAG 2.1 A e AA do axe", async () => {
    expect(await violacoesDeAcessibilidade(render())).toEqual([]);
    expect(await violacoesDeAcessibilidade(render({ itens: [], resumo: undefined, carregando: true }))).toEqual([]);
  });
});
