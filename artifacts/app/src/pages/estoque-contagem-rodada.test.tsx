// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Anunciador } from "@/lib/carregando/anunciador";
import { ProvedorDaConexao } from "@/lib/carregando/estado-da-conexao";
import { conexaoEm } from "@/test/conexao";

/**
 * Estoque › Contagem por caixa, a page da rodada (o registro da rodada,
 * 18/11/2026): a rodada aberta do cliente, lida de count_rounds; com
 * ?rodada=<id>, aquela rodada, só leitura (o "Ver" das anteriores); sem
 * rodada aberta e sem ?rodada, "Nenhuma contagem em andamento." com "Iniciar
 * contagem" (decisão 2 do Leonardo). As leituras da folha vêm vazias.
 */

type Rodadas = {
  aberta: Record<string, unknown> | null;
  anteriores: Array<Record<string, unknown>>;
  registradas: Array<Record<string, unknown>>;
  carregando: boolean;
  falhou: boolean;
};

const estado = vi.hoisted(() => ({
  rodadas: { aberta: null, anteriores: [], registradas: [], carregando: false, falhou: false } as Rodadas,
  busca: "",
}));

vi.mock("@/lib/active-customer-context", () => ({
  useActiveCustomer: () => ({ code: "BTG Pactual", active: { code: "BTG Pactual", name: "BTG" }, isLoading: false, falhou: false }),
}));
vi.mock("@/lib/warehouse-ops/use-contagem-por-caixa", () => ({
  useContagemPorCaixa: () => ({ prateleiras: [], carregando: false, falha: null, catalogoFalhou: false, leituras: [], tentar: async () => undefined }),
}));
vi.mock("@/lib/warehouse-ops/use-lista-de-separacao", () => ({
  useCaixasDoCliente: () => ({ data: [], isLoading: false, isError: false, error: null }),
}));
vi.mock("@/lib/warehouse-ops/use-recontagem", () => ({
  useLeiturasDaRodada: () => ({
    recontagens: [],
    guardas: [],
    separadas: [],
    carregando: false,
    falhou: false,
    leitura: { tentando: false, tentar: () => undefined, falta: null, lidaEm: 1 },
  }),
}));
vi.mock("@/lib/warehouse-ops/use-rodadas", () => ({
  useRodadasDaContagem: () => ({ ...estado.rodadas, leitura: { tentando: false, tentar: () => undefined, falta: null, lidaEm: 1 } }),
}));
vi.mock("wouter", async (original) => ({ ...(await original<typeof import("wouter")>()), useSearch: () => estado.busca }));

import PaginaRodadaDaContagem from "./estoque-contagem-rodada";

// O começo num dia fixo do passado: a hora de outro dia sai com o dia, em qualquer dia em que o teste rode.
const ABERTA = { id: "cr_1", cliente: "BTG Pactual", titulo: "Contagem geral · 10/11/2026", alcance: { tipo: "geral" }, status: "aberta", inicio: { quando: "2026-11-10T11:10:00.000Z", quem: "Rafael" }, fim: null, numeros: null };
const CONCLUIDA = {
  id: "cr_0",
  cliente: "BTG Pactual",
  titulo: "Contagem da rua A · 17/11/2026",
  alcance: { tipo: "rua", rua: "A" },
  status: "concluida",
  inicio: { quando: "2026-11-17T11:10:00.000Z", quem: "Rafael" },
  fim: { quando: "2026-11-21T14:00:00.000Z", quem: "Guilherme Dantas" },
  numeros: { prateleiras: 2, prateleirasContadas: 2, caixas: 3, caixasConfirmadas: 3, caixasComDiferenca: 0, diferenca: 0 },
};

let raiz: Root | null = null;
let container: HTMLDivElement;

const naTela = () => {
  const copia = document.body.cloneNode(true) as HTMLElement;
  copia.querySelector("[data-anunciador]")?.remove();
  return (copia.textContent ?? "").replace(/\s+/g, " ");
};

async function montar() {
  raiz = createRoot(container);
  await act(async () => {
    raiz!.render(
      <ProvedorDaConexao value={conexaoEm("conectado")}>
        <QueryClientProvider client={new QueryClient()}>
          <Anunciador />
          <PaginaRodadaDaContagem />
        </QueryClientProvider>
      </ProvedorDaConexao>,
    );
  });
}

/** Espera o estado chegar, nunca um tempo fixo (CLAUDE.md, "Carregamento v2"). */
async function esperar(condicao: () => boolean, oQue: string) {
  for (let volta = 0; volta < 300; volta += 1) {
    if (condicao()) return;
    await act(async () => {
      await new Promise((pronto) => setTimeout(pronto, 10));
    });
  }
  throw new Error(`Não aconteceu: ${oQue}`);
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  estado.rodadas = { aberta: null, anteriores: [], registradas: [], carregando: false, falhou: false };
  estado.busca = "";
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

describe("Estoque › Contagem por caixa, a page da rodada", () => {
  it("sem ?rodada e sem rodada aberta: diz que não há contagem, com Iniciar contagem para a entrada", async () => {
    await montar();
    await esperar(() => naTela().includes("Nenhuma contagem em andamento."), "a frase");
    expect(naTela()).toContain("Iniciar contagem");
    expect([...document.querySelectorAll('a[href="/wms/contagem"]')].some((link) => link.textContent?.includes("Iniciar contagem"))).toBe(true);
    expect(naTela()).not.toContain("começou");
  });

  it("com rodada aberta: a rodada dela, com o começo do registro", async () => {
    estado.rodadas = { ...estado.rodadas, aberta: ABERTA, registradas: [ABERTA] };
    await montar();
    await esperar(() => naTela().includes("Contagem geral · 10/11/2026"), "a rodada");
    expect(naTela()).toContain("começou 10/11 08:10 · Rafael");
    expect(naTela()).not.toContain("Nenhuma contagem em andamento.");
  });

  it("?rodada=<id>: aquela rodada, concluída, só leitura, mesmo com outra aberta", async () => {
    estado.busca = "rodada=cr_0";
    estado.rodadas = { ...estado.rodadas, aberta: ABERTA, registradas: [ABERTA, CONCLUIDA], anteriores: [CONCLUIDA] };
    await montar();
    await esperar(() => naTela().includes("Contagem da rua A · 17/11/2026"), "a rodada concluída");
    expect(naTela()).toContain("17/11 a 21/11 · Guilherme Dantas");
    expect(naTela()).not.toContain("começou");
    expect(naTela()).not.toContain("Contagem geral · 10/11/2026");
  });

  it("?rodada=<id> de uma rodada que não existe: diz que não há contagem, depois de ler", async () => {
    estado.busca = "rodada=cr_nao_existe";
    estado.rodadas = { ...estado.rodadas, aberta: ABERTA, registradas: [ABERTA] };
    await montar();
    await esperar(() => naTela().includes("Nenhuma contagem em andamento."), "a frase");
    expect(naTela()).not.toContain("Contagem geral · 10/11/2026");
  });
});
