import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import { gruposDaSeparacao, hrefDaListaDeSeparacao } from "@/lib/warehouse-ops/lista-de-separacao";
import type { WarehouseTaskItem } from "@/lib/warehouse-ops/model";
import { progressoDoPedido } from "@/lib/warehouse-ops/separacao";
import { telaDoWmsNaV3 } from "@/lib/wms-v3";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela } from "@/test/textos";

import { PedidosSepararView, type EstadoDaBancada } from "./pedidos-separar-view";

/**
 * Pedidos › Separar, a bancada do pedido (separação com caixas, partes 2 e 5;
 * docs/mockups/WmsSepararBancada.dc.html e WmsSepararCelular.dc.html). Antes,
 * "Separado" era um passo só no fim: nada do que a pessoa separava ficava
 * gravado. Dados sintéticos.
 */

const noop = () => undefined;
const SEPARADA = { separated_at: "2026-11-10T13:00:00.000Z", separated_by: "Guilherme Dantas" };

function linha(numero: number, location: string, nome: string, codigo: string, sku: string, quantidade: number, progresso: Partial<WarehouseTaskItem> = {}): WarehouseTaskItem {
  return { id: `pli_ord_1_${String(numero).padStart(2, "0")}`, line_number: numero, location, product_name: nome, client_item_code: codigo, sku_code: sku, expected_quantity: quantidade, quantity: quantidade, ...progresso };
}

const ITENS = [
  linha(1, "A-03", "Polo Masculino Piquet Preto P", "A.01.0806.005.P", "BTG-000122", 60, { ...SEPARADA, separated_qty: 60 }),
  linha(2, "A-03", "Polo Masculino Piquet Preto M", "A.01.0806.005.M", "BTG-000123", 120, { ...SEPARADA, separated_qty: 120 }),
  linha(3, "A-05", "Calça Social Masculino Preta 40", "A.01.0712.001.40", "BTG-000083", 30, { ...SEPARADA, separated_qty: 30 }),
  linha(4, "A-05", "Calça Social Masculino Preta 42", "A.01.0712.001.42", "BTG-000084", 40),
  linha(5, "B-09", "Lancheira Grande AZ", "C.0612.002.U", "BTG-000106", 2, { ...SEPARADA, separated_qty: 1, shortage_reason: "avaria" }),
  linha(6, "B-09", "Copo Café", "B.0791.005.U", "BTG-000202", 1),
];

const POSICOES = [
  { code: "A-03", sequence: 3 },
  { code: "A-05", sequence: 5 },
  { code: "B-09", sequence: 24 },
];

const CAIXAS = [
  { code: "CX-000027", customer_code: "BTG", status: "stored", location_id: "A-05", sku_codes: ["BTG-000083", "BTG-000084"], stored_at: "2026-10-20T12:00:00.000Z" },
  { code: "CX-000028", customer_code: "BTG", status: "stored", location_id: "A-05", sku_codes: ["BTG-000084"], stored_at: "2026-10-21T12:00:00.000Z" },
  { code: "CX-000187", customer_code: "BTG", status: "stored", location_id: "B-09", sku_codes: ["BTG-000202", "BTG-000106"], stored_at: "2026-10-21T12:00:00.000Z" },
];

type Props = Partial<Parameters<typeof PedidosSepararView>[0]> & { itens?: WarehouseTaskItem[] };

function render(estado: EstadoDaBancada = "pronto", { itens = ITENS, ...props }: Props = {}) {
  return renderToStaticMarkup(
    <Router ssrPath="/pedidos/separar">
      <PedidosSepararView
        estado={estado}
        numero="PED-0001"
        resumo="BTG Pactual · 6 itens · 253 un. · Para quando Seg 16/11 11:36"
        comecouEm="2026-11-10T13:00:00.000Z"
        comecou
        progresso={progressoDoPedido(itens)}
        grupos={gruposDaSeparacao(itens, POSICOES, { caixas: CAIXAS, cliente: "BTG" })}
        listaHref={hrefDaListaDeSeparacao("ord_1")}
        operador
        coordenacao={false}
        onSeparar={noop}
        onDesfazer={noop}
        onSepararMenos={noop}
        onConcluir={noop}
        {...props}
      />
    </Router>,
  );
}

function botao(html: string, texto: string) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
  const achado = [...dom.window.document.querySelectorAll("button")].find((candidato) => candidato.textContent === texto);
  const resultado = achado ? { desligado: achado.hasAttribute("disabled"), classe: achado.className } : null;
  dom.window.close();
  return resultado;
}

describe("Pedidos › Separar, a bancada do pedido", () => {
  it("a tela nova já entra na v3", () => {
    expect(telaDoWmsNaV3("/pedidos/separar?pedido=ord_1")).toBe(true);
  });

  it("só rótulos, dados e ações: o pedido, o progresso e as linhas por prateleira na ordem de caminhada", () => {
    expect(textosDaTela(render())).toEqual([
      "PED-0001",
      "em separação desde 10/11",
      "BTG Pactual · 6 itens · 253 un. · Para quando Seg 16/11 11:36",
      "2 itens por separar",
      "Imprimir lista",
      "Concluir separação",
      "4 de 6 itens",
      "· 211 de 253 un.",
      "1 linha com diferença",
      // A prateleira toda separada fecha sozinha: só o cabeçalho.
      "A-03",
      "2 itens · 180 un.",
      "separado",
      "A-05",
      "2 itens · 70 un.",
      "1 de 2",
      // A ordem é a da lista (os tamanhos em ordem), com a separada no lugar dela.
      "Calça Social Masculino Preta · 40",
      "A.01.0712.001.40 · BTG-000083",
      "30 un.",
      "Desfazer",
      // A linha por separar mostra a caixa onde o item está; a já separada, não.
      "Calça Social Masculino Preta · 42",
      "A.01.0712.001.42 · BTG-000084",
      "CX-000027",
      "CX-000028",
      "40 un.",
      "Separar",
      "B-09",
      "2 itens · 3 un.",
      "Copo Café",
      "B.0791.005.U · BTG-000202",
      "CX-000187",
      "1 un.",
      "Lancheira Grande AZ",
      "C.0612.002.U · BTG-000106",
      "separado 1 de 2 · Avaria",
      "2 un.",
    ]);
  });

  it("a prateleira toda separada fecha, com o botão que mostra os itens; as outras ficam abertas", () => {
    const dom = new JSDOM(`<!doctype html><body>${render()}</body>`);
    const { document } = dom.window;
    const grupos = [...document.querySelectorAll("section")];
    expect(grupos.map((grupo) => grupo.querySelectorAll("li").length)).toEqual([0, 2, 2]);
    const mostrar = grupos[0].querySelector("button");
    expect([mostrar?.getAttribute("aria-label"), mostrar?.getAttribute("aria-expanded")]).toEqual(["Mostrar itens de A-03", "false"]);
    expect(grupos[1].querySelector("h2 button")).toBeNull();
    dom.window.close();
  });

  it("só a primeira linha por separar tem a ação principal; cada linha por separar tem o ⋯ com o nome dela", () => {
    const dom = new JSDOM(`<!doctype html><body>${render()}</body>`);
    const { document } = dom.window;
    const separar = [...document.querySelectorAll("button")].filter((candidato) => candidato.textContent === "Separar");
    expect(separar).toHaveLength(2);
    expect(separar[0].className).toContain("bg-primary");
    expect(separar[1].className).not.toContain("bg-primary");
    const mais = [...document.querySelectorAll("button[aria-label^='Mais ações de']")].map((candidato) => candidato.getAttribute("aria-label"));
    expect(mais).toEqual(["Mais ações de Calça Social Masculino Preta · 42", "Mais ações de Copo Café"]);
    dom.window.close();
  });

  it("Concluir separação fica desligado com linha por separar e diz quantas faltam", () => {
    expect(botao(render(), "Concluir separação")).toMatchObject({ desligado: true });
    expect(textosDaTela(render())).toContain("2 itens por separar");
  });

  it("com todas as linhas separadas, Concluir separação liga como a ação principal", () => {
    const todas = ITENS.map((item) => ({ ...SEPARADA, ...item, separated_qty: item.expected_quantity, shortage_reason: undefined }));
    const html = render("pronto", { itens: todas });
    const concluir = botao(html, "Concluir separação");
    expect(concluir?.desligado).toBe(false);
    expect(concluir?.classe).toContain("bg-primary");
    const textos = textosDaTela(html);
    expect(textos).toContain("6 de 6 itens");
    expect(textos.join(" ")).not.toContain("por separar");
    expect(textos.join(" ")).not.toContain("com diferença");
  });

  it("o pedido com diferença só conclui com a coordenação", () => {
    const tratadas = ITENS.map((item) => (item.separated_at ? item : { ...SEPARADA, ...item, separated_qty: item.expected_quantity }));
    expect(botao(render("pronto", { itens: tratadas }), "Concluir separação")).toMatchObject({ desligado: true });
    expect(textosDaTela(render("pronto", { itens: tratadas }))).toContain("1 linha com diferença");
    expect(botao(render("pronto", { itens: tratadas, coordenacao: true }), "Concluir separação")).toMatchObject({ desligado: false });
  });

  it("quem só consulta (o suporte) vê o progresso, sem Separar, Desfazer nem Concluir", () => {
    const textos = textosDaTela(render("pronto", { operador: false }));
    for (const acao of ["Separar", "Desfazer", "Concluir separação"]) expect(textos).not.toContain(acao);
    expect(textos).toContain("4 de 6 itens");
    expect(textos).toContain("Imprimir lista");
    expect(render("pronto", { operador: false })).not.toContain("Mais ações de");
  });

  it("a linha com a gravação em curso desliga os botões dela", () => {
    const dom = new JSDOM(`<!doctype html><body>${render("pronto", { ocupadas: new Set(["pli_ord_1_04"]) })}</body>`);
    const separar = [...dom.window.document.querySelectorAll("button")].filter((candidato) => candidato.textContent === "Separar");
    expect(separar.map((candidato) => candidato.hasAttribute("disabled"))).toEqual([true, false]);
    dom.window.close();
  });

  it("a separação que parou antes da embalagem só deixa concluir: as linhas não mudam mais", () => {
    const html = render("pronto", { fechada: true });
    const textos = textosDaTela(html);
    expect(textos).not.toContain("Separar");
    expect(textos).not.toContain("Desfazer");
    expect(botao(html, "Concluir separação")).toMatchObject({ desligado: false });
  });

  it("antes da primeira linha, o pedido não tem o selo da separação", () => {
    const novos = ITENS.map(({ separated_at: _em, separated_qty: _qtd, separated_by: _por, shortage_reason: _motivo, ...item }) => item);
    const textos = textosDaTela(render("pronto", { itens: novos, comecou: false, comecouEm: null }));
    expect(textos.join(" ")).not.toContain("em separação");
    expect(textos).toContain("0 de 6 itens");
  });

  it("carregando, pedido não encontrado, erro e separação concluída: a mensagem no lugar da bancada", () => {
    for (const [estado, mensagem] of [
      ["carregando", "Carregando"],
      ["nao_encontrado", "Pedido não encontrado"],
      ["erro", "Não foi possível carregar o pedido."],
      ["concluida", "Separação concluída"],
    ] as const) {
      expect(textosDaTela(render(estado))).toEqual(["PED-0001", mensagem]);
    }
    expect(render("erro")).toContain('role="alert"');
    expect(textosDaTela(render("nao_encontrado", { numero: "" }))).toEqual(["Separar", "Pedido não encontrado"]);
  });

  it("voltar leva a Pedidos, e Imprimir lista abre a lista do pedido", () => {
    const html = render();
    expect(html).toMatch(/<a [^>]*href="\/pedidos"[^>]*aria-label="Voltar a Pedidos"|<a [^>]*aria-label="Voltar a Pedidos"[^>]*href="\/pedidos"/);
    expect(html).toMatch(/<a [^>]*href="\/pedidos\/lista\?pedido=ord_1"[^>]*>.*Imprimir lista<\/a>/s);
  });

  it("passa nas regras WCAG 2.1 A e AA do axe", async () => {
    expect(await violacoesDeAcessibilidade(render())).toEqual([]);
    expect(await violacoesDeAcessibilidade(render("pronto", { coordenacao: true, fechada: true }))).toEqual([]);
    expect(await violacoesDeAcessibilidade(render("erro"))).toEqual([]);
  });
});
