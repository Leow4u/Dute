import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { WarehouseTask } from "@/lib/warehouse-ops/model";
import type { CaixaDaChegada } from "@/lib/wms/caixas-do-recebimento";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosForaDaLista } from "@/test/textos";

import {
  conteudoDaCaixa,
  FichaDaChegadaPorCaixaConteudo,
  linhaPeloCodigo,
  rascunhoDaCaixa,
  rascunhoVazio,
  type FichaDaChegadaPorCaixaProps,
} from "./chegada-por-caixa";

/** A bancada da chegada por caixa (parte 5b; mockups WmsRecebimentoCaixa e WmsRecebimentoFecharCaixa). */

const RECEIPT = "inb_avulso_0d0e620b";

function linha(item: string, numero: number, tamanho: string, quantidade: number) {
  return {
    inbound_item_id: item,
    line_number: numero,
    sku_code: tamanho === "XG" ? "BTG-000086" : "BTG-000087",
    client_item_code: `A.01.0806.004.${tamanho}`,
    product_name: `POLO MASCULINO PIQUET PRETO ${tamanho}`,
    size: tamanho,
    counted_qty: quantidade,
  };
}

function caixa(code: string, status: string, linhas: ReturnType<typeof linha>[], extra: Partial<CaixaDaChegada> = {}): CaixaDaChegada {
  return {
    code,
    status,
    location_id: "",
    lines: linhas,
    unit_count: linhas.reduce((soma, item) => soma + item.counted_qty, 0),
    length_m: null,
    width_m: null,
    height_m: null,
    gross_weight_kg: null,
    allow_tilt: false,
    allow_stacking: false,
    conference_revision: 2,
    refused_positions: [],
    ...extra,
  };
}

const caixas: CaixaDaChegada[] = [
  caixa("CX-000131", "committing", [linha(`${RECEIPT}_01`, 1, "XG", 29), linha(`${RECEIPT}_02`, 2, "GG", 12)], {
    location_id: "B-02",
    length_m: 0.48,
    width_m: 0.38,
    height_m: 0.3,
    gross_weight_kg: 9.4,
  }),
  caixa("CX-000132", "counting", [linha(`${RECEIPT}_02`, 2, "GG", 18)]),
];

const task: WarehouseTask = {
  id: `receiving:${RECEIPT}`,
  reference: RECEIPT,
  title: "AVL-0D0E620B",
  status: "checking",
  conference_mode: "per_box",
  receipt_number: "AVL-0D0E620B",
  invoice_number: "48.230",
  boxes: caixas,
  items: [
    {
      id: `${RECEIPT}_01`,
      line_number: 1,
      product_name: "POLO MASCULINO PIQUET PRETO XG",
      client_item_code: "A.01.0806.004.XG",
      sku_code: "BTG-000086",
      barcode: "7891234500086",
      expected_quantity: 41,
      boxed_qty: 29,
      box_codes: ["CX-000131"],
      unit_cost: 89.9,
    },
    {
      id: `${RECEIPT}_02`,
      line_number: 2,
      product_name: "POLO MASCULINO PIQUET PRETO GG",
      client_item_code: "A.01.0806.004.GG",
      sku_code: "BTG-000087",
      expected_quantity: 30,
      boxed_qty: 30,
      box_codes: ["CX-000131", "CX-000132"],
      unit_cost: 89.9,
    },
  ],
};

function render(over: Partial<FichaDaChegadaPorCaixaProps> = {}) {
  const noop = () => undefined;
  return renderToStaticMarkup(
    <FichaDaChegadaPorCaixaConteudo
      task={task}
      caixas={caixas}
      selecionada="CX-000132"
      quantidades={{}}
      busca=""
      fechando={false}
      rascunho={rascunhoVazio()}
      ocupado={false}
      podeRegistrarDivergencia
      onSelecionar={noop}
      onIniciar={noop}
      onBusca={noop}
      onAdicionar={noop}
      onQuantidade={noop}
      onLancar={noop}
      onAbrirFechamento={noop}
      onRascunho={noop}
      onFechar={noop}
      onCancelarFechamento={noop}
      onReabrir={noop}
      onRemover={noop}
      onVoltar={noop}
      onRegistrarDivergencia={noop}
      {...over}
    />,
  );
}

const CABECALHO = ["Recebimento", "em conferência", "por caixa", "AVL-0D0E620B", "NF 48.230 · 71 un.", "Registrar divergência"];
const CABECALHO_DA_CAIXA = ["Recebimento", "em conferência", "por caixa", "Voltar à chegada"];
const LINHAS_DA_NF = [
  "Linhas da NF",
  "Linha",
  "NF (un.)",
  "Em caixas (un.)",
  "Custo NF",
  "Situação",
  "1 · POLO MASCULINO PIQUET PRETO XG",
  "A.01.0806.004.XG",
  "41",
  "29",
  "89,90",
  "faltam 12",
  "2 · POLO MASCULINO PIQUET PRETO GG",
  "A.01.0806.004.GG",
  "30",
  "OK",
  "Esperado",
  "71 un.",
  "Em caixas",
  "59 un.",
  "Sem caixa",
  "12 un.",
];
const CAIXAS = [
  "Caixas da chegada",
  "Iniciar caixa",
  "CX-000131 · destino B-02",
  "XG 29 · GG 12 · 41 un. · 48 × 38 × 30 cm · 9,4 kg",
  "destino confirmado",
  "CX-000132",
  "GG 18 · 18 un.",
  "em conferência",
];

describe("a bancada da chegada por caixa", () => {
  it("a caixa em conferência: o código lido, as linhas dela com a quantidade, fechar e remover", async () => {
    const html = render();
    // As duas colunas só cabem na ficha larga; estreita, as caixas vêm antes das linhas da NF.
    expect(html).toMatch(/^<div class="@container /);
    expect(html).toContain("@2xl:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toMatch(/<input[^>]*id="caixa-qtd-inb_avulso_0d0e620b_02"[^>]*value="18"/);
    expect(
      textosForaDaLista(html, [
        ...CABECALHO,
        ...CAIXAS,
        "Caixa CX-000132",
        "Cód. cliente, SKU ou barras",
        "POLO MASCULINO PIQUET PRETO GG",
        "A.01.0806.004.GG · BTG-000087",
        "un.",
        "Fechar caixa",
        "Remover caixa",
        ...LINHAS_DA_NF,
      ]),
    ).toEqual([]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("fechar a caixa abre a vista dela: as medidas, o peso e como ela pode ir na prateleira", async () => {
    const vazio = render({ fechando: true });
    const fechar = (html: string) => html.match(/<button[^>]*>Fechar caixa<\/button>/)?.[0] ?? "";
    expect(fechar(vazio)).toContain('disabled=""');
    expect(vazio).not.toContain("Volume");
    const preenchido = render({
      fechando: true,
      rascunho: { length_cm: "48", width_cm: "38", height_cm: "30", weight_kg: "6,1", content: "", tombar: true, empilhar: false },
    });
    expect(fechar(preenchido)).not.toContain('disabled=""');
    // A vista da caixa no lugar da chegada: nem a lista das caixas nem as linhas da NF.
    expect(preenchido).not.toContain("Caixas da chegada");
    expect(preenchido).not.toContain("Linhas da NF");
    expect(
      textosForaDaLista(preenchido, [
        ...CABECALHO_DA_CAIXA,
        "Caixa CX-000132",
        "em conferência",
        "AVL-0D0E620B · NF 48.230 · GG 18 · 18 un.",
        "Comprimento (cm)",
        "Largura (cm)",
        "Altura (cm)",
        "Peso (kg)",
        "Pode virar esta caixa de lado",
        "Pode empilhar esta caixa sobre outra que suporte seu peso",
        "Volume 0,055 m³",
        "Fechar caixa",
        "Cancelar",
      ]),
    ).toEqual([]);
    expect(await violacoesDeAcessibilidade(preenchido)).toEqual([]);
  });

  it("a caixa fechada sem destino abre a vista dela, com as medidas sem edição, reabrir e remover", async () => {
    const fechada = caixa("CX-000132", "reviewed", [linha(`${RECEIPT}_02`, 2, "GG", 18)], {
      length_m: 0.48,
      width_m: 0.38,
      height_m: 0.3,
      gross_weight_kg: 6.1,
      allow_tilt: true,
    });
    const html = render({ caixas: [caixas[0]!, fechada] });
    expect(html).toMatch(/<input[^>]*id="fechar-length_cm"[^>]*disabled=""[^>]*value="48"/);
    expect(html).toMatch(/<input[^>]*id="fechar-weight_kg"[^>]*disabled=""[^>]*value="6,1"/);
    expect(html).toMatch(/<button[^>]*aria-checked="true"[^>]*id="fechar-tombar"/);
    expect(
      textosForaDaLista(html, [
        ...CABECALHO_DA_CAIXA,
        "Caixa CX-000132",
        "fechada · sem destino",
        "AVL-0D0E620B · NF 48.230 · GG 18 · 18 un.",
        "Comprimento (cm)",
        "Largura (cm)",
        "Altura (cm)",
        "Peso (kg)",
        "Pode virar esta caixa de lado",
        "Pode empilhar esta caixa sobre outra que suporte seu peso",
        "Volume 0,055 m³",
        "Reabrir para ajustar",
        "Remover caixa",
      ]),
    ).toEqual([]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
    // A caixa com destino confirmado fica na chegada, sem essas ações.
    const confirmada = render({ caixas, selecionada: "CX-000131" });
    expect(confirmada).toContain("Caixas da chegada");
    expect(confirmada).not.toContain("Reabrir para ajustar");
    expect(confirmada).not.toContain("Remover caixa");
    expect(confirmada).not.toContain("Voltar à chegada");
  });

  it("quem não registra divergência não vê o botão", () => {
    expect(render({ podeRegistrarDivergencia: false })).not.toContain("Registrar divergência");
  });
});

describe("o que a bancada lê", () => {
  it("o código lido acha a linha da NF pelo código do cliente, pelo SKU ou pelo código de barras", () => {
    const itens = task.items!;
    expect(linhaPeloCodigo(itens, "a.01.0806.004.xg ")?.id).toBe(`${RECEIPT}_01`);
    expect(linhaPeloCodigo(itens, "BTG-000087")?.id).toBe(`${RECEIPT}_02`);
    expect(linhaPeloCodigo(itens, "7891234500086")?.id).toBe(`${RECEIPT}_01`);
    expect(linhaPeloCodigo(itens, "BTG-000999")).toBeNull();
    expect(linhaPeloCodigo(itens, "  ")).toBeNull();
  });

  it("o conteúdo da caixa pelo tamanho, com o total", () => {
    expect(conteudoDaCaixa(caixas[0]!)).toBe("XG 29 · GG 12 · 41 un.");
  });

  it("a caixa já medida volta ao formato que a tela digita, em centímetros e quilos", () => {
    expect(rascunhoDaCaixa(caixas[0]!)).toEqual({
      length_cm: "48",
      width_cm: "38",
      height_cm: "30",
      weight_kg: "9,4",
      content: "",
      tombar: false,
      empilhar: false,
    });
    expect(rascunhoDaCaixa(caixa("CX-000140", "counting", [], { length_m: 0.485, width_m: null, height_m: 0.3 })).length_cm).toBe("48,5");
  });
});
