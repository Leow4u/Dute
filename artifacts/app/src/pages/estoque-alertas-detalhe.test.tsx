// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O detalhe de Estoque › Alertas não passa sozinho a outro alerta. O que
 * está na tela continua nela quando a lista muda: outra pessoa o decidiu (a
 * decisão daqui para em "O alerta já foi decidido.") ou chegou um alerta
 * novo que fica antes na ordem. Antes, o detalhe mostrava o primeiro da
 * lista, e "Enviar ao cliente" avisava um cliente cujo alerta ninguém tinha
 * conferido.
 */

const estado = vi.hoisted(() => ({
  alertas: [] as Array<Record<string, unknown>>,
  decisoes: [] as Array<{ alerta_id: string; decisao: string }>,
}));

vi.mock("@/lib/liberacao", async (original) => ({ ...(await original<typeof import("@/lib/liberacao")>()), MEMORIA_LIBERADA: true }));

vi.mock("@/lib/active-customer-context", () => ({
  useActiveCustomer: () => ({
    options: [
      { code: "alfa", name: "Alfa Uniformes" },
      { code: "beta", name: "Beta Brindes" },
      { code: "aaa", name: "AAA Móveis" },
    ],
  }),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));

vi.mock("@/lib/memoria/api", () => ({
  chamarNucleo: async (_nome: string, dados: { alerta_id: string; decisao: string }) => {
    estado.decisoes.push({ alerta_id: dados.alerta_id, decisao: dados.decisao });
    estado.alertas = estado.alertas.filter((alerta) => alerta.id !== dados.alerta_id);
    return { alerta_id: dados.alerta_id };
  },
}));

import EstoqueAlertas from "./estoque-alertas";

const alerta = (id: string, cliente: string) => ({
  id,
  customer_code: cliente,
  status: "proposta",
  regra: { parado_dias: 90, sem_giro_dias: 180 },
  itens: [{ sku_code: `${cliente.toUpperCase()}-000001`, product_name: "Caixa", saldo: 10, ultima_movimentacao: "2026-06-01T12:00:00.000Z", dias_parado: 146 }],
});

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;
let cliente: QueryClient;

async function esperar(condicao: () => boolean, oQue: string) {
  for (let volta = 0; volta < 100; volta += 1) {
    if (condicao()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  throw new Error(`Não aconteceu: ${oQue}`);
}

const naTela = () => document.querySelector("section h2")?.textContent ?? null;
const botao = (texto: string) => [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === texto) ?? null;
// O chip do cliente leva a contagem de itens depois do nome.
const chip = (nome: string) => [...document.querySelectorAll('[role="group"] button')].find((item) => item.textContent?.startsWith(nome)) as HTMLButtonElement | undefined;

async function recarregarALista() {
  await act(async () => {
    await cliente.invalidateQueries({ queryKey: ["stock-alerts"] });
  });
}

async function enviarAoCliente() {
  const antes = estado.decisoes.length;
  await act(async () => botao("Enviar ao cliente")!.click());
  await esperar(() => estado.decisoes.length > antes, "a decisão");
  return estado.decisoes.at(-1)!;
}

beforeEach(async () => {
  estado.alertas = [alerta("al_alfa", "alfa"), alerta("al_beta", "beta")];
  estado.decisoes = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: RequestInfo | URL) =>
      String(entrada).startsWith("/api/stock-alerts")
        ? new Response(JSON.stringify({ items: estado.alertas }), { status: 200, headers: { "content-type": "application/json" } })
        : new Response("{}", { status: 200 }),
    ),
  );
  cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  await act(async () =>
    raiz!.render(
      <QueryClientProvider client={cliente}>
        <EstoqueAlertas />
      </QueryClientProvider>,
    ),
  );
  await esperar(() => naTela() === "Alfa Uniformes", "o primeiro alerta na tela");
});

afterEach(() => {
  act(() => raiz?.unmount());
  container?.remove();
  raiz = null;
  container = null;
  vi.unstubAllGlobals();
});

describe("o alerta do detalhe", () => {
  it("o escolhido que outra pessoa decidiu continua na tela, e a decisão vai para ele", async () => {
    await act(async () => chip("Beta Brindes")!.click());
    expect(naTela()).toBe("Beta Brindes");

    // Outra pessoa decide o da Beta; a lista volta sem ele.
    estado.alertas = estado.alertas.filter((item) => item.id !== "al_beta");
    await recarregarALista();
    await esperar(() => chip("Beta Brindes") === undefined, "a lista sem o alerta da Beta");

    expect(naTela()).toBe("Beta Brindes");
    // O da Alfa segue na lista para escolher.
    expect(chip("Alfa Uniformes")).toBeDefined();
    expect((await enviarAoCliente()).alerta_id).toBe("al_beta");
  });

  it("o alerta novo que fica antes na ordem não toma o lugar do que está na tela", async () => {
    estado.alertas = [alerta("al_aaa", "aaa"), ...estado.alertas];
    await recarregarALista();
    await esperar(() => chip("AAA Móveis") !== undefined, "o alerta novo na lista");

    expect(naTela()).toBe("Alfa Uniformes");
    expect((await enviarAoCliente()).alerta_id).toBe("al_alfa");
  });

  it("depois da própria decisão, o detalhe passa ao próximo", async () => {
    expect((await enviarAoCliente()).alerta_id).toBe("al_alfa");
    await esperar(() => naTela() === "Beta Brindes", "o próximo alerta na tela");
    expect((await enviarAoCliente()).alerta_id).toBe("al_beta");
  });
});
