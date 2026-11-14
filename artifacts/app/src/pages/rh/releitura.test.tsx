// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A releitura que falha não apaga o que já foi lido no RH (carregamento v2,
 * necessidade 8; revisão da parte 13g). O painel relê a cada 5 minutos e
 * depois de cada gravação; quando essa releitura falhava, a lista de pessoas
 * saía da tela e dava lugar ao alerta, com o contador em "—". Agora a lista
 * fica, e "Não foi possível atualizar as pessoas." fica escrita em cima dela,
 * sem falar, com "Tentar de novo". O mesmo nas exportações. Dados sintéticos.
 */

const estado = vi.hoisted(() => ({ falhar: false, chamadas: 0 }));
vi.mock("@/lib/liberacao", async (original) => ({ ...(await original<typeof import("@/lib/liberacao")>()), RH_LIBERADO: true }));
vi.mock("@/lib/rh/navegacao", async (original) => {
  const real = await original<typeof import("@/lib/rh/navegacao")>();
  return { ...real, abreRh: (role: unknown) => real.abreRh(role as never, true) };
});
vi.mock("@/lib/auth", () => ({ useAppUser: () => ({ user: { uid: "u1", publicMetadata: { role: "rh" } }, isLoaded: true }) }));
vi.mock("@/lib/rh/api", async (original) => ({
  ...(await original<typeof import("@/lib/rh/api")>()),
  chamarRh: async (nome: string) => {
    estado.chamadas += 1;
    if (estado.falhar) throw new Error("unavailable");
    if (nome === "listRhExports") {
      return {
        exportacoes: [
          { id: "exp_2026-09_v1", competencia: "2026-09", versao: 1, exames: 3, colaboradores: 2, gerada_em: "2026-10-01T12:00:00.000Z", gerada_por: "Ana" },
        ],
      };
    }
    return {
      hoje: "2026-11-14",
      colaboradores: [
        { id: "col_aaaaaaaaaaaaaaaa", nome: "Ana Souza", funcao: "Montadora", vinculo: "proprio", ativo: true, registros: 1, vencendo: 0, vencidos: 0, proximo_vencimento: null, admissao: null, desligamento: null },
      ],
      vencimentos: [],
    };
  },
}));

import RhPessoas from "@/pages/rh/pessoas";
import { CHAVE_DAS_EXPORTACOES, CHAVE_DO_PAINEL } from "@/lib/rh/use-rh";

let raiz: Root | null = null;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  estado.falhar = false;
  estado.chamadas = 0;
  container = document.createElement("div");
  document.body.append(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const espera = (ms: number) => act(async () => new Promise((pronto) => setTimeout(pronto, ms)));

async function montar(tela: React.ReactNode, cliente: QueryClient) {
  await act(async () =>
    raiz!.render(
      <Router>
        <QueryClientProvider client={cliente}>{tela}</QueryClientProvider>
      </Router>,
    ),
  );
}

describe("RH: a releitura que falha não apaga a lista", () => {
  it("Pessoas: a lista e o contador ficam, e a frase da falha fica escrita em cima, sem alerta, com Tentar de novo", async () => {
    const cliente = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
    await montar(<RhPessoas />, cliente);
    for (let i = 0; i < 20 && !container.textContent?.includes("Ana Souza"); i += 1) await espera(20);
    expect(container.textContent).toContain("Ana Souza");

    estado.falhar = true;
    await act(async () => {
      await cliente.refetchQueries({ queryKey: CHAVE_DO_PAINEL });
    });
    await espera(50);
    expect(container.textContent).toContain("Ana Souza");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain("Não foi possível atualizar as pessoas.");
    expect(container.textContent).not.toContain("—");
    const tentar = [...container.querySelectorAll("button")].find((botao) => botao.textContent === "Tentar de novo");
    expect(tentar).toBeTruthy();

    // A nova tentativa que dá certo tira a frase, e a lista continua.
    estado.falhar = false;
    await act(async () => tentar!.click());
    for (let i = 0; i < 20 && container.textContent?.includes("Não foi possível atualizar"); i += 1) await espera(20);
    expect(container.textContent).not.toContain("Não foi possível atualizar as pessoas.");
    expect(container.textContent).toContain("Ana Souza");
  });

  it("Exportação: as versões lidas ficam quando a releitura falha", async () => {
    const { default: RhExportacao } = await import("@/pages/rh/exportacao");
    const cliente = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
    await montar(<RhExportacao />, cliente);
    for (let i = 0; i < 20 && !container.textContent?.includes("Setembro de 2026"); i += 1) await espera(20);
    expect(container.textContent).toContain("Setembro de 2026 · versão 1");

    estado.falhar = true;
    await act(async () => {
      await cliente.refetchQueries({ queryKey: CHAVE_DAS_EXPORTACOES });
    });
    await espera(50);
    expect(container.textContent).toContain("Setembro de 2026 · versão 1");
    expect(container.textContent).toContain("Não foi possível atualizar as exportações.");
    expect(container.textContent).not.toContain("Não foi possível carregar as exportações.");
  });
});
