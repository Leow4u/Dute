import { describe, expect, it } from "vitest";

import { regraDoModelo } from "@workspace/dominio";

import { matchesFilter, type StockItem } from "../stock-items";
import { caixasDoSku, dataDoRelogio, diasEmTexto, giroPorSku, hojeEmSaoPaulo, itemParadoLido } from "./parados";

/**
 * Os dias parado no Estoque (parte 5.4c): o item gravado pela rotina, o giro
 * de cada SKU e as caixas dele hoje, pela regra do modelo. Dados sintéticos.
 */

const HOJE = "2026-10-20";
const REGRA = regraDoModelo("uniformes");

const parado = itemParadoLido({
  customer_code: "ITAU",
  sku_code: "ITAU-000001",
  saldo: 30,
  relogio: { primeira_entrada: "2026-04-03T15:00:00.000Z", ultima_entrada: "2026-04-03T15:00:00.000Z", ultima_saida: "2026-07-12T15:00:00.000Z" },
  saidas_por_posicao: { "A-01": "2026-07-12T15:00:00.000Z", "b-02": "nunca" },
});
const novo = itemParadoLido({
  customer_code: "ITAU",
  sku_code: "ITAU-000002",
  saldo: 4,
  relogio: { primeira_entrada: "2026-10-10T15:00:00.000Z", ultima_entrada: "2026-10-10T15:00:00.000Z", ultima_saida: null },
});

describe("o item gravado pela rotina", () => {
  it("lê o relógio, o saldo e as saídas por posição; a data que não é data fica de fora", () => {
    expect(parado).toEqual({
      skuCode: "ITAU-000001",
      saldo: 30,
      relogio: { primeira_entrada: "2026-04-03T15:00:00.000Z", ultima_entrada: "2026-04-03T15:00:00.000Z", ultima_saida: "2026-07-12T15:00:00.000Z" },
      saidasPorPosicao: { "A-01": "2026-07-12T15:00:00.000Z" },
    });
    expect(novo?.saidasPorPosicao).toEqual({});
    expect(itemParadoLido({ customer_code: "ITAU", saldo: 3 })).toBeNull();
  });
});

describe("o giro de cada SKU", () => {
  it("a idade e as etiquetas saem da regra do modelo, com o rótulo do limite dela", () => {
    const giro = giroPorSku([parado!, novo!], REGRA, HOJE);
    expect(giro.get("ITAU-000001")).toMatchObject({ diasParado: 100, etiquetas: ["parado"], rotulos: ["Parado 90+ dias"] });
    expect(giro.get("ITAU-000002")).toMatchObject({ diasParado: 10, etiquetas: [], rotulos: [] });
  });

  it("os filtros Parados e Sem giro do Estoque", () => {
    const giro = giroPorSku([parado!], REGRA, HOJE).get("ITAU-000001");
    const item = { giro } as StockItem;
    expect(matchesFilter(item, "idle")).toBe(true);
    expect(matchesFilter(item, "no-turnover")).toBe(false);
    expect(matchesFilter({ giro: { ...giro!, etiquetas: ["sem_giro"] } } as StockItem, "no-turnover")).toBe(true);
    expect(matchesFilter({} as StockItem, "idle")).toBe(false);
  });
});

describe("as caixas do SKU", () => {
  const itens = new Map([[parado!.skuCode, parado!]]);
  const caixa = (code: string, extra: Record<string, unknown>) => ({
    code,
    status: "stored",
    location_id: "A-01",
    sku_codes: ["ITAU-000001"],
    stored_at: "2026-04-10T15:00:00.000Z",
    ...extra,
  });

  it("só as guardadas com o SKU, as paradas primeiro, com os dias pela posição de cada uma", () => {
    const caixas = caixasDoSku(
      "ITAU-000001",
      [
        caixa("CX-000003", { location_id: "B-09", stored_at: "2026-10-01T15:00:00.000Z" }),
        caixa("CX-000001", {}),
        caixa("CX-000002", { status: "counting" }),
        caixa("CX-000004", { sku_codes: ["ITAU-000009"] }),
      ] as never,
      itens,
      REGRA,
      HOJE,
    );
    expect(caixas).toEqual([
      { code: "CX-000001", posicao: "A-01", diasParado: 100, parada: true },
      { code: "CX-000003", posicao: "B-09", diasParado: 19, parada: false },
    ]);
  });
});

describe("os textos", () => {
  it("os dias e a data no calendário de São Paulo", () => {
    expect([diasEmTexto(0), diasEmTexto(1), diasEmTexto(100), diasEmTexto(1200)]).toEqual(["Hoje", "1 dia", "100 dias", "1.200 dias"]);
    expect(dataDoRelogio("2026-07-12T15:00:00.000Z")).toBe("12/07/2026");
    expect(dataDoRelogio("2026-07-13T02:30:00.000Z")).toBe("12/07/2026");
    expect(dataDoRelogio(null)).toBe("—");
    expect(hojeEmSaoPaulo(new Date("2026-10-21T02:30:00.000Z"))).toBe("2026-10-20");
  });
});
