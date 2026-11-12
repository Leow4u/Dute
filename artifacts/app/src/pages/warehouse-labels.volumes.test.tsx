// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SAIDA_GUARDADA } from "@/lib/warehouse-labels";

/**
 * Estoque › Etiquetas, as do volume do pedido (separação com caixas, parte
 * 4c), pelo caminho de verdade: a página com os volumes lidos pelo
 * useVolumesDoPedido, os documentos no formato que o servidor grava
 * (functions/wms: operations.ts e pick-progress.ts) e o cadastro dos SKUs
 * como /api/skus o devolve. O copo tem o tamanho só no campo Tamanho
 * ("475ML"), e não no fim do código do cliente: nem a linha da separação nem
 * o item do volume o gravam. Dados sintéticos.
 */

const estado = vi.hoisted(() => ({
  busca: "",
  /** Os documentos ao vivo, pela chave da leitura; null quando não existe. */
  documentos: {} as Record<string, Record<string, unknown> | null>,
  /** As consultas ao vivo, pela chave da leitura. */
  consultas: {} as Record<string, Array<Record<string, unknown>>>,
}));

vi.mock("wouter", async (original) => ({
  ...(await original<typeof import("wouter")>()),
  useSearch: () => estado.busca,
  useLocation: () => ["/estoque/etiquetas", vi.fn()],
}));
vi.mock("@/lib/active-customer-context", () => ({ useActiveCustomer: () => ({ code: "BTG", options: [{ code: "BTG", name: "BTG Pactual" }] }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/features/warehouse-ops/opening-inventory-status", () => ({
  useOpeningInventorySession: () => ({ data: { session_id: "sessao-1", lines: [] }, isLoading: false, error: null }),
}));
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

import WarehouseLabelsPage from "./warehouse-labels";

const CADASTRO = [
  { id: "BTG-000206", cod_btg: "BTG-000206", sku_code: "BTG-000206", sku_code_key: "BTG-000206", cod_cliente: "B.0572.003.U.B", customer_code: "BTG", produto: "Copo Beercup em Inox", tamanho: "475ML", status: "active" },
  { id: "BTG-000125", cod_btg: "BTG-000125", sku_code: "BTG-000125", sku_code_key: "BTG-000125", cod_cliente: "A.01.0806.005.GG", customer_code: "BTG", produto: "Polo Masculino Piquet Preto", tamanho: "GG", status: "active" },
];

const PEDIDO = { id: "ord_1", order_number: "PED-0001", customer_code: "BTG", destination: "Agência Faria Lima", customer_request_id: "creq_1", status: "SEPARACAO" };
const VOLUMES_DA_TAREFA = [
  { id: "v1", number: 1, status: "closed", units: 4, weight_kg: 1.8, closed_at: "2026-11-12T13:20:00.000Z" },
  { id: "v2", number: 2, status: "open", units: 20 },
];

/** A linha da separação como o servidor a grava: sem o tamanho. */
function linhaGravada(numero: number, sku: string, codigo: string, nome: string, quantidade: number, volume: string) {
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
    separated_qty: quantidade,
    separated_at: "2026-11-12T13:10:00.000Z",
    separated_by: { uid: "u_1", name: "Guilherme Dantas" },
    separated_volumes: [{ volume_id: volume, qty: quantidade }],
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

function emSeparacao() {
  estado.documentos = {
    "orders/ord_1:volumes": PEDIDO,
    "shipments/ship_ord_1:volumes": null,
    "pick_tasks/pick_ord_1:volumes": { id: "pick_ord_1", status: "in_progress", separation_started_at: "2026-11-12T13:00:00.000Z", volumes: VOLUMES_DA_TAREFA },
  };
  estado.consultas = {
    "pick_lines:pick_ord_1:volumes": [
      linhaGravada(1, "BTG-000206", "B.0572.003.U.B", "Copo Beercup em Inox", 4, "v1"),
      linhaGravada(2, "BTG-000125", "A.01.0806.005.GG", "Polo Masculino Piquet Preto", 20, "v2"),
    ],
  };
}

function concluido() {
  estado.documentos = {
    "orders/ord_1:volumes": { ...PEDIDO, status: "EM_EXPEDICAO" },
    "shipments/ship_ord_1:volumes": { id: "ship_ord_1", status: "ready_to_dispatch", seal_code: "88231" },
    "pick_tasks/pick_ord_1:volumes": {
      id: "pick_ord_1",
      status: "completed",
      separation_started_at: "2026-11-12T13:00:00.000Z",
      picking_confirmed_at: "2026-11-12T15:00:00.000Z",
      advanced_by: { name: "Guilherme Dantas" },
      volumes: VOLUMES_DA_TAREFA.map((volume) => ({ ...volume, status: "closed" })),
    },
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
}

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
/** As URLs que a página pediu ao fetch (o cadastro, quando não está no cache). */
let pedidas: string[];

/** O cadastro dos SKUs pelo fetch, como o /api/skus responde; com `falha`, a leitura falha. */
function cadastroPeloFetch(falha = false) {
  vi.stubGlobal("fetch", async (url: string) => {
    pedidas.push(String(url));
    if (falha || !String(url).startsWith("/api/skus?")) return new Response("indisponível", { status: 503 });
    return new Response(JSON.stringify({ items: CADASTRO }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
}

async function abrir(busca: string) {
  estado.busca = busca;
  await act(async () => root.render(<QueryClientProvider client={client}><WarehouseLabelsPage /></QueryClientProvider>));
  for (let tentativa = 0; tentativa < 60 && !container.querySelector(".lbl-print"); tentativa += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
  expect(container.querySelector(".lbl-print"), "a prévia das etiquetas").not.toBeNull();
}

/** Na folha A4, cada produto como as duas partes da linha o mostram: o nome, que encurta, e o tamanho, que fica. */
const linhasDaFolha = () =>
  [...container.querySelectorAll(".lbl-folha .lbl-line")].map((linha) => [...linha.querySelectorAll("span")].map((parte) => parte.textContent));
/** No rolo, cada produto numa linha só. */
const linhasDoRolo = () => [...container.querySelectorAll(".lbl-roll .lbl-line")].map((linha) => linha.textContent?.replace(/\s+/g, " ").trim());

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.localStorage.clear();
  pedidas = [];
  cadastroPeloFetch();
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  client.clear();
  container.remove();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("Estoque › Etiquetas: o volume com o tamanho que mora só no campo Tamanho", () => {
  it("em separação, com o cadastro que a bancada já leu: a folha A4 mostra o nome e, à parte, 475ML", async () => {
    emSeparacao();
    // As fotos da bancada leram o cadastro: a etiqueta usa o mesmo, sem ler de novo.
    client.setQueryData(["estoque", "skus"], { items: CADASTRO });
    await abrir("pedido=ord_1&volumes=1");
    expect(linhasDaFolha()).toEqual([["Copo Beercup em Inox", " · 475ML"]]);
    expect(pedidas).toEqual([]);
  });

  it("no rolo da Zebra, a linha do volume leva o nome com 475ML e, depois, o código do cliente", async () => {
    emSeparacao();
    client.setQueryData(["estoque", "skus"], { items: CADASTRO });
    window.localStorage.setItem(SAIDA_GUARDADA, "zebra");
    await abrir("pedido=ord_1&volumes=1");
    expect(linhasDoRolo()).toEqual(["4 × Copo Beercup em Inox · 475ML · B.0572.003.U.B"]);
  });

  it("depois de concluído, aberta direto: a página lê o cadastro e todos os volumes saem com o tamanho", async () => {
    concluido();
    await abrir("pedido=ord_1&volumes=todos");
    expect(pedidas).toEqual(["/api/skus?limit=2000"]);
    expect(linhasDaFolha()).toEqual([
      ["Copo Beercup em Inox", " · 475ML"],
      // O tamanho do fim do código continua o do código.
      ["Polo Masculino Piquet Preto", " · GG"],
    ]);
  });

  it("se a leitura do cadastro falha, as etiquetas saem como antes, sem o tamanho do campo", async () => {
    concluido();
    pedidas = [];
    cadastroPeloFetch(true);
    await abrir("pedido=ord_1&volumes=todos");
    expect(linhasDaFolha()).toEqual([["Copo Beercup em Inox"], ["Polo Masculino Piquet Preto", " · GG"]]);
  });
});
