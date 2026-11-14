// @vitest-environment jsdom
import { act, lazy, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

import { Anunciador } from "@/lib/carregando/anunciador";
import { textosForaDaLista } from "@/test/textos";

/**
 * A aba Contratos com o cliente ativo lendo e, depois, o arquivo da aba ainda
 * chegando (carregamento v2, parte 13d, a revisão): as duas esperas são uma
 * só. Antes, a `CarregandoTela` do cliente saía e a do Suspense entrava do
 * zero: a caixa sumia por 300 ms na troca e o relógio da demora recomeçava.
 * Relógio simulado.
 */

const estado = vi.hoisted(() => ({ carregandoCliente: true, soltar: null as null | (() => void) }));

vi.mock("@/lib/auth", () => ({ useAppUser: () => ({ user: { uid: "u-1", publicMetadata: { role: "owner" } }, isLoaded: true }) }));
vi.mock("@/lib/active-customer-context", () => ({
  useActiveCustomer: () => ({ code: "BTG", isLoading: estado.carregandoCliente }),
}));
vi.mock("@/lib/somente-armazenagem", () => ({ SOMENTE_ARMAZENAGEM: true }));
vi.mock("@/lib/telas-no-aparelho", () => ({
  telaSobDemanda: (nome: string) =>
    nome === "pages/comercial/contratos"
      ? lazy(
          () =>
            new Promise<{ default: () => ReactElement }>((pronto) => {
              estado.soltar = () => pronto({ default: () => <p>Contratos do cliente</p> });
            }),
        )
      : () => <p>outra aba</p>,
}));

import BillingHub from "./billing-hub";

let raiz: Root | null = null;
let container: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance", "Date"] });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  estado.carregandoCliente = true;
  estado.soltar = null;
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

/** A tela sem a região do Anunciador (o que ele diz não é texto da tela). */
const semAnunciador = () => {
  const copia = container.cloneNode(true) as HTMLElement;
  copia.querySelector("[data-anunciador]")?.remove();
  return copia.innerHTML;
};
/**
 * Os textos da espera da aba, do começo à demora (a trava contra legenda). O título e a descrição do cabeçalho do
 * Faturamento vêm de antes do carregamento v2 e ficam como estão.
 */
const TEXTOS_DA_ESPERA = [
  "Faturamento", "Fechamento do mês e tabela de preços do cliente ativo", "Fechamento do mês", "Tabela de preços", "Contratos e tabelas",
  "Abrindo Faturamento…", "Demorando mais que o normal", "Tentar de novo",
];

/** A caixa da espera que está na tela (fora do que o Suspense esconde). */
const caixaNaTela = () =>
  Array.from(container.querySelectorAll<HTMLElement>("[data-carregando-tela]")).some(
    (tela) => !tela.closest("[style*='display: none']") && tela.querySelector("[data-spinner]") !== null,
  );

describe("a aba Contratos, do cliente ativo ao arquivo da aba", () => {
  it("é uma espera só: a caixa não some na troca, e a demora vem aos 10 s do começo, não do zero", async () => {
    const { hook } = memoryLocation({ path: "/faturamento/contratos" });
    raiz = createRoot(container);
    const desenhar = () =>
      raiz!.render(
        <Router hook={hook}>
          <Anunciador />
          <BillingHub />
        </Router>,
      );
    await act(async () => desenhar());
    await passar(2_000);
    expect(caixaNaTela()).toBe(true);
    expect(textosForaDaLista(semAnunciador(), TEXTOS_DA_ESPERA)).toEqual([]);
    estado.carregandoCliente = false;
    await act(async () => desenhar());
    // Do cliente lido ao arquivo da aba: a caixa segue na tela em todos os instantes.
    for (let instante = 0; instante < 400; instante += 50) {
      expect(caixaNaTela()).toBe(true);
      await passar(50);
    }
    await passar(7_700);
    expect(container.textContent).toContain("Demorando mais que o normal");
    expect(textosForaDaLista(semAnunciador(), TEXTOS_DA_ESPERA)).toEqual([]);
    estado.soltar?.();
    await passar(50);
    expect(container.textContent).toContain("Contratos do cliente");
  });
});
