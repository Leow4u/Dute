// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Atender a solicitação do portal que outra pessoa resolveu com o
 * formulário aberto: a demanda sai com a solicitação, e o servidor recusa.
 * Antes, sem a solicitação ativa, o pedido ia sem ela, pelo canal portal e
 * com a hora dela, e abria uma segunda demanda solta.
 */

const SOLICITACAO = "sol_0123456789abcdef";

const estado = vi.hoisted(() => ({
  solicitacao: {} as Record<string, unknown>,
  chamadas: [] as Array<{ nome: string; dados: Record<string, unknown> }>,
}));

vi.mock("@/lib/operacao/api", async (original) => ({
  ...(await original<typeof import("@/lib/operacao/api")>()),
  chamarOperacao: async (nome: string, dados: Record<string, unknown>) => {
    estado.chamadas.push({ nome, dados });
    return { numero: "10051" };
  },
}));

vi.mock("@/lib/operacao/leitura", () => ({
  useDocumento: (chave: string | null, _referencia: unknown, mapear: (id: string, dados: Record<string, unknown>) => unknown) => ({
    item: chave ? mapear(SOLICITACAO, estado.solicitacao) : undefined,
    erro: false,
  }),
  useLeitura: (chave: string | null) => ({
    itens: chave === "customers" ? [{ code: "ITAU", nome: "Itaú Unibanco" }] : [],
    erro: false,
  }),
}));

vi.mock("@/lib/operacao/use-urls-das-fotos", () => ({ useUrlsDasFotos: () => ({}) }));

import PaginaDemandaNova from "./demanda-nova";

function solicitacao(extra: Record<string, unknown> = {}) {
  return {
    status: "recebida",
    customer_code: "ITAU",
    customer_name: "Itaú Unibanco",
    tipo_servico: "transporte",
    data: "2026-10-28",
    horario: "08:00",
    desejada_em: "2026-10-28T11:00:00.000Z",
    recebida_em: "2026-10-25T12:00:00.000Z",
    origem: "Faria Lima 3500",
    destino: "Paulista 1000",
    descricao: "Mudança de andar",
    contato: { nome: "Cristiane", email: "cristiane@itau.com.br" },
    ...extra,
  };
}

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;

async function mostrar() {
  await act(async () => raiz!.render(<PaginaDemandaNova />));
}

async function digitar(id: string, valor: string) {
  const campo = container!.querySelector<HTMLInputElement>(`#${id}`);
  if (!campo) throw new Error(`Sem o campo ${id}`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function clicar(texto: string) {
  const botao = [...container!.querySelectorAll("button")].find((item) => item.textContent?.trim() === texto);
  if (!botao) throw new Error(`Sem o botão ${texto}`);
  await act(async () => botao.click());
}

async function abrirDemanda() {
  const formulario = container!.querySelector<HTMLFormElement>("#nova-demanda")!;
  await act(async () => {
    formulario.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-25T15:00:00.000Z"));
  window.history.replaceState({}, "", `/operacao/demandas/nova?solicitacao=${SOLICITACAO}`);
  estado.solicitacao = solicitacao();
  estado.chamadas = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  container?.remove();
  raiz = null;
  container = null;
  vi.useRealTimers();
});

describe("atender a solicitação do portal", () => {
  it("a solicitação que outra pessoa atendeu com o formulário aberto vai junto, para o servidor recusar", async () => {
    await mostrar();
    await clicar("Item avulso");
    await digitar("item-c1-nome", "Caixas");
    await digitar("item-c1-unidade", "UN");
    await digitar("item-c1-quantidade", "10");
    // Outra pessoa abriu a demanda 10050 pela mesma solicitação.
    estado.solicitacao = solicitacao({ status: "aceita", demanda: "10050" });
    await mostrar();
    expect(container!.textContent).toContain("Já virou a demanda 10050");

    await abrirDemanda();
    expect(estado.chamadas).toHaveLength(1);
    expect(estado.chamadas[0].dados).toMatchObject({ solicitacao_id: SOLICITACAO, canal: "portal" });
    expect(estado.chamadas[0].dados).not.toHaveProperty("recebida_em");
  });

  it("com a solicitação ainda esperando, a demanda sai com ela, como antes", async () => {
    await mostrar();
    await clicar("Item avulso");
    await digitar("item-c1-nome", "Caixas");
    await digitar("item-c1-unidade", "UN");
    await digitar("item-c1-quantidade", "10");
    await abrirDemanda();
    expect(estado.chamadas[0].dados).toMatchObject({ solicitacao_id: SOLICITACAO, canal: "portal" });
  });
});
