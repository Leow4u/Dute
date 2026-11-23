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
  // As leituras da folha, das caixas e das recontagens da rodada: vazias, menos no "Ver" com a caixa movida.
  prateleiras: [] as unknown[],
  caixas: [] as unknown[],
  recontagens: [] as unknown[],
}));

vi.mock("@/lib/active-customer-context", () => ({
  useActiveCustomer: () => ({ code: "BTG Pactual", active: { code: "BTG Pactual", name: "BTG" }, isLoading: false, falhou: false }),
}));
vi.mock("@/lib/warehouse-ops/use-contagem-por-caixa", () => ({
  useContagemPorCaixa: () => ({ prateleiras: estado.prateleiras, carregando: false, falha: null, catalogoFalhou: false, leituras: [], tentar: async () => undefined }),
}));
vi.mock("@/lib/warehouse-ops/use-lista-de-separacao", () => ({
  useCaixasDoCliente: () => ({ data: estado.caixas, isLoading: false, isError: false, error: null }),
}));
vi.mock("@/lib/warehouse-ops/use-recontagem", () => ({
  useLeiturasDaRodada: () => ({
    recontagens: estado.recontagens,
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

import { warehouseBoxFromRecord } from "@/lib/warehouse-boxes";
import { prateleirasDaContagem } from "@/lib/warehouse-ops/contagem-por-caixa";
import type { Recontagem } from "@/lib/warehouse-ops/recontagem-por-caixa";

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
  estado.prateleiras = [];
  estado.caixas = [];
  estado.recontagens = [];
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
    // O cartão leva os números gravados no fechamento, os mesmos da linha de Anteriores (as leituras ao vivo vêm vazias).
    expect(naTela()).toContain("prateleiras2de 2");
    expect(naTela()).toContain("caixas3de 3");
    expect(naTela()).not.toContain("Contagem geral · 10/11/2026");
  });

  it("?rodada=<id> da rodada concluída: a caixa movida depois do fechamento aparece na prateleira em que foi contada", async () => {
    // A rodada da rua A recontou as duas caixas da A-01; depois do fechamento (21/11), o Mover levou a CX-000011 para a B-09.
    const caixa = (code: string, location_id: string, extra: Record<string, unknown> = {}) =>
      warehouseBoxFromRecord({ code, customer_code: "BTG Pactual", status: "stored", location_id, stored_at: "2026-10-20T12:00:00.000Z", unit_count: 60, origin: { kind: "opening_inventory", session_id: "s1" }, ...extra });
    const caixas = [caixa("CX-000010", "A-01"), caixa("CX-000011", "B-09", { moved_at: "2026-11-22T10:00:00.000Z", moved_from_location_id: "A-01" })];
    const recontada = (code: string, sku: string, quando: string): Recontagem => ({
      id: `brc_${code}`,
      caixa: code,
      posicao: "A-01",
      rodada: "cr_0",
      quando,
      quem: "Rafael",
      esperado: 60,
      contado: 60,
      diferenca: 0,
      vazia: false,
      itens: [{ sku, codigo: "", nome: sku, esperado: 60, contado: 60, diferenca: 0, foraDaLista: false, origens: [] }],
    });
    estado.busca = "rodada=cr_0";
    estado.rodadas = { ...estado.rodadas, registradas: [CONCLUIDA], anteriores: [CONCLUIDA] };
    estado.caixas = caixas;
    estado.prateleiras = prateleirasDaContagem({
      cliente: "BTG Pactual",
      posicoes: ["A-01", "B-09"].map((code, sequence) => ({ code, aisle: code[0], shelf: Number(code.slice(2)), sequence, customer_code: "BTG Pactual" })),
      caixas,
      abertura: [
        { box_code: "CX-000010", sku_code: "BTG-000121", client_item_code: "A.01.0806.005.P", product_name: "Polo Masculino Piquet Preto", size: "P", counted_qty: 60 },
        { box_code: "CX-000011", sku_code: "BTG-000123", client_item_code: "A.01.0806.005.M", product_name: "Polo Masculino Piquet Preto", size: "M", counted_qty: 60 },
      ],
      saldos: [],
    });
    estado.recontagens = [recontada("CX-000010", "BTG-000121", "2026-11-18T12:00:00.000Z"), recontada("CX-000011", "BTG-000123", "2026-11-18T12:05:00.000Z")];
    await montar();
    await esperar(() => naTela().includes("Contagem da rua A · 17/11/2026"), "a rodada concluída");
    const linhas = [...document.querySelectorAll('section[aria-labelledby^="rua-"] li')].map((linha) => (linha.textContent ?? "").replace(/\s+/g, " ").trim());
    // Antes: a A-01 com 1 caixa, e a CX-000011 fora da rodada, na B-09 (rua B).
    expect(linhas).toEqual(["A-012 caixas2 itens · 120 un.contada 18/11 09:05 · sem diferença"]);
  });

  it("?rodada=<id> da rodada concluída com a lista do fechamento: a caixa não recontada que o Mover levou duas vezes aparece onde estava", async () => {
    // No fechamento (21/11), a CX-000012 estava na A-02, sem recontagem; depois, o Mover a levou à B-09 e, de lá, à A-01.
    const caixa = (code: string, location_id: string, extra: Record<string, unknown> = {}) =>
      warehouseBoxFromRecord({ code, customer_code: "BTG Pactual", status: "stored", location_id, stored_at: "2026-10-20T12:00:00.000Z", unit_count: 60, origin: { kind: "opening_inventory", session_id: "s1" }, ...extra });
    const caixas = [caixa("CX-000010", "A-01"), caixa("CX-000012", "A-01", { moved_at: "2026-11-22T10:00:00.000Z", moved_from_location_id: "B-09" })];
    const gravada = {
      ...CONCLUIDA,
      numeros: { prateleiras: 2, prateleirasContadas: 1, caixas: 2, caixasConfirmadas: 1, caixasComDiferenca: 0, diferenca: 0 },
      caixasGravadas: [
        { code: "CX-000010", location_id: "A-01", status: "stored", sku_codes: ["BTG-000121"] },
        { code: "CX-000012", location_id: "A-02", status: "stored", sku_codes: ["BTG-000121"] },
      ],
    };
    estado.busca = "rodada=cr_0";
    estado.rodadas = { ...estado.rodadas, registradas: [gravada], anteriores: [gravada] };
    estado.caixas = caixas;
    estado.prateleiras = prateleirasDaContagem({
      cliente: "BTG Pactual",
      posicoes: ["A-01", "B-09"].map((code, sequence) => ({ code, aisle: code[0], shelf: Number(code.slice(2)), sequence, customer_code: "BTG Pactual" })),
      caixas,
      abertura: [
        { box_code: "CX-000010", sku_code: "BTG-000121", client_item_code: "A.01.0806.005.P", product_name: "Polo Masculino Piquet Preto", size: "P", counted_qty: 60 },
        { box_code: "CX-000012", sku_code: "BTG-000121", client_item_code: "A.01.0806.005.P", product_name: "Polo Masculino Piquet Preto", size: "P", counted_qty: 60 },
      ],
      saldos: [],
    });
    estado.recontagens = [
      {
        id: "brc_CX-000010",
        caixa: "CX-000010",
        posicao: "A-01",
        rodada: "cr_0",
        quando: "2026-11-18T12:00:00.000Z",
        quem: "Rafael",
        esperado: 60,
        contado: 60,
        diferenca: 0,
        vazia: false,
        itens: [{ sku: "BTG-000121", codigo: "", nome: "BTG-000121", esperado: 60, contado: 60, diferenca: 0, foraDaLista: false, origens: [] }],
      } satisfies Recontagem,
    ];
    await montar();
    await esperar(() => naTela().includes("Contagem da rua A · 17/11/2026"), "a rodada concluída");
    const linhas = [...document.querySelectorAll('section[aria-labelledby^="rua-"] li')].map((linha) => (linha.textContent ?? "").replace(/\s+/g, " ").trim());
    // Sem a lista: a CX-000012 na B-09, de onde o último mover a tirou (rua B, fora da rodada), e a A-02 fora.
    expect(linhas).toEqual(["A-011 caixa1 item · 60 un.contada 18/11 09:00 · sem diferença", "A-021 caixa1 item · 60 un."]);
  });

  it("?rodada=<id> de uma rodada que não existe: diz que não há contagem, depois de ler", async () => {
    estado.busca = "rodada=cr_nao_existe";
    estado.rodadas = { ...estado.rodadas, aberta: ABERTA, registradas: [ABERTA] };
    await montar();
    await esperar(() => naTela().includes("Nenhuma contagem em andamento."), "a frase");
    expect(naTela()).not.toContain("Contagem geral · 10/11/2026");
  });
});
