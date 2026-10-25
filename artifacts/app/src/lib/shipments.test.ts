import { describe, expect, it } from "vitest";

import { invoiceDraft, parsePastedItems, quantidadeEscrita, shipmentStage, shipmentView, splitShipments } from "./shipments";

const base = { type: "recebimento", supplier: "Gráfica Alfa", invoice_number: "48213", item_count: 4, quantity_total: 1200 };

describe("etapa do envio", () => {
  it.each([
    [{ status: "open", operational_status: "awaiting_review" }, "notified"],
    [{ status: "approved" }, "confirmed"],
    [{ status: "closed", operational_status: "received" }, "arrived"],
    [{ status: "rejected", decision_reason: "mercadoria de outro cliente" }, "rejected"],
    [{ status: "cancelled", operational_status: "cancelled" }, "cancelled"],
  ])("%o → %s", (request, stage) => {
    expect(shipmentStage(request)).toBe(stage);
  });
});

describe("como o envio aparece", () => {
  it("a caminho: título, previsão, resumo e só cancela enquanto não confirmado", () => {
    const view = shipmentView({ ...base, id: "r1", status: "open", due_at: "2026-10-02T12:00:00Z", attachment_count: 1, requested_by_name: "Cristiane Souza", created_at: "2026-09-29T13:00:00Z" });
    expect(view).toMatchObject({ title: "Gráfica Alfa · NF 48213", summary: "4 itens · 1.200 peças", attachments: 1, detail: "avisado por Cristiane em 29/09", canCancel: true });
    expect(view.arrival).toBe("sex, 02/10");
    expect(shipmentView({ ...base, item_count: 1, quantity_total: 1 }).summary).toBe("1 item · 1 peça");
    expect(shipmentView({ ...base, status: "approved" }).canCancel).toBe(false);
    expect(view.number).toBe("");
    expect(shipmentView({ ...base, request_number: "ENV-0012" }).number).toBe("ENV-0012");
  });

  it("chegou: quanto chegou de verdade e o que veio diferente", () => {
    const view = shipmentView({
      ...base, status: "closed", operational_status: "received", received_at: "2026-09-22T15:00:00Z",
      qty_expected: 120, qty_received: 118,
      received_differences: [{ code: "A.01.0594.005.M", expected: 20, received: 18 }],
    });
    expect(view.received).toEqual({ label: "118 de 120 peças", tone: "short", differences: ["2 peças a menos em A.01.0594.005.M"] });
    expect(view.detail).toBe("chegou e foi conferido em 22/09 · 2 peças a menos em A.01.0594.005.M");
  });

  it("recusado e cancelado mostram o motivo e quem cancelou", () => {
    expect(shipmentView({ ...base, status: "rejected", decision_reason: "mercadoria de outro cliente", updated_at: "2026-09-15T12:00:00Z" }).detail).toBe(
      "recusado em 15/09: mercadoria de outro cliente",
    );
    expect(shipmentView({ ...base, status: "cancelled", updated_at: "2026-09-16T12:00:00Z" }).detail).toBe("cancelado por você em 16/09");
  });

  it("separa a caminho (por data de chegada) do histórico, só com envios", () => {
    const { onTheWay, history } = splitShipments([
      { ...base, id: "late", status: "open", due_at: "2026-10-06T12:00:00Z", created_at: "2026-10-01T10:00:00Z" },
      { ...base, id: "soon", status: "approved", due_at: "2026-10-02T12:00:00Z", created_at: "2026-09-29T10:00:00Z" },
      { ...base, id: "done", status: "closed", operational_status: "received", created_at: "2026-09-20T10:00:00Z" },
      { id: "pedido", type: "retirada", status: "open", created_at: "2026-10-01T11:00:00Z" },
    ]);
    expect(onTheWay.map((view) => view.id)).toEqual(["soon", "late"]);
    expect(history.map((view) => view.id)).toEqual(["done"]);
  });
});

describe("colar da planilha", () => {
  it("lê código e quantidade do Excel, da nota ou com ponto e vírgula", () => {
    const { lines, ignored } = parsePastedItems(
      "Código\tQuantidade\nA.01.0114.004.G\t300\nA.01.0114.004.GG;200\nK.0220.001.U    1.500\nA.01.0114.004.G 20\n\nsem quantidade\n",
    );
    expect(lines).toEqual([
      { code: "A.01.0114.004.G", quantity: 320 },
      { code: "A.01.0114.004.GG", quantity: 200 },
      { code: "K.0220.001.U", quantity: 1500 },
    ]);
    expect(ignored).toBe(2);
  });
});

describe("a quantidade escrita", () => {
  it("o ponto separa o milhar e a vírgula, a fração, como no resto do portal", () => {
    expect(quantidadeEscrita("1.200")).toBe(1200);
    expect(quantidadeEscrita(" 50 ")).toBe(50);
    expect(quantidadeEscrita("12,5")).toBe(12.5);
    expect(quantidadeEscrita("1.200,5")).toBe(1200.5);
  });

  it("o que não se lê sem dúvida não vale, em vez de virar outra quantidade", () => {
    for (const texto of ["", "1.5", "1,500.00", "1.20", "abc", "1,2,3"]) expect(quantidadeEscrita(texto), texto).toBeNaN();
  });

  it("colado, o 1.5 fica de fora em vez de virar 15", () => {
    const { lines, ignored } = parsePastedItems("K.0220.001.U\t1.5\nK.0220.002.U\t1.200");
    expect(lines).toEqual([{ code: "K.0220.002.U", quantity: 1200 }]);
    expect(ignored).toBe(1);
  });

  it("a nota lida escreve a fração com vírgula, e a leitura volta ao mesmo número", () => {
    const [linha] = invoiceDraft({
      supplier: "Gráfica Alfa",
      invoice_number: "48213",
      issue_date: "2026-09-28",
      items: [{ supplier_code: "T1", description: "Tecido", quantity: 12.345, unit: "KG", match: null }],
    });
    expect(linha!.quantity).toBe("12,345");
    expect(quantidadeEscrita(linha!.quantity)).toBe(12.345);
  });
});

describe("itens lidos da nota", () => {
  it("viram linhas para conferir: casadas trazem o código da BTG, as outras pedem código", async () => {
    const { invoiceDraft } = await import("./shipments");
    const draft = invoiceDraft({
      supplier: "Gráfica Alfa",
      invoice_number: "48213",
      issue_date: "2026-09-28",
      items: [
        { supplier_code: "A.01.0114.004.G", description: "CAMISETA G", quantity: 300, unit: "UN", match: { client_item_code: "A.01.0114.004.G", sku_code: "S1", product_name: "CAMISETA", by: "codigo" } },
        { supplier_code: "77", description: "ECOBAG LONA", quantity: 500, unit: "UN", match: null },
      ],
    });
    expect(draft).toEqual([
      { key: "nf0", include: true, invoiceText: "A.01.0114.004.G · CAMISETA G", code: "A.01.0114.004.G", name: "CAMISETA", quantity: "300", matchedBy: "codigo", supplierCode: "A.01.0114.004.G" },
      { key: "nf1", include: true, invoiceText: "77 · ECOBAG LONA", code: "", name: "ECOBAG LONA", quantity: "500", matchedBy: null, supplierCode: "77" },
    ]);
  });

  it("fornecedor, NF e observações entram logo após a leitura, sem apagar o que foi digitado", async () => {
    const { fillIfEmpty } = await import("./shipments");
    expect(fillIfEmpty("", "Uniformes Elegância Confecções LTDA")).toBe("Uniformes Elegância Confecções LTDA");
    expect(fillIfEmpty(" ", "2471")).toBe("2471");
    expect(fillIfEmpty("Elegância", "Uniformes Elegância Confecções LTDA")).toBe("Elegância");
    expect(fillIfEmpty("", undefined)).toBe("");
  });
});

describe("código a definir", () => {
  it("item sem código passa com o nome; sem código e sem nome, não", async () => {
    const { shipmentLineProblem } = await import("./shipments");
    expect(shipmentLineProblem(0, { code: "", name: "BLUSA MOLETOM", quantity: 8, inStock: false })).toBeNull();
    expect(shipmentLineProblem(1, { code: " ", name: "", quantity: 8, inStock: false })).toBe("Item 2: informe o código ou o nome do produto.");
    expect(shipmentLineProblem(0, { code: "NOVO-1", name: "", quantity: 8, inStock: false })).toBe("Item 1: produto novo, informe o nome.");
    expect(shipmentLineProblem(0, { code: "A.01", name: "", quantity: 8, inStock: true })).toBeNull();
    expect(shipmentLineProblem(2, { code: "", name: "CALÇA", quantity: 0, inStock: false })).toBe("Item 3: informe quantas peças vêm.");
  });

  it("vai para a Dutelog como código a definir, com o código do fornecedor anotado", async () => {
    const { pendingCodeItem } = await import("./shipments");
    expect(pendingCodeItem({ name: " BLUSA MOLETOM ", quantity: 8, supplierCode: "BAT101" })).toEqual({
      product_name: "BLUSA MOLETOM",
      product_registration: "unknown",
      location_id: null,
      quantity: 8,
      notes: "Código do fornecedor: BAT101",
    });
    expect(pendingCodeItem({ name: "CALÇA", quantity: 20 }).notes).toBeUndefined();
  });
});
