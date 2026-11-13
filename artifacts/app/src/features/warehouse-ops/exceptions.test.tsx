// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Anunciador } from "@/lib/carregando/anunciador";
import { ProvedorDaConexao } from "@/lib/carregando/estado-da-conexao";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { conexaoEm } from "@/test/conexao";
import { textosForaDaLista } from "@/test/textos";

/**
 * As Exceções na migração do carregamento v2 (parte 13b; diagnóstico, 4.5 e
 * necessidades 2, 3, 5 e 8). Antes de ler, nem "0 aberta(s)" nem "Nada
 * selecionado": "Carregando exceções…" aos 300 ms. A leitura que falha nunca
 * vira "Sem exceções abertas": o aviso com "Tentar de novo". O Atualizar só
 * mostra a espera quando a pessoa toca nele (a releitura automática não o
 * gira nem o desabilita), e o "Confirmar tratativa" é o BotaoDeAcao, ocupado
 * sem `disabled`. Dados sintéticos.
 */

const estado = vi.hoisted(() => ({
  atrasoMs: 20,
  falha: false,
  pendentes: [] as Array<{ caminho: string; corpo: Record<string, unknown>; responder: () => void }>,
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));
vi.mock("@/lib/active-customer-context", () => ({ useActiveCustomer: () => ({ code: "BTG", active: { code: "BTG", name: "BTG Pactual" } }) }));

import { ExceptionWorkspace } from "./exceptions";

const EXCECOES = [
  { id: "e1", task_uid: "pick_1", task_type: "picking", reference: "PED-1042", note: "Falta de 2 un. na A-01", severity: "attention", status: "open", customer_code: "BTG", created_at: "2026-11-13T12:00:00.000Z" },
  { id: "e2", task_uid: "inb_1", task_type: "receiving", reference: "NF 4410", note: "Avaria em 1 caixa", severity: "critical", status: "open", customer_code: "BTG", created_at: "2026-11-13T11:00:00.000Z" },
];

async function servir(entrada: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(String(entrada), "http://localhost");
  const metodo = (init?.method ?? "GET").toUpperCase();
  if (metodo === "POST") {
    return new Promise<Response>((resolver) =>
      estado.pendentes.push({
        caminho: url.pathname,
        corpo: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
        responder: () => resolver(new Response(JSON.stringify({ ok: true }), { status: 200 })),
      }),
    );
  }
  await new Promise((pronto) => setTimeout(pronto, estado.atrasoMs));
  if (estado.falha) return new Response(JSON.stringify({ error: "Falha no servidor" }), { status: 500 });
  if (url.pathname === "/api/quality-exceptions") return new Response(JSON.stringify({ items: EXCECOES }), { status: 200 });
  throw new Error(`API inesperada: ${metodo} ${url.pathname}`);
}

let raiz: Root | null = null;
let container: HTMLDivElement;
let cliente: QueryClient;

async function esperar(condicao: () => boolean, oQue: string) {
  for (let volta = 0; volta < 300; volta += 1) {
    if (condicao()) return;
    await act(async () => {
      await new Promise((pronto) => setTimeout(pronto, 10));
    });
  }
  throw new Error(`Não aconteceu: ${oQue}`);
}

async function pausa(ms: number) {
  await act(async () => {
    await new Promise((pronto) => setTimeout(pronto, ms));
  });
}

const naTela = () => {
  const copia = container.cloneNode(true) as HTMLElement;
  copia.querySelector("[data-anunciador]")?.remove();
  return (copia.textContent ?? "").replace(/\s+/g, " ");
};
const botao = (rotulo: string) =>
  Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (item) => item.textContent?.trim() === rotulo || item.querySelector('[data-camada="repouso"]')?.textContent?.trim() === rotulo,
  );

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(servir));
  estado.atrasoMs = 20;
  estado.falha = false;
  estado.pendentes.length = 0;
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
  vi.unstubAllGlobals();
});

async function montar() {
  raiz = createRoot(container);
  await act(async () => {
    raiz!.render(
      <ProvedorDaConexao value={conexaoEm("conectado")}>
        <QueryClientProvider client={cliente}>
          <Anunciador />
          <ExceptionWorkspace />
        </QueryClientProvider>
      </ProvedorDaConexao>,
    );
  });
}

describe("Exceções, a leitura", () => {
  it("antes de ler, nem \"0 aberta(s)\" nem \"Nada selecionado\"; aos 300 ms, \"Carregando exceções…\"", async () => {
    estado.atrasoMs = 1_000;
    await montar();
    expect(naTela()).not.toMatch(/\b0 aberta|Nada selecionado|Sem exceções abertas/);
    await pausa(350);
    expect(naTela()).toContain("Carregando exceções…");
    expect(naTela()).not.toMatch(/\b0 aberta|Nada selecionado|Sem exceções abertas/);
    expect(container.querySelector("[data-anunciador]")?.textContent).toContain("Carregando exceções");
    expect(await violacoesDeAcessibilidade(container.innerHTML)).toEqual([]);
    await esperar(() => naTela().includes("PED-1042"), "as exceções");
    expect(naTela()).toContain("2 aberta(s)");
  });

  it("a leitura que falha nunca vira \"Sem exceções abertas\": o aviso com Tentar de novo", async () => {
    estado.falha = true;
    await montar();
    await esperar(() => naTela().includes("Não consegui carregar as exceções."), "o aviso da falha");
    expect(naTela()).not.toMatch(/Sem exceções abertas|Nada selecionado|\b0 aberta/);
    expect(botao("Tentar de novo")).toBeTruthy();
    expect(await violacoesDeAcessibilidade(container.innerHTML)).toEqual([]);
    estado.falha = false;
    await act(async () => botao("Tentar de novo")!.click());
    await esperar(() => naTela().includes("PED-1042"), "as exceções depois da nova tentativa");
  });
});

describe("Exceções, o Atualizar e a tratativa", () => {
  it("a releitura automática não gira nem desabilita o Atualizar; o toque nele fica ocupado sem disabled e o foco fica", async () => {
    await montar();
    await esperar(() => naTela().includes("PED-1042"), "as exceções");
    const atualizar = botao("Atualizar")!;
    estado.atrasoMs = 800;
    // A releitura automática (o tempo real, o intervalo): começa e segue sem ninguém esperar por ela.
    await act(async () => {
      void cliente.invalidateQueries({ queryKey: ["warehouse-exceptions"] });
    });
    await pausa(400);
    expect(atualizar.hasAttribute("disabled")).toBe(false);
    expect(atualizar.getAttribute("aria-busy")).toBeNull();
    expect(atualizar.querySelector(".animate-spin")).toBeNull();
    await pausa(600);

    atualizar.focus();
    await act(async () => atualizar.click());
    await pausa(350);
    expect(atualizar.hasAttribute("disabled")).toBe(false);
    expect(atualizar.getAttribute("aria-busy")).toBe("true");
    expect(document.activeElement).toBe(atualizar);
    await pausa(800);
  });

  it("\"Confirmar tratativa\" é o BotaoDeAcao: ocupado sem disabled, \"Confirmando…\" e o foco fica nele", async () => {
    await montar();
    await esperar(() => naTela().includes("PED-1042"), "as exceções");
    const campo = container.querySelector<HTMLTextAreaElement>("#exception-resolution")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(campo, "Saldo físico ajustado e pedido liberado.");
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const confirmar = botao("Confirmar tratativa")!;
    confirmar.focus();
    await act(async () => confirmar.click());
    expect(estado.pendentes.map((pendente) => pendente.caminho)).toEqual(["/api/warehouse/exceptions/e1/resolve"]);
    await pausa(350);
    expect(confirmar.hasAttribute("disabled")).toBe(false);
    expect(confirmar.getAttribute("aria-busy")).toBe("true");
    expect(confirmar.querySelector("[data-atual]")?.textContent?.trim()).toBe("Confirmando…");
    expect(document.activeElement).toBe(confirmar);
    await act(async () => confirmar.click());
    expect(estado.pendentes).toHaveLength(1);
    expect(textosForaDaLista(confirmar.outerHTML, ["Confirmar tratativa", "Confirmando…", "Conferir"])).toEqual([]);
    expect(await violacoesDeAcessibilidade(container.innerHTML)).toEqual([]);
    await act(async () => estado.pendentes[0]!.responder());
    await pausa(50);
  });
});
