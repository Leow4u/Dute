// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Anunciador } from "@/lib/carregando/anunciador";
import { ProvedorDaConexao } from "@/lib/carregando/estado-da-conexao";
import { conexaoEm } from "@/test/conexao";
import { textosForaDaLista } from "@/test/textos";

/**
 * A Contagem na revisão da parte 13b (carregamento v2; necessidades 2, 3 e 5
 * e seção 7). O painel do progresso não diz "Caixas 0" nem "Nenhuma caixa
 * nesta sessão." sem a sessão lida, e o cabeçalho não diz "sessão concluída"
 * sem ela. A sessão que falha abre na aba da abertura, onde está o aviso. Sem
 * rede, "Reconectando…", nunca o erro genérico. O foco nunca cai no body: a
 * nova tentativa que dá certo e a ação cujo botão sai levam o foco ao que
 * entrou no lugar. A alternativa do "Se preferir" é o BotaoDeAcao. A
 * releitura do catálogo depois de gravar não fala. Relógio simulado; dados
 * sintéticos.
 */

type Pendente = { caminho: string; corpo: Record<string, unknown>; responder: (corpo: unknown) => void };

const estado = vi.hoisted(() => ({
  sessao: {} as Record<string, unknown>,
  caixas: [] as Array<Record<string, unknown>>,
  atrasoPorCaminho: {} as Record<string, number>,
  falhaPorCaminho: {} as Record<string, boolean>,
  faltaPorCaminho: {} as Record<string, boolean>,
  pendentes: [] as Pendente[],
}));

vi.mock("@/lib/warehouse-ops/model", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/warehouse-ops/model")>();
  const { SemResposta } = await import("@/lib/conexao");
  const casa = (mapa: Record<string, unknown>, caminho: string) => Object.keys(mapa).find((prefixo) => mapa[prefixo] && caminho.startsWith(prefixo));
  return {
    ...original,
    fetchJson: async (url: string, init?: { method?: string; body?: string }) => {
      const { pathname } = new URL(url, "http://dute.local");
      if (init?.method === "POST" && !pathname.endsWith("/read")) {
        return new Promise((resolver) =>
          estado.pendentes.push({ caminho: pathname, corpo: JSON.parse(init.body ?? "{}") as Record<string, unknown>, responder: resolver }),
        );
      }
      const chave = casa(estado.atrasoPorCaminho, pathname);
      await new Promise((pronto) => setTimeout(pronto, chave ? estado.atrasoPorCaminho[chave] : 5));
      if (casa(estado.faltaPorCaminho, pathname)) throw new SemResposta();
      if (casa(estado.falhaPorCaminho, pathname)) throw new Error("Falha no servidor");
      if (pathname.startsWith("/api/warehouse/opening-inventory/session/")) return estado.sessao;
      if (pathname === "/api/skus" || pathname === "/api/products") return { items: [] };
      if (pathname === "/api/warehouse/boxes") return { items: estado.caixas, has_more: false };
      if (pathname === "/api/warehouse/positions") return { items: [], has_more: false };
      if (pathname.endsWith("/read")) {
        const codigo = decodeURIComponent(pathname.split("/").at(-2) ?? "");
        return { box: estado.caixas.find((caixa) => caixa.code === codigo) ?? estado.caixas.at(-1), lines: [] };
      }
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

import { CycleCountWorkspace, OpeningInventoryWorkspace } from "./inventory";

const SESSAO_ABERTA = { session_id: "abertura-1", customer_code: "BTG Pactual", status: "open", lines: [], line_count: 0, unit_count: 0, total_cost: 0 };
const CAIXA_GUARDADA = { code: "CX-000010", customer_code: "BTG Pactual", status: "stored", location_id: "A-01", origin: { session_id: "abertura-1" }, line_count: 0, length_m: 0.6, width_m: 0.4, height_m: 0.4 };

let raiz: Root | null = null;
let container: HTMLDivElement;
let cliente: QueryClient;

async function passar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function esperar(condicao: () => boolean, oQue: string) {
  for (let volta = 0; volta < 400; volta += 1) {
    if (condicao()) return;
    await passar(10);
  }
  throw new Error(`Não aconteceu: ${oQue}`);
}

const naTela = () => {
  const copia = document.body.cloneNode(true) as HTMLElement;
  copia.querySelector("[data-anunciador]")?.remove();
  return (copia.textContent ?? "").replace(/\s+/g, " ");
};
const botao = (rotulo: string, dentro: ParentNode = document) =>
  Array.from(dentro.querySelectorAll<HTMLButtonElement>("button")).find(
    (item) => item.textContent?.trim() === rotulo || item.querySelector('[data-camada="repouso"]')?.textContent?.trim() === rotulo,
  );
/** O painel do progresso, pelo título. */
const painel = () => Array.from(document.querySelectorAll<HTMLElement>("div")).find((no) => no.firstElementChild?.textContent === "Progresso da abertura")?.parentElement ?? null;
const numeroDe = (rotulo: string) => {
  const titulo = Array.from(painel()?.querySelectorAll<HTMLElement>(".text-xs") ?? []).find((no) => no.textContent === rotulo);
  return titulo?.nextElementSibling?.textContent ?? null;
};
const preencher = async (seletor: string, valor: string) => {
  const campo = document.querySelector<HTMLInputElement>(seletor)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse("2026-11-13T13:42:00Z"));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  estado.sessao = SESSAO_ABERTA;
  estado.caixas = [];
  estado.atrasoPorCaminho = {};
  estado.falhaPorCaminho = {};
  estado.faltaPorCaminho = {};
  estado.pendentes.length = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  cliente = new QueryClient({ defaultOptions: { queries: { retry: false, networkMode: "always" }, mutations: { retry: false } } });
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

async function montar(tela: ReactNode, conexao: "conectado" | "reconectando" = "conectado") {
  raiz = createRoot(container);
  await act(async () => {
    raiz!.render(
      <ProvedorDaConexao value={conexaoEm(conexao)}>
        <QueryClientProvider client={cliente}>
          <Anunciador />
          {tela}
        </QueryClientProvider>
      </ProvedorDaConexao>,
    );
  });
}

describe("o progresso da abertura sem a sessão lida", () => {
  it("as caixas lidas e a sessão chegando: nunca \"Caixas 0\" nem \"Nenhuma caixa nesta sessão.\"", async () => {
    estado.caixas = [CAIXA_GUARDADA];
    estado.atrasoPorCaminho = { "/api/warehouse/opening-inventory/session/": 3_000 };
    await montar(<OpeningInventoryWorkspace />);
    for (const instante of [200, 1_000, 2_500]) {
      await passar(instante === 200 ? 200 : instante === 1_000 ? 800 : 1_500);
      expect(numeroDe("Caixas"), `aos ${instante} ms`).not.toBe("0");
      expect(naTela(), `aos ${instante} ms`).not.toContain("Nenhuma caixa nesta sessão.");
    }
    await passar(600);
    expect(numeroDe("Caixas")).toBe("1");
    expect(naTela()).toContain("CX-000010");
  });

  it("a sessão que falha: o painel não afirma caixas, e o cabeçalho não diz \"sessão concluída\"", async () => {
    estado.caixas = [CAIXA_GUARDADA];
    estado.falhaPorCaminho = { "/api/warehouse/opening-inventory/session/": true };
    await montar(<OpeningInventoryWorkspace />);
    await passar(300);
    expect(naTela()).toContain("Não consegui carregar o inventário.");
    expect(numeroDe("Caixas")).toBe("—");
    expect(naTela()).not.toContain("Nenhuma caixa nesta sessão.");
    expect(naTela()).not.toMatch(/sessão concluída|sessão em andamento/);
  });

  it("na Contagem, a sessão que falha abre na aba da abertura, com o aviso, e não esconde a falha atrás da cíclica", async () => {
    estado.falhaPorCaminho = { "/api/warehouse/opening-inventory/session/": true };
    await montar(<CycleCountWorkspace />);
    await passar(300);
    expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain("Inventário de abertura");
    expect(naTela()).toContain("Não consegui carregar o inventário.");
    // A nova tentativa não volta a "Carregando a contagem…": o aviso fica com o foco nele.
    estado.falhaPorCaminho = {};
    estado.atrasoPorCaminho = { "/api/warehouse/opening-inventory/session/": 700 };
    const tentar = botao("Tentar de novo")!;
    tentar.focus();
    await act(async () => tentar.click());
    await passar(400);
    expect(naTela()).toContain("Não consegui carregar o inventário.");
    expect(document.activeElement?.textContent?.trim()).toBe("Tentando de novo…");
    await passar(500);
    // Lida a sessão, o foco vai ao título do cartão, nunca ao body.
    expect(document.activeElement?.id).toBe("abertura-titulo");
  });
});

describe("as caixas da sessão que falham", () => {
  it("sem rede: \"Reconectando…\" no lugar da lista, nunca o erro genérico", async () => {
    estado.faltaPorCaminho = { "/api/warehouse/boxes": true };
    await montar(<OpeningInventoryWorkspace />, "reconectando");
    await passar(300);
    expect(naTela()).toContain("Reconectando…");
    expect(naTela()).not.toContain("Não consegui carregar as caixas.");
  });

  it("a nova tentativa que dá certo leva o foco ao título das caixas da sessão", async () => {
    estado.caixas = [CAIXA_GUARDADA];
    estado.falhaPorCaminho = { "/api/warehouse/boxes": true };
    await montar(<OpeningInventoryWorkspace />);
    await passar(300);
    expect(naTela()).toContain("Não consegui carregar as caixas.");
    estado.falhaPorCaminho = {};
    const tentar = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.textContent?.trim() === "Tentar de novo")!;
    tentar.focus();
    await act(async () => tentar.click());
    await passar(300);
    expect(naTela()).toContain("CX-000010");
    expect(document.activeElement?.id).toBe("abertura-caixas-da-sessao");
  });
});

describe("a ação cujo botão sai da tela", () => {
  it("\"Iniciar conferência da caixa\" vira a bancada: o foco vai ao título da caixa, nunca ao body", async () => {
    await montar(<OpeningInventoryWorkspace />);
    await esperar(() => Boolean(botao("Iniciar conferência da caixa")), "a sessão aberta");
    const iniciar = botao("Iniciar conferência da caixa")!;
    iniciar.focus();
    await act(async () => iniciar.click());
    const caixa = { code: "CX-000011", customer_code: "BTG Pactual", status: "counting", origin: { session_id: "abertura-1" }, line_count: 0 };
    estado.caixas = [caixa];
    await act(async () => estado.pendentes[0]!.responder({ box: caixa, lines: [] }));
    await passar(600);
    expect(naTela()).toContain("Caixa de destino CX-000011");
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.id).toBe("abertura-caixa-aberta");
  });

  it("\"Iniciar contagem\" vira o selo: o foco vai ao título do cartão", async () => {
    estado.sessao = { ...SESSAO_ABERTA, status: "not_started" };
    await montar(<OpeningInventoryWorkspace />);
    await esperar(() => Boolean(botao("Iniciar contagem")), "a sessão por começar");
    const iniciar = botao("Iniciar contagem")!;
    iniciar.focus();
    await act(async () => iniciar.click());
    estado.sessao = SESSAO_ABERTA;
    await act(async () => estado.pendentes[0]!.responder(SESSAO_ABERTA));
    await esperar(() => naTela().includes("sessão em andamento"), "a sessão aberta");
    expect(document.activeElement?.id).toBe("abertura-titulo");
  });
});

/** Abre a bancada de uma caixa em conferência: o formulário do produto, com o catálogo. */
async function abrirABancada() {
  await montar(<OpeningInventoryWorkspace />);
  await esperar(() => Boolean(botao("Iniciar conferência da caixa")), "a sessão aberta");
  await act(async () => botao("Iniciar conferência da caixa")!.click());
  const caixa = { code: "CX-000011", customer_code: "BTG Pactual", status: "counting", origin: { session_id: "abertura-1" }, line_count: 0 };
  estado.caixas = [caixa];
  await act(async () => estado.pendentes[0]!.responder({ box: caixa, lines: [] }));
  await esperar(() => Boolean(document.querySelector("#opening-client-code")), "o formulário do produto");
}

describe("o catálogo da abertura", () => {
  it("o catálogo que falha: o aviso da falha, sem botão de camadas dentro do alerta", async () => {
    estado.falhaPorCaminho = { "/api/skus": true };
    await abrirABancada();
    await passar(100);
    const aviso = Array.from(document.querySelectorAll<HTMLElement>('[role="alert"]')).find((no) => no.textContent?.includes("catálogo"))!;
    expect(textosForaDaLista(aviso.outerHTML, ["Não consegui carregar o catálogo. O cadastro de produto novo foi bloqueado para evitar duplicidade.", "Tentar de novo"])).toEqual([]);
    expect(aviso.querySelector("[data-camada]")).toBeNull();
  });

  it("a releitura do catálogo depois de gravar não mostra a espera nem fala", async () => {
    await abrirABancada();
    await passar(500);
    const anunciado = () => document.querySelector("[data-anunciador]")?.textContent ?? "";
    expect(anunciado()).not.toContain("Verificando o catálogo");
    estado.atrasoPorCaminho = { "/api/skus": 1_500 };
    await act(async () => {
      void cliente.invalidateQueries({ queryKey: ["opening-inventory-product-lookup"] });
    });
    for (const instante of [100, 400, 1_000, 1_400]) {
      await passar(instante === 100 ? 100 : instante === 400 ? 300 : instante === 1_000 ? 600 : 400);
      expect(naTela(), `aos ${instante} ms`).not.toContain("Verificando o catálogo…");
      expect(anunciado(), `aos ${instante} ms`).not.toContain("Verificando o catálogo");
    }
  });
});

describe("os textos dos estados novos da abertura (a trava contra legenda)", () => {
  it("a falha das caixas e da sessão, e as ações da caixa aberta, só com os textos da lista", async () => {
    estado.falhaPorCaminho = { "/api/warehouse/boxes": true };
    await montar(<OpeningInventoryWorkspace />);
    await passar(300);
    const avisoDasCaixas = Array.from(document.querySelectorAll<HTMLElement>('[role="alert"]')).find((no) => no.textContent?.includes("caixas"))!;
    expect(textosForaDaLista(avisoDasCaixas.outerHTML, ["Não consegui carregar as caixas.", "Tentar de novo"])).toEqual([]);
    act(() => raiz?.unmount());
    raiz = null;
    cliente.clear();

    // A caixa fechada aberta de novo e a guarda em andamento: os rótulos e os gerúndios da lista.
    estado.falhaPorCaminho = {};
    const fechada = { ...CAIXA_GUARDADA, opening_closed: true };
    const guardando = { ...CAIXA_GUARDADA, code: "CX-000012", status: "committing", location_id: "A-02" };
    estado.caixas = [fechada, guardando];
    await montar(<OpeningInventoryWorkspace />);
    await esperar(() => naTela().includes("CX-000012"), "as caixas da sessão");
    const abrir = (codigo: string) =>
      Array.from(document.querySelectorAll<HTMLElement>("div")).find((no) => no.firstElementChild?.firstElementChild?.textContent?.startsWith(codigo))?.querySelector<HTMLButtonElement>("button");
    await act(async () => abrir("CX-000010")!.click());
    await esperar(() => Boolean(botao("Reabrir para ajustar")), "a caixa fechada");
    expect(textosForaDaLista(botao("Reabrir para ajustar")!.outerHTML, ["Reabrir para ajustar", "Reabrindo…", "Conferir"])).toEqual([]);
    act(() => raiz?.unmount());
    raiz = null;
    cliente.clear();
    await montar(<OpeningInventoryWorkspace />);
    await esperar(() => naTela().includes("CX-000012"), "as caixas da sessão de novo");
    await act(async () => abrir("CX-000012")!.click());
    await esperar(() => Boolean(botao("Voltar à conferência")), "a guarda em andamento");
    expect(textosForaDaLista(botao("Voltar à conferência")!.outerHTML, ["Voltar à conferência", "Voltando…", "Conferir"])).toEqual([]);
  });
});

describe("o painel da guarda que sai", () => {
  it("\"Voltar à nova conferência\" tira o painel: o foco vai ao título da nova caixa, nunca ao body", async () => {
    await montar(<OpeningInventoryWorkspace />);
    await esperar(() => Boolean(botao("Cadastrar caixa já armazenada")), "a sessão aberta");
    await act(async () => botao("Cadastrar caixa já armazenada")!.click());
    const voltar = botao("Voltar à nova conferência")!;
    voltar.focus();
    await act(async () => voltar.click());
    expect(naTela()).toContain("Nova caixa de destino");
    expect(document.activeElement?.id).toBe("abertura-nova-caixa");
  });
});

describe("a alternativa do \"Se preferir\"", () => {
  it("é o BotaoDeAcao: a tocada fica cheia e só aos 300 ms diz \"Guardando em A-04…\"; as outras esperam a 0,45", async () => {
    await montar(<OpeningInventoryWorkspace />);
    await esperar(() => Boolean(botao("Cadastrar caixa já armazenada")), "a sessão aberta");
    await act(async () => botao("Cadastrar caixa já armazenada")!.click());
    await preencher("#box-length", "50");
    await preencher("#box-width", "40");
    await preencher("#box-height", "35");
    await act(async () => botao("Onde guardar?")!.click());
    const candidato = (code: string, sequence: number) => ({ code, reason: "Cabe na prateleira", tier: 1, leftover_m: 0.4, sequence, placement: { front_m: 0.5, depth_m: 0.4, orientation: "standard" } });
    const sugestao = estado.pendentes.find((pendente) => pendente.caminho === "/api/warehouse/boxes/suggest")!;
    await act(async () => sugestao.responder({ ok: true, customer_code: "BTG Pactual", position: candidato("A-03", 3), alternatives: [candidato("A-04", 4), candidato("A-05", 5)], rejected: null, checked: 9 }));
    await passar(50);
    const a04 = botao("Guardar em A-04")!;
    expect(a04).toBeTruthy();
    a04.focus();
    await act(async () => a04.click());
    expect(estado.pendentes.filter((pendente) => pendente.caminho === "/api/warehouse/boxes")).toHaveLength(1);
    // Antes de 300 ms, nada muda no rótulo.
    await passar(100);
    expect(a04.querySelector("[data-atual]")?.textContent?.trim()).toBe("Guardar em A-04");
    await passar(250);
    expect(a04.querySelector("[data-atual]")?.textContent?.trim()).toBe("Guardando em A-04…");
    expect(a04.getAttribute("aria-busy")).toBe("true");
    expect(a04.hasAttribute("disabled")).toBe(false);
    // A tocada fica cheia; as outras esperam a 0,45, aria-disabled.
    expect(a04.className).not.toContain("opacity-45");
    const a05 = botao("Guardar em A-05")!;
    expect(a05.getAttribute("aria-disabled")).toBe("true");
    expect(a05.className).toContain("opacity-45");
    expect(document.activeElement).toBe(a04);
    // O toque repetido não grava de novo.
    await act(async () => a04.click());
    expect(estado.pendentes.filter((pendente) => pendente.caminho === "/api/warehouse/boxes")).toHaveLength(1);
    // A confirmação diz a posição no gerúndio, como a alternativa.
    const confirmar = botao("Confirmar guarda em A-03")!;
    expect(textosForaDaLista(confirmar.outerHTML, ["Confirmar guarda em A-03", "Guardando em A-03…", "Conferir"])).toEqual([]);
    expect(textosForaDaLista(a04.outerHTML, ["Guardar em A-04", "Guardando em A-04…", "Conferir"])).toEqual([]);
    // A guarda deu certo e o painel saiu com o foco nele: o foco vai ao título da caixa guardada, nunca ao body.
    const guardada = { ...CAIXA_GUARDADA, code: "CX-000013", location_id: "A-04" };
    estado.caixas = [guardada];
    await act(async () => estado.pendentes.find((pendente) => pendente.caminho === "/api/warehouse/boxes")!.responder({ ok: true, box: guardada }));
    await passar(800);
    expect(document.activeElement?.id).toBe("abertura-caixa-aberta");
  });
});
