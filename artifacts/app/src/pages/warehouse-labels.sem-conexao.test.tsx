// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Estoque › Etiquetas dos volumes do pedido sem conexão (carregamento v2,
 * parte 13l; a revisão da parte pediu a trava dos textos e o axe dos estados
 * da falta). Os volumes que não chegaram sem conexão dizem o aviso da conexão
 * ("Sem conexão." ou "Reconectando…", com "Tentar de novo"); os lidos ficam,
 * com a faixa "Sem conexão · pedido de 10:42"; o erro do servidor diz a
 * falha no lugar da prévia, com "Tentar de novo", que assina de novo os
 * volumes (parte 13m; antes, o alerta sem a nova tentativa). Só os rótulos
 * da falta entram. Dados sintéticos.
 */

const estado = vi.hoisted(() => ({
  busca: "",
  documentos: {} as Record<string, Record<string, unknown> | null>,
  consultas: {} as Record<string, Array<Record<string, unknown>>>,
  /** Por chave: a falta da escuta. */
  faltas: {} as Record<string, { erro: boolean; falta: "conexao" | "servidor" | null; lidaEm: number | null }>,
  /** As chaves que assinaram de novo. */
  tentativas: [] as string[],
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
// As escutas são as do teste, com a falta de cada uma; a junção das tentativas é a de verdade.
vi.mock("@/lib/operacao/leitura", async (original) => ({
  ...(await original<object>()),
  useLeitura: (chave: string | null, _consulta: unknown, mapear: (id: string, data: Record<string, unknown>) => unknown) => {
    const docs = chave ? estado.consultas[chave] : undefined;
    const falta = (chave && estado.faltas[chave]) || { erro: false, falta: null, lidaEm: null };
    const tentar = () => {
      estado.tentativas.push(String(chave));
      return Promise.resolve();
    };
    return { itens: falta.erro ? null : docs ? docs.map((data) => mapear(String(data.id), data)).filter((item) => item !== null) : null, ...falta, tentando: false, tentar };
  },
  useDocumento: (chave: string | null, _referencia: unknown, mapear: (id: string, data: Record<string, unknown>) => unknown) => {
    const data = chave ? estado.documentos[chave] : undefined;
    const falta = (chave && estado.faltas[chave]) || { erro: false, falta: null, lidaEm: null };
    return { item: falta.erro ? undefined : data === undefined ? undefined : data === null ? null : mapear(String(data.id), data), ...falta, tentando: false, tentar: () => Promise.resolve() };
  },
}));

import { ProvedorDaConexao, type EstadoDaConexao } from "@/lib/carregando/estado-da-conexao";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { conexaoEm } from "@/test/conexao";
import { DEZ_E_QUARENTA_E_DOIS } from "@/test/sem-conexao";
import { textosDaTela } from "@/test/textos";

import WarehouseLabelsPage from "./warehouse-labels";

const CADASTRO = [
  { id: "BTG-000206", cod_btg: "BTG-000206", sku_code: "BTG-000206", sku_code_key: "BTG-000206", cod_cliente: "B.0572.003.U.B", customer_code: "BTG", produto: "Copo Beercup em Inox", tamanho: "475ML", status: "active" },
];

function item(volume: number, linha: number, sku: string, codigo: string, nome: string, quantidade: number) {
  const pacote = `pkg_pack_ord_1_${String(volume).padStart(3, "0")}`;
  return { id: `pki_${pacote}_${String(linha).padStart(2, "0")}`, package_id: pacote, shipment_id: "ship_ord_1", status: "packed", customer_code: "BTG", order_id: "ord_1", order_number: "PED-0001", line_number: linha, sku_code: sku, client_item_code: codigo, product_name: nome, location_id: "B-03", qty_packed: quantidade };
}

let raiz: Root;
let container: HTMLDivElement;
let cliente: QueryClient;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.localStorage.clear();
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ items: CADASTRO }), { status: 200, headers: { "Content-Type": "application/json" } }));
  estado.busca = "pedido=ord_1&volumes=todos";
  estado.faltas = {};
  estado.documentos = {
    "orders/ord_1:volumes": { id: "ord_1", order_number: "PED-0001", customer_code: "BTG", destination: "Agência Faria Lima", customer_request_id: "creq_1", status: "EM_EXPEDICAO" },
    "shipments/ship_ord_1:volumes": { id: "ship_ord_1", status: "ready_to_dispatch", seal_code: "88231" },
    "pick_tasks/pick_ord_1:volumes": { id: "pick_ord_1", status: "completed", separation_started_at: "2026-11-12T13:00:00.000Z", picking_confirmed_at: "2026-11-12T15:00:00.000Z", advanced_by: { name: "Guilherme Dantas" } },
  };
  estado.consultas = {
    "packages:ord_1": [{ id: "pkg_pack_ord_1_001", order_id: "ord_1", status: "packed", volume_number: 1, packed_units: 4, weight_kg: 1.8, seal_code: "88231", closed_at: "2026-11-12T13:20:00.000Z" }],
    "package_items:ord_1": [item(1, 1, "BTG-000206", "B.0572.003.U.B", "Copo Beercup em Inox", 4)],
  };
  cliente = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  cliente.setQueryData(["estoque", "skus"], { items: CADASTRO });
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz.unmount());
  cliente.clear();
  container.remove();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

async function abrirNa(conexao: EstadoDaConexao) {
  await act(async () =>
    raiz.render(
      <ProvedorDaConexao value={conexaoEm(conexao)}>
        <QueryClientProvider client={cliente}>
          <WarehouseLabelsPage />
        </QueryClientProvider>
      </ProvedorDaConexao>,
    ),
  );
  // A página assenta (o cadastro do cache, as escutas do teste): o que ela mostra para de mudar.
  let antes = "";
  await vi.waitFor(
    () => {
      const agora = container.innerHTML;
      const parou = agora === antes;
      antes = agora;
      expect(parou).toBe(true);
    },
    { timeout: 3_000, interval: 20 },
  );
  return container.innerHTML;
}

const ESTADOS = [
  ["sem nada lido, sem conexão", "sem-conexao", { erro: true, falta: "conexao", lidaEm: null }, ["Sem conexão.", "Tentar de novo"]],
  ["sem nada lido, reconectando", "reconectando", { erro: true, falta: "conexao", lidaEm: null }, ["Reconectando…", "Tentar de novo"]],
  ["lidos, sem conexão", "sem-conexao", { erro: false, falta: "conexao", lidaEm: DEZ_E_QUARENTA_E_DOIS }, ["Sem conexão · pedido de 10:42", "Tentar de novo"]],
  ["lidos, reconectando", "reconectando", { erro: false, falta: "conexao", lidaEm: DEZ_E_QUARENTA_E_DOIS }, ["Reconectando…", "· pedido de 10:42", "Tentar de novo"]],
  ["erro do servidor", "conectado", { erro: true, falta: "servidor", lidaEm: null }, ["Não foi possível carregar os volumes do pedido.", "Tentar de novo"]],
] as const;

describe("Estoque › Etiquetas dos volumes, nos estados da falta", () => {
  for (const [nome, conexao, falta, novos] of ESTADOS) {
    it(nome, async () => {
      const emDia = new Set(textosDaTela(await abrirNa("conectado")));
      act(() => raiz.render(<></>));
      estado.faltas = { "packages:ord_1": { ...falta } };
      const html = await abrirNa(conexao);
      // Sem os volumes, a página mostra o que já mostrava antes da parte: o caminho de volta e a contagem vazia.
      const daPaginaSemVolumes = (texto: string) => texto === "Pedidos" || texto === "0 etiquetas · 0 folhas";
      expect(textosDaTela(html).filter((texto) => !emDia.has(texto) && !daPaginaSemVolumes(texto))).toEqual(novos);
      // Só o erro do servidor é alerta: a falta de conexão não fala (momento 8).
      expect(container.querySelectorAll('[role="alert"]').length).toBe(falta.falta === "servidor" ? 1 : 0);
      expect(await violacoesDeAcessibilidade(html)).toEqual([]);
    });
  }
});

describe("Estoque › Etiquetas dos volumes, o erro do servidor (parte 13m)", () => {
  it("o Tentar de novo da falha assina de novo os volumes que não chegaram", async () => {
    estado.faltas = { "packages:ord_1": { erro: true, falta: "servidor", lidaEm: null } };
    estado.tentativas = [];
    await abrirNa("conectado");
    const botao = [...container.querySelectorAll("button")].find((candidato) => candidato.textContent === "Tentar de novo");
    expect(botao, "o Tentar de novo da falha").toBeDefined();
    await act(async () => botao!.click());
    await vi.waitFor(() => expect(estado.tentativas).toContain("packages:ord_1"), { timeout: 3_000 });
  });
});
