import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";

import { gruposDaSeparacao, hrefDaListaDeSeparacao } from "@/lib/warehouse-ops/lista-de-separacao";
import type { WarehouseTaskItem } from "@/lib/warehouse-ops/model";
import { progressoDoPedido } from "@/lib/warehouse-ops/separacao";
import { volumesDaSeparacao, type VolumeDaTarefa } from "@/lib/warehouse-ops/volumes-do-pedido";
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

/**
 * A caixa na bancada (separação com caixas, parte 3b;
 * docs/mockups/WmsSepararBancada.dc.html). Antes, a linha dizia só em quais
 * caixas o item estava, sem a quantidade, e a separada não dizia de onde saiu.
 */
describe("Pedidos › Separar, a caixa de cada linha", () => {
  const caixasDaLinha = new Map([
    // A calça 40, já separada: saiu da CX-000027.
    ["pli_ord_1_03", [{ box_code: "CX-000027", qty: 30, inteira: false, esvazia: false }]],
    // A calça 42, por separar: a CX-000027 esvazia, e a CX-000028 completa.
    [
      "pli_ord_1_04",
      [
        { box_code: "CX-000027", qty: 12, inteira: false, esvazia: true },
        { box_code: "CX-000028", qty: 28, inteira: false, esvazia: false },
      ],
    ],
    // A lancheira, com diferença: a caixa de onde saiu a que foi separada.
    ["pli_ord_1_05", [{ box_code: "CX-000186", qty: 1, inteira: false, esvazia: false }]],
    // O copo, por separar: a caixa sai inteira.
    ["pli_ord_1_06", [{ box_code: "CX-000187", qty: 1, inteira: true, esvazia: false }]],
  ]);

  function textosDaPrateleira(html: string, prateleira: string) {
    const textos = textosDaTela(html);
    const inicio = textos.indexOf(prateleira);
    const fim = textos.findIndex((texto, indice) => indice > inicio && /^[A-Z]-\d\d$/.test(texto));
    return textos.slice(inicio, fim === -1 ? undefined : fim);
  }

  it("a linha por separar diz de qual caixa o sistema tira e qual esvazia; a separada, de onde saiu", () => {
    const html = render("pronto", { caixasDaLinha });
    expect(textosDaPrateleira(html, "A-05")).toEqual([
      "A-05",
      "2 itens · 70 un.",
      "1 de 2",
      "Calça Social Masculino Preta · 40",
      "A.01.0712.001.40 · BTG-000083",
      "30 de CX-000027",
      "30 un.",
      "Desfazer",
      "Calça Social Masculino Preta · 42",
      "A.01.0712.001.42 · BTG-000084",
      "12 de CX-000027",
      "esvazia",
      "28 de CX-000028",
      "40 un.",
      "Separar",
    ]);
  });

  it("a caixa que sai toda vem como inteira, e a linha com diferença diz de onde saiu o que foi separado", () => {
    const html = render("pronto", { caixasDaLinha });
    // A lista dos textos não repete o que já apareceu: "1 de 2", "Separar" e "Desfazer" vieram na A-05.
    expect(textosDaPrateleira(html, "B-09")).toEqual([
      "B-09",
      "2 itens · 3 un.",
      "Copo Café",
      "B.0791.005.U · BTG-000202",
      "CX-000187 inteira",
      "1 un.",
      "Lancheira Grande AZ",
      "C.0612.002.U · BTG-000106",
      "separado 1 de 2 · Avaria",
      "1 de CX-000186",
      "2 un.",
    ]);
  });

  it("a linha por separar sem caixa com o item na prateleira não mostra caixa; sem a leitura, ficam os códigos", () => {
    // Com a leitura das caixas e nenhuma com o item: a linha sai sem caixa.
    const semCaixa = new Map(caixasDaLinha).set("pli_ord_1_04", []);
    expect(textosDaPrateleira(render("pronto", { caixasDaLinha: semCaixa }), "A-05").slice(-4)).toEqual([
      "Calça Social Masculino Preta · 42",
      "A.01.0712.001.42 · BTG-000084",
      "40 un.",
      "Separar",
    ]);
    // Sem a leitura (a linha fora do mapa), ficam os códigos das caixas da prateleira, como na lista.
    expect(textosDaPrateleira(render(), "A-05").slice(-5)).toEqual(["A.01.0712.001.42 · BTG-000084", "CX-000027", "CX-000028", "40 un.", "Separar"]);
  });

  it("passa nas regras WCAG 2.1 A e AA do axe", async () => {
    expect(await violacoesDeAcessibilidade(render("pronto", { caixasDaLinha, comOutraCaixa: new Set(["pli_ord_1_04"]), onOutraCaixa: noop }))).toEqual([]);
  });
});

/**
 * "Etiquetas para trocar" (separação com caixas, parte 3d;
 * docs/mockups/WmsSepararBancada.dc.html). Antes, nada dizia que a caixa de
 * onde saiu peça precisava de etiqueta nova.
 */
describe("Pedidos › Separar, as etiquetas para trocar", () => {
  const etiquetas = [
    { code: "CX-000023", posicao: "A-04", saldo: 10 },
    { code: "CX-000027", posicao: "A-05", saldo: 12 },
  ];
  const href = "/estoque/etiquetas?caixas=CX-000023%2CCX-000027";

  function painel(html: string) {
    const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
    const secao = dom.window.document.querySelector("section[aria-labelledby='etiquetas-para-trocar']");
    const resultado = secao ? { textos: textosDaTela(secao.outerHTML), imprimir: secao.querySelector("a")?.getAttribute("href") ?? null } : null;
    dom.window.close();
    return resultado;
  }

  it("lista as caixas abertas do pedido, com a prateleira e o saldo, e Imprimir leva às etiquetas delas", () => {
    expect(painel(render("pronto", { etiquetas, etiquetasHref: href }))).toEqual({
      textos: ["Etiquetas para trocar", "2 caixas abertas", "Imprimir", "CX-000023", "A-04 · saldo 10 un.", "CX-000027", "A-05 · saldo 12 un."],
      imprimir: href,
    });
  });

  it("sem caixa aberta, a bancada não ganha o painel", () => {
    expect(painel(render("pronto", { etiquetas: [], etiquetasHref: null }))).toBeNull();
    expect(painel(render())).toBeNull();
  });

  it("com mais de cinco caixas, mostra as cinco primeiras e Ver as N caixas", () => {
    const muitas = Array.from({ length: 7 }, (_, indice) => ({ code: `CX-00010${indice}`, posicao: "B-09", saldo: indice + 1 }));
    const textos = painel(render("pronto", { etiquetas: muitas, etiquetasHref: href }))!.textos;
    expect(textos.slice(0, 2)).toEqual(["Etiquetas para trocar", "7 caixas abertas"]);
    expect(textos.filter((texto) => texto.startsWith("CX-"))).toEqual(["CX-000100", "CX-000101", "CX-000102", "CX-000103", "CX-000104"]);
    expect(textos.at(-1)).toBe("Ver as 7 caixas");
  });

  it("passa nas regras WCAG 2.1 A e AA do axe", async () => {
    expect(await violacoesDeAcessibilidade(render("pronto", { etiquetas, etiquetasHref: href }))).toEqual([]);
  });
});

/**
 * Os volumes na bancada (separação com caixas, parte 4b;
 * docs/mockups/WmsSepararBancada.dc.html e WmsSepararCelular.dc.html). Antes,
 * o pedido fechava num volume só, na conclusão: a bancada não tinha volume.
 */
describe("Pedidos › Separar, os volumes", () => {
  const DA_TAREFA: VolumeDaTarefa[] = [
    { id: "v1", number: 10, status: "closed", units: 50, weight_kg: 8.2, closed_at: "2026-11-11T12:00:00.000Z" },
    { id: "v2", number: 11, status: "closed", units: 25, box_code: "CX-000029", weight_kg: 6.3, closed_at: "2026-11-12T12:00:00.000Z" },
    { id: "v3", number: 12, status: "open", units: 31 },
  ];
  // A calça 40 e a lancheira estão no volume aberto; os polos, nos fechados.
  const COM_VOLUMES = ITENS.map((item) =>
    item.id === "pli_ord_1_01"
      ? { ...item, separated_volumes: [{ volume_id: "v1", qty: 50 }, { volume_id: "v2", qty: 10 }] }
      : item.id === "pli_ord_1_02"
        ? { ...item, separated_volumes: [{ volume_id: "v2", qty: 15 }] }
        : item.id === "pli_ord_1_03"
          ? { ...item, separated_volumes: [{ volume_id: "v3", qty: 30 }] }
          : item.id === "pli_ord_1_05"
            ? { ...item, separated_volumes: [{ volume_id: "v3", qty: 1 }] }
            : item,
  );
  const volumes = volumesDaSeparacao(DA_TAREFA, COM_VOLUMES);
  const etiquetaDoVolumeHref = (volume: { numero: number }) => `/estoque/etiquetas?pedido=ord_1&volumes=${volume.numero}`;

  function comVolumes(props: Props = {}) {
    return render("pronto", { itens: COM_VOLUMES, volumes, onFecharVolume: noop, onLevarACaixa: noop, ...props });
  }

  function painel(html: string) {
    const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
    const secao = dom.window.document.querySelector("section[aria-labelledby='volumes-do-pedido']");
    const resultado = secao
      ? {
          textos: textosDaTela(secao.outerHTML),
          etiquetas: [...secao.querySelectorAll("a")].map((link) => [link.getAttribute("aria-label"), link.getAttribute("href")]),
          fechar: [...secao.querySelectorAll("button")].find((candidato) => candidato.textContent === "Fechar volume")?.hasAttribute("disabled") ?? null,
        }
      : null;
    dom.window.close();
    return resultado;
  }

  it("o painel: o volume aberto com o que já tem, o peso e Fechar volume; os fechados, do mais recente ao mais antigo", () => {
    expect(painel(comVolumes({ etiquetaDoVolumeHref }))).toEqual({
      textos: [
        "Volumes",
        "2 fechados",
        "Volume 12",
        "aberto",
        "30 ×",
        "Calça Social Masculino Preta · 40",
        "1 ×",
        "Lancheira Grande AZ",
        "No volume",
        "31 un.",
        "Peso (kg)",
        "Fechar volume",
        "Volume 11",
        "CX-000029 · 25 un. · 6,3 kg",
        "Etiqueta",
        "Volume 10",
        "50 un. · 8,2 kg",
      ],
      etiquetas: [
        ["Etiqueta do volume 11", "/estoque/etiquetas?pedido=ord_1&volumes=11"],
        ["Etiqueta do volume 10", "/estoque/etiquetas?pedido=ord_1&volumes=10"],
      ],
      fechar: false,
    });
    expect(comVolumes()).toMatch(/<label[^>]*for="peso-do-volume"[^>]*>Peso \(kg\)<\/label>/);
  });

  it("a linha separada diz em qual volume está, depois da caixa de onde saiu", () => {
    const caixasDaLinha = new Map([["pli_ord_1_03", [{ box_code: "CX-000027", qty: 30, inteira: false, esvazia: false }]]]);
    const dom = new JSDOM(`<!doctype html><body>${comVolumes({ caixasDaLinha })}</body>`);
    const daLinha = (nome: string) => textosDaTela([...dom.window.document.querySelectorAll("li")].find((item) => item.textContent?.includes(nome))?.outerHTML ?? "");
    expect(daLinha("Calça Social Masculino Preta · 40")).toEqual(["Calça Social Masculino Preta · 40", "A.01.0712.001.40 · BTG-000083", "30 de CX-000027", "Volume 12", "30 un.", "Desfazer"]);
    // A linha com diferença também; a por separar não está em volume nenhum.
    expect(daLinha("Lancheira Grande AZ")).toEqual(["Lancheira Grande AZ", "C.0612.002.U · BTG-000106", "separado 1 de 2 · Avaria", "Volume 12", "2 un.", "Desfazer"]);
    expect(daLinha("Copo Café").join(" ")).not.toContain("Volume");
    dom.window.close();
  });

  it("nenhum selo fica dentro de parágrafo: o navegador o poria para fora da linha", () => {
    // O selo é um bloco; dentro de <p>, o navegador fecha o parágrafo antes dele e o selo sai do lugar.
    const caixasDaLinha = new Map([["pli_ord_1_03", [{ box_code: "CX-000027", qty: 30, inteira: false, esvazia: false }]]]);
    expect(comVolumes({ caixasDaLinha })).not.toMatch(/<p\b[^>]*>(?:(?!<\/p>).)*?<div\b/s);
  });

  it("a linha que foi em dois volumes diz os dois, na ordem do número", () => {
    // A prateleira toda separada fecha sozinha: os polos da A-03 aparecem com uma linha por separar nela.
    const itens = [...COM_VOLUMES, linha(7, "A-03", "Polo Masculino Piquet Preto G", "A.01.0806.005.G", "BTG-000124", 80)];
    const dom = new JSDOM(`<!doctype html><body>${comVolumes({ itens })}</body>`);
    const polo = [...dom.window.document.querySelectorAll("li")].find((item) => item.textContent?.includes("Polo Masculino Piquet Preto · P"));
    expect(textosDaTela(polo?.outerHTML ?? "")).toEqual(["Polo Masculino Piquet Preto · P", "A.01.0806.005.P · BTG-000122", "Volume 10", "Volume 11", "60 un.", "Desfazer"]);
    dom.window.close();
  });

  it("no celular, o volume aberto vem em cima da lista, numa linha, com Fechar volume", () => {
    const dom = new JSDOM(`<!doctype html><body>${comVolumes()}</body>`);
    const barra = [...dom.window.document.querySelectorAll("div")].find((bloco) => bloco.className.includes("lg:hidden") && bloco.textContent?.includes("Fechar volume"));
    expect(textosDaTela(barra?.outerHTML ?? "")).toEqual(["Volume 12", "aberto · 31 un.", "Fechar volume"]);
    // A barra vem antes da primeira prateleira.
    const html = comVolumes();
    expect(html.indexOf("aberto · 31 un.")).toBeLessThan(html.indexOf("A-03"));
    dom.window.close();
  });

  it("sem volume aberto, a bancada mostra o seguinte, vazio, com Fechar volume desligado", () => {
    const fechados = volumesDaSeparacao(DA_TAREFA.slice(0, 2), COM_VOLUMES);
    const lido = painel(comVolumes({ volumes: fechados }))!;
    expect(lido.textos.slice(0, 8)).toEqual(["Volumes", "2 fechados", "Volume 12", "aberto", "No volume", "0 un.", "Peso (kg)", "Fechar volume"]);
    expect(lido.fechar).toBe(true);
    // Antes da primeira linha, é o volume 1.
    expect(painel(comVolumes({ volumes: [] }))!.textos).toEqual(["Volumes", "Volume 1", "aberto", "No volume", "0 un.", "Peso (kg)", "Fechar volume"]);
  });

  it("com mais de dois fechados, mostra os dois mais recentes e Ver os N volumes", () => {
    const muitos = volumesDaSeparacao(
      Array.from({ length: 11 }, (_, indice) => ({ id: `v${indice + 1}`, number: indice + 1, status: "closed" as const, units: 10 + indice })),
      [],
    );
    const textos = painel(comVolumes({ volumes: muitos }))!.textos;
    expect(textos.filter((texto) => /^Volume \d+$/.test(texto))).toEqual(["Volume 12", "Volume 11", "Volume 10"]);
    expect(textos.at(-1)).toBe("Ver os 11 volumes");
  });

  it("Levar a caixa só na linha por separar de que uma caixa sai inteira; com mais de uma, Levar as caixas", () => {
    const caixasDaLinha = new Map([
      ["pli_ord_1_04", [{ box_code: "CX-000028", qty: 40, inteira: true, esvazia: false }]],
      ["pli_ord_1_06", [{ box_code: "CX-000187", qty: 1, inteira: false, esvazia: false }]],
    ]);
    const html = comVolumes({ caixasDaLinha, caixasInteiras: new Map([["pli_ord_1_04", 1]]) });
    const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
    const acoes = (nome: string) =>
      [...([...dom.window.document.querySelectorAll("li")].find((item) => item.textContent?.includes(nome))?.querySelectorAll("button") ?? [])].map((candidato) => candidato.textContent || candidato.getAttribute("aria-label"));
    expect(acoes("Calça Social Masculino Preta · 42")).toEqual(["Levar a caixa", "Separar", "Mais ações de Calça Social Masculino Preta · 42"]);
    expect(acoes("Copo Café")).toEqual(["Separar", "Mais ações de Copo Café"]);
    dom.window.close();
    expect(textosDaTela(comVolumes({ caixasInteiras: new Map([["pli_ord_1_04", 2]]) }))).toContain("Levar as caixas");
    // Sem a ação (quem só consulta), o botão não aparece.
    expect(textosDaTela(comVolumes({ caixasInteiras: new Map([["pli_ord_1_04", 1]]), operador: false }))).not.toContain("Levar a caixa");
  });

  it("quem só consulta e o pedido que já fechou a separação veem os volumes, sem peso nem Fechar volume", () => {
    for (const props of [{ operador: false }, { fechada: true }]) {
      const lido = painel(comVolumes(props))!;
      expect(lido.textos).not.toContain("Fechar volume");
      expect(lido.textos).not.toContain("Peso (kg)");
      expect(lido.textos).toContain("Volume 12");
      expect(textosDaTela(comVolumes(props))).not.toContain("Fechar volume");
    }
  });

  it("um volume sendo fechado desliga Fechar volume; sem a leitura dos volumes, a bancada não ganha o painel", () => {
    expect(painel(comVolumes({ fechandoVolume: true }))!.fechar).toBe(true);
    expect(painel(render())).toBeNull();
  });

  it("passa nas regras WCAG 2.1 A e AA do axe", async () => {
    expect(await violacoesDeAcessibilidade(comVolumes({ etiquetaDoVolumeHref, caixasInteiras: new Map([["pli_ord_1_04", 1]]) }))).toEqual([]);
    expect(await violacoesDeAcessibilidade(comVolumes({ operador: false }))).toEqual([]);
  });
});
