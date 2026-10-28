// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: { currentUser: null as unknown },
  sessionUser: null as unknown,
  usuario: { uid: "nova-conta", email: "ana@example.com", displayName: "Ana", emailVerified: false, getIdToken: vi.fn() },
  criar: vi.fn(), entrar: vi.fn(), atualizar: vi.fn(), reload: vi.fn(), sair: vi.fn(), enviarPadrao: vi.fn(),
  lookup: vi.fn(), confirmar: vi.fn(), aceitar: vi.fn(), callable: vi.fn(), location: vi.fn(),
}));
vi.mock("firebase/auth", () => ({
  createUserWithEmailAndPassword: mocks.criar,
  signInWithEmailAndPassword: mocks.entrar,
  updateProfile: mocks.atualizar,
  reload: mocks.reload,
  signOut: mocks.sair,
  sendEmailVerification: mocks.enviarPadrao,
}));
vi.mock("firebase/functions", () => ({ httpsCallable: mocks.callable }));
vi.mock("@/lib/firebase", () => ({ firebaseAuth: mocks.auth, firebaseApp: {}, firebaseConfigError: null }));
vi.mock("@/lib/firebase-functions", () => ({ functionsDoApp: () => ({}) }));
vi.mock("@/lib/auth", () => ({ useAppUser: () => ({ user: null, firebaseUser: mocks.sessionUser, isLoaded: true }) }));
vi.mock("wouter", () => ({ useLocation: () => ["/convite", mocks.location] }));

import ConvitePage from "./convite";

const TOKEN = "a".repeat(32);
let container: HTMLDivElement;
let root: Root;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function erro(code: string, message: string) { return Object.assign(new Error(message), { code }); }
async function montar() { await act(async () => root.render(<ConvitePage />)); }
async function clicar(texto: string) {
  const button = [...container.querySelectorAll("button")].find((node) => node.textContent?.trim() === texto);
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}
async function criarConta() {
  await montar();
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>("#convite-senha")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "senha-de-teste");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.currentUser = null;
  mocks.sessionUser = null;
  mocks.usuario.emailVerified = false;
  mocks.usuario.getIdToken.mockReset().mockResolvedValue("token-atualizado");
  mocks.lookup.mockReset().mockResolvedValue({ data: { nome: "Ana", email: "ana@example.com", role: "cliente", status: "pending" } });
  mocks.confirmar.mockReset().mockResolvedValue({ data: { ok: true, status: "sent" } });
  mocks.aceitar.mockReset().mockResolvedValue({ data: { ok: true } });
  mocks.reload.mockReset().mockResolvedValue(undefined);
  mocks.atualizar.mockReset().mockResolvedValue(undefined);
  mocks.criar.mockReset().mockImplementation(async () => {
    mocks.auth.currentUser = mocks.usuario;
    mocks.sessionUser = mocks.usuario;
    return { user: mocks.usuario };
  });
  mocks.callable.mockReset().mockImplementation((_functions, name) => {
    if (name === "lookupInvite") return mocks.lookup;
    if (name === "sendInviteEmailVerification") return mocks.confirmar;
    if (name === "acceptInvite") return mocks.aceitar;
    throw new Error(`Callable inesperada: ${name}`);
  });
  window.history.replaceState({}, "", `/convite?invite=${TOKEN}`);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  window.history.replaceState({}, "", "/");
});

describe("confirmação personalizada do e-mail do convite", () => {
  it("conta sem perfil envia só o token à callable e permite reenvio", async () => {
    await criarConta();
    expect(mocks.confirmar).toHaveBeenCalledExactlyOnceWith({ token: TOKEN });
    expect(mocks.callable).toHaveBeenCalledWith(expect.anything(), "sendInviteEmailVerification");
    expect(container.textContent).toContain("Enviamos um link para");
    expect(mocks.aceitar).not.toHaveBeenCalled();
    await clicar("Reenviar e-mail");
    expect(mocks.confirmar).toHaveBeenNthCalledWith(2, { token: TOKEN });
    expect(container.textContent).toContain("Link reenviado.");
    expect(mocks.criar).toHaveBeenCalledTimes(1);
    expect(mocks.enviarPadrao).not.toHaveBeenCalled();
  });

  it("falha do envio conserva a conta e oferece retry sem afirmar sucesso nem usar o email padrão", async () => {
    mocks.confirmar.mockRejectedValueOnce(erro("functions/unavailable", "raw provider detail"));
    await criarConta();
    expect(container.textContent).toContain("Não foi possível enviar o e-mail de confirmação. Use Reenviar e-mail para tentar novamente.");
    expect(container.textContent).toContain("Confirme o endereço");
    expect(container.textContent).not.toContain("Enviamos um link");
    expect(container.textContent).not.toContain("raw provider detail");
    expect(container.querySelector("form")).toBeNull();
    await clicar("Reenviar e-mail");
    expect(container.textContent).toContain("Enviamos um link para");
    expect(container.textContent).toContain("Link reenviado.");
    expect(mocks.criar).toHaveBeenCalledTimes(1);
    expect(mocks.enviarPadrao).not.toHaveBeenCalled();
  });

  it("limite de reenvio mostra a recusa do servidor, sem mensagem de sucesso", async () => {
    await criarConta();
    mocks.confirmar.mockRejectedValueOnce(erro("functions/resource-exhausted", "Aguarde um minuto antes de reenviar."));
    await clicar("Reenviar e-mail");
    expect(container.textContent).toContain("Aguarde um minuto antes de reenviar.");
    expect(container.textContent).not.toContain("Link reenviado.");
    expect(mocks.enviarPadrao).not.toHaveBeenCalled();
  });

  it("reabrir o convite não dispara outro e-mail; confirmação recarrega token antes de aceitar", async () => {
    mocks.sessionUser = mocks.usuario;
    mocks.auth.currentUser = mocks.usuario;
    await montar();
    expect(mocks.confirmar).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Confirme o endereço");
    await clicar("Já confirmei");
    expect(container.textContent).toContain("Seu e-mail ainda não foi confirmado.");
    expect(mocks.aceitar).not.toHaveBeenCalled();
    mocks.usuario.emailVerified = true;
    await clicar("Já confirmei");
    expect(mocks.usuario.getIdToken).toHaveBeenCalledWith(true);
    expect(mocks.aceitar).toHaveBeenCalledWith({ token: TOKEN, nome: "Ana" });
    expect(mocks.usuario.getIdToken.mock.invocationCallOrder[0]).toBeLessThan(mocks.aceitar.mock.invocationCallOrder[0]);
    expect(container.textContent).toContain("E-mail confirmado");
  });

  it("conta já confirmada segue ao aceite sem enviar confirmação", async () => {
    mocks.usuario.emailVerified = true;
    mocks.sessionUser = mocks.usuario;
    mocks.auth.currentUser = mocks.usuario;
    await montar();
    expect(mocks.confirmar).not.toHaveBeenCalled();
    expect(mocks.aceitar).toHaveBeenCalledWith({ token: TOKEN, nome: "Ana" });
    expect(container.textContent).toContain("E-mail confirmado");
  });

  it("confirmação concluída em outra aba durante o envio recarrega o Auth e aceita", async () => {
    mocks.confirmar.mockImplementationOnce(async () => {
      mocks.usuario.emailVerified = true;
      return { data: { ok: true, status: "already_verified" } };
    });
    await criarConta();
    expect(mocks.usuario.getIdToken).toHaveBeenCalledWith(true);
    expect(mocks.aceitar).toHaveBeenCalledWith({ token: TOKEN, nome: "Ana" });
    expect(container.textContent).toContain("E-mail confirmado");
    expect(container.textContent).not.toContain("Enviamos um link");
  });

  it("resposta inválida não é tratada como envio bem-sucedido", async () => {
    mocks.confirmar.mockResolvedValueOnce({ data: { ok: true, status: "audit" } });
    await criarConta();
    expect(container.textContent).toContain("Não foi possível enviar o e-mail de confirmação.");
    expect(container.textContent).not.toContain("Enviamos um link");
    expect(mocks.enviarPadrao).not.toHaveBeenCalled();
  });
});
