// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosForaDaLista } from "@/test/textos";

/**
 * Pessoas e acessos no carregamento v2 (parte 13e). Sem rede, os convites
 * iam ao Firestore fora do `lib/cloud-api.ts` e a lista vinha do cache como
 * se fosse a de agora (diagnóstico, 9.4, "Ficam para depois"); a releitura
 * que falhava trocava a lista inteira pelo aviso; o "Carregando pessoas…"
 * era uma região viva solta; e cancelar o convite, trocar o perfil ou
 * devolver o acesso, direto do menu, não diziam nada na linha. Dados
 * sintéticos.
 */

const estado = vi.hoisted(() => ({
  convites: [] as Array<Record<string, unknown>>,
  usuarios: [] as Array<Record<string, unknown>>,
  usuariosFalham: false,
  usuariosPresos: false,
  soNoCache: false,
  cancelamentos: [] as string[],
  segurarCancelamento: null as null | (() => void),
}));

vi.mock("@workspace/api-client-react", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  return {
    useListBillingUsers: () =>
      useQuery({
        queryKey: ["billing-users"],
        queryFn: async () => {
          if (estado.usuariosPresos) return new Promise(() => undefined);
          if (estado.usuariosFalham) throw new Error("Falhou.");
          return { items: estado.usuarios };
        },
        refetchOnWindowFocus: false,
      }),
    getListBillingUsersQueryKey: () => ["billing-users"],
    useUpdateUserRole: () => ({ mutate: vi.fn(), isPending: false }),
  };
});
vi.mock("@/lib/auth", () => ({ useAppUser: () => ({ user: { uid: "owner-a", publicMetadata: { role: "owner" } }, isLoaded: true }) }));
vi.mock("@/lib/firebase", () => ({ firestore: {}, firebaseAuth: null }));
vi.mock("firebase/firestore", async (original) => ({
  ...(await original<typeof import("firebase/firestore")>()),
  collection: () => ({}),
  getDocs: async () => ({
    docs: estado.convites.map((item) => ({ id: item.id, data: () => item })),
    metadata: { fromCache: estado.soNoCache },
  }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));

import Users from "./users";

const CONVITE = { id: "a".repeat(36), nome: "Paula Souza", email: "paula@dutelog.com.br", role: "interno", status: "pending", email_status: "sent" };
const OUTRO = { id: "b".repeat(36), nome: "Rui Lima", email: "rui@dutelog.com.br", role: "interno", status: "pending", email_status: "sent" };

let raiz: Root | null = null;
let container: HTMLDivElement;
let cliente: QueryClient;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  estado.convites = [{ ...CONVITE }, { ...OUTRO }];
  estado.usuarios = [];
  estado.usuariosFalham = false;
  estado.usuariosPresos = false;
  estado.soNoCache = false;
  estado.cancelamentos = [];
  estado.segurarCancelamento = null;
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(entrada), window.location.origin);
      if (url.pathname.startsWith("/api/invites/") && init?.method === "DELETE") {
        estado.cancelamentos.push(url.pathname);
        await new Promise<void>((pronto) => {
          estado.segurarCancelamento = pronto;
        });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
  window.history.replaceState({}, "", "/configuracoes/pessoas");
  container = document.createElement("div");
  document.body.append(container);
  raiz = createRoot(container);
  cliente = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});

afterEach(() => {
  estado.segurarCancelamento?.();
  act(() => raiz?.unmount());
  raiz = null;
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const espera = (ms: number) => act(async () => new Promise((pronto) => setTimeout(pronto, ms)));

async function esperar(condicao: () => boolean, oQue: string) {
  for (let volta = 0; volta < 150; volta += 1) {
    if (condicao()) return;
    await espera(10);
  }
  throw new Error(`Não aconteceu: ${oQue}`);
}

async function abrir() {
  await act(async () =>
    raiz!.render(
      <QueryClientProvider client={cliente}>
        <Users />
      </QueryClientProvider>,
    ),
  );
}

const linhaDe = (nome: string) =>
  [...document.querySelectorAll<HTMLElement>('ul[aria-label="Equipe Dutelog"] > li')].find((linha) => linha.textContent?.includes(nome));
const menuDe = (nome: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="Ações de ${nome}"]`);

describe("Pessoas e acessos lendo", () => {
  it("a espera aos 300 ms, com a caixa e sem região viva solta", async () => {
    estado.convites = [];
    // A leitura dos perfis fica presa: só a espera na tela.
    estado.usuariosPresos = true;
    await abrir();
    expect(container.textContent).not.toContain("Carregando pessoas…");
    await esperar(() => Boolean(container.textContent?.includes("Carregando pessoas…")), "a espera aos 300 ms");
    expect(container.textContent).toContain("Carregando pessoas…");
    expect(container.querySelector("[data-carregando-na-regiao] [data-spinner]")).not.toBeNull();
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(textosForaDaLista(container.innerHTML, ["Pessoas e acessos", "Convidar pessoa", "Carregando pessoas…"])).toEqual([]);
    expect(await violacoesDeAcessibilidade(container.innerHTML)).toEqual([]);
  });
});

describe("Pessoas e acessos sem conexão", () => {
  it("os convites que só acharam o cache são falta de conexão: o aviso, nunca a lista do cache", async () => {
    estado.soNoCache = true;
    await abrir();
    await esperar(() => /Reconectando…|Sem conexão\./.test(container.textContent ?? ""), "o aviso da falta");
    expect(container.textContent).not.toContain("Paula Souza");
    expect(container.textContent).toContain("Tentar de novo");
  });

  it("a releitura que falha não apaga a lista lida, e a falha fica escrita em cima dela, sem falar", async () => {
    await abrir();
    await esperar(() => Boolean(linhaDe("Paula Souza")), "a lista");
    estado.usuariosFalham = true;
    await act(async () => {
      await cliente.refetchQueries({ queryKey: ["billing-users"] }).catch(() => undefined);
    });
    await espera(30);
    expect(linhaDe("Paula Souza")).toBeTruthy();
    expect(container.textContent).not.toContain("Não foi possível carregar as pessoas e os convites.");
    // Erro nunca some: a falha da releitura fica escrita, com a nova tentativa, fora de região viva (momento 7).
    const falha = container.querySelector<HTMLElement>("[data-falha-na-secao]");
    expect(falha?.textContent).toContain("Não foi possível atualizar as pessoas.");
    expect(falha?.querySelector('[role="alert"]')).toBeNull();
    expect(textosForaDaLista(falha!.outerHTML, ["Não foi possível atualizar as pessoas.", "Tentar de novo", "Tentando de novo…"])).toEqual([]);
    // A nova tentativa que dá certo tira a falha.
    estado.usuariosFalham = false;
    await act(async () => [...falha!.querySelectorAll("button")].find((botao) => botao.textContent === "Tentar de novo")!.click());
    await esperar(() => !container.querySelector("[data-falha-na-secao]"), "a falha sair");
    expect(linhaDe("Paula Souza")).toBeTruthy();
  });
});

describe("a ação do menu na linha da pessoa", () => {
  it("cancelar o convite: a linha dela diz o que faz, com a caixa no lugar do ⋯; as outras seguem livres", async () => {
    await abrir();
    await esperar(() => Boolean(menuDe("Paula Souza")), "o menu da Paula");
    await act(async () => {
      menuDe("Paula Souza")!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    });
    await esperar(() => document.querySelector('[role="menu"]') !== null, "o menu");
    const cancelar = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent === "Cancelar convite")!;
    await act(async () => cancelar.click());
    await esperar(() => estado.cancelamentos.length === 1, "o pedido de cancelamento");
    // O gerúndio na linha e a caixa no ⋯ entram cada um no seu relógio de 300 ms: espera os dois, não um quadro entre eles.
    await esperar(
      () =>
        Boolean(linhaDe("Paula Souza")?.textContent?.includes("Cancelando o convite…")) &&
        linhaDe("Paula Souza")?.querySelector('button[aria-label="Cancelando o convite de Paula Souza"]')?.getAttribute("aria-busy") === "true",
      "o gerúndio na linha e a caixa no ⋯",
    );
    const linha = linhaDe("Paula Souza")!;
    expect(linha.textContent).toContain("Cancelando o convite…");
    expect(textosForaDaLista(linha.querySelector("[data-andamento-na-linha]")!.outerHTML, ["Cancelando o convite…"])).toEqual([]);
    const gatilho = linha.querySelector<HTMLButtonElement>('button[aria-label="Cancelando o convite de Paula Souza"]')!;
    expect(gatilho).toBeTruthy();
    expect(gatilho.getAttribute("aria-busy")).toBe("true");
    expect(gatilho.getAttribute("aria-disabled")).toBe("true");
    expect(gatilho.disabled).toBe(false);
    expect(gatilho.querySelector("[data-spinner]")).not.toBeNull();
    // A outra linha não espera.
    expect(linhaDe("Rui Lima")!.textContent).not.toContain("Cancelando");
    expect(menuDe("Rui Lima")!.hasAttribute("aria-busy")).toBe(false);
    // O menu da linha ocupada não abre de novo.
    await act(async () => {
      gatilho.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    });
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(await violacoesDeAcessibilidade(container.innerHTML)).toEqual([]);
    estado.convites = [{ ...OUTRO }];
    await act(async () => estado.segurarCancelamento?.());
    await esperar(() => !linhaDe("Paula Souza"), "o convite cancelado sair da lista");
    expect(estado.cancelamentos).toHaveLength(1);
  });
});
