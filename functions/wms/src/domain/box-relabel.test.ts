import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { caixaMovidaSemEtiqueta, etiquetaParaTrocar } from "./box-relabel.js";

/**
 * Etiquetas para trocar, sem o banco: a caixa aberta (separação com caixas,
 * parte 3d) e a caixa movida (Mover caixa, 19/11/2026,
 * docs/superpowers/specs/2026-11-19-mover-caixa-design.md). A etiqueta da
 * caixa imprime a prateleira: a que mudou de lugar pede etiqueta nova até a
 * impressão ser registrada.
 */

const MOVIDA_EM = "2026-11-19T17:32:00.000Z";
const guardada = (extra: Record<string, unknown> = {}) => ({ status: "stored", location_id: "B-09", unit_count: 20, ...extra });

describe("a caixa movida em Etiquetas para trocar", () => {
  it("a caixa movida intacta pede etiqueta nova", () => {
    const caixa = guardada({ moved_at: MOVIDA_EM });
    assert.equal(caixaMovidaSemEtiqueta(caixa), true);
    assert.equal(etiquetaParaTrocar(caixa), true);
  });

  it("a impressão do mover tira a caixa da lista", () => {
    const caixa = guardada({ moved_at: MOVIDA_EM, location_label_printed_for: MOVIDA_EM });
    assert.equal(caixaMovidaSemEtiqueta(caixa), false);
    assert.equal(etiquetaParaTrocar(caixa), false);
  });

  it("a caixa intacta que nunca se moveu não pede", () => {
    assert.equal(caixaMovidaSemEtiqueta(guardada()), false);
    assert.equal(etiquetaParaTrocar(guardada()), false);
  });

  it("a vazia não pede, mesmo movida", () => {
    const vazia = guardada({ status: "emptied", moved_at: MOVIDA_EM });
    assert.equal(caixaMovidaSemEtiqueta(vazia), false);
    assert.equal(etiquetaParaTrocar(vazia), false);
  });

  it("a aberta continua como antes", () => {
    const aberta = guardada({ taken_units: 3, taken_lines: [{ sku_code: "BTG-000112", qty: 3 }], balance_at: "2026-11-11T14:00:00.000Z" });
    assert.equal(etiquetaParaTrocar(aberta), true);
    assert.equal(etiquetaParaTrocar({ ...aberta, balance_label_printed_for: "2026-11-11T14:00:00.000Z" }), false);
  });

  it("aberta e movida: a etiqueta do saldo não vale pela da prateleira", () => {
    const caixa = guardada({ taken_units: 3, balance_at: "2026-11-11T14:00:00.000Z", balance_label_printed_for: "2026-11-11T14:00:00.000Z", moved_at: MOVIDA_EM });
    assert.equal(etiquetaParaTrocar(caixa), true);
    assert.equal(etiquetaParaTrocar({ ...caixa, location_label_printed_for: MOVIDA_EM }), false);
  });
});
