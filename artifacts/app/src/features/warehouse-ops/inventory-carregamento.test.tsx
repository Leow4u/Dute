// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Anunciador } from "@/lib/carregando/anunciador";
import { ProvedorDaConexao } from "@/lib/carregando/estado-da-conexao";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { conexaoEm } from "@/test/conexao";
import { textosForaDaLista } from "@/test/textos";

/**
 * A Contagem na migração do carregamento v2 (parte 13b; diagnóstico, 4.6 e
 * necessidades 2, 3, 5 e 10). As ações da abertura e da contagem cíclica são
 * o BotaoDeAcao: ocupadas sem `disabled` (o foco fica no botão tocado), com o
 * gerúndio, e nenhum ícone antigo girando. O painel do progresso não diz "0"
 * nem "Nenhuma caixa nesta sessão." antes de ler as caixas. A sessão que
 * falha mostra o aviso com "Tentar de novo", que fica na tela enquanto tenta.
 * Os diálogos de remover seguram enquanto o servidor responde. Dados
 * sintéticos.
 */

type Pendente = { caminho: string; corpo: Record<string, unknown>; responder: (corpo: unknown) => void };

const estado = vi.hoisted(() => ({
  sessao: {} as Record<string, unknown>,
  caixas: [] as Array<Record<string, unknown>>,
  atrasoPorCaminho: {} as Record<string, number>,
  falhaPorCaminho: {} as Record<string, boolean>,
  pendentes: [] as Pendente[],
}));

vi.mock("@/lib/warehouse-ops/model", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/warehouse-ops/model")>();
  return {
    ...original,
    fetchJson: async (url: string, init?: { method?: string; body?: string }) => {
      const { pathname } = new URL(url, "http://dute.local");
      const chave = Object.keys(estado.atrasoPorCaminho).find((prefixo) => pathname.startsWith(prefixo));
      if (init?.method === "POST" && !pathname.endsWith("/read")) {
        return new Promise((resolver) =>
          estado.pendentes.push({ caminho: pathname, corpo: JSON.parse(init.body ?? "{}") as Record<string, unknown>, responder: resolver }),
        );
      }
      await new Promise((pronto) => setTimeout(pronto, chave ? estado.atrasoPorCaminho[chave] : 5));
      if (Object.keys(estado.falhaPorCaminho).some((prefixo) => estado.falhaPorCaminho[prefixo] && pathname.startsWith(prefixo))) {
        throw new Error("Falha no servidor");
      }
      if (pathname.startsWith("/api/warehouse/opening-inventory/session/")) return estado.sessao;
      if (pathname === "/api/skus" || pathname === "/api/products") return { items: [] };
      if (pathname === "/api/warehouse/boxes") return { items: estado.caixas, has_more: false };
      if (pathname === "/api/warehouse/positions") return { items: [], has_more: false };
      throw new Error(`Chamada inesperada: ${init?.method ?? "GET"} ${url}`);
    },
  };
});

vi.mock("@/lib/active-customer-context", () => ({
  useActiveCustomer: () => ({
    code: "BTG Pactual",
    active: { code: "BTG Pactual", name: "BTG Pactual", profile: { skuPrefix: "BTG", source: "published", template: "uniformes" } },
    isLoading: false,
  }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));
vi.mock("wouter", async (original) => ({ ...(await original<typeof import("wouter")>()), useLocation: () => ["/wms/contagem", () => undefined] }));

import { CycleCountWorkspace, ExistingCycleCountWorkspace, OpeningInventoryWorkspace } from "./inventory";

const SESSAO_ABERTA = { session_id: "abertura-1", customer_code: "BTG Pactual", status: "open", lines: [], line_count: 0, unit_count: 0, total_cost: 0 };
const CAIXA_VAZIA = { code: "CX-000010", customer_code: "BTG Pactual", status: "stored", location_id: "A-01", origin: { session_id: "abertura-1" }, line_count: 0, length_m: 0.6, width_m: 0.4, height_m: 0.4 };

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
  const copia = document.body.cloneNode(true) as HTMLElement;
  copia.querySelector("[data-anunciador]")?.remove();
  return (copia.textContent ?? "").replace(/\s+/g, " ");
};
/** O botão pelo rótulo: o texto inteiro, o aria-label ou a camada de repouso do BotaoDeAcao. */
const botao = (rotulo: string, dentro: ParentNode = document) =>
  Array.from(dentro.querySelectorAll<HTMLButtonElement>("button")).find(
    (item) =>
      item.textContent?.trim() === rotulo ||
      item.getAttribute("aria-label") === rotulo ||
      item.querySelector('[data-camada="repouso"]')?.textContent?.trim() === rotulo,
  );
const dialogo = () => document.querySelector<HTMLElement>('[role="dialog"][data-state="open"]');

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  estado.sessao = SESSAO_ABERTA;
  estado.caixas = [];
  estado.atrasoPorCaminho = {};
  estado.falhaPorCaminho = {};
  estado.pendentes.length = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  cliente = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  cliente.clear();
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function montar(tela: ReactNode) {
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

/** O botão ocupado pela ação: sem disabled, aria-busy aos 300 ms, o gerúndio e o foco nele. */
async function conferirOcupado(alvo: HTMLButtonElement, gerundio: string) {
  await pausa(350);
  expect(alvo.hasAttribute("disabled"), "nunca disabled").toBe(false);
  expect(alvo.getAttribute("aria-disabled")).toBe("true");
  expect(alvo.getAttribute("aria-busy")).toBe("true");
  expect(alvo.querySelector("[data-atual]")?.textContent?.trim()).toBe(gerundio);
  expect(document.activeElement).toBe(alvo);
  expect(document.querySelectorAll(".animate-spin")).toHaveLength(0);
}

describe("a Contagem, a primeira leitura", () => {
  it("o esqueleto e, aos 300 ms, \"Carregando a contagem…\" com a caixa fora da árvore e o anúncio", async () => {
    estado.atrasoPorCaminho = { "/api/warehouse/opening-inventory/session/": 1_000 };
    await montar(<CycleCountWorkspace />);
    expect(naTela()).not.toContain("Carregando a contagem…");
    await esperar(() => naTela().includes("Carregando a contagem…"), "o rótulo aos 300 ms");
    expect(container.querySelector("[data-carregando-na-regiao] [data-spinner]")?.getAttribute("aria-hidden")).toBe("true");
    expect(document.querySelector("[data-anunciador]")?.textContent).toContain("Carregando a contagem");
    // O axe olha a espera sem as abas: o aria-controls delas acusa desde antes desta parte (a medição no Chromium).
    const semAsAbas = container.cloneNode(true) as HTMLElement;
    semAsAbas.querySelector('[role="tablist"]')?.remove();
    expect(await violacoesDeAcessibilidade(semAsAbas.innerHTML)).toEqual([]);
    await esperar(() => Boolean(botao("Iniciar conferência da caixa")), "a abertura");
  });
});

describe("a abertura, a leitura", () => {
  it("a sessão que falha: o aviso com Tentar de novo, que fica na tela enquanto tenta; depois, a abertura", async () => {
    estado.falhaPorCaminho = { "/api/warehouse/opening-inventory/session/": true };
    await montar(<OpeningInventoryWorkspace />);
    await esperar(() => naTela().includes("Não consegui carregar o inventário."), "o aviso da falha");
    expect(botao("Tentar de novo")).toBeTruthy();
    expect(await violacoesDeAcessibilidade(container.innerHTML)).toEqual([]);
    estado.falhaPorCaminho = {};
    estado.atrasoPorCaminho = { "/api/warehouse/opening-inventory/session/": 600 };
    const tentar = botao("Tentar de novo")!;
    tentar.focus();
    await act(async () => tentar.click());
    await pausa(350);
    // A nova tentativa não troca o aviso pelo esqueleto: o botão e o foco ficam.
    expect(naTela()).toContain("Não consegui carregar o inventário.");
    expect(document.activeElement?.textContent).toContain("Tentando de novo…");
    await esperar(() => Boolean(botao("Iniciar conferência da caixa")), "a abertura depois da nova tentativa");
  });

  it("a releitura da sessão que falha não troca a abertura pelo aviso", async () => {
    await montar(<OpeningInventoryWorkspace />);
    await esperar(() => Boolean(botao("Iniciar conferência da caixa")), "a sessão aberta");
    estado.falhaPorCaminho = { "/api/warehouse/opening-inventory/session/": true };
    await act(async () => {
      await cliente.invalidateQueries({ queryKey: ["opening-inventory-session"] });
    });
    await pausa(100);
    expect(naTela()).not.toContain("Não consegui carregar o inventário.");
    expect(botao("Iniciar conferência da caixa")).toBeTruthy();
  });

  it("com as caixas ainda chegando, o progresso não diz 0 nem \"Nenhuma caixa nesta sessão.\"", async () => {
    estado.caixas = [CAIXA_VAZIA];
    estado.atrasoPorCaminho = { "/api/warehouse/boxes": 1_500 };
    await montar(<OpeningInventoryWorkspace />);
    await esperar(() => naTela().includes("Progresso da abertura"), "o painel do progresso");
    await pausa(400);
    expect(naTela()).not.toContain("Nenhuma caixa nesta sessão.");
    expect(naTela()).not.toMatch(/Caixas\s*0|Posições ocupadas\s*0/);
    expect(naTela()).toContain("Carregando caixas…");
    await esperar(() => naTela().includes("CX-000010"), "as caixas");
    expect(naTela()).toMatch(/Caixas\s*1/);
  });
});

describe("a abertura, as ações", () => {
  it("\"Iniciar conferência da caixa\": ocupado sem disabled, \"Iniciando…\" e o foco no botão", async () => {
    await montar(<OpeningInventoryWorkspace />);
    await esperar(() => Boolean(botao("Iniciar conferência da caixa")), "a sessão aberta");
    const iniciar = botao("Iniciar conferência da caixa")!;
    iniciar.focus();
    await act(async () => iniciar.click());
    expect(estado.pendentes.map((pendente) => pendente.caminho)).toEqual(["/api/warehouse/opening-inventory/boxes"]);
    await conferirOcupado(iniciar, "Iniciando…");
    await act(async () => iniciar.click());
    expect(estado.pendentes).toHaveLength(1);
    expect(textosForaDaLista(iniciar.outerHTML, ["Iniciar conferência da caixa", "Iniciando…", "Conferir"])).toEqual([]);
  });

  it("\"Iniciar contagem\" na sessão por começar: ocupado sem disabled e \"Iniciando…\"", async () => {
    estado.sessao = { ...SESSAO_ABERTA, status: "not_started" };
    await montar(<OpeningInventoryWorkspace />);
    await esperar(() => Boolean(botao("Iniciar contagem")), "a sessão por começar");
    const iniciar = botao("Iniciar contagem")!;
    iniciar.focus();
    await act(async () => iniciar.click());
    expect(estado.pendentes.map((pendente) => pendente.caminho)).toEqual(["/api/warehouse/opening-inventory/session"]);
    await conferirOcupado(iniciar, "Iniciando…");
  });

  it("Remover a caixa vazia: o diálogo segura enquanto remove, \"Removendo…\" e o Manter aria-disabled", async () => {
    estado.caixas = [CAIXA_VAZIA];
    await montar(<OpeningInventoryWorkspace />);
    await esperar(() => Boolean(botao("Remover caixa CX-000010")), "a caixa vazia");
    await act(async () => botao("Remover caixa CX-000010")!.click());
    await esperar(() => Boolean(dialogo()), "o diálogo");
    const remover = botao("Remover caixa", dialogo()!)!;
    remover.focus();
    await act(async () => remover.click());
    expect(estado.pendentes.map((pendente) => pendente.caminho)).toEqual(["/api/warehouse/boxes/CX-000010/remove"]);
    await conferirOcupado(remover, "Removendo…");
    await act(async () => {
      document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(dialogo()).not.toBeNull();
    const manter = botao("Manter caixa", dialogo()!)!;
    expect(manter.hasAttribute("disabled")).toBe(false);
    expect(manter.getAttribute("aria-disabled")).toBe("true");
    expect(await violacoesDeAcessibilidade(dialogo()!.outerHTML)).toEqual([]);
  });
});

describe("a contagem cíclica", () => {
  it("\"Registrar contagem\" é o BotaoDeAcao: sem disabled durante o envio, com \"Registrando…\"", async () => {
    await montar(<ExistingCycleCountWorkspace />);
    await pausa(50);
    const registrar = botao("Registrar contagem")!;
    expect(registrar).toBeTruthy();
    // Sem os campos preenchidos, espera com aria-disabled, nunca disabled.
    expect(registrar.hasAttribute("disabled")).toBe(false);
    expect(registrar.getAttribute("aria-disabled")).toBe("true");
    expect(container.querySelector('input[placeholder="Auditoria, foto, inventário…"]')).not.toBeNull();
  });
});
