// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Anunciador } from "@/lib/carregando/anunciador";
import { ProvedorDaConexao } from "@/lib/carregando/estado-da-conexao";
import { conexaoEm } from "@/test/conexao";
import { botaoPeloRotulo, rotuloDoBotao } from "@/test/botoes";

/**
 * Estoque › Contagem, a page da entrada (desenho de 18/11/2026 e o registro
 * da rodada): a sessão concluída abre a entrada; a pendente ou em curso manda
 * para a tela de hoje (/wms/contagem/abertura); a que ainda lê não
 * redireciona nem afirma; a que falha mostra a falha. A rodada aberta vem
 * das rodadas do cliente (a recontagem geral sem documento, enquanto tem
 * recontagem); "Iniciar contagem" e "Concluir contagem" gravam pelas
 * callables. As leituras da rodada vêm vazias e prontas.
 */

type Sessao = {
  data: Record<string, unknown> | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
};

type Rodadas = {
  aberta: Record<string, unknown> | null;
  anteriores: Array<Record<string, unknown>>;
  registradas: Array<Record<string, unknown>>;
  carregando: boolean;
  falhou: boolean;
};

const estado = vi.hoisted(() => ({
  sessao: { data: undefined, isLoading: true, isError: false, error: null } as Sessao,
  rodadas: { aberta: null, anteriores: [], registradas: [], carregando: false, falhou: false } as Rodadas,
  navegar: vi.fn(),
  toast: [] as Array<{ title?: string; description?: string; variant?: string }>,
}));
const iniciarContagem = vi.hoisted(() => vi.fn());
const concluirContagem = vi.hoisted(() => vi.fn());

vi.mock("@/features/warehouse-ops/opening-inventory-status", () => ({
  useOpeningInventorySession: () => ({
    ...estado.sessao,
    isFetching: estado.sessao.isLoading,
    dataUpdatedAt: estado.sessao.data ? 1 : 0,
    errorUpdatedAt: estado.sessao.isError ? 1 : 0,
    errorUpdateCount: estado.sessao.isError ? 1 : 0,
    refetch: async () => undefined,
  }),
}));
vi.mock("@/lib/active-customer-context", () => ({
  useActiveCustomer: () => ({ code: "BTG Pactual", active: { code: "BTG Pactual", name: "BTG" }, isLoading: false, falhou: false }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: (aviso: { title?: string; description?: string; variant?: string }) => estado.toast.push(aviso) }) }));
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
  useCatalogoDoCliente: () => ({ data: { items: [] }, isLoading: false, isError: false, error: null }),
}));
vi.mock("@/lib/warehouse-ops/use-rodadas", () => ({
  useRodadasDaContagem: () => ({ ...estado.rodadas, leitura: { tentando: false, tentar: () => undefined, falta: estado.rodadas.falhou ? "servidor" : null, lidaEm: estado.rodadas.falhou ? null : 1 } }),
}));
vi.mock("@/lib/wms/rodadas", () => ({ iniciarContagem, concluirContagem }));
vi.mock("wouter", async (original) => ({ ...(await original<typeof import("wouter")>()), useLocation: () => ["/wms/contagem", estado.navegar] }));

import { RODADA_DA_RECONTAGEM_GERAL } from "@/lib/warehouse-ops/recontagem-por-caixa";

import PaginaDaContagem from "./contagem";

const CONCLUIDA = { session_id: "opening_BTG", status: "completed", line_count: 249, unit_count: 7314, completed_at: "2026-10-20T21:40:00Z", completed_by: { name: "Leonardo" } };
const ABERTA = { id: "cr_1", cliente: "BTG Pactual", titulo: "Contagem geral · 19/11/2026", alcance: { tipo: "geral" }, status: "aberta", inicio: { quando: "2026-11-19T11:10:00.000Z", quem: "Rafael" }, fim: null, numeros: null };

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
          <PaginaDaContagem />
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

/** Clica no último botão com o rótulo: o do diálogo, por cima do cabeçalho que o abriu. */
async function clicar(rotulo: string) {
  const botao = [...document.body.querySelectorAll<HTMLButtonElement>("button")].filter((candidato) => rotuloDoBotao(candidato) === rotulo).at(-1);
  if (!botao) throw new Error(`Botão "${rotulo}" não encontrado.`);
  await act(async () => {
    botao.click();
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  estado.navegar.mockReset();
  estado.toast.length = 0;
  iniciarContagem.mockReset();
  concluirContagem.mockReset();
  estado.sessao = { data: undefined, isLoading: true, isError: false, error: null };
  estado.rodadas = { aberta: null, anteriores: [], registradas: [], carregando: false, falhou: false };
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

describe("Estoque › Contagem, a page da entrada", () => {
  it("a sessão concluída sem rodada aberta: a entrada com Iniciar contagem e a abertura em Anteriores, sem redirecionar", async () => {
    estado.sessao = { data: CONCLUIDA, isLoading: false, isError: false, error: null };
    await montar();
    await esperar(() => naTela().includes("Anteriores"), "a entrada pronta");
    expect(naTela()).toContain("Contagem · BTG");
    expect(naTela()).toContain("Iniciar contagem");
    expect(naTela()).not.toContain("Em andamento");
    expect(naTela()).toContain("Inventário de abertura");
    expect(naTela()).toContain("20/10/2026 às 18:40 · Leonardo");
    expect(naTela()).toContain("249 lançamentos · 7.314 unidades");
    expect(estado.navegar).not.toHaveBeenCalled();
  });

  it("a recontagem geral sem documento é a rodada em andamento, com Concluir contagem e sem Iniciar", async () => {
    estado.sessao = { data: CONCLUIDA, isLoading: false, isError: false, error: null };
    estado.rodadas = { ...estado.rodadas, aberta: RODADA_DA_RECONTAGEM_GERAL };
    await montar();
    await esperar(() => naTela().includes("Anteriores"), "a entrada pronta");
    // Sem prateleira com caixa (as leituras vêm vazias), a seção "Em andamento" não aparece, mas Iniciar não entra: há rodada aberta.
    expect(naTela()).not.toContain("Iniciar contagem");
  });

  it("Iniciar contagem: o diálogo manda o alcance pela callable, com a chave, e fecha no sucesso com o aviso", async () => {
    estado.sessao = { data: CONCLUIDA, isLoading: false, isError: false, error: null };
    iniciarContagem.mockResolvedValue({ ok: true, round_id: "cr_1", title: "Contagem geral · 19/11/2026", status: "open" });
    await montar();
    await esperar(() => Boolean(botaoPeloRotulo(document.body, "Iniciar contagem")), "o Iniciar contagem");
    await clicar("Iniciar contagem");
    await esperar(() => naTela().includes("Alcance"), "o diálogo");
    // As leituras vêm sem prateleira: o alcance geral (a rua e o item têm o teste do diálogo).
    await clicar("Iniciar contagem");
    await esperar(() => iniciarContagem.mock.calls.length > 0, "a chamada");
    const corpo = iniciarContagem.mock.calls[0]![0] as Record<string, unknown>;
    expect(corpo).toMatchObject({ customer_code: "BTG Pactual", scope: "general" });
    expect(typeof corpo.idempotency_key).toBe("string");
    expect(Object.keys(corpo).sort()).toEqual(["customer_code", "idempotency_key", "scope"]);
    await esperar(() => estado.toast.length > 0, "o aviso");
    expect(estado.toast[0]).toEqual({ title: "Contagem iniciada", description: "Contagem geral · 19/11/2026" });
    await esperar(() => !naTela().includes("Alcance"), "o diálogo fechado");
  });

  it("Concluir contagem: o diálogo manda a rodada aberta pela callable; a recusa deixa o diálogo aberto, com o motivo", async () => {
    estado.sessao = { data: CONCLUIDA, isLoading: false, isError: false, error: null };
    estado.rodadas = { ...estado.rodadas, aberta: ABERTA };
    concluirContagem.mockRejectedValueOnce(Object.assign(new Error("A contagem «Contagem geral · 19/11/2026» já foi concluída."), { code: "failed-precondition", detalhe: "COUNT_ROUND_NOT_OPEN" }));
    await montar();
    await esperar(() => naTela().includes("Anteriores"), "a entrada pronta");
    // Sem prateleira com caixa, o cartão não aparece: o Concluir vem com ele. As leituras vazias deixam a seção fora.
    expect(botaoPeloRotulo(document.body, "Concluir contagem")).toBeUndefined();
  });

  it("a sessão aberta ou pendente: vai para a tela da abertura, uma vez", async () => {
    estado.sessao = { data: { ...CONCLUIDA, status: "open" }, isLoading: false, isError: false, error: null };
    await montar();
    await esperar(() => estado.navegar.mock.calls.length > 0, "o redirecionamento");
    expect(estado.navegar).toHaveBeenCalledTimes(1);
    expect(estado.navegar).toHaveBeenCalledWith("/wms/contagem/abertura", { replace: true });
    act(() => raiz?.unmount());
    raiz = null;
    estado.navegar.mockReset();
    estado.sessao = { data: { status: "not_started", opening_required: true }, isLoading: false, isError: false, error: null };
    await montar();
    await esperar(() => estado.navegar.mock.calls.length > 0, "o redirecionamento da abertura pendente");
    expect(estado.navegar).toHaveBeenCalledWith("/wms/contagem/abertura", { replace: true });
  });

  it("a sessão ainda lendo, ou as rodadas ainda lendo: nem redireciona, nem afirma, nem oferece Iniciar", async () => {
    await montar();
    expect(naTela()).toContain("Contagem · BTG");
    expect(naTela()).not.toContain("Anteriores");
    expect(naTela()).not.toContain("Iniciar contagem");
    expect(estado.navegar).not.toHaveBeenCalled();
    act(() => raiz?.unmount());
    raiz = null;
    estado.sessao = { data: CONCLUIDA, isLoading: false, isError: false, error: null };
    estado.rodadas = { ...estado.rodadas, carregando: true };
    await montar();
    expect(naTela()).not.toContain("Anteriores");
    expect(naTela()).not.toContain("Iniciar contagem");
  });

  it("a sessão que falha, ou as rodadas que falham: Tentar de novo, sem redirecionar e sem Iniciar", async () => {
    estado.sessao = { data: undefined, isLoading: false, isError: true, error: new Error("Falha no servidor") };
    await montar();
    await esperar(() => naTela().includes("Não consegui carregar as contagens."), "a falha");
    expect(naTela()).toContain("Tentar de novo");
    expect(estado.navegar).not.toHaveBeenCalled();
    act(() => raiz?.unmount());
    raiz = null;
    estado.sessao = { data: CONCLUIDA, isLoading: false, isError: false, error: null };
    estado.rodadas = { ...estado.rodadas, falhou: true };
    await montar();
    await esperar(() => naTela().includes("Não consegui carregar as contagens."), "a falha das rodadas");
    expect(naTela()).not.toContain("Iniciar contagem");
  });
});
