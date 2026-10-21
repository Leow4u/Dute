import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchJson } from "@/lib/warehouse-ops/model";
import { fetchWarehouseRows } from "./warehouse-rows";

vi.mock("@/lib/warehouse-ops/model", () => ({ fetchJson: vi.fn() }));
const read = vi.mocked(fetchJson);

beforeEach(() => read.mockReset());

describe("leitura completa do armazém", () => {
  it("percorre páginas sem perder cliente, limite ou cursor com caracteres especiais", async () => {
    read.mockResolvedValueOnce({ items: [{ id: "1" }], has_more: true, next_cursor: "next+/=" });
    read.mockResolvedValueOnce({ items: [{ id: "2" }], has_more: false, next_cursor: null });
    const url = "/api/warehouse/boxes?customer_code=Cliente%20A&limit=5000";
    expect(await fetchWarehouseRows(url)).toEqual([{ id: "1" }, { id: "2" }]);
    const next = new URL(String(read.mock.calls[1]?.[0]), "https://test.invalid");
    expect(next.searchParams.get("customer_code")).toBe("Cliente A");
    expect(next.searchParams.get("limit")).toBe("5000");
    expect(next.searchParams.get("cursor")).toBe("next+/=");
  });

  it("aceita lista vazia somente quando a leitura terminou", async () => {
    read.mockResolvedValueOnce({ items: [], has_more: false });
    expect(await fetchWarehouseRows("/api/warehouse/positions")).toEqual([]);
  });

  it.each([
    { items: [], has_more: true },
    { items: [], has_more: true, next_cursor: "" },
    { items: [], has_more: false, partial: true },
    { items: [] },
    [],
  ])("recusa leitura sem completude ou continuação válida", async (page) => {
    read.mockResolvedValueOnce(page);
    await expect(fetchWarehouseRows("/api/warehouse/boxes")).rejects.toThrow();
  });

  it("interrompe cursores repetidos", async () => {
    read.mockResolvedValue({ items: [], has_more: true, next_cursor: "same" });
    await expect(fetchWarehouseRows("/api/warehouse/boxes")).rejects.toThrow("páginas");
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("não duplica caixas quando a lista muda entre páginas", async () => {
    read.mockResolvedValueOnce({ items: [{ code: "CX-000001" }], has_more: true, next_cursor: "next" });
    read.mockResolvedValueOnce({ items: [{ code: "CX-000001" }], has_more: false });
    await expect(fetchWarehouseRows("/api/warehouse/boxes")).rejects.toThrow("mudou durante a leitura");
  });

  it("propaga falha na página seguinte em vez de devolver ocupação parcial", async () => {
    read.mockResolvedValueOnce({ items: [{ id: "1" }], has_more: true, next_cursor: "next" });
    read.mockRejectedValueOnce(new Error("consulta indisponível"));
    await expect(fetchWarehouseRows("/api/warehouse/boxes")).rejects.toThrow("consulta indisponível");
  });
});
