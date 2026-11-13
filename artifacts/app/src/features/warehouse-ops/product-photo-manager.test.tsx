// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Anunciador } from "@/lib/carregando/anunciador";
import { CARREGANDO } from "@/lib/carregando/tempo";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosForaDaLista } from "@/test/textos";

import { ProductPhotoManager } from "./product-photo-manager";

/**
 * O gestor de fotos (carregamento v2, parte 11): o "Atualizando fotos…"
 * trocou o anel e o `role="status"` solto pelo indicador chanfrado; quem fala
 * é o Anunciador, a única região viva da tela, e a linha entra aos 300 ms,
 * como toda espera. Dados sintéticos.
 */

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;
const FOTOS = [
  { fileName: "a.jpg", fileUrl: "https://example.com/a.jpg", storagePath: "p/a.jpg" },
  { fileName: "b.jpg", fileUrl: "https://example.com/b.jpg", storagePath: "p/b.jpg" },
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance", "Date"] });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const botao = (texto: string) => Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim() === texto)!;
const linha = () => Array.from(document.querySelectorAll("p")).find((p) => p.textContent?.includes("Atualizando fotos…"));

describe("Atualizando fotos…", () => {
  it("entra aos 300 ms e o leitor de tela ouve pelo Anunciador, sem região viva solta", async () => {
    act(() =>
      raiz!.render(
        <>
          <Anunciador />
          <ProductPhotoManager photos={FOTOS} customerCode="BTG Pactual" productName="Polo" category="" context={{}} onManage={() => new Promise(() => undefined)} onApprove={async () => undefined} />
        </>,
      ),
    );
    act(() => botao("Gerenciar fotos").click());
    act(() => (document.querySelector('button[aria-label^="Ampliar foto 2"]') as HTMLButtonElement).click());
    act(() => botao("Definir como principal").click());
    expect(linha()).toBeUndefined();
    await act(async () => vi.advanceTimersByTime(CARREGANDO.atrasoMs));
    expect(linha()).toBeTruthy();
    expect(linha()!.closest('[role="status"], [aria-live], [role="alert"]')).toBeNull();
    expect(document.querySelector("[data-anunciador]")?.textContent).toBe("Atualizando fotos");
    expect(textosForaDaLista(linha()!.outerHTML, ["Atualizando fotos…"])).toEqual([]);
    vi.useRealTimers();
    expect(await violacoesDeAcessibilidade(linha()!.outerHTML)).toEqual([]);
  });
});
