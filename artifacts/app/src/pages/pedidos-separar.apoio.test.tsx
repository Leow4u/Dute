// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

/**
 * A bancada de Separar com a leitura de apoio que não chegou (carregamento
 * v2, parte 13m). Antes, as caixas, os volumes (a tarefa) e o prazo que não
 * chegavam sem conexão e sem hora deixavam só o "Sem conexão." genérico acima
 * da bancada, sem dizer o que faltava; com o pedido lido (a faixa com a hora)
 * ou com a recusa do servidor, nada dizia. Agora a frase diz o que não
 * chegou, na voz do romaneio e da lista ("Não foi possível carregar as caixas
 * e o prazo do pedido."), em qualquer falta, e o aviso da conexão (ou a
 * faixa) diz por quê. Dados sintéticos.
 */

const estado = vi.hoisted(() => ({
  documentos: {} as Record<string, Record<string, unknown> | null>,
  consultas: {} as Record<string, Array<Record<string, unknown>>>,
  /** Por chave: a falta da escuta. */
  faltas: {} as Record<string, { erro: boolean; falta: "conexao" | "servidor" | null; lidaEm: number | null }>,
}));

vi.mock("@/lib/auth", () => ({ useAppUser: () => ({ user: { uid: "u-1", fullName: "Guilherme Dantas", publicMetadata: { role: "admin" } }, isLoaded: true }) }));
vi.mock("@/lib/active-customer-context", () => ({ useActiveCustomer: () => ({ options: [{ code: "BTG", name: "BTG Pactual" }], code: "BTG", isLoading: false }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));
vi.mock("@/lib/use-item-photos", () => ({ useItemPhotos: () => () => null, useCatalogoDeSkus: () => ({ data: { items: [] }, isError: false, isPending: false }) }));
// As escutas são as do teste, com a falta de cada uma; a junção das tentativas é a de verdade.
vi.mock("@/lib/operacao/leitura", async (original) => ({
  ...(await original<object>()),
  useLeitura: (chave: string | null, _consulta: unknown, mapear: (id: string, data: Record<string, unknown>) => unknown) => {
    const docs = chave ? estado.consultas[chave] : undefined;
    const falta = (chave && estado.faltas[chave]) || { erro: false, falta: null, lidaEm: null };
    return {
      itens: falta.erro ? null : docs ? docs.map((data) => mapear(String(data.id), data)).filter((item) => item !== null) : null,
      ...falta,
      tentando: false,
      tentar: () => Promise.resolve(),
    };
  },
  useDocumento: (chave: string | null, _referencia: unknown, mapear: (id: string, data: Record<string, unknown>) => unknown) => {
    const data = chave ? estado.documentos[chave] : undefined;
    const falta = (chave && estado.faltas[chave]) || { erro: false, falta: null, lidaEm: null };
    return {
      item: falta.erro ? undefined : data === undefined ? undefined : data === null ? null : mapear(String(data.id), data),
      ...falta,
      tentando: false,
      tentar: () => Promise.resolve(),
    };
  },
}));

import { ProvedorDaConexao, type EstadoDaConexao } from "@/lib/carregando/estado-da-conexao";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { conexaoEm } from "@/test/conexao";
import { DEZ_E_QUARENTA_E_DOIS } from "@/test/sem-conexao";
import { textosDaTela } from "@/test/textos";

import PaginaPedidosSeparar from "./pedidos-separar";

const LINHAS = "pick_lines:pick_ord_1";
const TAREFA = "pick_tasks/pick_ord_1";
const CAIXAS = "warehouse_boxes:BTG:guardadas";
const ENTRADA = "opening_inventory_lines:BTG";
const PRAZO = "customer_requests/creq_1:bancada";

const FILA = {
  alerts: [],
  queues: {
    picking: {
      key: "picking",
      tasks: [
        {
          id: "pick_ord_1",
          reference: "pick_ord_1",
          order_id: "ord_1",
          customer_request_id: "creq_1",
          title: "PED-0001",
          status: "planned",
          can_advance: true,
          exception_count: 0,
          customer_code: "BTG",
          items: [{ id: "pli_1", line_number: 1, sku_code: "BTG-000206", product_name: "Copo Beercup em Inox", quantity: 4, expected_quantity: 4, location: "B-03" }],
        },
      ],
    },
  },
};

let raiz: Root | null = null;
let container: HTMLElement;
let cliente: QueryClient;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: RequestInfo | URL) => {
      const corpo = new URL(String(entrada), "http://localhost").pathname === "/api/warehouse/ops" ? FILA : { items: [] };
      return new Response(JSON.stringify(corpo), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
  window.history.replaceState(null, "", "/pedidos/separar?pedido=ord_1");
  estado.faltas = {};
  estado.documentos = {
    [TAREFA]: { id: "pick_ord_1", status: "planned", volumes: [] },
    [PRAZO]: { id: "creq_1", due_at: "2026-11-16T14:36:00.000Z" },
  };
  estado.consultas = {
    [LINHAS]: [{ id: "pli_1", pick_task_id: "pick_ord_1", line_number: 1, sku_code: "BTG-000206", product_name: "Copo Beercup em Inox", qty_to_pick: 4, location_id: "B-03" }],
    [CAIXAS]: [],
    [ENTRADA]: [],
  };
  container = document.createElement("main");
  document.body.append(container);
  cliente = new QueryClient({ defaultOptions: { queries: { retry: false, networkMode: "always", refetchOnWindowFocus: false } } });
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  container.remove();
  cliente.clear();
  vi.unstubAllGlobals();
});

async function montar(conexao: EstadoDaConexao) {
  await act(async () => {
    raiz!.render(
      <ProvedorDaConexao value={conexaoEm(conexao)}>
        <QueryClientProvider client={cliente}>
          <Router>
            <PaginaPedidosSeparar />
          </Router>
        </QueryClientProvider>
      </ProvedorDaConexao>,
    );
  });
  await vi.waitFor(() => expect(container.textContent).toContain("Copo Beercup em Inox"), { timeout: 3_000 });
  return textosDaTela(container.innerHTML);
}

/** O que a bancada mostra em dia, para comparar: só os rótulos da falta entram. */
async function emDia() {
  const textos = new Set(await montar("conectado"));
  act(() => raiz!.render(<></>));
  return textos;
}

describe("a bancada de Separar com a leitura de apoio que não chegou (parte 13m)", () => {
  it("as caixas e o prazo sem conexão e sem hora: o aviso da conexão e a frase do que não chegou", async () => {
    const antes = await emDia();
    estado.faltas[CAIXAS] = { erro: true, falta: "conexao", lidaEm: null };
    estado.faltas[PRAZO] = { erro: true, falta: "conexao", lidaEm: null };
    const textos = await montar("sem-conexao");
    // O prazo não chegou: o resumo perde o "Para quando", como antes.
    expect(textos.filter((texto) => !antes.has(texto) && !texto.startsWith("BTG Pactual"))).toEqual([
      "Sem conexão.",
      "Tentar de novo",
      "Não foi possível carregar as caixas e o prazo do pedido.",
    ]);
    expect(await violacoesDeAcessibilidade(container.innerHTML)).toEqual([]);
  });

  it("o pedido lido sem conexão e as caixas que não chegaram: a faixa com a hora e a frase das caixas", async () => {
    const antes = await emDia();
    estado.faltas[LINHAS] = { erro: false, falta: "conexao", lidaEm: DEZ_E_QUARENTA_E_DOIS };
    estado.faltas[CAIXAS] = { erro: true, falta: "conexao", lidaEm: null };
    const textos = await montar("sem-conexao");
    expect(textos.filter((texto) => !antes.has(texto))).toEqual(["Sem conexão · pedido de 10:42", "Tentar de novo", "Não foi possível carregar as caixas."]);
    expect(await violacoesDeAcessibilidade(container.innerHTML)).toEqual([]);
  });

  it("o servidor que recusa a tarefa: a frase dos volumes, sem o aviso da conexão", async () => {
    const antes = await emDia();
    estado.faltas[TAREFA] = { erro: true, falta: "servidor", lidaEm: null };
    const textos = await montar("conectado");
    expect(textos.filter((texto) => !antes.has(texto))).toEqual(["Não foi possível carregar os volumes."]);
    expect(container.textContent).not.toMatch(/Sem conexão|Reconectando/);
  });

  it("a entrada das caixas é parte das caixas: uma frase só", async () => {
    estado.faltas[CAIXAS] = { erro: true, falta: "servidor", lidaEm: null };
    estado.faltas[ENTRADA] = { erro: true, falta: "servidor", lidaEm: null };
    const textos = await montar("conectado");
    expect(textos.filter((texto) => texto.startsWith("Não foi possível"))).toEqual(["Não foi possível carregar as caixas."]);
  });
});
