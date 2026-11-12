import { describe, expect, it } from "vitest";

import { warehouseBoxFromRecord } from "./warehouse-boxes";
import { volumesDaSeparacao } from "./warehouse-ops/volumes-do-pedido";
import {
  BOXES_PER_SHEET,
  CONTINUATION_LABEL_LINES,
  FIRST_LABEL_LINES,
  POSITIONS_PER_SHEET,
  SAIDA_GUARDADA,
  SHEET_LABEL_LINES,
  balanceContent,
  boxContent,
  boxLabels,
  boxLabelAvailability,
  guardarSaida,
  impressoesParaRegistrar,
  labelLines,
  labelPages,
  labelsUrl,
  nameAndSize,
  parseLabelsQuery,
  positionLabel,
  saidaDaTela,
  saidaGuardada,
  saldosParaRegistrar,
  sheetMargins,
  textoDaImpressao,
  volumeLabels,
} from "./warehouse-labels";

const box = warehouseBoxFromRecord({
  code: "CX-000012",
  customer_code: "BTG Pactual",
  status: "stored",
  location_id: "A-03",
  length_m: 0.5,
  width_m: 0.5,
  height_m: 0.35,
  gross_weight_kg: 12.4,
  unit_count: 30,
  origin: { kind: "opening_inventory", session_id: "sessao-1" },
});
const line = (sku: string, qty: number, extra: Record<string, unknown> = {}) => ({
  box_code: "cx-000012",
  sku_code: sku,
  client_item_code: `C-${sku}`,
  product_name: `Produto ${sku}`,
  counted_qty: qty,
  ...extra,
});

describe("etiqueta da caixa", () => {
  it("lista o conteúdo por produto, somando linhas repetidas, da maior quantidade para a menor", () => {
    const content = boxContent([line("A", 5), line("B", 13), line("A", 7), line("C", 1, { box_code: "CX-000099" })], "CX-000012");
    expect(content).toEqual([
      { code: "C-B", sku: "B", name: "Produto B", qty: 13 },
      { code: "C-A", sku: "A", name: "Produto A", qty: 12 },
    ]);
    // Empate na quantidade: ordem alfabética, para a etiqueta sair sempre igual.
    expect(boxContent([line("Z", 4), line("A", 4)], "CX-000012").map((item) => item.code)).toEqual(["C-A", "C-Z"]);
  });

  it("monta a etiqueta com posição, medidas e total; com até cinco produtos, uma etiqueta só", () => {
    const lines = ["A", "B", "C", "D", "E"].map((sku, index) => line(sku, 10 - index));
    const labels = boxLabels(box, lines, { printedAt: new Date("2026-10-17T12:00:00Z") });
    expect(labels).toHaveLength(1);
    const [label] = labels;
    expect(label.kind).toBe("box");
    expect(label.code).toBe("CX-000012");
    expect(label.position).toBe("A-03");
    expect(label.dimensions).toBe("50 × 50 × 35 cm · 12,4 kg");
    expect(label.units).toBe(10 + 9 + 8 + 7 + 6);
    expect(label.lines.map((item) => item.sku)).toEqual(["A", "B", "C", "D", "E"]);
    expect([label.part, label.parts]).toEqual([1, 1]);
    expect(label.origin).toBe("Abertura");
    expect(label.date).toBe("17/10/2026");
  });

  it("sem linhas conhecidas, usa o contador da caixa", () => {
    const labels = boxLabels(box, []);
    expect(labels).toHaveLength(1);
    expect(labels[0].units).toBe(30);
    expect(labels[0].lines).toEqual([]);
    expect([labels[0].part, labels[0].parts]).toEqual([1, 1]);
  });

  it("separa o nome e o tamanho, para a folha A4 encurtar o nome comprido sem cortar o tamanho", () => {
    const [linha] = boxContent(
      [{ box_code: "CX-000012", sku_code: "BTG-000154", client_item_code: "A.01.0805.002.XGG", product_name: "Polo Masculino Piquet Azul-Marinho", counted_qty: 1 }],
      "CX-000012",
    );
    expect(linha).toEqual({ code: "A.01.0805.002.XGG", sku: "BTG-000154", name: "Polo Masculino Piquet Azul-Marinho · XGG", qty: 1, size: "XGG" });
    expect(nameAndSize(linha!)).toEqual({ name: "Polo Masculino Piquet Azul-Marinho", size: "XGG" });
    // Tamanho único (U) e produto sem tamanho: o nome inteiro.
    expect(nameAndSize({ name: "Copo Café G" })).toEqual({ name: "Copo Café G", size: null });
    // Um tamanho que não está no fim do nome não é separado.
    expect(nameAndSize({ name: "Polo · M", size: "G" })).toEqual({ name: "Polo · M", size: null });
  });
});

/**
 * Toda etiqueta mostra todos os produtos (separação com caixas, parte 6;
 * decisão 13 de 10/11/2026, docs/mockups/WmsEtiquetaTodosCaixa.dc.html).
 * Antes, a caixa com nove produtos imprimia quatro e "+ 5 produto(s) no
 * sistema".
 */
describe("etiqueta da caixa com todos os produtos", () => {
  const produtos = (quantos: number) => Array.from({ length: quantos }, (_, index) => line(`P${String(index + 1).padStart(2, "0")}`, 100 - index));

  it("a caixa com nove produtos sai em duas etiquetas: cinco na primeira e quatro na de continuação", () => {
    const labels = boxLabels(box, produtos(9), { printedAt: new Date("2026-10-17T12:00:00Z") });
    expect(labels.map((label) => [label.part, label.parts, label.lines.length])).toEqual([
      [1, 2, 5],
      [2, 2, 4],
    ]);
    // Nenhum produto fica de fora, e a ordem é a de sempre: a maior quantidade primeiro.
    expect(labels.flatMap((label) => label.lines.map((item) => item.sku))).toEqual(["P01", "P02", "P03", "P04", "P05", "P06", "P07", "P08", "P09"]);
  });

  it("a continuação repete a caixa, a posição, a origem e as unidades da caixa inteira", () => {
    const [primeira, continuacao] = boxLabels(box, produtos(9), { printedAt: new Date("2026-10-17T12:00:00Z") });
    const total = 100 + 99 + 98 + 97 + 96 + 95 + 94 + 93 + 92;
    expect(primeira.units).toBe(total);
    expect(continuacao).toMatchObject({
      kind: "box",
      code: "CX-000012",
      position: "A-03",
      customer: "BTG Pactual",
      units: total,
      origin: "Abertura",
      date: "17/10/2026",
      balanceAt: null,
    });
  });

  it("no rolo, cinco na primeira e onze em cada continuação: 16 produtos cabem em duas etiquetas, 17 pedem a terceira", () => {
    expect([FIRST_LABEL_LINES, CONTINUATION_LABEL_LINES]).toEqual([5, 11]);
    expect(labelLines("zebra")).toEqual({ first: 5, next: 11 });
    const rolo = { mode: "zebra" as const };
    expect(boxLabels(box, produtos(5), rolo).map((label) => label.lines.length)).toEqual([5]);
    expect(boxLabels(box, produtos(6), rolo).map((label) => label.lines.length)).toEqual([5, 1]);
    expect(boxLabels(box, produtos(16), rolo).map((label) => label.lines.length)).toEqual([5, 11]);
    const tres = boxLabels(box, produtos(17), rolo);
    expect(tres.map((label) => [label.part, label.parts, label.lines.length])).toEqual([
      [1, 3, 5],
      [2, 3, 11],
      [3, 3, 1],
    ]);
  });

  it("na folha A4, cinco em cada etiqueta, porque cada uma é completa: 11 a 16 produtos saem em 3 ou 4 etiquetas na folha e em 2 no rolo", () => {
    expect(SHEET_LABEL_LINES).toBe(5);
    expect(labelLines("a4")).toEqual({ first: 5, next: 5 });
    const folha = { mode: "a4" as const };
    expect(boxLabels(box, produtos(5), folha).map((label) => label.lines.length)).toEqual([5]);
    expect(boxLabels(box, produtos(11), folha).map((label) => label.lines.length)).toEqual([5, 5, 1]);
    expect(boxLabels(box, produtos(16), folha).map((label) => [label.part, label.parts, label.lines.length])).toEqual([
      [1, 4, 5],
      [2, 4, 5],
      [3, 4, 5],
      [4, 4, 1],
    ]);
    expect(boxLabels(box, produtos(11), { mode: "zebra" })).toHaveLength(2);
    // Sem a saída, vale a da folha: a de menos produtos por etiqueta, que serve às duas e nunca esconde produto.
    expect(boxLabels(box, produtos(11)).map((label) => label.lines.length)).toEqual([5, 5, 1]);
  });
});

describe("etiqueta da posição", () => {
  it("traz código, rua, zona e medidas", () => {
    const label = positionLabel({
      id: "A-01",
      code: "A-01",
      aisle: "A",
      shelf: 1,
      length_m: 1.8,
      depth_m: 0.75,
      height_m: 0.65,
      max_weight_kg: null,
      customer_code: "BTG Pactual",
    });
    expect(label).toEqual({
      kind: "position",
      code: "A-01",
      aisle: "A",
      shelf: 1,
      zone: "BTG Pactual",
      dimensions: "1,80 m × 0,75 m × 0,65 m",
      maxWeight: "sem limite",
    });
    expect(positionLabel({ id: "B-02", code: "B-02", aisle: "B", shelf: 2, length_m: 1, depth_m: 1, height_m: 1, customer_code: "  " }).zone).toBeNull();
  });
});

describe("as páginas da impressão", () => {
  const caixa = (codigo: string) => boxLabels({ ...box, code: codigo }, [])[0]!;
  const posicao = (codigo: string) => positionLabel({ id: codigo, code: codigo, aisle: "A", shelf: 1, length_m: 1, depth_m: 1, height_m: 1 });

  it("a folha das posições centra o bloco de duas colunas por cinco linhas na A4 em pé", () => {
    expect(sheetMargins()).toEqual({ left: 3.4, top: 21.5 });
    expect(POSITIONS_PER_SHEET).toBe(10);
    expect(BOXES_PER_SHEET).toBe(4);
  });

  it("na folha A4, caixa e volume vão de quatro em quatro e a posição de dez em dez, depois deles; as duas nunca dividem a folha", () => {
    const caixas = ["CX-000001", "CX-000002", "CX-000003", "CX-000004", "CX-000005"].map(caixa);
    const posicoes = Array.from({ length: 12 }, (_, indice) => posicao(`A-${String(indice + 1).padStart(2, "0")}`));
    const paginas = labelPages([...caixas.slice(0, 2), ...posicoes, ...caixas.slice(2)], "a4");
    expect(paginas.map((pagina) => [pagina.kind, pagina.labels.map((etiqueta) => etiqueta.code)])).toEqual([
      ["quatro", ["CX-000001", "CX-000002", "CX-000003", "CX-000004"]],
      ["quatro", ["CX-000005"]],
      ["dez", posicoes.slice(0, 10).map((etiqueta) => etiqueta.code)],
      ["dez", ["A-11", "A-12"]],
    ]);
    expect(labelPages([], "a4")).toEqual([]);
  });

  it("no rolo, uma etiqueta por página, na ordem", () => {
    expect(labelPages([caixa("CX-000001"), posicao("A-01")], "zebra")).toEqual([
      { kind: "rolo", labels: [caixa("CX-000001")] },
      { kind: "rolo", labels: [posicao("A-01")] },
    ]);
  });

  it("a contagem diz as etiquetas, as folhas e o que elas levam, no plural certo; no rolo, sem folhas", () => {
    expect(textoDaImpressao({ etiquetas: 2, folhas: 1, caixas: 2, posicoes: 0, volumes: 0, mode: "a4" })).toBe("2 etiquetas · 1 folha · 2 caixas");
    expect(textoDaImpressao({ etiquetas: 1, folhas: 1, caixas: 1, posicoes: 0, volumes: 0, mode: "a4" })).toBe("1 etiqueta · 1 folha · 1 caixa");
    expect(textoDaImpressao({ etiquetas: 12, folhas: 2, caixas: 0, posicoes: 12, volumes: 0, mode: "a4" })).toBe("12 etiquetas · 2 folhas · 12 posições");
    expect(textoDaImpressao({ etiquetas: 44, folhas: 11, caixas: 0, posicoes: 0, volumes: 42, mode: "a4" })).toBe("44 etiquetas · 11 folhas · 42 volumes");
    expect(textoDaImpressao({ etiquetas: 3, folhas: 3, caixas: 2, posicoes: 1, volumes: 0, mode: "zebra" })).toBe("3 etiquetas · 2 caixas · 1 posição");
  });
});

describe("a saída guardada no computador", () => {
  function armazenamento(inicial: Record<string, string> = {}) {
    const dados = new Map(Object.entries(inicial));
    return { getItem: (chave: string) => dados.get(chave) ?? null, setItem: (chave: string, valor: string) => void dados.set(chave, valor), dados };
  }

  it("guarda e lê a saída escolhida; valor estranho ou storage bloqueado, nenhuma", () => {
    const local = armazenamento();
    expect(saidaGuardada(local)).toBeNull();
    guardarSaida("zebra", local);
    expect(local.dados.get(SAIDA_GUARDADA)).toBe("zebra");
    expect(saidaGuardada(local)).toBe("zebra");
    expect(saidaGuardada(armazenamento({ [SAIDA_GUARDADA]: "laser" }))).toBeNull();
    const bloqueado = {
      getItem: () => {
        throw new Error("bloqueado");
      },
      setItem: () => {
        throw new Error("bloqueado");
      },
    };
    expect(saidaGuardada(bloqueado)).toBeNull();
    expect(() => guardarSaida("a4", bloqueado)).not.toThrow();
    expect(saidaGuardada(null)).toBeNull();
  });

  it("a saída do endereço vale primeiro; sem ela, a guardada; sem nenhuma, a folha A4", () => {
    expect(saidaDaTela({ mode: "a4" }, "zebra")).toBe("a4");
    expect(saidaDaTela({ mode: null }, "zebra")).toBe("zebra");
    expect(saidaDaTela({ mode: null }, null)).toBe("a4");
  });
});

describe("endereço da tela de etiquetas", () => {
  it("vai e volta sem perder nada; sem 'modo', a saída fica para a tela decidir", () => {
    const url = labelsUrl({ boxes: ["CX-000001", "CX-000002"], mode: "zebra" });
    expect(url).toBe("/estoque/etiquetas?caixas=CX-000001%2CCX-000002&modo=zebra");
    expect(parseLabelsQuery(url.split("?")[1]!)).toEqual({
      boxes: ["CX-000001", "CX-000002"],
      positions: [],
      session: false,
      receipt: null,
      order: null,
      volumes: [],
      mode: "zebra",
    });
    // O "pular" saiu com a folha adesiva de dez (decisão de 11/11/2026): o endereço antigo é ignorado.
    expect(parseLabelsQuery("?sessao=atual&posicoes=a-01,A-01,,b-02&pular=3")).toEqual({
      boxes: [],
      positions: ["A-01", "B-02"],
      session: true,
      receipt: null,
      order: null,
      volumes: [],
      mode: null,
    });
    expect(labelsUrl({ boxes: ["CX-000001"], mode: "a4" })).toBe("/estoque/etiquetas?caixas=CX-000001&modo=a4");
    expect(parseLabelsQuery("?modo=a4").mode).toBe("a4");
    expect(parseLabelsQuery("?modo=laser").mode).toBeNull();
    expect(labelsUrl({})).toBe("/estoque/etiquetas");
  });

  it("leva a chegada, para a volta ao Receber e a tela dizer de onde as caixas vieram (parte 6)", () => {
    const url = labelsUrl({ boxes: ["CX-000225", "CX-000226"], receipt: "AVL-7C21A9F0" });
    expect(url).toBe("/estoque/etiquetas?caixas=CX-000225%2CCX-000226&chegada=AVL-7C21A9F0");
    expect(parseLabelsQuery(url.split("?")[1]!).receipt).toBe("AVL-7C21A9F0");
    expect(parseLabelsQuery("?caixas=CX-000225&chegada=%20").receipt).toBeNull();
  });
});

/**
 * A etiqueta do volume de expedição (separação com caixas, parte 4c;
 * docs/mockups/WmsSepararEtiquetaVolume.dc.html e WmsEtiquetaTodosVolume
 * .dc.html). Antes, o pedido saía sem etiqueta de volume.
 */
describe("etiqueta do volume", () => {
  const PEDIDO = { number: "PED-0001", customer: "BTG Pactual", destination: "Agência Faria Lima", total: null };
  const VOLUME_12 = {
    id: "v3",
    numero: 12,
    aberto: false,
    unidades: 42,
    // A caixa que virou o volume é só da equipe: a etiqueta do cliente não a cita.
    caixa: "CX-000029",
    pesoKg: 11.6,
    fechadoEm: "2026-11-12T17:40:00.000Z",
    itens: [
      { nome: "Calça Social Masculino Preta · 42", codigo: "A.01.0712.001.42", quantidade: 12 },
      { nome: "Calça Social Masculino Preta · 40", codigo: "A.01.0712.001.40", quantidade: 30 },
    ],
  };

  it("leva o pedido, o volume, o cliente, o destino, a data, o peso e os produtos com o código do cliente, a maior quantidade primeiro", () => {
    expect(volumeLabels(VOLUME_12, PEDIDO)).toEqual([
      {
        kind: "volume",
        code: "PED-0001-V12",
        order: "PED-0001",
        number: 12,
        total: null,
        recipient: "BTG Pactual · Agência Faria Lima",
        closing: "12/11/2026 · 11,6 kg",
        units: 42,
        lines: [
          { code: "A.01.0712.001.40", sku: "", name: "Calça Social Masculino Preta · 40", qty: 30, size: "40" },
          { code: "A.01.0712.001.42", sku: "", name: "Calça Social Masculino Preta · 42", qty: 12, size: "42" },
        ],
        part: 1,
        parts: 1,
      },
    ]);
    // Nada da etiqueta cita a caixa.
    expect(JSON.stringify(volumeLabels(VOLUME_12, PEDIDO))).not.toContain("CX-");
  });

  it("o tamanho que mora no campo Tamanho, e não no fim do código, também fica à parte, como na caixa", () => {
    // A linha da separação traz o Tamanho do produto; o nome do volume já sai com ele (nomeComTamanho).
    const [volume] = volumesDaSeparacao(
      [{ id: "v1", number: 3, status: "closed", units: 4, closed_at: "2026-11-12T17:40:00.000Z" }],
      [
        {
          id: "pli_ord_1_01",
          line_number: 1,
          product_name: "Copo Térmico Stanley Quencher Azul-Marinho Edição Especial",
          client_item_code: "B.0672.003.U.B",
          sku_code: "BTG-000206",
          size: "473ML",
          separated_qty: 4,
          separated_volumes: [{ volume_id: "v1", qty: 4 }],
        },
      ],
    );
    expect(volume!.itens).toEqual([{ nome: "Copo Térmico Stanley Quencher Azul-Marinho Edição Especial · 473ML", codigo: "B.0672.003.U.B", quantidade: 4, tamanho: "473ML" }]);
    const [linha] = volumeLabels(volume!, PEDIDO)[0]!.lines;
    expect(linha!.size).toBe("473ML");
    expect(nameAndSize(linha!)).toEqual({ name: "Copo Térmico Stanley Quencher Azul-Marinho Edição Especial", size: "473ML" });
  });

  it("o total só entra com o pedido concluído; sem peso, só a data; sem destino, só o cliente", () => {
    const [comTotal] = volumeLabels(VOLUME_12, { ...PEDIDO, total: 42 });
    expect([comTotal!.number, comTotal!.total]).toEqual([12, 42]);
    const [semPeso] = volumeLabels({ ...VOLUME_12, pesoKg: null }, { ...PEDIDO, destination: " " });
    expect([semPeso!.closing, semPeso!.recipient]).toEqual(["12/11/2026", "BTG Pactual"]);
    // O volume sem a data do fechamento sai com a da impressão.
    const [semData] = volumeLabels({ ...VOLUME_12, fechadoEm: null }, PEDIDO, { printedAt: new Date("2026-11-13T15:00:00.000Z") });
    expect(semData!.closing).toBe("13/11/2026 · 11,6 kg");
  });

  it("o volume com mais de cinco produtos sai em mais etiquetas, todas com as unidades do volume inteiro: no rolo, cinco e onze; na folha, cinco em cada", () => {
    const itens = Array.from({ length: 17 }, (_, indice) => ({ nome: `Produto ${String(indice + 1).padStart(2, "0")}`, codigo: `C.${indice + 1}`, quantidade: 17 - indice }));
    const volume = { ...VOLUME_12, numero: 20, unidades: 153, itens };
    const rolo = volumeLabels(volume, { ...PEDIDO, total: 42 }, { mode: "zebra" });
    expect(rolo.map((etiqueta) => [etiqueta.part, etiqueta.parts, etiqueta.lines.length, etiqueta.units, etiqueta.code])).toEqual([
      [1, 3, FIRST_LABEL_LINES, 153, "PED-0001-V20"],
      [2, 3, CONTINUATION_LABEL_LINES, 153, "PED-0001-V20"],
      [3, 3, 1, 153, "PED-0001-V20"],
    ]);
    expect(rolo[1]!.lines[0]!.name).toBe("Produto 06");
    const folha = volumeLabels(volume, { ...PEDIDO, total: 42 }, { mode: "a4" });
    expect(folha.map((etiqueta) => [etiqueta.part, etiqueta.parts, etiqueta.lines.length, etiqueta.units])).toEqual([
      [1, 4, 5, 153],
      [2, 4, 5, 153],
      [3, 4, 5, 153],
      [4, 4, 2, 153],
    ]);
  });

  it("o endereço leva o pedido e os volumes: um, alguns ou todos", () => {
    expect(labelsUrl({ order: "ord_1", volumes: [12] })).toBe("/estoque/etiquetas?pedido=ord_1&volumes=12");
    expect(labelsUrl({ order: "ord_1", volumes: "all", mode: "zebra" })).toBe("/estoque/etiquetas?pedido=ord_1&volumes=todos&modo=zebra");
    expect(parseLabelsQuery("?pedido=ord_1&volumes=12,3,abc,3,0")).toMatchObject({ order: "ord_1", volumes: [3, 12], boxes: [] });
    expect(parseLabelsQuery("?pedido=ord_1&volumes=TODOS")).toMatchObject({ order: "ord_1", volumes: "all" });
    expect(parseLabelsQuery("?pedido=%20&volumes=1")).toMatchObject({ order: null });
    // Sem o pedido, os volumes não vão ao endereço.
    expect(labelsUrl({ volumes: [1] })).toBe("/estoque/etiquetas");
    // As caixas que o pedido abriu vão com o pedido, sem volumes: a volta das etiquetas é a ele.
    const dasCaixas = labelsUrl({ boxes: ["CX-000027"], order: "ord_1" });
    expect(dasCaixas).toBe("/estoque/etiquetas?caixas=CX-000027&pedido=ord_1");
    expect(parseLabelsQuery(dasCaixas.split("?")[1]!)).toMatchObject({ boxes: ["CX-000027"], order: "ord_1", volumes: [] });
  });
});

/** A etiqueta da caixa do recebimento (recebimento com caixas, parte 6, decisões 30 a 32). */
describe("etiqueta da caixa do recebimento", () => {
  const receiptBox = warehouseBoxFromRecord({
    code: "CX-000225",
    customer_code: "BTG Pactual",
    status: "committing",
    location_id: "B-09",
    length_m: 0.4,
    width_m: 0.6,
    height_m: 0.35,
    gross_weight_kg: 10,
    unit_count: 0,
    draft_unit_count: 19,
    origin: { kind: "receipt", receipt_id: "inb_7c21a9f0", receipt_number: "AVL-7C21A9F0", invoice_number: "48.377" },
    lines: [
      { inbound_item_id: "i1", line_number: 1, sku_code: "BTG-000112", client_item_code: "A.01.0713.005.G", product_name: "Polo Masculino Piquet Preto", size: "G", counted_qty: 12 },
      { inbound_item_id: "i2", line_number: 2, sku_code: "BTG-000113", client_item_code: "A.01.0713.005.GG", product_name: "POLO MASCULINO PIQUET PRETO GG", size: "GG", counted_qty: 7 },
    ],
  });

  it("lê o conteúdo da própria caixa, com o nome e o tamanho, o código do cliente e o SKU, e a origem com a NF", () => {
    // As linhas da abertura não entram: a caixa do recebimento traz o conteúdo nela.
    const [label] = boxLabels(receiptBox, [line("A", 99, { box_code: "CX-000225" })], { printedAt: new Date("2026-11-06T18:00:00Z") });
    expect(label.lines).toEqual([
      { code: "A.01.0713.005.G", sku: "BTG-000112", name: "Polo Masculino Piquet Preto · G", qty: 12, size: "G" },
      { code: "A.01.0713.005.GG", sku: "BTG-000113", name: "POLO MASCULINO PIQUET PRETO · GG", qty: 7, size: "GG" },
    ]);
    expect(label.units).toBe(19);
    expect(label.position).toBe("B-09");
    expect(label.origin).toBe("Recebimento · NF 48.377");
    expect(label.date).toBe("06/11/2026");
    expect(label.dimensions).toBe("40 × 60 × 35 cm · 10 kg");
  });

  it("sem NF, a origem leva o número da chegada; a abertura e o cadastro manual seguem como hoje", () => {
    const semNf = warehouseBoxFromRecord({ ...receiptBox, origin: { kind: "receipt", receipt_number: "AVL-7C21A9F0" } });
    expect(boxLabels(semNf, [])[0].origin).toBe("Recebimento · AVL-7C21A9F0");
    expect(boxLabels(box, [])[0].origin).toBe("Abertura");
    expect(boxLabels(warehouseBoxFromRecord({ code: "CX-000300", status: "stored", location_id: "A-01" }), [])[0].origin).toBe("Manual");
  });

  it("a etiqueta sai da caixa guardada ou com o destino confirmado; a do recebimento sem destino diz o porquê (decisão 30)", () => {
    expect(boxLabelAvailability(receiptBox)).toEqual({ ready: true, reason: null });
    expect(boxLabelAvailability({ ...receiptBox, status: "stored" })).toEqual({ ready: true, reason: null });
    expect(boxLabelAvailability(box)).toEqual({ ready: true, reason: null });
    expect(boxLabelAvailability({ ...receiptBox, status: "reviewed", location_id: "" })).toEqual({
      ready: false,
      reason: "CX-000225 sem prateleira: sem etiqueta até confirmar o destino.",
    });
    expect(boxLabelAvailability({ ...receiptBox, status: "counting", location_id: "" })).toEqual({
      ready: false,
      reason: "CX-000225 em conferência: sem etiqueta até confirmar o destino.",
    });
    expect(boxLabelAvailability({ ...box, status: "committing", location_id: "" })).toEqual({ ready: false, reason: "CX-000012 aguarda a guarda." });
    // A caixa vazia saiu da prateleira (separação com caixas, parte 3c): não tem mais etiqueta.
    expect(boxLabelAvailability({ ...box, status: "emptied" })).toEqual({ ready: false, reason: "CX-000012 está vazia: saiu da prateleira." });
  });

  it("só a caixa do recebimento com destino registra a impressão, com a chegada, a caixa e a posição impressa (decisão 29)", () => {
    const semDestino = warehouseBoxFromRecord({ ...receiptBox, code: "CX-000227", status: "reviewed", location_id: "" });
    const abertura = warehouseBoxFromRecord({ code: "CX-000190", status: "stored", location_id: "B-09", origin: { kind: "opening_inventory", session_id: "s" } });
    expect(impressoesParaRegistrar([receiptBox, semDestino, abertura, box])).toEqual([
      { receipt_id: "inb_7c21a9f0", box_code: "CX-000225", location_id: "B-09" },
    ]);
  });
});

describe("etiqueta da caixa aberta (separação com caixas, parte 3)", () => {
  const entrada = [
    { box_code: "CX-000028", product_name: "Calça Social Masculino Preta", client_item_code: "A.01.0712.001.42", sku_code: "BTG-000084", counted_qty: 28 },
    { box_code: "CX-000028", product_name: "Calça Social Masculino Preta", client_item_code: "A.01.0712.001.44", sku_code: "BTG-000085", counted_qty: 40 },
    { box_code: "CX-000028", product_name: "Calça Social Masculino Preta", client_item_code: "A.01.0712.001.46", sku_code: "BTG-000086", counted_qty: 9 },
  ];
  const guardada = {
    code: "CX-000028",
    customer_code: "BTG Pactual",
    status: "stored",
    location_id: "A-05",
    length_m: 0.4,
    width_m: 0.6,
    height_m: 0.35,
    gross_weight_kg: 21.4,
    unit_count: 77,
    stored_at: "2026-10-22T14:10:00.000Z",
    origin: { kind: "opening_inventory", session_id: "sessao-1" },
  };

  it("a caixa de onde saiu peça mostra o saldo, e não o conteúdo de entrada", () => {
    // Antes da parte 3, a etiqueta desta caixa saía com as 77 un. de entrada.
    const aberta = warehouseBoxFromRecord({
      ...guardada,
      taken_lines: [
        { sku_code: "BTG-000084", qty: 26 },
        { sku_code: "BTG-000085", qty: 35 },
        { sku_code: "BTG-000086", qty: 9 },
      ],
      taken_units: 70,
      balance_at: "2026-11-12T17:40:00.000Z",
    });
    const [label] = boxLabels(aberta, entrada, { printedAt: new Date("2026-11-13T12:00:00Z") });
    // O produto que saiu todo some; os outros vêm com o que resta, o maior primeiro.
    expect(label.lines).toEqual([
      { code: "A.01.0712.001.44", sku: "BTG-000085", name: "Calça Social Masculino Preta · 44", qty: 5, size: "44" },
      { code: "A.01.0712.001.42", sku: "BTG-000084", name: "Calça Social Masculino Preta · 42", qty: 2, size: "42" },
    ]);
    expect(label.units).toBe(7);
    expect(label.balanceAt).toBe("12/11/2026");
    // A data é a de entrada, que é a do FIFO; o peso de entrada não vale mais.
    expect(label.date).toBe("22/10/2026");
    expect(label.dimensions).toBe("40 × 60 × 35 cm");
  });

  it("a caixa intacta segue com o conteúdo de entrada, o peso e a data de entrada, sem 'saldo em'", () => {
    const [label] = boxLabels(warehouseBoxFromRecord(guardada), entrada, { printedAt: new Date("2026-11-13T12:00:00Z") });
    expect(label.units).toBe(77);
    expect(label.balanceAt).toBeNull();
    expect(label.date).toBe("22/10/2026");
    expect(label.dimensions).toBe("40 × 60 × 35 cm · 21,4 kg");
  });

  it("a caixa do recebimento aberta desconta do conteúdo que ela mesma guarda", () => {
    const recebida = warehouseBoxFromRecord({
      ...guardada,
      code: "CX-000064",
      unit_count: 30,
      origin: { kind: "receipt", receipt_id: "inb_1", invoice_number: "48.377" },
      lines: [{ sku_code: "BTG-000118", client_item_code: "A.01.0816.005.G", product_name: "Camiseta Masculino Preta", size: "G", counted_qty: 30 }],
      taken_lines: [{ sku_code: "BTG-000118", qty: 12 }],
      taken_units: 12,
      balance_at: "2026-11-12T10:00:00.000Z",
    });
    const [label] = boxLabels(recebida, []);
    expect(label.lines).toEqual([{ code: "A.01.0816.005.G", sku: "BTG-000118", name: "Camiseta Masculino Preta · G", qty: 18, size: "G" }]);
    expect(label.units).toBe(18);
  });

  it("sem o conteúdo de entrada lido, a caixa aberta diz as unidades que restam", () => {
    const aberta = warehouseBoxFromRecord({ ...guardada, taken_lines: [{ sku_code: "BTG-000084", qty: 20 }], taken_units: 20, balance_at: "2026-11-12T17:40:00.000Z" });
    const [label] = boxLabels(aberta, []);
    expect(label.lines).toEqual([]);
    expect(label.units).toBe(57);
  });

  it("a impressão registra o saldo só das caixas abertas da folha, de qualquer origem", () => {
    const aberta = warehouseBoxFromRecord({ ...guardada, taken_lines: [{ sku_code: "BTG-000084", qty: 20 }], taken_units: 20, balance_at: "2026-11-12T17:40:00.000Z" });
    const recebidaAberta = warehouseBoxFromRecord({ ...guardada, code: "CX-000064", origin: { kind: "receipt", receipt_id: "inb_1" }, taken_units: 3, balance_at: "2026-11-12T10:00:00.000Z" });
    const intacta = warehouseBoxFromRecord({ ...guardada, code: "CX-000030" });
    const vazia = warehouseBoxFromRecord({ ...guardada, code: "CX-000027", status: "emptied", taken_units: 77 });
    expect(saldosParaRegistrar([aberta, recebidaAberta, intacta, vazia])).toEqual(["CX-000028", "CX-000064"]);
  });

  it("o saldo ignora a saída de um produto que a caixa não tem e não fica negativo", () => {
    const conteudo = boxContent(entrada, "CX-000028");
    expect(balanceContent(conteudo, [])).toBe(conteudo);
    expect(
      balanceContent(conteudo, [
        { sku_code: "BTG-000999", qty: 4 },
        { sku_code: "btg-000086", qty: 50 },
      ]).map((line) => [line.sku, line.qty]),
    ).toEqual([
      ["BTG-000085", 40],
      ["BTG-000084", 28],
    ]);
  });
});
