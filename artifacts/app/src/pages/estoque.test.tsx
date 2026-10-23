import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StockToolbar } from "@/components/stock/stock-workbench";
import type { StockItem } from "@/lib/stock-items";
import { telaDoWmsNaV3 } from "@/lib/wms-v3";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela } from "@/test/textos";

import { ItemList } from "./estoque";

/**
 * O Estoque na v3 (parte 4.7d): a lista de itens com o código, o nome, o
 * endereço e os saldos; a busca com rótulo; o código sem o vermelho, que na
 * v3 é só da ação principal e do alerta.
 */

const item = (key: string, extra: Partial<StockItem> = {}): StockItem => ({
  key,
  skuCode: `BTG-${key}`,
  name: "Camisa polo",
  detail: "M · azul",
  onHand: 12,
  reserved: 0,
  available: 12,
  locations: [{ id: "A-01-02", qty: 12 }],
  photos: ["foto.jpg"],
  low: false,
  zero: false,
  sku: {},
  ...extra,
} as StockItem);

const ITENS = [
  item("000001", { clientCode: "POLO-M-AZ" }),
  item("000002", { name: "Calça social", detail: "42", onHand: 0, available: 0, zero: true, photos: [], locations: [] }),
];

function lista(selectedKey?: string) {
  return renderToStaticMarkup(
    <div className="v3">
      <ItemList items={ITENS} selectedKey={selectedKey} onSelect={() => undefined} />
    </div>,
  );
}

describe("Estoque na v3", () => {
  it("a tela está na lista da v3; o Mapa, as Posições e as Etiquetas, ainda não", () => {
    expect(telaDoWmsNaV3("/estoque")).toBe(true);
    for (const tela of ["/estoque/mapa", "/estoque/posicoes", "/estoque/etiquetas"]) expect(telaDoWmsNaV3(tela), tela).toBe(false);
  });

  it("cada item com o código, o nome, o endereço, os saldos e o selo", () => {
    expect(textosDaTela(lista())).toEqual([
      "Item",
      "Endereço",
      "Saldo",
      "Disponível",
      "POLO-M-AZ",
      "Camisa polo",
      "· M · azul",
      "A-01-02",
      "12",
      "BTG-000002",
      "Calça social",
      "· 42",
      "Zerado",
      "Sem foto",
      "Sem endereço",
      "0",
    ]);
  });

  it("o código fica no texto, sem o vermelho da ação principal", () => {
    const html = lista();
    expect(html).toMatch(/<p class="font-mono text-sm font-bold text-foreground">POLO-M-AZ<\/p>/);
    expect(html).not.toMatch(/text-primary[^"]*">POLO-M-AZ/);
  });

  it("a busca do Estoque e do Histórico tem rótulo", () => {
    expect(readFileSync(new URL("./estoque.tsx", import.meta.url), "utf8")).toMatch(/<span className="sr-only">Buscar por código, nome ou endereço<\/span>/);
    const barra = renderToStaticMarkup(<StockToolbar search="" onSearchChange={() => undefined} placeholder="Buscar por SKU interno da movimentação" />);
    expect(barra).toMatch(/<label[^>]*><span class="sr-only">Buscar por SKU interno da movimentação<\/span>/);
  });

  it("sem exemplo no motivo da movimentação", () => {
    expect(readFileSync(new URL("./movements.tsx", import.meta.url), "utf8")).not.toContain("Ex.:");
  });

  it("passa nas regras WCAG 2.1 A e AA do axe", async () => {
    expect(await violacoesDeAcessibilidade(lista("000001"))).toEqual([]);
    expect(await violacoesDeAcessibilidade(renderToStaticMarkup(<StockToolbar search="" onSearchChange={() => undefined} placeholder="Buscar por SKU interno da movimentação" />))).toEqual([]);
  });
});
