// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela, textosForaDaLista } from "@/test/textos";

/**
 * As Movimentações (Estoque › Histórico e a rota antiga), no carregamento v2
 * (parte 13h). Antes, a primeira leitura dizia "Carregando movimentações..."
 * de três pontos, na hora e duas vezes (a lista do celular e a tabela), e o
 * "Registrar Movimentação" ficava `disabled` com "Salvando...". Dados
 * sintéticos.
 */

const estado = vi.hoisted(() => ({ lendo: true, gravando: false, comItens: false }));

const MOVIMENTO = { id: "m1", data: "2026-11-13T10:00:00.000Z", tipo_mov: "ENTRADA", sinal: 1, qtde: 10, cod_sku: "BTG-000001", produto: "Polo Masculino Piquet Preto" };

vi.mock("@workspace/api-client-react", () => ({
  useCreateMovement: () => ({ mutate: vi.fn(), isPending: estado.gravando }),
  useListMovements: () =>
    estado.lendo
      ? { data: undefined, isLoading: true, isFetching: true, isError: false, error: null, dataUpdatedAt: 0, refetch: vi.fn() }
      : {
          data: { items: estado.comItens ? [MOVIMENTO] : [], total: estado.comItens ? 1 : 0 },
          isLoading: false,
          isFetching: false,
          isError: false,
          error: null,
          dataUpdatedAt: Date.now(),
          refetch: vi.fn(),
        },
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
  estado.comItens = false;
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

describe("as Movimentações, na revisão da parte 13h", () => {
  it("a demora e a desistência da primeira leitura têm os textos da lista", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
    try {
      await montar(<Movements embedded />);
      const lista = () => container!.querySelector<HTMLElement>("[data-carregando-na-regiao]")!.outerHTML;
      await act(async () => {
        vi.advanceTimersByTime(10_000);
      });
      expect(textosForaDaLista(lista(), ["Carregando movimentações…", "Demorando mais que o normal", "Tentar de novo"])).toEqual([]);
      await act(async () => {
        vi.advanceTimersByTime(60_000);
      });
      expect(textosForaDaLista(lista(), ["Sem resposta do servidor.", "Tentar de novo"])).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("lida, o cabeçalho da tabela tem 4,5:1 (o tom do apoio, não a tinta a 50%) e o código vai no primário como texto", async () => {
    estado.lendo = false;
    estado.comItens = true;
    await montar(<Movements embedded />);
    const cabecalho = container!.querySelector("thead tr")!;
    expect(cabecalho.className).toContain("text-muted-foreground");
    expect(cabecalho.className).not.toMatch(/text-foreground\/\d+/);
    const codigo = [...container!.querySelectorAll("td")].find((celula) => celula.textContent === "BTG-000001")!;
    expect(codigo.className).toContain("text-primary-texto");
  });

  it("o diálogo Registrar movimentação: o tipo tem nome, e os textos e o axe passam, em repouso e registrando", async () => {
    for (const gravando of [false, true]) {
      estado.gravando = gravando;
      await montar(<MovementModal key={String(gravando)} />);
      const abrir = [...document.querySelectorAll("button")].find((botao) => botao.textContent?.includes("Registrar Movimentação"));
      await act(async () => abrir!.click());
      const dialogo = document.querySelector<HTMLElement>('[role="dialog"]')!;
      const tipo = dialogo.querySelector<HTMLElement>('[role="combobox"]')!;
      expect(tipo.id).toBe("tipo_mov");
      expect(dialogo.querySelector('label[for="tipo_mov"]')).not.toBeNull();
      expect(
        textosForaDaLista(dialogo.outerHTML, [
          "Registrar Movimentação de Estoque",
          "Tipo de Movimentação *",
          // As opções do select nativo escondido que o Radix guarda para o formulário.
          "Entrada (+)",
          "Saída (-)",
          "Ajuste Positivo (+)",
          "Ajuste Negativo (-)",
          "Devolução (+)",
          "Motivo *",
          "Cod. SKU *",
          "Quantidade *",
          "entra",
          "Nome do Produto *",
          "Origem",
          "Destino",
          "Documento / NF",
          "Data",
          "Cancelar",
          "Registrar Movimentação",
          "Registrando…",
          "Conferir",
          "Fechar",
        ]),
      ).toEqual([]);
      expect(await violacoesDeAcessibilidade(dialogo.outerHTML)).toEqual([]);
      act(() => raiz?.render(<></>));
    }
  });
});
