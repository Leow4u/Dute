// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Anunciador } from "@/lib/carregando/anunciador";
import { CARREGANDO } from "@/lib/carregando/tempo";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosForaDaLista } from "@/test/textos";

/**
 * O convite no carregamento v2, depois da revisão da parte 13h: a leitura do
 * convite com a saída da seção 3 (a demora com "Tentar de novo" aos 10 s e a
 * desistência aos 70 s), o envio do e-mail que segue o "Aceitar convite" com a
 * espera à vista ("Enviando…") e o foco que, na troca de tela, vai ao título
 * da capa, nunca ao `body`. Dados sintéticos.
 */

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

import ConvitePage, { ConviteView, type AcoesDoConvite, type TelaDoConvite } from "./convite";

const TOKEN = "b".repeat(32);
const RODAPE = /^© \d{4} Dutelog Soluções Logísticas$/;
const LIDO = { data: { nome: "Ana", email: "ana@example.com", role: "cliente", status: "pending" } };

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  mocks.auth.currentUser = null;
  mocks.sessionUser = null;
  mocks.usuario.emailVerified = false;
  mocks.lookup.mockReset().mockResolvedValue(LIDO);
  mocks.confirmar.mockReset().mockResolvedValue({ data: { ok: true, status: "sent" } });
  mocks.reload.mockReset().mockResolvedValue(undefined);
  mocks.atualizar.mockReset().mockResolvedValue(undefined);
  mocks.criar.mockReset().mockImplementation(async () => {
    mocks.auth.currentUser = mocks.usuario;
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
  document.body.innerHTML = "";
  window.history.replaceState({}, "", "/");
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function passar(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

async function montar(no = <ConvitePage />) {
  await act(async () =>
    root.render(
      <>
        {no}
        <Anunciador />
      </>,
    ),
  );
}

const botao = (texto: string) =>
  [...container.querySelectorAll("button")].find(
    (node) => (node.querySelector(".botao-acao-camada[data-atual]")?.textContent ?? node.textContent)?.trim() === texto,
  );

const titulo = () => container.querySelector("h1")!;
/** A capa, sem a região do Anunciador (o que ele diz não é texto da tela). */
const capa = () => container.querySelector(".auth-cover")!.outerHTML;

async function axe(html: string) {
  vi.useRealTimers();
  const violacoes = await violacoesDeAcessibilidade(html);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
  return violacoes;
}

describe("o convite que ainda lê", () => {
  it("aos 300 ms, a caixa e o gerúndio; aos 10 s, a demora com Tentar de novo, que lê o convite de novo; o foco vai ao título", async () => {
    mocks.lookup.mockReset().mockImplementationOnce(() => new Promise(() => undefined)).mockResolvedValue(LIDO);
    await montar();
    expect(container.textContent).not.toContain("Conferindo seu convite");
    await passar(CARREGANDO.atrasoMs);
    expect(textosForaDaLista(capa(), ["Validando convite", "Conferindo seu convite…", RODAPE])).toEqual([]);
    await passar(CARREGANDO.demoraMs - CARREGANDO.atrasoMs);
    const html = capa();
    expect(textosForaDaLista(html, ["Validando convite", "Conferindo seu convite…", "Demorando mais que o normal", "Tentar de novo", RODAPE])).toEqual([]);
    expect(await axe(html)).toEqual([]);

    const tentar = botao("Tentar de novo")!;
    tentar.focus();
    await act(async () => tentar.click());
    expect(mocks.lookup).toHaveBeenCalledTimes(2);
    // O convite chegou: o formulário, com o foco no título da capa, e não no body.
    expect(titulo().textContent).toBe("Aceitar convite");
    expect(document.activeElement).toBe(titulo());
  });

  it("aos 70 s, Sem resposta do servidor. com Tentar de novo", async () => {
    mocks.lookup.mockReset().mockImplementation(() => new Promise(() => undefined));
    await montar();
    await passar(CARREGANDO.desisteMs);
    const html = capa();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Sem resposta do servidor.");
    expect(textosForaDaLista(html, ["Validando convite", "Sem resposta do servidor.", "Tentar de novo", RODAPE])).toEqual([]);
    expect(await axe(html)).toEqual([]);
    await act(async () => botao("Tentar de novo")!.click());
    expect(mocks.lookup).toHaveBeenCalledTimes(2);
  });
});

describe("o envio do e-mail que segue o Aceitar convite", () => {
  it("a espera fica à vista no botão do envio (Enviando…), e o foco que estava no formulário vai ao título", async () => {
    mocks.confirmar.mockReset().mockImplementation(() => new Promise(() => undefined));
    await montar();
    const senha = container.querySelector<HTMLInputElement>("#convite-senha")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(senha, "senha-de-teste");
      senha.dispatchEvent(new Event("input", { bubbles: true }));
    });
    senha.focus();
    await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(titulo().textContent).toBe("Confirme seu e-mail");
    expect(document.activeElement).toBe(titulo());
    await passar(CARREGANDO.atrasoMs);
    const reenviar = container.querySelectorAll<HTMLButtonElement>("button[data-estado]")[1];
    expect(reenviar.getAttribute("data-estado")).toBe("andamento");
    expect(reenviar.getAttribute("aria-busy")).toBe("true");
    expect(reenviar.hasAttribute("disabled")).toBe(false);
    expect(reenviar.querySelector(".botao-acao-camada[data-atual]")?.textContent).toBe("Enviando…");
    const jaConfirmei = botao("Já confirmei")!;
    expect(jaConfirmei.getAttribute("aria-disabled")).toBe("true");
    const html = capa();
    expect(
      textosForaDaLista(html, ["Confirme seu e-mail", "Confirme o endereço", "ana@example.com", ".", "Já confirmei", "Conferindo…", "Reenviar e-mail", "Enviando…", "Conferir", "Sair", RODAPE]),
    ).toEqual([]);
    expect(await axe(html)).toEqual([]);
  });
});

describe("a troca de tela do convite", () => {
  const CONVITE = { token: TOKEN, email: "ana@example.com", nome: "Ana", role: "cliente", cliente: "Itaú Unibanco" } as never;
  const NADA = () => undefined;
  const ACOES: AcoesDoConvite = {
    lerDeNovo: NADA, nome: NADA, senha: NADA, aceitar: NADA, jaConfirmei: NADA, reenviar: NADA, sair: NADA,
    jaTenhoConta: NADA, voltarAoLogin: NADA, sairDaOutraConta: NADA, voltarAoSistema: NADA,
  };
  const tela = (estado: TelaDoConvite) => <ConviteView estado={estado} nome="Ana" senha="" erro={null} ocupado={false} acoes={ACOES} />;

  it("Já confirmei que confirmou: o foco vai ao título E-mail confirmado", async () => {
    await montar(tela({ tela: "confirmar", convite: CONVITE, reenviado: false, enviado: true }));
    botao("Já confirmei")!.focus();
    await montar(tela({ tela: "confirmado", convite: CONVITE }));
    expect(titulo().textContent).toBe("E-mail confirmado");
    expect(document.activeElement).toBe(titulo());
  });

  it("Sair e continuar com o convite: o foco vai ao título do formulário", async () => {
    await montar(tela({ tela: "outra_conta", email: "joao@dutelog.com.br" }));
    botao("Sair e continuar com o convite")!.focus();
    await montar(tela({ tela: "formulario", convite: CONVITE }));
    expect(document.activeElement).toBe(titulo());
  });

  it("sem o foco na tela que saiu, ninguém o move", async () => {
    await montar(tela({ tela: "confirmar", convite: CONVITE, reenviado: false, enviado: true }));
    await montar(tela({ tela: "confirmado", convite: CONVITE }));
    expect(document.activeElement).toBe(document.body);
  });
});
