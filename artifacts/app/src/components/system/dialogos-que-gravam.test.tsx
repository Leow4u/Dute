// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A Tabela do faturamento (Infra) e os Preços e orçamento do Agent Dute
 * (owner), no Sistema (carregamento v2, parte 13a): o diálogo segura enquanto
 * o POST grava, e o POST que valeu fecha o diálogo na hora. A releitura do
 * painel (a do Infra consulta o Google Cloud e pode demorar) segue por trás:
 * antes, o diálogo esperava por ela, "Salvando…" e preso. Dados sintéticos.
 */

const estado = vi.hoisted(() => ({ leituras: {} as Record<string, number>, posts: 0, toasts: [] as unknown[] }));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: (aviso: unknown) => estado.toasts.push(aviso) }) }));

import { InfraSection } from "./infra-panels";
import { OwnerDashboard } from "./owner-dashboard";

const INFRA = {
  checked_at: "2026-11-13T12:00:00Z",
  settings: { billing_table: null },
  errors: { status: "ok", total: 0, blocked: 0, services: 0, groups: [] },
  functions: { status: "ok", total: 1, ok: 1, sem_acesso: 0, nao_publicada: 0, codebases: ["default"], last_deploy_at: null, list: [] },
  latency: { status: "ok", total: 0, services: [] },
  billing: { status: "not_configured" },
};

const PAINEL = {
  generated_at: "2026-11-13T12:00:00Z",
  settings: { input_per_million: 0, output_per_million: 0, monthly_budget: null },
  usage: {
    priced: false,
    month: { cost: 0, by_kind: {}, projection: 0, budget: null, over_budget: false },
    days: [
      { day: "2026-11-12", cost: 0, count: 0 },
      { day: "2026-11-13", cost: 0, count: 0 },
    ],
    week: { count: 0, avg_latency_ms: null, fallback: 0, failed: 0, by_role: [] },
    today: { count: 0, fallback: 0, failed: 0 },
    problems: [],
  },
  usage_truncated: false,
  routines: { list: [], active: 0, failed: 0, problems: [] },
};

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  estado.leituras = {};
  estado.posts = 0;
  estado.toasts = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        estado.posts += 1;
        return { ok: true, json: async () => ({ ok: true }) };
      }
      estado.leituras[url] = (estado.leituras[url] ?? 0) + 1;
      // A primeira leitura chega; a releitura depois do salvar fica parada.
      if (estado.leituras[url] > 1) return new Promise(() => {});
      if (url === "/api/system/infra") return { ok: true, json: async () => INFRA };
      if (url === "/api/system/dashboard") return { ok: true, json: async () => PAINEL };
      return { ok: true, json: async () => ({}) };
    }),
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  container?.remove();
  container = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const espera = (ms: number) => act(async () => new Promise((pronto) => setTimeout(pronto, ms)));
const dialogo = () => document.querySelector<HTMLElement>('[role="dialog"]');
const botao = (texto: string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
    (elemento) => elemento.textContent?.trim() === texto || elemento.querySelector(".botao-acao-camada[data-atual]")?.textContent?.trim() === texto,
  );

async function salvarCom(tela: ReactNode, abrir: string, titulo: string) {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => raiz!.render(<QueryClientProvider client={cliente}>{tela}</QueryClientProvider>));
  await espera(30);
  await act(async () => botao(abrir)!.click());
  await espera(20);
  expect(dialogo()?.textContent).toContain(titulo);
  await act(async () => botao("Salvar")!.click());
  await espera(100);
}

describe("o diálogo do Sistema que gravou", () => {
  it("Tabela do faturamento: o POST que valeu fecha na hora, sem esperar a releitura do Infra", async () => {
    await salvarCom(<InfraSection agentMonthCost={null} />, "Informar a tabela do faturamento", "Tabela do faturamento");
    expect(estado.posts).toBe(1);
    // A releitura saiu e ainda não voltou.
    expect(estado.leituras["/api/system/infra"]).toBe(2);
    expect(dialogo()).toBeNull();
    expect(estado.toasts).toContainEqual({ title: "Tabela do faturamento removida" });
  });

  it("Preços e orçamento: o POST que valeu fecha na hora, sem esperar a releitura do painel", async () => {
    await salvarCom(<OwnerDashboard />, "Informar preços", "Preços e orçamento do Agent Dute");
    expect(estado.posts).toBe(1);
    expect(estado.leituras["/api/system/dashboard"]).toBe(2);
    expect(dialogo()).toBeNull();
    expect(estado.toasts).toContainEqual({ title: "Preços e orçamento salvos" });
  });
});
