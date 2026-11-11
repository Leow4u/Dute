import { describe, expect, it } from "vitest";

import { warehouseBoxFromRecord } from "@/lib/warehouse-boxes";

import {
  caixasComOItem,
  caixasDoPedido,
  caixasGravadas,
  caixasParaEnviar,
  caixasVaziasDoPedido,
  entradaDasCaixas,
  etiquetasParaTrocar,
  linhaDeEntrada,
  separadoNasCaixas,
  somaDasInformadas,
  sugestaoDaLinha,
  textoDaCaixa,
  textoDaCandidata,
  textoDaEtiqueta,
  textoDasAbertas,
  textoDasVazias,
  textoDeEtiquetasParaTrocar,
} from "./caixas-da-separacao";
import type { WarehouseTaskItem } from "./model";

/**
 * As caixas na bancada do pedido (separação com caixas, parte 3b): de qual
 * caixa a linha sai, como nas pranchas WmsSepararBancada e
 * WmsSepararOutraCaixa.
 */

const BTG = "BTG Pactual";
const CALCA_42 = "BTG-000084";
const CALCA_44 = "BTG-000085";

const caixa = (code: string, extra: Record<string, unknown> = {}) =>
  warehouseBoxFromRecord({ code, customer_code: BTG, status: "stored", location_id: "A-05", stored_at: "2026-10-22T13:00:00.000Z", unit_count: 42, origin: { kind: "opening_inventory", session_id: "s" }, ...extra });

const linha = (extra: Partial<WarehouseTaskItem> = {}): WarehouseTaskItem => ({ id: "pli_1", sku_code: CALCA_42, location: "A-05", quantity: 40, ...extra });

// A CX-000027 entrou com 30 calças 40 e 12 calças 42; a CX-000028, com 28 calças 42 e 35 calças 44.
const ABERTURA = [
  { box_code: "CX-000027", sku_code: "BTG-000083", counted_qty: 30 },
  { box_code: "CX-000027", sku_code: CALCA_42, counted_qty: 12 },
  { box_code: "CX-000028", sku_code: CALCA_42, counted_qty: 28 },
  { box_code: "CX-000028", sku_code: CALCA_44, counted_qty: 35 },
];

describe("o conteúdo de entrada das caixas", () => {
  it("a caixa da abertura lê as linhas da sessão; a do recebimento, o que ela mesma guarda", () => {
    const recebida = caixa("CX-000064", {
      origin: { kind: "receipt", receipt_id: "inb_1", invoice_number: "48.377" },
      lines: [
        { sku_code: "btg-000118", client_item_code: "A.01.0816.005.G", product_name: "Camiseta", counted_qty: 20 },
        { sku_code: "BTG-000118", client_item_code: "A.01.0816.005.G", product_name: "Camiseta", counted_qty: 10 },
      ],
    });
    const entrada = entradaDasCaixas([caixa("CX-000027"), recebida, caixa("CX-000099")], ABERTURA);
    expect([...entrada.get("CX-000027")!]).toEqual([
      ["BTG-000083", 30],
      [CALCA_42, 12],
    ]);
    // As linhas da abertura não entram na caixa do recebimento, e a mesma linha repetida soma.
    expect([...entrada.get("CX-000064")!]).toEqual([["BTG-000118", 30]]);
    expect([...entrada.get("CX-000099")!]).toEqual([]);
  });

  it("a linha da abertura sem caixa, sem SKU ou sem quantidade não serve", () => {
    expect(linhaDeEntrada("oil_1", { box_code: "cx-000027", sku_code: "btg-000084", counted_qty: 12 })).toEqual({ box_code: "CX-000027", sku_code: CALCA_42, counted_qty: 12 });
    expect(linhaDeEntrada("oil_2", { box_code: "", sku_code: CALCA_42, counted_qty: 12 })).toBeNull();
    expect(linhaDeEntrada("oil_3", { box_code: "CX-000027", sku_code: "", counted_qty: 12 })).toBeNull();
    expect(linhaDeEntrada("oil_4", { box_code: "CX-000027", sku_code: CALCA_42, counted_qty: 0 })).toBeNull();
  });
});

describe("as caixas da prateleira que têm o item", () => {
  // A calça 40 já saiu da CX-000027 neste pedido: restam nela as 12 calças 42.
  const aberta = caixa("CX-000027", { taken_lines: [{ sku_code: "BTG-000083", qty: 30 }], taken_units: 30 });
  const seguinte = caixa("CX-000028", { stored_at: "2026-10-22T14:00:00.000Z", unit_count: 63 });
  const caixas = [seguinte, aberta];
  const entrada = entradaDasCaixas(caixas, ABERTURA);

  it("vêm da mais antiga para a mais nova, com o que cada uma tem do item agora", () => {
    expect(caixasComOItem(linha(), caixas, entrada, BTG)).toEqual([
      { code: "CX-000027", stored_at: "2026-10-22T13:00:00.000Z", disponivel: 12, saldo: 12, intacta: false, origem: "Abertura", guardadaEm: "22/10/2026" },
      { code: "CX-000028", stored_at: "2026-10-22T14:00:00.000Z", disponivel: 28, saldo: 63, intacta: true, origem: "Abertura", guardadaEm: "22/10/2026" },
    ]);
  });

  it("a sugestão é a da prancha: a mais antiga esvazia, e a seguinte completa", () => {
    const sugestao = sugestaoDaLinha(linha(), caixasComOItem(linha(), caixas, entrada, BTG));
    expect(sugestao).toEqual({
      caixas: [
        { box_code: "CX-000027", qty: 12, inteira: false, esvazia: true },
        { box_code: "CX-000028", qty: 28, inteira: false, esvazia: false },
      ],
      sem_caixa: 0,
    });
    expect(sugestao.caixas.map(textoDaCaixa)).toEqual(["12 de CX-000027", "28 de CX-000028"]);
  });

  it("a caixa intacta que sai toda é inteira", () => {
    const calca46 = linha({ sku_code: "BTG-000086", quantity: 25 });
    const inteira = caixa("CX-000029", { unit_count: 25 });
    const sugestao = sugestaoDaLinha(calca46, caixasComOItem(calca46, [inteira], entradaDasCaixas([inteira], [{ box_code: "CX-000029", sku_code: "BTG-000086", counted_qty: 25 }]), BTG));
    expect(sugestao.caixas).toEqual([{ box_code: "CX-000029", qty: 25, inteira: true, esvazia: false }]);
    expect(textoDaCaixa(sugestao.caixas[0]!)).toBe("CX-000029 inteira");
  });

  it("só entram as caixas guardadas, da prateleira da linha e do cliente do pedido, com saldo do item", () => {
    const outras = [
      caixa("CX-000030", { location_id: "A-06" }),
      caixa("CX-000031", { customer_code: "Outro Cliente" }),
      caixa("CX-000032", { status: "committing" }),
      caixa("CX-000033", { status: "emptied", taken_lines: [{ sku_code: CALCA_42, qty: 12 }], taken_units: 12 }),
      // Tudo o que tinha do item já saiu: a caixa continua guardada, com outro produto.
      caixa("CX-000034", { taken_lines: [{ sku_code: CALCA_42, qty: 12 }], taken_units: 12 }),
    ];
    const abertura = outras.map((item) => ({ box_code: item.code, sku_code: CALCA_42, counted_qty: 12 }));
    expect(caixasComOItem(linha(), outras, entradaDasCaixas(outras, abertura), BTG)).toEqual([]);
    // Sem prateleira ou sem SKU na linha, não há caixa a sugerir.
    expect(caixasComOItem(linha({ location: "" }), caixas, entrada, BTG)).toEqual([]);
    expect(caixasComOItem(linha({ sku_code: "" }), caixas, entrada, BTG)).toEqual([]);
  });

  it("a linha separada diz de onde saiu, como ela guarda", () => {
    const separada = linha({ separated_at: "2026-11-12T13:00:00.000Z", separated_qty: 40, separated_boxes: [{ box_code: "CX-000027", qty: 12, emptied: true }, { box_code: "CX-000028", qty: 28 }] });
    expect(caixasGravadas(separada).map(textoDaCaixa)).toEqual(["12 de CX-000027", "28 de CX-000028"]);
    expect(caixasGravadas(separada)[0]!.esvazia).toBe(true);
    expect(caixasGravadas(linha({ separated_boxes: [{ box_code: "CX-000029", qty: 25, whole: true }] })).map(textoDaCaixa)).toEqual(["CX-000029 inteira"]);
    expect(caixasGravadas(linha())).toEqual([]);
  });
});

describe("Outra caixa", () => {
  it("diz a origem, a data da guarda e o que a caixa tem do item", () => {
    expect(textoDaCandidata({ origem: "Abertura", guardadaEm: "22/10/2026", disponivel: 20 })).toBe("Abertura · 22/10/2026 · tem 20 un.");
    expect(textoDaCandidata({ origem: "Recebimento · NF 48.377", guardadaEm: "06/11/2026", disponivel: 1200 })).toBe("Recebimento · NF 48.377 · 06/11/2026 · tem 1.200 un.");
    expect(textoDaCandidata({ origem: "Manual", guardadaEm: null, disponivel: 3 })).toBe("Manual · tem 3 un.");
  });

  it("a soma tem de fechar com a linha; só sai sem caixa o que as caixas da prateleira não têm", () => {
    const candidatas = [
      { code: "CX-000061", disponivel: 20, saldo: 20, intacta: true },
      { code: "CX-000062", disponivel: 40, saldo: 40, intacta: true },
    ];
    expect(separadoNasCaixas(35, candidatas)).toBe(35);
    expect(separadoNasCaixas(80, candidatas)).toBe(60);
    expect(separadoNasCaixas(35, [])).toBe(0);
    expect(somaDasInformadas({ "CX-000061": 0, "CX-000062": 35 })).toBe(35);
    expect(caixasParaEnviar({ "CX-000061": 0, "CX-000062": 35 })).toEqual([{ box_code: "CX-000062", qty: 35 }]);
  });
});

describe("Etiquetas para trocar e as caixas do pedido", () => {
  // O pedido tirou 30 da CX-000027 (ficou aberta), levou a CX-000029 inteira e esvaziou a CX-000030.
  const itens = [
    linha({ id: "pli_1", separated_at: "2026-11-11T14:00:00.000Z", separated_boxes: [{ box_code: "CX-000027", qty: 30 }] }),
    linha({ id: "pli_2", separated_at: "2026-11-11T15:00:00.000Z", separated_boxes: [{ box_code: "CX-000029", qty: 25, whole: true }] }),
    linha({ id: "pli_3", separated_at: "2026-11-11T16:00:00.000Z", separated_boxes: [{ box_code: "CX-000030", qty: 8, emptied: true }, { box_code: "CX-000023", qty: 2 }] }),
    linha({ id: "pli_4" }),
  ];
  const aberta = (code: string, extra: Record<string, unknown> = {}) => caixa(code, { taken_lines: [{ sku_code: CALCA_42, qty: 30 }], taken_units: 30, balance_at: "2026-11-11T14:00:00.000Z", ...extra });
  // Só as guardadas chegam à bancada: a inteira e a vazia saíram da prateleira.
  const guardadas = [
    aberta("CX-000027"),
    aberta("CX-000023", { location_id: "A-04", unit_count: 40 }),
    // Aberta por outro pedido: não é deste.
    aberta("CX-000050"),
    caixa("CX-000028"),
  ];

  it("lista as caixas que o pedido abriu, por prateleira, com o saldo; a de outro pedido e a intacta não entram", () => {
    const lista = etiquetasParaTrocar(itens, guardadas);
    expect(lista).toEqual([
      { code: "CX-000023", posicao: "A-04", saldo: 10 },
      { code: "CX-000027", posicao: "A-05", saldo: 12 },
    ]);
    expect(lista.map(textoDaEtiqueta)).toEqual(["A-04 · saldo 10 un.", "A-05 · saldo 12 un."]);
    expect([textoDasAbertas(2), textoDasAbertas(1)]).toEqual(["2 caixas abertas", "1 caixa aberta"]);
  });

  it("a caixa sai da lista quando a etiqueta do saldo de agora foi impressa, e volta quando o saldo muda", () => {
    const impressa = aberta("CX-000027", { balance_label_printed_for: "2026-11-11T14:00:00.000Z" });
    expect(etiquetasParaTrocar(itens, [impressa]).map((etiqueta) => etiqueta.code)).toEqual([]);
    const mudou = aberta("CX-000027", { balance_at: "2026-11-12T09:00:00.000Z", balance_label_printed_for: "2026-11-11T14:00:00.000Z" });
    expect(etiquetasParaTrocar(itens, [mudou]).map((etiqueta) => etiqueta.code)).toEqual(["CX-000027"]);
  });

  it("conta as caixas do pedido: a que continua guardada é aberta; das que saíram, a que saiu toda é inteira e a outra, vazia", () => {
    expect(caixasDoPedido(itens, guardadas)).toEqual({ inteiras: 1, abertas: 2, vazias: 1 });
    expect(caixasDoPedido([linha()], guardadas)).toEqual({ inteiras: 0, abertas: 0, vazias: 0 });
  });

  it("as caixas vazias do pedido: as que ele esvaziou sem levar inteiras, com a prateleira de onde saíram (parte 4d)", () => {
    // A CX-000030 saiu da prateleira esvaziada pelo pedido; a CX-000029 saiu inteira; as outras continuam guardadas.
    expect(caixasVaziasDoPedido(itens, guardadas)).toEqual([{ code: "CX-000030", posicao: "A-05" }]);
    expect(caixasVaziasDoPedido([linha()], guardadas)).toEqual([]);
    // Por prateleira e código.
    const duas = [
      linha({ id: "pli_5", location: "B-09", separated_at: "x", separated_boxes: [{ box_code: "CX-000190", qty: 6, emptied: true }] }),
      linha({ id: "pli_6", location: "A-05", separated_at: "x", separated_boxes: [{ box_code: "CX-000031", qty: 3, emptied: true }, { box_code: "CX-000030", qty: 2, emptied: true }] }),
    ];
    expect(caixasVaziasDoPedido(duas, [])).toEqual([
      { code: "CX-000030", posicao: "A-05" },
      { code: "CX-000031", posicao: "A-05" },
      { code: "CX-000190", posicao: "B-09" },
    ]);
    expect([textoDasVazias(4), textoDasVazias(1)]).toEqual(["4 encerradas", "1 encerrada"]);
    expect([textoDeEtiquetasParaTrocar(5), textoDeEtiquetasParaTrocar(1)]).toEqual(["5 etiquetas de caixa para trocar", "1 etiqueta de caixa para trocar"]);
  });
});
