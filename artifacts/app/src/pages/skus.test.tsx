import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * O cadastro do item: os dois códigos são a identidade (o servidor recusa a
 * troca em catalogCodeForMutation, "identidade imutável"). Editar o cadastro
 * só os mostra; criar ainda os pede.
 */
const TELA = readFileSync(new URL("./skus.tsx", import.meta.url), "utf8");

describe("editar o cadastro do item", () => {
  it("os códigos ficam só para leitura na edição", () => {
    expect(TELA).toMatch(/<Input id="cod_btg" readOnly=\{isEdit\}/);
    expect(TELA).toMatch(/<Input id="cod_cliente" readOnly=\{isEdit\}/);
  });
});
