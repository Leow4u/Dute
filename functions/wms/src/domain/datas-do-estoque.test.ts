import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { datasDoEstoque } from "./datas-do-estoque.js";
import type { Entrada } from "./datas-do-saldo.js";

/**
 * As datas que as telas mostram (docs/plataforma/fifo-por-data.md, seções
 * 3.3 e 3.4): por dia para o cliente, por prateleira para a equipe. Os
 * números são os das telas aprovadas (docs/mockups/PortalEstoqueDatas.dc.html
 * e WmsItemDatas.dc.html).
 */

const entradas = (porLocal: Record<string, Entrada[]>) => new Map(Object.entries(porLocal));

describe("as datas do estoque de um SKU", () => {
  it("o caso das telas: por dia para o cliente e, para a equipe, a prateleira de data livre mais antiga primeiro", () => {
    const resultado = datasDoEstoque(
      [
        { location_id: "B-02", qty_on_hand: 90, qty_reserved: 0 },
        { location_id: "B-05", qty_on_hand: 16, qty_reserved: 10 },
      ],
      entradas({
        "B-05": [{ dia: "2026-10-22", quantidade: 30 }],
        "B-02": [
          { dia: "2026-10-30", quantidade: 30 },
          { dia: "2026-11-03", quantidade: 60 },
        ],
      }),
    );
    assert.deepEqual(resultado.datas, [
      { desde: "2026-10-22", pecas: 16 },
      { desde: "2026-10-30", pecas: 30 },
      { desde: "2026-11-03", pecas: 60 },
    ]);
    assert.deepEqual(resultado.locais, [
      { local: "B-05", pecas: 16, datas: [{ desde: "2026-10-22", pecas: 16 }] },
      {
        local: "B-02",
        pecas: 90,
        datas: [
          { desde: "2026-10-30", pecas: 30 },
          { desde: "2026-11-03", pecas: 60 },
        ],
      },
    ]);
  });

  it("o mesmo dia em duas prateleiras soma para o cliente", () => {
    const resultado = datasDoEstoque(
      [
        { location_id: "A-01", qty_on_hand: 10 },
        { location_id: "C-07", qty_on_hand: 5 },
      ],
      entradas({
        "A-01": [{ dia: "2026-10-30", quantidade: 10 }],
        "C-07": [{ dia: "2026-10-30", quantidade: 5 }],
      }),
    );
    assert.deepEqual(resultado.datas, [{ desde: "2026-10-30", pecas: 15 }]);
  });

  it("o RECEBIMENTO e a EXPEDICAO ficam fora das datas do cliente e vêm por último para a equipe, sem data", () => {
    const resultado = datasDoEstoque(
      [
        { location_id: "RECEBIMENTO", qty_on_hand: 40 },
        { location_id: "EXPEDICAO", qty_on_hand: 4, qty_reserved: 4 },
        { location_id: "A-01", qty_on_hand: 12 },
      ],
      entradas({
        RECEBIMENTO: [{ dia: "2026-11-03", quantidade: 40 }],
        EXPEDICAO: [{ dia: "2026-11-02", quantidade: 4 }],
        "A-01": [{ dia: "2026-10-22", quantidade: 12 }],
      }),
    );
    assert.deepEqual(resultado.datas, [{ desde: "2026-10-22", pecas: 12 }]);
    assert.deepEqual(resultado.locais, [
      { local: "A-01", pecas: 12, datas: [{ desde: "2026-10-22", pecas: 12 }] },
      { local: "EXPEDICAO", pecas: 4, datas: [] },
      { local: "RECEBIMENTO", pecas: 40, datas: [] },
    ]);
  });

  it("o que as entradas não cobrem fica sem data, que vem primeiro: é o mais antigo", () => {
    const resultado = datasDoEstoque(
      [{ location_id: "A-01", qty_on_hand: 25 }],
      entradas({ "A-01": [{ dia: "2026-10-30", quantidade: 15 }] }),
    );
    assert.deepEqual(resultado.datas, [
      { desde: null, pecas: 10 },
      { desde: "2026-10-30", pecas: 15 },
    ]);
    assert.deepEqual(resultado.locais, [
      {
        local: "A-01",
        pecas: 25,
        datas: [
          { desde: null, pecas: 10 },
          { desde: "2026-10-30", pecas: 15 },
        ],
      },
    ]);
  });

  it("a prateleira toda reservada vai depois das que têm livre, como no pedido", () => {
    const resultado = datasDoEstoque(
      [
        { location_id: "A-01", qty_on_hand: 5, qty_reserved: 5 },
        { location_id: "B-01", qty_on_hand: 8 },
      ],
      entradas({
        "A-01": [{ dia: "2026-10-22", quantidade: 5 }],
        "B-01": [{ dia: "2026-11-01", quantidade: 8 }],
      }),
    );
    assert.deepEqual(
      resultado.locais.map((local) => local.local),
      ["B-01", "A-01"],
    );
    assert.deepEqual(resultado.datas, [
      { desde: "2026-10-22", pecas: 5 },
      { desde: "2026-11-01", pecas: 8 },
    ]);
  });

  it("dois saldos no mesmo local somam, o saldo zerado não aparece e nada sem saldo vira lista vazia", () => {
    const resultado = datasDoEstoque(
      [
        { location_id: "A-01", qty_on_hand: 3 },
        { location_id: " A-01 ", qty_on_hand: 2 },
        { location_id: "B-09", qty_on_hand: 0 },
        { location_id: "", qty_on_hand: 7 },
      ],
      entradas({ "A-01": [{ dia: "2026-10-30", quantidade: 5 }] }),
    );
    assert.deepEqual(resultado.locais, [{ local: "A-01", pecas: 5, datas: [{ desde: "2026-10-30", pecas: 5 }] }]);
    assert.deepEqual(datasDoEstoque([], new Map()), { datas: [], locais: [] });
  });
});
