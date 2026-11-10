import { describe, expect, it } from "vitest";

import type { WarehouseTaskItem } from "./model";
import {
  avisoDosVolumes,
  conteudoDoVolume,
  nomeDoVolume,
  pesoDigitado,
  pesoDoVolume,
  resumoDosVolumes,
  textoDeVolumes,
  textoDoAberto,
  textoDoVolume,
  textoDosFechados,
  textoVerVolumes,
  volumeAberto,
  volumesAoConcluir,
  volumesDaLinha,
  volumesDaLinhaGravados,
  volumesDaRemessa,
  volumesDaSeparacao,
  volumesDaTarefa,
  volumesFechados,
} from "./volumes-do-pedido";

/**
 * Os volumes de expedição do pedido (separação com caixas, parte 4). Antes,
 * o pedido inteiro fechava num volume só, sem conteúdo. Dados sintéticos.
 */

function linha(numero: number, nome: string, codigo: string, sku: string, quantidade: number, volumes: Array<{ volume_id: string; qty: number }>): WarehouseTaskItem {
  return {
    id: `pli_ord_1_${String(numero).padStart(2, "0")}`,
    line_number: numero,
    product_name: nome,
    client_item_code: codigo,
    sku_code: sku,
    expected_quantity: quantidade,
    separated_at: "2026-11-12T13:00:00.000Z",
    separated_qty: quantidade,
    separated_volumes: volumes,
  };
}

const DA_TAREFA = [
  { id: "v2", number: 11, status: "closed", units: 25, box_code: "cx-000029", weight_kg: 6.3, closed_at: "2026-11-12T12:00:00.000Z" },
  { id: "v3", number: 12, status: "open", units: 42 },
  { id: "v1", number: 10, status: "closed", units: 50, weight_kg: 8.2, closed_at: "2026-11-11T12:00:00.000Z" },
  { id: "", number: 13 },
  { id: "v9", number: 0 },
  "lixo",
];

const LINHAS = [
  linha(1, "Polo Feminino Piquet Preto G", "A.01.0805.002.G", "BTG-000070", 50, [{ volume_id: "v1", qty: 50 }]),
  linha(2, "Calça Social Masculino Preta 46", "A.01.0712.001.46", "BTG-000086", 25, [{ volume_id: "v2", qty: 25 }]),
  linha(3, "Calça Social Masculino Preta 42", "A.01.0712.001.42", "BTG-000084", 12, [{ volume_id: "v3", qty: 12 }]),
  linha(4, "Calça Social Masculino Preta 40", "A.01.0712.001.40", "BTG-000083", 30, [{ volume_id: "v3", qty: 30 }]),
  // A linha por separar não está em volume nenhum.
  { id: "pli_ord_1_05", product_name: "Copo Café", client_item_code: "B.0791.005.U", sku_code: "BTG-000202", expected_quantity: 1 },
];

describe("os volumes da separação em andamento", () => {
  it("lê os volumes da tarefa em ordem de número e ignora o que não é volume", () => {
    expect(volumesDaTarefa(DA_TAREFA)).toEqual([
      { id: "v1", number: 10, status: "closed", units: 50, weight_kg: 8.2, closed_at: "2026-11-11T12:00:00.000Z" },
      { id: "v2", number: 11, status: "closed", units: 25, box_code: "CX-000029", weight_kg: 6.3, closed_at: "2026-11-12T12:00:00.000Z" },
      { id: "v3", number: 12, status: "open", units: 42 },
    ]);
    expect(volumesDaTarefa(undefined)).toEqual([]);
  });

  it("lê em quais volumes a linha foi", () => {
    expect(volumesDaLinhaGravados([{ volume_id: "v2", qty: 60 }, { volume_id: "", qty: 5 }, { volume_id: "v4", qty: 0 }, null])).toEqual([{ volume_id: "v2", qty: 60 }]);
    expect(volumesDaLinhaGravados([])).toBeUndefined();
    expect(volumesDaLinhaGravados("v1")).toBeUndefined();
  });

  it("cada volume leva o que as linhas puseram nele, na ordem das linhas do pedido: o nome com o tamanho, o código do cliente e a quantidade", () => {
    const volumes = volumesDaSeparacao(volumesDaTarefa(DA_TAREFA), LINHAS);
    expect(volumes).toEqual([
      { id: "v1", numero: 10, aberto: false, unidades: 50, caixa: null, pesoKg: 8.2, fechadoEm: "2026-11-11T12:00:00.000Z", itens: [{ nome: "Polo Feminino Piquet Preto · G", codigo: "A.01.0805.002.G", quantidade: 50 }] },
      {
        id: "v2",
        numero: 11,
        aberto: false,
        unidades: 25,
        caixa: "CX-000029",
        pesoKg: 6.3,
        fechadoEm: "2026-11-12T12:00:00.000Z",
        itens: [{ nome: "Calça Social Masculino Preta · 46", codigo: "A.01.0712.001.46", quantidade: 25 }],
      },
      {
        id: "v3",
        numero: 12,
        aberto: true,
        unidades: 42,
        caixa: null,
        pesoKg: null,
        fechadoEm: null,
        // A linha 3 (a 42) vem antes da 4 (a 40): é a ordem do pedido, não a da quantidade.
        itens: [
          { nome: "Calça Social Masculino Preta · 42", codigo: "A.01.0712.001.42", quantidade: 12 },
          { nome: "Calça Social Masculino Preta · 40", codigo: "A.01.0712.001.40", quantidade: 30 },
        ],
      },
    ]);
    // Duas linhas do mesmo produto no mesmo volume (duas prateleiras) somam numa só.
    const somadas = volumesDaSeparacao(
      [{ id: "v1", number: 1, status: "open", units: 9 }],
      [
        linha(2, "Boné Aba Curva", "C.1", "BTG-000301", 4, [{ volume_id: "v1", qty: 4 }]),
        linha(1, "Boné Aba Curva", "C.1", "BTG-000301", 5, [{ volume_id: "v1", qty: 5 }]),
      ],
    );
    expect(somadas[0]!.itens).toEqual([{ nome: "Boné Aba Curva", codigo: "C.1", quantidade: 9 }]);
  });

  it("sem as linhas lidas, valem as unidades que a tarefa diz; o item sem código do cliente sai com o SKU", () => {
    expect(volumesDaSeparacao(volumesDaTarefa(DA_TAREFA), []).map((volume) => [volume.numero, volume.unidades, volume.itens])).toEqual([
      [10, 50, []],
      [11, 25, []],
      [12, 42, []],
    ]);
    const semCodigo = volumesDaSeparacao(
      [{ id: "v1", number: 1, status: "open", units: 3 }],
      [{ id: "l1", product_name: "Boné", sku_code: "BTG-000300", expected_quantity: 3, separated_volumes: [{ volume_id: "v1", qty: 3 }] }],
    );
    expect(semCodigo[0]!.itens).toEqual([{ nome: "Boné", codigo: "BTG-000300", quantidade: 3 }]);
  });

  it("o volume aberto é o da tarefa; sem ele, o seguinte, vazio, que abre na próxima linha", () => {
    const volumes = volumesDaSeparacao(volumesDaTarefa(DA_TAREFA), LINHAS);
    expect(volumeAberto(volumes)).toMatchObject({ id: "v3", numero: 12, unidades: 42 });
    const fechados = volumes.filter((volume) => !volume.aberto);
    expect(volumeAberto(fechados)).toEqual({ id: "", numero: 12, aberto: true, unidades: 0, caixa: null, pesoKg: null, fechadoEm: null, itens: [] });
    expect(volumeAberto([])).toMatchObject({ id: "", numero: 1, unidades: 0 });
  });

  it("os fechados vêm do mais recente ao mais antigo, e a linha diz em quais volumes está", () => {
    const volumes = volumesDaSeparacao(volumesDaTarefa(DA_TAREFA), LINHAS);
    expect(volumesFechados(volumes).map((volume) => volume.numero)).toEqual([11, 10]);
    expect(volumesDaLinha(LINHAS[3]!, volumes)).toEqual(["Volume 12"]);
    // A linha que saiu numa caixa inteira e completou no volume aberto está nos dois.
    expect(volumesDaLinha({ separated_volumes: [{ volume_id: "v3", qty: 2 }, { volume_id: "v2", qty: 25 }, { volume_id: "v8", qty: 1 }] }, volumes)).toEqual(["Volume 11", "Volume 12"]);
    expect(volumesDaLinha(LINHAS[4]!, volumes)).toEqual([]);
  });

  it("ao concluir, contam os fechados e o aberto que tem alguma coisa", () => {
    const volumes = volumesDaSeparacao(volumesDaTarefa(DA_TAREFA), LINHAS);
    expect(volumesAoConcluir(volumes)).toBe(3);
    expect(volumesAoConcluir(volumes.filter((volume) => !volume.aberto))).toBe(2);
    expect(volumesAoConcluir([...volumes.filter((volume) => !volume.aberto), volumeAberto([])])).toBe(2);
  });
});

describe("os volumes do pedido concluído", () => {
  const PACOTES = [
    { id: "pkg_pack_ord_1_002", volume_number: 2, packed_units: 42, weight_kg: 11.6, status: "packed", closed_at: "2026-11-12T12:00:00.000Z" },
    { id: "pkg_pack_ord_1_001", volume_number: 1, packed_units: 60, box_code: "CX-000010", weight_kg: 14, status: "ready_to_dispatch", closed_at: "2026-11-10T12:00:00.000Z" },
    { id: "pkg_pack_ord_1_003", volume_number: 3, packed_units: 5, status: "cancelled" },
  ];
  const ITENS = [
    { package_id: "pkg_pack_ord_1_001", line_number: 1, sku_code: "BTG-000122", client_item_code: "A.01.0806.005.P", product_name: "Polo Masculino Piquet Preto", qty_packed: 60, status: "packed" },
    { package_id: "pkg_pack_ord_1_002", line_number: 4, sku_code: "BTG-000084", client_item_code: "A.01.0712.001.42", product_name: "Calça Social Masculino Preta 42", qty_packed: 12, status: "packed" },
    { package_id: "pkg_pack_ord_1_002", line_number: 3, sku_code: "BTG-000083", client_item_code: "A.01.0712.001.40", product_name: "Calça Social Masculino Preta 40", qty_packed: 30, status: "packed" },
    { package_id: "pkg_pack_ord_1_002", line_number: 5, sku_code: "BTG-000090", client_item_code: "X", product_name: "Cancelado", qty_packed: 9, status: "cancelled" },
  ];

  it("um volume por pacote, na ordem do número, com os itens de cada um na ordem das linhas; o cancelado não entra", () => {
    expect(volumesDaRemessa(PACOTES, ITENS)).toEqual([
      {
        id: "pkg_pack_ord_1_001",
        numero: 1,
        aberto: false,
        unidades: 60,
        caixa: "CX-000010",
        pesoKg: 14,
        fechadoEm: "2026-11-10T12:00:00.000Z",
        itens: [{ nome: "Polo Masculino Piquet Preto · P", codigo: "A.01.0806.005.P", quantidade: 60 }],
      },
      {
        id: "pkg_pack_ord_1_002",
        numero: 2,
        aberto: false,
        unidades: 42,
        caixa: null,
        pesoKg: 11.6,
        fechadoEm: "2026-11-12T12:00:00.000Z",
        itens: [
          { nome: "Calça Social Masculino Preta · 40", codigo: "A.01.0712.001.40", quantidade: 30 },
          { nome: "Calça Social Masculino Preta · 42", codigo: "A.01.0712.001.42", quantidade: 12 },
        ],
      },
    ]);
  });

  it("o volume único de antes vem com as unidades do pacote; o carimbo do Firestore vira ISO", () => {
    // Sem `closed_at`, vale a criação.
    const antigo = volumesDaRemessa([{ id: "pkg_pack_ord_2_001", volume_number: 1, packed_units: 9, status: "packed", created_at: { seconds: 1794571200 } }], []);
    expect(antigo).toEqual([{ id: "pkg_pack_ord_2_001", numero: 1, aberto: false, unidades: 9, caixa: null, pesoKg: null, fechadoEm: "2026-11-13T12:00:00.000Z", itens: [] }]);
  });
});

describe("os textos dos volumes", () => {
  it("o nome, o peso e a linha do volume", () => {
    expect([nomeDoVolume(12), nomeDoVolume(12, 42), nomeDoVolume(12, 0)]).toEqual(["Volume 12", "Volume 12 de 42", "Volume 12"]);
    expect([pesoDoVolume(6.3), pesoDoVolume(14), pesoDoVolume(2.35), pesoDoVolume(null), pesoDoVolume(0)]).toEqual(["6,3 kg", "14,0 kg", "2,35 kg", null, null]);
    expect(textoDoVolume({ caixa: "CX-000029", unidades: 25, pesoKg: 6.3 })).toBe("CX-000029 · 25 un. · 6,3 kg");
    expect(textoDoVolume({ caixa: null, unidades: 50, pesoKg: 8.2 })).toBe("50 un. · 8,2 kg");
    expect(textoDoVolume({ caixa: null, unidades: 1250, pesoKg: null })).toBe("1.250 un.");
    expect(textoDoAberto({ unidades: 2 })).toBe("aberto · 2 un.");
  });

  it("as contagens: os fechados, o total e Ver os N volumes", () => {
    expect([textoDosFechados(11), textoDosFechados(1), textoDosFechados(0)]).toEqual(["11 fechados", "1 fechado", null]);
    expect([textoDeVolumes(42), textoDeVolumes(1)]).toEqual(["42 volumes", "1 volume"]);
    expect(resumoDosVolumes([{ unidades: 3000 }, { unidades: 335 }])).toBe("2 volumes · 3.335 un.");
    expect([textoVerVolumes(11), textoVerVolumes(1)]).toEqual(["Ver os 11 volumes", "Ver o volume"]);
  });

  it("o conteúdo do volume numa linha", () => {
    expect(
      conteudoDoVolume({
        itens: [
          { nome: "Calça Social Masculino Preta · 40", codigo: "A.01.0712.001.40", quantidade: 30 },
          { nome: "Calça Social Masculino Preta · 42", codigo: "A.01.0712.001.42", quantidade: 12 },
        ],
      }),
    ).toBe("30 × Calça Social Masculino Preta · 40 · 12 × Calça Social Masculino Preta · 42");
  });

  it("o peso digitado: com vírgula ou ponto; vazio é sem peso; o resto não vale", () => {
    expect([pesoDigitado("11,6"), pesoDigitado(" 8.25 "), pesoDigitado("14")]).toEqual([11.6, 8.25, 14]);
    expect([pesoDigitado(""), pesoDigitado("   ")]).toEqual([undefined, undefined]);
    expect([pesoDigitado("abc"), pesoDigitado("0"), pesoDigitado("-3"), pesoDigitado("1,2,3"), pesoDigitado("2001"), pesoDigitado("1,2345")]).toEqual([null, null, null, null, null, null]);
  });

  it("o aviso do volume fechado que mudou de número ou de conteúdo", () => {
    expect(avisoDosVolumes({})).toBeNull();
    expect(avisoDosVolumes({ renumbered_volumes: [{ from: 12, to: 5 }] })).toBe("O volume 12 passou a ser o volume 5. Troque a etiqueta dele.");
    expect(avisoDosVolumes({ changed_volumes: [{ number: 3 }] })).toBe("O volume 3 mudou. Imprima a etiqueta dele de novo.");
    expect(avisoDosVolumes({ renumbered_volumes: [{ from: 4, to: 2 }], changed_volumes: [{ number: 1 }] })).toBe(
      "O volume 4 passou a ser o volume 2. Troque a etiqueta dele. O volume 1 mudou. Imprima a etiqueta dele de novo.",
    );
  });
});
