// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { Anunciador } from "@/lib/carregando/anunciador";
import { ProvedorDaConexao, type EstadoDaConexao } from "@/lib/carregando/estado-da-conexao";
import { CARREGANDO } from "@/lib/carregando/tempo";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { conexaoEm } from "@/test/conexao";
import { textosForaDaLista } from "@/test/textos";

/**
 * A linha de estado nas quatro listas (carregamento v2, seção 5.3 e momentos
 * 2, 7 e 8; parte 7b): Pedidos, Receber, Estoque e Estoque › Alertas, com a
 * tela de verdade. Sob o título, sempre reservada, a linha diz "Carregando
 * pedidos…" aos 300 ms, "Atualizado às 10:42" depois, e a falta de conexão
 * com a lista lida, no lugar da faixa que empurrava a lista. A releitura
 * automática da tela não mostra nada, não mexe na região viva e não gira o
 * Atualizar. Dados sintéticos.
 */

const estado = vi.hoisted(() => ({
  atrasoMs: 30,
  falha: null as null | "sem_resposta",
  leituras: [] as string[],
}));

vi.mock("@/lib/auth", () => ({ useAppUser: () => ({ user: { publicMetadata: { role: "admin" } } }) }));
vi.mock("@/lib/active-customer-context", async () => {
  const { activeCustomerOptions } = await vi.importActual<typeof import("@/lib/active-customer")>("@/lib/active-customer");
  const options = activeCustomerOptions([{ customer_code: "BTG", name: "BTG Pactual", operation_template: "uniformes", sku_prefix: "BTG" }] as never);
  return { useActiveCustomer: () => ({ active: options[0], code: options[0].code, options, setCode: () => undefined, isLoading: false }) };
});
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));
vi.mock("@/hooks/use-desktop", () => ({ useIsDesktop: () => true }));
vi.mock("@/lib/liberacao", async (original) => ({ ...(await original<typeof import("@/lib/liberacao")>()), MEMORIA_LIBERADA: true }));
vi.mock("@/lib/operacao/leitura", () => ({
  useLeitura: () => ({ itens: [], erro: false }),
  useDocumento: () => ({ item: undefined, erro: false }),
}));
vi.mock("@/features/warehouse-ops/opening-inventory-status", () => ({
  useOpeningInventorySession: () => ({ data: undefined }),
  OpeningInventoryNotice: () => null,
}));

import Estoque from "./estoque";
import EstoqueAlertas from "./estoque-alertas";
import Pedidos from "./pedidos";
import Receber from "./receber";

// 13:42 UTC são 10:42 no armazém (America/Sao_Paulo).
const AGORA = Date.parse("2026-11-13T13:42:00Z");

function dados(caminho: string): unknown {
  switch (caminho) {
    case "/api/warehouse/ops":
      return {
        alerts: [],
        queues: {
          picking: { key: "picking", tasks: [{ id: "pick_ord_1039", reference: "pick_ord_1039", title: "PED-1039", status: "planned", can_advance: true, exception_count: 0, customer_code: "BTG", items: [] }] },
          receiving: { key: "receiving", tasks: [{ id: "inb_4410", reference: "inb_4410", title: "NF 4410 · Confecções Sul", status: "planned", can_advance: true, exception_count: 0, customer_code: "BTG", items: [] }] },
        },
      };
    case "/api/customer-requests":
      return {
        items: [
          {
            id: "req_1042",
            type: "retirada",
            customer_code: "BTG",
            description: "Pedido 1042",
            status: "open",
            stock_reservation_status: "reserved",
            created_at: new Date(AGORA - 25 * 60_000).toISOString(),
            items: [{ sku_code: "BTG-000001", quantity: 12 }],
          },
        ],
      };
    case "/api/skus":
      return { items: [{ sku_code: "BTG-000001", cod_cliente: "A.01.0806.005.GG", produto: "Polo Masculino Piquet Preto", tamanho: "GG", estoque_atual: 12, customer_code: "BTG" }] };
    case "/api/stock-balances":
      return { items: [{ sku_code: "BTG-000001", location_id: "B-02", qty_on_hand: 12, customer_code: "BTG" }] };
    case "/api/stock-alerts":
      return {
        items: [
          {
            id: "alerta_1",
            customer_code: "BTG",
            status: "proposta",
            regra: { parado_dias: 90, sem_giro_dias: 180 },
            itens: [{ sku_code: "BTG-000001", product_name: "Polo Masculino Piquet Preto", saldo: 12, ultima_movimentacao: "2026-06-01T12:00:00.000Z", dias_parado: 146 }],
          },
        ],
      };
    case "/api/warehouse/boxes":
      return { items: [], has_more: false };
    default:
      return { items: [] };
  }
}

async function servir(entrada: RequestInfo | URL) {
  const url = new URL(String(entrada), "http://localhost");
  estado.leituras.push(url.pathname);
  await new Promise((pronto) => setTimeout(pronto, estado.atrasoMs));
  const corpo = estado.falha ? { message: "Sem resposta do servidor.", code: "sem_resposta" } : dados(url.pathname);
  const status = estado.falha ? 503 : 200;
  return { ok: status === 200, status, json: async () => corpo, text: async () => JSON.stringify(corpo) };
}

type Tela = {
  nome: string;
  Tela: ComponentType;
  objeto: string;
  /** O intervalo da releitura automática da tela. */
  intervaloMs: number;
  /** Os textos do cabeçalho com a lista lida (a trava contra legenda). */
  cabecalho: string[];
  /** Tem o Atualizar (o Alertas não tem). */
  atualizar: boolean;
};

const TELAS: Tela[] = [
  { nome: "Pedidos", Tela: Pedidos, objeto: "pedidos", intervaloMs: 60_000, cabecalho: ["Pedidos", "Atualizado às 10:42", "Em aberto · 2", "Entregues", "Atualizar"], atualizar: true },
  {
    nome: "Receber",
    Tela: Receber,
    objeto: "chegadas",
    intervaloMs: 60_000,
    cabecalho: ["Receber", "Atualizado às 10:42", "Em aberto · 1", "Recebidos", "Cancelados", "Chegada avulsa", "Atualizar"],
    atualizar: true,
  },
  { nome: "Estoque", Tela: Estoque, objeto: "estoque", intervaloMs: 120_000, cabecalho: ["Estoque · BTG Pactual", "Atualizado às 10:42", "Contagem", "Atualizar", "Itens · 1", "Histórico"], atualizar: true },
  { nome: "Estoque › Alertas", Tela: EstoqueAlertas, objeto: "alertas", intervaloMs: 120_000, cabecalho: ["Alertas de itens parados", "Atualizado às 10:42"], atualizar: false },
];

let raiz: Root | null = null;
let container: HTMLDivElement;
let cliente: QueryClient;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AGORA);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(servir));
  estado.atrasoMs = 30;
  estado.falha = null;
  estado.leituras = [];
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

async function montar(Tela: ComponentType, conexao: EstadoDaConexao = "conectado") {
  raiz = createRoot(container);
  await act(async () => {
    raiz!.render(
      <ProvedorDaConexao value={conexaoEm(conexao)}>
        <QueryClientProvider client={cliente}>
          <Anunciador />
          <Tela />
        </QueryClientProvider>
      </ProvedorDaConexao>,
    );
  });
}

const cabecalho = () => container.querySelector("header")!;
const linha = () => cabecalho().querySelector<HTMLElement>("[data-linha-de-estado]");
/** O texto que se vê na linha: só a camada atual, sem nada do que sai (também o texto que sai dentro dela). */
function naLinha(): string {
  const atual = linha()?.querySelector<HTMLElement>(":scope > [data-camada]:not([data-sai])");
  if (!atual) return "";
  const copia = atual.cloneNode(true) as HTMLElement;
  copia.querySelectorAll("[data-sai]").forEach((sai) => sai.remove());
  return (copia.textContent ?? "").replace(/\s+/g, " ").trim();
}
/** O Atualizar, pelo nome (o texto só para o leitor de tela). */
const atualizar = () => Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((botao) => botao.textContent?.trim() === "Atualizar") ?? null;
const regiao = () => container.querySelector("[data-anunciador]")!;
/**
 * O cabeçalho para o axe, sem as abas do Estoque: o aria-controls delas
 * aponta para um painel que a tela não desenha desde antes desta parte (a
 * pendência registrada na parte 7a), e não é da linha de estado.
 */
function semAbas(): string {
  const copia = cabecalho().cloneNode(true) as HTMLElement;
  copia.querySelectorAll('[role="tablist"]').forEach((abas) => abas.remove());
  return copia.outerHTML;
}

describe.each(TELAS)("$nome: a linha de estado sob o título", ({ Tela, objeto, intervaloMs, cabecalho: textos, atualizar: temAtualizar }) => {
  it(`a primeira leitura: aos 300 ms, Carregando ${objeto}… sob o título, e nenhum 0 nem Nenhum antes de ler; depois, a hora`, async () => {
    estado.atrasoMs = 2_000;
    await montar(Tela);
    await passar(250);
    expect(linha(), "a linha fica reservada desde o começo").not.toBeNull();
    expect(naLinha()).toBe("");
    await passar(60);
    expect(naLinha()).toBe(`Carregando ${objeto}…`);
    expect(regiao().textContent).toBe(`Carregando ${objeto}`);
    // Só a linha diz: nada de "Carregando..." no lugar da lista, nem "0" ou "Nenhum…".
    const corpo = container.textContent ?? "";
    expect(corpo.match(/Carregando/g)?.length).toBe(2);
    expect(corpo).not.toMatch(/Nenhum|Nenhuma|\b0\b/);
    if (temAtualizar) {
      expect(atualizar()!.getAttribute("aria-disabled")).toBe("true");
      expect(atualizar()!.hasAttribute("disabled")).toBe(false);
    }
    await passar(1_800);
    expect(naLinha()).toBe("Atualizado às 10:42");
    // "Carregando…" sai em 180 ms, como o indicador, e deixa a árvore quando a hora acabou de entrar; depois, só os
    // textos do cabeçalho lido.
    await passar(CARREGANDO.saidaMs + CARREGANDO.trocaEntraMs);
    expect(textosForaDaLista(cabecalho().outerHTML, textos)).toEqual([]);
  });

  /** A releitura automática da tela (o intervalo dela), com o servidor a 1,5 s; `olhar` a cada 250 ms. */
  async function releituraAutomatica(olhar: (t: number) => void) {
    await montar(Tela);
    await passar(500);
    estado.atrasoMs = 1_500;
    const lidas = estado.leituras.length;
    for (let t = 0; t < intervaloMs + 2_000; t += 250) {
      await passar(250);
      olhar(t);
    }
    // A tela releu sozinha.
    expect(estado.leituras.length).toBeGreaterThan(lidas);
  }

  it("a releitura automática não mostra nada na linha; no fim, só a hora nova", async () => {
    const vistos = new Set<string>();
    await releituraAutomatica(() => vistos.add(naLinha()));
    expect([...vistos].every((texto) => /^Atualizado às \d\d:\d\d$/.test(texto)), [...vistos].join(" | ")).toBe(true);
    expect(naLinha()).toBe(`Atualizado às 10:${String(42 + Math.floor((intervaloMs + 2_500) / 60_000)).padStart(2, "0")}`);
  }, 30_000);

  it("a releitura automática não fala nem mexe na região viva, e a linha só troca a hora", async () => {
    const mudancas: MutationRecord[] = [];
    const observador = new MutationObserver((registros) => mudancas.push(...registros));
    let observando = false;
    await releituraAutomatica(() => {
      if (observando) return;
      observando = true;
      // A linha lida, sob o título, antes da releitura.
      expect(naLinha()).toBe("Atualizado às 10:42");
      observador.observe(regiao(), { subtree: true, childList: true, characterData: true, attributes: true });
    });
    observador.disconnect();
    expect(mudancas).toEqual([]);
    expect(naLinha()).toMatch(/^Atualizado às \d\d:\d\d$/);
  }, 30_000);

  if (temAtualizar) {
    it("o Atualizar fica parado na releitura automática: não gira, não se desabilita e não fica ocupado", async () => {
      const vistos = new Set<string>();
      await releituraAutomatica(() => {
        const botao = atualizar();
        if (!botao) {
          vistos.add("sem o Atualizar");
          return;
        }
        if (botao.querySelector("[data-spinner], .animate-spin")) vistos.add("girando");
        if (botao.hasAttribute("disabled")) vistos.add("disabled");
        if (botao.hasAttribute("aria-disabled")) vistos.add("aria-disabled");
        if (botao.hasAttribute("aria-busy")) vistos.add("aria-busy");
      });
      expect([...vistos]).toEqual([]);
    }, 30_000);
  }

  it.each(["reconectando", "sem-conexao"] as const)("a falta com a lista lida fica na linha (%s), e nada entra entre o título e a lista", async (conexao) => {
    await montar(Tela, conexao);
    await passar(500);
    const lista = cabecalho().nextElementSibling;
    estado.falha = "sem_resposta";
    vi.setSystemTime(AGORA + 3 * 60_000);
    await act(async () => {
      void cliente.refetchQueries({ type: "active" });
    });
    await passar(200);
    expect(naLinha()).toBe(conexao === "reconectando" ? "Reconectando…· lista de 10:42Tentar de novo" : "Sem conexão · lista de 10:42Tentar de novo");
    expect(container.querySelector("main [data-falta], [data-falta]"), "sem a faixa que empurra a lista").toBeNull();
    expect(cabecalho().nextElementSibling).toBe(lista);
    expect(regiao().textContent).not.toContain("Reconectando");
    // A hora que saiu deixa a árvore quando a falta acabou de entrar.
    await passar(CARREGANDO.trocaSaiMs + CARREGANDO.trocaEntraMs);
    const html = semAbas();
    const permitidos = [...textos.filter((texto) => !texto.startsWith("Atualizado")), "Reconectando…", "· lista de 10:42", "Sem conexão · lista de 10:42", "Tentar de novo"];
    expect(textosForaDaLista(html, permitidos)).toEqual([]);
    vi.useRealTimers();
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("a volta do app ao primeiro plano relê com a barra no topo do primeiro cartão, até a leitura voltar", async () => {
    let visivel: DocumentVisibilityState = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visivel });
    onTestFinished(() => {
      delete (document as unknown as Record<string, unknown>).visibilityState;
    });
    await montar(Tela);
    await passar(500);
    estado.atrasoMs = 1_500;
    const lidas = estado.leituras.length;
    visivel = "hidden";
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    await passar(1_000);
    expect(estado.leituras.length).toBe(lidas);
    visivel = "visible";
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    await passar(250);
    expect(container.querySelector('[data-barra][data-lugar="topo"]')).toBeNull();
    await passar(100);
    expect(estado.leituras.length).toBeGreaterThan(lidas);
    const barra = container.querySelector('[data-barra][data-lugar="topo"]');
    expect(barra, "a barra do topo").not.toBeNull();
    // Dentro do primeiro cartão da lista, decorativa, e só ela: o Atualizar não gira.
    expect(barra!.getAttribute("aria-hidden")).toBe("true");
    expect(barra!.closest(".overflow-hidden"), "recortada no raio do cartão").not.toBeNull();
    expect(container.querySelectorAll('[data-barra][data-lugar="topo"]')).toHaveLength(1);
    if (temAtualizar) expect(atualizar()!.querySelector("[data-spinner]")).toBeNull();
    expect(naLinha()).toBe("Atualizado às 10:42");
    // No fim, a barra completa em tinta e esmaece (momento 7), e então sai.
    await passar(1_250);
    expect(container.querySelector('[data-barra][data-lugar="topo"]')?.getAttribute("data-estado")).toBe("fim");
    await passar(400);
    expect(container.querySelector('[data-barra][data-lugar="topo"]')).toBeNull();
  });

  it("o Tentar de novo da demora recomeça a lista e deixa seguir o que a tela lê além dela: nenhuma leitura fica parada sem dado", async () => {
    estado.atrasoMs = 12_000;
    await montar(Tela);
    for (let t = 0; t < 10_200; t += 300) await passar(300);
    expect(naLinha()).toBe("Demorando mais que o normalTentar de novo");
    const tentar = Array.from(linha()!.querySelectorAll<HTMLButtonElement>(".linha-de-estado-tentar")).find((botao) => !botao.closest("[data-sai]"))!;
    await act(async () => tentar.click());
    for (let t = 0; t < 26_000; t += 500) await passar(500);
    // Toda leitura da tela leu (ou ainda lê, de verdade): nenhuma cancelada e esquecida, sem dado e sem ler.
    const paradas = cliente
      .getQueryCache()
      .getAll()
      .filter((consulta) => !consulta.isDisabled() && consulta.state.data === undefined && consulta.state.fetchStatus === "idle" && consulta.state.status === "pending")
      .map((consulta) => JSON.stringify(consulta.queryKey));
    expect(paradas).toEqual([]);
    expect(naLinha()).toMatch(/^Atualizado às \d\d:\d\d$/);
  }, 30_000);

  it("o cabeçalho passa no axe, lido e carregando, com a linha de estado sob o título", async () => {
    estado.atrasoMs = 2_000;
    await montar(Tela);
    await passar(400);
    expect(naLinha()).toBe(`Carregando ${objeto}…`);
    const carregando = semAbas();
    await passar(2_000);
    expect(naLinha()).toBe("Atualizado às 10:42");
    const lido = semAbas();
    vi.useRealTimers();
    expect(await violacoesDeAcessibilidade(carregando)).toEqual([]);
    expect(await violacoesDeAcessibilidade(lido)).toEqual([]);
  });
});

describe("o Atualizar das listas", () => {
  it.each(TELAS.filter((tela) => tela.atualizar))("$nome: 44 × 44 no celular, e o toque relê a lista", async ({ Tela }) => {
    await montar(Tela);
    await passar(500);
    const botao = atualizar()!;
    expect(botao.className).toMatch(/\bmax-md:size-11\b/);
    const lidas = estado.leituras.length;
    await act(async () => botao.click());
    await passar(100);
    expect(estado.leituras.length).toBeGreaterThan(lidas);
  });
});
