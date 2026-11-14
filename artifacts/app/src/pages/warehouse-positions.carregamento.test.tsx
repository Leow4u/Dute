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
 * Posições na migração do carregamento v2 (parte 13b; diagnóstico, 4.7 e
 * necessidades 2 e 5). A leitura que falha sem nada lido mostra o aviso com
 * "Tentar de novo", e não a tabela vazia ("Nenhuma posição com esses
 * filtros", "0 de 0 posições") junto do alerta. "Carregar mapa inicial" é o
 * BotaoDeAcao ("Carregando mapa inicial…", o gerúndio do rótulo), ocupado
 * sem `disabled`: o foco fica nele, fora de um alerta, e vai à linha de
 * estado quando o mapa entra. As ações do cabeçalho esperam com `aria-disabled`. A linha de estado
 * sob o título diz de quando é a lista, e a releitura que falha não apaga a
 * tabela. Dados sintéticos.
 */

type Pendente = { caminho: string; responder: (corpo: unknown, status?: number) => void };

const estado = vi.hoisted(() => ({
  posicoes: [] as Array<Record<string, unknown>>,
  falhaNaLeitura: false,
  pendentes: [] as Pendente[],
}));

vi.mock("@/lib/auth", () => ({ useAppUser: () => ({ user: { publicMetadata: { role: "admin" } } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));
vi.mock("wouter", async (original) => ({ ...(await original<typeof import("wouter")>()), useLocation: () => ["/estoque/posicoes", () => undefined] }));

import WarehousePositionsPage from "./warehouse-positions";

function posicao(rua: string, n: number) {
  return { code: `${rua}-0${n}`, aisle: rua, shelf: n, length_m: 1.8, depth_m: 0.75, height_m: 0.65, capacity_boxes: 3, status: "active", customer_code: "BTG", sequence: n, occupied_boxes: 0 };
}

function resposta(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
}

async function servir(entrada: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(String(entrada), "http://localhost");
  const metodo = (init?.method ?? "GET").toUpperCase();
  if (url.pathname === "/api/warehouse/positions" && metodo === "GET") {
    return estado.falhaNaLeitura ? resposta({ error: "Falha no servidor" }, 500) : resposta({ items: estado.posicoes });
  }
  if (url.pathname === "/api/customers") return resposta({ items: [{ id: "c1", code: "BTG", name: "BTG Pactual", status: "active", modules: ["armazenagem"] }] });
  if (metodo === "POST") {
    return new Promise<Response>((resolver) => estado.pendentes.push({ caminho: url.pathname, responder: (corpo, status = 200) => resolver(resposta(corpo, status)) }));
  }
  throw new Error(`API inesperada: ${metodo} ${url.pathname}`);
}

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;
let cliente: QueryClient;

async function esperar(condicao: () => boolean, oQue: string) {
  for (let volta = 0; volta < 200; volta += 1) {
    if (condicao()) return;
    await act(async () => {
      await new Promise((pronto) => setTimeout(pronto, 10));
    });
  }
  throw new Error(`Não aconteceu: ${oQue}`);
}

/** O botão pelo rótulo: o texto inteiro, o aria-label ou a camada de repouso do BotaoDeAcao. */
function botao(rotulo: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
    (item) =>
      item.textContent?.trim() === rotulo ||
      item.getAttribute("aria-label") === rotulo ||
      item.querySelector('[data-camada="repouso"]')?.textContent?.trim() === rotulo,
  );
}

const naTela = () => {
  const copia = container!.cloneNode(true) as HTMLElement;
  copia.querySelector("[data-anunciador]")?.remove();
  return (copia.textContent ?? "").replace(/\s+/g, " ");
};

async function montar() {
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  cliente = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => {
    raiz!.render(
      <ProvedorDaConexao value={conexaoEm("conectado")}>
        <main>
          <QueryClientProvider client={cliente}>
            <Anunciador />
            <WarehousePositionsPage />
          </QueryClientProvider>
        </main>
      </ProvedorDaConexao>,
    );
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(servir));
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  estado.pendentes.length = 0;
  estado.falhaNaLeitura = false;
  estado.posicoes = [posicao("A", 1), posicao("A", 2)];
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  container?.remove();
  container = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("Posições, a leitura", () => {
  it("a leitura que falha sem nada lido: o aviso com Tentar de novo, sem a tabela vazia nem o 0 de 0", async () => {
    estado.falhaNaLeitura = true;
    await montar();
    await esperar(() => naTela().includes("Não consegui carregar as posições."), "o aviso da falha");
    expect(container!.querySelector("table")).toBeNull();
    expect(naTela()).not.toMatch(/Nenhuma posição|0 de 0 posições|Carregar mapa inicial/);
    expect(botao("Tentar de novo")).toBeTruthy();
    expect(await violacoesDeAcessibilidade(container!.innerHTML)).toEqual([]);

    estado.falhaNaLeitura = false;
    await act(async () => botao("Tentar de novo")!.click());
    await esperar(() => Boolean(container!.querySelector("table")), "a tabela depois da nova tentativa");
    expect(naTela()).toContain("2 de 2 posições");
  });

  it("a linha de estado sob o título diz de quando é a lista; a releitura que falha não apaga a tabela", async () => {
    await montar();
    await esperar(() => Boolean(container!.querySelector("table")), "a tabela");
    const linha = container!.querySelector("[data-linha-de-estado]");
    await esperar(() => /^Atualizado às \d{2}:\d{2}$/.test(linha?.textContent ?? ""), "a hora da leitura na linha de estado");

    estado.falhaNaLeitura = true;
    await act(async () => {
      await cliente.invalidateQueries({ queryKey: ["warehouse-positions"] });
    });
    await esperar(() => /Não consegui atualizar/.test(linha?.textContent ?? ""), "a falha na linha de estado");
    expect(container!.querySelector("table")).not.toBeNull();
    expect(naTela()).toContain("A-02");
    expect(naTela()).not.toContain("Não foi possível carregar as posições");
  });
});

describe("Carregar mapa inicial", () => {
  it("ocupado sem disabled: o foco fica no botão, \"Carregando mapa inicial…\" aos 300 ms, e o cabeçalho espera com aria-disabled", async () => {
    estado.posicoes = [];
    await montar();
    await esperar(() => Boolean(botao("Carregar mapa inicial")), "o mapa inicial");
    const carregar = botao("Carregar mapa inicial")!;
    carregar.focus();
    await act(async () => carregar.click());
    expect(estado.pendentes.map((pendente) => pendente.caminho)).toEqual(["/api/warehouse/positions/seed"]);
    await act(async () => {
      await new Promise((pronto) => setTimeout(pronto, 350));
    });
    expect(carregar.hasAttribute("disabled")).toBe(false);
    expect(carregar.getAttribute("aria-disabled")).toBe("true");
    expect(carregar.getAttribute("aria-busy")).toBe("true");
    expect(carregar.querySelector("[data-atual]")?.textContent?.trim()).toBe("Carregando mapa inicial…");
    expect(document.activeElement).toBe(carregar);
    // O cadastro vazio não é alerta: a troca de rótulo do botão não faz o leitor de tela reler o quadro.
    expect(carregar.closest('[role="alert"]')).toBeNull();
    for (const rotulo of ["Nova rua", "Nova posição"]) {
      const doCabecalho = botao(rotulo)!;
      expect(doCabecalho.hasAttribute("disabled"), rotulo).toBe(false);
      expect(doCabecalho.getAttribute("aria-disabled"), rotulo).toBe("true");
    }
    // O segundo toque não chama de novo.
    await act(async () => carregar.click());
    expect(estado.pendentes).toHaveLength(1);
    expect(await violacoesDeAcessibilidade(container!.innerHTML)).toEqual([]);
    expect(
      textosForaDaLista(carregar.outerHTML, ["Carregar mapa inicial", "Carregando mapa inicial…", "Conferir"]),
    ).toEqual([]);

    estado.posicoes = [posicao("A", 1)];
    await act(async () => estado.pendentes[0]!.responder({ created: ["A-01"], updated: [] }));
    await esperar(() => Boolean(container!.querySelector("table")), "a tabela do mapa inicial");
    // O botão saiu da tela com o foco nele: o foco vai à linha de estado, nunca ao body.
    expect(document.activeElement).toBe(container!.querySelector("[data-linha-de-estado]"));
    // No celular, o alvo da ação tem 48 px (seção 7).
    expect(carregar.className).toContain("max-md:min-h-12");
  });
});
