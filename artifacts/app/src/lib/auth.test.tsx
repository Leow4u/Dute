// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A entrada no app sem sinal: a equipe de campo abre o app onde não pega, e a
 * fila guardada só volta com o app aberto. O Firestore guarda o cache só na
 * memória, então, depois de fechar o app, a leitura do perfil recusa com
 * "unavailable".
 */

const firebase = vi.hoisted(() => ({
  aoMudarSessao: null as null | ((usuario: unknown) => Promise<void>),
  aoMudarPerfil: null as null | ((foto: unknown) => void),
  getDoc: vi.fn(),
}));

vi.mock("./firebase", () => ({ firebaseAuth: {}, firestore: {} }));
vi.mock("firebase/auth", () => ({
  onAuthStateChanged: (_auth: unknown, callback: (usuario: unknown) => Promise<void>) => {
    firebase.aoMudarSessao = callback;
    return () => undefined;
  },
  signOut: vi.fn(),
}));
vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, colecao: string, id: string) => ({ path: `${colecao}/${id}` }),
  getDoc: firebase.getDoc,
  onSnapshot: (_ref: unknown, _opcoes: unknown, callback: (foto: unknown) => void) => {
    firebase.aoMudarPerfil = callback;
    return () => undefined;
  },
}));

import { AuthProvider, useAppUser } from "./auth";

const USUARIO = { uid: "uid-carlos", email: "carlos@dutelog.com.br", displayName: null, photoURL: null };
const CHAVE = "dute.perfil.uid-carlos";
const SEM_SINAL = Object.assign(new Error("Failed to get document because the client is offline."), { code: "unavailable" });

function foto(dados: Record<string, unknown> | null, fromCache = false) {
  return { exists: () => dados !== null, data: () => dados ?? undefined, metadata: { fromCache } };
}

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;

function Quem() {
  const { isLoaded, user, accessDenied } = useAppUser();
  const texto = !isLoaded
    ? "carregando"
    : user
      ? `${user.publicMetadata.role}:${user.fullName}`
      : accessDenied
        ? "negado"
        : "fora";
  return <p>{texto}</p>;
}

async function abrirApp() {
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  await act(async () => {
    raiz!.render(
      <AuthProvider>
        <Quem />
      </AuthProvider>,
    );
  });
}

const tela = () => container?.textContent ?? "";

beforeEach(() => {
  window.localStorage.clear();
  firebase.getDoc.mockReset();
  firebase.aoMudarSessao = null;
  firebase.aoMudarPerfil = null;
});

afterEach(() => {
  act(() => raiz?.unmount());
  container?.remove();
  raiz = null;
  container = null;
  vi.useRealTimers();
});

describe("a entrada no app", () => {
  it("com rede, entra e guarda o perfil lido neste aparelho", async () => {
    firebase.getDoc.mockResolvedValue(foto({ role: "campo", nome: "Carlos Silva" }));
    await abrirApp();
    await act(() => firebase.aoMudarSessao!(USUARIO));
    expect(tela()).toBe("campo:Carlos Silva");
    expect(JSON.parse(window.localStorage.getItem(CHAVE) ?? "null")).toMatchObject({ role: "campo", nome: "Carlos Silva" });
  });

  it("sem sinal, entra com o último perfil lido, e o cache vazio não tira o acesso", async () => {
    window.localStorage.setItem(CHAVE, JSON.stringify({ role: "campo", nome: "Carlos Silva" }));
    firebase.getDoc.mockRejectedValue(SEM_SINAL);
    await abrirApp();
    await act(() => firebase.aoMudarSessao!(USUARIO));
    expect(tela()).toBe("campo:Carlos Silva");

    // Sem sinal, o Firestore diz, do cache vazio, que o perfil não existe.
    act(() => firebase.aoMudarPerfil!(foto(null, true)));
    expect(tela()).toBe("campo:Carlos Silva");
    expect(window.localStorage.getItem(CHAVE)).not.toBeNull();

    // Com a rede de volta, o servidor decide.
    act(() => firebase.aoMudarPerfil!(foto({ role: "campo", access_disabled: true })));
    expect(tela()).toBe("negado");
    expect(window.localStorage.getItem(CHAVE)).toBeNull();
  });

  it("sem sinal e sem perfil guardado, espera a rede e lê de novo", async () => {
    firebase.getDoc.mockRejectedValueOnce(SEM_SINAL).mockResolvedValue(foto({ role: "campo", nome: "Carlos Silva" }));
    await abrirApp();
    await act(async () => {
      void firebase.aoMudarSessao!(USUARIO);
      await Promise.resolve();
    });
    expect(tela()).toBe("carregando");

    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(tela()).toBe("campo:Carlos Silva");
    expect(firebase.getDoc).toHaveBeenCalledTimes(2);
  });

  it("o erro que não é falta de sinal não usa o perfil guardado", async () => {
    window.localStorage.setItem(CHAVE, JSON.stringify({ role: "admin" }));
    firebase.getDoc.mockRejectedValue(Object.assign(new Error("Sem permissão."), { code: "permission-denied" }));
    await abrirApp();
    await act(async () => {
      await firebase.aoMudarSessao!(USUARIO).catch(() => undefined);
    });
    expect(tela()).toBe("carregando");
  });

  it("o logout esquece os perfis guardados no aparelho", async () => {
    window.localStorage.setItem(CHAVE, JSON.stringify({ role: "campo" }));
    window.localStorage.setItem("dute.perfil.outra", JSON.stringify({ role: "admin" }));
    await abrirApp();
    await act(() => firebase.aoMudarSessao!(null));
    expect(tela()).toBe("fora");
    expect([window.localStorage.getItem(CHAVE), window.localStorage.getItem("dute.perfil.outra")]).toEqual([null, null]);
  });
});
