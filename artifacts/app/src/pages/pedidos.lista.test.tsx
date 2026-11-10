import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JSDOM } from "jsdom";
import { Package, Truck } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

import { hrefDaListaDeSeparacao } from "@/lib/warehouse-ops/lista-de-separacao";
import type { OrderGroup } from "@/lib/warehouse-ops/orders";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela } from "@/test/textos";

// As solicitações que o Firestore devolveria, pela chave da leitura; sem entrada, ainda carregando.
const { solicitacoes, chavesLidas } = vi.hoisted(() => ({
  solicitacoes: {} as Record<string, { due_at?: unknown } | null>,
  chavesLidas: [] as Array<string | null>,
}));

vi.mock("@/lib/operacao/leitura", () => ({
  useLeitura: () => ({ itens: null, erro: false }),
  useDocumento: (chave: string | null, _referencia: unknown, mapear: (id: string, data: Record<string, unknown>) => unknown) => {
    chavesLidas.push(chave);
    const dados = chave ? solicitacoes[chave] : undefined;
    return { item: dados === undefined ? undefined : dados === null ? null : mapear("req_1", dados), erro: false };
  },
}));

import { OrderRow } from "./pedidos";

/**
 * "Imprimir lista" na fila de Pedidos (separação com caixas, parte 1b;
 * docs/mockups/WmsSepararLista.dc.html e WmsSepararListaCelular.dc.html): no
 * computador, o botão antes de "Separado"; no celular, o atalho ao lado de
 * "Esconder itens", porque os botões vêm depois dos itens. Dados sintéticos.
 */

const PEDIDO: OrderGroup = {
  key: "ord_req_1",
  orderNumber: "PED-0001",
  requestId: "req_1",
  stage: "separar",
  exceptionCount: 0,
  pick: {
    id: "pick_ord_req_1",
    title: "PED-0001",
    status: "planned",
    customer_code: "BTG",
    items: [
      {
        id: "pli_ord_req_1_01",
        line_number: 1,
        sku_code: "BTG-000125",
        client_item_code: "A.01.0806.005.GG",
        product_name: "Polo Masculino Piquet Preto GG",
        quantity: 20,
        expected_quantity: 20,
        location: "B-02",
      },
    ],
  },
};

function linha(props: Partial<Parameters<typeof OrderRow>[0]> = {}, cliente = new QueryClient()) {
  return renderToStaticMarkup(
    <Router ssrPath="/pedidos">
      <QueryClientProvider client={cliente}>
        <OrderRow order={PEDIDO} icon={Package} tone="pick" defaultOpen action={<button type="button">Separado</button>} {...props} />
      </QueryClientProvider>
    </Router>,
  );
}

beforeEach(() => {
  chavesLidas.length = 0;
  for (const chave of Object.keys(solicitacoes)) delete solicitacoes[chave];
});

/**
 * No mockup aprovado a fila de quem separa mostra o "Para quando"
 * (docs/mockups/WmsSepararLista.dc.html). Antes, só a coordenação via: o
 * prazo vinha da lista das solicitações, que o armazém não lê.
 */
describe("o Para quando na fila de quem separa", () => {
  const CHAVE = "customer_requests/req_1:para-quando";

  it("quem não lê as solicitações vê o prazo da solicitação do pedido, lida pelo id", () => {
    solicitacoes[CHAVE] = { due_at: "2026-11-16T14:36:00.000Z" };
    const textos = textosDaTela(linha({ lerParaQuando: true }));
    expect(textos.slice(0, 3)).toEqual(["PED-0001", "1 item · 20 un.", "Para quando Seg 16/11 11:36"]);
    expect(chavesLidas).toEqual([CHAVE]);
  });

  it("enquanto a solicitação não chega, sem prazo ou sem a solicitação, a linha fica sem o Para quando", () => {
    expect(textosDaTela(linha({ lerParaQuando: true })).join(" ")).not.toContain("Para quando");
    solicitacoes[CHAVE] = {};
    expect(textosDaTela(linha({ lerParaQuando: true })).join(" ")).not.toContain("Para quando");
    solicitacoes[CHAVE] = null;
    expect(textosDaTela(linha({ lerParaQuando: true })).join(" ")).not.toContain("Para quando");
  });

  it("a coordenação usa o da lista das solicitações, sem ler de novo; sem pedir, ninguém lê", () => {
    solicitacoes[CHAVE] = { due_at: "2026-11-16T14:36:00.000Z" };
    const textos = textosDaTela(linha({ paraQuando: "Para quando Qui 05/11 09:00", lerParaQuando: true }));
    expect(textos).toContain("Para quando Qui 05/11 09:00");
    expect(textos.join(" ")).not.toContain("16/11");
    expect(textosDaTela(linha()).join(" ")).not.toContain("Para quando");
    expect(chavesLidas).toEqual([null, null]);
  });

  it("o pedido sem solicitação não lê nada", () => {
    const semSolicitacao: OrderGroup = { ...PEDIDO, requestId: undefined };
    expect(textosDaTela(linha({ order: semSolicitacao, lerParaQuando: true })).join(" ")).not.toContain("Para quando");
    expect(chavesLidas).toEqual([null]);
  });
});

/**
 * A caixa da linha é onde o item está para ser separado (parte 1c). No pedido
 * já separado ou entregue o item saiu dela: a linha não mostra caixa.
 */
describe("a caixa só no pedido para separar", () => {
  function comCaixas() {
    const cliente = new QueryClient();
    cliente.setQueryData(
      ["warehouse-boxes", "BTG", "all-pages"],
      [{ code: "CX-000014", customer_code: "BTG", status: "stored", location_id: "B-02", sku_codes: ["BTG-000125"], stored_at: "2026-10-20T10:00:00.000Z" }],
    );
    return cliente;
  }

  it("para separar, a linha mostra a caixa", () => {
    expect(textosDaTela(linha({}, comCaixas()))).toContain("CX-000014");
  });

  it("para entregar e entregue, a linha fica sem caixa", () => {
    const separado: OrderGroup = { ...PEDIDO, stage: "enviar", pack: { id: "pack_ord_req_1", status: "completed", customer_code: "BTG" }, ship: { id: "ship_ord_req_1", status: "ready_to_dispatch", customer_code: "BTG" } };
    expect(textosDaTela(linha({ order: separado, icon: Truck, tone: "deliver" }, comCaixas())).join(" ")).not.toContain("CX-");
    const entregue: OrderGroup = { ...separado, stage: "entregue" };
    const textos = textosDaTela(linha({ order: entregue, icon: Truck, tone: "done" }, comCaixas()));
    expect(textos.join(" ")).not.toContain("CX-");
    // A lista continua por prateleira.
    expect(textos).toContain("B-02");
  });
});

/**
 * O pedido em separação na fila (separação com caixas, parte 2;
 * docs/mockups/WmsSepararParaEntregar.dc.html): o selo diz desde quando e
 * quantos itens já foram separados. Antes, a fila não sabia do progresso.
 */
describe("o selo do pedido em separação na fila", () => {
  const item = PEDIDO.pick!.items![0];
  const emSeparacao: OrderGroup = {
    ...PEDIDO,
    pick: {
      ...PEDIDO.pick!,
      status: "in_progress",
      separation_started_at: "2026-11-12T13:00:00.000Z",
      items: [
        { ...item, separated_qty: 20, separated_at: "2026-11-12T13:00:00.000Z", separated_by: "Guilherme Dantas" },
        { ...item, id: "pli_ord_req_1_02", line_number: 2, sku_code: "BTG-000124", client_item_code: "A.01.0806.005.G", product_name: "Polo Masculino Piquet Preto G" },
      ],
    },
  };

  it("o pedido com a separação começada diz desde quando e quantos itens já foram", () => {
    const textos = textosDaTela(linha({ order: emSeparacao }));
    expect(textos.slice(0, 3)).toEqual(["PED-0001", "em separação desde 12/11 · 1 de 2 itens", "2 itens · 40 un."]);
  });

  it("antes da primeira linha, e depois de separado, a linha fica sem o selo", () => {
    expect(textosDaTela(linha()).join(" ")).not.toContain("em separação");
    const separado: OrderGroup = { ...emSeparacao, stage: "enviar" };
    expect(textosDaTela(linha({ order: separado, icon: Truck, tone: "deliver" })).join(" ")).not.toContain("em separação");
  });

  it("o selo passa nas regras do axe", async () => {
    expect(await violacoesDeAcessibilidade(linha({ order: emSeparacao }))).toEqual([]);
  });
});

describe("Imprimir lista na fila de Pedidos", () => {
  const href = hrefDaListaDeSeparacao(PEDIDO.key);

  it("o pedido para separar tem o atalho da lista, e os textos da linha não mudam", () => {
    expect(href).toBe("/pedidos/lista?pedido=ord_req_1");
    expect(textosDaTela(linha({ listaHref: href }))).toEqual([
      "PED-0001",
      "1 item · 20 un.",
      "Esconder itens",
      "Imprimir lista",
      "Separado",
      "B-02",
      "Polo Masculino Piquet Preto · GG",
      "A.01.0806.005.GG · BTG-000125",
      "20 un.",
    ]);
  });

  it("no computador, o botão vem antes de Separado; no celular, o atalho fica ao lado de Esconder itens", () => {
    const dom = new JSDOM(`<!doctype html><body>${linha({ listaHref: href })}</body>`);
    const { document } = dom.window;
    const links = [...document.querySelectorAll("a")].filter((link) => link.textContent === "Imprimir lista");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([href, href]);
    const [noCelular, noComputador] = links;
    // O atalho do celular some no computador, e fica na mesma linha de "Esconder itens".
    expect(noCelular.className.split(" ")).toContain("sm:hidden");
    expect(noCelular.parentElement?.querySelector("button")?.textContent).toBe("Esconder itens");
    // O botão do computador fica nas ações da linha, que somem no celular, antes de "Separado".
    const acoes = noComputador.parentElement;
    expect(acoes?.className).toMatch(/\bhidden\b.*\bsm:flex\b/);
    expect([...(acoes?.children ?? [])].map((filho) => filho.textContent)).toEqual(["Imprimir lista", "Separado"]);
    // No celular, depois dos itens, ficam só as ações do pedido.
    const depoisDosItens = [...document.querySelectorAll("div")].find((div) => div.className.split(" ").includes("sm:hidden"));
    expect(depoisDosItens?.textContent).toBe("Separado");
    dom.window.close();
  });

  it("sem o endereço da lista (o pedido para entregar), a linha fica como era", () => {
    const html = linha({ icon: Truck, tone: "deliver", action: <button type="button">Entregue</button> });
    expect(html).not.toContain("Imprimir lista");
    expect(textosDaTela(html).slice(0, 4)).toEqual(["PED-0001", "1 item · 20 un.", "Esconder itens", "Entregue"]);
  });

  it("o pedido sem linhas não tem o que imprimir", () => {
    const semLinhas: OrderGroup = { ...PEDIDO, pick: { ...PEDIDO.pick!, items: [] } };
    expect(linha({ order: semLinhas, listaHref: href })).not.toContain("Imprimir lista");
  });

  it("passa nas regras WCAG 2.1 A e AA do axe", async () => {
    expect(await violacoesDeAcessibilidade(linha({ listaHref: href }))).toEqual([]);
  });
});
