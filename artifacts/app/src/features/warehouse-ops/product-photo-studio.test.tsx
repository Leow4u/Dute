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

import { CARREGANDO } from "@/lib/carregando/tempo";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosForaDaLista } from "@/test/textos";

import { ProductPhotoStudio } from "./product-photo-studio";

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;
let aprovacao: (() => void) | null = null;

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
  aprovacao = null;
  act(() =>
    raiz!.render(
      <ProductPhotoStudio
        photos={FOTOS}
        customerCode="BTG Pactual"
        productName="Polo Masculino Piquet Preto"
        onApprove={() =>
          new Promise<void>((resolver) => {
            aprovacao = resolver;
          })
        }
      />,
    ),
  );
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
/** O botão pelo rótulo na tela: a camada atual do botão de ação, ou o texto do botão comum. */
const botao = (texto: string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
    (item) => (item.querySelector(".botao-acao-camada[data-atual]")?.textContent ?? item.textContent)?.trim() === texto,
  )!;
const principal = () => dialogo()!.querySelector<HTMLButtonElement>(".botao-acao")!;
const GERADA = { fileName: "g.jpg", fileUrl: "https://example.com/g.jpg", storagePath: "p/g.jpg" };

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
    act(() => vi.advanceTimersByTime(CARREGANDO.atrasoMs));
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

  it("nada entra antes de 300 ms, e o progresso entra no lugar guardado: o Cancelar não sai do lugar", async () => {
    act(() => botao("Foto profissional com Agent Dute").click());
    const lugar = () => dialogo()!.querySelector<HTMLElement>("[data-lugar-da-geracao]")!;
    expect(lugar()).not.toBeNull();
    expect(lugar().className).toContain("min-h-16");
    await act(async () => botao("Gerar foto").click());
    expect(dialogo()!.querySelector('[role="progressbar"]')).toBeNull();
    act(() => vi.advanceTimersByTime(CARREGANDO.atrasoMs));
    expect(lugar().querySelector('[role="progressbar"]')?.getAttribute("aria-valuetext")).toBe("1 de 1 foto");
    // O texto de repouso e o progresso ficam na mesma célula: só um na tela e na árvore.
    expect(lugar().querySelectorAll(":scope > [aria-hidden='true']")).toHaveLength(1);
  });

  it("gerar e aprovar ficam ocupados sem disabled: o foco fica no botão, que diz \"Gerando…\" e \"Salvando…\"", async () => {
    act(() => botao("Foto profissional com Agent Dute").click());
    principal().focus();
    await act(async () => principal().click());
    act(() => vi.advanceTimersByTime(CARREGANDO.atrasoMs));
    expect(principal().querySelector(".botao-acao-camada[data-atual]")?.textContent).toBe("Gerando…");
    expect(principal().getAttribute("aria-busy")).toBe("true");
    expect(principal().getAttribute("aria-disabled")).toBe("true");
    expect(principal().hasAttribute("disabled")).toBe(false);
    expect(document.activeElement).toBe(principal());
    const mesmo = principal();
    await act(async () => geracoes[0](GERADA));
    act(() => vi.advanceTimersByTime(CARREGANDO.minimoMs));
    // O mesmo botão vira o "Aprovar": o foco continua nele.
    expect(principal()).toBe(mesmo);
    expect(principal().querySelector(".botao-acao-camada[data-atual]")?.textContent).toBe("Aprovar foto");
    expect(document.activeElement).toBe(mesmo);
    act(() => vi.advanceTimersByTime(1_000));
    await act(async () => principal().click());
    act(() => vi.advanceTimersByTime(CARREGANDO.atrasoMs));
    expect(principal().querySelector(".botao-acao-camada[data-atual]")?.textContent).toBe("Salvando…");
    expect(principal().hasAttribute("disabled")).toBe(false);
    expect(document.activeElement).toBe(mesmo);
    await act(async () => aprovacao?.());
  });

  it("o X fica aria-disabled gerando e salvando, e o Cancelar tem 44 px", async () => {
    act(() => botao("Foto profissional com Agent Dute").click());
    const fechar = () => botao("Fechar");
    expect(fechar().hasAttribute("aria-disabled")).toBe(false);
    expect(botao("Cancelar").className).toContain("min-h-11");
    await act(async () => principal().click());
    expect(fechar().getAttribute("aria-disabled")).toBe("true");
    expect(fechar().hasAttribute("disabled")).toBe(false);
    act(() => fechar().click());
    expect(dialogo()).not.toBeNull();
  });

  it("o diálogo passa no axe gerando e com a proposta, e a espera só tem rótulos e dados", async () => {
    const TEXTOS = ["Gerando com o Agent Dute", /^\d:\d\d$/, /^\d$/, /^de \d$/, "Cancelar", "Gerar foto", "Gerando…", "Aprovar foto", "Salvando…", /^Gerar \d fotos$/, "Aprovar fotos", "Conferir"];
    act(() => botao("Foto profissional com Agent Dute").click());
    await act(async () => principal().click());
    act(() => vi.advanceTimersByTime(CARREGANDO.atrasoMs));
    const espera = () =>
      [dialogo()!.querySelector("[data-lugar-da-geracao] [data-progresso]"), principal().parentElement].map((no) => no?.outerHTML ?? "").join("");
    expect(textosForaDaLista(espera(), TEXTOS)).toEqual([]);
    vi.useRealTimers();
    expect(await violacoesDeAcessibilidade(dialogo()!.outerHTML)).toEqual([]);
  });
});
