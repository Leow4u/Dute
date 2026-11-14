// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Anunciador } from "@/lib/carregando/anunciador";
import { ProvedorDaConexao } from "@/lib/carregando/estado-da-conexao";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { conexaoEm } from "@/test/conexao";
import { textosDaTela } from "@/test/textos";

/**
 * A releitura com erro nunca apaga a lista (carregamento v2, momentos 7 e 8;
 * parte 10): nas quatro listas com a linha de estado, a lista lida fica na
 * tela quando a releitura falha por outro motivo que não a conexão, e a linha
 * diz "Não consegui atualizar · lista de 10:42", com "Tentar de novo". Antes,
 * Receber, Estoque e Alertas trocavam a lista pelo aviso de erro, e Pedidos
 * dizia "Atualizado às 10:42" como se nada tivesse falhado. Dados sintéticos.
 */

const estado = vi.hoisted(() => ({ falha: false, anuncios: [] as string[] }));

vi.mock("@/lib/auth", () => ({ useAppUser: () => ({ user: { publicMetadata: { role: "admin" } } }) }));
vi.mock("@/lib/active-customer-context", async () => {
  const { activeCustomerOptions } = await vi.importActual<typeof import("@/lib/active-customer")>("@/lib/active-customer");
  const options = activeCustomerOptions([{ customer_code: "BTG", name: "BTG Pactual", operation_template: "uniformes", sku_prefix: "BTG" }] as never);
  return { useActiveCustomer: () => ({ active: options[0], code: options[0].code, options, setCode: () => undefined, isLoading: false, codeProvavel: options[0].code }) };
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

/** As leituras da lista falham com um erro do servidor que não é a falta de conexão: a releitura não acha a lista. */
const DA_LISTA = new Set(["/api/warehouse/ops", "/api/customer-requests", "/api/skus", "/api/stock-balances", "/api/products", "/api/stock-alerts"]);

async function servir(entrada: RequestInfo | URL) {
  const url = new URL(String(entrada), "http://localhost");
  await new Promise((pronto) => setTimeout(pronto, 30));
  const falhou = estado.falha && DA_LISTA.has(url.pathname);
  const corpo = falhou ? { message: "Falha interna no servidor." } : dados(url.pathname);
  const status = falhou ? 500 : 200;
  return { ok: status === 200, status, json: async () => corpo, text: async () => JSON.stringify(corpo) };
}

type Tela = {
  nome: string;
  Tela: ComponentType;
  /** Um texto da lista lida, que precisa continuar na tela. */
  naLista: string;
  /** O intervalo da releitura automática da tela. */
  intervaloMs: number;
};

const TELAS: Tela[] = [
  { nome: "Pedidos", Tela: Pedidos, naLista: "PED-1039", intervaloMs: 60_000 },
  { nome: "Receber", Tela: Receber, naLista: "NF 4410 · Confecções Sul", intervaloMs: 60_000 },
  { nome: "Estoque", Tela: Estoque, naLista: "Polo Masculino Piquet Preto", intervaloMs: 120_000 },
  { nome: "Estoque › Alertas", Tela: EstoqueAlertas, naLista: "Polo Masculino Piquet Preto", intervaloMs: 120_000 },
];

let raiz: Root | null = null;
let container: HTMLDivElement;
let cliente: QueryClient;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AGORA);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(servir));
  estado.falha = false;
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
          <Anunciador />
          <Tela />
        </QueryClientProvider>
      </ProvedorDaConexao>,
    );
  });
}

const linha = () => container.querySelector<HTMLElement>("header [data-linha-de-estado]");
/** O texto que se vê na linha: só a camada atual, sem nada do que sai. */
function naLinha(): string {
  const atual = linha()?.querySelector<HTMLElement>(":scope > [data-camada]:not([data-sai])");
  if (!atual) return "";
  const copia = atual.cloneNode(true) as HTMLElement;
  copia.querySelectorAll("[data-sai]").forEach((sai) => sai.remove());
  return textosDaTela(copia.outerHTML).join(" ");
}
const regiao = () => container.querySelector("[data-anunciador]")!;

describe.each(TELAS)("$nome: a releitura com erro não apaga a lista", ({ Tela, naLista, intervaloMs }) => {
  it("a lista lida fica, sem o aviso de erro no lugar dela, e a linha diz Não consegui atualizar · lista de 10:42", async () => {
    await montar(Tela);
    await passar(500);
    expect(naLinha()).toBe("Atualizado às 10:42");
    expect(container.textContent).toContain(naLista);
    const falado = regiao().textContent;

    // A releitura automática da tela, dois minutos depois, falha.
    estado.falha = true;
    vi.setSystemTime(AGORA + 2 * 60_000);
    await passar(intervaloMs + 500);

    expect(container.textContent, "a lista lida fica na tela").toContain(naLista);
    expect(container.textContent).not.toMatch(/Não consegui carregar/);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(naLinha()).toBe("Não consegui atualizar · lista de 10:42 Tentar de novo");
    // A releitura automática não fala.
    expect(regiao().textContent).toBe(falado);
    // O axe no cabeçalho, sem as abas do Estoque (o aria-controls delas é de antes desta parte).
    const cabecalho = container.querySelector("header")!.cloneNode(true) as HTMLElement;
    cabecalho.querySelectorAll('[role="tablist"]').forEach((abas) => abas.remove());
    vi.useRealTimers();
    expect(await violacoesDeAcessibilidade(cabecalho.outerHTML)).toEqual([]);
  });

  it("a pessoa tenta de novo e a releitura volta: a hora nova, sem aviso", async () => {
    await montar(Tela);
    await passar(500);
    estado.falha = true;
    await passar(intervaloMs + 500);
    expect(naLinha()).toBe("Não consegui atualizar · lista de 10:42 Tentar de novo");

    estado.falha = false;
    vi.setSystemTime(AGORA + 5 * 60_000);
    const tentar = Array.from(linha()!.querySelectorAll<HTMLButtonElement>(".linha-de-estado-tentar")).find((botao) => !botao.closest("[data-sai]"))!;
    await act(async () => tentar.click());
    await passar(1_000);
    expect(naLinha()).toBe("Atualizado às 10:47");
    expect(container.textContent).toContain(naLista);
  });
});
