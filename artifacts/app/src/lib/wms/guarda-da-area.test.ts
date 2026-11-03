import { describe, expect, it } from "vitest";

import { podeAbrirGuarda } from "./guarda-da-area";

/** A ação "Guardar" no Estoque (decisão 16, parte 7e): quando o botão abre a guarda. */

describe("abrir a guarda do saldo parado numa área", () => {
  it("só com a quantidade entre zero e o que está sem guarda, e o motivo preenchido", () => {
    expect(podeAbrirGuarda(24, 24, "Contagem achou no RECEBIMENTO")).toBe(true);
    expect(podeAbrirGuarda(0.5, 24, "Resto da guarda")).toBe(true);
    expect(podeAbrirGuarda(25, 24, "Contagem achou no RECEBIMENTO")).toBe(false);
    expect(podeAbrirGuarda(0, 24, "Contagem achou no RECEBIMENTO")).toBe(false);
    expect(podeAbrirGuarda(Number.NaN, 24, "Contagem achou no RECEBIMENTO")).toBe(false);
    expect(podeAbrirGuarda(1, 0, "Contagem achou no RECEBIMENTO")).toBe(false);
    expect(podeAbrirGuarda(1, 24, "  ")).toBe(false);
    expect(podeAbrirGuarda(1, 24, "ok")).toBe(false);
    // Em três casas, como o servidor: o que arredonda para zero não abre.
    expect(podeAbrirGuarda(0.0001, 24, "Contagem achou no RECEBIMENTO")).toBe(false);
    expect(podeAbrirGuarda(0.0005, 24, "Contagem achou no RECEBIMENTO")).toBe(true);
    expect(podeAbrirGuarda(24.0004, 24, "Contagem achou no RECEBIMENTO")).toBe(true);
  });
});
