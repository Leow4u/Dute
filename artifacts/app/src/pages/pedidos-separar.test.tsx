import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

import { itemDaLinhaDeSeparacao } from "@/lib/warehouse-ops/separacao";

/**
 * Pedidos › Separar, a bancada do pedido, pelo caminho de verdade (separação
 * com caixas, partes 2 e 4): a página com as linhas e a tarefa lidas ao vivo
 * no formato que o servidor grava (functions/wms: operations.ts e
 * pick-progress.ts) e o cadastro dos SKUs que as fotos dos itens já leram. O
 * copo tem o tamanho só no campo Tamanho ("475ML"), e não no fim do código
 * do cliente: nem a linha da separação nem o item do volume o gravam. Dados
 * sintéticos.
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
vi.mock("@/lib/auth", () => ({ useAppUser: () => ({ user: { uid: "u_1", publicMetadata: { role: "wms" } }, isLoaded: true }) }));
vi.mock("@/lib/active-customer-context", () => ({ useActiveCustomer: () => ({ code: "BTG", options: [{ code: "BTG", name: "BTG Pactual" }] }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
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

import PaginaPedidosSeparar from "./pedidos-separar";

const CADASTRO = [
  { id: "BTG-000206", cod_btg: "BTG-000206", sku_code: "BTG-000206", sku_code_key: "BTG-000206", cod_cliente: "B.0572.003.U.B", customer_code: "BTG", produto: "Copo Beercup em Inox", tamanho: "475ML", status: "active" },
  { id: "BTG-000125", cod_btg: "BTG-000125", sku_code: "BTG-000125", sku_code_key: "BTG-000125", cod_cliente: "A.01.0806.005.GG", customer_code: "BTG", produto: "Polo Masculino Piquet Preto", tamanho: "GG", status: "active" },
];

/** A linha da separação como o servidor a grava: sem o tamanho. Com o volume, já separada nele. */
function linhaGravada(numero: number, sku: string, codigo: string, nome: string, quantidade: number, volume: string | null) {
  const id = `pli_ord_1_${String(numero).padStart(2, "0")}`;
  return {
    id,
    customer_code: "BTG",
    pick_task_id: "pick_ord_1",
    order_id: "ord_1",
    order_number: "PED-0001",
    line_number: numero,
    sku_code: sku,
    client_item_code: codigo,
    product_name: nome,
    location_id: "B-03",
    client_line_number: numero,
    qty_to_pick: quantidade,
    qty_picked: 0,
    status: "open",
    ...(volume
      ? {
          separated_qty: quantidade,
          separated_at: "2026-11-12T13:10:00.000Z",
          separated_by: { uid: "u_1", name: "Guilherme Dantas" },
          separated_volumes: [{ volume_id: volume, qty: quantidade }],
        }
      : {}),
  };
}

/** O item do volume como a conclusão o grava: também sem o tamanho. */
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

// A polo GG foi para o volume 1, já fechado; o copo está no volume 2, o aberto; a polo G falta separar.
const LINHAS = [
  linhaGravada(1, "BTG-000125", "A.01.0806.005.GG", "Polo Masculino Piquet Preto", 20, "v1"),
  linhaGravada(2, "BTG-000206", "B.0572.003.U.B", "Copo Beercup em Inox", 4, "v2"),
  linhaGravada(3, "BTG-000124", "A.01.0806.005.G", "Polo Masculino Piquet Preto", 10, null),
];
const TAREFA = {
  id: "pick_ord_1",
  customer_code: "BTG",
  order_id: "ord_1",
  status: "in_progress",
  separation_started_at: "2026-11-12T13:00:00.000Z",
  volumes: [
    { id: "v1", number: 1, status: "closed", units: 20, weight_kg: 6.3, closed_at: "2026-11-12T13:20:00.000Z" },
    { id: "v2", number: 2, status: "open", units: 4 },
  ],
};

/** A fila de Pedidos (cloud-api.ts) com a tarefa de separação do pedido; o pedido separado leva a da expedição. */
function filaDePedidos(separado: boolean) {
  const separacao = {
    id: "picking:pick_ord_1",
    reference: "pick_ord_1",
    title: "PED-0001",
    customer_code: "BTG",
    customer_request_id: "creq_1",
    order_id: "ord_1",
    status: separado ? "completed" : "in_progress",
    separation_started_at: "2026-11-12T13:00:00.000Z",
    // O pedido separado já não tem linha por separar.
    items: LINHAS.filter((linha) => !separado || linha.separated_at).map((linha) => itemDaLinhaDeSeparacao(linha.id, linha)),
  };
  const expedicao = { id: "shipping:ship_ord_1", reference: "ship_ord_1", title: "PED-0001", customer_code: "BTG", customer_request_id: "creq_1", order_id: "ord_1", status: "ready_to_dispatch", seal_code: "88231", package_count: 2 };
  return { queues: { picking: { tasks: [separacao] }, ...(separado ? { expedition: { tasks: [expedicao] } } : {}) } };
}

/** O cliente das consultas com a fila e o cadastro que as fotos dos itens leram (a mesma chave do Estoque). */
function cliente(separado = false) {
  const consultas = new QueryClient();
  consultas.setQueryData(["warehouse-ops"], filaDePedidos(separado));
  consultas.setQueryData(["estoque", "skus"], { items: CADASTRO });
  consultas.setQueryData(["stock-balances", "estoque"], { items: [] });
  consultas.setQueryData(["estoque", "products"], { items: [] });
  return consultas;
}

function pagina(consultas: QueryClient) {
  return renderToStaticMarkup(
    <QueryClientProvider client={consultas}>
      <Router ssrPath="/pedidos/separar">
        <PaginaPedidosSeparar />
      </Router>
    </QueryClientProvider>,
  );
}

function documento(html: string) {
  return new JSDOM(`<!doctype html><body>${html}</body>`).window.document;
}

const texto = (elemento: Element) => (elemento.textContent ?? "").replace(/\s+/g, " ").trim();

beforeEach(() => {
  estado.documentos = {
    "pick_tasks/pick_ord_1": TAREFA,
    "customer_requests/creq_1:bancada": { id: "creq_1", due_at: "2026-11-16T14:36:00.000Z" },
  };
  estado.consultas = {
    "pick_lines:pick_ord_1": LINHAS,
    "warehouse_boxes:BTG:guardadas": [],
    "opening_inventory_lines:BTG": [],
  };
});

describe("Pedidos › Separar: o tamanho que mora só no campo Tamanho", () => {
  it("em separação: a linha e o volume aberto mostram o copo com 475ML", () => {
    const tela = documento(pagina(cliente()));
    // As linhas do pedido na prateleira (que fica aberta enquanto falta separar), pela família e pelo tamanho.
    const linhas = [...tela.querySelectorAll("section:not([aria-labelledby]) li p.leading-snug")].map(texto);
    expect(linhas).toEqual(["Copo Beercup em Inox · 475ML", "Polo Masculino Piquet Preto · G", "Polo Masculino Piquet Preto · GG"]);
    // O volume aberto, com o que já está nele.
    const aberto = [...tela.querySelectorAll('section[aria-labelledby="volumes-do-pedido"] ul.flex li')].map(texto);
    expect(aberto).toEqual(["4 × Copo Beercup em Inox · 475ML"]);
  });

  it("depois de concluído: o conteúdo de cada volume leva o copo com 475ML", () => {
    estado.documentos = {
      ...estado.documentos,
      "pick_tasks/pick_ord_1": { ...TAREFA, status: "completed" },
      "orders/ord_1:volumes": { id: "ord_1", order_number: "PED-0001", customer_code: "BTG", destination: "Agência Faria Lima", customer_request_id: "creq_1", status: "EM_EXPEDICAO" },
      "shipments/ship_ord_1:volumes": { id: "ship_ord_1", status: "ready_to_dispatch", seal_code: "88231" },
      "pick_tasks/pick_ord_1:volumes": { ...TAREFA, status: "completed", picking_confirmed_at: "2026-11-12T15:00:00.000Z", advanced_by: { name: "Guilherme Dantas" } },
    };
    estado.consultas = {
      ...estado.consultas,
      "packages:ord_1": [
        { id: "pkg_pack_ord_1_001", order_id: "ord_1", status: "packed", volume_number: 1, packed_units: 20, weight_kg: 6.3, seal_code: "88231", closed_at: "2026-11-12T13:20:00.000Z" },
        { id: "pkg_pack_ord_1_002", order_id: "ord_1", status: "packed", volume_number: 2, packed_units: 4, seal_code: "88231", closed_at: "2026-11-12T15:00:00.000Z" },
      ],
      "package_items:ord_1": [
        itemGravado(1, 1, "BTG-000125", "A.01.0806.005.GG", "Polo Masculino Piquet Preto", 20),
        itemGravado(2, 2, "BTG-000206", "B.0572.003.U.B", "Copo Beercup em Inox", 4),
      ],
    };
    const tela = documento(pagina(cliente(true)));
    const volumes = [...tela.querySelectorAll('section[aria-labelledby="volumes-do-pedido"] li p.truncate')].map(texto);
    expect(volumes).toEqual(["20 × Polo Masculino Piquet Preto · GG", "4 × Copo Beercup em Inox · 475ML"]);
  });
});
