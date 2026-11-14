// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Financeiro › Emissões com as duas listas lidas e as duas releituras que
 * falham por motivos diferentes (carregamento v2, parte 13m). Antes, com as
 * emissões relidas sem conexão e as baixas recusadas pelo servidor, a faixa
 * da conexão escondia o "Não foi possível atualizar as emissões.": a recusa
 * do servidor sumia da tela. Agora as duas faltas aparecem, a da conexão (a
 * faixa com a hora) e a do servidor (a frase com "Tentar de novo"), sem uma
 * tirar a outra. Dados sintéticos.
 */

const estado = vi.hoisted(() => ({
  /** Como cada lista responde agora. */
  emissoes: "ok" as "ok" | "sem-conexao" | "servidor",
  baixas: "ok" as "ok" | "sem-conexao" | "servidor",
}));

vi.mock("@/lib/liberacao", async (original) => ({
  ...(await original<typeof import("@/lib/liberacao")>()),
  FINANCEIRO_LIBERADO: true,
  OMIE_LIBERADA: true,
}));
vi.mock("@/lib/auth", () => ({
  useAppUser: () => ({ user: { uid: "fin-1", fullName: "Pessoa do financeiro", publicMetadata: { role: "financeiro" } }, isLoaded: true }),
}));
vi.mock("@/lib/financeiro/api", async () => {
  const { SemConexao } = await vi.importActual<typeof import("@/lib/conexao")>("@/lib/conexao");
  const responder = (como: "ok" | "sem-conexao" | "servidor", corpo: unknown) => {
    if (como === "sem-conexao") throw new SemConexao();
    if (como === "servidor") throw new Error("Falha interna no servidor. Tente novamente ou avise o time técnico.");
    return corpo;
  };
  return {
    novaChave: () => "k-1",
    chamarFinanceiro: async (nome: string) => {
      if (nome === "listNfSettlements") return responder(estado.baixas, { baixas: [] });
      if (nome === "listNfEmissions") {
        return responder(estado.emissoes, {
          emissoes: [
            {
              id: "nfe_00000000000000000001",
              customer_code: "ITAU",
              customer_name: "Itaú Unibanco",
              etapa: "autorizada",
              motivo_da_parada: null,
              mensagem: null,
              mensagens_da_prefeitura: [],
              demandas: ["10045"],
              armazenagem: [],
              total_cents: 100_000,
              vencimento: "2026-11-20",
              nfse: "815",
              url_nfse: null,
              url_pdf: null,
              criada_em: "2026-10-23T12:00:00.000Z",
              edicao: 4,
            },
          ],
        });
      }
      return {};
    },
  };
});

import { ProvedorDaConexao } from "@/lib/carregando/estado-da-conexao";
import { CHAVE_DAS_BAIXAS } from "@/lib/financeiro/use-baixas";
import { CHAVE_DAS_EMISSOES } from "@/lib/financeiro/use-emissoes";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { conexaoEm } from "@/test/conexao";
import { textosDaTela } from "@/test/textos";

import FinanceiroEmissoes from "./emissoes";

let raiz: Root | null = null;
let container: HTMLDivElement;
let cliente: QueryClient;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  estado.emissoes = "ok";
  estado.baixas = "ok";
  container = document.createElement("div");
  document.body.appendChild(container);
  cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  container.remove();
  cliente.clear();
  vi.unstubAllGlobals();
});

async function montarERelerCom(emissoes: typeof estado.emissoes, baixas: typeof estado.baixas) {
  await act(async () => {
    raiz!.render(
      <ProvedorDaConexao value={conexaoEm(emissoes === "sem-conexao" || baixas === "sem-conexao" ? "sem-conexao" : "conectado")}>
        <QueryClientProvider client={cliente}>
          <FinanceiroEmissoes />
        </QueryClientProvider>
      </ProvedorDaConexao>,
    );
  });
  await vi.waitFor(() => expect(container.textContent).toContain("Itaú Unibanco"), { timeout: 3_000 });
  // As listas lidas; a releitura do intervalo (a de depois da ação) falha em cada uma pelo seu motivo.
  estado.emissoes = emissoes;
  estado.baixas = baixas;
  await act(async () => {
    await Promise.all([cliente.refetchQueries({ queryKey: CHAVE_DAS_EMISSOES }), cliente.refetchQueries({ queryKey: CHAVE_DAS_BAIXAS })]);
  });
  await vi.waitFor(
    () => {
      expect(cliente.getQueryState(CHAVE_DAS_EMISSOES)?.status).toBe(emissoes === "ok" ? "success" : "error");
      expect(cliente.getQueryState(CHAVE_DAS_BAIXAS)?.status).toBe(baixas === "ok" ? "success" : "error");
      expect(cliente.isFetching()).toBe(0);
    },
    { timeout: 3_000 },
  );
  // A tela assenta (a resposta chega ao React): o que ela mostra para de mudar.
  let antes = "";
  await vi.waitFor(
    () => {
      const agora = container.innerHTML;
      const parou = agora === antes;
      antes = agora;
      expect(parou).toBe(true);
    },
    { timeout: 3_000, interval: 20 },
  );
  return textosDaTela(container.innerHTML);
}

describe("Emissões com uma lista sem conexão e a outra recusada pelo servidor (parte 13m)", () => {
  it("as duas faltas aparecem: a faixa da conexão e a frase do servidor", async () => {
    const textos = await montarERelerCom("sem-conexao", "servidor");
    expect(textos.some((texto) => /^Sem conexão · lista de \d\d:\d\d$/.test(texto))).toBe(true);
    expect(textos).toContain("Não foi possível atualizar as emissões.");
    // As emissões lidas ficam na tela.
    expect(textos).toContain("Itaú Unibanco · NFS-e 815");
    expect(await violacoesDeAcessibilidade(container.innerHTML)).toEqual([]);
  });

  it("ao contrário, também: as emissões recusadas e as baixas sem conexão", async () => {
    const textos = await montarERelerCom("servidor", "sem-conexao");
    expect(textos.some((texto) => /^Sem conexão · lista de \d\d:\d\d$/.test(texto))).toBe(true);
    expect(textos).toContain("Não foi possível atualizar as emissões.");
  });

  it("as duas sem conexão: só a faixa, e não a frase do servidor", async () => {
    const textos = await montarERelerCom("sem-conexao", "sem-conexao");
    expect(textos.some((texto) => /^Sem conexão · lista de \d\d:\d\d$/.test(texto))).toBe(true);
    expect(textos).not.toContain("Não foi possível atualizar as emissões.");
  });

  it("só o servidor: a frase, sem a faixa", async () => {
    const textos = await montarERelerCom("servidor", "ok");
    expect(textos).toContain("Não foi possível atualizar as emissões.");
    expect(textos.join(" ")).not.toMatch(/Sem conexão|Reconectando/);
  });
});
