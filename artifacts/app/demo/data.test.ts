import { beforeEach, describe, expect, it } from "vitest";
import { positionsForGuard, resolveGuardDestination } from "../src/lib/warehouse-positions";
import { CUSTOMER, clientOverview, customerRequests, events, kits, recipients, resetDemoState, resolve, skus } from "./data";

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
    const created = call("/api/client/requests", "POST", { type: "retirada", title: "Teste", card_message: " Oi Luana! ", items: [{ sku_code: skus[0].sku_code, quantity: 1 }] });
    expect(created.request_number).toBe("SOL-121");
    expect(created.card_message).toBe("Oi Luana!");
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
    const kit = call("/api/demo/kits", "POST", { name: "Kit teste", message: "Oi {nome}!", items: [{ sku: skus[0].sku_code, name: "x", quantity: 2 }] });
    expect(kits()[0].id).toBe(kit.id);
    expect(kits()[0].message).toBe("Oi {nome}!");
    expect(call("/api/demo/kits", "POST", { name: "Vazio", items: [] }).ok).toBe(false);
    call(`/api/demo/kits/${kit.id}`, "DELETE");
    expect(kits()).toHaveLength(before);
  });

  it("todo item de evento modelo existe no estoque", () => {
    const codes = new Set(skus.map((sku) => sku.sku_code));
    expect(events().length).toBeGreaterThan(0);
    for (const event of events()) for (const item of event.items) expect(codes.has(item.sku), `${event.name}: ${item.name}`).toBe(true);
  });

  it("evento modelo mostra o que falta no saldo livre de hoje", () => {
    const free = new Map(skus.map((sku) => [sku.sku_code, sku.estoque_disponivel]));
    const short = (id: string) => events().find((event) => event.id === id)!.items.filter((item) => (free.get(item.sku) ?? 0) < item.quantity).map((item) => item.name);
    // O Live Fest cabe no estoque de hoje; na Game XP falta a caixa de som (zerada).
    expect(short("evt_1")).toEqual([]);
    expect(short("evt_3")).toEqual(["Caixa de som bluetooth"]);
  });

  it("evento modelo: salva com nome, local e itens, e exclui", () => {
    const before = events().length;
    const event = call("/api/demo/events", "POST", { name: "Evento teste", venue: "Galpão", address: "Rua A, 1", items: [{ sku: skus[0].sku_code, name: "x", quantity: 1 }] });
    expect(events()).toHaveLength(before + 1);
    expect(events().find((item) => item.id === event.id)?.venue).toBe("Galpão");
    expect(call("/api/demo/events", "POST", { name: "Vazio", items: [] }).ok).toBe(false);
    call(`/api/demo/events/${event.id}`, "DELETE");
    expect(events()).toHaveLength(before);
  });

  it("a guarda da demo tem prateleira ativa na zona do cliente de cada tarefa", () => {
    const positions = call("/api/warehouse/positions?limit=2000").items;
    const tasks = call("/api/warehouse/ops").queues.putaway.tasks;
    expect(tasks.length).toBeGreaterThan(0);
    for (const task of tasks) {
      const shelves = positionsForGuard(positions, "", task.customer);
      expect(shelves.length, task.id).toBeGreaterThan(0);
      expect(resolveGuardDestination(shelves[0].code, positions, task.customer)).toEqual({ code: shelves[0].code });
    }
    const blocked = positions.filter((position: { status: string }) => position.status === "blocked");
    expect(blocked).toHaveLength(1);
    expect(resolveGuardDestination(blocked[0].code, positions, CUSTOMER)).toEqual({ problem: "Esta posição está bloqueada." });
  });

  it("restaurar volta ao roteiro original", () => {
    call("/api/client/requests", "POST", { type: "retirada", items: [] });
    call("/api/demo/kits/kit_1", "DELETE");
    call("/api/demo/events/evt_1", "DELETE");
    resetDemoState();
    expect(customerRequests().some((item) => item.request_number === "SOL-121")).toBe(false);
    expect(kits().some((kit) => kit.id === "kit_1")).toBe(true);
    expect(events().some((event) => event.id === "evt_1")).toBe(true);
  });
});
