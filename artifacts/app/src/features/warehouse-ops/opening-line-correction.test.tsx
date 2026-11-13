// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { warehouseBoxFromRecord } from "@/lib/warehouse-boxes";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosForaDaLista } from "@/test/textos";

/**
 * "Corrigir caixa" da abertura na migração do carregamento v2 (parte 13b; o
 * diálogo que a parte 13a deixou aberto): enquanto o servidor responde, o
 * diálogo não fecha (Esc, toque fora, X e "Voltar"), o "Voltar" fica
 * aria-disabled, e o confirmar é o BotaoDeAcao ("Corrigindo…"), sem o ícone
 * antigo girando e com a mesma chave de idempotência na nova tentativa.
 * Dados sintéticos.
 */

const estado = vi.hoisted(() => ({ pendentes: [] as Array<{ corpo: Record<string, unknown>; responder: (ok: boolean) => void }>, fechou: 0 }));

vi.mock("@/lib/warehouse-ops/model", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/warehouse-ops/model")>()),
  fetchJson: (_url: string, init?: { body?: string }) =>
    new Promise((resolver, rejeitar) =>
      estado.pendentes.push({
        corpo: JSON.parse(init?.body ?? "{}") as Record<string, unknown>,
        responder: (ok) => (ok ? resolver({ ok: true }) : rejeitar(new Error("Falha no servidor"))),
      }),
    ),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));

import { OpeningLineCorrection } from "./opening-line-correction";

const LINHA = { id: "l1", sku_code: "BTG-000001", client_item_code: "A.01", product_name: "Polo", counted_qty: 12, unit_cost: 30, location_id: "A-01", box_code: "CX-000001" };
const CAIXAS = [
  warehouseBoxFromRecord({ code: "CX-000001", customer_code: "BTG", status: "stored", location_id: "A-01", origin: { session_id: "s1" } }),
  warehouseBoxFromRecord({ code: "CX-000002", customer_code: "BTG", status: "stored", location_id: "A-02", origin: { session_id: "s1" } }),
];

let raiz: Root | null = null;
let container: HTMLDivElement;

const dialogo = () => document.querySelector<HTMLElement>('[role="dialog"][data-state="open"]');
const botao = (rotulo: string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
    (item) => item.textContent?.trim() === rotulo || item.getAttribute("aria-label") === rotulo || item.querySelector('[data-camada="repouso"]')?.textContent?.trim() === rotulo,
  );
async function pausa(ms: number) {
  await act(async () => {
    await new Promise((pronto) => setTimeout(pronto, ms));
  });
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView ??= () => undefined;
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => undefined;
  estado.pendentes.length = 0;
  estado.fechou = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  await act(async () =>
    raiz!.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
        <OpeningLineCorrection line={LINHA as never} lines={[LINHA as never]} boxes={CAIXAS} sessionId="s1" customerCode="BTG" onClose={() => (estado.fechou += 1)} />
      </QueryClientProvider>,
    ),
  );
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function escolherDestinoEMotivo() {
  const gatilho = document.querySelector<HTMLButtonElement>("#opening-correction-target")!;
  await act(async () => {
    gatilho.focus();
    gatilho.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  const opcao = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((item) => item.textContent?.startsWith("CX-000002"))!;
  await act(async () => {
    opcao.focus();
    opcao.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  const motivo = document.querySelector<HTMLTextAreaElement>("#opening-correction-reason")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(motivo, "Lançada na caixa anterior");
    motivo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("Corrigir caixa, gravando", () => {
  it("o diálogo segura: o Esc e o Voltar não fecham, o Voltar fica aria-disabled e o confirmar diz \"Corrigindo…\"", async () => {
    await escolherDestinoEMotivo();
    const confirmar = botao("Confirmar correção")!;
    confirmar.focus();
    await act(async () => confirmar.click());
    expect(estado.pendentes).toHaveLength(1);
    await pausa(350);
    expect(confirmar.hasAttribute("disabled")).toBe(false);
    expect(confirmar.getAttribute("aria-busy")).toBe("true");
    expect(confirmar.querySelector("[data-atual]")?.textContent?.trim()).toBe("Corrigindo…");
    expect(document.activeElement).toBe(confirmar);
    expect(document.querySelectorAll(".animate-spin")).toHaveLength(0);
    await act(async () => {
      document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    const voltar = botao("Voltar")!;
    expect(voltar.hasAttribute("disabled")).toBe(false);
    expect(voltar.getAttribute("aria-disabled")).toBe("true");
    await act(async () => voltar.click());
    expect(dialogo()).not.toBeNull();
    expect(estado.fechou).toBe(0);
    expect(textosForaDaLista(confirmar.outerHTML, ["Confirmar correção", "Corrigindo…", "Conferir"])).toEqual([]);
    expect(await violacoesDeAcessibilidade(dialogo()!.outerHTML)).toEqual([]);

    // A falha deixa o diálogo; a nova tentativa leva a mesma chave.
    await act(async () => estado.pendentes[0]!.responder(false));
    // O toque seguinte, passado o segundo do toque único.
    for (const passo of [50, 300, 700]) await pausa(passo);
    expect(confirmar.getAttribute("data-camada")).toBe("repouso");
    expect(dialogo()).not.toBeNull();
    await act(async () => confirmar.click());
    expect(estado.pendentes).toHaveLength(2);
    expect(estado.pendentes[1]!.corpo.idempotency_key).toBe(estado.pendentes[0]!.corpo.idempotency_key);
    await act(async () => estado.pendentes[1]!.responder(true));
    await pausa(50);
    expect(estado.fechou).toBe(1);
  });
});
