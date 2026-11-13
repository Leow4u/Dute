// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O Sair da conta no carregamento v2 (parte 13e): antes, o botão não mudava
 * enquanto a sessão encerrava, e o segundo toque pedia de novo. Agora é o
 * botão de ação: "Saindo…" aos 300 ms, com aria-busy, sem `disabled`, e o
 * toque repetido não sai duas vezes. Dados sintéticos.
 */

const estado = vi.hoisted(() => ({ saidas: 0, soltar: null as null | (() => void) }));

vi.mock("@/lib/auth", () => ({
  useAppUser: () => ({ user: { uid: "u1", fullName: "Sandra Melo", primaryEmailAddress: { emailAddress: "sandra@dutelog.example" }, publicMetadata: { role: "interno" } } }),
  useAppAuth: () => ({
    signOut: () => {
      estado.saidas += 1;
      return new Promise<void>((pronto) => {
        estado.soltar = pronto;
      });
    },
  }),
}));

import { SettingsAccount } from "./settings";

let raiz: Root | null = null;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  estado.saidas = 0;
  estado.soltar = null;
  container = document.createElement("div");
  document.body.append(container);
  raiz = createRoot(container);
});

afterEach(() => {
  estado.soltar?.();
  act(() => raiz?.unmount());
  raiz = null;
  container.remove();
  vi.unstubAllGlobals();
});

describe("o Sair da conta", () => {
  it("Saindo… com aria-busy aos 300 ms, sem disabled, e o toque repetido não sai de novo", async () => {
    await act(async () => raiz!.render(<SettingsAccount />));
    const sair = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (botao) => botao.querySelector(".botao-acao-camada[data-atual]")?.textContent === "Sair",
    )!;
    expect(sair).toBeTruthy();
    await act(async () => sair.click());
    await act(async () => new Promise((pronto) => setTimeout(pronto, 360)));
    expect(sair.getAttribute("aria-busy")).toBe("true");
    expect(sair.querySelector(".botao-acao-camada[data-atual]")?.textContent).toBe("Saindo…");
    expect(sair.disabled).toBe(false);
    await act(async () => sair.click());
    expect(estado.saidas).toBe(1);
  });
});
