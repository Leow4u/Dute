// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

import { INTERVALO_DO_TOQUE_MS } from "@/lib/campo/toque-unico";
import { cartStorageKey } from "@/lib/client-cart";

/**
 * O pedido do Estoque do portal enviado de novo depois da resposta perdida
 * (o servidor gravou e reservou, e o celular perdeu o sinal antes da
 * resposta) repete a chave do envio, e o servidor devolve o pedido gravado.
 * Antes, cada envio saía com uma chave nova: o segundo toque em "Enviar
 * pedido" criava outro pedido e reservava o mesmo estoque de novo.
 */

const estado = vi.hoisted(() => ({
  envios: [] as Array<Record<string, unknown>>,
  perdidas: 0,
  /** Com a lista, o envio espera até o teste soltar (o painel gravando, parte 13a). */
  envioPreso: null as Array<() => void> | null,
}));

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

/**
 * O Enviar é o BotaoDeAcao (carregamento v2, parte 13a), que barra o segundo
 * toque em menos de um segundo; a nova tentativa de quem leu a falha vem
 * depois disso: o relógio anda um intervalo a cada envio.
 */
let deslocamentoDoRelogio = 0;
const agoraDeVerdade = Date.now.bind(Date);

async function enviar() {
  deslocamentoDoRelogio += INTERVALO_DO_TOQUE_MS;
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
  deslocamentoDoRelogio = 0;
  vi.spyOn(Date, "now").mockImplementation(() => agoraDeVerdade() + deslocamentoDoRelogio);
  estado.envios = [];
  estado.perdidas = 1;
  estado.envioPreso = null;
  window.localStorage.clear();
  guardarPedido(2);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(entrada), window.location.origin);
      if (url.pathname === "/api/client/overview") return json(VISAO);
      if (url.pathname === "/api/client/requests" && init?.method === "POST") {
        estado.envios.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        const preso = estado.envioPreso;
        if (preso) await new Promise<void>((soltar) => preso.push(soltar));
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
  vi.restoreAllMocks();
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

describe("o painel do pedido enviando (carregamento v2, parte 13a)", () => {
  it("o Esc e o toque fora não fecham o painel, o Fechar pedido fica aria-disabled e o Enviar nunca fica disabled", async () => {
    estado.perdidas = 0;
    estado.envioPreso = [];
    await abrirATela();
    const enviar = botao("Enviar pedido para a Dutelog")!;
    enviar.focus();
    await act(async () => enviar.click());
    await esperar(() => estado.envioPreso!.length === 1 && Boolean(document.querySelector('[role="dialog"][data-ocupado]')), "o pedido enviando");
    await act(async () => {
      enviar.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
    });
    const fechar = document.querySelector<HTMLButtonElement>('[aria-label="Fechar pedido"]')!;
    expect(fechar.getAttribute("aria-disabled")).toBe("true");
    await act(async () => fechar.click());
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(enviar.disabled).toBe(false);
    expect(enviar.getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(enviar);
    for (const soltar of estado.envioPreso!.splice(0)) soltar();
    estado.envioPreso = null;
  });
});
