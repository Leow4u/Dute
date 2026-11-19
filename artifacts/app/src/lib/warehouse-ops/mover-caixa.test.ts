import { describe, expect, it } from "vitest";

import { warehouseBoxFromRecord } from "@/lib/warehouse-boxes";

import {
  ROTA_DO_MOVER,
  caixasMovidasSemEtiqueta,
  codigoDaCaixa,
  moverUrl,
  textoDaMovida,
  textoDaOrigem,
  textoDaPrateleira,
  textoDasForas,
  type CaixaDaPrevia,
  type ResultadoDoMover,
} from "./mover-caixa";

/**
 * Os textos e as regras da página Mover caixa (docs/superpowers/specs/2026-11-19-mover-caixa-design.md;
 * mockup em docs/mockups/mover-caixa/), sem o servidor.
 */

describe("o código da caixa digitado", () => {
  it("aceita o código da etiqueta, o minúsculo, sem o hífen e só os algarismos", () => {
    for (const digitado of ["CX-000121", " cx-000121 ", "cx-121", "CX121", "121", "000121"]) expect(codigoDaCaixa(digitado)).toBe("CX-000121");
    expect(codigoDaCaixa("CX-1000001")).toBe("CX-1000001");
  });

  it("o que não é código de caixa não abre nada", () => {
    for (const digitado of ["", "  ", "A-01", "CX-", "CX-ABC", "12a", "B-09"]) expect(codigoDaCaixa(digitado)).toBeNull();
  });
});

describe("os textos do mover", () => {
  it("a prateleira: a frente livre e as caixas", () => {
    expect(textoDaPrateleira(1.42, 2)).toBe("1,42 m livres · 2 caixas");
    expect(textoDaPrateleira(1.8, 0)).toBe("1,80 m livres · sem caixas");
    expect(textoDaPrateleira(1.38, 1)).toBe("1,38 m livres · 1 caixa");
  });

  it("as prateleiras de fora, numa linha; sem nenhuma, nada", () => {
    expect(textoDasForas("Não cabe", ["A-02", "B-11"])).toBe("Não cabe: A-02 · B-11");
    expect(textoDasForas("Com reserva", ["B-10"])).toBe("Com reserva: B-10");
    expect(textoDasForas("Em contagem", [])).toBeNull();
  });

  it("de onde a caixa saiu, quando e quem, na hora de São Paulo", () => {
    const resultado = { from_location_id: "A-01", to_location_id: "B-09", units: 20, moved_at: "2026-11-19T17:32:00.000Z", moved_by_name: "Leonardo" } as ResultadoDoMover;
    expect(textoDaMovida(resultado)).toBe("saiu de A-01 · 20 un. · 19/11 14:32 · Leonardo");
    expect(textoDaMovida({ ...resultado, moved_by_name: undefined })).toBe("saiu de A-01 · 20 un. · 19/11 14:32");
  });

  it("a origem da caixa, a data e as medidas", () => {
    const abertura = { origin_kind: "opening_inventory", stored_at: "2026-10-22T13:00:00.000Z", length_m: 0.4, width_m: 0.6, height_m: 0.35, gross_weight_kg: 10 } as CaixaDaPrevia;
    expect(textoDaOrigem(abertura)).toBe("Abertura · 22/10/2026 · 40 × 60 × 35 cm · 10 kg");
    const recebida = { ...abertura, origin_kind: "receipt", invoice_number: "48.377", stored_at: "2026-11-06T18:02:00.000Z", gross_weight_kg: null } as CaixaDaPrevia;
    expect(textoDaOrigem(recebida)).toBe("Recebimento · NF 48.377 · 06/11/2026 · 40 × 60 × 35 cm");
  });

  it("o endereço da página, com e sem a caixa", () => {
    expect(ROTA_DO_MOVER).toBe("/estoque/mapa/mover");
    expect(moverUrl("CX-000121")).toBe("/estoque/mapa/mover?caixa=CX-000121");
    expect(moverUrl()).toBe("/estoque/mapa/mover");
  });
});

describe("as caixas movidas sem etiqueta nova", () => {
  it("só as do cliente, guardadas, movidas e sem a impressão do mover", () => {
    const caixa = (code: string, extra: Record<string, unknown>) =>
      warehouseBoxFromRecord({ code, customer_code: "BTG Pactual", status: "stored", location_id: "B-09", length_m: 0.4, width_m: 0.6, height_m: 0.35, unit_count: 20, ...extra });
    const movidaEm = "2026-11-19T17:32:00.000Z";
    const caixas = [
      caixa("CX-000130", { moved_at: movidaEm }),
      caixa("CX-000121", { moved_at: movidaEm }),
      caixa("CX-000122", { moved_at: movidaEm, location_label_printed_for: movidaEm }),
      caixa("CX-000123", {}),
      caixa("CX-000124", { moved_at: movidaEm, status: "emptied" }),
      caixa("CX-000500", { moved_at: movidaEm, customer_code: "Itaú" }),
    ];
    expect(caixasMovidasSemEtiqueta(caixas, "BTG Pactual")).toEqual(["CX-000121", "CX-000130"]);
  });
});
