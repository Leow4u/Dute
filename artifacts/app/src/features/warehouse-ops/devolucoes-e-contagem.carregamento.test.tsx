// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Anunciador } from "@/lib/carregando/anunciador";
import { ProvedorDaConexao } from "@/lib/carregando/estado-da-conexao";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { conexaoEm } from "@/test/conexao";
import { textosForaDaLista } from "@/test/textos";

/**
 * As Devoluções e a contagem cíclica esperam o catálogo antes de dizer "não
 * localizado" (o PR 2 da seção 6 do diagnóstico; carregamento v2, parte 13c).
 * Antes, com o catálogo ainda chegando (ou falhando), a linha digitada dizia
 * "não localizado" e "Não crie SKU duplicado", e a contagem dizia "Produto
 * ainda não localizado": a pessoa ia a Receber cadastrar um produto que já
 * existe. Agora diz "Verificando o catálogo…" com a espera em bloco (nada
 * antes de 300 ms) e, na falha, que o catálogo não veio, com "Tentar de
 * novo". As Devoluções também: a leitura das pendentes que falha nunca vira
 * "Nenhuma devolução recém registrada"; "Registrar devolução" é o
 * BotaoDeAcao; e a disposição de uma linha não apaga a da outra. Relógio
 * simulado. Dados sintéticos.
 */

const estado = vi.hoisted(() => ({
  atrasoDoCatalogoMs: 20,
  catalogoFalha: false,
  pendentesFalham: false,
  pendentes: [] as Array<{ caminho: string; corpo: Record<string, unknown>; responder: () => void }>,
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));
vi.mock("@/lib/active-customer-context", () => ({ useActiveCustomer: () => ({ code: "BTG", active: { code: "BTG", name: "BTG Pactual" } }) }));

import { ReturnWorkspace } from "./exceptions";
import { ExistingCycleCountWorkspace } from "./inventory";

const SKUS = [
  { id: "BTG-000087", sku_code: "BTG-000087", client_item_code: "A.01.0806.004.GG", product_name: "Polo Masculino Piquet Preto · GG", customer_code: "BTG", unit_cost: 52 },
];
const PENDENTES = [
  { id: "ri1", return_id: "ret1", sku_code: "BTG-000087", client_item_code: "A.01.0806.004.GG", product_name: "Polo Masculino Piquet Preto · GG", quantity: 2, status: "pending_disposition", customer_code: "BTG" },
  { id: "ri2", return_id: "ret1", sku_code: "BTG-000088", client_item_code: "A.01.0806.004.G", product_name: "Polo Masculino Piquet Preto · G", quantity: 1, status: "pending_disposition", customer_code: "BTG" },
];

const espera = (ms: number) => new Promise((pronto) => setTimeout(pronto, ms));
const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status });

async function servir(entrada: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(String(entrada), "http://localhost");
  const metodo = (init?.method ?? "GET").toUpperCase();
  if (metodo === "POST") {
    return new Promise<Response>((resolver) =>
      estado.pendentes.push({
        caminho: url.pathname,
        corpo: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
        responder: () => resolver(json({ ok: true })),
      }),
    );
  }
  if (url.pathname === "/api/skus" || url.pathname === "/api/products") {
    await espera(estado.atrasoDoCatalogoMs);
    if (estado.catalogoFalha) return json({ error: "Falha no servidor" }, 500);
    return json({ items: url.pathname === "/api/skus" ? SKUS : [] });
  }
  await espera(20);
  if (url.pathname === "/api/return-items") return estado.pendentesFalham ? json({ error: "Falha" }, 500) : json({ items: PENDENTES });
  if (url.pathname === "/api/returns") return json({ items: [{ id: "ret1", source: "Loja Faria Lima", customer_code: "BTG" }] });
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
  copia.querySelectorAll(".botao-acao-camada:not([data-atual])").forEach((camada) => camada.remove());
  return (copia.textContent ?? "").replace(/\s+/g, " ");
};
/** O botão pelo rótulo: o do texto, ou o da camada atual do BotaoDeAcao. */
const botoes = (rotulo: string) =>
  Array.from(container.querySelectorAll<HTMLButtonElement>("button")).filter(
    (item) => (item.querySelector(".botao-acao-camada[data-atual]")?.textContent ?? item.textContent)?.trim() === rotulo,
  );

async function digitar(seletor: string, valor: string) {
  const campo = container.querySelector<HTMLInputElement>(seletor)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse("2026-11-13T13:42:00Z"));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(servir));
  estado.atrasoDoCatalogoMs = 20;
  estado.catalogoFalha = false;
  estado.pendentesFalham = false;
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

async function montar(tela: ReactElement) {
  raiz = createRoot(container);
  await act(async () => {
    raiz!.render(
      <ProvedorDaConexao value={conexaoEm("conectado")}>
        <QueryClientProvider client={cliente}>
          <Anunciador />
          {tela}
        </QueryClientProvider>
      </ProvedorDaConexao>,
    );
  });
}

describe("Devoluções, o catálogo antes de \"não localizado\"", () => {
  it("com o catálogo chegando, a linha digitada diz que verifica, não \"não localizado\", e não registra", async () => {
    estado.atrasoDoCatalogoMs = 3_000;
    await montar(<ReturnWorkspace />);
    await digitar("#return-client-code-0", "A.01.0806.004.GG");
    expect(naTela()).not.toMatch(/não localizado|Não crie SKU duplicado/);
    await pausa(350);
    expect(naTela()).toContain("Verificando o catálogo…");
    expect(naTela()).toContain("verificando o catálogo");
    expect(naTela()).not.toMatch(/não localizado|Não crie SKU duplicado/);
    const registrar = botoes("Registrar devolução")[0]!;
    expect(registrar.getAttribute("aria-disabled")).toBe("true");
    expect(registrar.disabled).toBe(false);
    // Nenhuma região viva solta: quem fala é o Anunciador.
    expect(container.querySelectorAll('[aria-live]:not([data-anunciador] *):not([data-anunciador])')).toHaveLength(0);
    // Só rótulos, dados e ações (a trava contra legenda), e o axe.
    expect(
      textosForaDaLista(container.querySelector("form")!.outerHTML, [
        "Origem", "Referência", "Itens devolvidos", "Adicionar linha", "Linha 1", "verificando o catálogo", "Verificando o catálogo…",
        "Observações", "Criar devolução não altera saldo. O estoque só muda quando a disposição for “volta para disponível”.",
        "Registrar devolução", "Registrando…", "Conferir",
      ]),
    ).toEqual([]);
    // O axe troca o relógio: roda no fim, sobre o que a tela mostrava na espera.
    const naEspera = container.innerHTML;

    await esperar(() => naTela().includes("cadastro localizado"), "o cadastro achado");
    expect(naTela()).not.toContain("Verificando o catálogo");
    expect(await axe(naEspera)).toEqual([]);
  });

  it("o catálogo que falha diz que não veio, com Tentar de novo, e nunca \"não localizado\"", async () => {
    estado.catalogoFalha = true;
    await montar(<ReturnWorkspace />);
    await digitar("#return-client-code-0", "A.01.0806.004.GG");
    await esperar(() => naTela().includes("Não consegui carregar o catálogo."), "a falha do catálogo");
    expect(naTela()).toContain("sem catálogo");
    expect(naTela()).not.toMatch(/não localizado|Não crie SKU duplicado/);
    expect(botoes("Tentar de novo")).toHaveLength(1);
    expect(botoes("Registrar devolução")[0]!.getAttribute("aria-disabled")).toBe("true");
    expect(await axe(container.innerHTML)).toEqual([]);

    estado.catalogoFalha = false;
    await act(async () => botoes("Tentar de novo")[0]!.click());
    await esperar(() => naTela().includes("cadastro localizado"), "o cadastro depois da nova tentativa");
    expect(naTela()).not.toContain("Não consegui carregar o catálogo.");
  });

  it("com o catálogo lido, o código que não existe diz \"não localizado\", como antes", async () => {
    await montar(<ReturnWorkspace />);
    await esperar(() => naTela().includes("Polo Masculino Piquet Preto · GG"), "as pendentes");
    await pausa(50);
    await digitar("#return-client-code-0", "NAO-EXISTE");
    expect(naTela()).toContain("não localizado");
    expect(naTela()).toContain("Não crie SKU duplicado");
  });
});

describe("Devoluções, as pendentes e a disposição", () => {
  it("a leitura das pendentes que falha nunca vira \"Nenhuma devolução recém registrada\"", async () => {
    estado.pendentesFalham = true;
    await montar(<ReturnWorkspace />);
    await esperar(() => naTela().includes("Não consegui carregar as devoluções pendentes."), "a falha das pendentes");
    expect(naTela()).not.toContain("Nenhuma devolução recém registrada");
    expect(botoes("Tentar de novo")).toHaveLength(1);
  });

  it("a disposição de uma linha mostra a espera dela e não apaga a da outra linha", async () => {
    await montar(<ReturnWorkspace />);
    await esperar(() => botoes("Registrar disposição").length === 2, "as duas pendentes");
    const [primeira, segunda] = botoes("Registrar disposição");
    primeira!.focus();
    await act(async () => primeira!.click());
    await pausa(350);
    expect(estado.pendentes).toHaveLength(1);
    expect(estado.pendentes[0]!.caminho).toContain("/returns/items/ri1/disposition");
    expect(primeira!.getAttribute("aria-busy")).toBe("true");
    expect(primeira!.querySelector(".botao-acao-camada[data-atual]")?.textContent).toBe("Registrando…");
    expect(primeira!.disabled).toBe(false);
    expect(document.activeElement).toBe(primeira);
    // A outra linha segue em repouso, sem o disabled da espera compartilhada.
    expect(segunda!.disabled).toBe(false);
    expect(segunda!.getAttribute("aria-disabled")).toBeNull();
    expect(segunda!.getAttribute("aria-busy")).toBeNull();

    await act(async () => estado.pendentes[0]!.responder());
    await esperar(() => naTela().includes("Disposição registrada: available."), "a linha registrada");
    // O botão saiu com o foco: o foco vai à linha registrada, nunca ao body.
    expect(document.activeElement?.id).toBe("disposicao-ri1");
  });
});

describe("Contagem cíclica, o catálogo antes de \"ainda não localizado\"", () => {
  it("com o catálogo chegando, diz que verifica; com ele lido, o código que não existe diz \"ainda não localizado\"", async () => {
    estado.atrasoDoCatalogoMs = 3_000;
    await montar(<ExistingCycleCountWorkspace />);
    await digitar("#cycle-client-code", "NAO-EXISTE");
    expect(naTela()).not.toContain("Produto ainda não localizado");
    await pausa(350);
    expect(naTela()).toContain("Verificando o catálogo…");
    expect(naTela()).not.toContain("Produto ainda não localizado");
    await pausa(3_000);
    await esperar(() => naTela().includes("Produto ainda não localizado"), "o aviso depois de ler");
    expect(naTela()).not.toContain("Verificando o catálogo");
  });

  it("o catálogo que falha diz que não veio, com Tentar de novo, e nunca \"ainda não localizado\"", async () => {
    estado.catalogoFalha = true;
    await montar(<ExistingCycleCountWorkspace />);
    await digitar("#cycle-client-code", "A.01.0806.004.GG");
    await esperar(() => naTela().includes("Não consegui carregar o catálogo."), "a falha do catálogo");
    expect(naTela()).not.toContain("Produto ainda não localizado");
    expect(botoes("Tentar de novo")).toHaveLength(1);
    expect(botoes("Registrar contagem")[0]!.getAttribute("aria-disabled")).toBe("true");
    expect(await axe(container.innerHTML)).toEqual([]);

    estado.catalogoFalha = false;
    await act(async () => botoes("Tentar de novo")[0]!.click());
    await esperar(() => naTela().includes("Usar este cadastro"), "o cadastro depois da nova tentativa");
    expect(naTela()).not.toContain("Não consegui carregar o catálogo.");
  });
});
