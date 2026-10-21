import { fetchJson } from "@/lib/warehouse-ops/model";

type WarehousePage<T> = {
  items: T[];
  has_more: boolean;
  next_cursor?: string | null;
  partial?: boolean;
};

/**
 * Uma estimativa de ocupação precisa de todas as caixas e posições.
 * Mantém filtros/cliente em cada página e falha se não puder completar a leitura.
 */
export async function fetchWarehouseRows<T>(url: string): Promise<T[]> {
  const rows: T[] = [];
  const cursors = new Set<string>();
  const identities = new Set<string>();
  let nextUrl = url;
  while (true) {
    const page = await fetchJson<WarehousePage<T>>(nextUrl);
    if (!page || !Array.isArray(page.items) || typeof page.has_more !== "boolean" || page.partial) {
      throw new Error("Não foi possível carregar a lista completa do armazém.");
    }
    for (const item of page.items) {
      if (item && typeof item === "object") {
        const row = item as Record<string, unknown>;
        const id = typeof row.id === "string" ? row.id : typeof row.code === "string" ? row.code : null;
        if (id) {
          if (identities.has(id)) throw new Error("A lista do armazém mudou durante a leitura. Atualize e tente novamente.");
          identities.add(id);
        }
      }
      rows.push(item);
    }
    if (!page.has_more) return rows;
    const cursor = page.next_cursor;
    if (typeof cursor !== "string" || !cursor || cursors.has(cursor)) {
      throw new Error("Não foi possível carregar todas as páginas do armazém.");
    }
    cursors.add(cursor);
    const parsed = new URL(url, "https://warehouse.invalid");
    parsed.searchParams.set("cursor", cursor);
    nextUrl = `${parsed.pathname}${parsed.search}`;
  }
}
