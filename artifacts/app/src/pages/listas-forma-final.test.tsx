// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Anunciador } from "@/lib/carregando/anunciador";
import { ProvedorDaConexao } from "@/lib/carregando/estado-da-conexao";
import { CARREGANDO } from "@/lib/carregando/tempo";
import { DURACAO_DA_CHEGADA_MS } from "@/lib/carregando/use-chegada";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { conexaoEm } from "@/test/conexao";
import { textosForaDaLista } from "@/test/textos";

/**
 * As listas com a forma final (carregamento v2, momento 2, e a decisão P3 de
 * 12/11/2026; parte 8), com as telas de verdade. Antes do dado, Pedidos e
 * Receber já têm o título, o segmentado "Em aberto · ▪", o Atualizar travado e
 * os títulos reais dos grupos, com o bloco no lugar do número e os cartões na
 * altura da última contagem lida deste cliente; aos 300 ms, as linhas-fantasma
 * e "Carregando pedidos…". Nunca "0" nem "Nenhum…" antes de ler. Na chegada,
 * os números e as linhas reais, em cascata, e o resumo falado. Estoque e
 * Alertas: os filtros e as contagens sem "0" antes de ler. Dados sintéticos.
 */

const estado = vi.hoisted(() => ({
  /** O atraso de cada caminho; sem ele, o `atrasoMs`. */
  atrasoMs: 2_000,
  atrasoPorCaminho: {} as Record<string, number>,
  cliente: "BTG",
  papel: "admin",
}));

vi.mock("@/lib/auth", () => ({ useAppUser: () => ({ user: { publicMetadata: { role: estado.papel } } }) }));
vi.mock("@/lib/active-customer-context", async () => {
  const { activeCustomerOptions } = await vi.importActual<typeof import("@/lib/active-customer")>("@/lib/active-customer");
  const options = activeCustomerOptions([
    { customer_code: "BTG", name: "BTG Pactual", operation_template: "uniformes", sku_prefix: "BTG" },
    { customer_code: "ACME", name: "Acme Uniformes", operation_template: "uniformes", sku_prefix: "ACM" },
  ] as never);
  return {
    useActiveCustomer: () => {
      const active = options.find((opcao) => opcao.code === estado.cliente) ?? options[0];
      return { active, code: active.code, options, setCode: () => undefined, isLoading: false };
    },
  };
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

function solicitacao(numero: string, unidades: number) {
  return {
    id: `req_${numero}`,
    type: "retirada",
    customer_code: "BTG",
    description: `Pedido ${numero}`,
    status: "open",
    stock_reservation_status: "reserved",
    created_at: new Date(AGORA - 25 * 60_000).toISOString(),
    items: [{ sku_code: "BTG-000001", quantity: unidades }],
  };
}

function tarefa(id: string, titulo: string, status = "planned") {
  return { id, reference: id, title: titulo, status, can_advance: true, exception_count: 0, customer_code: "BTG", items: [] };
}

function dados(caminho: string): unknown {
  switch (caminho) {
    case "/api/warehouse/ops":
      return {
        alerts: [],
        queues: {
          picking: { key: "picking", tasks: [tarefa("pick_ord_1039", "PED-1039"), tarefa("pick_ord_1040", "PED-1040")] },
          expedition: { key: "expedition", tasks: [tarefa("ship_ord_1036", "PED-1036", "ready_to_dispatch")] },
          receiving: { key: "receiving", tasks: [tarefa("inb_4410", "NF 4410 · Confecções Sul"), tarefa("inb_4411", "NF 4411 · Confecções Sul")] },
          putaway: { key: "putaway", tasks: [tarefa("put_4409", "Guarda NF 4409")] },
        },
      };
    case "/api/customer-requests":
      return { items: [solicitacao("1042", 12), solicitacao("1043", 40), solicitacao("1045", 120)] };
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
    default:
      return { items: [] };
  }
}

async function servir(entrada: RequestInfo | URL) {
  const url = new URL(String(entrada), "http://localhost");
  await new Promise((pronto) => setTimeout(pronto, estado.atrasoPorCaminho[url.pathname] ?? estado.atrasoMs));
  const corpo = dados(url.pathname);
  return { ok: true, status: 200, json: async () => corpo, text: async () => JSON.stringify(corpo) };
}

let raiz: Root | null = null;
let container: HTMLDivElement;
let cliente: QueryClient;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AGORA);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(servir));
  estado.atrasoMs = 2_000;
  estado.atrasoPorCaminho = {};
  estado.cliente = "BTG";
  estado.papel = "admin";
  window.localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  cliente = new QueryClient({ defaultOptions: { queries: { retry: false, networkMode: "always", refetchOnWindowFocus: false } } });
});

afterEach(() => {
  desmontar();
  container.remove();
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function desmontar() {
  act(() => raiz?.unmount());
  raiz = null;
  cliente.clear();
}

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
          <Anunciador />
          <Tela />
        </QueryClientProvider>
      </ProvedorDaConexao>,
    );
  });
}

/** O texto que fica na árvore de acessibilidade: sem o que é aria-hidden. */
function naArvore(elemento: Element): string {
  const copia = elemento.cloneNode(true) as Element;
  copia.querySelectorAll('[aria-hidden="true"]').forEach((escondido) => escondido.remove());
  return (copia.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** O que se vê na tela, sem a região viva (só para o leitor de tela). */
function naTela(): string {
  const copia = container.cloneNode(true) as HTMLElement;
  copia.querySelector("[data-anunciador]")?.remove();
  return (copia.textContent ?? "").replace(/\s+/g, " ");
}

const grupos = () => [...container.querySelectorAll("section")].filter((secao) => secao.querySelector(":scope > h2"));
/** O título de cada grupo, como o leitor de tela o lê: antes do dado, o título inteiro é só o nome. */
const titulos = () => grupos().map((grupo) => naArvore(grupo.querySelector("h2")!.children[0]!));
const titulosInteiros = () => grupos().map((grupo) => naArvore(grupo.querySelector("h2")!));
/** O número de cada grupo (o segundo pedaço do título), como o leitor de tela o lê. */
const numeros = () => grupos().map((grupo) => naArvore(grupo.querySelector("h2")!.children[1]!));
const fantasmasPorGrupo = () => grupos().map((grupo) => grupo.querySelectorAll("[data-linha-fantasma]").length);
const linha = () => container.querySelector<HTMLElement>("[data-linha-de-estado]")!;
const regiao = () => container.querySelector("[data-anunciador]")!;
const lista = () => container.querySelector<HTMLElement>("[aria-busy='true']:not(button)");
const segmento = () => container.querySelector<HTMLButtonElement>('[role="group"] button')!;
const atualizar = () => Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((botao) => botao.textContent?.trim() === "Atualizar")!;

type Tela = {
  nome: string;
  Tela: ComponentType;
  objeto: string;
  lista: string;
  titulos: string[];
  numeros: string[];
  emAberto: string;
  resumo: string;
  /** A cascata da chegada: a posição da primeira linha de cada grupo. */
  cascata: string[];
  /** A contagem que a primeira leitura guarda. */
  lembrada: Record<string, number>;
};

const TELAS: Tela[] = [
  {
    nome: "Pedidos",
    Tela: Pedidos,
    objeto: "pedidos",
    lista: "pedidos",
    titulos: ["Para aprovar", "Para separar", "Para entregar"],
    numeros: ["3", "2", "1"],
    emAberto: "Em aberto · 6",
    resumo: "3 para aprovar, 2 para separar, 1 para entregar",
    cascata: ["0", "3", "5"],
    lembrada: { aprovar: 3, separar: 2, entregar: 1, entregues: 0 },
  },
  {
    nome: "Receber",
    Tela: Receber,
    objeto: "chegadas",
    lista: "receber",
    titulos: ["Para conferir", "Para guardar"],
    numeros: ["2", "1"],
    emAberto: "Em aberto · 3",
    resumo: "2 para conferir, 1 para guardar",
    cascata: ["0", "2"],
    lembrada: { conferir: 2, guardando: 0, guardar: 1, chegadas: 0, guardas: 0, cancelados: 0 },
  },
];

describe.each(TELAS)("$nome com a forma final na primeira leitura", (tela) => {
  it("antes do dado, desde 0 ms: os títulos reais com o bloco no lugar do número, o segmentado com o bloco, o Atualizar travado e os cartões na altura; nenhum 0 nem Nenhum", async () => {
    await montar(tela.Tela);
    expect(titulosInteiros()).toEqual(tela.titulos);
    // O número que ainda não chegou é o bloco, fora da árvore: o título diz só o nome.
    expect(numeros()).toEqual(tela.titulos.map(() => ""));
    for (const grupo of grupos()) expect(grupo.querySelector('h2 [data-esqueleto][data-forma="contagem"]')?.getAttribute("aria-hidden")).toBe("true");
    expect(naArvore(segmento())).toBe("Em aberto");
    expect(segmento().querySelector('[data-esqueleto][data-forma="contagem"]')?.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(atualizar().getAttribute("aria-disabled")).toBe("true");
    expect(atualizar().hasAttribute("disabled")).toBe(false);
    expect(naTela()).not.toMatch(/Nenhum|Nenhuma|Nada para|\b0\b/);
    // Os cartões já guardam a altura: as linhas-fantasma estão lá, invisíveis e fora da árvore, duas por grupo sem lembrança.
    expect(fantasmasPorGrupo()).toEqual(tela.titulos.map(() => 2));
    const cartoes = [...container.querySelectorAll("[data-fantasmas]")];
    expect(cartoes.every((cartao) => cartao.getAttribute("aria-hidden") === "true" && !cartao.hasAttribute("data-visivel"))).toBe(true);
    // A lista está ocupada, descrita pela linha de estado.
    expect(lista()?.getAttribute("aria-describedby")).toBe(linha().id);
    expect(linha().id).not.toBe("");
  });

  it(`aos 300 ms: as linhas-fantasma entram, com o brilho, e a linha de estado diz Carregando ${tela.objeto}…, com o anúncio`, async () => {
    await montar(tela.Tela);
    await passar(CARREGANDO.atrasoMs + 10);
    expect([...container.querySelectorAll("[data-fantasmas]")].every((cartao) => cartao.hasAttribute("data-visivel") && cartao.hasAttribute("data-brilho"))).toBe(true);
    expect(naArvore(linha())).toBe(`Carregando ${tela.objeto}…`);
    expect(naArvore(document.getElementById(lista()!.getAttribute("aria-describedby")!)!)).toBe(`Carregando ${tela.objeto}…`);
    expect(regiao().textContent).toBe(`Carregando ${tela.objeto}`);
    expect(titulos()).toEqual(tela.titulos);
    expect(naTela()).not.toMatch(/Nenhum|Nenhuma|Nada para|\b0\b/);
  });

  it("na chegada: os números, as linhas reais em cascata no lugar dos fantasmas, a lista livre e o resumo falado depois de Carregando", async () => {
    await montar(tela.Tela);
    await passar(CARREGANDO.atrasoMs + 10);
    await passar(2_000 - CARREGANDO.atrasoMs);
    expect(numeros()).toEqual(tela.numeros);
    expect(segmento().textContent).toBe(tela.emAberto);
    expect(container.querySelector("[data-fantasmas], [data-linha-fantasma]")).toBeNull();
    expect(lista()).toBeNull();
    // As linhas reais entram em cascata: cada grupo a partir da posição da primeira linha dele.
    const chegando = [...container.querySelectorAll<HTMLElement>("[data-chegada]")];
    expect(chegando.map((elemento) => elemento.style.getPropertyValue("--chegada-desde"))).toEqual(tela.cascata);
    await passar(DURACAO_DA_CHEGADA_MS);
    expect(container.querySelector("[data-chegada]")).toBeNull();
    // O resumo espera os 2 s do anúncio de Carregando.
    await passar(500);
    expect(regiao().textContent).toBe(tela.resumo);
  });

  it("a leitura que chega antes dos 300 ms não fala nada, nem o resumo", async () => {
    estado.atrasoMs = 100;
    await montar(tela.Tela);
    await passar(3_000);
    expect(numeros()).toEqual(tela.numeros);
    expect(regiao().textContent).toBe("");
  });

  it("a contagem lembrada é do cliente ativo: a da última leitura reserva a altura (de 1 a 5 linhas); outro cliente, duas por grupo", async () => {
    estado.atrasoMs = 30;
    await montar(tela.Tela);
    await passar(500);
    expect(JSON.parse(window.localStorage.getItem(`dute:contagem-lembrada:${tela.lista}:BTG`) ?? "null")).toEqual(tela.lembrada);
    desmontar();
    estado.atrasoMs = 2_000;
    await montar(tela.Tela);
    expect(fantasmasPorGrupo()).toEqual(tela.numeros.map(Number));
    desmontar();
    // Outro cliente, sem lembrança: duas por grupo; e a lembrança da BTG fica com a BTG.
    estado.cliente = "ACME";
    await montar(tela.Tela);
    expect(fantasmasPorGrupo()).toEqual(tela.titulos.map(() => 2));
    desmontar();
    // A contagem guardada só dimensiona, entre 1 e 5, e nunca aparece como número.
    estado.cliente = "BTG";
    window.localStorage.setItem(`dute:contagem-lembrada:${tela.lista}:BTG`, JSON.stringify(Object.fromEntries(Object.keys(tela.lembrada).map((grupo, indice) => [grupo, indice % 2 ? 0 : 40]))));
    await montar(tela.Tela);
    expect(fantasmasPorGrupo().every((linhas) => linhas === 1 || linhas === 5)).toBe(true);
    expect(naTela()).not.toMatch(/\b40\b|\b0\b/);
  });

  it("sem o armazenamento do aparelho, a lista abre com duas linhas por grupo e lê do mesmo jeito", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("bloqueado", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("bloqueado", "SecurityError");
    });
    await montar(tela.Tela);
    expect(fantasmasPorGrupo()).toEqual(tela.titulos.map(() => 2));
    await passar(2_500);
    expect(numeros()).toEqual(tela.numeros);
  });

  it("o aviso de 10 s é falado uma vez", async () => {
    estado.atrasoMs = 30_000;
    const falas: string[] = [];
    await montar(tela.Tela);
    const observador = new MutationObserver(() => falas.push(regiao().textContent ?? ""));
    observador.observe(regiao(), { subtree: true, childList: true, characterData: true });
    for (let t = 0; t < 20_000; t += 500) await passar(500);
    observador.disconnect();
    expect(falas.filter((fala) => fala === "Demorando mais que o normal")).toHaveLength(1);
    expect(titulos()).toEqual(tela.titulos);
    expect(naTela()).not.toMatch(/Nenhum|Nenhuma|Nada para|\b0\b/);
  }, 20_000);

  it("só rótulos e passa no axe: antes do dado, com os fantasmas e depois", async () => {
    await montar(tela.Tela);
    const aos0 = container.innerHTML;
    await passar(CARREGANDO.atrasoMs + 10);
    const aos300 = container.innerHTML;
    const permitidos = ["Pedidos", "Receber", `Carregando ${tela.objeto}…`, `Carregando ${tela.objeto}`, "Em aberto", "·", "Entregues", "Recebidos", "Cancelados", "Chegada avulsa", "Atualizar", ...tela.titulos];
    expect(textosForaDaLista(aos0, permitidos)).toEqual([]);
    expect(textosForaDaLista(aos300, permitidos)).toEqual([]);
    await passar(2_500);
    const lida = container.innerHTML;
    vi.useRealTimers();
    expect(await violacoesDeAcessibilidade(aos0)).toEqual([]);
    expect(await violacoesDeAcessibilidade(aos300)).toEqual([]);
    expect(await violacoesDeAcessibilidade(lida)).toEqual([]);
  });
});

describe("Receber: o grupo que só aparece com linha", () => {
  it("Recebidas, por guardar entra na primeira leitura só se a última leitura deste cliente tinha alguma", async () => {
    await montar(Receber);
    expect(titulos()).toEqual(["Para conferir", "Para guardar"]);
    desmontar();
    window.localStorage.setItem("dute:contagem-lembrada:receber:BTG", JSON.stringify({ conferir: 1, guardando: 2, guardar: 1 }));
    await montar(Receber);
    expect(titulos()).toEqual(["Para conferir", "Recebidas, por guardar", "Para guardar"]);
    expect(fantasmasPorGrupo()).toEqual([1, 2, 1]);
    // Sem linha na leitura, ele sai.
    await passar(2_500);
    expect(titulos()).toEqual(["Para conferir", "Para guardar"]);
  });
});

describe("Estoque e Alertas: os filtros e as contagens não mostram 0 antes de ler", () => {
  it("Estoque com o catálogo antes dos saldos: os filtros sem número e Itens sem contagem até ler tudo; depois, os números", async () => {
    estado.atrasoMs = 100;
    estado.atrasoPorCaminho = { "/api/stock-balances": 3_000 };
    await montar(Estoque);
    const contagensDosFiltros = () => [...container.querySelectorAll("button[aria-pressed] .tabular-nums")].map((numero) => numero.textContent);
    let antes = 0;
    for (const instante of [0, 400, 1_500, 2_800]) {
      await passar(instante - antes);
      antes = instante;
      expect(contagensDosFiltros(), `aos ${instante} ms`).toEqual([]);
      expect(naTela(), `aos ${instante} ms`).not.toMatch(/Nenhum|Nenhuma|Itens · 0|\b0\b/);
    }
    await passar(500);
    expect(contagensDosFiltros().length).toBeGreaterThan(0);
  });

  it("Alertas antes de ler: nem o vazio nem as contagens dos clientes", async () => {
    await montar(EstoqueAlertas);
    let antes = 0;
    for (const instante of [0, 400, 1_500]) {
      await passar(instante - antes);
      antes = instante;
      expect(naTela(), `aos ${instante} ms`).not.toMatch(/Nenhum|Nenhuma|\b0\b/);
    }
    await passar(2_000);
    expect(naTela()).toContain("Alertas de itens parados");
  });
});
