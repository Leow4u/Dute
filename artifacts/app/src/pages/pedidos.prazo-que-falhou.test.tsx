// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O "Para quando" de cada pedido em Pedidos, para quem não lê a lista das
 * solicitações (o armazém), quando a leitura dele falha (carregamento v2,
 * parte 13m). Antes, a linha ficava calada: sem o prazo, parecia um pedido
 * sem prazo, e nada pedia de novo. Agora o erro do servidor diz na linha que
 * o prazo não veio, e o Atualizar da tela assina de novo o que falhou; sem
 * conexão, o estado da conexão já avisa, e a linha não repete. Dados
 * sintéticos.
 */

const estado = vi.hoisted(() => ({
  /** Por chave: a falta da escuta do prazo. */
  faltas: {} as Record<string, { erro: boolean; falta: "conexao" | "servidor" | null; lidaEm: number | null }>,
  /** As chaves que assinaram de novo. */
  tentativas: [] as string[],
}));

vi.mock("@/lib/auth", () => ({ useAppUser: () => ({ user: { uid: "u-1", fullName: "Guilherme Dantas", publicMetadata: { role: "wms" } } }) }));
vi.mock("@/lib/active-customer-context", () => ({ useActiveCustomer: () => ({ active: { code: "BTG", name: "BTG Pactual" }, code: "BTG" }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));
vi.mock("@/lib/operacao/leitura", async (original) => ({
  ...(await original<object>()),
  useLeitura: () => ({ itens: [], erro: false, tentando: false, tentar: () => Promise.resolve(), falta: null, lidaEm: null }),
  useDocumento: (chave: string | null, _referencia: unknown, mapear: (id: string, data: Record<string, unknown>) => unknown) => {
    const falta = (chave && estado.faltas[chave]) || { erro: false, falta: null, lidaEm: null };
    return {
      item: falta.erro || !chave ? undefined : mapear("creq_1", { due_at: "2026-11-16T14:36:00.000Z" }),
      ...falta,
      tentando: false,
      tentar: () => {
        estado.tentativas.push(String(chave));
        return Promise.resolve();
      },
    };
  },
}));
vi.mock("@/features/warehouse-ops/opening-inventory-status", () => ({
  useOpeningInventorySession: () => ({ data: undefined }),
  OpeningInventoryNotice: () => null,
}));

import { Anunciador } from "@/lib/carregando/anunciador";
import { ProvedorDaConexao, type EstadoDaConexao } from "@/lib/carregando/estado-da-conexao";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { conexaoEm } from "@/test/conexao";
import { textosDaTela } from "@/test/textos";

import Pedidos from "./pedidos";

const PRAZO = "customer_requests/creq_1:para-quando";
const OPS = {
  alerts: [],
  queues: {
    picking: {
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
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: RequestInfo | URL) => {
      const corpo = new URL(String(entrada), "http://localhost").pathname === "/api/warehouse/ops" ? OPS : { items: [] };
      return new Response(JSON.stringify(corpo), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
  estado.faltas = {};
  estado.tentativas = [];
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function montar(conexao: EstadoDaConexao) {
  raiz = createRoot(container);
  await act(async () => {
    raiz!.render(
      <ProvedorDaConexao value={conexaoEm(conexao)}>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <Anunciador />
          <Pedidos />
        </QueryClientProvider>
      </ProvedorDaConexao>,
    );
  });
  await vi.waitFor(() => expect(container.textContent).toContain("PED-0001"), { timeout: 3_000 });
}

/** A linha do pedido na fila (a do useListaSemSaltos). */
const linha = () => {
  const achada = [...container.querySelectorAll<HTMLElement>("[data-na-lista]")].find((elemento) => elemento.textContent?.includes("PED-0001"));
  if (!achada) throw new Error("Sem a linha do pedido.");
  return achada;
};
const atualizar = () => container.querySelector<HTMLButtonElement>("button[data-atualizar]")!;

describe("o Para quando que não chegou, em Pedidos (parte 13m)", () => {
  it("em dia, a linha diz o prazo", async () => {
    await montar("conectado");
    expect(textosDaTela(linha().innerHTML).slice(0, 3)).toEqual(["PED-0001", "1 item · 4 un.", "Para quando Seg 16/11 11:36"]);
  });

  it("o servidor que recusa o prazo: a linha diz que ele não veio, sem afirmar o vazio", async () => {
    estado.faltas[PRAZO] = { erro: true, falta: "servidor", lidaEm: null };
    await montar("conectado");
    const textos = textosDaTela(linha().innerHTML);
    // O rótulo novo, no lugar do "Para quando" (a trava dos textos: só ele entra).
    expect(textos.slice(0, 3)).toEqual(["PED-0001", "1 item · 4 un.", "Prazo não carregado"]);
    expect(textos.join(" ")).not.toContain("Para quando");
    expect(await violacoesDeAcessibilidade(container.innerHTML)).toEqual([]);
  });

  it("o Atualizar da tela assina de novo o prazo que falhou", async () => {
    estado.faltas[PRAZO] = { erro: true, falta: "servidor", lidaEm: null };
    await montar("conectado");
    await vi.waitFor(() => expect(atualizar().getAttribute("aria-disabled")).toBeNull(), { timeout: 3_000 });
    await act(async () => atualizar().click());
    await vi.waitFor(() => expect(estado.tentativas).toEqual([PRAZO]), { timeout: 3_000 });
  });

  it("sem conexão, a linha não repete o aviso: o estado da conexão já diz", async () => {
    estado.faltas[PRAZO] = { erro: true, falta: "conexao", lidaEm: null };
    await montar("sem-conexao");
    const textos = textosDaTela(linha().innerHTML).join(" ");
    expect(textos).not.toContain("Prazo não carregado");
    expect(textos).not.toMatch(/Sem conexão|Reconectando/);
  });

  it("o prazo lido não assina de novo no Atualizar", async () => {
    await montar("conectado");
    await vi.waitFor(() => expect(atualizar().getAttribute("aria-disabled")).toBeNull(), { timeout: 3_000 });
    await act(async () => atualizar().click());
    await vi.waitFor(() => expect(container.querySelector("button[data-atualizar]")?.getAttribute("aria-disabled")).toBeNull(), { timeout: 3_000 });
    expect(estado.tentativas).toEqual([]);
  });
});
