import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { warehouseBoxFromRecord } from "@/lib/warehouse-boxes";
import { type LabelData, type LabelMode, boxLabels, paginate, positionLabel } from "@/lib/warehouse-labels";
import type { WarehousePosition } from "@/lib/warehouse-positions";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela } from "@/test/textos";

import { LabelSheet, labelSheetCss } from "./label-sheet";

/**
 * O desenho das etiquetas (separação com caixas, parte 6; decisão 13 e a
 * aprovação de 10/11/2026, docs/mockups/WmsEtiquetaTodosCaixa.dc.html): a
 * caixa com mais de cinco produtos sai em mais de uma etiqueta do mesmo
 * tamanho, e toda etiqueta leva o logo original da Dutelog no lugar da
 * palavra. Antes, a etiqueta imprimia quatro produtos e "+ 5 produto(s) no
 * sistema". Dados sintéticos.
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

function linhas(produtos: Array<[string, string, string, number]>) {
  return produtos.map(([nome, codigo, sku, quantidade]) => ({ box_code: "CX-000142", product_name: nome, client_item_code: codigo, sku_code: sku, counted_qty: quantidade }));
}

const POSICAO = positionLabel({ code: "B-07", aisle: "B", shelf: 7, customer_code: "BTG", length_m: 2.4, depth_m: 1, height_m: 1.8, max_weight_kg: 500 } as WarehousePosition);

function folha(labels: LabelData[], mode: LabelMode = "a4") {
  const sheets = mode === "zebra" ? labels.map((label) => [label]) : paginate(labels);
  return renderToStaticMarkup(<LabelSheet sheets={sheets} mode={mode} />);
}

function etiquetas(html: string) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
  return { dom, lista: [...dom.window.document.querySelectorAll('.lbl[role="group"]')] };
}

describe("a etiqueta da caixa com todos os produtos", () => {
  const duas = boxLabels(CAIXA, linhas(NOVE), { printedAt: AGORA });

  it("a caixa com nove produtos sai em duas etiquetas, sem '+ n produto(s) no sistema'", () => {
    const html = folha(duas);
    const { dom, lista } = etiquetas(html);
    expect(lista.map((etiqueta) => etiqueta.getAttribute("aria-label"))).toEqual(["Etiqueta da caixa CX-000142, 1 de 2", "Etiqueta da caixa CX-000142, 2 de 2"]);
    expect(lista.map((etiqueta) => etiqueta.querySelectorAll(".lbl-line").length)).toEqual([5, 4]);
    expect(html).not.toContain("produto(s) no sistema");
    // O código de barras fica só na primeira: é ele que identifica a caixa.
    expect(lista.map((etiqueta) => etiqueta.querySelectorAll('svg[role="img"]').length)).toEqual([1, 0]);
    dom.window.close();
  });

  it("a primeira diz a caixa, a posição, a origem, os cinco primeiros produtos, a parte e as unidades", () => {
    const { dom, lista } = etiquetas(folha(duas));
    expect(textosDaTela(lista[0].outerHTML)).toEqual([
      "Caixa",
      "CX-000142",
      "Posição",
      "B-07",
      "BTG · 50 × 40 × 30 cm · 8,4 kg",
      "Abertura 10/11/2026",
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
    const { dom, lista } = etiquetas(folha(duas));
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
    const html = folha(boxLabels(CAIXA, linhas(NOVE.slice(0, 5)), { printedAt: AGORA }));
    const { dom, lista } = etiquetas(html);
    expect(lista.map((etiqueta) => etiqueta.getAttribute("aria-label"))).toEqual(["Etiqueta da caixa CX-000142"]);
    expect(html).not.toContain("etiqueta 1 de");
    dom.window.close();
  });

  it("a caixa sem conteúdo lançado continua com o aviso", () => {
    expect(textosDaTela(folha(boxLabels(CAIXA, [], { printedAt: AGORA })))).toContain("Conteúdo a lançar na contagem.");
  });
});

describe("o logo da Dutelog nas etiquetas", () => {
  const todas = [...boxLabels(CAIXA, linhas(NOVE), { printedAt: AGORA }), POSICAO];

  it("toda etiqueta leva o logo no rodapé (a da caixa, a de continuação e a de posição), no lugar da palavra", () => {
    const html = folha(todas);
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

  it("no rolo da Zebra, que só imprime preto, o logo sai em preto; na folha A4, nas cores dele", () => {
    expect(labelSheetCss("zebra")).toContain(".lbl-logo { filter: brightness(0); }");
    expect(labelSheetCss("a4")).not.toContain("lbl-logo");
    expect(folha(todas, "zebra")).toContain(".lbl-logo { filter: brightness(0); }");
  });

  it("a etiqueta de posição mantém o conteúdo dela", () => {
    const { dom, lista } = etiquetas(folha([POSICAO]));
    expect(textosDaTela(lista[0].outerHTML)).toEqual(["Posição", "B-07", "Zona", "BTG", "Rua B · prateleira 7", "2,40 m × 1,00 m × 1,80 m", "Peso máx. 500 kg", "Comprimento × largura × altura livre"]);
    dom.window.close();
  });
});

describe("as etiquetas na folha e no rolo", () => {
  const todas = [...boxLabels(CAIXA, linhas(NOVE), { printedAt: AGORA }), POSICAO];

  it("a continuação ocupa uma vaga da folha como qualquer etiqueta; no rolo, cada uma é uma página", () => {
    const a4 = new JSDOM(`<!doctype html><body>${folha(todas)}</body>`);
    expect(a4.window.document.querySelectorAll(".lbl-sheet")).toHaveLength(1);
    expect(a4.window.document.querySelectorAll('.lbl-sheet .lbl[role="group"]')).toHaveLength(3);
    a4.window.close();
    const rolo = new JSDOM(`<!doctype html><body>${folha(todas, "zebra")}</body>`);
    expect(rolo.window.document.querySelectorAll('.lbl-roll .lbl[role="group"]')).toHaveLength(3);
    rolo.window.close();
  });

  it("passa nas regras WCAG 2.1 A e AA do axe", async () => {
    expect(await violacoesDeAcessibilidade(folha(todas))).toEqual([]);
    expect(await violacoesDeAcessibilidade(folha(todas, "zebra"))).toEqual([]);
  });
});
