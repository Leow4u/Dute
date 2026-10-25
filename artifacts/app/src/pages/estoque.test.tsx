import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StockToolbar } from "@/components/stock/stock-workbench";
import type { StockItem } from "@/lib/stock-items";
import { telaDoWmsNaV3 } from "@/lib/wms-v3";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela } from "@/test/textos";

import { ItemList, SecaoDoGiro } from "./estoque";
import { payloadDaMovimentacao } from "./movements";

/**
 * O Estoque na v3 (parte 4.7d): a lista de itens com o código, o nome, o
 * endereço e os saldos; a busca com rótulo; o código sem o vermelho, que na
 * v3 é só da ação principal e do alerta. Os dias parado (parte 5.4c): as
 * etiquetas na lista e o giro e as caixas na ficha.
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

  it("quem só consulta (o suporte) não vê a Contagem, Registrar movimentação nem as ações da ficha", () => {
    const fonte = readFileSync(new URL("./estoque.tsx", import.meta.url), "utf8");
    expect(fonte.match(/href="\/wms\/contagem"/g)).toHaveLength(3);
    expect(fonte).toMatch(/\{warehouseWriter \? \(\s*<Button asChild variant="outline">\s*<Link href="\/wms\/contagem">/);
    expect(fonte).toMatch(/warehouseWriter \? \(\s*<Button asChild variant="outline" size="sm">\s*<Link href="\/wms\/contagem">/);
    expect(fonte).toMatch(/\{warehouseWriter \? \(\s*<div className="mt-auto flex/);
    expect(fonte).toContain('{tab === "history" && warehouseWriter ? (');
  });

  it("sem exemplo no motivo da movimentação", () => {
    expect(readFileSync(new URL("./movements.tsx", import.meta.url), "utf8")).not.toContain("Ex.:");
  });

  it("a movimentação vai para o cliente ativo, com o sinal do tipo", () => {
    const valores = {
      data: "2026-10-25T10:00",
      tipo_mov: "AJUSTE_ENTRADA",
      cod_sku: "ITAU-000001",
      produto: "Cadeira",
      qtde: 2,
      sinal: -1,
      origem: "",
      destino: "A-01-02",
      responsavel: "",
      doc_nf: "",
      motivo: "Contagem física",
    };
    expect(payloadDaMovimentacao(valores, "Itaú", "chave-1")).toEqual({
      ...valores,
      data: new Date("2026-10-25T10:00").toISOString(),
      sinal: 1,
      customer_code: "Itaú",
      idempotency_key: "chave-1",
    });
    expect(payloadDaMovimentacao({ ...valores, tipo_mov: "SAIDA" }, "Itaú", "chave-2")).toMatchObject({ sinal: -1, customer_code: "Itaú" });
  });

  it("passa nas regras WCAG 2.1 A e AA do axe", async () => {
    expect(await violacoesDeAcessibilidade(lista("000001"))).toEqual([]);
    expect(await violacoesDeAcessibilidade(renderToStaticMarkup(<StockToolbar search="" onSearchChange={() => undefined} placeholder="Buscar por SKU interno da movimentação" />))).toEqual([]);
  });
});

const GIRO = {
  relogio: { primeira_entrada: "2026-04-03T15:00:00.000Z", ultima_entrada: "2026-04-03T15:00:00.000Z", ultima_saida: "2026-07-12T15:00:00.000Z" },
  diasParado: 100,
  etiquetas: ["parado" as const, "sem_giro" as const],
  rotulos: ["Parado 90+ dias", "Sem giro"],
};

const CAIXAS = [
  { code: "CX-000001", posicao: "A-01", diasParado: 100, parada: true },
  { code: "CX-000003", posicao: "B-09", diasParado: 19, parada: false },
];

function giro(semGiro = false) {
  return renderToStaticMarkup(
    <div className="v3">
      {semGiro ? <SecaoDoGiro caixas={[]} rotuloDaCaixaParada="Parado 90+ dias" /> : <SecaoDoGiro giro={GIRO} caixas={CAIXAS} rotuloDaCaixaParada="Parado 90+ dias" />}
    </div>,
  );
}

describe("os dias parado no Estoque (parte 5.4c)", () => {
  it("a etiqueta na lista, junto das outras do item, sem o vermelho", () => {
    const html = renderToStaticMarkup(
      <div className="v3">
        <ItemList items={[item("000001", { clientCode: "POLO-M-AZ", giro: GIRO })]} onSelect={() => undefined} />
      </div>,
    );
    expect(textosDaTela(html)).toEqual(["Item", "Endereço", "Saldo", "Disponível", "POLO-M-AZ", "Camisa polo", "· M · azul", "A-01-02", "Parado 90+ dias", "Sem giro", "12"]);
    expect(html).toMatch(/bg-warning-soft text-warning-soft-foreground">Parado 90\+ dias</);
    expect(html).not.toMatch(/destructive[^"]*">Parado/);
  });

  it("a ficha mostra o giro e as caixas, com os dias de cada uma", () => {
    expect(textosDaTela(giro())).toEqual([
      "Giro",
      "Última entrada",
      "03/04/2026",
      "Última saída",
      "12/07/2026",
      "Sem movimento",
      "100 dias",
      "Parado 90+ dias",
      "Sem giro",
      "Caixas",
      "CX-000001",
      "A-01",
      "CX-000003",
      "B-09",
      "19 dias",
    ]);
  });

  it("sem a memória do item e sem caixa, a ficha não mostra nada", () => {
    expect(textosDaTela(giro(true))).toEqual([]);
  });

  it("passa nas regras WCAG 2.1 A e AA do axe", async () => {
    expect(await violacoesDeAcessibilidade(giro())).toEqual([]);
  });
});
