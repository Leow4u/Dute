import { describe, expect, it } from "vitest";
import { Timestamp } from "firebase/firestore";

import {
  PREFIX_RANGE_END,
  decodeOrderValue,
  encodeOrderValue,
  fromBase64,
  pageWindow,
  prefixRangeEnd,
  toBase64,
} from "./list-pagination";

describe("cursor: base64 seguro para UTF-8", () => {
  it("preserva acentos e emoji que quebravam btoa cru", () => {
    for (const value of ["Suéter Azul", "Endereço — Rua A", "produto 📦", "ção"]) {
      expect(fromBase64(toBase64(value))).toBe(value);
    }
  });

  it("faz round-trip de um payload de cursor completo", () => {
    const payload = JSON.stringify({ id: "mov_ação_01", o: { t: "v", v: "SKU-Ç" } });
    expect(fromBase64(toBase64(payload))).toBe(payload);
  });
});

describe("cursor: envelope tipado do valor de ordenação", () => {
  it("sobrevive a Timestamp (JSON puro perderia a escala)", () => {
    const original = new Timestamp(1785000000, 123456789);
    const decoded = decodeOrderValue(
      JSON.parse(JSON.stringify(encodeOrderValue(original))),
    );
    expect(decoded).toBeInstanceOf(Timestamp);
    expect((decoded as Timestamp).seconds).toBe(original.seconds);
    expect((decoded as Timestamp).nanoseconds).toBe(original.nanoseconds);
  });

  it("preserva string ISO e número sem alterar o tipo", () => {
    expect(decodeOrderValue(encodeOrderValue("2026-07-30T12:00:00.000Z"))).toBe(
      "2026-07-30T12:00:00.000Z",
    );
    expect(decodeOrderValue(encodeOrderValue(42))).toBe(42);
  });

  it("normaliza ausência para null e undefined para undefined", () => {
    expect(decodeOrderValue(encodeOrderValue(undefined))).toBeNull();
    expect(decodeOrderValue(undefined)).toBeUndefined();
  });
});

describe("pageWindow: janela aplicada uma única vez", () => {
  const rows = Array.from({ length: 500 }, (_, index) => index);

  it("devolve a fatia correta em cada página", () => {
    expect(pageWindow(rows, 0, 50)).toEqual(rows.slice(0, 50));
    expect(pageWindow(rows, 50, 50)[0]).toBe(50);
    expect(pageWindow(rows, 100, 50)[0]).toBe(100);
    expect(pageWindow(rows, 450, 50)).toHaveLength(50);
  });

  it("nunca aplica o offset duas vezes (regressão que esvaziava a página 2)", () => {
    // Se o offset fosse aplicado de novo sobre a janela, a página 2 viria
    // vazia e a 3 também — foi o que a revisão adversarial pegou.
    const alreadyWindowed = pageWindow(rows, 50, 50);
    expect(pageWindow(alreadyWindowed, 0, 50)).toEqual(alreadyWindowed);
    expect(pageWindow(alreadyWindowed, 0, 50)[0]).toBe(50);
  });

  it("degrada sem quebrar em entradas inválidas", () => {
    expect(pageWindow(rows, -10, 50)[0]).toBe(0);
    expect(pageWindow(rows, 0, 0)).toEqual([]);
    expect(pageWindow([], 100, 50)).toEqual([]);
  });
});

describe("prefixRangeEnd: busca por prefixo no servidor", () => {
  it("delimita o prefixo acima de qualquer sufixo comum", () => {
    const term = "BTG-10";
    const end = prefixRangeEnd(term);
    for (const match of ["BTG-10", "BTG-100", "BTG-1043", "BTG-10ZZZ"]) {
      expect(match >= term && match < end).toBe(true);
    }
  });

  it("exclui o que não começa com o termo", () => {
    const term = "BTG-10";
    const end = prefixRangeEnd(term);
    for (const other of ["BTG-2", "BTG-0", "ATG-10"]) {
      expect(other >= term && other < end).toBe(false);
    }
  });

  it("usa o sentinela alto do Firestore", () => {
    expect(PREFIX_RANGE_END.charCodeAt(0)).toBe(0xf8ff);
  });
});
