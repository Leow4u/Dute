// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

import { ProvedorDaConexao, type EstadoDaConexao } from "@/lib/carregando/estado-da-conexao";
import { resolveOperationProfile } from "@/lib/operations";
import { conexaoEm } from "@/test/conexao";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosForaDaLista } from "@/test/textos";

/**
 * Faturas do portal enquanto as NFs dos serviços chegam (carregamento v2,
 * parte 13f; necessidade 3 do diagnóstico, seção 5). Antes: sem fatura
 * fechada, a tela dizia "Nenhuma fatura fechada ainda" enquanto as NFs ainda
 * eram lidas, e a falha delas era descartada (a tela dizia o mesmo vazio).
 * Dados sintéticos.
 */

const estado = vi.hoisted(() => ({
  nfs: { nfs: null as unknown[] | null, erro: false, tentando: false, tentar: () => undefined as void } as {
    nfs: unknown[] | null;
    erro: boolean;
    tentando: boolean;
    tentar: () => void;
    falta?: "conexao" | "servidor" | null;
    lidaEm?: number | null;
  },
  tentativas: 0,
}));

vi.mock("@/lib/auth", () => ({
  useAppUser: () => ({ user: { uid: "c1", fullName: "Cliente Teste", publicMetadata: { role: "cliente", customer_code: "ACME" } } }),
}));
vi.mock("@/lib/operation-profile", () => ({
  useOperationProfile: () => ({
    profile: resolveOperationProfile({ customer_code: "ACME", operation_template: "uniformes", modules: ["wms", "financeiro"] }),
    isLoading: false,
  }),
}));
vi.mock("@/lib/portal/use-servicos", () => ({ useNfsDoCliente: () => estado.nfs }));
vi.mock("./shared", async (importOriginal) => {
  const original = await importOriginal<typeof import("./shared")>();
  return {
    ...original,
    ClientDataBoundary: ({ children }: { children: (overview: Record<string, unknown>) => React.ReactNode }) => <>{children({})}</>,
  };
});

import { ClienteFaturas } from "./faturas";

let raiz: Root | null = null;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  estado.tentativas = 0;
  container = document.createElement("div");
  document.body.append(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const espera = (ms: number) => act(async () => new Promise((pronto) => setTimeout(pronto, ms)));

async function ate(condicao: () => unknown, limiteMs = 3_000) {
  const fim = Date.now() + limiteMs;
  while (!condicao()) {
    if (Date.now() > fim) throw new Error("A tela não chegou ao estado esperado em 3 s.");
    await espera(20);
  }
}

async function montar(nfs: typeof estado.nfs, conexao: EstadoDaConexao = "conectado") {
  estado.nfs = nfs;
  await act(async () =>
    raiz!.render(
      <ProvedorDaConexao value={conexaoEm(conexao)}>
        <QueryClientProvider client={new QueryClient()}>
          <Router>
            <ClienteFaturas />
          </Router>
        </QueryClientProvider>
      </ProvedorDaConexao>,
    ),
  );
}

const VAZIO = "Nenhuma fatura fechada ainda. Quando a Dutelog emitir a fatura do mês, ela aparece aqui com o detalhamento.";
const DESCRICAO = "Quanto a operação na Dutelog custa, mês a mês, e o que compõe cada fatura.";
const botao = (rotulo: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim() === rotulo);

describe("Faturas do portal antes de ler as NFs", () => {
  it("nunca dizem que não há fatura enquanto as NFs chegam; aos 300 ms, a caixa e o rótulo", async () => {
    await montar({ nfs: null, erro: false, tentando: false, tentar: () => undefined });
    expect(container.textContent).not.toContain("Nenhuma fatura fechada ainda");
    await ate(() => container.textContent?.includes("Carregando as NFs dos serviços…"));
    expect(container.textContent).not.toContain("Nenhuma fatura fechada ainda");
    expect(container.querySelector("[data-carregando-na-regiao] [data-spinner]")?.getAttribute("aria-hidden")).toBe("true");
    const html = container.innerHTML;
    expect(textosForaDaLista(html, ["Faturas", DESCRICAO, "Carregando as NFs dos serviços…"])).toEqual([]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("a falha das NFs fica dita, com 'Tentar de novo', e não vira o vazio", async () => {
    await montar({
      nfs: null,
      erro: true,
      tentando: false,
      tentar: () => {
        estado.tentativas += 1;
      },
    });
    expect(container.textContent).toContain("Não foi possível carregar as NFs dos serviços.");
    expect(container.textContent).not.toContain("Nenhuma fatura fechada ainda");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Não foi possível carregar as NFs dos serviços.");
    await act(async () => botao("Tentar de novo")!.click());
    expect(estado.tentativas).toBe(1);
    const html = container.innerHTML;
    expect(textosForaDaLista(html, ["Faturas", DESCRICAO, "Não foi possível carregar as NFs dos serviços.", "Tentar de novo", "Tentando de novo…"])).toEqual([]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("lidas e sem nenhuma, aí sim o vazio", async () => {
    await montar({ nfs: [], erro: false, tentando: false, tentar: () => undefined });
    expect(container.textContent).toContain(VAZIO);
  });
});

describe("Faturas do portal sem conexão (carregamento v2, parte 13j)", () => {
  it("as NFs sem conexão: o aviso da conexão, nunca a falha da seção nem o vazio; só os rótulos da falta; axe", async () => {
    for (const conexao of ["sem-conexao", "reconectando"] as const) {
      // Uma tela por estado da conexão: a mesma tela que passa de "Sem conexão" a "Reconectando" segura o aviso 2 s.
      act(() => raiz?.unmount());
      raiz = createRoot(container);
      await montar({ nfs: null, erro: true, tentando: false, tentar: () => undefined, falta: "conexao", lidaEm: null }, conexao);
      const aviso = conexao === "sem-conexao" ? "Sem conexão." : "Reconectando…";
      expect(container.textContent, conexao).toContain(aviso);
      expect(container.textContent, conexao).not.toMatch(/Não foi possível carregar as NFs|Nenhuma fatura fechada ainda/);
      const html = container.innerHTML;
      expect(textosForaDaLista(html, ["Faturas", DESCRICAO, aviso, "Tentar de novo"]), conexao).toEqual([]);
      expect(await violacoesDeAcessibilidade(html), conexao).toEqual([]);
    }
  });
});
