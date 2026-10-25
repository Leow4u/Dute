// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

import { cartStorageKey } from "@/lib/client-cart";

/**
 * O pedido do Estoque do portal enviado de novo depois da resposta perdida
 * (o servidor gravou e reservou, e o celular perdeu o sinal antes da
 * resposta) repete a chave do envio, e o servidor devolve o pedido gravado.
 * Antes, cada envio saía com uma chave nova: o segundo toque em "Enviar
 * pedido" criava outro pedido e reservava o mesmo estoque de novo.
 */

const estado = vi.hoisted(() => ({ envios: [] as Array<Record<string, unknown>>, perdidas: 0 }));

vi.mock("@/lib/auth", () => ({
  useAppUser: () => ({ user: { uid: "uid-ana", publicMetadata: { role: "cliente", customer_code: "BTG Pactual" } }, isLoaded: true }),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));

import { ClienteEstoque, groupInventoryProducts } from "./estoque";

const ITEM = {
  sku_code: "BTG-000101",
  client_item_code: "A.01.0805.002.PP",
  product_name: "Polo feminina piquet azul marinho PP",
  category: "Polo",
  qty_on_hand: 12,
  qty_available: 12,
};
const VISAO = { customer: { code: "BTG Pactual", name: "BTG Pactual" }, inventory: { items: [ITEM] } };
const CHAVE_DO_PEDIDO = cartStorageKey("BTG Pactual", "uid-ana");
const [PRODUTO] = groupInventoryProducts([ITEM]);

function guardarPedido(quantidade: number) {
  window.localStorage.setItem(
    CHAVE_DO_PEDIDO,
    JSON.stringify({ cart: { [PRODUTO!.key]: quantidade }, orderName: "", destination: "Agência Faria Lima", dueAt: "", notes: "" }),
  );
}

function json(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
}

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;

async function esperar(condicao: () => boolean, oQue: string) {
  for (let volta = 0; volta < 100; volta += 1) {
    if (condicao()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  throw new Error(`Não aconteceu: ${oQue}`);
}

function botao(comeco: string) {
  return [...document.querySelectorAll("button")].find((item) => item.textContent?.trim().startsWith(comeco)) ?? null;
}

async function abrirATela() {
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  await act(async () =>
    raiz!.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
        <Router ssrPath="/portal/estoque">
          <ClienteEstoque />
        </Router>
      </QueryClientProvider>,
    ),
  );
  await esperar(() => botao("Pedido ·") !== null, "o pedido guardado na tela");
  await act(async () => botao("Pedido ·")!.click());
  await esperar(() => botao("Enviar pedido para a Dutelog") !== null, "o painel do pedido");
}

function fecharATela() {
  act(() => raiz?.unmount());
  container?.remove();
  raiz = null;
  container = null;
}

async function enviar() {
  const antes = estado.envios.length;
  await act(async () => botao("Enviar pedido para a Dutelog")!.click());
  await esperar(() => estado.envios.length > antes, "o envio");
  // A mutação termina (a falha ou o pedido) antes do próximo toque.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  return estado.envios.at(-1)!;
}

beforeEach(() => {
  estado.envios = [];
  estado.perdidas = 1;
  window.localStorage.clear();
  guardarPedido(2);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(entrada), window.location.origin);
      if (url.pathname === "/api/client/overview") return json(VISAO);
      if (url.pathname === "/api/client/requests" && init?.method === "POST") {
        estado.envios.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        if (estado.perdidas > 0) {
          estado.perdidas -= 1;
          // O servidor gravou o pedido; a resposta não chegou à tela.
          return json({ message: "Falha interna no servidor. Tente novamente ou avise o time técnico." }, 500);
        }
        return json({ id: "creq_1", request_number: "PED-0412" }, 201);
      }
      return json({});
    }),
  );
});

afterEach(() => {
  fecharATela();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("o pedido do portal enviado de novo", () => {
  it("depois da resposta perdida, a nova tentativa repete a chave do envio", async () => {
    await abrirATela();
    const primeiro = await enviar();
    const segundo = await enviar();

    expect(typeof primeiro.idempotency_key).toBe("string");
    expect(String(primeiro.idempotency_key).length).toBeGreaterThan(0);
    expect(segundo.idempotency_key).toBe(primeiro.idempotency_key);
    // O pedido que deu certo esvazia o carrinho, e o próximo é outro envio.
    expect(JSON.parse(window.localStorage.getItem(CHAVE_DO_PEDIDO) ?? "{}").envio).toBeUndefined();
  });

  it("recarregar a tela não troca a chave do mesmo pedido", async () => {
    await abrirATela();
    const primeiro = await enviar();
    fecharATela();

    await abrirATela();
    const depois = await enviar();
    expect(typeof primeiro.idempotency_key).toBe("string");
    expect(depois.idempotency_key).toBe(primeiro.idempotency_key);
  });

  it("o pedido mudado depois da falha é outro envio, com outra chave", async () => {
    await abrirATela();
    const primeiro = await enviar();
    fecharATela();

    const guardado = JSON.parse(window.localStorage.getItem(CHAVE_DO_PEDIDO) ?? "{}");
    window.localStorage.setItem(CHAVE_DO_PEDIDO, JSON.stringify({ ...guardado, cart: { [PRODUTO!.key]: 3 } }));
    await abrirATela();
    const mudado = await enviar();
    expect(mudado.idempotency_key).not.toBe(primeiro.idempotency_key);
    expect((mudado.items as Array<{ quantity: number }>)[0]?.quantity).toBe(3);
  });
});
