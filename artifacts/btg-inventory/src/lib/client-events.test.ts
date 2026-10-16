import { describe, expect, it } from "vitest";

import {
  cartFromEvent,
  eventDateFromDueAt,
  eventDateLabel,
  eventDestination,
  eventDueAt,
  eventNotes,
  eventPiecesValue,
  eventShortages,
  productForEventItem,
  sortEvents,
  type ClientEvent,
  type EventStockProduct,
} from "./client-events";
import { functionRoute } from "./functions-api";

const today = new Date(2026, 9, 16, 10, 0);

const products: EventStockProduct[] = [
  { key: "balcao-a", sku: "SKU1", clientItemCode: "K.01.A", available: 1, total: 1, value: 1000 },
  { key: "balcao-b", sku: "SKU1", clientItemCode: "K.01.B", available: 5, total: 5, value: 5000 },
  { key: "totem", sku: "SKU2", clientItemCode: null, available: 10, total: 12, value: 0 },
];

function event(overrides: Partial<ClientEvent> = {}): ClientEvent {
  return {
    id: "cev_1",
    name: "Feira de Investimentos",
    description: null,
    venue: "Expo Center Norte",
    address: "Rua José Bernardo Pinto, 333",
    next_date: "2026-11-20",
    schedule: "Montagem na véspera",
    logistics: "1 caminhão baú",
    items: [
      { sku_code: "SKU1", client_item_code: "K.01.A", product_name: "Balcão A", quantity: 2 },
      { sku_code: "SKU2", client_item_code: null, product_name: "Totem", quantity: 4 },
    ],
    ...overrides,
  };
}

describe("eventos do portal", () => {
  it("a linha casa pelo código do cliente; sem ele, pelo SKU com mais saldo", () => {
    expect(productForEventItem(event().items[0]!, products)?.key).toBe("balcao-a");
    expect(productForEventItem({ sku_code: "SKU1", client_item_code: null, product_name: "Balcão", quantity: 1 }, products)?.key).toBe("balcao-b");
    expect(productForEventItem({ sku_code: "SKU9", client_item_code: null, product_name: "Sumiu", quantity: 1 }, products)).toBeUndefined();
  });

  it("aponta o que falta no saldo livre, somando linhas do mesmo produto", () => {
    expect(eventShortages(event(), products)).toEqual([{ name: "Balcão A", need: 2, have: 1 }]);
    const repeated = event({
      items: [
        { sku_code: "SKU2", client_item_code: null, product_name: "Totem", quantity: 6 },
        { sku_code: "SKU2", client_item_code: null, product_name: "Totem", quantity: 6 },
        { sku_code: "SKU9", client_item_code: null, product_name: "Sumiu", quantity: 1 },
      ],
    });
    expect(eventShortages(repeated, products)).toEqual([
      { name: "Totem", need: 12, have: 10 },
      { name: "Sumiu", need: 1, have: 0 },
    ]);
  });

  it("carrinho leva até o saldo livre e lista o que não coube", () => {
    expect(cartFromEvent(event(), products)).toEqual({ cart: { "balcao-a": 1, totem: 4 }, missing: ["Balcão A"] });
  });

  it("valor das peças pelo custo médio; item sem custo não soma", () => {
    expect(eventPiecesValue(event(), products)).toBe(2000);
  });

  it("entrega na véspera às 7h; evento de hoje ou passado não preenche", () => {
    expect(eventDueAt("2026-11-20", today)).toBe("2026-11-19T07:00");
    expect(eventDueAt("2026-11-01", today)).toBe("2026-10-31T07:00");
    expect(eventDueAt("2026-10-16", today)).toBe("");
    expect(eventDueAt("2026-09-01", today)).toBe("");
    expect(eventDueAt(null, today)).toBe("");
    expect(eventDueAt("2026-02-30", today)).toBe("");
  });

  it("salvar a partir do pedido: o evento é no dia seguinte à entrega", () => {
    expect(eventDateFromDueAt("2026-11-19T07:00")).toBe("2026-11-20");
    expect(eventDateFromDueAt("2026-12-31T10:00")).toBe("2027-01-01");
    expect(eventDateFromDueAt("")).toBe("");
  });

  it("próximos primeiro, pela data; depois os sem data ou passados, pelo nome", () => {
    const sorted = sortEvents(
      [
        event({ name: "Zeta", next_date: null }),
        event({ name: "Passado", next_date: "2026-01-10" }),
        event({ name: "Dezembro", next_date: "2026-12-01" }),
        event({ name: "Hoje", next_date: "2026-10-16" }),
        event({ name: "Alfa", next_date: null }),
      ],
      today,
    );
    expect(sorted.map((item) => item.name)).toEqual(["Hoje", "Dezembro", "Alfa", "Passado", "Zeta"]);
  });

  it("rótulo curto da data, com o ano só quando não é o deste", () => {
    expect(eventDateLabel("2026-11-20", today)).toBe("20 nov");
    expect(eventDateLabel("2027-01-05", today)).toBe("05 jan 2027");
    expect(eventDateLabel(null, today)).toBeNull();
  });

  it("destino e observações do pedido vêm do local e da montagem", () => {
    expect(eventDestination(event())).toBe("Expo Center Norte · Rua José Bernardo Pinto, 333");
    expect(eventDestination(event({ address: null }))).toBe("Expo Center Norte");
    expect(eventNotes(event())).toBe("Montagem na véspera · 1 caminhão baú");
    expect(eventNotes(event({ schedule: null, logistics: "  " }))).toBe("");
  });

  it("as rotas da tela chamam as callables dos eventos", async () => {
    expect(functionRoute("/api/client/events", "GET")?.name).toBe("listClientEventTemplates");
    expect(functionRoute("/api/client/events", "POST")?.name).toBe("saveClientEventTemplate");
    const archive = functionRoute("/api/client/events/cev_1/archive", "POST");
    expect(archive?.name).toBe("archiveClientEventTemplate");
    expect(await archive?.payload("/api/client/events/cev_1/archive")).toEqual({ id: "cev_1" });
  });
});
