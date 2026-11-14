// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

import { Anunciador } from "@/lib/carregando/anunciador";
import { ProvedorDaConexao } from "@/lib/carregando/estado-da-conexao";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { conexaoEm } from "@/test/conexao";

/**
 * A troca de filtro, mês ou período nas listas com filtro no servidor
 * (carregamento v2, momento 7, caso 4; parte 10): Produtos, SKUs,
 * Movimentações, Pedidos legado, Relatórios e o Fechamento do mês. Antes, a
 * lista sumia e dava lugar a "Carregando..." até a nova chegar (a tela pulava
 * para cima e para baixo). Agora a lista anterior fica, a 50%, `inert` e com
 * `aria-busy`, com a barra no topo do cartão, até a nova chegar. A troca que
 * falha mostra o aviso no lugar da lista, nunca o vazio; a releitura que
 * falha não apaga a lista. Dados sintéticos.
 */

const estado = vi.hoisted(() => ({
  /** O atraso de cada leitura, por caminho; o resto responde em 30 ms. */
  atrasos: {} as Record<string, number>,
  /** Os caminhos que falham com um erro do servidor. */
  falhas: new Set<string>(),
  leituras: [] as string[],
}));

vi.mock("@/lib/auth", () => ({ useAppUser: () => ({ user: { uid: "u-1", publicMetadata: { role: "admin" } }, isLoaded: true }) }));
vi.mock("@/lib/active-customer-context", async () => {
  const { activeCustomerOptions } = await vi.importActual<typeof import("@/lib/active-customer")>("@/lib/active-customer");
  const options = activeCustomerOptions([{ customer_code: "BTG", name: "BTG Pactual", operation_template: "uniformes", sku_prefix: "BTG" }] as never);
  return { useActiveCustomer: () => ({ active: options[0], code: options[0].code, options, setCode: () => undefined, isLoading: false, codeProvavel: options[0].code }) };
});
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));

import Billing from "./billing";
import Movements from "./movements";
import Orders from "./orders";
import Products from "./products";
import Reports from "./reports";
import Skus from "./skus";

// 13:42 UTC são 10:42 no armazém (America/Sao_Paulo).
const AGORA = Date.parse("2026-11-13T13:42:00Z");

const NOMES = ["Polo Masculino Piquet Preto", "Camisa Social Branca", "Calça Jeans Azul"];
const PRODUTOS = Array.from({ length: 12 }, (_, i) => ({
  id: i + 1,
  cod_cliente: `A.${String(i + 1).padStart(3, "0")}`,
  cod_btg: `BTG-${String(i + 1).padStart(6, "0")}`,
  produto: `${NOMES[i % 3]} ${i + 1}`,
  categoria: "Uniforme",
  cor: "Preto",
  tamanho: "M",
  preco_unit: 10,
  estoque_btg: 5,
  estoque_atual: 5,
  custo_total: 50,
}));
const TIPOS = ["ENTRADA", "SAIDA"];
const MOVIMENTOS = Array.from({ length: 6 }, (_, i) => ({
  id: `mov_${i}`,
  data: new Date(AGORA - i * 3_600_000).toISOString(),
  tipo_mov: TIPOS[i % 2],
  cod_sku: `BTG-00000${i + 1}`,
  produto: `${NOMES[i % 3]} ${i + 1}`,
  qtde: i + 1,
  sinal: i % 2 ? -1 : 1,
}));
const STATUS = ["ENTREGUE", "PENDENTE"];
const PEDIDOS = Array.from({ length: 6 }, (_, i) => ({
  id: i + 1,
  num_pedido: String(1000 + i),
  data_solic: new Date(AGORA - i * 86_400_000).toISOString(),
  cod_cliente: "BTG",
  canal: "Portal",
  produto: NOMES[i % 3],
  qtd_solic: 10,
  qtd_sep: 2,
  status: STATUS[i % 2],
}));

function periodo(competencia: string) {
  const mes = Number(competencia.slice(5, 7));
  const total = 1_000 * mes;
  return {
    competencia,
    status: "aberto",
    custo_estoque: 0,
    ad_valorem_rate: 0,
    total,
    grupos: [{ grupo: "Armazenagem", total, itens: [{ price_list_id: 1, item: `Posição palete ${competencia}`, unidade: "posição", qtde: mes, valor_unit: 1_000, total, auto: true }] }],
    emission: { can_emit: true, available_from: `${competencia}-28` },
  };
}

function dados(url: URL): unknown {
  const busca = (url.searchParams.get("search") ?? "").toLowerCase();
  switch (url.pathname) {
    case "/api/products":
    case "/api/skus": {
      const itens = PRODUTOS.filter((p) => !busca || p.produto.toLowerCase().includes(busca));
      return { items: itens, total: itens.length };
    }
    case "/api/movements": {
      const tipo = url.searchParams.get("tipo_mov");
      const itens = MOVIMENTOS.filter((m) => !tipo || m.tipo_mov === tipo);
      return { items: itens, total: itens.length, has_more: false };
    }
    case "/api/orders": {
      const status = url.searchParams.get("status");
      const itens = PEDIDOS.filter((p) => !status || p.status === status);
      return { items: itens, total: itens.length };
    }
    case "/api/reports/movements": {
      const de = Date.parse(url.searchParams.get("from") ?? "");
      return {
        capped: false,
        // O período mais curto tem só a última movimentação: dá para ver de qual período é a prévia.
        items: MOVIMENTOS.filter((_, i) => i === 0 || de < AGORA - 8 * 86_400_000).map((m) => ({ ...m, created_at: m.data, product_name: m.produto, client_item_code: `${m.cod_sku}-${de < AGORA - 8 * 86_400_000 ? "mes" : "semana"}` })),
      };
    }
    case "/api/billing/periods":
      return { items: [] };
    default: {
      const mes = url.pathname.match(/^\/api\/billing\/periods\/(\d{4}-\d{2})$/);
      if (mes) return periodo(mes[1]);
      return { items: [] };
    }
  }
}

async function servir(entrada: RequestInfo | URL) {
  const url = new URL(String(entrada instanceof Request ? entrada.url : entrada), "http://localhost");
  estado.leituras.push(`${url.pathname}${url.search}`);
  const atraso = Object.entries(estado.atrasos).find(([caminho]) => url.pathname.startsWith(caminho))?.[1] ?? 30;
  await new Promise((pronto) => setTimeout(pronto, atraso));
  const falhou = [...estado.falhas].some((caminho) => url.pathname.startsWith(caminho));
  const corpo = falhou ? { message: "Falha interna no servidor." } : dados(url);
  return new Response(JSON.stringify(corpo), { status: falhou ? 500 : 200, headers: { "content-type": "application/json" } });
}

let raiz: Root | null = null;
let container: HTMLDivElement;
let cliente: QueryClient;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AGORA);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(servir));
  estado.atrasos = {};
  estado.falhas = new Set();
  estado.leituras = [];
  window.history.replaceState(null, "", "/");
  container = document.createElement("div");
  document.body.append(container);
  cliente = new QueryClient({ defaultOptions: { queries: { retry: false, networkMode: "always", refetchOnWindowFocus: false } } });
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  container.remove();
  cliente.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function passar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function montar(Tela: ComponentType) {
  raiz = createRoot(container);
  await act(async () => {
    raiz!.render(
      <ProvedorDaConexao value={conexaoEm("conectado")}>
        <QueryClientProvider client={cliente}>
          <Router>
            <Anunciador />
            <Tela />
          </Router>
        </QueryClientProvider>
      </ProvedorDaConexao>,
    );
  });
}

function botao(texto: string | RegExp): HTMLButtonElement {
  const achado = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((item) => {
    const rotulo = item.textContent?.replace(/\s+/g, " ").trim() ?? "";
    return typeof texto === "string" ? rotulo === texto : texto.test(rotulo);
  });
  if (!achado) throw new Error(`Sem o botão ${texto}`);
  return achado;
}

async function buscar(texto: string) {
  const campo = container.querySelector<HTMLInputElement>('input[type="search"]')!;
  const definir = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    definir.call(campo, texto);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
  // A busca espera 500 ms sem digitar.
  await passar(500);
}

/** A lista que está trocando: aria-busy e inert, só neste caso. */
const listaEmTroca = () => container.querySelector<HTMLElement>('[data-lista-em-troca][aria-busy="true"][inert]');
const barraDoTopo = () => container.querySelector('.carregando-barra[data-lugar="topo"]');
/** O texto da tela sem a camada que sai da linha de estado (ela troca em sequência, e a que sai fica fora da árvore). */
const texto = () => {
  const copia = container.cloneNode(true) as HTMLElement;
  copia.querySelectorAll("[data-sai]").forEach((sai) => sai.remove());
  return copia.textContent ?? "";
};
/** O que a linha de estado da tela diz agora (a camada atual). */
const linhaDeEstado = () =>
  container.querySelector<HTMLElement>("[data-linha-de-estado] > [data-camada]:not([data-sai])")?.textContent?.replace(/\s+/g, " ").trim() ?? "";

type Tela = {
  nome: string;
  Tela: ComponentType;
  /** O caminho que a troca lê. */
  caminho: string;
  /** Antes de trocar (escolher o relatório). */
  preparar?: () => Promise<void>;
  trocar: () => Promise<void>;
  /** Um texto da lista anterior, que some na chegada da nova. */
  anterior: string;
  /** Um texto da lista nova. */
  nova: string;
};

const TELAS: Tela[] = [
  { nome: "Produtos", Tela: Products, caminho: "/api/products", trocar: () => buscar("camisa"), anterior: "Polo Masculino Piquet Preto 1", nova: "Camisa Social Branca 2" },
  { nome: "SKUs", Tela: Skus, caminho: "/api/skus", trocar: () => buscar("camisa"), anterior: "Polo Masculino Piquet Preto 1", nova: "Camisa Social Branca 2" },
  {
    nome: "Movimentações",
    Tela: Movements,
    caminho: "/api/movements",
    trocar: async () => act(async () => botao("Saída").click()),
    anterior: "Polo Masculino Piquet Preto 1",
    nova: "Camisa Social Branca 2",
  },
  {
    nome: "Pedidos legado",
    Tela: Orders,
    caminho: "/api/orders",
    trocar: async () => act(async () => botao("Pendente").click()),
    anterior: "#1000",
    nova: "#1001",
  },
  {
    nome: "Relatórios",
    Tela: Reports,
    caminho: "/api/reports/movements",
    preparar: async () => {
      await act(async () => botao(/^Movimentações/).click());
      await passar(200);
    },
    trocar: async () => act(async () => botao("Últimos 7 dias").click()),
    anterior: "Camisa Social Branca 2",
    nova: "Polo Masculino Piquet Preto 1",
  },
  {
    nome: "Fechamento",
    Tela: Billing,
    caminho: "/api/billing/periods/",
    trocar: async () => act(async () => botao(/^Novembro de 2026/).click()),
    anterior: "Posição palete 2026-10",
    nova: "Posição palete 2026-11",
  },
];

describe.each(TELAS)("$nome: trocar o filtro mantém a lista anterior", ({ Tela, caminho, preparar, trocar, anterior, nova }) => {
  it("a lista anterior fica, aria-busy e inert, com a barra no topo do cartão, até a nova chegar; nada de Carregando", async () => {
    await montar(Tela);
    await passar(300);
    if (preparar) await preparar();
    expect(texto()).toContain(anterior);
    expect(listaEmTroca()).toBeNull();
    // O axe no fim (ele usa o relógio de verdade): a tela antes e na troca.
    const antes = container.innerHTML;

    estado.atrasos[caminho] = 2_000;
    await trocar();
    await passar(50);
    // A lista anterior fica na tela, ocupada e sem toque: aria-busy e inert, que só valem neste caso.
    expect(listaEmTroca(), "a lista anterior, aria-busy e inert").not.toBeNull();
    expect(listaEmTroca()!.textContent).toContain(anterior);
    expect(texto()).not.toMatch(/Carregando|Calculando/);
    // A barra do topo entra aos 300 ms, no cartão, fora do que esmaece.
    expect(barraDoTopo()).toBeNull();
    await passar(300);
    expect(barraDoTopo()).not.toBeNull();
    expect(barraDoTopo()!.closest("[data-barra-da-lista]")).not.toBeNull();
    const naTroca = container.innerHTML;

    await passar(2_000);
    expect(listaEmTroca()).toBeNull();
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    expect(texto()).toContain(nova);
    expect(texto()).not.toContain(anterior);

    // O axe na troca: nenhuma violação que a tela não tinha antes dela.
    vi.useRealTimers();
    const violacoesAntes = await violacoesDeAcessibilidade(antes);
    expect((await violacoesDeAcessibilidade(naTroca)).filter((violacao) => !violacoesAntes.includes(violacao))).toEqual([]);
  });
});

describe("a troca e a releitura que falham", () => {
  it("Produtos: a busca que falha mostra o aviso com Tentar de novo no lugar da lista, nunca o vazio", async () => {
    await montar(Products);
    await passar(300);
    estado.falhas.add("/api/products");
    await buscar("camisa");
    await passar(100);
    expect(texto()).toContain("Não consegui carregar os produtos.");
    expect(botao("Tentar de novo")).toBeTruthy();
    expect(listaEmTroca()).toBeNull();
    // Tentar de novo segue com o aviso ("Tentando de novo…"), e não com a lista de outra busca por baixo.
    estado.falhas.clear();
    estado.atrasos["/api/products"] = 1_000;
    await act(async () => botao("Tentar de novo").click());
    await passar(400);
    expect(texto()).toContain("Não consegui carregar os produtos.");
    expect(texto()).toContain("Tentando de novo…");
    expect(texto()).not.toContain("Polo Masculino Piquet Preto 1");
    await passar(1_000);
    expect(texto()).toContain("Camisa Social Branca 2");
    expect(texto()).not.toContain("Não consegui carregar");
  });

  it("Fechamento: o mês que falha mostra o aviso com Tentar de novo no lugar do mês anterior", async () => {
    await montar(Billing);
    await passar(300);
    estado.falhas.add("/api/billing/periods/2026-11");
    await act(async () => botao(/^Novembro de 2026/).click());
    await passar(100);
    expect(texto()).toContain("Falha interna no servidor.");
    expect(botao("Tentar de novo")).toBeTruthy();
    expect(texto()).not.toContain("Posição palete 2026-10");
  });

  it.each([
    { nome: "Produtos", Tela: Products, caminho: "/api/products", naLista: "Polo Masculino Piquet Preto 1" },
    { nome: "Fechamento", Tela: Billing, caminho: "/api/billing/periods/", naLista: "Posição palete 2026-10" },
  ])("$nome: a releitura que falha não apaga a lista; a linha de estado diz Não consegui atualizar · lista de 10:42", async ({ Tela, caminho, naLista }) => {
    await montar(Tela);
    await passar(300);
    expect(texto()).toContain(naLista);
    estado.falhas.add(caminho);
    vi.setSystemTime(AGORA + 3 * 60_000);
    await act(async () => {
      void cliente.invalidateQueries();
    });
    await passar(100);
    expect(texto()).toContain(naLista);
    expect(linhaDeEstado()).toBe("Não consegui atualizar· lista de 10:42Tentar de novo");
    expect(texto()).not.toContain("Não consegui carregar");
    expect(listaEmTroca()).toBeNull();
    // Tentar de novo relê e, de volta, a linha diz a hora da lista nova.
    estado.falhas.clear();
    await act(async () => botao("Tentar de novo").click());
    await passar(200);
    expect(linhaDeEstado()).toBe("Atualizado às 10:45");
    expect(texto()).not.toContain("Não consegui atualizar");
    expect(texto()).toContain(naLista);
  });

  it("Relatórios: a releitura que falha não apaga a prévia, e o Baixar planilha fica ocupado na troca, sem disabled", async () => {
    await montar(Reports);
    await passar(300);
    await act(async () => botao(/^Movimentações/).click());
    await passar(200);
    expect(texto()).toContain("Camisa Social Branca 2");
    estado.atrasos["/api/reports/movements"] = 2_000;
    await act(async () => botao("Últimos 7 dias").click());
    await passar(50);
    const baixar = botao("Baixar planilha");
    expect(baixar.getAttribute("aria-disabled")).toBe("true");
    expect(baixar.hasAttribute("disabled")).toBe(false);
    await passar(2_100);
    expect(baixar.hasAttribute("aria-disabled")).toBe(false);

    estado.falhas.add("/api/reports/movements");
    await act(async () => {
      void cliente.invalidateQueries();
    });
    await passar(2_100);
    expect(texto()).toContain("Polo Masculino Piquet Preto 1");
    expect(texto()).toContain("Não consegui atualizar");
  });
});

describe("Movimentações: a paginação na troca", () => {
  it("Próximo fica ocupado (aria-disabled, sem disabled) e o foco fica nele; a página seguinte usa o cursor da página que chegou", async () => {
    // Três páginas de uma movimentação cada, com o cursor da seguinte.
    vi.mocked(fetch).mockImplementation(async (entrada) => {
      const url = new URL(String(entrada), "http://localhost");
      estado.leituras.push(`${url.pathname}${url.search}`);
      const cursor = Number(url.searchParams.get("cursor") ?? 0);
      await new Promise((pronto) => setTimeout(pronto, estado.atrasos["/api/movements"] ?? 30));
      const item = MOVIMENTOS[cursor];
      return new Response(JSON.stringify({ items: [item], total: 3, has_more: cursor < 2, next_cursor: cursor < 2 ? String(cursor + 1) : undefined }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    await montar(Movements);
    // A busca espera 500 ms desde a abertura e volta à primeira página.
    await passar(600);
    estado.atrasos["/api/movements"] = 1_000;
    const proximo = botao("Próximo");
    proximo.focus();
    await act(async () => proximo.click());
    await passar(50);
    expect(proximo.hasAttribute("disabled")).toBe(false);
    expect(proximo.getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(proximo);
    // O segundo toque, com a página 2 ainda a caminho, não pede outra página.
    const pedidas = estado.leituras.length;
    await act(async () => proximo.click());
    await passar(50);
    expect(estado.leituras.length).toBe(pedidas);
    await passar(1_000);
    expect(proximo.hasAttribute("aria-disabled")).toBe(false);
    await act(async () => proximo.click());
    await passar(1_100);
    // A página 3 pede o cursor que a página 2 devolveu, e não o da página 1, que ficou na tela durante a troca.
    expect(estado.leituras.at(-1)).toContain("cursor=2");
    expect(texto()).toContain(MOVIMENTOS[2].produto);
  });
});

/** A revisão da parte 10: o que a troca e a releitura faziam de errado no navegador e no leitor de tela. */
describe("a revisão da troca e da releitura", () => {
  const produtosEmPaginas = (quantos: number) =>
    vi.mocked(fetch).mockImplementation(async (entrada) => {
      const url = new URL(String(entrada), "http://localhost");
      estado.leituras.push(`${url.pathname}${url.search}`);
      await new Promise((pronto) => setTimeout(pronto, estado.atrasos["/api/products"] ?? 30));
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const limite = Number(url.searchParams.get("limit") ?? 50);
      const todos = Array.from({ length: quantos }, (_, i) => ({ ...PRODUTOS[i % PRODUTOS.length], id: i + 1, cod_cliente: `A.${String(i + 1).padStart(3, "0")}`, produto: `${NOMES[i % 3]} ${i + 1}` }));
      return new Response(JSON.stringify({ items: todos.slice(offset, offset + limite), total: todos.length }), { status: 200, headers: { "content-type": "application/json" } });
    });

  it("a releitura que falha não empurra a lista: o estado fica na linha reservada sob o título, sem faixa nova acima do cartão", async () => {
    await montar(Products);
    await passar(300);
    const cartao = container.querySelector("table")!.closest("section")!;
    const antesDoCartao = cartao.previousElementSibling;
    // A linha já está na tela, reservada, antes de qualquer falha.
    const linha = container.querySelector("header [data-linha-de-estado]");
    expect(linha).not.toBeNull();
    estado.falhas.add("/api/products");
    await act(async () => void cliente.invalidateQueries());
    await passar(100);
    expect(linhaDeEstado()).toBe("Não consegui atualizar· lista de 10:42Tentar de novo");
    expect(container.querySelector("header [data-linha-de-estado]")).toBe(linha);
    expect(cartao.previousElementSibling).toBe(antesDoCartao);
  });

  it("a troca que passa de 5 s diz Atualizando… sob o título; aos 10 s, a demora com Tentar de novo, dita uma vez, que relê", async () => {
    await montar(Products);
    await passar(300);
    estado.atrasos["/api/products"] = 30_000;
    await buscar("camisa");
    await passar(4_500);
    expect(linhaDeEstado()).toBe("Atualizado às 10:42");
    await passar(700);
    expect(listaEmTroca()).not.toBeNull();
    expect(linhaDeEstado()).toBe("Atualizando…");
    await passar(5_000);
    expect(linhaDeEstado()).toBe("Demorando mais que o normalTentar de novo");
    await passar(2_000);
    expect(container.querySelector("[data-anunciador]")?.textContent).toBe("Demorando mais que o normal");
    // Tentar de novo larga a leitura presa e lê de novo a busca nova; a lista anterior segue na tela até ela chegar.
    estado.atrasos["/api/products"] = 100;
    const pedidas = estado.leituras.length;
    const tentar = Array.from(container.querySelectorAll<HTMLButtonElement>("[data-linha-de-estado] .linha-de-estado-tentar")).find((b) => !b.closest("[data-sai]"))!;
    await act(async () => tentar.click());
    await passar(400);
    expect(estado.leituras.length).toBeGreaterThan(pedidas);
    expect(estado.leituras.at(-1)).toContain("search=camisa");
    expect(texto()).toContain("Camisa Social Branca 2");
    expect(listaEmTroca()).toBeNull();
  });

  it("a busca que falha: sem falsos zeros na contagem, a releitura automática não mexe no aviso, e o Tentar de novo que dá certo leva o foco à linha de estado", async () => {
    await montar(Products);
    await passar(300);
    estado.falhas.add("/api/products");
    await buscar("camisa");
    await passar(100);
    expect(texto()).toContain("Não consegui carregar os produtos.");
    expect(texto()).not.toContain("Exibindo 0 de 0");
    expect(texto()).not.toContain("0 produto(s) nesta página");
    const alerta = () => container.querySelector('[role="alert"]')?.textContent?.replace(/\s+/g, " ").trim();
    expect(alerta()).toBe("Não consegui carregar os produtos.Tentar de novo");
    // A releitura automática (o tempo real invalida a lista): o alerta não troca de texto, e não fala de novo.
    estado.atrasos["/api/products"] = 1_000;
    await act(async () => void cliente.invalidateQueries({ queryKey: ["/api/products"] }));
    await passar(500);
    expect(alerta()).toBe("Não consegui carregar os produtos.Tentar de novo");
    await passar(1_000);
    // A pessoa tenta de novo e dá certo: o aviso sai, e o foco vai à linha de estado, nunca ao body.
    estado.falhas.clear();
    estado.atrasos["/api/products"] = 600;
    const tentar = botao("Tentar de novo");
    tentar.focus();
    await act(async () => tentar.click());
    // "Tentando de novo…" no relógio da espera (junção das partes 10 e 13): nada muda no alerta antes de 300 ms.
    await passar(100);
    expect(alerta()).toBe("Não consegui carregar os produtos.Tentar de novo");
    await passar(250);
    expect(alerta()).toBe("Não consegui carregar os produtos.Tentando de novo…");
    await passar(400);
    expect(texto()).not.toContain("Não consegui carregar");
    expect(document.activeElement).toBe(container.querySelector("[data-linha-de-estado]"));
  });

  it("a paginação nas pontas: o Próximo que chega à última página e o Anterior que volta à primeira ficam com o foco, aria-disabled e sem disabled", async () => {
    produtosEmPaginas(70);
    await montar(Products);
    await passar(600);
    estado.atrasos["/api/products"] = 400;
    const proximo = botao("Próximo");
    proximo.focus();
    await act(async () => proximo.click());
    await passar(500);
    expect(texto()).toContain("Polo Masculino Piquet Preto 52");
    expect(document.activeElement).toBe(proximo);
    expect(proximo.hasAttribute("disabled")).toBe(false);
    expect(proximo.getAttribute("aria-disabled")).toBe("true");
    // Indisponível na última página: o toque não pede outra.
    const pedidas = estado.leituras.length;
    await act(async () => proximo.click());
    await passar(500);
    expect(estado.leituras.length).toBe(pedidas);
    const anterior = botao("Anterior");
    anterior.focus();
    await act(async () => anterior.click());
    await passar(500);
    expect(texto()).toContain("Polo Masculino Piquet Preto 1");
    expect(document.activeElement).toBe(anterior);
    expect(anterior.hasAttribute("disabled")).toBe(false);
    expect(anterior.getAttribute("aria-disabled")).toBe("true");
  });

  it("a página nova que chega com o topo do cartão acima da tela traz o começo dela à vista", async () => {
    produtosEmPaginas(70);
    await montar(Products);
    await passar(600);
    const cartao = container.querySelector("table")!.closest("section")!;
    const rolar = vi.fn();
    cartao.scrollIntoView = rolar;
    cartao.getBoundingClientRect = () => ({ top: -1_700, bottom: 900, left: 0, right: 1_400, width: 1_400, height: 2_600, x: 0, y: -1_700, toJSON: () => ({}) });
    estado.atrasos["/api/products"] = 400;
    await act(async () => botao("Próximo").click());
    await passar(100);
    // Durante a troca, nada rola: a pessoa está no pé, vendo a lista anterior esmaecer.
    expect(rolar).not.toHaveBeenCalled();
    await passar(400);
    expect(rolar).toHaveBeenCalledTimes(1);
    expect(rolar).toHaveBeenCalledWith({ block: "start" });
  });
});

describe("Relatórios de estoque: a primeira leitura que falha", () => {
  it("Tentar de novo segue com o aviso e Tentando de novo…, sem Carregando..., e o foco fica no botão", async () => {
    let falhas = 1;
    vi.mocked(fetch).mockImplementation(async (entrada) => {
      const url = new URL(String(entrada), "http://localhost");
      const skus = url.pathname === "/api/skus";
      await new Promise((pronto) => setTimeout(pronto, skus && falhas === 0 ? 1_500 : 30));
      if (skus && falhas > 0) {
        falhas -= 1;
        return new Response(JSON.stringify({ message: "Falha interna no servidor." }), { status: 500, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { "content-type": "application/json" } });
    });
    await montar(Reports);
    await passar(300);
    await act(async () => botao(/^Posição de estoque/).click());
    await passar(200);
    const tentar = botao("Tentar de novo");
    tentar.focus();
    await act(async () => tentar.click());
    await passar(400);
    expect(texto()).toContain("Falha interna no servidor.");
    expect(texto()).toContain("Tentando de novo…");
    expect(texto()).not.toContain("Carregando...");
    expect(document.activeElement).toBe(botao("Tentando de novo…"));
    await passar(1_500);
    expect(texto()).not.toContain("Falha interna no servidor.");
  });
});
