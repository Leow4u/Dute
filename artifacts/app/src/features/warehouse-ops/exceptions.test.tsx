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
 * selecionado": o selo fica no lugar, com o bloco no lugar do número, e
 * "Carregando exceções…" aos 300 ms. A leitura que falha nunca vira "Sem
 * exceções abertas": o aviso com "Tentar de novo", e o foco vai à linha de
 * estado quando ele sai. O Atualizar é o das listas (o ícone vira a caixa) e
 * só mostra a espera quando a pessoa toca nele; a releitura que ele pede e
 * falha fica na linha de estado. O "Confirmar tratativa" é o BotaoDeAcao,
 * ocupado sem `disabled`. Relógio simulado: a espera de 300 ms não depende da
 * máquina. Dados sintéticos.
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

async function pausa(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function esperar(condicao: () => boolean, oQue: string) {
  for (let volta = 0; volta < 300; volta += 1) {
    if (condicao()) return;
    await pausa(10);
  }
  throw new Error(`Não aconteceu: ${oQue}`);
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
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse("2026-11-13T13:42:00Z"));
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** O axe roda no relógio de verdade (ele espera com temporizadores próprios). */
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
    const lendo = container.innerHTML;
    await esperar(() => naTela().includes("PED-1042"), "as exceções");
    expect(naTela()).toContain("2 aberta(s)");
    expect(await axe(lendo)).toEqual([]);
  });

  it("a leitura que falha nunca vira \"Sem exceções abertas\": o aviso com Tentar de novo", async () => {
    estado.falha = true;
    await montar();
    await esperar(() => naTela().includes("Não consegui carregar as exceções."), "o aviso da falha");
    expect(naTela()).not.toMatch(/Sem exceções abertas|Nada selecionado|\b0 aberta/);
    expect(botao("Tentar de novo")).toBeTruthy();
    expect(await axe(container.innerHTML)).toEqual([]);
    estado.falha = false;
    const tentar = botao("Tentar de novo")!;
    tentar.focus();
    await act(async () => tentar.click());
    await esperar(() => naTela().includes("PED-1042"), "as exceções depois da nova tentativa");
    // O aviso saiu com o foco nele: o foco vai à linha de estado, que diz a hora, nunca ao body (2.4.3).
    expect(document.activeElement).toBe(container.querySelector("[data-linha-de-estado]"));
    expect(document.activeElement?.id).toBe("excecoes-linha-de-estado");
  });

  it("antes de ler, o selo fica no lugar com o bloco no lugar do número: nada pula quando a contagem chega", async () => {
    estado.atrasoMs = 1_000;
    await montar();
    const seloAntes = container.querySelector("[data-esqueleto]")?.closest("div.inline-flex, span, div");
    expect(container.querySelector('[data-esqueleto][data-forma="contagem"]')).not.toBeNull();
    expect(seloAntes).not.toBeNull();
    // O selo antes de ler é desenho, fora da árvore: quem diz a espera é "Carregando exceções…".
    expect(container.querySelector('[data-esqueleto][data-forma="contagem"]')!.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(naTela()).not.toMatch(/\b0 aberta/);
    // O selo vem antes do Atualizar, no mesmo lugar, antes e depois de ler.
    const ordem = () => {
      const atualizar = container.querySelector("button[data-atualizar]")!;
      return atualizar.parentElement!.firstElementChild!.textContent?.includes("aberta(s)") ?? false;
    };
    expect(ordem()).toBe(true);
    await esperar(() => naTela().includes("PED-1042"), "as exceções");
    expect(naTela()).toContain("2 aberta(s)");
    expect(ordem()).toBe(true);
  });
});

describe("Exceções, o Atualizar das listas", () => {
  it("é o Atualizar das listas: o ícone vira a caixa, o rótulo não muda e nunca diz \"Atualizando…\"", async () => {
    await montar();
    await esperar(() => naTela().includes("PED-1042"), "as exceções");
    const atualizar = container.querySelector<HTMLButtonElement>("button[data-atualizar]");
    expect(atualizar).not.toBeNull();
    expect(atualizar!.textContent?.trim()).toBe("Atualizar");
    expect(container.innerHTML).not.toContain("Atualizando…");
    estado.atrasoMs = 800;
    await act(async () => atualizar!.click());
    await pausa(350);
    expect(atualizar!.getAttribute("aria-busy")).toBe("true");
    expect(atualizar!.textContent?.trim()).toBe("Atualizar");
    expect(atualizar!.querySelector("[data-spinner]")).not.toBeNull();
    await pausa(800);
  });

  it("o Atualizar tocado que falha com a lista lida: a linha de estado diz, e a lista fica", async () => {
    await montar();
    await esperar(() => naTela().includes("PED-1042"), "as exceções");
    estado.falha = true;
    await act(async () => container.querySelector<HTMLButtonElement>("button[data-atualizar]")!.click());
    await esperar(() => /Não consegui atualizar/.test(container.querySelector("[data-linha-de-estado]")?.textContent ?? ""), "a falha na linha");
    expect(naTela()).toContain("PED-1042");
    expect(container.querySelector("[data-linha-de-estado]")?.textContent).toMatch(/Não consegui atualizar· lista de \d{2}:\d{2}Tentar de novo/);
  });
});

describe("Exceções, o Atualizar e a tratativa", () => {
  it("a releitura automática não gira nem desabilita o Atualizar; o toque nele fica ocupado sem disabled e o foco fica", async () => {
    await montar();
    await esperar(() => naTela().includes("PED-1042"), "as exceções");
    const atualizar = container.querySelector<HTMLButtonElement>("button[data-atualizar]")!;
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
    expect(await axe(container.innerHTML)).toEqual([]);
    await act(async () => estado.pendentes[0]!.responder());
    await pausa(50);
  });
});
