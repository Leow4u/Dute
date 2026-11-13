// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

import { Anunciador } from "@/lib/carregando/anunciador";
import { ProvedorDaConexao } from "@/lib/carregando/estado-da-conexao";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { conexaoEm } from "@/test/conexao";
import { textosForaDaLista } from "@/test/textos";

/**
 * As Solicitações no carregamento v2 (parte 13c; diagnóstico, 4.3 e
 * necessidades 2, 5, 8 e 10). Antes: "Carregando solicitações..." seco no
 * lugar da fila; o Atualizar girava e ficava `disabled` em toda releitura,
 * também a automática (2 min); a releitura que falhava trocava a fila lida
 * por "Não consegui carregar a fila."; "Aprovando..." e "Encerrando..." só
 * trocavam o texto de um botão `disabled`, e o "Recusar com motivo" apagava
 * junto; o "Conferindo saldo" girava um ícone. Agora: a linha de estado sob
 * o título ("Carregando solicitações…", "Atualizado às", "Não consegui
 * atualizar · lista de"), os cartões-fantasma, a falha com "Tentar de novo"
 * só sem nada lido, o Atualizar das listas e o BotaoDeAcao. Relógio simulado.
 * Dados sintéticos.
 */

const estado = vi.hoisted(() => ({
  atrasoMs: 20,
  falha: false,
  decisoes: [] as Array<{ caminho: string; responder: () => void }>,
}));

vi.mock("@/lib/auth", () => ({
  useAppUser: () => ({ user: { uid: "coord-1", publicMetadata: { role: "interno" } }, isLoaded: true }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));
vi.mock("@/lib/use-item-photos", () => ({ useItemPhotos: () => Object.assign(() => undefined, { lendo: false }) }));

import CustomerRequests from "./customer-requests";

const FARIA_LIMA = {
  id: "creq_0412",
  customer_code: "BTG Pactual",
  type: "retirada",
  priority: "normal",
  status: "pending",
  description: "Pedido da Faria Lima",
  created_at: "2026-11-13T09:00:00.000Z",
  items: [{ sku_code: "BTG-000101", quantity: 10 }],
};

const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });

async function servir(entrada: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(String(entrada), "http://localhost");
  if ((init?.method ?? "GET").toUpperCase() === "POST") {
    return new Promise<Response>((resolver) =>
      estado.decisoes.push({ caminho: url.pathname, responder: () => resolver(json({ ok: true, status: "approved" })) }),
    );
  }
  await new Promise((pronto) => setTimeout(pronto, estado.atrasoMs));
  if (url.pathname === "/api/customer-requests") return estado.falha ? json({ error: "Falha no servidor" }, 500) : json({ items: [FARIA_LIMA] });
  if (url.pathname === "/api/stock-balances") {
    return json({ items: [{ sku_code: "BTG-000101", customer_code: "BTG Pactual", qty_on_hand: 100, qty_reserved: 0, qty_available: 100 }] });
  }
  return json({});
}

let raiz: Root | null = null;
let container: HTMLDivElement;
let cliente: QueryClient;

async function pausa(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function esperar(condicao: () => boolean, oQue: string) {
  for (let volta = 0; volta < 400; volta += 1) {
    if (condicao()) return;
    await pausa(10);
  }
  throw new Error(`Não aconteceu: ${oQue}`);
}

const naTela = () => {
  const copia = container.cloneNode(true) as HTMLElement;
  copia.querySelector("[data-anunciador]")?.remove();
  copia.querySelectorAll(".botao-acao-camada:not([data-atual])").forEach((camada) => camada.remove());
  return (copia.textContent ?? "").replace(/\s+/g, " ");
};
const botao = (rotulo: string) =>
  Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (item) => (item.querySelector(".botao-acao-camada[data-atual]")?.textContent ?? item.textContent)?.trim() === rotulo,
  );
const atualizar = () => container.querySelector<HTMLButtonElement>("button[data-atualizar]");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse("2026-11-13T13:42:00Z"));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(servir));
  window.history.replaceState(null, "", "/solicitacoes");
  estado.atrasoMs = 20;
  estado.falha = false;
  estado.decisoes.length = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  cliente = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } } });
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  cliente.clear();
  container.remove();
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function axe(html: string) {
  vi.useRealTimers();
  const violacoes = await violacoesDeAcessibilidade(html);
  vi.useFakeTimers();
  return violacoes;
}

async function montar() {
  raiz = createRoot(container);
  await act(async () => {
    raiz!.render(
      <ProvedorDaConexao value={conexaoEm("conectado")}>
        <QueryClientProvider client={cliente}>
          <Router ssrPath="/solicitacoes">
            <Anunciador />
            <CustomerRequests />
          </Router>
        </QueryClientProvider>
      </ProvedorDaConexao>,
    );
  });
}

describe("Solicitações, a fila", () => {
  it("antes de ler, a linha de estado diz \"Carregando solicitações…\" sob o título, sem o texto seco e sem vazio", async () => {
    estado.atrasoMs = 2_000;
    await montar();
    expect(naTela()).not.toContain("Carregando solicitações...");
    expect(naTela()).not.toMatch(/Nenhuma solicitação/);
    await pausa(350);
    expect(container.querySelector("[data-linha-de-estado]")?.textContent).toContain("Carregando solicitações…");
    expect(naTela()).not.toContain("...");
    expect(naTela()).not.toMatch(/Nenhuma solicitação/);
    // Os cartões-fantasma ficam no lugar da fila, apontando para a linha de estado.
    expect(container.querySelector('[aria-busy="true"][aria-describedby]')).not.toBeNull();
    expect(container.querySelector(".animate-spin")).toBeNull();
    const html = container.innerHTML;
    expect(
      textosForaDaLista(html, ["Solicitações", "Carregando solicitações…", "Atualizar", "Para aprovar", "Aprovadas", "Encerradas", "Carregando solicitações"]),
    ).toEqual([]);
    await pausa(2_000);
    await esperar(() => naTela().includes("Pedido da Faria Lima"), "a fila");
    expect(await axe(html)).toEqual([]);
  });

  it("a leitura que falha sem nada lido mostra a falha com Tentar de novo, nunca o vazio", async () => {
    estado.falha = true;
    await montar();
    await esperar(() => naTela().includes("Não consegui carregar as solicitações."), "a falha");
    expect(naTela()).not.toMatch(/Nenhuma solicitação/);
    expect(botao("Tentar de novo")).toBeTruthy();
    estado.falha = false;
    await act(async () => botao("Tentar de novo")!.click());
    await esperar(() => naTela().includes("Pedido da Faria Lima"), "a fila depois da nova tentativa");
  });

  it("a releitura que falha com a fila lida não a apaga: a linha de estado diz que não atualizou", async () => {
    await montar();
    await esperar(() => naTela().includes("Pedido da Faria Lima"), "a fila");
    estado.falha = true;
    await act(async () => atualizar()!.click());
    await esperar(() => naTela().includes("Não consegui atualizar"), "a releitura que falhou");
    expect(naTela()).toContain("Pedido da Faria Lima");
    expect(naTela()).not.toContain("Não consegui carregar a fila.");
  });

  it("o Atualizar não gira nem desliga na releitura automática: só o toque mostra a espera", async () => {
    estado.atrasoMs = 1_000;
    await montar();
    await esperar(() => naTela().includes("Pedido da Faria Lima"), "a fila");
    await act(async () => {
      void cliente.invalidateQueries();
    });
    await pausa(400);
    expect(atualizar()!.disabled).toBe(false);
    expect(atualizar()!.getAttribute("aria-busy")).toBeNull();
    expect(atualizar()!.querySelector(".animate-spin")).toBeNull();
  });
});

describe("Solicitações, a decisão", () => {
  it("Aprovar mostra a espera dele, com o foco nele, e o Recusar espera ocupado, nunca desabilitado", async () => {
    await montar();
    await esperar(() => Boolean(botao("Aprovar e separar")) && botao("Aprovar e separar")!.getAttribute("aria-disabled") === null, "o saldo conferido");
    const aprovar = botao("Aprovar e separar")!;
    aprovar.focus();
    await act(async () => aprovar.click());
    await pausa(350);
    expect(estado.decisoes).toHaveLength(1);
    expect(aprovar.getAttribute("aria-busy")).toBe("true");
    expect(aprovar.querySelector(".botao-acao-camada[data-atual]")?.textContent).toBe("Aprovando…");
    expect(aprovar.disabled).toBe(false);
    expect(document.activeElement).toBe(aprovar);
    const recusar = botao("Recusar com motivo")!;
    expect(recusar.getAttribute("aria-disabled")).toBe("true");
    expect(recusar.disabled).toBe(false);
    await act(async () => estado.decisoes[0]!.responder());
  });
});
