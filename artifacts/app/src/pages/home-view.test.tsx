import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import type { HomeInboxItem } from "@/lib/home-inbox";
import { itensDoInicioDoWms } from "@/lib/inicio-do-wms";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela, textosForaDaLista } from "@/test/textos";

import { InicioDoWmsView, type InicioDoWms } from "./home-view";

/**
 * O Início da Armazenagem na v3 (parte 4.7b): a data, a saudação, o que
 * precisa de você com a ação de cada item e o dia no armazém. Sem legenda e
 * uma ação principal.
 */

const AGORA = new Date(2026, 9, 23, 9, 0);

const ITENS: HomeInboxItem[] = [
  { id: "blocked:PED-3", tone: "critical", title: "PED-3 parado na separação", detail: "Falta física na rua B", href: "/pedidos?pedido=PED-3", actionLabel: "Resolver" },
  { id: "triage", tone: "attention", title: "2 solicitações para aprovar", detail: "BTG Pactual", href: "/pedidos", actionLabel: "Aprovar" },
  { id: "receipts", tone: "info", title: "1 recebimento para conferir", detail: "NF 4521", href: "/wms/receber", actionLabel: "Conferir" },
];

const PRONTO: InicioDoWms = {
  itens: itensDoInicioDoWms(ITENS),
  carregando: false,
  falhas: [],
  hoje: { toPick: 3, toShip: 1, inTransit: 2, openReceipts: 4, skus: 128 },
};

function render(inicio: Partial<InicioDoWms> = {}) {
  return renderToStaticMarkup(
    <Router ssrPath="/dashboard">
      <InicioDoWmsView nome="Sandra Melo" hoje={AGORA} inicio={{ ...PRONTO, ...inicio }} />
    </Router>,
  );
}

describe("Início da Armazenagem", () => {
  it("data, saudação, o que precisa de você e o dia no armazém, na ordem", () => {
    expect(textosDaTela(render())).toEqual([
      "Sexta-feira, 23 de outubro",
      "Bom dia, Sandra",
      "3 coisas",
      "precisam de você na Armazenagem.",
      "Precisa de você",
      "PED-3 parado na separação",
      "Falta física na rua B",
      "Resolver",
      "2 solicitações para aprovar",
      "BTG Pactual",
      "Aprovar",
      "1 recebimento para conferir",
      "NF 4521",
      "Conferir",
      "Hoje no armazém",
      "Pedidos para separar",
      "3",
      "Prontos para envio",
      "1",
      "Em rota de entrega",
      "2",
      "Recebimentos em aberto",
      "4",
      "SKUs em estoque",
      "128",
    ]);
  });

  it("só rótulos, dados e ações", () => {
    const permitidos = [
      "Sexta-feira, 23 de outubro",
      "Bom dia, Sandra",
      /^\d+ coisas?$/,
      /^precisam? de você na Armazenagem\.$/,
      "Precisa de você",
      ...ITENS.flatMap((item) => [item.title, item.detail, item.actionLabel]),
      "Hoje no armazém",
      "Pedidos para separar",
      "Prontos para envio",
      "Em rota de entrega",
      "Recebimentos em aberto",
      "SKUs em estoque",
      /^\d+$/,
    ];
    expect(textosForaDaLista(render(), permitidos)).toEqual([]);
  });

  it("a primeira ação é a principal; as outras, secundárias", () => {
    const acoes = [...render().matchAll(/<a [^>]*href="([^"]+)"[^>]*class="([^"]*)"[^>]*>(Resolver|Aprovar|Conferir)<\/a>/g)];
    expect(acoes.map(([, href, , rotulo]) => [rotulo, href])).toEqual([
      ["Resolver", "/pedidos?pedido=PED-3"],
      ["Aprovar", "/pedidos"],
      ["Conferir", "/wms/receber"],
    ]);
    expect(acoes[0][2]).toContain("bg-primary");
    for (const acao of acoes.slice(1)) expect(acao[2]).not.toContain("bg-primary");
  });

  it("nada parado: a frase diz, e o Precisa de você some", () => {
    const textos = textosDaTela(render({ itens: [] }));
    expect(textos).toContain("Nada parado na Armazenagem.");
    expect(textos).not.toContain("Precisa de você");
  });

  it("carregando não diz que não há nada; erro diz o que não carregou", () => {
    expect(textosDaTela(render({ itens: [], carregando: true }))).toEqual(["Sexta-feira, 23 de outubro", "Bom dia, Sandra", "Precisa de você"]);
    expect(render({ falhas: ["armazém", "solicitações"] })).toMatch(/<p role="alert"[^>]*>Não foi possível carregar: armazém, solicitações\.<\/p>/);
  });

  it("quem não vê o armazém (o financeiro) fica sem os números do dia", () => {
    expect(textosDaTela(render({ hoje: null }))).not.toContain("Hoje no armazém");
  });

  it("cada item tem o ícone do que é", () => {
    expect(itensDoInicioDoWms([{ ...ITENS[0], id: "agent", tone: "agent" }])[0].icon.displayName).toBe("Sparkles");
    expect(itensDoInicioDoWms([ITENS[2]])[0].icon.displayName).toBe("PackageCheck");
    expect(itensDoInicioDoWms([{ ...ITENS[0], id: "blocked:x" }])[0].icon.displayName).toBe("TriangleAlert");
  });

  it("passa nas regras WCAG 2.1 A e AA do axe", async () => {
    expect(await violacoesDeAcessibilidade(render())).toEqual([]);
    expect(await violacoesDeAcessibilidade(render({ itens: [], carregando: true }))).toEqual([]);
  });
});
