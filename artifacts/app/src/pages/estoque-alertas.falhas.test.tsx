// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Anunciador } from "@/lib/carregando/anunciador";
import { ProvedorDaConexao } from "@/lib/carregando/estado-da-conexao";
import { conexaoEm } from "@/test/conexao";

/**
 * Estoque › Alertas na revisão da parte 13b (carregamento v2; necessidade 2 e
 * seção 7). A falta de conexão sem nada lido não vira o erro genérico na
 * releitura; a releitura do intervalo (2 min) não muda o aviso da falha, que é
 * um alerta; a nova tentativa que dá certo leva o foco à linha de estado. A
 * decisão que dá certo troca o alerta: o botão do decidido não passa ao
 * seguinte com o "Enviando…", e o foco vai ao título do seguinte, nunca ao
 * body nem ao "Enviar ao cliente" do outro cliente. Dados sintéticos.
 */

const estado = vi.hoisted(() => ({
  atrasoMs: 30,
  /** 503 `sem_resposta`: o servidor sem resposta com o aparelho conectado. */
  falta: false,
  /** 500: a falha da leitura por outro motivo. */
  falha: false,
  respostaDaDecisaoMs: 400,
  alertas: [] as Array<Record<string, unknown>>,
  decisoes: [] as string[],
}));

vi.mock("@/lib/liberacao", async (original) => ({ ...(await original<typeof import("@/lib/liberacao")>()), MEMORIA_LIBERADA: true }));
vi.mock("@/lib/active-customer-context", () => ({
  useActiveCustomer: () => ({ options: [{ code: "alfa", name: "Alfa Uniformes" }, { code: "beta", name: "Beta Brindes" }] }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));
vi.mock("@/lib/memoria/api", () => ({
  chamarNucleo: async (_nome: string, dados: { alerta_id: string }) => {
    await new Promise((pronto) => setTimeout(pronto, estado.respostaDaDecisaoMs));
    estado.decisoes.push(dados.alerta_id);
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
let container: HTMLDivElement;
let cliente: QueryClient;

const naTela = () => {
  const copia = container.cloneNode(true) as HTMLElement;
  copia.querySelector("[data-anunciador]")?.remove();
  return (copia.textContent ?? "").replace(/\s+/g, " ");
};
const alertas = () => Array.from(container.querySelectorAll('[role="alert"]')).map((no) => (no.textContent ?? "").replace(/\s+/g, " ").trim());
const botao = (texto: string) =>
  [...container.querySelectorAll("button")].find((item) => (item.querySelector('[data-camada="repouso"]') ?? item).textContent?.trim() === texto) ?? null;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse("2026-11-13T13:42:00Z"));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  estado.atrasoMs = 30;
  estado.falta = false;
  estado.falha = false;
  estado.respostaDaDecisaoMs = 400;
  estado.alertas = [alerta("al_alfa", "alfa"), alerta("al_beta", "beta")];
  estado.decisoes = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      await new Promise((pronto) => setTimeout(pronto, estado.atrasoMs));
      if (estado.falta) return new Response(JSON.stringify({ error: "Sem resposta do servidor.", code: "sem_resposta" }), { status: 503 });
      if (estado.falha) return new Response(JSON.stringify({ error: "Falha no servidor" }), { status: 500 });
      return new Response(JSON.stringify({ items: estado.alertas }), { status: 200 });
    }),
  );
  cliente = new QueryClient({ defaultOptions: { queries: { retry: false, networkMode: "always", refetchOnWindowFocus: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  cliente.clear();
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function passar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function montar(conexao: "conectado" | "reconectando" = "conectado") {
  raiz = createRoot(container);
  await act(async () => {
    raiz!.render(
      <ProvedorDaConexao value={conexaoEm(conexao)}>
        <QueryClientProvider client={cliente}>
          <Anunciador />
          <EstoqueAlertas />
        </QueryClientProvider>
      </ProvedorDaConexao>,
    );
  });
}

describe("a falha dos Alertas", () => {
  it("sem conexão e sem nada lido: a releitura sozinha não troca o Reconectando pelo erro genérico", async () => {
    estado.falta = true;
    await montar("reconectando");
    await passar(500);
    expect(naTela()).toContain("Reconectando…");
    estado.atrasoMs = 3_000;
    await act(async () => {
      void cliente.refetchQueries({ queryKey: ["stock-alerts"] }, { cancelRefetch: false });
    });
    let antes = 0;
    for (const instante of [50, 500, 1_000, 2_000, 2_900]) {
      await passar(instante - antes);
      antes = instante;
      expect(naTela(), `aos ${instante} ms`).toContain("Reconectando…");
      expect(naTela(), `aos ${instante} ms`).not.toContain("Não consegui carregar os alertas.");
      expect(alertas(), `aos ${instante} ms`).toEqual([]);
    }
  });

  it("sem ninguém tocar, a releitura do intervalo (2 min) não muda o aviso da falha", async () => {
    estado.falha = true;
    await montar();
    await passar(500);
    expect(alertas()).toEqual(["Não consegui carregar os alertas.Tentar de novo"]);
    estado.atrasoMs = 2_000;
    await passar(120_000 - 500 + 300);
    expect(alertas()).toEqual(["Não consegui carregar os alertas.Tentar de novo"]);
    await passar(1_000);
    expect(alertas()).toEqual(["Não consegui carregar os alertas.Tentar de novo"]);
  });

  it("a nova tentativa que dá certo tira o aviso e leva o foco à linha de estado, nunca ao body", async () => {
    estado.falha = true;
    await montar();
    await passar(500);
    estado.falha = false;
    estado.atrasoMs = 700;
    const tentar = botao("Tentar de novo")!;
    tentar.focus();
    await act(async () => tentar.click());
    await passar(400);
    expect(document.activeElement?.textContent?.trim()).toBe("Tentando de novo…");
    await passar(800);
    expect(naTela()).toContain("Alfa Uniformes");
    expect(document.activeElement).toBe(container.querySelector("[data-linha-de-estado]"));
  });
});

describe("a decisão que troca o alerta", () => {
  it("o alerta seguinte entra com o Enviar em repouso, e o foco vai ao título dele", async () => {
    await montar();
    await passar(200);
    expect(container.querySelector("section h2")?.textContent).toBe("Alfa Uniformes");
    const enviar = botao("Enviar ao cliente")!;
    enviar.focus();
    await act(async () => enviar.click());
    // A resposta chega aos 400 ms, entre os 300 ms do "Enviando…" e o mínimo de 500 ms.
    await passar(450);
    expect(estado.decisoes).toEqual(["al_alfa"]);
    expect(container.querySelector("section h2")?.textContent).toBe("Beta Brindes");
    for (const instante of [0, 200, 400]) {
      if (instante) await passar(200);
      const doSeguinte = botao("Enviar ao cliente")!;
      expect(doSeguinte.getAttribute("aria-busy"), `${instante} ms depois`).toBeNull();
      expect(doSeguinte.getAttribute("aria-disabled"), `${instante} ms depois`).toBeNull();
      expect(doSeguinte.querySelector("[data-atual]")?.textContent?.trim(), `${instante} ms depois`).toBe("Enviar ao cliente");
    }
    expect(document.activeElement).toBe(container.querySelector("section h2"));
    expect(document.activeElement?.textContent).toBe("Beta Brindes");
  });
});
