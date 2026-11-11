import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  caixaViraVolume,
  fecharVolume,
  nomeDoVolume,
  porNoVolumeAberto,
  problemaParaFechar,
  tirarDosVolumes,
  volumesDaLinha,
  volumesDaTarefa,
  volumesParaConcluir,
  type EstadoDosVolumes,
} from "./order-volumes.js";

/**
 * Volumes de expedição (separação com caixas, parte 4a): a regra sem banco.
 * Antes, o pedido inteiro fechava num volume só, na conclusão.
 */

const GUILHERME = { uid: "wms-1", name: "Guilherme Dantas" };
const RAFAEL = { uid: "wms-2", name: "Rafael" };
const AGORA = "2026-11-12T14:00:00.000Z";
const VAZIO: EstadoDosVolumes = { volumes: [], seq: 0 };

function resumo(estado: EstadoDosVolumes) {
  return estado.volumes.map((volume) => [volume.id, volume.number, volume.status, volume.units, volume.box_code ?? null]);
}

describe("o volume aberto", () => {
  it("a primeira linha separada abre o volume 1, e as seguintes entram nele", () => {
    const primeira = porNoVolumeAberto(VAZIO, 30);
    assert.deepEqual([primeira.volume_id, primeira.seq], ["v1", 1]);
    assert.deepEqual(resumo(primeira), [["v1", 1, "open", 30, null]]);
    const segunda = porNoVolumeAberto(primeira, 12);
    assert.equal(segunda.volume_id, "v1");
    assert.deepEqual(resumo(segunda), [["v1", 1, "open", 42, null]]);
  });

  it("Fechar volume guarda o peso, que é opcional, e a linha seguinte abre o próximo", () => {
    const aberto = porNoVolumeAberto(VAZIO, 42);
    const fechado = fecharVolume(aberto, "v1", { weight_kg: 11.6, at: AGORA, by: GUILHERME });
    assert.deepEqual(fechado.volumes, [{ id: "v1", number: 1, status: "closed", units: 42, weight_kg: 11.6, closed_at: AGORA, closed_by: GUILHERME }]);
    const semPeso = fecharVolume(aberto, "v1", { at: AGORA, by: GUILHERME });
    assert.equal(semPeso.volumes[0]!.weight_kg, undefined);
    const seguinte = porNoVolumeAberto(fechado, 50);
    assert.deepEqual(resumo(seguinte), [
      ["v1", 1, "closed", 42, null],
      ["v2", 2, "open", 50, null],
    ]);
  });

  it("o volume vazio, o já fechado e o que não existe não fecham", () => {
    const estado = fecharVolume(porNoVolumeAberto(VAZIO, 42), "v1", { at: AGORA, by: GUILHERME });
    assert.equal(problemaParaFechar(estado.volumes, "v1"), "O volume 1 já está fechado.");
    assert.equal(problemaParaFechar(estado.volumes, "v9"), "Volume não encontrado. Atualize e tente de novo.");
    assert.equal(problemaParaFechar([{ id: "v2", number: 2, status: "open", units: 0 }], "v2"), "O volume 2 está vazio: separe uma linha antes de fechar.");
    assert.equal(problemaParaFechar(porNoVolumeAberto(estado, 5).volumes, "v2"), null);
  });
});

describe("Levar a caixa", () => {
  it("a caixa que sai inteira vira um volume fechado, com o peso de entrada, sem mexer no aberto", () => {
    const aberto = porNoVolumeAberto(VAZIO, 30);
    const comCaixa = caixaViraVolume(aberto, { box_code: "CX-000029", qty: 25, weight_kg: 6.3, at: AGORA, by: GUILHERME });
    assert.equal(comCaixa.volume_id, "v2");
    assert.deepEqual(comCaixa.volumes, [
      { id: "v1", number: 1, status: "open", units: 30 },
      { id: "v2", number: 2, status: "closed", units: 25, box_code: "CX-000029", weight_kg: 6.3, closed_at: AGORA, closed_by: GUILHERME },
    ]);
    // A caixa sem peso registrado vira volume sem peso.
    assert.equal(caixaViraVolume(VAZIO, { box_code: "CX-000030", qty: 18, at: AGORA, by: GUILHERME }).volumes[0]!.weight_kg, undefined);
  });
});

describe("Desfazer", () => {
  /** v1 fechado (42), v2 a caixa CX-000029 (25), v3 fechado (50), v4 aberto (30). */
  function quatro(): EstadoDosVolumes {
    let estado: EstadoDosVolumes = porNoVolumeAberto(VAZIO, 42);
    estado = fecharVolume(estado, "v1", { weight_kg: 11.6, at: AGORA, by: GUILHERME });
    estado = caixaViraVolume(estado, { box_code: "CX-000029", qty: 25, weight_kg: 6.3, at: AGORA, by: GUILHERME });
    estado = porNoVolumeAberto(estado, 50);
    estado = fecharVolume(estado, "v3", { at: AGORA, by: GUILHERME });
    return porNoVolumeAberto(estado, 30);
  }

  it("a linha que sai deixa o volume com menos unidades; o fechado perde o peso e pede etiqueta nova, o aberto não", () => {
    const depois = tirarDosVolumes(quatro(), [{ volume_id: "v1", qty: 12 }]);
    assert.deepEqual(resumo(depois), [
      ["v1", 1, "closed", 30, null],
      ["v2", 2, "closed", 25, "CX-000029"],
      ["v3", 3, "closed", 50, null],
      ["v4", 4, "open", 30, null],
    ]);
    assert.deepEqual(depois.renumerados, []);
    // O peso era dos 42: sem 12 deles, não vale mais. A caixa que virou volume, intocada, continua com o dela.
    assert.deepEqual(depois.alterados, [{ id: "v1", number: 1 }]);
    assert.deepEqual([depois.volumes[0]!.weight_kg, depois.volumes[0]!.closed_at, depois.volumes[1]!.weight_kg], [undefined, AGORA, 6.3]);
    // O aberto ainda não tem etiqueta nem peso: nada a refazer.
    const doAberto = tirarDosVolumes(quatro(), [{ volume_id: "v4", qty: 10 }]);
    assert.deepEqual([doAberto.volumes[3]!.units, doAberto.alterados], [20, []]);
  });

  it("o volume aberto que esvazia sai, e a linha seguinte abre outro com o mesmo número", () => {
    const depois = tirarDosVolumes(quatro(), [{ volume_id: "v4", qty: 30 }]);
    assert.deepEqual(resumo(depois).map((volume) => volume[1]), [1, 2, 3]);
    const denovo = porNoVolumeAberto(depois, 8);
    assert.deepEqual(resumo(denovo).at(-1), ["v5", 4, "open", 8, null]);
  });

  it("a caixa que volta para a prateleira some dos volumes, e o volume aberto ocupa o número dela, sem trocar etiqueta", () => {
    const depois = tirarDosVolumes(quatro(), [{ volume_id: "v2", qty: 25 }]);
    assert.deepEqual(resumo(depois), [
      ["v1", 1, "closed", 42, null],
      ["v4", 2, "open", 30, null],
      ["v3", 3, "closed", 50, null],
    ]);
    // O aberto ainda não tem etiqueta: ninguém precisa trocar nada.
    assert.deepEqual(depois.renumerados, []);
  });

  it("quando o último volume é fechado, é ele que ocupa o lugar vago, e a etiqueta dele precisa ser trocada", () => {
    const todosFechados = fecharVolume(quatro(), "v4", { at: AGORA, by: GUILHERME });
    const depois = tirarDosVolumes(todosFechados, [{ volume_id: "v1", qty: 42 }]);
    assert.deepEqual(resumo(depois), [
      ["v4", 1, "closed", 30, null],
      ["v2", 2, "closed", 25, "CX-000029"],
      ["v3", 3, "closed", 50, null],
    ]);
    assert.deepEqual(depois.renumerados, [{ id: "v4", de: 4, para: 1 }]);
  });

  it("o último volume que esvazia só sai; e a linha em dois volumes sai dos dois", () => {
    const todosFechados = fecharVolume(quatro(), "v4", { at: AGORA, by: GUILHERME });
    const semOUltimo = tirarDosVolumes(todosFechados, [{ volume_id: "v4", qty: 30 }]);
    assert.deepEqual([resumo(semOUltimo).map((volume) => volume[1]), semOUltimo.renumerados], [[1, 2, 3], []]);
    // A linha de 120 polos que saiu em duas caixas inteiras: os dois volumes somem, e os números fecham de 1 a 2.
    const duas = tirarDosVolumes(todosFechados, [
      { volume_id: "v2", qty: 25 },
      { volume_id: "v3", qty: 50 },
    ]);
    assert.deepEqual(resumo(duas), [
      ["v1", 1, "closed", 42, null],
      ["v4", 2, "closed", 30, null],
    ]);
    assert.deepEqual(duas.renumerados, [{ id: "v4", de: 4, para: 2 }]);
  });

  it("o id do volume não volta: o volume novo nunca reusa o id de um que saiu", () => {
    const depois = tirarDosVolumes(quatro(), [{ volume_id: "v4", qty: 30 }]);
    assert.equal(depois.seq, 4);
    assert.equal(porNoVolumeAberto(depois, 1).volume_id, "v5");
  });
});

describe("a conclusão", () => {
  const DEPOIS = "2026-11-13T10:00:00.000Z";

  it("o volume aberto com unidades fecha junto, sem peso; cada volume leva os itens dele, e os números vão de 1 a N", () => {
    let estado: EstadoDosVolumes = porNoVolumeAberto(VAZIO, 42);
    estado = fecharVolume(estado, "v1", { weight_kg: 11.6, at: AGORA, by: GUILHERME });
    estado = porNoVolumeAberto(estado, 26);
    const volumes = volumesParaConcluir(
      estado,
      [
        { order_item_id: "oit_1", qty: 30, volumes: [{ volume_id: "v1", qty: 30 }] },
        // A linha que encheu o volume 1 e continuou no 2.
        { order_item_id: "oit_2", qty: 20, volumes: [{ volume_id: "v1", qty: 12 }, { volume_id: "v2", qty: 8 }] },
        { order_item_id: "oit_3", qty: 18, volumes: [{ volume_id: "v2", qty: 18 }] },
        // A linha separada a menos até zero não está em volume nenhum.
        { order_item_id: "oit_4", qty: 0, volumes: [] },
      ],
      { at: DEPOIS, by: RAFAEL },
    );
    assert.deepEqual(volumes, [
      {
        id: "v1",
        number: 1,
        status: "closed",
        units: 42,
        weight_kg: 11.6,
        closed_at: AGORA,
        closed_by: GUILHERME,
        items: [
          { order_item_id: "oit_1", qty: 30 },
          { order_item_id: "oit_2", qty: 12 },
        ],
      },
      {
        id: "v2",
        number: 2,
        status: "closed",
        units: 26,
        closed_at: DEPOIS,
        closed_by: RAFAEL,
        items: [
          { order_item_id: "oit_2", qty: 8 },
          { order_item_id: "oit_3", qty: 18 },
        ],
      },
    ]);
    assert.deepEqual([nomeDoVolume(2), nomeDoVolume(2, volumes.length)], ["Volume 2", "Volume 2 de 2"]);
  });

  it("a caixa que virou volume vai como está, com a caixa e o peso", () => {
    const estado = caixaViraVolume(VAZIO, { box_code: "CX-000029", qty: 25, weight_kg: 6.3, at: AGORA, by: GUILHERME });
    const [volume] = volumesParaConcluir(estado, [{ order_item_id: "oit_1", qty: 25, volumes: [{ volume_id: "v1", qty: 25 }] }], { at: DEPOIS, by: RAFAEL });
    assert.deepEqual(volume, {
      id: "v1",
      number: 1,
      status: "closed",
      units: 25,
      box_code: "CX-000029",
      weight_kg: 6.3,
      closed_at: AGORA,
      closed_by: GUILHERME,
      items: [{ order_item_id: "oit_1", qty: 25 }],
    });
  });

  it("o que a linha separou e não está em volume nenhum vai no aberto; sem aberto, num volume a mais", () => {
    let estado: EstadoDosVolumes = porNoVolumeAberto(VAZIO, 42);
    estado = fecharVolume(estado, "v1", { at: AGORA, by: GUILHERME });
    const linhas = [
      { order_item_id: "oit_1", qty: 42, volumes: [{ volume_id: "v1", qty: 42 }] },
      // A linha separada antes dos volumes, e a que aponta um volume que não existe mais.
      { order_item_id: "oit_2", qty: 5, volumes: [] },
      { order_item_id: "oit_3", qty: 3, volumes: [{ volume_id: "v9", qty: 3 }] },
    ];
    const aMais = volumesParaConcluir(estado, linhas, { at: DEPOIS, by: RAFAEL });
    assert.deepEqual(
      aMais.map((volume) => [volume.id, volume.number, volume.units, volume.closed_at, volume.items]),
      [
        ["v1", 1, 42, AGORA, [{ order_item_id: "oit_1", qty: 42 }]],
        [
          "v2",
          2,
          8,
          DEPOIS,
          [
            { order_item_id: "oit_2", qty: 5 },
            { order_item_id: "oit_3", qty: 3 },
          ],
        ],
      ],
    );
    const noAberto = volumesParaConcluir(porNoVolumeAberto(estado, 10), [...linhas, { order_item_id: "oit_4", qty: 10, volumes: [{ volume_id: "v2", qty: 10 }] }], {
      at: DEPOIS,
      by: RAFAEL,
    });
    assert.deepEqual(
      noAberto.map((volume) => [volume.id, volume.units]),
      [
        ["v1", 42],
        ["v2", 18],
      ],
    );
  });

  it("o volume que ficou sem item sai, e os números fecham; a linha nunca leva mais do que separou", () => {
    let estado: EstadoDosVolumes = porNoVolumeAberto(VAZIO, 42);
    estado = fecharVolume(estado, "v1", { at: AGORA, by: GUILHERME });
    estado = porNoVolumeAberto(estado, 10);
    estado = fecharVolume(estado, "v2", { at: AGORA, by: GUILHERME });
    estado = porNoVolumeAberto(estado, 7);
    const volumes = volumesParaConcluir(
      estado,
      [
        // Diz 50 no volume 1, mas separou 42: vale o separado.
        { order_item_id: "oit_1", qty: 42, volumes: [{ volume_id: "v1", qty: 50 }] },
        { order_item_id: "oit_3", qty: 7, volumes: [{ volume_id: "v3", qty: 7 }] },
      ],
      { at: DEPOIS, by: RAFAEL },
    );
    assert.deepEqual(
      volumes.map((volume) => [volume.id, volume.number, volume.units]),
      [
        ["v1", 1, 42],
        ["v3", 2, 7],
      ],
    );
  });

  it("sem volume nenhum (o pedido separado antes dos volumes), a conclusão não inventa um", () => {
    assert.deepEqual(volumesParaConcluir(VAZIO, [{ order_item_id: "oit_1", qty: 5, volumes: [] }], { at: AGORA, by: GUILHERME }), []);
  });
});

describe("a leitura do que a tarefa e a linha guardam", () => {
  it("lê os volumes em ordem de número e ignora o que não é volume", () => {
    const lidos = volumesDaTarefa([
      { id: "v2", number: 2, status: "open", units: 30 },
      { id: "v1", number: 1, status: "closed", units: 42, weight_kg: 11.6, closed_at: AGORA, box_code: "CX-000010" },
      { id: "", number: 3 },
      { id: "v9", number: 0 },
    ]);
    assert.deepEqual(lidos, [
      { id: "v1", number: 1, status: "closed", units: 42, box_code: "CX-000010", weight_kg: 11.6, closed_at: AGORA },
      { id: "v2", number: 2, status: "open", units: 30 },
    ]);
    assert.deepEqual(volumesDaTarefa(undefined), []);
  });

  it("lê em quais volumes a linha foi", () => {
    assert.deepEqual(volumesDaLinha([{ volume_id: "v2", qty: 60 }, { volume_id: "v3", qty: 60 }, { volume_id: "", qty: 5 }, { volume_id: "v4", qty: 0 }]), [
      { volume_id: "v2", qty: 60 },
      { volume_id: "v3", qty: 60 },
    ]);
    assert.deepEqual(volumesDaLinha(null), []);
  });
});
