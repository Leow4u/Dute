// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

/**
 * A ficha do RH com as callables de mentira (parte 8.2d e a correção da
 * revisão): depois de uma gravação que falha, a ficha é lida de novo, e a
 * próxima tentativa leva a edição nova; com o formulário aberto, as ações das
 * linhas ficam travadas.
 */

const COL = "col_aaaaaaaaaaaaaaaa";

const estado = vi.hoisted(() => ({
  chamadas: [] as Array<{ nome: string; dados: Record<string, unknown> }>,
  leiturasDaFicha: 0,
  edicao: 1,
  falhar: false,
}));

vi.mock("@/lib/liberacao", async (original) => ({
  ...(await original<typeof import("@/lib/liberacao")>()),
  RH_LIBERADO: true,
}));

vi.mock("@/lib/auth", () => ({
  useAppUser: () => ({ user: { uid: "rh-1", fullName: "Pessoa rh", publicMetadata: { role: "rh" } }, isLoaded: true }),
}));

vi.mock("wouter", async (original) => ({
  ...(await original<typeof import("wouter")>()),
  useSearch: () => `colaborador=${COL}`,
}));

vi.mock("@/lib/rh/api", () => ({
  novaChave: () => `k-${estado.chamadas.length}`,
  chamarRh: async (nome: string, dados: Record<string, unknown>) => {
    estado.chamadas.push({ nome, dados });
    if (nome === "getRhFicha") {
      estado.leiturasDaFicha += 1;
      return {
        hoje: "2026-10-23",
        colaborador: { id: COL, nome: "Ana Souza", funcao: "Montadora", vinculo: "proprio", ativo: true },
        registros: [
          {
            id: "reg_aaaaaaaaaaaaaaaa",
            colaborador_id: COL,
            categoria: "exame",
            tipo: "periodico",
            descricao: null,
            emitido_em: "2025-11-01",
            vence_em: "2026-11-01",
            resultado: "apto",
            situacao: "vigente",
            substituido_por: null,
            arquivo: null,
            edicao: estado.edicao,
          },
        ],
      };
    }
    if (estado.falhar) {
      // Outra pessoa alterou o registro: a edição dele subiu.
      estado.edicao = 2;
      throw new Error("O registro foi atualizado. Recarregue e tente de novo.");
    }
    return { id: "reg_aaaaaaaaaaaaaaaa", edicao: estado.edicao + 1, situacao: "arquivado" };
  },
}));

import RhFicha from "./ficha";

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  estado.chamadas.length = 0;
  estado.leiturasDaFicha = 0;
  estado.edicao = 1;
  estado.falhar = false;
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  container?.remove();
});

async function esperar() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function montar() {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    raiz!.render(
      <QueryClientProvider client={cliente}>
        <Router ssrPath="/rh/ficha">
          <RhFicha />
        </Router>
      </QueryClientProvider>,
    );
  });
  await esperar();
}

function botao(rotulo: string): HTMLButtonElement {
  const achado = [...container!.querySelectorAll("button")].find((item) => item.textContent === rotulo);
  if (!achado) throw new Error(`Botão "${rotulo}" não encontrado.`);
  return achado;
}

async function clicar(rotulo: string) {
  await act(async () => {
    botao(rotulo).click();
  });
  await esperar();
}

describe("a ficha do RH com as callables", () => {
  it("a falha relê a ficha, e a próxima tentativa leva a edição nova", async () => {
    await montar();
    expect(estado.leiturasDaFicha).toBe(1);
    estado.falhar = true;
    await clicar("Arquivar");
    await clicar("Confirmar arquivamento");
    expect(container!.textContent).toContain("O registro foi atualizado. Recarregue e tente de novo.");
    expect(estado.leiturasDaFicha).toBe(2);

    // A confirmação continua aberta para tentar de novo, agora com a ficha lida de novo.
    estado.falhar = false;
    await clicar("Confirmar arquivamento");
    const arquivamentos = estado.chamadas.filter((chamada) => chamada.nome === "archiveRhRecord").map((chamada) => chamada.dados.expected_edicao);
    expect(arquivamentos).toEqual([1, 2]);
  });

  it("com o formulário aberto, Alterar, o arquivo e Arquivar ficam travados nas linhas", async () => {
    await montar();
    await clicar("Alterar");
    expect(botao("Arquivar").disabled).toBe(true);
    expect(container!.querySelector<HTMLInputElement>('input[type="file"]')?.disabled).toBe(true);
    expect([...container!.querySelectorAll("button")].filter((item) => item.textContent === "Alterar").every((item) => item.disabled)).toBe(true);
    expect(container!.querySelector<HTMLInputElement>("#registro-data")?.min).toBe("1900-01-01");
    expect(container!.querySelector<HTMLInputElement>("#registro-vencimento")?.max).toBe("2100-12-31");
  });
});
