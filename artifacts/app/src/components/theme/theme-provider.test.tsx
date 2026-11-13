// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fecharAbertura } from "@/lib/abertura";
import { themeColorFor } from "@/lib/theme";

vi.mock("@/lib/auth", () => ({
  useAppUser: () => ({ firebaseUser: null, user: null, isLoaded: true, accessDenied: false }),
}));

import { AppThemeProvider } from "./theme-provider";

/**
 * A barra do navegador emenda na abertura (carregamento v2, decisão P4 de
 * 12/11/2026): o index.html e o manifest dizem #161616, o preto da abertura.
 * Antes, o tema trocava a barra para o claro assim que o React montava, por
 * cima da abertura ainda preta.
 */

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;
const cor = () => document.querySelector('meta[name="theme-color"]')?.getAttribute("content");

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.matchMedia ??= ((consulta: string) => ({
    matches: false,
    media: consulta,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
  const meta = document.createElement("meta");
  meta.name = "theme-color";
  meta.content = "#161616";
  document.head.append(meta);
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  document.body.innerHTML = "";
  // O next-themes tira sozinho o <style> que pôs no head; aqui sai só a meta.
  document.querySelector('meta[name="theme-color"]')?.remove();
  container = null;
  vi.unstubAllGlobals();
});

describe("a cor da barra do navegador", () => {
  it("fica no preto da abertura enquanto ela cobre a tela, e vai para o tema quando ela sai", () => {
    const abertura = document.createElement("div");
    abertura.id = "abertura";
    document.body.prepend(abertura);
    act(() => raiz!.render(<AppThemeProvider>app</AppThemeProvider>));
    expect(cor()).toBe("#161616");
    act(() => fecharAbertura());
    // Sem perfil (o login), o tema é o claro.
    expect(cor()).toBe(themeColorFor("light"));
  });

  it("sem abertura, acompanha o tema desde o começo", () => {
    act(() => raiz!.render(<AppThemeProvider>app</AppThemeProvider>));
    expect(cor()).toBe(themeColorFor("light"));
  });
});
