import { beforeEach, describe, expect, it } from "vitest";
import { CUSTOMER, clientOverview, customerRequests, kits, recipients, resetDemoState, resolve, skus } from "./data";

const call = (path: string, method = "GET", body: unknown = null) => {
  const url = new URL(path, "http://demo.local");
  return resolve(url.pathname, method, url.searchParams, body);
};

describe("dados da demonstração", () => {
  beforeEach(() => resetDemoState());

  it("só tem a conta de demonstração", () => {
    const overview = clientOverview();
    expect(overview.customer.name).toBe(CUSTOMER);
    for (const item of overview.inventory.items) expect(item.customer_code).toBe(CUSTOMER);
    for (const request of customerRequests()) expect(request.customer_code).toBe(CUSTOMER);
  });

  it("todo item tem foto", () => {
    const withoutPhoto = skus.filter((sku) => sku.photo_urls.length === 0).map((sku) => sku.produto);
    expect(withoutPhoto).toEqual([]);
    for (const sku of skus) expect(sku.primary_photo_url ?? null).toBe(sku.photo_urls[0] ?? null);
  });

  it("todo item de pedido existe no estoque", () => {
    const codes = new Set(skus.map((sku) => sku.sku_code));
    for (const request of customerRequests()) {
      for (const item of request.items) expect(codes.has(item.sku_code)).toBe(true);
    }
  });

  it("a reserva de cada item é a soma dos pedidos aprovados que ainda não saíram", () => {
    const reserved = new Map<string, number>();
    for (const request of customerRequests()) {
      const holding = request.type === "retirada" && request.status === "approved" && !["dispatched", "delivered"].includes(request.operational_status);
      if (!holding) continue;
      for (const item of request.items) reserved.set(item.sku_code, (reserved.get(item.sku_code) ?? 0) + item.quantity);
    }
    for (const sku of skus) expect(sku.estoque_reservado, sku.produto).toBe(reserved.get(sku.sku_code) ?? 0);
  });

  it("pedido aguardando aprovação tem saldo livre para ser aprovado na demonstração", () => {
    const free = new Map(skus.map((sku) => [sku.sku_code, sku.estoque_disponivel]));
    for (const request of customerRequests().filter((item) => item.status === "submitted")) {
      for (const item of request.items) expect(free.get(item.sku_code)!, `${request.request_number} ${item.product_name}`).toBeGreaterThanOrEqual(item.quantity);
    }
  });

  it("pedido feito no portal aparece na lista e a aprovação da Dutelog muda o status", () => {
    const created = call("/api/client/requests", "POST", { type: "retirada", title: "Teste", items: [{ sku_code: skus[0].sku_code, quantity: 1 }] });
    expect(created.request_number).toBe("SOL-121");
    expect(call("/api/client/overview").request_history[0].id).toBe(created.id);

    const decided = call(`/api/customer-requests/${created.id}/approve`, "POST", {});
    expect(decided.ok).toBe(true);
    expect(customerRequests().find((item) => item.id === created.id)?.status).toBe("approved");
  });

  it("todo item de kit modelo existe no estoque", () => {
    const codes = new Set(skus.map((sku) => sku.sku_code));
    for (const kit of kits()) for (const item of kit.items) expect(codes.has(item.sku), `${kit.name}: ${item.name}`).toBe(true);
  });

  it("agenda de destinatários: cria, edita e remove", () => {
    const before = recipients().length;
    const created = call("/api/demo/recipients", "POST", { name: "Pessoa Teste", address: "Rua A, 1", size: "M" });
    expect(recipients()).toHaveLength(before + 1);
    call(`/api/demo/recipients/${created.id}`, "POST", { name: "Pessoa Teste", address: "Rua B, 2" });
    expect(recipients().find((item) => item.id === created.id)?.address).toBe("Rua B, 2");
    expect(call("/api/demo/recipients", "POST", { name: "Sem endereço" }).ok).toBe(false);
    call(`/api/demo/recipients/${created.id}`, "DELETE");
    expect(recipients()).toHaveLength(before);
  });

  it("kit modelo: salva com nome e itens, e exclui", () => {
    const before = kits().length;
    const kit = call("/api/demo/kits", "POST", { name: "Kit teste", items: [{ sku: skus[0].sku_code, name: "x", quantity: 2 }] });
    expect(kits()[0].id).toBe(kit.id);
    expect(call("/api/demo/kits", "POST", { name: "Vazio", items: [] }).ok).toBe(false);
    call(`/api/demo/kits/${kit.id}`, "DELETE");
    expect(kits()).toHaveLength(before);
  });

  it("restaurar volta ao roteiro original", () => {
    call("/api/client/requests", "POST", { type: "retirada", items: [] });
    call("/api/demo/kits/kit_1", "DELETE");
    resetDemoState();
    expect(customerRequests().some((item) => item.request_number === "SOL-121")).toBe(false);
    expect(kits().some((kit) => kit.id === "kit_1")).toBe(true);
  });
});
