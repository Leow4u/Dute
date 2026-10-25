// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

/**
 * O "Avisar reposição" do item zerado, tocado de novo depois da resposta
 * perdida, repete a chave, e o servidor não abre um segundo aviso. Antes,
 * cada toque saía com uma chave nova, e a Dutelog recebia o aviso em dobro.
 */

const estado = vi.hoisted(() => ({ envios: [] as Array<Record<string, unknown>>, perdidas: 0 }));

vi.mock("@/lib/auth", () => ({
  useAppUser: () => ({ user: { uid: "uid-ana", publicMetadata: { role: "cliente", customer_code: "BTG Pactual" } }, isLoaded: true }),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));

import { ClienteEstoque } from "./estoque";

const ZERADO = {
  sku_code: "BTG-000104",
  client_item_code: "C.0659.001.U",
  product_name: "Toalha de academia",
  category: "Toalha",
  qty_on_hand: 0,
  qty_available: 0,
};
const VISAO = { customer: { code: "BTG Pactual", name: "BTG Pactual" }, inventory: { items: [ZERADO] } };

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

const avisar = () => [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === "Avisar reposição") ?? null;

async function tocarEmAvisar() {
  const antes = estado.envios.length;
  await act(async () => avisar()!.click());
  await esperar(() => estado.envios.length > antes, "o aviso");
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  return estado.envios.at(-1)!;
}

beforeEach(async () => {
  estado.envios = [];
  estado.perdidas = 1;
  window.localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(entrada), window.location.origin);
      if (url.pathname === "/api/client/overview") return json(VISAO);
      if (url.pathname === "/api/client/requests" && init?.method === "POST") {
        estado.envios.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        if (estado.perdidas > 0) {
          estado.perdidas -= 1;
          return json({ message: "Falha interna no servidor. Tente novamente ou avise o time técnico." }, 500);
        }
        return json({ id: "creq_2", request_number: "SUP-0007" }, 201);
      }
      return json({});
    }),
  );
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
  await esperar(() => avisar() !== null, "o item zerado com Avisar reposição");
});

afterEach(() => {
  act(() => raiz?.unmount());
  container?.remove();
  raiz = null;
  container = null;
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("o aviso de reposição enviado de novo", () => {
  it("depois da resposta perdida, o segundo toque repete a chave", async () => {
    const primeiro = await tocarEmAvisar();
    const segundo = await tocarEmAvisar();

    expect(primeiro.type).toBe("suporte");
    expect(typeof primeiro.idempotency_key).toBe("string");
    expect(segundo.idempotency_key).toBe(primeiro.idempotency_key);
  });
});
