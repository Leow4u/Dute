import { describe, expect, it } from "vitest";

import type { CaixaDaLinha } from "@workspace/dominio";

import {
  digitarParte,
  divisaoDaLinha,
  maisUmVolume,
  normalizarParte,
  numerosDaDivisao,
  partesDoComeco,
  partesFecham,
  passoDaParte,
  pedidoDaDivisao,
  pesarParte,
  pesoInvalido,
  podeConfirmarADivisao,
  podeMaisUmVolume,
  podeTirarVolume,
  semMais,
  semMenos,
  separadasParaDividir,
  subtituloDaDivisao,
  textoDaParte,
  textoDoBotaoDaDivisao,
  textoDosVolumesFechados,
  tirarVolume,
  unidadesNoVolumeAberto,
  type ParteDaDivisao,
} from "./divisao-em-volumes";
import type { LinhaDaLista } from "./lista-de-separacao";
import type { WarehouseTaskItem } from "./model";
import type { VolumeDaTarefa } from "./volumes-do-pedido";

/**
 * "Dividir em volumes" (separação com caixas, parte 7b; decisões 27 a 30;
 * docs/mockups/WmsDividirVolumes.dc.html, WmsDividirComItens.dc.html e
 * WmsDividirCelular.dc.html). Antes, a linha de 95 un. do PED-0001 só
 * entrava num volume, e a bancada não tinha como dividi-la. Os números são os
 * das pranchas: 95 = 54 da CX-000218 + 41 da CX-000219, a partir do volume 16.
 */

const SEPARADA_EM = "2026-11-11T14:02:00.000Z";

function linha(item: Partial<WarehouseTaskItem> = {}, nome = "Polo Masculino Piquet Preto · M"): LinhaDaLista {
  const completo: WarehouseTaskItem = {
    id: "pli_ord_1_64",
    location: "A-07",
    product_name: "Polo Masculino Piquet Preto M",
    client_item_code: "A.01.0806.005.M",
    sku_code: "BTG-000064",
    expected_quantity: 95,
    quantity: 95,
    ...item,
  };
  return { id: String(completo.id), nome, codigos: "A.01.0806.005.M · BTG-000064", quantidade: Number(completo.expected_quantity), caixas: [], item: completo };
}

const POLO = linha();
const SUGESTAO: CaixaDaLinha[] = [
  { box_code: "CX-000218", qty: 54, inteira: false, esvazia: false },
  { box_code: "CX-000219", qty: 41, inteira: false, esvazia: false },
];
/** Os 15 volumes fechados das pranchas, sem volume aberto: a bancada mostra o 16, vazio. */
const QUINZE: VolumeDaTarefa[] = Array.from({ length: 15 }, (_, indice) => ({ id: `v${indice + 1}`, number: indice + 1, status: "closed", units: 60 }));
/** O volume 16 aberto, já com 35 un. de outra linha (WmsDividirComItens). */
const COM_ITENS: VolumeDaTarefa[] = [...QUINZE, { id: "v16", number: 16, status: "open", units: 35 }];

function partes(...quantidades: number[]): ParteDaDivisao[] {
  return quantidades.map((quantidade) => ({ quantidade, texto: null, peso: "" }));
}

function quantidades(lista: readonly ParteDaDivisao[]) {
  return lista.map((parte) => parte.quantidade);
}

describe("os números dos volumes da divisão", () => {
  it("com o volume aberto, a primeira parte entra nele e as outras vêm depois do maior número da tarefa", () => {
    const divisao = divisaoDaLinha({ linha: POLO, modo: "separar", volumes: COM_ITENS, caixas: SUGESTAO })!;
    expect(numerosDaDivisao(divisao)).toEqual([16, 17]);
    expect(numerosDaDivisao({ ...divisao, partes: partes(20, 54, 21) })).toEqual([16, 17, 18]);
    // O aberto que ocupou o lugar de um que saiu (decisão 18) não é o maior: as outras partes vêm depois do maior.
    const renumerado: VolumeDaTarefa[] = [
      { id: "v1", number: 1, status: "closed", units: 10 },
      { id: "v9", number: 2, status: "open", units: 4 },
      { id: "v3", number: 3, status: "closed", units: 12 },
    ];
    expect(numerosDaDivisao({ ...divisaoDaLinha({ linha: POLO, modo: "separar", volumes: renumerado })!, partes: partes(40, 30, 25) })).toEqual([2, 4, 5]);
  });

  it("sem volume aberto, todas as partes vêm depois do maior; sem volume nenhum, do 1", () => {
    expect(numerosDaDivisao(divisaoDaLinha({ linha: POLO, modo: "separar", volumes: QUINZE, caixas: SUGESTAO })!)).toEqual([16, 17]);
    expect(numerosDaDivisao(divisaoDaLinha({ linha: POLO, modo: "separar", volumes: [] })!)).toEqual([1, 2]);
  });
});

describe("as linhas do começo (decisão 27)", () => {
  it("um volume por caixa de onde a linha sai, na ordem da sugestão: 54 e 41", () => {
    const divisao = divisaoDaLinha({ linha: POLO, modo: "separar", volumes: QUINZE, caixas: SUGESTAO })!;
    expect(divisao).toEqual({
      id: "pli_ord_1_64",
      modo: "separar",
      nome: "Polo Masculino Piquet Preto · M",
      posicao: "A-07",
      total: 95,
      caixas: SUGESTAO,
      separadaEm: null,
      aberto: { id: null, numero: 16, unidades: 0, outros: 0 },
      maior: 15,
      partes: partes(54, 41),
    });
  });

  it("o volume aberto já com itens não muda o começo: 54 e 41, a partir do 16, com o que ele tem", () => {
    const divisao = divisaoDaLinha({ linha: POLO, modo: "separar", volumes: COM_ITENS, caixas: SUGESTAO })!;
    expect(quantidades(divisao.partes)).toEqual([54, 41]);
    expect(divisao.aberto).toEqual({ id: "v16", numero: 16, unidades: 35, outros: 35 });
  });

  it("o que sai sem caixa é a última fonte; com uma fonte só, a linha começa ao meio", () => {
    const umaCaixa = [SUGESTAO[0]!];
    expect(quantidades(divisaoDaLinha({ linha: POLO, modo: "separar", volumes: QUINZE, caixas: umaCaixa })!.partes)).toEqual([54, 41]);
    // Uma caixa com tudo, ou sem a leitura das caixas: ao meio, o maior primeiro.
    expect(quantidades(divisaoDaLinha({ linha: POLO, modo: "separar", volumes: QUINZE, caixas: [{ box_code: "CX-000220", qty: 95, inteira: true, esvazia: false }] })!.partes)).toEqual([48, 47]);
    expect(quantidades(divisaoDaLinha({ linha: POLO, modo: "separar", volumes: QUINZE })!.partes)).toEqual([48, 47]);
    expect(quantidades(partesDoComeco(2, [2]))).toEqual([1, 1]);
  });

  it("três caixas, três volumes; passando de 20, as que sobram vão juntas no último", () => {
    expect(quantidades(partesDoComeco(35, [20, 10, 5]))).toEqual([20, 10, 5]);
    const muitas = partesDoComeco(25, Array.from({ length: 25 }, () => 1));
    expect(muitas).toHaveLength(20);
    expect(quantidades(muitas)).toEqual([...Array.from({ length: 19 }, () => 1), 6]);
    // A sugestão que não fecha com a linha cai no meio.
    expect(quantidades(partesDoComeco(95, [54, 40]))).toEqual([48, 47]);
  });

  it("na linha já separada (decisão 30): as caixas gravadas, quando somam o que está no volume aberto", () => {
    const separada = linha({ separated_at: SEPARADA_EM, separated_qty: 95, separated_volumes: [{ volume_id: "v16", qty: 95 }] });
    const volumes: VolumeDaTarefa[] = [...QUINZE, { id: "v16", number: 16, status: "open", units: 95 }];
    const divisao = divisaoDaLinha({ linha: separada, modo: "dividir", volumes, caixas: SUGESTAO })!;
    expect(divisao).toMatchObject({ modo: "dividir", total: 95, separadaEm: SEPARADA_EM, aberto: { id: "v16", numero: 16, unidades: 95, outros: 0 } });
    expect(quantidades(divisao.partes)).toEqual([54, 41]);
    expect(numerosDaDivisao(divisao)).toEqual([16, 17]);
    // As caixas gravadas são o que se divide: ficam no cabeçalho.
    expect(divisao.caixas).toEqual(SUGESTAO);
  });

  it("na já separada, as caixas gravadas que não somam o que se divide saem do cabeçalho: são da linha toda", () => {
    // Depois de "Separar em 2 volumes": 54 no 16, fechado, e 41 no 17, aberto; as caixas gravadas somam 95.
    const dividida = linha({
      separated_at: SEPARADA_EM,
      separated_qty: 95,
      separated_volumes: [
        { volume_id: "v16", qty: 54 },
        { volume_id: "v17", qty: 41 },
      ],
    });
    const volumes: VolumeDaTarefa[] = [...QUINZE, { id: "v16", number: 16, status: "closed", units: 54 }, { id: "v17", number: 17, status: "open", units: 41 }];
    const divisao = divisaoDaLinha({ linha: dividida, modo: "dividir", volumes, caixas: SUGESTAO })!;
    expect(divisao).toMatchObject({ total: 41, aberto: { id: "v17", numero: 17, unidades: 41, outros: 0 } });
    expect(divisao.caixas).toEqual([]);
    expect(quantidades(divisao.partes)).toEqual([21, 20]);
    expect(subtituloDaDivisao(divisao)).toBe("Polo Masculino Piquet Preto · M · A-07 · 41 un.");
    // Na linha por separar, a sugestão fica, mesmo sem cobrir a linha toda.
    expect(divisaoDaLinha({ linha: POLO, modo: "separar", volumes: QUINZE, caixas: [SUGESTAO[0]!] })!.caixas).toEqual([SUGESTAO[0]]);
  });

  it("na já separada, o que as outras linhas têm no volume aberto não se divide, e as caixas que não somam dão o meio", () => {
    // O volume 16 tem 35 un. de outra linha e as 95 do polo.
    const separada = linha({ separated_at: SEPARADA_EM, separated_qty: 95, separated_volumes: [{ volume_id: "v16", qty: 95 }] });
    const volumes: VolumeDaTarefa[] = [...QUINZE, { id: "v16", number: 16, status: "open", units: 130 }];
    expect(divisaoDaLinha({ linha: separada, modo: "dividir", volumes, caixas: SUGESTAO })!.aberto).toEqual({ id: "v16", numero: 16, unidades: 130, outros: 35 });
    // O resto de "Levar a caixa": 30 foram no volume da caixa, e só 10 estão no aberto.
    const resto = linha({
      separated_at: SEPARADA_EM,
      separated_qty: 40,
      expected_quantity: 40,
      separated_volumes: [
        { volume_id: "v11", qty: 30 },
        { volume_id: "v12", qty: 10 },
      ],
    });
    const comCaixa: VolumeDaTarefa[] = [
      { id: "v11", number: 11, status: "closed", units: 30, box_code: "CX-000063" },
      { id: "v12", number: 12, status: "open", units: 25 },
    ];
    const gravadas: CaixaDaLinha[] = [
      { box_code: "CX-000063", qty: 30, inteira: true, esvazia: false },
      { box_code: "CX-000064", qty: 10, inteira: false, esvazia: false },
    ];
    const divisao = divisaoDaLinha({ linha: resto, modo: "dividir", volumes: comCaixa, caixas: gravadas })!;
    expect(divisao).toMatchObject({ total: 10, aberto: { id: "v12", numero: 12, unidades: 25, outros: 15 } });
    expect(divisao.caixas).toEqual([]);
    expect(quantidades(divisao.partes)).toEqual([5, 5]);
    expect(numerosDaDivisao(divisao)).toEqual([12, 13]);
  });

  it("sem o que dividir, nada: menos de 2 un., a linha fora do volume aberto, ou a linha que mudou de estado", () => {
    expect(divisaoDaLinha({ linha: linha({ expected_quantity: 1, quantity: 1 }), modo: "separar", volumes: QUINZE })).toBeNull();
    const separada = linha({ separated_at: SEPARADA_EM, separated_qty: 95, separated_volumes: [{ volume_id: "v15", qty: 95 }] });
    // As 95 estão num volume fechado.
    expect(divisaoDaLinha({ linha: separada, modo: "dividir", volumes: QUINZE })).toBeNull();
    // Só 1 un. no aberto.
    const umaNoAberto = linha({ separated_at: SEPARADA_EM, separated_qty: 95, separated_volumes: [{ volume_id: "v15", qty: 94 }, { volume_id: "v16", qty: 1 }] });
    expect(divisaoDaLinha({ linha: umaNoAberto, modo: "dividir", volumes: COM_ITENS })).toBeNull();
    // Outra pessoa separou a linha que o diálogo abriu por separar, ou desfez a que abriu separada.
    expect(divisaoDaLinha({ linha: separada, modo: "separar", volumes: QUINZE })).toBeNull();
    expect(divisaoDaLinha({ linha: POLO, modo: "dividir", volumes: COM_ITENS })).toBeNull();
  });

  it("as linhas do diálogo ficam, e o volume aberto e os números são os de agora; as que não fecham mais, nada", () => {
    const antes = divisaoDaLinha({ linha: POLO, modo: "separar", volumes: QUINZE, caixas: SUGESTAO, partes: partes(20, 54, 21) })!;
    expect(numerosDaDivisao(antes)).toEqual([16, 17, 18]);
    // Outra pessoa separou no volume 16 enquanto o diálogo estava aberto: "Os volumes mudaram".
    const depois = divisaoDaLinha({ linha: POLO, modo: "separar", volumes: COM_ITENS, caixas: SUGESTAO, partes: antes.partes })!;
    expect(quantidades(depois.partes)).toEqual([20, 54, 21]);
    expect(depois.aberto).toEqual({ id: "v16", numero: 16, unidades: 35, outros: 35 });
    expect(numerosDaDivisao(depois)).toEqual([16, 17, 18]);
    expect(divisaoDaLinha({ linha: POLO, modo: "separar", volumes: QUINZE, partes: partes(20, 54) })).toBeNull();
    expect(divisaoDaLinha({ linha: POLO, modo: "separar", volumes: QUINZE, partes: partes(95) })).toBeNull();
  });

  it("as linhas fecham: de 2 a 20, cada uma com 1 un. ou mais, e a soma igual ao que se divide", () => {
    expect(partesFecham(partes(54, 41), 95)).toBe(true);
    expect(partesFecham(partes(54, 40), 95)).toBe(false);
    expect(partesFecham(partes(95, 0), 95)).toBe(false);
    expect(partesFecham(partes(95), 95)).toBe(false);
    expect(partesFecham(partes(...Array.from({ length: 21 }, () => 1)), 21)).toBe(false);
  });
});

describe("a linha já separada que ganha Dividir em volumes (decisão 30)", () => {
  const volumes: VolumeDaTarefa[] = [
    { id: "v1", number: 1, status: "closed", units: 50 },
    { id: "v2", number: 2, status: "open", units: 31 },
  ];
  const linhas = [
    linha({ id: "a", separated_at: SEPARADA_EM, separated_qty: 30, separated_volumes: [{ volume_id: "v2", qty: 30 }] }),
    linha({ id: "b", separated_at: SEPARADA_EM, separated_qty: 1, separated_volumes: [{ volume_id: "v2", qty: 1 }] }),
    linha({ id: "c", separated_at: SEPARADA_EM, separated_qty: 50, separated_volumes: [{ volume_id: "v1", qty: 50 }] }),
    linha({ id: "d" }),
  ];

  it("só a separada com 2 un. ou mais no volume aberto; a do fechado e a por separar, não", () => {
    expect(linhas.map((candidata) => unidadesNoVolumeAberto(candidata.item, volumes))).toEqual([30, 1, 0, 0]);
    expect([...separadasParaDividir(linhas, volumes)]).toEqual(["a"]);
    expect([...separadasParaDividir(linhas, volumes.slice(0, 1))]).toEqual([]);
  });
});

describe("mexer nas linhas: a soma sempre fecha (decisão 28)", () => {
  it("mexeu numa linha, a última acompanha, entre 1 e o que as duas têm menos 1", () => {
    expect(quantidades(passoDaParte(partes(54, 41), 0, 1))).toEqual([55, 40]);
    expect(quantidades(passoDaParte(partes(54, 41), 0, -1))).toEqual([53, 42]);
    expect(quantidades(digitarParte(partes(54, 41), 0, "200"))).toEqual([94, 1]);
    expect(quantidades(passoDaParte(partes(1, 94), 0, -1))).toEqual([1, 94]);
    // Na do meio, também é a última que acompanha.
    expect(quantidades(digitarParte(partes(20, 54, 21), 1, "70"))).toEqual([20, 70, 5]);
    expect(quantidades(digitarParte(partes(20, 54, 21), 0, "30"))).toEqual([30, 54, 11]);
  });

  it("mexeu na última, a de cima acompanha", () => {
    expect(quantidades(passoDaParte(partes(54, 41), 1, 1))).toEqual([53, 42]);
    expect(quantidades(passoDaParte(partes(54, 41), 1, -1))).toEqual([55, 40]);
    expect(quantidades(digitarParte(partes(54, 41), 1, "100"))).toEqual([1, 94]);
    expect(quantidades(digitarParte(partes(20, 54, 21), 2, "30"))).toEqual([20, 45, 30]);
  });

  it("digitando, o campo guarda os dígitos; a quantidade só muda com 1 ou mais; ao sair, o campo volta à quantidade", () => {
    const digitando = digitarParte(partes(54, 41), 0, "6");
    expect(digitando).toEqual([
      { quantidade: 6, texto: "6", peso: "" },
      { quantidade: 89, texto: null, peso: "" },
    ]);
    expect(digitarParte(digitando, 0, "")).toEqual([
      { quantidade: 6, texto: "", peso: "" },
      { quantidade: 89, texto: null, peso: "" },
    ]);
    expect(quantidades(digitarParte(digitando, 0, "0"))).toEqual([6, 89]);
    expect(digitarParte(digitando, 0, "6a0")[0]).toEqual({ quantidade: 60, texto: "60", peso: "" });
    expect(normalizarParte(digitarParte(digitando, 0, ""), 0)[0]).toEqual({ quantidade: 6, texto: null, peso: "" });
    // O campo que acompanha deixa de mostrar o que estava sendo digitado nele.
    expect(digitarParte(digitarParte(partes(54, 41), 1, "4"), 0, "50")[1]).toEqual({ quantidade: 45, texto: null, peso: "" });
  });

  it("− desliga em 1; + desliga quando a linha que acompanha está em 1", () => {
    expect([semMenos(partes(54, 41), 0), semMais(partes(54, 41), 0), semMenos(partes(54, 41), 1), semMais(partes(54, 41), 1)]).toEqual([false, false, false, false]);
    expect([semMenos(partes(94, 1), 0), semMais(partes(94, 1), 0), semMenos(partes(94, 1), 1), semMais(partes(94, 1), 1)]).toEqual([false, true, true, false]);
    expect([semMenos(partes(1, 94), 0), semMais(partes(1, 94), 0), semMenos(partes(1, 94), 1), semMais(partes(1, 94), 1)]).toEqual([true, false, false, true]);
  });

  it("Mais um volume entra antes do último, com a quantidade do de cima, ou a metade do último", () => {
    // O de cima (54) não cabe nas 41: entra a metade, 20, e o último fica com 21.
    const tres = maisUmVolume(partes(54, 41));
    expect(quantidades(tres)).toEqual([54, 20, 21]);
    // Agora o de cima (20) cabe nas 21.
    expect(quantidades(maisUmVolume(tres))).toEqual([54, 20, 20, 1]);
    expect(quantidades(maisUmVolume(partes(20, 54, 21)))).toEqual([20, 54, 10, 11]);
    expect(maisUmVolume(partes(54, 41))[1]).toEqual({ quantidade: 20, texto: null, peso: "" });
  });

  it("Mais um volume desliga com o último abaixo de 2 un. ou com 20 volumes", () => {
    expect(podeMaisUmVolume(partes(54, 41))).toBe(true);
    expect(podeMaisUmVolume(partes(94, 1))).toBe(false);
    const vinte = partes(...Array.from({ length: 19 }, () => 1), 76);
    expect(podeMaisUmVolume(vinte)).toBe(false);
    expect(maisUmVolume(vinte)).toHaveLength(20);
    expect(maisUmVolume(partes(94, 1))).toEqual(partes(94, 1));
  });

  it("a lixeira só nos volumes entre o primeiro e o último, e o que o tirado tinha vai para o último", () => {
    expect([0, 1, 2].map((indice) => podeTirarVolume(partes(20, 54, 21), indice))).toEqual([false, true, false]);
    expect(quantidades(tirarVolume(partes(20, 54, 21), 1))).toEqual([20, 75]);
    expect(quantidades(tirarVolume(partes(20, 54, 21), 0))).toEqual([20, 54, 21]);
    expect(quantidades(tirarVolume(partes(20, 54, 21), 2))).toEqual([20, 54, 21]);
  });

  it("o peso é só dos volumes que fecham, opcional; o inválido desliga a confirmação", () => {
    const comPeso = pesarParte(partes(54, 41), 0, "10,8");
    expect(comPeso[0]!.peso).toBe("10,8");
    // O último fica aberto: não tem peso.
    expect(pesarParte(partes(54, 41), 1, "3")[1]!.peso).toBe("");
    expect([pesoInvalido({ peso: "" }), pesoInvalido({ peso: "10,8" }), pesoInvalido({ peso: "abc" }), pesoInvalido({ peso: "0" })]).toEqual([false, false, true, true]);
    expect(podeConfirmarADivisao({ total: 95, partes: comPeso })).toBe(true);
    expect(podeConfirmarADivisao({ total: 95, partes: pesarParte(partes(54, 41), 0, "abc") })).toBe(false);
    expect(podeConfirmarADivisao({ total: 95, partes: partes(54, 40) })).toBe(false);
  });
});

describe("os textos da divisão", () => {
  const semItens = divisaoDaLinha({ linha: POLO, modo: "separar", volumes: QUINZE, caixas: SUGESTAO })!;
  const comItens = divisaoDaLinha({ linha: POLO, modo: "separar", volumes: COM_ITENS, caixas: SUGESTAO, partes: partes(20, 54, 21) })!;

  it("o volume que fecha diz fecha; o primeiro, com o aberto já com itens, tem 35 un. · fecha com 55 un.; o último, nada", () => {
    expect([0, 1].map((indice) => textoDaParte(semItens, indice))).toEqual(["fecha", null]);
    expect([0, 1, 2].map((indice) => textoDaParte(comItens, indice))).toEqual(["tem 35 un. · fecha com 55 un.", "fecha", null]);
    expect(textoDaParte({ ...comItens, aberto: { ...comItens.aberto, outros: 1200 } }, 0)).toBe("tem 1.200 un. · fecha com 1.220 un.");
  });

  it("a linha, a prateleira e o que se divide; sem prateleira, sem o separador sobrando", () => {
    expect(subtituloDaDivisao(semItens)).toBe("Polo Masculino Piquet Preto · M · A-07 · 95 un.");
    expect(subtituloDaDivisao({ ...semItens, posicao: "" })).toBe("Polo Masculino Piquet Preto · M · 95 un.");
  });

  it("o botão diz em quantos volumes: Separar na linha por separar, Dividir na já separada", () => {
    expect([textoDoBotaoDaDivisao("separar", 2), textoDoBotaoDaDivisao("separar", 3, true)]).toEqual(["Separar em 2 volumes", "Separando…"]);
    expect([textoDoBotaoDaDivisao("dividir", 3), textoDoBotaoDaDivisao("dividir", 2, true)]).toEqual(["Dividir em 3 volumes", "Dividindo…"]);
  });

  it("o aviso depois de confirmar, dos volumes que fecharam", () => {
    expect(textoDosVolumesFechados([{ number: 16 }])).toBe("Volume 16 fechado");
    expect(textoDosVolumesFechados([{ number: 17 }, { number: 16 }])).toBe("Volumes 16 e 17 fechados");
    expect(textoDosVolumesFechados([{ number: 16 }, { number: 17 }, { number: 18 }])).toBe("Volumes 16, 17 e 18 fechados");
    expect(textoDosVolumesFechados([])).toBeNull();
  });
});

describe("o pedido da divisão (parte 7a)", () => {
  it("a linha por separar, sem volume aberto: os números do diálogo, o peso só no que fecha, e a linha como null", () => {
    const divisao = divisaoDaLinha({ linha: POLO, modo: "separar", volumes: QUINZE, caixas: SUGESTAO })!;
    const pedido = pedidoDaDivisao({ ...divisao, partes: pesarParte(divisao.partes, 0, "10,8") });
    expect(pedido).toEqual({
      split_volumes: [
        { number: 16, qty: 54, weight_kg: 10.8 },
        { number: 17, qty: 41 },
      ],
      open_volume_id: null,
      open_volume_units: 0,
      line_separated_at: null,
    });
    // O peso vazio não vai: o campo sem valor chegaria ao servidor como null.
    expect(Object.keys(pedidoDaDivisao(divisao).split_volumes[0]!)).toEqual(["number", "qty"]);
  });

  it("o volume aberto já com itens: o id e as unidades gravadas nele", () => {
    const divisao = divisaoDaLinha({ linha: POLO, modo: "separar", volumes: COM_ITENS, caixas: SUGESTAO, partes: partes(20, 54, 21) })!;
    expect(pedidoDaDivisao(divisao)).toEqual({
      split_volumes: [
        { number: 16, qty: 20 },
        { number: 17, qty: 54 },
        { number: 18, qty: 21 },
      ],
      open_volume_id: "v16",
      open_volume_units: 35,
      line_separated_at: null,
    });
  });

  it("a linha já separada: as unidades gravadas no aberto incluem as dela, e vai o separated_at como a página leu", () => {
    const separada = linha({ separated_at: SEPARADA_EM, separated_qty: 95, separated_volumes: [{ volume_id: "v16", qty: 95 }] });
    const volumes: VolumeDaTarefa[] = [...QUINZE, { id: "v16", number: 16, status: "open", units: 130 }];
    const divisao = divisaoDaLinha({ linha: separada, modo: "dividir", volumes, caixas: SUGESTAO })!;
    expect(pedidoDaDivisao({ ...divisao, partes: pesarParte(divisao.partes, 0, "abc") })).toEqual({
      split_volumes: [
        { number: 16, qty: 54 },
        { number: 17, qty: 41 },
      ],
      open_volume_id: "v16",
      open_volume_units: 130,
      line_separated_at: SEPARADA_EM,
    });
  });
});
