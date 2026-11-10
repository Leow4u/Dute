import { describe, expect, it } from "vitest";

import { folhaDoRomaneio, hrefDoRomaneio, periodoDaSeparacao } from "./romaneio";
import type { VolumeDoPedido } from "./volumes-do-pedido";

/**
 * O romaneio do pedido (separação com caixas, parte 4c;
 * docs/mockups/WmsSepararRomaneio.dc.html). Antes, o pedido saía sem o
 * conteúdo de cada volume. Dados sintéticos.
 */

function volume(numero: number, unidades: number, extra: Partial<VolumeDoPedido> = {}): VolumeDoPedido {
  return { id: `pkg_${numero}`, numero, aberto: false, unidades, caixa: null, pesoKg: null, fechadoEm: null, itens: [], ...extra };
}

describe("o romaneio do pedido", () => {
  it("o período da separação: de quando a quando, no horário de São Paulo", () => {
    expect(periodoDaSeparacao("2026-11-10T13:00:00.000Z", "2026-11-13T20:00:00.000Z")).toBe("10/11 a 13/11/2026");
    // No mesmo dia, só a data; a madrugada em UTC ainda é o dia anterior em São Paulo.
    expect(periodoDaSeparacao("2026-11-13T12:00:00.000Z", "2026-11-14T01:30:00.000Z")).toBe("13/11/2026");
    // De um ano para o outro, os dois anos.
    expect(periodoDaSeparacao("2026-12-30T13:00:00.000Z", "2027-01-04T13:00:00.000Z")).toBe("30/12/2026 a 04/01/2027");
    // Sem uma das datas, a que existir; sem nenhuma, nada.
    expect(periodoDaSeparacao(null, "2026-11-13T20:00:00.000Z")).toBe("13/11/2026");
    expect(periodoDaSeparacao("2026-11-10T13:00:00.000Z", undefined)).toBe("10/11/2026");
    expect([periodoDaSeparacao(null, null), periodoDaSeparacao("lixo", "")]).toEqual(["", ""]);
  });

  it("a folha: o pedido, o lacre, os volumes em ordem e as unidades somadas", () => {
    const folha = folhaDoRomaneio({
      numero: " PED-0001 ",
      cliente: "BTG Pactual",
      destino: "Agência Faria Lima",
      paraQuando: "2026-11-16T14:36:00.000Z",
      lacre: "88231",
      separadoDe: "2026-11-10T13:00:00.000Z",
      separadoAte: "2026-11-13T20:00:00.000Z",
      por: "Guilherme Dantas",
      volumes: [volume(2, 42), volume(1, 60), volume(3, 3233)],
    });
    expect(folha).toMatchObject({
      numero: "PED-0001",
      cliente: "BTG Pactual",
      destino: "Agência Faria Lima",
      paraQuando: "Seg 16/11/2026 11:36",
      lacre: "88231",
      separado: "10/11 a 13/11/2026",
      por: "Guilherme Dantas",
      unidades: 3335,
    });
    expect(folha.volumes.map((item) => item.numero)).toEqual([1, 2, 3]);
  });

  it("sem prazo, lacre nem quem separou, a folha sai com os campos vazios", () => {
    expect(folhaDoRomaneio({ numero: "PED-0002", volumes: [] })).toEqual({
      numero: "PED-0002",
      cliente: "",
      destino: "",
      paraQuando: "",
      lacre: "",
      separado: "",
      por: "",
      unidades: 0,
      volumes: [],
    });
  });

  it("o endereço leva o pedido na busca", () => {
    expect(hrefDoRomaneio("ord_creq 1")).toBe("/pedidos/romaneio?pedido=ord_creq%201");
  });
});
