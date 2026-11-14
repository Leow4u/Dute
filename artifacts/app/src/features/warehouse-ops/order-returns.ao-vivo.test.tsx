// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Os Retornos da Operação com a leitura ao vivo (carregamento v2, parte 13c).
 * A falha dos itens é do pedido em que aconteceu: antes, a falha dos itens do
 * pedido A aparecia no pedido B aberto em seguida ("Não consegui carregar os
 * itens do pedido." desde 0 ms, no lugar de "Carregando itens…"), e ficava
 * lá enquanto B não respondesse. O Firestore é simulado: cada consulta guarda
 * o ouvinte dela. Dados sintéticos.
 */

const fs = vi.hoisted(() => ({
  ouvintes: new Map<string, { ok: (foto: unknown) => void; erro: (erro: unknown) => void }>(),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));
vi.mock("@/lib/active-customer-context", () => ({ useActiveCustomer: () => ({ code: "BTG", active: { code: "BTG", name: "BTG Pactual" } }) }));
vi.mock("@/lib/liberacao", async (importar) => ({ ...(await importar<object>()), OPERACAO_LIBERADO: true }));
vi.mock("@/lib/firebase", () => ({ firestore: {} }));
vi.mock("firebase/firestore", () => ({
  collection: (_db: unknown, nome: string) => ({ nome }),
  where: (campo: string, _op: string, valor: unknown) => ({ campo, valor }),
  query: (colecao: { nome: string }, filtro: { valor: unknown }) => ({ chave: `${colecao.nome}:${String(filtro.valor)}` }),
  onSnapshot: (consulta: { chave: string }, ok: (foto: unknown) => void, erro: (erro: unknown) => void) => {
    fs.ouvintes.set(consulta.chave, { ok, erro });
    return () => fs.ouvintes.delete(consulta.chave);
  },
}));

import { RetornosDaOperacao } from "./order-returns";

const foto = (docs: Array<{ id: string; data: Record<string, unknown> }>) => ({ docs: docs.map((doc) => ({ id: doc.id, data: () => doc.data })) });

let raiz: Root | null = null;
let container: HTMLDivElement;

async function pausa(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const dialogo = () => (document.querySelector('[role="dialog"]')?.textContent ?? "").replace(/\s+/g, " ");
const botoes = (rotulo: string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>("button")).filter(
    (botao) => (botao.querySelector(".botao-acao-camada[data-atual]")?.textContent ?? botao.textContent)?.trim() === rotulo,
  );

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fs.ouvintes.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  container.remove();
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("os itens do retorno, pedido a pedido", () => {
  it("a falha dos itens do pedido A não aparece no pedido B, que espera os itens dele", async () => {
    raiz = createRoot(container);
    await act(async () => {
      raiz!.render(
        <QueryClientProvider client={new QueryClient()}>
          <RetornosDaOperacao />
        </QueryClientProvider>,
      );
    });
    await act(async () =>
      fs.ouvintes.get("orders:a_receber")!.ok(
        foto([
          { id: "ordA", data: { order_number: "PED-A", customer_code: "BTG", retorno: { status: "a_receber", os: "1" } } },
          { id: "ordB", data: { order_number: "PED-B", customer_code: "BTG", retorno: { status: "a_receber", os: "2" } } },
        ]),
      ),
    );
    await act(async () => botoes("Receber retorno")[0]!.click());
    await act(async () => fs.ouvintes.get("order_items:ordA")!.erro(new Error("permission-denied")));
    await pausa(50);
    expect(dialogo()).toContain("Não consegui carregar os itens do pedido.");
    await act(async () => botoes("Voltar")[0]!.click());
    await pausa(50);

    await act(async () => botoes("Receber retorno")[1]!.click());
    expect(fs.ouvintes.has("order_items:ordB")).toBe(true);
    expect(dialogo()).not.toContain("Não consegui carregar os itens do pedido.");
    await pausa(400);
    expect(dialogo()).toContain("Carregando itens…");
    expect(dialogo()).not.toContain("Não consegui carregar os itens do pedido.");
  });
});
