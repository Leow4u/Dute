// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A célula do produto nas Movimentações segue o padrão do nome (06/11/2026):
 * o movimento que traz o código do cliente mostra o nome com o tamanho depois
 * do ponto; o que não traz fica como veio. O `cod_cliente` do movimento é o
 * cliente, não o código do item.
 */

const estado = vi.hoisted(() => ({ itens: [] as Array<Record<string, unknown>> }));

vi.mock("@workspace/api-client-react", () => ({
  useCreateMovement: () => ({ mutate: vi.fn(), isPending: false }),
  useListMovements: () => ({ data: { items: estado.itens, total: estado.itens.length }, isLoading: false }),
  getListMovementsQueryKey: (params: unknown) => ["/api/movements", params],
}));

vi.mock("@/lib/auth", () => ({
  useAppUser: () => ({ user: { uid: "op-1", fullName: "Operador", publicMetadata: { role: "interno" } }, isLoaded: true }),
}));

vi.mock("@/lib/active-customer-context", () => ({
  useActiveCustomer: () => ({ code: "BTG Pactual", isLoading: false }),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));

import Movements, { produtoDoMovimento } from "./movements";

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  container?.remove();
  raiz = null;
  container = null;
  estado.itens = [];
});

describe("o produto do movimento", () => {
  it("com o código do cliente, o nome com o tamanho depois do ponto, antes e depois da limpeza dos nomes", () => {
    expect(produtoDoMovimento({ produto: "Polo masculino piquet preto - XG", client_item_code: "A.01.0806.005.XG" })).toBe("Polo masculino piquet preto · XG");
    expect(produtoDoMovimento({ produto: "Polo Masculino Piquet Preto", client_item_code: "A.01.0806.005.XG" })).toBe("Polo Masculino Piquet Preto · XG");
    expect(produtoDoMovimento({ produto: "Calça Social Masculino Preta 42", client_item_code: " A.01.0712.001.42 " })).toBe("Calça Social Masculino Preta · 42");
    // Tamanho único e código sem tamanho: só o nome.
    expect(produtoDoMovimento({ produto: "Boné BTG U", client_item_code: "A.05.0101.001.U" })).toBe("Boné BTG");
    expect(produtoDoMovimento({ produto: "Caneca BTG 300 ml", client_item_code: "A.09.0001.002" })).toBe("Caneca BTG 300 ml");
  });

  it("sem o código do cliente, ou sem o nome, fica como veio", () => {
    expect(produtoDoMovimento({ produto: "Polo feminina piquet azul marinho PP" })).toBe("Polo feminina piquet azul marinho PP");
    expect(produtoDoMovimento({ produto: "Polo preto XG", client_item_code: "  " })).toBe("Polo preto XG");
    expect(produtoDoMovimento({ produto: "", client_item_code: "A.01.0806.005.XG" })).toBe("");
  });

  it("a tabela e a lista do celular mostram o produto assim", async () => {
    estado.itens = [
      {
        id: 1,
        data: "2026-11-05T13:00:00.000Z",
        tipo_mov: "ENTRADA",
        cod_sku: "BTG-000126",
        produto: "Polo masculino piquet preto - XG",
        qtde: 15,
        sinal: 1,
        cod_cliente: "BTG Pactual",
        client_item_code: "A.01.0806.005.XG",
      },
      {
        id: 2,
        data: "2026-11-05T12:00:00.000Z",
        tipo_mov: "AJUSTE_SAIDA",
        cod_sku: "BTG-000101",
        produto: "Polo feminina piquet azul marinho PP",
        qtde: 5,
        sinal: -1,
        cod_cliente: "BTG Pactual",
      },
    ];
    await act(async () =>
      raiz!.render(
        <QueryClientProvider client={new QueryClient()}>
          <Movements embedded />
        </QueryClientProvider>,
      ),
    );

    const esperado = ["Polo masculino piquet preto · XG", "Polo feminina piquet azul marinho PP"];
    const celulas = [...container!.querySelectorAll("td[title]")];
    expect(celulas.map((celula) => celula.textContent)).toEqual(esperado);
    expect(celulas.map((celula) => celula.getAttribute("title"))).toEqual(esperado);
    expect([...container!.querySelectorAll("li span[title]")].map((nome) => nome.textContent)).toEqual(esperado);
    expect(container!.textContent).not.toContain("piquet preto - XG");
  });
});
