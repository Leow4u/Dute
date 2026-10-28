// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Registro = Record<string, unknown>;
const estado = vi.hoisted(() => ({
  chamadas: [] as Array<{ nome: string; dados: Registro }>,
  tabelas: [] as Array<{ id: string; dados: Registro }>,
  falhar: true,
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));
vi.mock("@/lib/comercial/api", async (original) => ({
  ...(await original<typeof import("@/lib/comercial/api")>()),
  chamarComercial: async (nome: string, dados: Registro) => {
    estado.chamadas.push({ nome, dados });
    if (estado.falhar) throw new Error("A conexão caiu. Tente novamente.");
    estado.tabelas = [{ id: "pt_nova", dados: { nome: dados.nome, codigo: dados.codigo, variante: dados.variante, vigente_de: "2026-01-01", status: "ativa", precos: { lpu_cadeira: {} } } }];
    return { ok: true, tabela_id: "pt_nova" };
  },
}));
vi.mock("@/lib/comercial/leitura", () => ({
  useLeitura: (chave: string | null, _consulta: unknown, mapear: (id: string, dados: Registro) => unknown) => {
    const fonte = chave === "contracts"
      ? [{ id: "ct_itau", dados: { customer_code: "ITAU", nome: "Serviços Itaú", vigente_de: "2026-01-01", status: "vigente", edicao: 1 } }]
      : chave === "customers"
        ? [{ id: "ITAU", dados: { customer_code: "ITAU", name: "Itaú", stage: "cliente" } }]
        : chave?.startsWith("tabelas:") ? estado.tabelas : [];
    return { itens: fonte.map((row) => mapear(row.id, row.dados)).filter(Boolean), erro: false };
  },
  carga: (leitura: { itens: unknown[] }) => leitura.itens,
}));

import ComercialContratosPage from "./contratos";

let raiz: Root;
let container: HTMLDivElement;

beforeEach(() => {
  estado.chamadas = [];
  estado.tabelas = [];
  estado.falhar = true;
  window.history.replaceState({}, "", "/comercial/contratos");
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz.unmount());
  container.remove();
});

async function clicar(rotulo: string) {
  const botao = [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.trim() === rotulo);
  expect(botao, rotulo).toBeDefined();
  await act(async () => botao!.click());
}

function campo(id: string, valor: string) {
  const input = document.getElementById(id) as HTMLInputElement;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, valor);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("tabela criada na ficha do contrato", () => {
  it("na Armazenagem seleciona o contrato sem sair do faturamento", async () => {
    window.history.replaceState({}, "", "/faturamento/contratos");
    await act(async () => raiz.render(<ComercialContratosPage rotaBase="/faturamento/contratos" clienteCodigo="ITAU" />));
    const contrato = container.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
    expect(contrato).not.toBeNull();
    await act(async () => contrato!.click());
    expect(window.location.pathname).toBe("/faturamento/contratos");
    expect(window.location.search).toBe("?id=ct_itau");
    await clicar("Adicionar tabela");
    campo("tabela-nome", "Armazenagem 2026");
    campo("tabela-codigo", "ARM-26");
    campo("tabela-item-1-codigo", "3.05");
    campo("tabela-item-1-descricao", "Armazenagem");
    campo("tabela-item-1-unidade", "UN");
    campo("tabela-item-1-preco", "12,50");
    estado.falhar = false;
    await clicar("Salvar tabela");
    expect(estado.chamadas[0]).toMatchObject({ nome: "saveContractPriceTable", dados: { contrato_id: "ct_itau", itens: [{ codigo: "3.05", descricao: "Armazenagem", unidade: "UN", preco: "12.50" }] } });
    expect(container.querySelector('[aria-label="Tabelas de preço"]')?.textContent).toContain("Armazenagem 2026");
    expect(window.location.pathname).toBe("/faturamento/contratos");
  });

  it("na Armazenagem não mostra o contrato de outro cliente ativo", async () => {
    await act(async () => raiz.render(<ComercialContratosPage rotaBase="/faturamento/contratos" clienteCodigo="SAFRA" />));
    expect(container.textContent).not.toContain("Serviços Itaú");
    expect(container.textContent).toContain("Nenhum contrato vigente");
  });

  it("grava pela callable, repete a mesma intenção após erro e mostra a tabela recebida pela leitura", async () => {
    await act(async () => raiz.render(<ComercialContratosPage />));
    await clicar("Adicionar tabela");
    campo("tabela-nome", "LPU 2026");
    campo("tabela-codigo", "ITAU-26");
    campo("tabela-item-1-codigo", "3.05");
    campo("tabela-item-1-descricao", "Transporte de cadeira");
    campo("tabela-item-1-unidade", "UN");
    campo("tabela-item-1-preco", "12,3456");
    await clicar("Salvar tabela");
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("A conexão caiu. Tente novamente.");
    expect(estado.chamadas[0]).toEqual({ nome: "saveContractPriceTable", dados: {
      contrato_id: "ct_itau", idempotency_key: expect.any(String), nome: "LPU 2026", codigo: "ITAU-26", variante: "Comercial",
      vigente_de: null, vigente_ate: null, itens: [{ codigo: "3.05", descricao: "Transporte de cadeira", unidade: "UN", preco: "12.3456" }],
    } });
    estado.falhar = false;
    await clicar("Salvar tabela");
    expect(estado.chamadas).toHaveLength(2);
    expect(estado.chamadas[1]).toEqual(estado.chamadas[0]);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    const card = document.querySelector('[aria-label="Tabelas de preço"]');
    expect(card?.textContent).toContain("LPU 2026");
    expect(card?.textContent).toContain("ITAU-26");
  });

  it("no Financeiro mantém as tabelas em leitura, sem abrir uma escrita", async () => {
    await act(async () => raiz.render(<ComercialContratosPage somenteLeitura />));
    expect(document.querySelector('[aria-label="Tabelas de preço"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Adicionar tabela");
    expect(estado.chamadas).toEqual([]);
  });
});
