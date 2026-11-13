// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Anunciador } from "@/lib/carregando/anunciador";
import { CARREGANDO } from "@/lib/carregando/tempo";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";

/**
 * Os diálogos de Pedidos que gravam (carregamento v2, parte 13a): o
 * "Cancelar pedido" segura o diálogo enquanto o cancelamento grava. O Esc, o
 * toque fora, o X e o Voltar não fecham; o Voltar e o X ficam aria-disabled,
 * e o "Cancelar pedido" é o BotaoDeAcao, que diz "Cancelando…" e nunca fica
 * disabled: antes, ele ficava disabled e o foco caía no body. A nova
 * tentativa leva a mesma chave de idempotência. Dados sintéticos.
 */

const estado = vi.hoisted(() => ({
  toast: vi.fn(),
  ops: { queues: {}, alerts: [] } as Record<string, unknown>,
  cancelamentos: [] as Array<{ id: string; corpo: Record<string, unknown>; responder: (corpo: unknown, status?: number) => void }>,
}));

vi.mock("@/lib/auth", () => ({ useAppUser: () => ({ user: { publicMetadata: { role: "admin" } } }) }));
vi.mock("@/lib/active-customer-context", () => ({ useActiveCustomer: () => ({ active: { code: "BTG", name: "BTG Pactual" }, code: "BTG" }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: estado.toast }) }));
vi.mock("@/lib/operacao/leitura", () => ({
  useLeitura: () => ({ itens: [], erro: false }),
  useDocumento: () => ({ item: undefined, erro: false }),
}));
vi.mock("@/features/warehouse-ops/opening-inventory-status", () => ({
  useOpeningInventorySession: () => ({ data: undefined }),
  OpeningInventoryNotice: () => null,
}));

import Pedidos from "./pedidos";

function separar(pedido: string) {
  return {
    id: `pick_ord_${pedido}`,
    reference: `pick_ord_${pedido}`,
    order_id: `ord_${pedido}`,
    title: `PED-${pedido}`,
    status: "planned",
    can_advance: true,
    exception_count: 0,
    customer_code: "BTG",
    items: [{ id: `pli_${pedido}_1`, line_number: 1, sku_code: `BTG-${pedido}1`, product_name: "Polo Masculino Piquet Preto", quantity: 10, expected_quantity: 10, location: "B-02" }],
  };
}

function resposta(corpo: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => corpo, text: async () => JSON.stringify(corpo) };
}

async function servir(entrada: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(String(entrada), "http://localhost");
  const metodo = (init?.method ?? "GET").toUpperCase();
  if (url.pathname === "/api/warehouse/ops") return resposta(estado.ops);
  if (url.pathname === "/api/stock-balances") return resposta({ items: [] });
  if (url.pathname === "/api/customer-requests") return resposta({ items: [] });
  const cancelar = url.pathname.match(/^\/api\/orders\/([^/]+)\/cancel$/);
  if (cancelar && metodo === "POST") {
    return new Promise((resolver) =>
      estado.cancelamentos.push({
        id: decodeURIComponent(cancelar[1]),
        corpo: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
        responder: (corpo, status = 200) => resolver(resposta(corpo, status)),
      }),
    );
  }
  throw new Error(`API inesperada: ${metodo} ${url.pathname}`);
}

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;

async function passar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const dialogo = () => document.querySelector<HTMLElement>('[role="dialog"][data-state="open"]');

/** O botão pelo rótulo: o texto inteiro, ou a camada atual do BotaoDeAcao. */
function botao(rotulo: string, dentro: ParentNode = document): HTMLButtonElement {
  const achado = Array.from(dentro.querySelectorAll<HTMLButtonElement>("button")).find(
    (item) =>
      item.textContent?.trim() === rotulo ||
      item.getAttribute("aria-label") === rotulo ||
      item.querySelector(".botao-acao-camada[data-atual]")?.textContent?.trim() === rotulo,
  );
  if (!achado) throw new Error(`sem o botão ${rotulo}`);
  return achado;
}

async function abrirOCancelamento() {
  await act(async () => {
    botao("Mais ações do pedido PED-1039").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
  });
  const item = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((elemento) => elemento.textContent?.includes("Cancelar pedido"));
  await act(async () => item!.click());
  await passar(10);
  const motivo = document.getElementById("motivo-do-cancelamento") as HTMLTextAreaElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(motivo, "Cliente desistiu do pedido");
    motivo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(servir));
  estado.toast.mockReset();
  estado.cancelamentos.length = 0;
  estado.ops = { alerts: [], queues: { picking: { key: "picking", tasks: [separar("1039"), separar("1040")] }, expedition: { key: "expedition", tasks: [] } } };
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  await act(async () => {
    raiz!.render(
      <QueryClientProvider client={cliente}>
        <Anunciador />
        <Pedidos />
      </QueryClientProvider>,
    );
  });
  for (let vez = 0; vez < 20 && !container.textContent?.includes("PED-1039"); vez += 1) await passar(10);
  expect(container.textContent).toContain("PED-1039");
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  container?.remove();
  container = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Cancelar pedido, gravando", () => {
  it("o Esc, o toque fora, o X e o Voltar não fecham; o foco fica no Cancelar pedido, que nunca fica disabled", async () => {
    await abrirOCancelamento();
    const confirmar = botao("Cancelar pedido", dialogo()!);
    confirmar.focus();
    await act(async () => confirmar.click());
    expect(estado.cancelamentos).toHaveLength(1);
    await passar(CARREGANDO.atrasoMs);

    expect(botao("Cancelando…", dialogo()!)).toBe(confirmar);
    expect(confirmar.disabled).toBe(false);
    expect(confirmar.getAttribute("aria-disabled")).toBe("true");
    expect(confirmar.getAttribute("aria-busy")).toBe("true");
    expect(document.activeElement).toBe(confirmar);

    await act(async () => {
      confirmar.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
    });
    for (const rotulo of ["Fechar", "Voltar"]) {
      const elemento = botao(rotulo, dialogo()!);
      expect(elemento.getAttribute("aria-disabled"), rotulo).toBe("true");
      expect(elemento.disabled, rotulo).toBe(false);
      await act(async () => elemento.click());
    }
    await passar(10);
    expect(dialogo()).not.toBeNull();
    expect(dialogo()!.hasAttribute("data-ocupado")).toBe(true);
    // O segundo toque no meio da ação não cancela de novo.
    await act(async () => confirmar.click());
    expect(estado.cancelamentos).toHaveLength(1);
    const html = dialogo()!.outerHTML;
    // O axe usa o relógio de verdade.
    vi.useRealTimers();
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("só o sucesso fecha; a falha deixa o diálogo, e a nova tentativa leva a mesma chave", async () => {
    await abrirOCancelamento();
    await act(async () => botao("Cancelar pedido", dialogo()!).click());
    await act(async () => estado.cancelamentos[0].responder({ message: "Falha interna no servidor." }, 500));
    await passar(CARREGANDO.minimoMs + 50);
    expect(dialogo()).not.toBeNull();
    expect(botao("Voltar", dialogo()!).hasAttribute("aria-disabled")).toBe(false);

    await passar(1_100);
    await act(async () => botao("Cancelar pedido", dialogo()!).click());
    expect(estado.cancelamentos).toHaveLength(2);
    expect(estado.cancelamentos[1].corpo.idempotency_key).toBe(estado.cancelamentos[0].corpo.idempotency_key);
    await act(async () => estado.cancelamentos[1].responder({ ok: true }));
    await passar(CARREGANDO.minimoMs + 50);
    expect(dialogo()).toBeNull();
    expect(estado.toast).toHaveBeenCalledWith({ title: "Pedido cancelado" });
    // O foco não fica no body depois do fim.
    await passar(50);
    expect(document.activeElement).not.toBe(document.body);
  });
});
