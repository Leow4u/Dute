import { describe, expect, it } from "vitest";

import { cartFromDraft, draftHref, dueAtFromDraft, parseDraft, saveDraft, takeDraft, type OrderDraft } from "./agent-draft";

const order = {
  tipo: "pedido",
  destino: "Loja Faria Lima",
  prazo: "2026-10-04",
  linhas: [
    { sku_code: "S1", codigo: "A.01.P", nome: "Polo P", quantidade: 20, disponivel: 30 },
    { sku_code: "S2", codigo: "A.01.GG", nome: "Polo GG", quantidade: 8, disponivel: 8 },
    { sku_code: "", codigo: "X", nome: "sem sku", quantidade: 1, disponivel: 1 },
  ],
  pendencias: [{ item: "caneca", motivo: "sem saldo disponível" }],
};

describe("rascunho do Agent Dute", () => {
  it("lê o rascunho de pedido e descarta linha sem SKU", () => {
    const draft = parseDraft(order) as OrderDraft;
    expect(draft.linhas.map((line) => line.sku_code)).toEqual(["S1", "S2"]);
    expect(draft.pendencias).toHaveLength(1);
    expect(draftHref(draft)).toBe("/portal/estoque?rascunho=1");
    expect(parseDraft({ tipo: "outro" })).toBeNull();
    expect(parseDraft(null)).toBeNull();
  });

  it("lê o aviso de envio", () => {
    const draft = parseDraft({
      tipo: "envio",
      fornecedor: "Uniformes",
      linhas: [
        { codigo: "A.01.P", nome: "Polo", quantidade: 120, situacao: "no_estoque" },
        { nome: "Boné", quantidade: 30, situacao: "codigo_a_definir" },
        { quantidade: 5 },
      ],
    });
    expect(draft?.tipo).toBe("envio");
    expect(draft?.linhas).toHaveLength(2);
    expect(draft && draftHref(draft)).toBe("/portal/recebimentos?rascunho=1");
  });

  it("guarda na aba e entrega uma vez, só para a tela do mesmo tipo", () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => void memory.set(key, value),
      removeItem: (key: string) => void memory.delete(key),
    };
    saveDraft(parseDraft(order)!, storage);
    expect(takeDraft("envio", storage)).toBeNull();
    expect(takeDraft("pedido", storage)?.destino).toBe("Loja Faria Lima");
    expect(takeDraft("pedido", storage)).toBeNull();
  });

  it("monta o carrinho pelo SKU, sem passar do disponível", () => {
    const { cart, missing } = cartFromDraft(
      [
        { key: "S1::A.01.P", sku: "S1", available: 10 },
        { key: "S3::C", sku: "S3", available: 5 },
      ],
      parseDraft(order) as OrderDraft,
    );
    expect(cart).toEqual({ "S1::A.01.P": 10 });
    expect(missing).toEqual(["A.01.GG"]);
    expect(dueAtFromDraft("2026-10-04")).toBe("2026-10-04T12:00");
    expect(dueAtFromDraft("sexta")).toBe("");
  });
});
