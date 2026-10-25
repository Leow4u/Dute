// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A Revisão sem ?os= abre na OS que espera há mais tempo, e ela fica: a OS
 * que chega à lista depois com a conclusão de antes (registrada no
 * escritório com a hora passada, ou a fila do campo que sincronizou tarde)
 * não toma o lugar dela. Antes, a tela trocava de OS, a revisão começada
 * sumia, e "Concluir revisão" fechava a OS que ninguém tinha olhado.
 */

const estado = vi.hoisted(() => ({
  emRevisao: [] as Array<{ id: string; dados: Record<string, unknown> }>,
  chamadas: [] as Array<{ nome: string; dados: Record<string, unknown> }>,
}));

vi.mock("@/lib/operacao/api", async (original) => ({
  ...(await original<typeof import("@/lib/operacao/api")>()),
  chamarOperacao: async (nome: string, dados: Record<string, unknown>) => {
    estado.chamadas.push({ nome, dados });
    return {};
  },
}));

vi.mock("@/lib/operacao/leitura", () => ({
  useLeitura: (chave: string | null, _consulta: unknown, mapear: (id: string, dados: Record<string, unknown>) => unknown) => ({
    itens: chave === "service_orders:em_revisao" ? estado.emRevisao.map((os) => mapear(os.id, os.dados)).filter(Boolean) : [],
    erro: false,
  }),
  useDocumento: () => ({ item: null, erro: false }),
}));

vi.mock("@/lib/operacao/use-urls-das-fotos", () => ({ useUrlsDasFotos: () => ({}) }));

import PaginaRevisao from "./revisao";

function emRevisao(numero: string, concluidaEm: string) {
  return {
    id: numero,
    dados: {
      status: "em_revisao",
      edicao: 7,
      demanda: "10045",
      customer_code: "ITAU",
      cliente_nome: "Itaú Unibanco",
      servicos: ["transporte"],
      janela: { data: "2026-10-24", inicio: "08:00", fim: "18:00" },
      locais: { origem: { endereco: "Faria Lima 3500" }, destino: { endereco: "Torre B" } },
      equipe: [],
      itens: [],
      etapas: [{ etapa: "fim", instante: concluidaEm }],
      conclusao: { instante: concluidaEm, aceite: "sem_aceite", responsavel: { nome: "Cristiane" } },
    },
  };
}

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;

async function mostrar() {
  await act(async () => raiz!.render(<PaginaRevisao />));
}

function osNaTela(): string {
  return [...container!.querySelectorAll("h2")].map((titulo) => titulo.textContent ?? "").find((texto) => texto.startsWith("OS ")) ?? "";
}

beforeEach(() => {
  window.history.replaceState({}, "", "/operacao/revisao");
  estado.chamadas = [];
  estado.emRevisao = [emRevisao("10045-02", "2026-10-24T20:00:00.000Z")];
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

describe("a OS da vez na Revisão", () => {
  it("a OS que chega depois com a conclusão de antes não toma o lugar da que está na tela", async () => {
    await mostrar();
    expect(osNaTela()).toBe("OS 10045-02");

    // A 10045-01, concluída antes, chega à lista agora.
    estado.emRevisao = [emRevisao("10045-01", "2026-10-24T15:00:00.000Z"), ...estado.emRevisao];
    await mostrar();
    expect(osNaTela()).toBe("OS 10045-02");

    const concluir = [...container!.querySelectorAll("button")].find((botao) => botao.textContent?.trim() === "Concluir revisão")!;
    await act(async () => concluir.click());
    expect(estado.chamadas.map((chamada) => [chamada.nome, chamada.dados.numero])).toEqual([["reviewServiceOrder", "10045-02"]]);
  });

  it("revisada a da vez, a próxima é a que espera há mais tempo", async () => {
    await mostrar();
    estado.emRevisao = [emRevisao("10045-01", "2026-10-24T15:00:00.000Z"), ...estado.emRevisao];
    await mostrar();
    // A 10045-02 foi revisada e saiu da lista.
    estado.emRevisao = estado.emRevisao.filter((os) => os.id !== "10045-02");
    await mostrar();
    expect(osNaTela()).toBe("OS 10045-01");
  });
});
