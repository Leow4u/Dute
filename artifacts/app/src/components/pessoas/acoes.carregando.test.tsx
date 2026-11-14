// @vitest-environment jsdom
import { QueryClient, QueryClientProvider, useMutation } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * As ações que saem direto do menu de cada pessoa, com a espera na linha
 * (carregamento v2, parte 13e): cada linha espera a própria gravação.
 * Trocar o perfil de duas pessoas seguidas soltava só a última (o
 * react-query dá os avisos do pedido só ao último `mutate`); o menu reabria
 * sozinho quando a ação acabava; e devolver o acesso de uma pessoa travava o
 * "Devolver acesso" das outras. Dados sintéticos.
 */

const estado = vi.hoisted(() => ({
  perfis: [] as Array<{ id: string; responder: () => void }>,
  acessos: [] as Array<{ id: string; responder: () => void }>,
  toasts: [] as Array<{ title?: string }>,
}));

vi.mock("@workspace/api-client-react", () => ({
  useUpdateUserRole: () =>
    useMutation({
      mutationKey: ["updateUserRole"],
      mutationFn: (vars: { id: string; data: { role: string } }) =>
        new Promise((pronto) => estado.perfis.push({ id: vars.id, responder: () => pronto({ ok: true }) })),
    }),
}));
vi.mock("@/lib/auth", () => ({ useAppUser: () => ({ user: { uid: "owner-a", publicMetadata: { role: "owner" } }, isLoaded: true }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: (toast: { title?: string }) => estado.toasts.push(toast) }) }));

import { ANDAMENTO_NA_LINHA, AndamentoNaLinha, MenuDaPessoa, useAcoesDasPessoas, type AcoesDasPessoas } from "./acoes";
import { textosForaDaLista } from "@/test/textos";
import type { Person } from "@/lib/pessoas";

let raiz: Root | null = null;
let container: HTMLDivElement;
let acoes: AcoesDasPessoas;

function Pessoas({ pessoas }: { pessoas: Person[] }) {
  acoes = useAcoesDasPessoas({ refresh: async () => undefined, onConvidarDeNovo: () => undefined });
  return (
    <ul>
      {pessoas.map((person) => (
        <li key={person.key}>
          {person.name}
          <AndamentoNaLinha acoes={acoes} person={person} />
          <MenuDaPessoa acoes={acoes} person={person} />
        </li>
      ))}
    </ul>
  );
}

const ativa = (id: string, name: string): Person =>
  ({ key: `user:${id}`, id, kind: "user", name, email: `${id}@dutelog.com.br`, role: "interno", state: "active" }) as unknown as Person;
const removida = (id: string, name: string): Person =>
  ({ key: `user:${id}`, id, kind: "user", name, email: `${id}@dutelog.com.br`, role: "interno", state: "removed" }) as unknown as Person;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  vi.stubGlobal(
    "fetch",
    vi.fn((entrada: RequestInfo | URL) => {
      const url = new URL(String(entrada), window.location.origin);
      const id = decodeURIComponent(url.pathname.split("/")[4] ?? "");
      return new Promise<Response>((pronto) =>
        estado.acessos.push({ id, responder: () => pronto(new Response(JSON.stringify({ ok: true }), { status: 200 })) }),
      );
    }),
  );
  estado.perfis = [];
  estado.acessos = [];
  estado.toasts = [];
  container = document.createElement("div");
  document.body.append(container);
  raiz = createRoot(container);
});

afterEach(() => {
  for (const pedido of [...estado.perfis, ...estado.acessos]) pedido.responder();
  act(() => raiz?.unmount());
  raiz = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const espera = (ms: number) => act(async () => new Promise((pronto) => setTimeout(pronto, ms)));

async function esperar(condicao: () => boolean, oQue: string) {
  for (let volta = 0; volta < 300; volta += 1) {
    if (condicao()) return;
    await espera(10);
  }
  throw new Error(`Não aconteceu: ${oQue}`);
}

async function montar(pessoas: Person[]) {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () =>
    raiz!.render(
      <QueryClientProvider client={cliente}>
        <Pessoas pessoas={pessoas} />
      </QueryClientProvider>,
    ),
  );
}

const gatilho = (nome: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="Ações de ${nome}"]`);

async function abrirMenu(nome: string) {
  await act(async () => {
    gatilho(nome)!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
  });
  await esperar(() => document.querySelector('[role="menu"]') !== null, `o menu de ${nome}`);
}

const item = (rotulo: string) => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((elemento) => elemento.textContent?.trim() === rotulo);

describe("trocar o perfil de duas pessoas seguidas", () => {
  it("as duas linhas voltam ao repouso quando as duas gravações respondem, cada uma com o aviso dela", async () => {
    const ana = ativa("ana", "Ana Lima");
    const bia = ativa("bia", "Bia Costa");
    await montar([ana, bia]);
    await act(async () => acoes.changeRole(ana, "admin"));
    await act(async () => acoes.changeRole(bia, "admin"));
    await esperar(() => estado.perfis.length === 2, "as duas gravações");
    // Aos 300 ms, cada linha diz o que faz, com o gerúndio da lista dos textos.
    await esperar(() => document.querySelectorAll("[data-andamento-na-linha]").length === 2, "o gerúndio nas duas linhas");
    for (const andamento of document.querySelectorAll("[data-andamento-na-linha]")) {
      expect(textosForaDaLista(andamento.outerHTML, Object.values(ANDAMENTO_NA_LINHA))).toEqual([]);
      expect(andamento.textContent).toBe("Trocando o perfil…");
    }
    await act(async () => {
      for (const pedido of estado.perfis) pedido.responder();
    });
    // Passa o mínimo do "em andamento" e o tempo do sucesso.
    await esperar(() => !acoes.linhas.ocupada(ana.key) && !acoes.linhas.ocupada(bia.key), "as duas linhas soltarem");
    expect(acoes.linhas.estado(ana.key, "perfil")).toBe("repouso");
    expect(acoes.linhas.estado(bia.key, "perfil")).toBe("repouso");
    expect(estado.toasts.filter((toast) => toast.title === "Perfil alterado")).toHaveLength(2);
  }, 10_000);
});

describe("o menu da pessoa", () => {
  it("não reabre sozinho quando a ação que saiu dele acaba", async () => {
    const caio = removida("caio", "Caio Reis");
    await montar([caio]);
    await abrirMenu("Caio Reis");
    await act(async () => item("Devolver acesso")!.click());
    await esperar(() => estado.acessos.length === 1, "o pedido de devolução");
    expect(document.querySelector('[role="menu"]')).toBeNull();
    await act(async () => estado.acessos[0]!.responder());
    await esperar(() => !acoes.linhas.ocupada(caio.key), "a linha soltar");
    await espera(100);
    expect(document.querySelector('[role="menu"]')).toBeNull();
  }, 10_000);

  it("devolver o acesso de uma pessoa não trava o Devolver acesso das outras", async () => {
    const caio = removida("caio", "Caio Reis");
    const lia = removida("lia", "Lia Matos");
    await montar([caio, lia]);
    await act(async () => acoes.devolverAcesso(caio));
    await esperar(() => estado.acessos.length === 1, "o pedido de devolução do Caio");
    await esperar(() => document.querySelector("[data-andamento-na-linha]")?.textContent === "Devolvendo o acesso…", "o gerúndio na linha do Caio");
    await abrirMenu("Lia Matos");
    const devolver = item("Devolver acesso")!;
    expect(devolver.hasAttribute("data-disabled")).toBe(false);
    expect(devolver.getAttribute("aria-disabled")).not.toBe("true");
  });

  it("no celular, o ⋯ tem o alvo de 44 px", async () => {
    await montar([ativa("ana", "Ana Lima")]);
    expect(gatilho("Ana Lima")!.className).toContain("max-md:size-11");
  });
});
