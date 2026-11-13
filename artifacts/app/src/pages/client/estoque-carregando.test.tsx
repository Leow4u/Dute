// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

import { Anunciador } from "@/lib/carregando/anunciador";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela, textosForaDaLista } from "@/test/textos";

/**
 * O Estoque do portal no carregamento v2 (parte 13f). Antes:
 * - "Avisar reposição" e "Arquivar" no card não tinham espera nenhuma, e no
 *   detalhe só apagavam, os dois juntos, sem dizer o quê (o `isPending`
 *   compartilhado); agora cada produto tem a própria ação (`useAcaoNaLinha`),
 *   com o gerúndio no botão, e os outros ficam livres;
 * - "Salvar evento" só trocava o texto e ficava `disabled`, e o Cancelar do
 *   formulário seguia ativo;
 * - com `?evento=`, nada aparecia enquanto o evento era lido;
 * - as datas de entrada sumiam lendo e na falha;
 * - a contagem do resultado era uma região viva solta (`aria-live`), e a
 *   confirmação do "adicionado", outra: quem fala é o Anunciador.
 * Dados sintéticos.
 */

const estado = vi.hoisted(() => ({
  envios: 0,
  eventosPresos: false,
  avisoGrava: false,
  leiturasDoPortal: 0,
  arquivados: new Set<string>(),
  comPolo: false,
  datasEm: 0,
}));

vi.mock("@/lib/auth", () => ({
  useAppUser: () => ({ user: { uid: "uid-ana", publicMetadata: { role: "cliente", customer_code: "ACME" } }, isLoaded: true }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));

import { CartPanel, ClienteEstoque, MarketplaceToolbar, ProductDetailPanel, groupInventoryProducts, podeTerDatas } from "./estoque";

const AZUL = { id: "inv_azul", sku_code: "ACME-000001", client_item_code: "TOA-AZUL", product_name: "Toalha Azul", category: "Toalha", qty_on_hand: 0, qty_available: 0 };
const VERDE = { id: "inv_verde", sku_code: "ACME-000002", client_item_code: "TOA-VERDE", product_name: "Toalha Verde", category: "Toalha", qty_on_hand: 0, qty_available: 0 };
const POLO = { sku_code: "ACME-000003", client_item_code: "POLO-M", product_name: "Polo Azul", category: "Polo", qty_on_hand: 12, qty_available: 12 };
const VISAO = { customer: { code: "ACME", name: "ACME" }, inventory: { items: [AZUL, VERDE] } };

const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
const presa = () => new Promise<Response>(() => undefined);

let raiz: Root | null = null;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  estado.envios = 0;
  estado.eventosPresos = false;
  estado.avisoGrava = false;
  estado.leiturasDoPortal = 0;
  estado.arquivados = new Set();
  estado.comPolo = false;
  estado.datasEm = 0;
  window.localStorage.clear();
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(entrada), window.location.origin);
      if (url.pathname === "/api/client/overview") {
        estado.leiturasDoPortal += 1;
        const itens = [AZUL, VERDE, ...(estado.comPolo ? [POLO] : [])].map((item) =>
          "id" in item && estado.arquivados.has(String(item.id)) ? { ...item, client_archived: true } : item,
        );
        return json({ ...VISAO, inventory: { items: itens } });
      }
      if (url.pathname === "/api/client/events") return estado.eventosPresos ? presa() : json({ events: [] });
      if (url.pathname === "/api/client/requests" && init?.method === "POST") {
        estado.envios += 1;
        return estado.avisoGrava ? json({ id: `creq_${estado.envios}` }) : presa();
      }
      if (url.pathname.startsWith("/api/client/inventory/dates/")) {
        await new Promise((pronto) => setTimeout(pronto, estado.datasEm));
        return json({ datas: url.pathname.endsWith(POLO.sku_code) ? [{ desde: "2026-10-20", pecas: 12 }] : [] });
      }
      const arquivo = /^\/api\/client\/inventory\/([^/]+)\/archive$/.exec(url.pathname);
      if (arquivo && init?.method === "POST") {
        estado.arquivados.add(decodeURIComponent(arquivo[1]!));
        return json({ ok: true });
      }
      return json({});
    }),
  );
  container = document.createElement("div");
  document.body.append(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  container.remove();
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/");
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

const espera = (ms: number) => act(async () => new Promise((pronto) => setTimeout(pronto, ms)));

async function ate(condicao: () => unknown, limiteMs = 3_000) {
  const fim = Date.now() + limiteMs;
  while (!condicao()) {
    if (Date.now() > fim) throw new Error("A tela não chegou ao estado esperado em 3 s.");
    await espera(20);
  }
}

async function montar(tela: ReactNode) {
  await act(async () =>
    raiz!.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
        {/* Antes da tela, como no App: a região já está na página quando a tela fala. */}
        <Anunciador />
        <Router>{tela}</Router>
      </QueryClientProvider>,
    ),
  );
}

/** O botão pelo rótulo; o botão de ação, pela camada que está na tela. */
function botao(rotulo: string, dentro: ParentNode = container) {
  return [...dentro.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent?.trim() === rotulo || item.querySelector(".botao-acao-camada[data-atual]")?.textContent?.trim() === rotulo,
  );
}

const card = (nome: string) => [...container.querySelectorAll<HTMLElement>('[data-testid="stock-card"]')].find((item) => item.textContent?.includes(nome))!;
const anunciado = () => container.querySelector("[data-anunciador]")?.textContent ?? "";

describe("a ação no produto zerado", () => {
  it("Avisar reposição diz 'Avisando…' só no produto tocado; o Arquivar dele trava, e o outro produto fica livre", async () => {
    await montar(<ClienteEstoque />);
    await ate(() => card("Toalha Azul") && card("Toalha Verde"));
    const avisar = botao("Avisar reposição", card("Toalha Azul"))!;
    avisar.focus();
    await act(async () => avisar.click());
    expect(estado.envios).toBe(1);
    await ate(() => botao("Avisando…", card("Toalha Azul")));
    const andando = botao("Avisando…", card("Toalha Azul"))!;
    expect(andando.hasAttribute("disabled")).toBe(false);
    expect(andando.getAttribute("aria-busy")).toBe("true");
    expect(document.activeElement).toBe(andando);
    const arquivar = botao("Arquivar", card("Toalha Azul"))!;
    expect(arquivar.getAttribute("aria-disabled")).toBe("true");
    expect(arquivar.hasAttribute("disabled")).toBe(false);
    // O outro produto segue livre.
    const outro = botao("Avisar reposição", card("Toalha Verde"))!;
    expect(outro.hasAttribute("aria-disabled")).toBe(false);
    expect(outro.hasAttribute("disabled")).toBe(false);
    await act(async () => outro.click());
    expect(estado.envios).toBe(2);
    await ate(() => botao("Avisando…", card("Toalha Verde")));
    expect(container.querySelector(".animate-spin, .animate-pulse")).toBeNull();
    expect(await violacoesDeAcessibilidade(card("Toalha Azul").outerHTML)).toEqual([]);
  });
});

describe("o evento no pedido", () => {
  it("com ?evento=, aos 300 ms, 'Abrindo o evento…' enquanto ele é lido", async () => {
    estado.eventosPresos = true;
    window.history.replaceState(null, "", "/portal/estoque?evento=ev_1");
    await montar(<ClienteEstoque />);
    await ate(() => container.textContent?.includes("Abrindo o evento…"));
    expect(container.querySelector("[data-carregando-na-regiao] [data-spinner]")?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("Salvar como evento", () => {
  function painel(isSavingEvent: boolean) {
    const produto = groupInventoryProducts([POLO])[0]!;
    const props: ComponentProps<typeof CartPanel> = {
      cartKey: "",
      seed: 0,
      lines: [{ product: produto, quantity: 2 }],
      isSubmitting: false,
      isSavingEvent,
      expanded: false,
      onToggleExpanded: () => undefined,
      onClose: () => undefined,
      onSaveEvent: () => undefined,
      onIncrement: () => undefined,
      onDecrement: () => undefined,
      onQuantityChange: () => undefined,
      onRemove: () => undefined,
      onSubmit: () => undefined,
    };
    return <CartPanel {...props} />;
  }

  it("gravando, 'Salvando o evento…' aos 300 ms, sem desabilitar, e o Cancelar do formulário travado", async () => {
    await montar(painel(false));
    await act(async () => botao("Salvar como evento")!.click());
    const nome = container.querySelector<HTMLInputElement>("#cart-event-name")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(nome, "Feira");
      nome.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await montar(painel(true));
    await ate(() => botao("Salvando o evento…"));
    const salvando = botao("Salvando o evento…")!;
    expect(salvando.hasAttribute("disabled")).toBe(false);
    expect(salvando.getAttribute("aria-busy")).toBe("true");
    const formulario = salvando.closest("form")!;
    const cancelar = botao("Cancelar", formulario)!;
    expect(cancelar.getAttribute("aria-disabled")).toBe("true");
    expect(cancelar.hasAttribute("disabled")).toBe(false);
    await act(async () => cancelar.click());
    expect(container.querySelector("#cart-event-name")).not.toBeNull();
    expect(await violacoesDeAcessibilidade(formulario.outerHTML)).toEqual([]);
  });
});

describe("as datas de entrada no detalhe", () => {
  const produto = () => groupInventoryProducts([POLO])[0]!;
  const detalhe = (leitura: ComponentProps<typeof ProductDetailPanel>["leituraDasDatas"]) => (
    <ProductDetailPanel
      product={produto()}
      cart={{}}
      draftQuantity={1}
      isPending={false}
      onClose={() => undefined}
      onDraftQuantityChange={() => undefined}
      onAdd={() => undefined}
      onReplenish={() => undefined}
      onArchive={() => undefined}
      leituraDasDatas={leitura}
    />
  );

  it("lendo, a seção fica, com a caixa e 'Carregando as datas…' aos 300 ms", async () => {
    await montar(detalhe({ lendo: true, falhou: false, tentando: false, onTentar: () => undefined }));
    expect(container.textContent).toContain("Por data de entrada");
    await ate(() => container.textContent?.includes("Carregando as datas…"));
    const secao = container.querySelector("section[aria-labelledby]")!;
    expect(textosForaDaLista(secao.outerHTML, ["Por data de entrada", "Carregando as datas…"])).toEqual([]);
    expect(await violacoesDeAcessibilidade(secao.outerHTML)).toEqual([]);
  });

  it("na falha, a seção diz que não carregou, com 'Tentar de novo'", async () => {
    let tentativas = 0;
    await montar(detalhe({ lendo: false, falhou: true, tentando: false, onTentar: () => (tentativas += 1) }));
    expect(container.textContent).toContain("Não foi possível carregar as datas de entrada.");
    await act(async () => botao("Tentar de novo")!.click());
    expect(tentativas).toBe(1);
    const secao = container.querySelector("section[aria-labelledby]")!;
    expect(textosForaDaLista(secao.outerHTML, ["Por data de entrada", "Não foi possível carregar as datas de entrada.", "Tentar de novo", "Tentando de novo…"])).toEqual([]);
    expect(await violacoesDeAcessibilidade(secao.outerHTML)).toEqual([]);
  });

  it("a confirmação do adicionado é dita pelo Anunciador, sem região viva solta", async () => {
    await montar(
      <ProductDetailPanel
        product={produto()}
        cart={{}}
        draftQuantity={1}
        isPending={false}
        adicionado={2}
        onOpenCart={() => undefined}
        onClose={() => undefined}
        onDraftQuantityChange={() => undefined}
        onAdd={() => undefined}
        onReplenish={() => undefined}
        onArchive={() => undefined}
      />,
    );
    const rodape = container.querySelector('[data-testid="detalhe-rodape"]')!;
    expect(rodape.querySelector('[role="status"], [aria-live]')).toBeNull();
    expect(rodape.querySelector('[data-testid="detalhe-adicionado"]')?.textContent).toBe("2 peças adicionadas ao pedido");
    await ate(() => anunciado().includes("2 peças adicionadas ao pedido"));
  });
});

describe("a contagem do resultado", () => {
  const barra = (resultCount: number, searchTerm = "") => (
    <MarketplaceToolbar
      searchTerm={searchTerm}
      stockFilter="todos"
      categoryFilters={[]}
      categories={[]}
      sortMode="maior-saldo"
      viewMode="cards"
      groupVariants
      onGroupVariantsChange={() => undefined}
      resultCount={resultCount}
      filterCounts={{ todos: 3, disponiveis: 1, baixo: 0, zerado: 2, arquivados: 0 }}
      activeFilterCount={0}
      hasActiveFilters={false}
      onSearchChange={() => undefined}
      onStockFilterChange={() => undefined}
      onCategoryFiltersChange={() => undefined}
      onSortModeChange={() => undefined}
      onViewModeChange={() => undefined}
      onClearFilters={() => undefined}
    />
  );

  it("não é região viva solta; quando a pessoa busca, o Anunciador diz, e a primeira pintura e a releitura não falam", async () => {
    await montar(barra(3));
    const resultado = container.querySelector('[data-testid="stock-results-count"]')!;
    expect(resultado.textContent).toBe("3 itens encontrados");
    expect(resultado.hasAttribute("role")).toBe(false);
    expect(resultado.hasAttribute("aria-live")).toBe(false);
    await espera(50);
    expect(anunciado()).toBe("");
    // A releitura que muda a contagem, com a mesma busca, não fala (momento 7).
    await montar(barra(4));
    await espera(50);
    expect(anunciado()).toBe("");
    await montar(barra(1, "polo"));
    await ate(() => anunciado().includes("1 item encontrado"));
  });
});

describe("revisão da parte 13f, no Estoque", () => {
  it("o produto arquivado, no detalhe: Devolver à vitrine, com o gerúndio e o fim nos rótulos da lista", async () => {
    const [arquivado] = groupInventoryProducts([{ ...AZUL, client_archived: true } as Parameters<typeof groupInventoryProducts>[0][number]]);
    expect(arquivado!.archived).toBe(true);
    await montar(
      <ProductDetailPanel
        product={arquivado!}
        cart={{}}
        draftQuantity={1}
        isPending={false}
        onClose={() => undefined}
        onDraftQuantityChange={() => undefined}
        onAdd={() => undefined}
        onReplenish={() => undefined}
        onArchive={() => undefined}
      />,
    );
    const rodape = container.querySelector<HTMLElement>('[data-testid="detalhe-rodape"]')!;
    expect(textosDaTela(rodape.outerHTML)).toEqual(expect.arrayContaining(["Devolver à vitrine", "Devolvendo…", "Devolvido"]));
    expect(
      textosForaDaLista(rodape.outerHTML, [
        "Avisar reposição",
        "Avisando…",
        "Avisado",
        "Devolver à vitrine",
        "Devolvendo…",
        "Devolvido",
        "Conferir",
        /pe(ç|c)as? no pedido|Ver pedido|Adicionar|^\d+$/,
      ]),
    ).toEqual([]);
  });

  it("o Avisar reposição que dá certo lê o portal uma vez só", async () => {
    estado.avisoGrava = true;
    await montar(<ClienteEstoque />);
    await ate(() => card("Toalha Azul"));
    const antes = estado.leiturasDoPortal;
    await act(async () => botao("Avisar reposição", card("Toalha Azul"))!.click());
    await ate(() => botao("Avisado", card("Toalha Azul")));
    await espera(300);
    expect(estado.envios).toBe(1);
    expect(estado.leiturasDoPortal - antes).toBe(1);
  });

  it("o produto arquivado sai da vitrine e o foco vai ao vizinho, nunca ao body", async () => {
    await montar(<ClienteEstoque />);
    await ate(() => card("Toalha Azul") && card("Toalha Verde"));
    const arquivar = botao("Arquivar", card("Toalha Azul"))!;
    arquivar.focus();
    await act(async () => arquivar.click());
    await ate(() => !card("Toalha Azul"), 4_000);
    expect(document.activeElement).not.toBe(document.body);
    expect(card("Toalha Verde").contains(document.activeElement)).toBe(true);
  });

  it("no celular, as ações do produto no card têm 48 px", async () => {
    await montar(<ClienteEstoque />);
    await ate(() => card("Toalha Azul"));
    for (const rotulo of ["Avisar reposição", "Arquivar"]) expect(botao(rotulo, card("Toalha Azul"))!.className).toContain("max-md:min-h-12");
  });

  it("só o produto com peça na prateleira, livre ou reservada, pode ter datas", () => {
    const [polo] = groupInventoryProducts([POLO]);
    const [azul] = groupInventoryProducts([AZUL]);
    expect(podeTerDatas(polo!)).toBe(true);
    expect(podeTerDatas(azul!)).toBe(false);
    expect(podeTerDatas({ available: 0, reserved: 0, receiving: 5, total: 5 })).toBe(false);
    expect(podeTerDatas({ available: 0, reserved: 3, receiving: 0, total: 3 })).toBe(true);
  });

  it("o produto sem peça na prateleira não mostra a seção das datas lendo para sumir; o que tem, mostra", async () => {
    estado.comPolo = true;
    estado.datasEm = 450;
    await montar(<ClienteEstoque />);
    await ate(() => card("Toalha Azul") && card("Polo Azul"));
    const abrir = (nome: string) =>
      [...card(nome).querySelectorAll<HTMLButtonElement>("button")].find(
        (item) => item.getAttribute("aria-label") === `Ver detalhes de ${nome}` || item.textContent?.trim() === nome,
      )!;
    await act(async () => abrir("Toalha Azul").click());
    await ate(() => document.body.textContent?.includes("Detalhe do produto"));
    let apareceu = false;
    for (let vez = 0; vez < 30; vez += 1) {
      apareceu ||= Boolean(document.body.textContent?.includes("Por data de entrada"));
      await espera(25);
    }
    expect(apareceu).toBe(false);
    expect(document.body.textContent).not.toContain("Carregando as datas…");
  });
});
