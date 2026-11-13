// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Anunciador } from "@/lib/carregando/anunciador";
import { textosForaDaLista } from "@/test/textos";

/**
 * A entrega do pedido em "Para entregar" antes de as entregas chegarem
 * (carregamento v2, parte 13c; diagnóstico, 4.3). Antes, até a leitura ao
 * vivo responder, a linha oferecia "Entrega" (e não "Alterar entrega") e o
 * formulário abria vazio sobre a entrega que já existia; e a leitura que
 * falhava sumia em silêncio. Agora a linha só oferece a entrega depois de ler
 * as entregas, e a falha diz que não carregou. Dados sintéticos.
 */

const estado = vi.hoisted(() => ({
  entregas: { itens: null as unknown[] | null, erro: false },
  /** O que a nova assinatura (a chave com a vez 1 ou mais) devolve; sem ela, a mesma de antes. */
  daNovaAssinatura: null as { itens: unknown[] | null; erro: boolean } | null,
  chaves: [] as string[],
}));

vi.mock("@/lib/liberacao", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/liberacao")>()), OPERACAO_LIBERADO: true }));
vi.mock("@/lib/auth", () => ({ useAppUser: () => ({ user: { publicMetadata: { role: "admin" } } }) }));
vi.mock("@/lib/active-customer-context", () => ({ useActiveCustomer: () => ({ active: { code: "BTG", name: "BTG Pactual" }, code: "BTG" }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));
vi.mock("@/lib/operacao/leitura", () => ({
  useLeitura: (chave: string | null) => {
    if (!chave?.startsWith("orders:em_aberto")) return { itens: [], erro: false };
    if (!estado.chaves.includes(chave)) estado.chaves.push(chave);
    return !chave.endsWith("#0") && estado.daNovaAssinatura ? estado.daNovaAssinatura : estado.entregas;
  },
  useDocumento: () => ({ item: undefined, erro: false }),
}));
vi.mock("@/features/warehouse-ops/opening-inventory-status", () => ({
  useOpeningInventorySession: () => ({ data: undefined }),
  OpeningInventoryNotice: () => null,
}));

import Pedidos from "./pedidos";

const tarefa = (prefixo: string, status: string) => ({
  id: `${prefixo}_ord_1`,
  reference: `${prefixo}_ord_1`,
  order_id: "ord_1",
  title: "PED-0001",
  status,
  can_advance: true,
  exception_count: 0,
  customer_code: "BTG",
  items: [],
});
const OPS = { queues: { packing: { tasks: [tarefa("pack", "completed")] }, expedition: { tasks: [tarefa("ship", "ready_to_dispatch")] } }, alerts: [] };

const resposta = (corpo: unknown) => ({ ok: true, status: 200, json: async () => corpo, text: async () => JSON.stringify(corpo) });

let raiz: Root | null = null;
let container: HTMLDivElement;

async function esperar(condicao: () => boolean, oQue: string) {
  for (let volta = 0; volta < 100; volta += 1) {
    if (condicao()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  throw new Error(`Não aconteceu: ${oQue}`);
}

const naTela = () => container.textContent ?? "";
const botoes = () => Array.from(container.querySelectorAll("button")).map((botao) => botao.textContent?.trim());

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: RequestInfo | URL) => {
      const url = new URL(String(entrada), "http://localhost");
      if (url.pathname === "/api/warehouse/ops") return resposta(OPS);
      return resposta({ items: [] });
    }),
  );
  estado.entregas = { itens: null, erro: false };
  estado.daNovaAssinatura = null;
  estado.chaves.length = 0;
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

async function montar() {
  raiz = createRoot(container);
  await act(async () => {
    raiz!.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <Anunciador />
        <Pedidos />
      </QueryClientProvider>,
    );
  });
  await esperar(() => naTela().includes("PED-0001"), "o pedido em Para entregar");
}

describe("a entrega do pedido antes de ler as entregas", () => {
  it("antes de ler, a linha não oferece \"Entrega\" sobre a entrega que pode existir", async () => {
    await montar();
    expect(botoes()).not.toContain("Entrega");
    expect(botoes()).not.toContain("Alterar entrega");
  });

  it("lidas, a linha oferece a entrega", async () => {
    estado.entregas = { itens: [], erro: false };
    await montar();
    expect(botoes()).toContain("Entrega");
  });

  it("a leitura que falhou diz que não carregou, não oferece a entrega e oferece a nova tentativa, que assina de novo", async () => {
    estado.entregas = { itens: null, erro: true };
    await montar();
    expect(naTela()).toContain("Não consegui carregar a entrega.");
    expect(botoes()).not.toContain("Entrega");
    const tentar = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (botao) => botao.querySelector(".botao-acao-camada[data-atual]")?.textContent === "Tentar de novo",
    );
    expect(tentar).toBeDefined();
    // Só rótulos, dados e ações na linha da entrega que falhou (as camadas do botão incluídas).
    const linha = tentar!.closest("li") ?? tentar!.parentElement!.parentElement!;
    expect(textosForaDaLista(linha.outerHTML, ["Não consegui carregar a entrega.", "Tentar de novo", "Tentando de novo…", "Conferir", "Etiquetas dos volumes", "Romaneio", "Entregue"]).filter((texto) => !texto.includes("PED-0001"))).toEqual([]);
    tentar!.focus();
    estado.daNovaAssinatura = { itens: [], erro: false };
    await act(async () => tentar!.click());
    await esperar(() => botoes().includes("Entrega"), "a entrega depois da nova tentativa");
    expect(estado.chaves).toContain("orders:em_aberto#1");
    // O botão saiu com o foco: ele vai à entrega que entrou no lugar, nunca ao body.
    expect(document.activeElement?.textContent).toBe("Entrega");
  });
});
