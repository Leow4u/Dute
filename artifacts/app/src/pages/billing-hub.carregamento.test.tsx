// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

import { Anunciador } from "@/lib/carregando/anunciador";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";

/**
 * O Faturamento com a aba "Contratos e tabelas" (carregamento v2, parte 13d;
 * diagnóstico, seção 4.8): antes, enquanto o cliente ativo ainda lia, a aba
 * ficava em branco (`null`), sem nada que dissesse que a tela abria. Agora a
 * espera é a da tela que abre, a `CarregandoTela`, como no Suspense da aba.
 */

const estado = vi.hoisted(() => ({ carregandoCliente: true }));

vi.mock("@/lib/auth", () => ({ useAppUser: () => ({ user: { uid: "u-1", publicMetadata: { role: "owner" } }, isLoaded: true }) }));
vi.mock("@/lib/active-customer-context", () => ({
  useActiveCustomer: () => ({ code: "BTG", isLoading: estado.carregandoCliente }),
}));
vi.mock("@/lib/somente-armazenagem", () => ({ SOMENTE_ARMAZENAGEM: true }));
vi.mock("./comercial/contratos", () => ({ default: () => <p>Contratos do cliente</p> }));

import BillingHub from "./billing-hub";

let raiz: Root | null = null;
let container: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance", "Date"] });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  estado.carregandoCliente = true;
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function passar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const semAnunciador = () => {
  const copia = container.cloneNode(true) as HTMLElement;
  copia.querySelector("[data-anunciador]")?.remove();
  return copia;
};

/** O HTML visto em cada estado, para o axe no fim do teste, com o relógio de verdade (o do jsdom dele). */
const paraOAxe: string[] = [];
async function axeDoQueVimos() {
  vi.useRealTimers();
  // O aria-controls das abas aponta para um painel que a tela não usa (as abas só navegam): vem de antes desta parte,
  // como no Estoque e na Contagem (registro da parte 13b), e fica de fora.
  const deAntes = (violacao: string) => violacao.startsWith("aria-valid-attr-value: #radix-") && violacao.includes("-trigger-");
  for (const html of paraOAxe.splice(0)) expect((await violacoesDeAcessibilidade(html)).filter((violacao) => !deAntes(violacao))).toEqual([]);
}

describe("a aba Contratos e tabelas com o cliente ativo ainda lendo", () => {
  it("mostra a espera da tela que abre, nunca a aba em branco", async () => {
    const { hook } = memoryLocation({ path: "/faturamento/contratos" });
    raiz = createRoot(container);
    await act(async () => {
      raiz!.render(
        <Router hook={hook}>
          <Anunciador />
          <BillingHub />
        </Router>,
      );
    });
    await passar(350);
    const tela = semAnunciador();
    expect(tela.textContent).toMatch(/Abrindo .+…/);
    expect(tela.querySelector("[data-spinner]")).not.toBeNull();
    paraOAxe.push(tela.innerHTML);

    estado.carregandoCliente = false;
    await act(async () => {
      raiz!.render(
        <Router hook={hook}>
          <Anunciador />
          <BillingHub />
        </Router>,
      );
    });
    await passar(50);
    expect(semAnunciador().textContent).toContain("Contratos do cliente");
    await axeDoQueVimos();
  });
});
