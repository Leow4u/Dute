import { describe, expect, it } from "vitest";

import {
  CODE128_QUIET_ZONE,
  CODE128_START_B,
  code128Bars,
  code128Checksum,
  code128Modules,
  code128Patterns,
  code128Values,
} from "./code128";

describe("tabela do Code 128", () => {
  it("tem os 106 símbolos de 11 módulos e a parada de 13", () => {
    const { symbols, stop } = code128Patterns();
    expect(symbols).toHaveLength(106);
    for (const pattern of symbols) {
      expect(pattern).toMatch(/^[1-4]{6}$/);
      expect([...pattern].reduce((sum, digit) => sum + Number(digit), 0)).toBe(11);
    }
    expect([...stop].reduce((sum, digit) => sum + Number(digit), 0)).toBe(13);
    expect(new Set(symbols).size).toBe(106);
  });
});

describe("codificação", () => {
  it("usa o dígito verificador da norma (exemplo PJJ123C, Start B = 55)", () => {
    // Start B (104) + P(48)×1 + J(42)×2 + J(42)×3 + 1(17)×4 + 2(18)×5 + 3(19)×6 + C(35)×7 = 879; 879 mod 103 = 55.
    const values = code128Values("PJJ123C");
    expect(values[0]).toBe(CODE128_START_B);
    expect(values.at(-1)).toBe(55);
    expect(code128Checksum([CODE128_START_B, 48, 42, 42, 17, 18, 19, 35])).toBe(55);
  });

  it("CX-000001 vira 11 símbolos mais a parada, começando e terminando em barra", () => {
    const widths = code128Modules("CX-000001");
    expect(widths).toHaveLength(11 * 6 + 7);
    expect(widths.reduce((sum, width) => sum + width, 0)).toBe(11 * 11 + 13);
    const { bars, width } = code128Bars("CX-000001");
    expect(width).toBe(11 * 11 + 13 + 2 * CODE128_QUIET_ZONE);
    expect(bars[0]!.x).toBe(CODE128_QUIET_ZONE);
    const last = bars.at(-1)!;
    expect(last.x + last.width).toBe(width - CODE128_QUIET_ZONE);
    expect(bars).toHaveLength((11 * 3) + 4);
  });

  it("recusa texto vazio e caractere fora do ASCII imprimível", () => {
    expect(() => code128Values("")).toThrow(/vazio/);
    expect(() => code128Values("CAIXA-Ç")).toThrow(/não cabe/);
  });
});
