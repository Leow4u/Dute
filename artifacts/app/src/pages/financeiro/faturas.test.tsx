// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { valorDaTela } from "@/lib/comercial/autorizacoes";
import { faturaDoFinanceiro } from "@/lib/financeiro/faturas";

/**
 * O pagamento que a pessoa está digitando na NF aberta fica como ela
 * digitou quando a mesma NF muda por outra ação: o envio dela mesma, ou o
 * envio ou o pagamento de outra pessoa. Antes, o painel recomeçava com o
 * saldo cheio, a data de hoje e a forma da NF, e o pagamento parcial ia
 * como o total.
 */

const NF = "fat_000000000000000000000001";

const estado = vi.hoisted(() => ({
  faturas: [] as unknown[],
  chamadas: [] as Array<{ nome: string; dados: Record<string, unknown> }>,
  chaves: 0,
}));

vi.mock("@/lib/auth", () => ({
  useAppUser: () => ({ user: { uid: "fin-1", fullName: "Pessoa do financeiro", publicMetadata: { role: "financeiro" } }, isLoaded: true }),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));

vi.mock("@/lib/financeiro/api", () => ({
  novaChave: () => {
    estado.chaves += 1;
    return `k-${estado.chaves}`;
  },
  chamarFinanceiro: async (nome: string, dados: Record<string, unknown>) => {
    estado.chamadas.push({ nome, dados });
    return dados.acao === "send" ? { status: "enviada", saldo_cents: 1_000_000 } : { status: "enviada", saldo_cents: 600_000 };
  },
}));

vi.mock("@/lib/financeiro/use-faturas", () => ({
  useFaturas: () => ({ faturas: estado.faturas, carregando: false, falhas: [] }),
  usePagamentosDaNf: () => ({ pagamentos: [], erro: false }),
  usePagamentosDoMes: () => ({ pagamentos: null, erro: false }),
}));

vi.mock("@/lib/financeiro/use-baixas", () => ({
  CHAVE_DAS_BAIXAS: ["financeiro", "baixas"],
  useBaixasDaNf: () => ({ baixas: undefined, carregando: false, falhas: [] }),
}));

import { FinanceiroAReceber } from "./faturas";

function nf(extra: Record<string, unknown> = {}) {
  return faturaDoFinanceiro(NF, {
    customer_code: "ITAU",
    customer_name: "Itaú Unibanco",
    status: "emitida",
    valor_cents: 1_000_000,
    recebido_cents: 0,
    nf: { numero: "1234", serie: "1", emitida_em: "2026-10-01" },
    vencimento: "2026-11-30",
    forma: "boleto",
    demandas: [{ numero: "10045", valor_cents: 1_000_000 }],
    ...extra,
  });
}

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;
const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });

async function esperar() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function mostrar() {
  await act(async () => {
    raiz!.render(
      <QueryClientProvider client={cliente}>
        <FinanceiroAReceber />
      </QueryClientProvider>,
    );
  });
  await esperar();
}

function campo<T extends HTMLElement>(id: string): T {
  const achado = container!.querySelector<T>(`#${id}`);
  if (!achado) throw new Error(`Sem o campo ${id}`);
  return achado;
}

async function digitar(id: string, valor: string) {
  const elemento = campo<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(id);
  const prototipo = elemento instanceof HTMLSelectElement ? HTMLSelectElement.prototype : elemento instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototipo, "value")!.set!.call(elemento, valor);
    elemento.dispatchEvent(new Event(elemento instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

async function clicar(texto: string) {
  const botao = [...container!.querySelectorAll("button")].find((item) => item.textContent?.trim() === texto);
  if (!botao) throw new Error(`Sem o botão ${texto}`);
  await act(async () => botao.click());
  await esperar();
}

async function digitarPagamentoParcial() {
  await digitar("pagamento-valor", "4.000,00");
  await digitar("pagamento-dia", "2026-10-20");
  await digitar("pagamento-forma", "pix");
}

function pagamentos() {
  return estado.chamadas.filter((chamada) => chamada.dados.acao === "pay").map((chamada) => chamada.dados);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-25T15:00:00.000Z"));
  window.history.replaceState({}, "", `/financeiro/a-receber?nf=${NF}`);
  estado.faturas = [nf()];
  estado.chamadas = [];
  estado.chaves = 0;
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

describe("o pagamento digitado na NF aberta", () => {
  it("marcar como enviada não troca o pagamento digitado pelo saldo cheio", async () => {
    await mostrar();
    await digitarPagamentoParcial();
    await clicar("Marcar como enviada");
    // O onSnapshot traz a NF enviada.
    estado.faturas = [nf({ status: "enviada", enviada: { em: "2026-10-25", meio: "email" } })];
    await mostrar();
    expect(campo<HTMLInputElement>("pagamento-valor").value).toBe("4.000,00");

    await clicar("Registrar pagamento");
    expect(pagamentos()).toEqual([
      expect.objectContaining({ fatura_id: NF, valor: valorDaTela("4.000,00"), recebido_em: "2026-10-20", forma: "pix" }),
    ]);
  });

  it("o pagamento de outra pessoa na mesma NF não apaga o que esta digitou", async () => {
    await mostrar();
    await digitarPagamentoParcial();
    // Outra pessoa registrou R$ 2.000,00: o saldo cai para R$ 8.000,00.
    estado.faturas = [nf({ recebido_cents: 200_000 })];
    await mostrar();
    expect(campo<HTMLInputElement>("pagamento-valor").value).toBe("4.000,00");
    expect(campo<HTMLInputElement>("pagamento-dia").value).toBe("2026-10-20");
    expect(campo<HTMLSelectElement>("pagamento-forma").value).toBe("pix");
  });

  it("depois do pagamento desta tela, o próximo já vem com o saldo que sobrou", async () => {
    await mostrar();
    await digitarPagamentoParcial();
    await clicar("Registrar pagamento");
    expect(campo<HTMLInputElement>("pagamento-valor").value).toBe("6.000,00");
    expect(campo<HTMLSelectElement>("pagamento-forma").value).toBe("boleto");
  });
});
