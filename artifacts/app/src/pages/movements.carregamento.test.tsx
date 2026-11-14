// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela } from "@/test/textos";

/**
 * As Movimentações (Estoque › Histórico e a rota antiga), no carregamento v2
 * (parte 13h). Antes, a primeira leitura dizia "Carregando movimentações..."
 * de três pontos, na hora e duas vezes (a lista do celular e a tabela), e o
 * "Registrar Movimentação" ficava `disabled` com "Salvando...". Dados
 * sintéticos.
 */

const estado = vi.hoisted(() => ({ lendo: true, gravando: false }));

vi.mock("@workspace/api-client-react", () => ({
  useCreateMovement: () => ({ mutate: vi.fn(), isPending: estado.gravando }),
  useListMovements: () =>
    estado.lendo
      ? { data: undefined, isLoading: true, isFetching: true, isError: false, error: null, dataUpdatedAt: 0, refetch: vi.fn() }
      : { data: { items: [], total: 0 }, isLoading: false, isFetching: false, isError: false, error: null, dataUpdatedAt: Date.now(), refetch: vi.fn() },
  getListMovementsQueryKey: (params: unknown) => ["/api/movements", params],
}));

vi.mock("@/lib/auth", () => ({
  useAppUser: () => ({ user: { uid: "op-1", fullName: "Operador", publicMetadata: { role: "interno" } }, isLoaded: true }),
}));

vi.mock("@/lib/active-customer-context", () => ({
  useActiveCustomer: () => ({ code: "BTG Pactual", isLoading: false }),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));

import Movements, { MovementModal } from "./movements";

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

async function montar(no: React.ReactNode) {
  await act(async () => raiz!.render(<QueryClientProvider client={new QueryClient()}>{no}</QueryClientProvider>));
}

beforeEach(() => {
  estado.lendo = true;
  estado.gravando = false;
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  container?.remove();
  raiz = null;
  container = null;
});

describe("as Movimentações no carregamento v2 (parte 13h)", () => {
  it("na primeira leitura, uma espera só, no lugar da lista: nada antes de 300 ms, depois a caixa e o gerúndio", async () => {
    await montar(<Movements embedded />);
    expect(container!.textContent).not.toContain("Carregando movimentações");
    expect(container!.textContent).not.toContain("...");
    await vi.waitFor(() => expect(container!.textContent).toContain("Carregando movimentações…"), { timeout: 3_000 });
    expect(container!.querySelectorAll("[data-carregando-na-regiao]")).toHaveLength(1);
    expect(container!.querySelectorAll("table")).toHaveLength(0);
    expect(textosDaTela(container!.innerHTML).filter((texto) => texto.startsWith("Carregando"))).toEqual(["Carregando movimentações…"]);
    expect(await violacoesDeAcessibilidade(container!.innerHTML)).toEqual([]);
  });

  it("lida, a lista volta, sem a espera", async () => {
    estado.lendo = false;
    await montar(<Movements embedded />);
    expect(container!.querySelectorAll("[data-carregando-na-regiao]")).toHaveLength(0);
    expect(container!.textContent).toContain("Nenhuma movimentação encontrada.");
  });

  it("registrando, o botão é o BotaoDeAcao ocupado e o Cancelar espera, nunca disabled", async () => {
    estado.gravando = true;
    await montar(<MovementModal />);
    const abrir = [...document.querySelectorAll("button")].find((botao) => botao.textContent?.includes("Registrar Movimentação"));
    await act(async () => abrir!.click());
    const registrar = document.querySelector<HTMLButtonElement>('form button[type="submit"]')!;
    expect(registrar.getAttribute("data-estado")).toBe("andamento");
    expect(registrar.getAttribute("aria-disabled")).toBe("true");
    expect(registrar.hasAttribute("disabled")).toBe(false);
    await vi.waitFor(() => expect(registrar.querySelector(".botao-acao-camada[data-atual]")?.textContent).toBe("Registrando…"), { timeout: 3_000 });
    const cancelar = [...document.querySelectorAll("button")].find((botao) => botao.textContent === "Cancelar")!;
    expect(cancelar.getAttribute("aria-disabled")).toBe("true");
    expect(cancelar.hasAttribute("disabled")).toBe(false);
    expect(document.body.textContent).not.toContain("...");
  });
});
