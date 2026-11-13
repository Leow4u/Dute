// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O "Revogar acesso" e o "Devolver acesso" de Pessoas são a mesma mutação
 * (carregamento v2, parte 13a). A revogação de B não nasce ocupada pela
 * devolução de A, que ainda grava; e o item "Revogar acesso" espera a
 * mutação acabar, como o "Devolver acesso" (o fim de uma fecharia o diálogo
 * da outra). Dados sintéticos.
 */

vi.mock("@/lib/auth", () => ({ useAppUser: () => ({ user: { uid: "u0", publicMetadata: { role: "admin" } } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));

import { DialogosDasPessoas, MenuDaPessoa, type AcoesDasPessoas } from "./acoes";

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  container?.remove();
  container = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const parado = { isPending: false, mutate: () => undefined };
const BRUNA = { id: "b", kind: "user", name: "Bruna", email: "bruna@exemplo.test", state: "active", role: "interno" };

function acoes(extra: Record<string, unknown>) {
  return {
    actorRole: "admin",
    selfId: "u0",
    roles: ["interno"],
    resending: null,
    archiving: null,
    removing: null,
    reason: "",
    setReason: () => undefined,
    setResending: () => undefined,
    setArchiving: () => undefined,
    setRemoving: vi.fn(),
    resendInvite: parado,
    archivePerson: parado,
    cancelInvite: parado,
    changeRole: () => undefined,
    onConvidarDeNovo: () => undefined,
    toast: () => undefined,
    setAccess: parado,
    ...extra,
  } as unknown as AcoesDasPessoas;
}

const devolvendoA = { isPending: true, variables: { id: "a", active: true }, mutate: vi.fn() };

describe("o Revogar acesso com a mesma mutação do Devolver", () => {
  it("o diálogo de B, aberto enquanto o Devolver de A grava, não nasce ocupado nem segura o Cancelar", async () => {
    const setRemoving = vi.fn();
    await act(async () => raiz!.render(<DialogosDasPessoas acoes={acoes({ removing: BRUNA, setRemoving, setAccess: devolvendoA })} />));
    const dialogo = document.querySelector<HTMLElement>('[role="alertdialog"]')!;
    expect(dialogo.hasAttribute("data-ocupado")).toBe(false);
    const confirmar = dialogo.querySelector<HTMLButtonElement>(".botao-acao")!;
    expect(confirmar.querySelector(".botao-acao-camada[data-atual]")?.textContent).toBe("Revogar acesso");
    expect(confirmar.hasAttribute("aria-busy")).toBe(false);
    const cancelar = Array.from(dialogo.querySelectorAll("button")).find((botao) => botao.textContent?.trim() === "Cancelar")!;
    expect(cancelar.hasAttribute("aria-disabled")).toBe(false);
    await act(async () => cancelar.click());
    expect(setRemoving).toHaveBeenCalledWith(null);
  });

  it("a revogação de B que grava segura o diálogo de B", async () => {
    const revogandoB = { isPending: true, variables: { id: "b", active: false, reason: "" }, mutate: vi.fn() };
    await act(async () => raiz!.render(<DialogosDasPessoas acoes={acoes({ removing: BRUNA, setAccess: revogandoB })} />));
    const dialogo = document.querySelector<HTMLElement>('[role="alertdialog"]')!;
    expect(dialogo.hasAttribute("data-ocupado")).toBe(true);
    const cancelar = Array.from(dialogo.querySelectorAll("button")).find((botao) => botao.textContent?.trim() === "Cancelar")!;
    expect(cancelar.getAttribute("aria-disabled")).toBe("true");
  });

  it("o item Revogar acesso espera o Devolver acesso que ainda grava", async () => {
    await act(async () => raiz!.render(<MenuDaPessoa acoes={acoes({ setAccess: devolvendoA })} person={BRUNA as never} />));
    const gatilho = document.querySelector<HTMLButtonElement>('button[aria-label="Ações de Bruna"]')!;
    await act(async () => {
      gatilho.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    });
    const item = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((elemento) => elemento.textContent?.trim() === "Revogar acesso");
    expect(item, "o item na tela").toBeTruthy();
    expect(item!.getAttribute("aria-disabled")).toBe("true");
  });
});
