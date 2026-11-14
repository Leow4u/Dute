import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

/**
 * Pedidos › Romaneio pelo caminho de verdade (separação com caixas, parte
 * 4c): a página com os volumes lidos pelo useVolumesDoPedido, os
 * `packages` e `package_items` no formato que a conclusão grava
 * (functions/wms, operations.ts) e o cadastro dos SKUs como /api/skus o
 * devolve. O copo tem o tamanho só no campo Tamanho ("475ML"), e não no fim
 * do código do cliente: o item do volume não o grava. Dados sintéticos.
 */

const estado = vi.hoisted(() => ({
  /** Os documentos ao vivo, pela chave da leitura; null quando não existe. */
  documentos: {} as Record<string, Record<string, unknown> | null>,
  /** As consultas ao vivo, pela chave da leitura. */
  consultas: {} as Record<string, Array<Record<string, unknown>>>,
}));

vi.mock("wouter", async (original) => ({
  ...(await original<typeof import("wouter")>()),
  useSearch: () => "pedido=ord_1",
}));
vi.mock("@/lib/active-customer-context", () => ({ useActiveCustomer: () => ({ code: "BTG", options: [{ code: "BTG", name: "BTG Pactual" }] }) }));
// O Firestore ao vivo devolve os documentos gravados; o mapeamento é o da tela.
vi.mock("@/lib/operacao/leitura", () => ({
  useLeitura: (chave: string | null, _consulta: unknown, mapear: (id: string, data: Record<string, unknown>) => unknown) => {
    const docs = chave ? estado.consultas[chave] : undefined;
    return { itens: docs ? docs.map((data) => mapear(String(data.id), data)).filter((item) => item !== null) : null, erro: false };
  },
  useDocumento: (chave: string | null, _referencia: unknown, mapear: (id: string, data: Record<string, unknown>) => unknown) => {
    const data = chave ? estado.documentos[chave] : undefined;
    return { item: data === undefined ? undefined : data === null ? null : mapear(String(data.id), data), erro: false };
  },
}));

import PaginaPedidosRomaneio from "./pedidos-romaneio";

const CADASTRO = [
  { id: "BTG-000206", cod_btg: "BTG-000206", sku_code: "BTG-000206", sku_code_key: "BTG-000206", cod_cliente: "B.0572.003.U.B", customer_code: "BTG", produto: "Copo Beercup em Inox", tamanho: "475ML", status: "active" },
  { id: "BTG-000125", cod_btg: "BTG-000125", sku_code: "BTG-000125", sku_code_key: "BTG-000125", cod_cliente: "A.01.0806.005.GG", customer_code: "BTG", produto: "Polo Masculino Piquet Preto", tamanho: "GG", status: "active" },
];

/** O item do volume como a conclusão o grava: sem o tamanho. */
function itemGravado(volume: number, linha: number, sku: string, codigo: string, nome: string, quantidade: number) {
  const pacote = `pkg_pack_ord_1_${String(volume).padStart(3, "0")}`;
  return {
    id: `pki_${pacote}_${String(linha).padStart(2, "0")}`,
    package_id: pacote,
    shipment_id: "ship_ord_1",
    status: "packed",
    customer_code: "BTG",
    order_id: "ord_1",
    order_number: "PED-0001",
    line_number: linha,
    sku_code: sku,
    client_item_code: codigo,
    product_name: nome,
    location_id: "B-03",
    qty_packed: quantidade,
  };
}

beforeEach(() => {
  estado.documentos = {
    "orders/ord_1:volumes": { id: "ord_1", order_number: "PED-0001", customer_code: "BTG", destination: "Agência Faria Lima", customer_request_id: "creq_1", status: "EM_EXPEDICAO" },
    "shipments/ship_ord_1:volumes": { id: "ship_ord_1", status: "ready_to_dispatch", seal_code: "88231" },
    "pick_tasks/pick_ord_1:volumes": {
      id: "pick_ord_1",
      status: "completed",
      separation_started_at: "2026-11-12T13:00:00.000Z",
      picking_confirmed_at: "2026-11-12T15:00:00.000Z",
      advanced_by: { name: "Guilherme Dantas" },
    },
    "customer_requests/creq_1:romaneio": { id: "creq_1", due_at: "2026-11-16T14:36:00.000Z" },
  };
  estado.consultas = {
    "packages:ord_1": [
      { id: "pkg_pack_ord_1_001", order_id: "ord_1", status: "packed", volume_number: 1, packed_units: 4, weight_kg: 1.8, seal_code: "88231", closed_at: "2026-11-12T13:20:00.000Z" },
      { id: "pkg_pack_ord_1_002", order_id: "ord_1", status: "packed", volume_number: 2, packed_units: 20, seal_code: "88231", closed_at: "2026-11-12T15:00:00.000Z" },
    ],
    "package_items:ord_1": [
      itemGravado(1, 1, "BTG-000206", "B.0572.003.U.B", "Copo Beercup em Inox", 4),
      itemGravado(2, 2, "BTG-000125", "A.01.0806.005.GG", "Polo Masculino Piquet Preto", 20),
    ],
  };
});

function pagina(cliente: QueryClient) {
  return renderToStaticMarkup(
    <QueryClientProvider client={cliente}>
      <Router ssrPath="/pedidos/romaneio">
        <PaginaPedidosRomaneio />
      </Router>
    </QueryClientProvider>,
  );
}

/** Os produtos de cada volume na tabela do romaneio: o Conteúdo e o Código de cada linha. */
function produtosDaFolha(html: string): string[][] {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
  const linhas = [...dom.window.document.querySelectorAll("tbody tr")].map((linha) => {
    // A célula vazia da segunda linha em diante do volume fica de fora.
    const [conteudo, codigo] = [...linha.querySelectorAll("td")].map((celula) => (celula.textContent ?? "").replace(/\s+/g, " ").trim()).filter(Boolean);
    return [conteudo ?? "", codigo ?? ""];
  });
  dom.window.close();
  return linhas;
}

describe("Pedidos › Romaneio: o tamanho que mora só no campo Tamanho", () => {
  it("o pedido concluído mostra o copo com 475ML, ao lado do código do cliente", () => {
    const cliente = new QueryClient();
    // O cadastro que a fila de Pedidos e a bancada já leram (as fotos dos itens).
    cliente.setQueryData(["estoque", "skus"], { items: CADASTRO });
    expect(produtosDaFolha(pagina(cliente))).toEqual([
      ["Copo Beercup em Inox · 475ML", "B.0572.003.U.B"],
      ["Polo Masculino Piquet Preto · GG", "A.01.0806.005.GG"],
    ]);
  });

  it("enquanto o cadastro não chega, o romaneio espera: não sai sem o tamanho", () => {
    const html = pagina(new QueryClient());
    expect(produtosDaFolha(html)).toEqual([]);
    // A espera do carregamento v2: a região está na tela desde 0 ms, e o rótulo ("Carregando o pedido…") entra aos 300 ms.
    expect(html).toContain("data-carregando-na-regiao");
  });
});
