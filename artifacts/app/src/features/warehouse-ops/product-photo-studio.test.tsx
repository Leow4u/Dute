// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A foto por IA (carregamento v2, parte 11; diagnóstico, seção 6, item 8):
 * enquanto o Agent Dute gera, a contagem ("1 de 2"), o tempo decorrido
 * ("0:12", a geração leva dezenas de segundos) e o "Cancelar", que para de
 * esperar sem fechar o diálogo. Antes, só "preparando… 0/2" numa região viva
 * solta, e o Cancelar desligado. Dados sintéticos.
 */

const geracoes = vi.hoisted(() => [] as Array<(foto: unknown) => void>);

vi.mock("@/lib/warehouse-ops/model", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/warehouse-ops/model")>();
  return {
    ...original,
    fetchJson: (url: string) => {
      if (url !== "/api/products/generate-photo") throw new Error(`Chamada inesperada: ${url}`);
      return new Promise((resolver) => geracoes.push(resolver));
    },
  };
});

import { ProductPhotoStudio } from "./product-photo-studio";

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;

const FOTOS = [
  { fileName: "a.jpg", fileUrl: "https://example.com/a.jpg", storagePath: "p/a.jpg" },
  { fileName: "b.jpg", fileUrl: "https://example.com/b.jpg", storagePath: "p/b.jpg" },
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance", "Date"] });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  geracoes.length = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  act(() => raiz!.render(<ProductPhotoStudio photos={FOTOS} customerCode="BTG Pactual" productName="Polo Masculino Piquet Preto" onApprove={() => undefined} />));
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  document.body.innerHTML = "";
  container = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const dialogo = () => document.querySelector<HTMLElement>('[role="dialog"]');
const botao = (texto: string) => Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.textContent?.trim() === texto)!;

async function gerarDuas() {
  act(() => botao("Foto profissional com Agent Dute").click());
  // A segunda original também.
  const caixas = Array.from(dialogo()!.querySelectorAll<HTMLButtonElement>('button[role="checkbox"]'));
  act(() => caixas[1].click());
  await act(async () => botao("Gerar 2 fotos").click());
}

describe("a foto por IA: o tempo decorrido e o Cancelar", () => {
  it("gerando, a contagem e o relógio que anda a cada segundo, sem região viva solta", async () => {
    await gerarDuas();
    const barra = dialogo()!.querySelector<HTMLElement>('[role="progressbar"]')!;
    expect(barra.getAttribute("aria-label")).toBe("Gerando com o Agent Dute");
    expect(barra.getAttribute("aria-valuetext")).toBe("1 de 2 fotos");
    expect(dialogo()!.textContent).toContain("0:00");
    act(() => vi.advanceTimersByTime(12_000));
    expect(dialogo()!.textContent).toContain("0:12");
    expect(dialogo()!.querySelector("[aria-live]")).toBeNull();
    await act(async () => geracoes[0]({ fileName: "g.jpg", fileUrl: "https://example.com/g.jpg", storagePath: "p/g.jpg" }));
    expect(dialogo()!.querySelector('[role="progressbar"]')?.getAttribute("aria-valuetext")).toBe("2 de 2 fotos");
  });

  it("o Cancelar para de esperar sem fechar o diálogo; o que já veio fica, o que vem depois não entra", async () => {
    await gerarDuas();
    await act(async () => geracoes[0]({ fileName: "g.jpg", fileUrl: "https://example.com/g.jpg", storagePath: "p/g.jpg" }));
    const cancelar = botao("Cancelar");
    expect(cancelar.hasAttribute("disabled")).toBe(false);
    await act(async () => cancelar.click());
    expect(dialogo()).not.toBeNull();
    expect(dialogo()!.querySelector('[role="progressbar"]')).toBeNull();
    expect(dialogo()!.textContent).toContain("Gerada com IA");
    // A segunda geração chega depois do Cancelar e não entra.
    await act(async () => geracoes[1]?.({ fileName: "h.jpg", fileUrl: "https://example.com/h.jpg", storagePath: "p/h.jpg" }));
    expect(dialogo()!.querySelectorAll('img[alt="Proposta gerada pelo Agent Dute"]')).toHaveLength(1);
    // Parado, o Cancelar volta a fechar.
    await act(async () => botao("Cancelar").click());
    expect(dialogo()).toBeNull();
  });
});
