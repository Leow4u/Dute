// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A capacidade do veículo como se digita no Brasil: "6.000" kg são seis mil
 * quilos, e "12,5" m³ são doze e meio. Antes, "6.000" ia como 6 kg, e a
 * callable aceitava.
 */

const estado = vi.hoisted(() => ({ chamadas: [] as Array<{ nome: string; dados: Record<string, unknown> }> }));

vi.mock("@/lib/operacao/api", async (original) => ({
  ...(await original<typeof import("@/lib/operacao/api")>()),
  chamarOperacao: async (nome: string, dados: Record<string, unknown>) => {
    estado.chamadas.push({ nome, dados });
    return {};
  },
}));

vi.mock("@/lib/operacao/leitura", () => ({ useLeitura: () => ({ itens: [], erro: false }) }));

import { PaginaVeiculos } from "./pagina";

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;

async function digitar(id: string, valor: string) {
  const campo = container!.querySelector<HTMLInputElement>(`#${id}`);
  if (!campo) throw new Error(`Sem o campo ${id}`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function novoVeiculo(kg: string, m3: string) {
  await act(async () => raiz!.render(<PaginaVeiculos />));
  const novo = [...container!.querySelectorAll("button")].find((botao) => botao.textContent?.trim() === "Novo veículo")!;
  await act(async () => novo.click());
  await digitar("veiculo-placa", "ABC1D23");
  await digitar("veiculo-tipo", "Caminhão 3/4");
  await digitar("veiculo-kg", kg);
  await digitar("veiculo-m3", m3);
  const formulario = container!.querySelector("form")!;
  await act(async () => {
    formulario.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  return estado.chamadas.at(-1)?.dados;
}

beforeEach(() => {
  window.history.replaceState({}, "", "/operacao/veiculos");
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
});

describe("a capacidade do veículo", () => {
  it('"6.000" kg são seis mil quilos, e "12,5" m³ são doze e meio', async () => {
    expect(await novoVeiculo("6.000", "12,5")).toMatchObject({ action: "create", capacidade_kg: 6000, capacidade_m3: 12.5 });
  });

  it("sem o ponto, como antes", async () => {
    expect(await novoVeiculo("3500", "12.5")).toMatchObject({ capacidade_kg: 3500, capacidade_m3: 12.5 });
  });

  it("o que não é número vai vazio, para a callable recusar com a mensagem dela", async () => {
    expect(await novoVeiculo("6,5", "doze")).toMatchObject({ capacidade_kg: null, capacidade_m3: null });
  });
});
