// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { buildShelves, skuIndexFromRows } from "@/lib/warehouse-map";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";

import { ShelfPanel } from "./warehouse-map";

/**
 * O painel da prateleira do Mapa (carregamento v2, parte 13a): ao lado da
 * lista, ele tem o "Fechar" dele; no painel de baixo do celular (Sheet), o
 * X de 44 px é o do Sheet, e o do painel sai. Antes, os dois ficavam um sobre
 * o outro, e o X de 44 px cobria o de dentro. Dados sintéticos.
 */

const [a01] = buildShelves(
  [{ id: "A-01", code: "A-01", aisle: "A", shelf: 1, length_m: 1.78, depth_m: 0.75, height_m: 0.65, max_weight_kg: null, sequence: 1, customer_code: "BTG Pactual", status: "active" }],
  [],
  [],
);
const indice = skuIndexFromRows([]);
const fechar = (html: string) => (html.match(/aria-label="Fechar"/g) ?? []).length;

describe("o painel da prateleira", () => {
  it("ao lado da lista, com o Fechar dele", () => {
    const html = renderToStaticMarkup(<ShelfPanel shelf={a01!} lines={[]} skuIndex={indice} onClose={() => {}} onLabels={() => {}} />);
    expect(fechar(html)).toBe(1);
  });

  it("no Sheet do celular, sem o Fechar dele, e o cabeçalho deixa o canto para o X do Sheet", async () => {
    const html = renderToStaticMarkup(<ShelfPanel shelf={a01!} lines={[]} skuIndex={indice} onLabels={() => {}} />);
    expect(fechar(html)).toBe(0);
    expect(html).toMatch(/<div class="[^"]*\bpr-10\b[^"]*"><div class="min-w-0"><h2/);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });
});
