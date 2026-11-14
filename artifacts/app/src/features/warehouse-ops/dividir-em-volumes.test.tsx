import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { CaixaDaLinha } from "@workspace/dominio";

import { divisaoDaLinha, pesarParte, type DivisaoEmVolumes, type ParteDaDivisao } from "@/lib/warehouse-ops/divisao-em-volumes";
import type { LinhaDaLista } from "@/lib/warehouse-ops/lista-de-separacao";
import type { VolumeDaTarefa } from "@/lib/warehouse-ops/volumes-do-pedido";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela } from "@/test/textos";

import { DividirEmVolumesConteudo } from "./dividir-em-volumes";

/**
 * "Dividir em volumes" (separação com caixas, parte 7b; decisões 27 a 30;
 * docs/mockups/WmsDividirVolumes.dc.html, WmsDividirComItens.dc.html e
 * WmsDividirCelular.dc.html). Antes, a linha de 95 un. do PED-0001 só
 * entrava num volume: a bancada não tinha como dividi-la. Os números são os
 * das pranchas. Dados sintéticos.
 */

const noop = () => undefined;

const POLO: LinhaDaLista = {
  id: "pli_ord_1_64",
  nome: "Polo Masculino Piquet Preto · M",
  codigos: "A.01.0806.005.M · BTG-000064",
  quantidade: 95,
  caixas: ["CX-000218", "CX-000219"],
  item: { id: "pli_ord_1_64", location: "A-07", product_name: "Polo Masculino Piquet Preto M", client_item_code: "A.01.0806.005.M", sku_code: "BTG-000064", expected_quantity: 95, quantity: 95 },
};
const SUGESTAO: CaixaDaLinha[] = [
  { box_code: "CX-000218", qty: 54, inteira: false, esvazia: false },
  { box_code: "CX-000219", qty: 41, inteira: false, esvazia: false },
];
const QUINZE: VolumeDaTarefa[] = Array.from({ length: 15 }, (_, indice) => ({ id: `v${indice + 1}`, number: indice + 1, status: "closed", units: 60 }));

function partes(...quantidades: number[]): ParteDaDivisao[] {
  return quantidades.map((quantidade) => ({ quantidade, texto: null, peso: "" }));
}

/** WmsDividirVolumes: o volume 16 com 54 un. e o peso, que fecha; o 17 com o resto, aberto. */
const PRONTA: DivisaoEmVolumes = (() => {
  const divisao = divisaoDaLinha({ linha: POLO, modo: "separar", volumes: QUINZE, caixas: SUGESTAO })!;
  return { ...divisao, partes: pesarParte(divisao.partes, 0, "10,8") };
})();

/** WmsDividirComItens: o volume 16 já tinha 35 un.; depois de ajustar, 20, 54 e 21. */
const COM_ITENS = divisaoDaLinha({
  linha: POLO,
  modo: "separar",
  volumes: [...QUINZE, { id: "v16", number: 16, status: "open", units: 35 }],
  caixas: SUGESTAO,
  partes: partes(20, 54, 21),
})!;

/** O polo já separado (decisão 30), das duas caixas: 54 da CX-000218 e 41 da CX-000219, as gravadas. */
const SEPARADA: LinhaDaLista = { ...POLO, item: { ...POLO.item, separated_at: "2026-11-11T14:02:00.000Z", separated_qty: 95, separated_volumes: [{ volume_id: "v16", qty: 95 }] } };

/** WmsDividirNaSeparada: as 95 no volume 16, aberto; as caixas gravadas são o que se divide. */
const NA_SEPARADA = divisaoDaLinha({ linha: SEPARADA, modo: "dividir", volumes: [...QUINZE, { id: "v16", number: 16, status: "open", units: 95 }], caixas: SUGESTAO })!;

/** WmsDividirSeparada: depois de "Separar em 2 volumes", 54 no 16, fechado, e 41 no 17, aberto. Só as 41 se dividem. */
const DEPOIS_DE_DIVIDIR = divisaoDaLinha({
  linha: {
    ...SEPARADA,
    item: {
      ...SEPARADA.item,
      separated_volumes: [
        { volume_id: "v16", qty: 54 },
        { volume_id: "v17", qty: 41 },
      ],
    },
  },
  modo: "dividir",
  volumes: [...QUINZE, { id: "v16", number: 16, status: "closed", units: 54, weight_kg: 10.8 }, { id: "v17", number: 17, status: "open", units: 41 }],
  caixas: SUGESTAO,
})!;

function render(divisao: DivisaoEmVolumes, confirmando = false) {
  return renderToStaticMarkup(<DividirEmVolumesConteudo divisao={divisao} confirmando={confirmando} onMudar={noop} onVoltar={noop} onConfirmar={noop} />);
}

function lido(html: string) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
  const { document } = dom.window;
  const desligado = (rotulo: string) => document.querySelector(`button[aria-label='${rotulo}']`)?.hasAttribute("disabled") ?? null;
  const porTexto = (texto: string) => [...document.querySelectorAll("button")].find((botao) => botao.textContent === texto);
  const resultado = {
    valores: [...document.querySelectorAll<HTMLInputElement>("input")].map((campo) => [campo.getAttribute("aria-label"), campo.value]),
    pesosInvalidos: [...document.querySelectorAll("input[aria-invalid='true']")].map((campo) => campo.getAttribute("aria-label")),
    lixeiras: [...document.querySelectorAll("button[aria-label^='Tirar o volume']")].map((botao) => botao.getAttribute("aria-label")),
    menos16: desligado("Menos um no volume 16"),
    mais16: desligado("Mais um no volume 16"),
    menos17: desligado("Menos um no volume 17"),
    mais17: desligado("Mais um no volume 17"),
    maisUm: porTexto("Mais um volume")?.hasAttribute("disabled") ?? null,
    // O confirmar é o BotaoDeAcao (carregamento v2, parte 13h): travado é aria-disabled, nunca disabled.
    confirmar: (() => {
      const botao = [...document.querySelectorAll("button")].at(-1);
      return botao ? botao.hasAttribute("disabled") || botao.getAttribute("aria-disabled") === "true" : null;
    })(),
  };
  dom.window.close();
  return resultado;
}

describe("Dividir em volumes", () => {
  it("só rótulos, dados e ações: a linha pronta para confirmar, o 16 que fecha com o peso e o 17 aberto com o resto", () => {
    expect(textosDaTela(render(PRONTA))).toEqual([
      "Polo Masculino Piquet Preto · M · A-07 · 95 un.",
      "54 de CX-000218",
      "41 de CX-000219",
      "Un.",
      "Peso (kg)",
      "Volume 16",
      "fecha",
      "Volume 17",
      "aberto",
      "Mais um volume",
      "Voltar",
      "Separar em 2 volumes",
      "Separando…",
      "Conferir",
    ]);
    expect(lido(render(PRONTA))).toEqual({
      valores: [
        ["Separado no volume 16", "54"],
        ["Peso do volume 16 (kg)", "10,8"],
        ["Separado no volume 17", "41"],
      ],
      pesosInvalidos: [],
      lixeiras: [],
      menos16: false,
      mais16: false,
      menos17: false,
      mais17: false,
      maisUm: false,
      confirmar: false,
    });
  });

  it("o volume aberto já com itens: tem 35 un. · fecha com 55 un., o 17 com a lixeira e o 18 com o resto", () => {
    expect(textosDaTela(render(COM_ITENS))).toEqual([
      "Polo Masculino Piquet Preto · M · A-07 · 95 un.",
      "54 de CX-000218",
      "41 de CX-000219",
      "Un.",
      "Peso (kg)",
      "Volume 16",
      "tem 35 un. · fecha com 55 un.",
      "Volume 17",
      "fecha",
      "Volume 18",
      "aberto",
      "Mais um volume",
      "Voltar",
      "Separar em 3 volumes",
      "Separando…",
      "Conferir",
    ]);
    const campos = lido(render(COM_ITENS));
    expect(campos.lixeiras).toEqual(["Tirar o volume 17"]);
    expect(campos.valores).toEqual([
      ["Separado no volume 16", "20"],
      ["Peso do volume 16 (kg)", ""],
      ["Separado no volume 17", "54"],
      ["Peso do volume 17 (kg)", ""],
      ["Separado no volume 18", "21"],
    ]);
  });

  it("na linha já separada, o botão diz Dividir em N volumes; gravando, Separando… ou Dividindo…, ocupado e nunca disabled", () => {
    const atual = (html: string) => {
      const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
      const botao = [...dom.window.document.querySelectorAll("button")].at(-1);
      const texto = botao?.querySelector(".botao-acao-camada[data-atual]")?.textContent ?? botao?.textContent;
      dom.window.close();
      return texto;
    };
    expect(atual(render(NA_SEPARADA))).toBe("Dividir em 2 volumes");
    // O gerúndio, com a reticência única, entra aos 300 ms (o BotaoDeAcao); antes, o botão tocado fica o mesmo, afundado.
    expect(textosDaTela(render(NA_SEPARADA, true))).toContain("Dividindo…");
    expect(textosDaTela(render(PRONTA, true))).toContain("Separando…");
    expect(textosDaTela(render(PRONTA, true)).join(" ")).not.toContain("...");
    const html = render(PRONTA, true);
    expect(html).toMatch(/<button[^>]*data-estado="andamento"[^>]*aria-disabled="true"/);
    expect(html).not.toMatch(/<button[^>]*\sdisabled=""[^>]*data-estado="andamento"/);
    expect(lido(html).confirmar).toBe(true);
  });

  it("gravando, nada se edita: a tela mostra o que foi mandado, e o Voltar e o confirmar esperam ocupados", () => {
    const nome = (campo: Element) =>
      campo.getAttribute("aria-label") ?? campo.querySelector(".botao-acao-camada[data-atual]")?.textContent ?? campo.textContent;
    const ligados = (html: string) => {
      const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
      const nomes = [...dom.window.document.querySelectorAll("button, input")]
        .filter((campo) => !campo.hasAttribute("disabled") && campo.getAttribute("aria-disabled") !== "true")
        .map(nome);
      dom.window.close();
      return nomes;
    };
    const ocupados = (html: string) => {
      const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
      // Ocupado não é desabilitado (carregamento v2, seção 7): aria-disabled, e o foco fica no botão tocado.
      const nomes = [...dom.window.document.querySelectorAll("button[aria-disabled='true']:not([disabled])")].map(nome);
      dom.window.close();
      return nomes;
    };
    expect(ligados(render(COM_ITENS, true))).toEqual([]);
    expect(ocupados(render(COM_ITENS, true))).toEqual(["Voltar", "Separar em 3 volumes"]);
    // Sem gravar, os passos, os campos, a lixeira e Mais um volume ficam ligados.
    expect(ligados(render(COM_ITENS))).toContain("Tirar o volume 17");
    expect(ligados(render(COM_ITENS))).toContain("Mais um volume");
    expect(ligados(render(COM_ITENS))).toContain("Peso do volume 16 (kg)");
  });

  it("− desliga em 1; + desliga quando a linha que acompanha está em 1; Mais um volume, com o último abaixo de 2", () => {
    expect(lido(render({ ...PRONTA, partes: partes(1, 94) }))).toMatchObject({ menos16: true, mais16: false, menos17: false, mais17: true, maisUm: false });
    expect(lido(render({ ...PRONTA, partes: partes(94, 1) }))).toMatchObject({ menos16: false, mais16: true, menos17: true, mais17: false, maisUm: true, confirmar: false });
  });

  it("o peso inválido marca o campo e desliga a confirmação; o vazio vale", () => {
    const html = render({ ...PRONTA, partes: pesarParte(PRONTA.partes, 0, "abc") });
    const invalido = lido(html);
    expect(invalido.pesosInvalidos).toEqual(["Peso do volume 16 (kg)"]);
    expect(invalido.confirmar).toBe(true);
    // A borda e o anel de erro, como nas pranchas: sem eles, o campo errado fica igual aos outros.
    const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
    const marcado = dom.window.document.querySelector("input[aria-invalid='true']")?.className.split(/\s+/);
    dom.window.close();
    expect(marcado).toEqual(
      expect.arrayContaining(["aria-[invalid=true]:border-destructive", "aria-[invalid=true]:ring-1", "aria-[invalid=true]:ring-destructive", "aria-[invalid=true]:focus-visible:ring-2"]),
    );
    expect(lido(render({ ...PRONTA, partes: pesarParte(PRONTA.partes, 0, "") })).confirmar).toBe(false);
  });

  it("cada volume dá nome ao grupo das unidades, e o peso tem id próprio em cada linha", () => {
    const dom = new JSDOM(`<!doctype html><body>${render(COM_ITENS)}</body>`);
    const { document } = dom.window;
    const grupos = [...document.querySelectorAll("[role='group']")].map((grupo) =>
      textosDaTela(document.getElementById(grupo.getAttribute("aria-labelledby") ?? "")?.outerHTML ?? "").join(" "),
    );
    expect(grupos).toEqual(["Volume 16", "Volume 17", "Volume 18 aberto"]);
    expect([...document.querySelectorAll("input[aria-label^='Peso do volume']")].map((campo) => campo.id)).toEqual(["dividir-peso-16", "dividir-peso-17"]);
    dom.window.close();
  });

  it("no celular, sem peso nem cabeçalho e com os botões de 44 px; no computador, 40 px", () => {
    const dom = new JSDOM(`<!doctype html><body>${render(COM_ITENS)}</body>`);
    const { document } = dom.window;
    const classes = (seletor: string) => [...document.querySelectorAll(seletor)].map((elemento) => elemento.className.split(/\s+/));
    for (const peso of classes("input[aria-label^='Peso do volume']")) expect(peso).toEqual(expect.arrayContaining(["hidden", "lg:block"]));
    const cabecalho = document.querySelector("[aria-hidden='true']");
    expect(cabecalho?.className.split(/\s+/)).toEqual(expect.arrayContaining(["hidden", "lg:grid"]));
    // O − e o + têm a altura do grupo: 46 px com a borda no celular (44 por dentro, como na prancha) e 40 no computador.
    const grupos = classes("[role='group']");
    expect(grupos).toHaveLength(3);
    for (const grupo of grupos) expect(grupo).toEqual(expect.arrayContaining(["h-11.5", "lg:h-10"]));
    for (const botao of classes("button[aria-label^='Menos um'], button[aria-label^='Mais um']")) expect(botao).toEqual(expect.arrayContaining(["h-full", "w-11", "lg:w-10"]));
    for (const lixeira of classes("button[aria-label^='Tirar o volume']")) expect(lixeira).toEqual(expect.arrayContaining(["h-11", "w-11", "lg:h-10", "lg:w-10"]));
    dom.window.close();
  });

  it("o foco do −, do número e do + fica por dentro do grupo, como nas pranchas: o anel de fora some no grupo", () => {
    const dom = new JSDOM(`<!doctype html><body>${render(COM_ITENS)}</body>`);
    const { document } = dom.window;
    const classes = (seletor: string) => [...document.querySelectorAll(seletor)].map((elemento) => elemento.className.split(/\s+/));
    const porDentro = ["focus-visible:outline-solid", "focus-visible:outline-2", "focus-visible:-outline-offset-2", "focus-visible:outline-foreground"];
    const passos = classes("[role='group'] button");
    expect(passos).toHaveLength(6);
    for (const botao of passos) {
      expect(botao).toEqual(expect.arrayContaining([...porDentro, "focus-visible:ring-0", "focus-visible:ring-offset-0"]));
      // Nem o contorno apagado do botão, nem o anel de fora.
      expect(botao).not.toContain("focus-visible:outline-none");
      expect(botao).not.toContain("focus-visible:ring-2");
      expect(botao).not.toContain("focus-visible:ring-offset-2");
    }
    const campos = classes("[role='group'] input");
    expect(campos).toHaveLength(3);
    for (const campo of campos) expect(campo).toEqual(expect.arrayContaining(porDentro));
    dom.window.close();
  });

  it("a linha sem prateleira não deixa o separador sobrando, e sem caixa não há etiqueta de caixa", () => {
    const textos = textosDaTela(render({ ...PRONTA, posicao: "", caixas: [] }));
    expect(textos[0]).toBe("Polo Masculino Piquet Preto · M · 95 un.");
    expect(textos.join(" ")).not.toContain("CX-");
  });

  it("só rótulos, dados e ações na linha já separada (decisão 30): as caixas gravadas, que somam o que se divide, em cinza como na bancada", () => {
    expect(textosDaTela(render(NA_SEPARADA))).toEqual([
      "Polo Masculino Piquet Preto · M · A-07 · 95 un.",
      "54 de CX-000218",
      "41 de CX-000219",
      "Un.",
      "Peso (kg)",
      "Volume 16",
      "fecha",
      "Volume 17",
      "aberto",
      "Mais um volume",
      "Voltar",
      "Dividir em 2 volumes",
      "Dividindo…",
      "Conferir",
    ]);
    const cores = (html: string) => {
      const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
      const lista = [...dom.window.document.querySelectorAll("span.font-mono")].map((caixa) => caixa.className.split(/\s+/));
      dom.window.close();
      return lista;
    };
    // As de onde a linha saiu, em cinza; as de onde a por separar sai, em azul.
    for (const caixa of cores(render(NA_SEPARADA))) expect(caixa).toEqual(expect.arrayContaining(["bg-muted", "text-foreground"]));
    for (const caixa of cores(render(PRONTA))) expect(caixa).toEqual(expect.arrayContaining(["bg-info-soft", "text-info-soft-foreground"]));
    expect(cores(render(NA_SEPARADA))).toHaveLength(2);
  });

  it("depois de dividir, só as 41 do volume aberto se dividem, sem as caixas da linha toda, que desmentiriam o total", () => {
    expect(textosDaTela(render(DEPOIS_DE_DIVIDIR))).toEqual([
      "Polo Masculino Piquet Preto · M · A-07 · 41 un.",
      "Un.",
      "Peso (kg)",
      "Volume 17",
      "fecha",
      "Volume 18",
      "aberto",
      "Mais um volume",
      "Voltar",
      "Dividir em 2 volumes",
      "Dividindo…",
      "Conferir",
    ]);
    expect(lido(render(DEPOIS_DE_DIVIDIR)).valores).toEqual([
      ["Separado no volume 17", "21"],
      ["Peso do volume 17 (kg)", ""],
      ["Separado no volume 18", "20"],
    ]);
  });

  it("passa nas regras WCAG 2.1 A e AA do axe", async () => {
    expect(await violacoesDeAcessibilidade(render(PRONTA))).toEqual([]);
    expect(await violacoesDeAcessibilidade(render(COM_ITENS))).toEqual([]);
    expect(await violacoesDeAcessibilidade(render(NA_SEPARADA))).toEqual([]);
    expect(await violacoesDeAcessibilidade(render(DEPOIS_DE_DIVIDIR))).toEqual([]);
    expect(await violacoesDeAcessibilidade(render(COM_ITENS, true))).toEqual([]);
  });
});
