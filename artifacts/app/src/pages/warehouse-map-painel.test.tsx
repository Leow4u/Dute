// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { warehouseBoxFromRecord } from "@/lib/warehouse-boxes";
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

describe("o Mover no painel da prateleira (mover caixa, 19/11/2026)", () => {
  const medidas = { customer_code: "BTG Pactual", location_id: "A-01", length_m: 0.4, width_m: 0.6, height_m: 0.35, gross_weight_kg: 10, unit_count: 20 };
  const [comCaixas] = buildShelves(
    [{ id: "A-01", code: "A-01", aisle: "A", shelf: 1, length_m: 1.78, depth_m: 0.75, height_m: 0.65, max_weight_kg: null, sequence: 1, customer_code: "BTG Pactual", status: "active" }],
    [
      warehouseBoxFromRecord({ ...medidas, code: "CX-000121", status: "stored", origin: { kind: "opening_inventory", session_id: "s1" } }),
      warehouseBoxFromRecord({ ...medidas, code: "CX-000300", status: "committing", draft_unit_count: 6, origin: { kind: "receipt", invoice_number: "48.377" } }),
    ],
    [],
  );

  it("com quem mova, a caixa guardada leva Mover e a reservada não", () => {
    const html = renderToStaticMarkup(<ShelfPanel shelf={comCaixas!} lines={[]} skuIndex={indice} onLabels={() => {}} onMover={() => {}} />);
    expect((html.match(/>Mover</g) ?? []).length).toBe(1);
    const cartaoDaGuardada = html.slice(html.indexOf("CX-000121"), html.indexOf("CX-000300"));
    expect(cartaoDaGuardada).toContain(">Mover<");
  });

  it("sem quem mova, nenhuma caixa leva Mover", () => {
    const html = renderToStaticMarkup(<ShelfPanel shelf={comCaixas!} lines={[]} skuIndex={indice} onLabels={() => {}} />);
    expect(html).not.toContain(">Mover<");
  });
});
