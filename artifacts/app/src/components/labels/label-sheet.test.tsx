import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { warehouseBoxFromRecord } from "@/lib/warehouse-boxes";
import { type LabelData, type LabelMode, boxLabels, labelPages, positionLabel, volumeLabels } from "@/lib/warehouse-labels";
import type { WarehousePosition } from "@/lib/warehouse-positions";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela } from "@/test/textos";

import { LabelSheet, labelSheetCss } from "./label-sheet";

/**
 * O desenho das etiquetas.
 *
 * No rolo da Zebra (separação com caixas, parte 6; decisão 13 e a aprovação
 * de 10/11/2026, docs/mockups/WmsEtiquetaTodosCaixa.dc.html): a caixa com
 * mais de cinco produtos sai em mais de uma etiqueta do mesmo tamanho, e toda
 * etiqueta leva o logo original da Dutelog no lugar da palavra.
 *
 * Na folha A4, em papel comum (decisões de 11 e 12/11/2026,
 * docs/mockups/EtiquetaA4*.dc.html): a caixa e o volume em etiquetas de
 * 148,5 × 105 mm, quatro por folha deitada, cada uma completa; a posição,
 * dez por folha em pé; as linhas de corte impressas. Dados sintéticos.
 */

const AGORA = new Date("2026-11-10T15:00:00.000Z");

const CAIXA = warehouseBoxFromRecord({
  code: "CX-000142",
  customer_code: "BTG",
  status: "stored",
  location_id: "B-07",
  length_m: 0.5,
  width_m: 0.4,
  height_m: 0.3,
  gross_weight_kg: 8.4,
  unit_count: 39,
  origin: { kind: "opening_inventory", session_id: "sessao-1" },
});

/** A mesma caixa, guardada em 22/10: a etiqueta reimpressa hoje continua com a data de entrada. */
const CAIXA_INTACTA_DE_OUTUBRO = {
  code: "CX-000142",
  customer_code: "BTG",
  status: "stored",
  location_id: "B-07",
  length_m: 0.5,
  width_m: 0.4,
  height_m: 0.3,
  gross_weight_kg: 8.4,
  unit_count: 18,
  stored_at: "2026-10-22T13:00:00.000Z",
  origin: { kind: "opening_inventory", session_id: "sessao-1" },
};

const NOVE: Array<[string, string, string, number]> = [
  ["Porta Cartão Couro", "B.0567.005.U", "BTG-000211", 12],
  ["Caneca Térmica Fokus", "C.0734.003.U", "BTG-000193", 6],
  ["Copo Stanley", "B.0672.003.U.B", "BTG-000206", 5],
  ["Copo Stanley P", "B.0672.003.U.P", "BTG-000205", 4],
  ["Copo Beercup em Inox", "B.0572.003.U.B", "BTG-000197", 3],
  ["Copo Stanley Azul", "B.0670.003.U.B", "BTG-000210", 3],
  ["Copo Café G", "B.0791.005.U", "BTG-000202", 2],
  ["Copo Café P", "B.0790.005.U", "BTG-000201", 2],
  ["Caneca Térmica Fokus Preta", "C.0735.005.U", "BTG-000194", 2],
];

function linhas(produtos: Array<[string, string, string, number]>, caixa = "CX-000142") {
  return produtos.map(([nome, codigo, sku, quantidade]) => ({ box_code: caixa, product_name: nome, client_item_code: codigo, sku_code: sku, counted_qty: quantidade }));
}

const POSICAO = positionLabel({ code: "B-07", aisle: "B", shelf: 7, customer_code: "BTG", length_m: 2.4, depth_m: 1, height_m: 1.8, max_weight_kg: 500 } as WarehousePosition);

function folha(labels: LabelData[], mode: LabelMode = "a4") {
  return renderToStaticMarkup(<LabelSheet pages={labelPages(labels, mode)} mode={mode} />);
}

function etiquetas(html: string) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
  return { dom, lista: [...dom.window.document.querySelectorAll('.lbl[role="group"]')] };
}

describe("no rolo da Zebra, a etiqueta da caixa com todos os produtos", () => {
  const duas = boxLabels(CAIXA, linhas(NOVE), { printedAt: AGORA, mode: "zebra" });

  it("a caixa com nove produtos sai em duas etiquetas, sem '+ n produto(s) no sistema'", () => {
    const html = folha(duas, "zebra");
    const { dom, lista } = etiquetas(html);
    expect(lista.map((etiqueta) => etiqueta.getAttribute("aria-label"))).toEqual(["Etiqueta da caixa CX-000142, 1 de 2", "Etiqueta da caixa CX-000142, 2 de 2"]);
    expect(lista.map((etiqueta) => etiqueta.querySelectorAll(".lbl-line").length)).toEqual([5, 4]);
    expect(html).not.toContain("produto(s) no sistema");
    // No rolo, o código de barras fica só na primeira: é ele que identifica a caixa.
    expect(lista.map((etiqueta) => etiqueta.querySelectorAll('svg[role="img"]').length)).toEqual([1, 0]);
    dom.window.close();
  });

  it("a primeira diz a caixa, a posição, a origem e a data, os cinco primeiros produtos, a parte e as unidades", () => {
    const { dom, lista } = etiquetas(folha(duas, "zebra"));
    expect(textosDaTela(lista[0].outerHTML)).toEqual([
      "Caixa",
      "CX-000142",
      "Posição",
      "B-07",
      "BTG · 50 × 40 × 30 cm · 8,4 kg",
      // A origem e a data com " · ", como nas pranchas aprovadas (antes, só um espaço).
      "Abertura · 10/11/2026",
      "12 ×",
      "Porta Cartão Couro",
      "· B.0567.005.U · BTG-000211",
      "6 ×",
      "Caneca Térmica Fokus",
      "· C.0734.003.U · BTG-000193",
      "5 ×",
      "Copo Stanley",
      "· B.0672.003.U.B · BTG-000206",
      "4 ×",
      "Copo Stanley · P",
      "· B.0672.003.U.P · BTG-000205",
      "3 ×",
      "Copo Beercup em Inox",
      "· B.0572.003.U.B · BTG-000197",
      "etiqueta 1 de 2",
      "39 un.",
    ]);
    dom.window.close();
  });

  it("a de continuação repete a caixa e a posição, diz a parte e traz os outros produtos e as unidades da caixa", () => {
    const { dom, lista } = etiquetas(folha(duas, "zebra"));
    expect(textosDaTela(lista[1].outerHTML)).toEqual([
      "CX-000142",
      "· B-07",
      "etiqueta 2 de 2",
      "3 ×",
      "Copo Stanley Azul",
      "· B.0670.003.U.B · BTG-000210",
      "2 ×",
      "Caneca Térmica Fokus Preta",
      "· C.0735.005.U · BTG-000194",
      // O código termina em U (tamanho único): o nome fica como está no catálogo.
      "Copo Café G",
      "· B.0791.005.U · BTG-000202",
      "Copo Café P",
      "· B.0790.005.U · BTG-000201",
      "39 un.",
    ]);
    dom.window.close();
  });

  it("com até cinco produtos, uma etiqueta só, sem 'etiqueta 1 de 1'", () => {
    const html = folha(boxLabels(CAIXA, linhas(NOVE.slice(0, 5)), { printedAt: AGORA, mode: "zebra" }), "zebra");
    const { dom, lista } = etiquetas(html);
    expect(lista.map((etiqueta) => etiqueta.getAttribute("aria-label"))).toEqual(["Etiqueta da caixa CX-000142"]);
    expect(html).not.toContain("etiqueta 1 de");
    dom.window.close();
  });

  it("a caixa sem conteúdo lançado continua com o aviso, no rolo e na folha", () => {
    expect(textosDaTela(folha(boxLabels(CAIXA, [], { printedAt: AGORA, mode: "zebra" }), "zebra"))).toContain("Conteúdo a lançar na contagem.");
    expect(textosDaTela(folha(boxLabels(CAIXA, [], { printedAt: AGORA })))).toContain("Conteúdo a lançar na contagem.");
  });
});

/**
 * Na folha A4, a etiqueta da caixa tem 148,5 × 105 mm
 * (docs/mockups/EtiquetaA4Caixas.dc.html): a caixa e a posição, o código de
 * barras com o cliente, as medidas, a origem e a data, os produtos em duas
 * linhas (a quantidade e o nome com o tamanho em letra grande; embaixo, o
 * código do cliente e o SKU) e o logo com a parte e o total.
 */
describe("na folha A4, a etiqueta da caixa", () => {
  const duas = boxLabels(CAIXA, linhas(NOVE), { printedAt: AGORA, mode: "a4" });

  it("a caixa com nove produtos sai em duas etiquetas completas, cada uma com o código de barras, porque cada uma é recortada", () => {
    const { dom, lista } = etiquetas(folha(duas));
    expect(lista.map((etiqueta) => etiqueta.getAttribute("aria-label"))).toEqual(["Etiqueta da caixa CX-000142, 1 de 2", "Etiqueta da caixa CX-000142, 2 de 2"]);
    expect(lista.map((etiqueta) => etiqueta.classList.contains("lbl-grande"))).toEqual([true, true]);
    expect(lista.map((etiqueta) => etiqueta.querySelectorAll(".lbl-line").length)).toEqual([5, 4]);
    expect(lista.map((etiqueta) => etiqueta.querySelectorAll('svg[role="img"]').length)).toEqual([1, 1]);
    // A parte vai ao lado do logo, no rodapé, como no rolo.
    for (const [indice, etiqueta] of lista.entries()) {
      const rodape = etiqueta.lastElementChild!;
      expect(rodape.querySelector("img.lbl-logo")?.getAttribute("src")).toBe("/dutelog-logo-etiqueta.png");
      expect(rodape.textContent).toContain(`etiqueta ${indice + 1} de 2`);
    }
    dom.window.close();
  });

  it("a primeira diz a caixa, a posição, a origem e a data, os cinco primeiros produtos com o tamanho à parte, a parte e as unidades", () => {
    const { dom, lista } = etiquetas(folha(duas));
    // textosDaTela não repete um texto que já apareceu ("Copo Stanley").
    expect(textosDaTela(lista[0].outerHTML)).toEqual([
      "Caixa",
      "CX-000142",
      "Posição",
      "B-07",
      "BTG · 50 × 40 × 30 cm · 8,4 kg",
      "Abertura · 10/11/2026",
      "12 ×",
      "Porta Cartão Couro",
      "B.0567.005.U · BTG-000211",
      "6 ×",
      "Caneca Térmica Fokus",
      "C.0734.003.U · BTG-000193",
      "5 ×",
      "Copo Stanley",
      "B.0672.003.U.B · BTG-000206",
      "4 ×",
      "· P",
      "B.0672.003.U.P · BTG-000205",
      "3 ×",
      "Copo Beercup em Inox",
      "B.0572.003.U.B · BTG-000197",
      "etiqueta 1 de 2",
      "39 un.",
    ]);
    dom.window.close();
  });

  it("a segunda repete a caixa, a posição, o código de barras e a origem, e traz os outros produtos", () => {
    const { dom, lista } = etiquetas(folha(duas));
    expect(textosDaTela(lista[1].outerHTML)).toEqual([
      "Caixa",
      "CX-000142",
      "Posição",
      "B-07",
      "BTG · 50 × 40 × 30 cm · 8,4 kg",
      "Abertura · 10/11/2026",
      "3 ×",
      "Copo Stanley Azul",
      "B.0670.003.U.B · BTG-000210",
      "2 ×",
      "Caneca Térmica Fokus Preta",
      "C.0735.005.U · BTG-000194",
      "Copo Café G",
      "B.0791.005.U · BTG-000202",
      "Copo Café P",
      "B.0790.005.U · BTG-000201",
      "etiqueta 2 de 2",
      "39 un.",
    ]);
    dom.window.close();
  });

  it("o nome comprido encurta e o tamanho fica: o tamanho mora num pedaço que não encolhe", () => {
    const azul = warehouseBoxFromRecord({ ...CAIXA_INTACTA_DE_OUTUBRO, code: "CX-000138", location_id: "B-10" });
    const entrada = [
      { box_code: "CX-000138", product_name: "Polo Masculino Piquet Azul-Marinho", client_item_code: "A.01.0805.002.GG", sku_code: "BTG-000152", counted_qty: 61 },
      { box_code: "CX-000138", product_name: "Polo Masculino Piquet Azul-Marinho", client_item_code: "A.01.0805.002.XGG", sku_code: "BTG-000154", counted_qty: 1 },
    ];
    const { dom, lista } = etiquetas(folha(boxLabels(azul, entrada, { printedAt: AGORA })));
    const nomes = [...lista[0].querySelectorAll(".lbl-line")].map((linha) => {
      const [nome, tamanho] = [...linha.querySelectorAll("div > span")];
      return [nome?.textContent, nome?.getAttribute("style")?.includes("text-overflow:ellipsis"), tamanho?.textContent, tamanho?.getAttribute("style")?.includes("flex-shrink:0")];
    });
    expect(nomes).toEqual([
      ["Polo Masculino Piquet Azul-Marinho", true, " · GG", true],
      ["Polo Masculino Piquet Azul-Marinho", true, " · XGG", true],
    ]);
    dom.window.close();
  });

  it("a lista é a grade da prancha: a quantidade numa coluna só, do tamanho da maior, e os nomes começam juntos", () => {
    const grande = warehouseBoxFromRecord({ ...CAIXA_INTACTA_DE_OUTUBRO, code: "CX-000227", unit_count: 1209 });
    const entrada = [
      { box_code: "CX-000227", product_name: "Polo Masculino Piquet Preto", client_item_code: "A.01.0805.001.M", sku_code: "BTG-000140", counted_qty: 1200 },
      { box_code: "CX-000227", product_name: "Polo Masculino Piquet Preto", client_item_code: "A.01.0805.001.G", sku_code: "BTG-000141", counted_qty: 9 },
    ];
    const { dom, lista } = etiquetas(folha(boxLabels(grande, entrada, { printedAt: AGORA })));
    const lista0 = lista[0].querySelector(".lbl-content")!;
    // docs/mockups/EtiquetaA4Caixas.dc.html: grid-template-columns max-content minmax(0,1fr), a quantidade justify-self end.
    expect(lista0.getAttribute("style")).toContain("display:grid;grid-template-columns:max-content minmax(0, 1fr);column-gap:2.5mm;row-gap:1mm");
    const linhasDaGrade = [...lista0.querySelectorAll(".lbl-line")];
    expect(linhasDaGrade.map((linha) => linha.getAttribute("style"))).toEqual(["display:contents", "display:contents"]);
    expect(linhasDaGrade.map((linha) => linha.firstElementChild?.textContent)).toEqual(["1.200 ×", "9 ×"]);
    for (const linha of linhasDaGrade) {
      const quantidade = linha.firstElementChild!.getAttribute("style")!;
      expect(quantidade).toContain("justify-self:end");
      // Sem largura mínima por linha: a coluna é uma só.
      expect(quantidade).not.toContain("min-width");
    }
    dom.window.close();
  });

  it("a caixa aberta sai com o saldo, as unidades e 'saldo em' embaixo delas, sem o peso", () => {
    const aberta = warehouseBoxFromRecord({
      code: "CX-000028",
      customer_code: "BTG Pactual",
      status: "stored",
      location_id: "A-05",
      length_m: 0.4,
      width_m: 0.6,
      height_m: 0.35,
      gross_weight_kg: 21.4,
      unit_count: 68,
      stored_at: "2026-10-22T14:10:00.000Z",
      origin: { kind: "opening_inventory", session_id: "sessao-1" },
      taken_lines: [
        { sku_code: "BTG-000084", qty: 26 },
        { sku_code: "BTG-000085", qty: 35 },
      ],
      taken_units: 61,
      balance_at: "2026-11-12T17:40:00.000Z",
    });
    const entrada = [
      { box_code: "CX-000028", product_name: "Calça Social Masculino Preta", client_item_code: "A.01.0712.001.42", sku_code: "BTG-000084", counted_qty: 28 },
      { box_code: "CX-000028", product_name: "Calça Social Masculino Preta", client_item_code: "A.01.0712.001.44", sku_code: "BTG-000085", counted_qty: 40 },
    ];
    const { dom, lista } = etiquetas(folha(boxLabels(aberta, entrada, { printedAt: AGORA })));
    expect(textosDaTela(lista[0].outerHTML)).toEqual([
      "Caixa",
      "CX-000028",
      "Posição",
      "A-05",
      "BTG Pactual · 40 × 60 × 35 cm",
      "Abertura · 22/10/2026",
      "5 ×",
      "Calça Social Masculino Preta",
      "· 44",
      "A.01.0712.001.44 · BTG-000085",
      "2 ×",
      "· 42",
      "A.01.0712.001.42 · BTG-000084",
      "7 un.",
      "saldo em 12/11/2026",
    ]);
    dom.window.close();
  });

  it("passa nas regras WCAG 2.1 A e AA do axe", async () => {
    expect(await violacoesDeAcessibilidade(folha([...duas, ...boxLabels(CAIXA, [], { printedAt: AGORA })]))).toEqual([]);
  });
});

describe("o logo da Dutelog nas etiquetas", () => {
  it("toda etiqueta do rolo leva o logo no rodapé (a da caixa, a de continuação e a de posição), no lugar da palavra", () => {
    const html = folha([...boxLabels(CAIXA, linhas(NOVE), { printedAt: AGORA, mode: "zebra" }), POSICAO], "zebra");
    const { dom, lista } = etiquetas(html);
    expect(lista).toHaveLength(3);
    for (const etiqueta of lista) {
      const logos = [...etiqueta.querySelectorAll("img.lbl-logo")];
      expect(logos.map((logo) => [logo.getAttribute("src"), logo.getAttribute("alt")])).toEqual([["/dutelog-logo.png", "Dutelog"]]);
      // O logo é o último bloco da etiqueta: o rodapé.
      expect(etiqueta.lastElementChild?.contains(logos[0])).toBe(true);
    }
    // A palavra saiu: o nome agora é o do logo.
    expect(textosDaTela(html)).not.toContain("Dutelog");
    dom.window.close();
  });

  it("na folha A4, a etiqueta da caixa leva o logo sem a borda transparente do arquivo, para os 9 mm serem do logo; a de posição, o de sempre", () => {
    const { dom, lista } = etiquetas(folha([...boxLabels(CAIXA, linhas(NOVE), { printedAt: AGORA }), POSICAO]));
    expect(lista.map((etiqueta) => etiqueta.querySelector("img.lbl-logo")?.getAttribute("src"))).toEqual([
      "/dutelog-logo-etiqueta.png",
      "/dutelog-logo-etiqueta.png",
      "/dutelog-logo.png",
    ]);
    expect(lista[0].querySelector("img.lbl-logo")?.getAttribute("style")).toContain("height:9mm");
    dom.window.close();
  });

  it("no rolo da Zebra, que só imprime preto, o logo sai em preto; na folha A4, nas cores dele", () => {
    expect(labelSheetCss("zebra")).toContain(".lbl-logo { filter: brightness(0); }");
    expect(labelSheetCss("a4")).not.toContain("lbl-logo");
    expect(folha([POSICAO], "zebra")).toContain(".lbl-logo { filter: brightness(0); }");
  });

  it("a etiqueta de posição mantém o conteúdo dela", () => {
    const { dom, lista } = etiquetas(folha([POSICAO]));
    expect(textosDaTela(lista[0].outerHTML)).toEqual(["Posição", "B-07", "Zona", "BTG", "Rua B · prateleira 7", "2,40 m × 1,00 m × 1,80 m", "Peso máx. 500 kg", "Comprimento × largura × altura livre"]);
    dom.window.close();
  });
});

describe("as folhas A4 e o rolo", () => {
  const todas = [...boxLabels(CAIXA, linhas(NOVE), { printedAt: AGORA }), POSICAO];

  it("na folha A4, a caixa e o volume vão quatro por folha deitada, com as linhas de corte; a posição, dez por folha em pé; no rolo, cada uma é uma página", () => {
    const a4 = new JSDOM(`<!doctype html><body>${folha(todas)}</body>`);
    const documento = a4.window.document;
    expect(documento.querySelectorAll(".lbl-folha")).toHaveLength(1);
    expect(documento.querySelectorAll('.lbl-folha .lbl[role="group"]')).toHaveLength(2);
    expect(documento.querySelectorAll('.lbl-folha .lbl-corte-h[aria-hidden="true"], .lbl-folha .lbl-corte-v[aria-hidden="true"]')).toHaveLength(2);
    expect(documento.querySelectorAll(".lbl-sheet")).toHaveLength(1);
    expect(documento.querySelectorAll('.lbl-sheet .lbl[role="group"]')).toHaveLength(1);
    a4.window.close();
    const cinco = [...boxLabels(CAIXA, linhas(NOVE), { printedAt: AGORA }), ...boxLabels(CAIXA, linhas(NOVE), { printedAt: AGORA }), ...boxLabels(CAIXA, [], { printedAt: AGORA })];
    const duasFolhas = new JSDOM(`<!doctype html><body>${folha(cinco)}</body>`);
    expect([...duasFolhas.window.document.querySelectorAll(".lbl-folha")].map((folhaA4) => folhaA4.querySelectorAll('.lbl[role="group"]').length)).toEqual([4, 1]);
    duasFolhas.window.close();
    const rolo = new JSDOM(`<!doctype html><body>${folha([...boxLabels(CAIXA, linhas(NOVE), { printedAt: AGORA, mode: "zebra" }), POSICAO], "zebra")}</body>`);
    expect(rolo.window.document.querySelectorAll('.lbl-roll .lbl[role="group"]')).toHaveLength(3);
    rolo.window.close();
  });

  it("cada folha diz o tamanho da página: deitada para caixa e volume, em pé para posição, as duas com nome quando vêm juntas, e o rolo com o tamanho da etiqueta", () => {
    expect(labelSheetCss("a4", new Set(["quatro"]))).toContain("@page { size: 297mm 210mm; margin: 0; }");
    expect(labelSheetCss("a4", new Set(["dez"]))).toContain("@page { size: 210mm 297mm; margin: 0; }");
    const juntas = labelSheetCss("a4", new Set(["quatro", "dez"]));
    expect(juntas).toContain("@page etiqueta-deitada { size: 297mm 210mm; margin: 0; }");
    expect(juntas).toContain("@page etiqueta-em-pe { size: 210mm 297mm; margin: 0; }");
    expect(juntas).toContain(".lbl-folha { page: etiqueta-deitada; }");
    expect(labelSheetCss("zebra", new Set(["rolo"]))).toContain("@page { size: 101.6mm 50.8mm; margin: 0; }");
    // A linha de corte das posições sai impressa (antes, só na tela).
    expect(labelSheetCss("a4")).toContain(".lbl-sheet .lbl { outline: 0.25mm dashed #000;");
    // A prévia encolhe na tela; a impressão sai em tamanho real.
    expect(labelSheetCss("a4")).toContain(".lbl-ajuste { zoom: 1 !important; }");
  });

  it("passa nas regras WCAG 2.1 A e AA do axe", async () => {
    expect(await violacoesDeAcessibilidade(folha(todas))).toEqual([]);
    expect(await violacoesDeAcessibilidade(folha([...boxLabels(CAIXA, linhas(NOVE), { printedAt: AGORA, mode: "zebra" }), POSICAO], "zebra"))).toEqual([]);
  });
});

/**
 * A etiqueta da caixa aberta no rolo, com o saldo (separação com caixas,
 * parte 3; docs/mockups/WmsSepararEtiquetaCaixa.dc.html): o que a caixa tem
 * agora, de quando é o saldo e a data de entrada, sem o peso de entrada.
 */
describe("no rolo, a etiqueta da caixa aberta, com o saldo", () => {
  // A CX-000028 entrou na abertura com 28 calças 42 e 40 calças 44; os pedidos tiraram 26 e 35.
  const ABERTA = warehouseBoxFromRecord({
    code: "CX-000028",
    customer_code: "BTG Pactual",
    status: "stored",
    location_id: "A-05",
    length_m: 0.4,
    width_m: 0.6,
    height_m: 0.35,
    gross_weight_kg: 21.4,
    unit_count: 68,
    stored_at: "2026-10-22T14:10:00.000Z",
    origin: { kind: "opening_inventory", session_id: "sessao-1" },
    taken_lines: [
      { sku_code: "BTG-000084", qty: 26 },
      { sku_code: "BTG-000085", qty: 35 },
    ],
    taken_units: 61,
    balance_at: "2026-11-12T17:40:00.000Z",
  });
  const ENTRADA = [
    { box_code: "CX-000028", product_name: "Calça Social Masculino Preta", client_item_code: "A.01.0712.001.42", sku_code: "BTG-000084", counted_qty: 28 },
    { box_code: "CX-000028", product_name: "Calça Social Masculino Preta", client_item_code: "A.01.0712.001.44", sku_code: "BTG-000085", counted_qty: 40 },
  ];

  it("diz o saldo de cada produto, as unidades com 'saldo em' e a data de entrada, sem o peso", () => {
    const { dom, lista } = etiquetas(folha(boxLabels(ABERTA, ENTRADA, { printedAt: AGORA, mode: "zebra" }), "zebra"));
    expect(textosDaTela(lista[0].outerHTML)).toEqual([
      "Caixa",
      "CX-000028",
      "Posição",
      "A-05",
      "BTG Pactual · 40 × 60 × 35 cm",
      "Abertura · 22/10/2026",
      "5 ×",
      "Calça Social Masculino Preta · 44",
      "· A.01.0712.001.44 · BTG-000085",
      "2 ×",
      "Calça Social Masculino Preta · 42",
      "· A.01.0712.001.42 · BTG-000084",
      "7 un. · saldo em 12/11/2026",
    ]);
    dom.window.close();
  });

  it("a caixa intacta guardada antes de hoje sai com a data de entrada, o peso e sem 'saldo em'", () => {
    const intacta = warehouseBoxFromRecord({ ...CAIXA_INTACTA_DE_OUTUBRO });
    const { dom, lista } = etiquetas(folha(boxLabels(intacta, linhas(NOVE.slice(0, 2)), { printedAt: AGORA, mode: "zebra" }), "zebra"));
    const textos = textosDaTela(lista[0].outerHTML);
    expect(textos).toContain("BTG · 50 × 40 × 30 cm · 8,4 kg");
    expect(textos).toContain("Abertura · 22/10/2026");
    expect(textos.at(-1)).toBe("18 un.");
    dom.window.close();
  });

  it("passa nas regras WCAG 2.1 A e AA do axe", async () => {
    expect(await violacoesDeAcessibilidade(folha(boxLabels(ABERTA, ENTRADA, { printedAt: AGORA, mode: "zebra" }), "zebra"))).toEqual([]);
  });
});

/**
 * A etiqueta do volume de expedição (separação com caixas, parte 4c;
 * docs/mockups/WmsSepararEtiquetaVolume.dc.html e WmsEtiquetaTodosVolume
 * .dc.html no rolo; docs/mockups/EtiquetaA4Volumes.dc.html na folha).
 */
describe("a etiqueta do volume", () => {
  const PEDIDO = { number: "PED-0001", customer: "BTG Pactual", destination: "Agência Faria Lima", total: 42 };
  const VOLUME_12 = {
    id: "pkg_pack_ord_1_012",
    numero: 12,
    aberto: false,
    unidades: 42,
    caixa: null,
    pesoKg: 11.6,
    fechadoEm: "2026-11-12T17:40:00.000Z",
    itens: [
      { nome: "Calça Social Masculino Preta · 40", codigo: "A.01.0712.001.40", quantidade: 30 },
      { nome: "Calça Social Masculino Preta · 42", codigo: "A.01.0712.001.42", quantidade: 12 },
    ],
  };
  const VOLUME_20 = {
    id: "pkg_pack_ord_1_020",
    numero: 20,
    aberto: false,
    unidades: 16,
    // A caixa que saiu inteira e virou o volume: só a equipe a vê.
    caixa: "CX-000190",
    pesoKg: 4.2,
    fechadoEm: "2026-11-13T12:00:00.000Z",
    itens: [
      { nome: "Lancheira Grande AZ", codigo: "C.0612.002.U", quantidade: 2 },
      { nome: "Copo Beercup em Inox", codigo: "B.0572.003.U.B", quantidade: 1 },
      { nome: "Copo Café · G", codigo: "B.0791.005.U", quantidade: 1 },
      { nome: "Copo Café · P", codigo: "B.0790.005.U", quantidade: 1 },
      { nome: "Copo Stanley · P", codigo: "B.0672.003.U.P", quantidade: 1 },
      { nome: "Copo Stanley", codigo: "B.0672.003.U.B", quantidade: 1 },
      { nome: "Caneca Térmica Fokus", codigo: "C.0734.003.U", quantidade: 1 },
      { nome: "Caneca Térmica Fokus Preta", codigo: "C.0735.005.U", quantidade: 1 },
      { nome: "Porta Cartão Couro", codigo: "B.0567.005.U", quantidade: 6 },
      { nome: "Copo Stanley Azul", codigo: "B.0670.003.U.B", quantidade: 1 },
    ],
  };

  it("no rolo, diz o pedido, o volume com o total, o cliente e o destino, a data e o peso, os produtos com o código do cliente e as unidades", () => {
    const { dom, lista } = etiquetas(folha(volumeLabels(VOLUME_12, PEDIDO, { mode: "zebra" }), "zebra"));
    expect(lista).toHaveLength(1);
    expect(lista[0].getAttribute("aria-label")).toBe("Etiqueta do volume 12 do pedido PED-0001");
    expect(textosDaTela(lista[0].outerHTML)).toEqual([
      "Pedido",
      "PED-0001",
      "Volume",
      "12",
      "de 42",
      "BTG Pactual · Agência Faria Lima",
      "12/11/2026 · 11,6 kg",
      "30 ×",
      "Calça Social Masculino Preta · 40",
      "· A.01.0712.001.40",
      "12 ×",
      "Calça Social Masculino Preta · 42",
      "· A.01.0712.001.42",
      "42 un.",
    ]);
    expect(lista[0].querySelector("svg[role='img']")?.getAttribute("aria-label")).toBe("Código de barras PED-0001-V12");
    expect(lista[0].querySelector("img.lbl-logo")?.getAttribute("alt")).toBe("Dutelog");
    dom.window.close();
  });

  it("antes de concluir, sai sem o total, no rolo e na folha", () => {
    for (const mode of ["zebra", "a4"] as const) {
      const { dom, lista } = etiquetas(folha(volumeLabels(VOLUME_12, { ...PEDIDO, total: null }, { mode }), mode));
      const textos = textosDaTela(lista[0].outerHTML);
      expect(textos.slice(0, 5)).toEqual(["Pedido", "PED-0001", "Volume", "12", "BTG Pactual · Agência Faria Lima"]);
      expect(textos.join(" ")).not.toContain("de 42");
      dom.window.close();
    }
  });

  it("no rolo, com mais de cinco produtos, a continuação repete o pedido e o volume, diz a parte e traz os outros; nenhuma cita a caixa", () => {
    const html = folha(volumeLabels(VOLUME_20, PEDIDO, { mode: "zebra" }), "zebra");
    const { dom, lista } = etiquetas(html);
    expect(lista.map((etiqueta) => etiqueta.getAttribute("aria-label"))).toEqual([
      "Etiqueta do volume 20 do pedido PED-0001, 1 de 2",
      "Etiqueta do volume 20 do pedido PED-0001, 2 de 2",
    ]);
    const primeira = textosDaTela(lista[0].outerHTML);
    expect(primeira.slice(0, 7)).toEqual(["Pedido", "PED-0001", "Volume", "20", "de 42", "BTG Pactual · Agência Faria Lima", "13/11/2026 · 4,2 kg"]);
    // A maior quantidade primeiro: cinco na primeira, os outros cinco na continuação.
    expect(primeira.slice(7, 10)).toEqual(["6 ×", "Porta Cartão Couro", "· B.0567.005.U"]);
    expect(primeira.slice(-2)).toEqual(["etiqueta 1 de 2", "16 un."]);
    expect(lista[0].querySelectorAll(".lbl-line")).toHaveLength(5);
    const continuacao = textosDaTela(lista[1].outerHTML);
    expect(continuacao.slice(0, 3)).toEqual(["PED-0001", "· Volume 20", "etiqueta 2 de 2"]);
    expect(lista[1].querySelectorAll(".lbl-line")).toHaveLength(5);
    expect(continuacao.at(-1)).toBe("16 un.");
    expect(lista[1].querySelector("svg[role='img']")).toBeNull();
    // A etiqueta vai ao cliente: não cita caixa nem posição.
    expect(html).not.toContain("CX-");
    expect(textosDaTela(html)).not.toContain("Posição");
    dom.window.close();
  });

  it("na folha A4, cada etiqueta do volume é completa: o pedido, o volume, o código de barras e cinco produtos; nenhuma cita a caixa", () => {
    const html = folha(volumeLabels(VOLUME_20, PEDIDO, { mode: "a4" }));
    const { dom, lista } = etiquetas(html);
    expect(lista.map((etiqueta) => etiqueta.getAttribute("aria-label"))).toEqual([
      "Etiqueta do volume 20 do pedido PED-0001, 1 de 2",
      "Etiqueta do volume 20 do pedido PED-0001, 2 de 2",
    ]);
    for (const [indice, etiqueta] of lista.entries()) {
      const textos = textosDaTela(etiqueta.outerHTML);
      expect(textos.slice(0, 7)).toEqual(["Pedido", "PED-0001", "Volume", "20", "de 42", "BTG Pactual · Agência Faria Lima", "13/11/2026 · 4,2 kg"]);
      expect(textos.slice(-2)).toEqual([`etiqueta ${indice + 1} de 2`, "16 un."]);
      expect(etiqueta.querySelectorAll(".lbl-line")).toHaveLength(5);
      expect(etiqueta.querySelector("svg[role='img']")?.getAttribute("aria-label")).toBe("Código de barras PED-0001-V20");
    }
    // O volume leva só o código do cliente, sem o SKU.
    expect(textosDaTela(lista[0].outerHTML)).toContain("B.0567.005.U");
    expect(html).not.toContain("CX-");
    expect(textosDaTela(html)).not.toContain("Posição");
    dom.window.close();
  });

  it("passa nas regras WCAG 2.1 A e AA do axe, na folha e no rolo", async () => {
    expect(await violacoesDeAcessibilidade(folha([...volumeLabels(VOLUME_12, PEDIDO), ...volumeLabels(VOLUME_20, PEDIDO)]))).toEqual([]);
    expect(await violacoesDeAcessibilidade(folha(volumeLabels(VOLUME_20, PEDIDO, { mode: "zebra" }), "zebra"))).toEqual([]);
  });
});
