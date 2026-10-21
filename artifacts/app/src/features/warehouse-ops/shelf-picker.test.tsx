import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { WarehousePosition } from "@/lib/warehouse-positions";
import { ShelfPicker, eligibleShelfPositions, isCurrentShelfPreview } from "./shelf-picker";

function position(code: string, overrides: Partial<WarehousePosition> = {}): WarehousePosition {
  return {
    id: code, code, aisle: "A", shelf: 1,
    length_m: 1.2, depth_m: 0.7, height_m: 1,
    customer_code: "CLIENTE-A", status: "active", ...overrides,
  };
}

describe("prateleiras cadastradas para a guarda", () => {
  it("oferece somente posições existentes, ativas e da zona do cliente", () => {
    const active = position("A-03", { sequence: 3 });
    const earlier = position("A-02", { sequence: 2 });
    const rows = [
      active,
      position("A-01", { status: "blocked" }),
      position("A-04", { status: "review" }),
      position("B-01", { customer_code: "CLIENTE-B" }),
      position("C-01", { customer_code: null }),
      position("", { id: "missing-code" }),
      earlier,
    ];
    expect(eligibleShelfPositions(rows, "CLIENTE-A")).toEqual([earlier, active]);
    expect(eligibleShelfPositions(rows, "")).toEqual([]);
    expect(rows[0]).toBe(active);
  });

  it("mostra seleção apenas quando o código ainda pertence à lista cadastrada", () => {
    const rows = [position("A-03")];
    const selected = renderToStaticMarkup(<ShelfPicker positions={rows} value="A-03" onSelect={() => undefined} />);
    expect(selected).toContain("A-03");
    expect(selected).toContain('role="combobox"');
    const unknown = renderToStaticMarkup(<ShelfPicker positions={rows} value="A-INVENTADA" onSelect={() => undefined} />);
    expect(unknown).not.toContain("A-INVENTADA");
    expect(unknown).toContain("Selecione uma prateleira");
  });

  it("indica carregamento e ausência de cadastro sem permitir criação livre", () => {
    const loading = renderToStaticMarkup(<ShelfPicker positions={[]} value="" loading onSelect={() => undefined} />);
    expect(loading).toContain("Carregando prateleiras");
    expect(loading).toMatch(/<button[^>]*disabled=""/);
    const empty = renderToStaticMarkup(<ShelfPicker positions={[]} value="" onSelect={() => undefined} />);
    expect(empty).toContain("Nenhuma prateleira ativa cadastrada");
    expect(empty).not.toContain("Criar prateleira");
  });
});

describe("respostas da prévia física", () => {
  it("descarta resposta anterior a uma troca de seleção ou modo", () => {
    expect(isCurrentShelfPreview({ generation: 1, contextKey: "caixa-a" }, { generation: 2, contextKey: "caixa-a" })).toBe(false);
  });

  it("descarta resposta de outro cliente, caixa, revisão ou medidas mesmo na mesma geração", () => {
    expect(isCurrentShelfPreview({ generation: 2, contextKey: "cliente-a:caixa-1:60x35x20" }, { generation: 2, contextKey: "cliente-b:caixa-2:80x40x30" })).toBe(false);
    expect(isCurrentShelfPreview({ generation: 2, contextKey: "atual" }, { generation: 2, contextKey: "atual" })).toBe(true);
  });
});
