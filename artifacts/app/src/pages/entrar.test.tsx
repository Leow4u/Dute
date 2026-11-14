// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosForaDaLista } from "@/test/textos";

/**
 * A entrada (/sign-in), no carregamento v2 (parte 13h). Antes, o botão ficava
 * `disabled` e dizia "Entrando..." de três pontos: o foco de quem apertou
 * Enter caía no `body`. Agora é o BotaoDeAcao. Dados sintéticos.
 */

const mocks = vi.hoisted(() => ({ entrar: vi.fn(), recuperar: vi.fn() }));
vi.mock("firebase/auth", () => ({ signInWithEmailAndPassword: mocks.entrar, sendPasswordResetEmail: mocks.recuperar }));
vi.mock("@/lib/firebase", () => ({ firebaseAuth: {}, firebaseApp: {}, firebaseConfigError: null, firestore: null }));
vi.mock("@/lib/auth", () => ({ useAppUser: () => ({ user: null, isLoaded: true, accessDenied: false, accessRemoved: false }) }));
vi.mock("wouter", () => ({ Redirect: () => null }));

import SignInPage from "./entrar";

const RODAPE = /^© \d{4} Dutelog Soluções Logísticas$/;

let container: HTMLDivElement;
let root: Root;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function digitar(seletor: string, valor: string) {
  const campo = container.querySelector<HTMLInputElement>(seletor)!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(campo, valor);
  campo.dispatchEvent(new Event("input", { bubbles: true }));
}

const entrar = () => container.querySelector<HTMLButtonElement>("button[type='submit']")!;
const camadaAtual = (botao: HTMLButtonElement) => botao.querySelector(".botao-acao-camada[data-atual]")?.textContent;

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("a entrada (carregamento v2, parte 13h)", () => {
  it("só rótulos, dados e ações, e passa no axe", async () => {
    const html = renderToStaticMarkup(<SignInPage />);
    expect(
      textosForaDaLista(html, ["Entrar", "E-mail", "Senha", "Mostrar senha", "Entrando…", "Conferir", "Esqueci minha senha", "Acesso por convite", RODAPE]),
    ).toEqual([]);
    expect(html).not.toContain("...");
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("entrando, o botão fica ocupado e nunca disabled, o foco fica nele, e o segundo Enter não entra de novo", async () => {
    mocks.entrar.mockReturnValue(new Promise(() => undefined));
    await act(async () => root.render(<SignInPage />));
    await act(async () => {
      digitar("#email", "ana@example.com");
      digitar("#senha", "senha-de-teste");
    });
    entrar().focus();
    await act(async () => entrar().click());
    expect(mocks.entrar).toHaveBeenCalledTimes(1);
    expect(entrar().hasAttribute("disabled")).toBe(false);
    expect(entrar().getAttribute("aria-disabled")).toBe("true");
    expect(entrar().getAttribute("data-estado")).toBe("andamento");
    expect(document.activeElement).toBe(entrar());
    // O gerúndio entra aos 300 ms, com a reticência de um caractere.
    await vi.waitFor(() => expect(camadaAtual(entrar())).toBe("Entrando…"), { timeout: 3_000 });
    expect(entrar().getAttribute("aria-busy")).toBe("true");
    // O Enter no campo é a submissão implícita: o clique no botão travado não entra de novo.
    await act(async () => entrar().click());
    expect(mocks.entrar).toHaveBeenCalledTimes(1);
  });
});
