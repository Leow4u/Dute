// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Anunciador } from "@/lib/carregando/anunciador";
import { lerContagens } from "@/lib/carregando/contagem-lembrada";
import { ProvedorDaConexao } from "@/lib/carregando/estado-da-conexao";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { conexaoEm } from "@/test/conexao";
import { textosDaTela } from "@/test/textos";

/**
 * Trocar o cliente no Receber (carregamento v2, momento 7, caso 4; parte 10,
 * que a parte 8 deixou para cá): os avisos de envio do cliente novo são lidos
 * no servidor. Antes, os avisos do cliente anterior sumiam na hora, "Para
 * conferir" contava sem eles e a linha dizia "Carregando chegadas…". Agora a
 * lista anterior fica, a 50%, `inert` e com `aria-busy`, com a barra no topo
 * do primeiro cartão; a linha de estado continua com a hora e, aos 5 s, diz
 * "Atualizando…". Dados sintéticos.
 */

const cliente = vi.hoisted(() => {
  let atual = "BTG";
  const ouvintes = new Set<() => void>();
  return {
    atual: () => atual,
    trocar(codigo: string) {
      atual = codigo;
      ouvintes.forEach((ouvir) => ouvir());
    },
    ouvir(ouvir: () => void) {
      ouvintes.add(ouvir);
      return () => {
        ouvintes.delete(ouvir);
      };
    },
  };
});
const estado = vi.hoisted(() => ({ atrasoDosAvisos: 30, avisosQueFalham: new Set<string>() }));

vi.mock("@/lib/auth", () => ({ useAppUser: () => ({ user: { publicMetadata: { role: "admin" } } }) }));
vi.mock("@/lib/active-customer-context", async () => {
  const { useSyncExternalStore } = await vi.importActual<typeof import("react")>("react");
  const { activeCustomerOptions } = await vi.importActual<typeof import("@/lib/active-customer")>("@/lib/active-customer");
  const options = activeCustomerOptions([
    { customer_code: "BTG", name: "BTG Pactual", operation_template: "uniformes", sku_prefix: "BTG" },
    { customer_code: "ITAU", name: "Itaú", operation_template: "uniformes", sku_prefix: "ITA" },
  ] as never);
  return {
    useActiveCustomer: () => {
      const code = useSyncExternalStore(cliente.ouvir, cliente.atual);
      const active = options.find((opcao) => opcao.code === code)!;
      return { active, code, options, setCode: cliente.trocar, isLoading: false, codeProvavel: code };
    },
  };
});
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));
vi.mock("@/hooks/use-desktop", () => ({ useIsDesktop: () => true }));
vi.mock("@/lib/operacao/leitura", () => ({
  useLeitura: () => ({ itens: [], erro: false }),
  useDocumento: () => ({ item: undefined, erro: false }),
}));

import Receber from "./receber";

// 13:42 UTC são 10:42 no armazém (America/Sao_Paulo).
const AGORA = Date.parse("2026-11-13T13:42:00Z");

function avisos(codigo: string) {
  return {
    items: [
      {
        id: `req_${codigo}`,
        type: "recebimento",
        status: "open",
        customer_code: codigo,
        request_number: `AV-${codigo}-1`,
        supplier: codigo === "BTG" ? "Malharia Sul" : "Fornecedor Itaú",
        invoice_number: "9000",
        items: [{ sku_code: "BTG-000001", quantity: 10 }],
      },
    ],
  };
}

async function servir(entrada: RequestInfo | URL) {
  const url = new URL(String(entrada), "http://localhost");
  const avisosDoCliente = url.pathname === "/api/customer-requests";
  await new Promise((pronto) => setTimeout(pronto, avisosDoCliente ? estado.atrasoDosAvisos : 30));
  if (avisosDoCliente && estado.avisosQueFalham.has(url.searchParams.get("customer_code") ?? "")) {
    const erro = { message: "Falha interna no servidor." };
    return { ok: false, status: 500, json: async () => erro, text: async () => JSON.stringify(erro) };
  }
  const corpo = avisosDoCliente
    ? avisos(url.searchParams.get("customer_code") ?? "")
    : url.pathname === "/api/warehouse/ops"
      ? { alerts: [], queues: { receiving: { key: "receiving", tasks: [{ id: "inb_4410", reference: "inb_4410", title: "NF 4410 · Confecções Sul", status: "planned", can_advance: true, exception_count: 0, customer_code: "BTG", items: [] }] } } }
      : { items: [] };
  return { ok: true, status: 200, json: async () => corpo, text: async () => JSON.stringify(corpo) };
}

let raiz: Root | null = null;
let container: HTMLDivElement;
let consultas: QueryClient;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AGORA);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(servir));
  window.localStorage.clear();
  cliente.trocar("BTG");
  estado.atrasoDosAvisos = 30;
  estado.avisosQueFalham = new Set();
  container = document.createElement("div");
  document.body.append(container);
  consultas = new QueryClient({ defaultOptions: { queries: { retry: false, networkMode: "always", refetchOnWindowFocus: false } } });
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  container.remove();
  consultas.clear();
  window.localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function passar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function montar() {
  raiz = createRoot(container);
  await act(async () => {
    raiz!.render(
      <ProvedorDaConexao value={conexaoEm("conectado")}>
        <QueryClientProvider client={consultas}>
          <Anunciador />
          <Receber />
        </QueryClientProvider>
      </ProvedorDaConexao>,
    );
  });
}

const linha = () => container.querySelector<HTMLElement>("header [data-linha-de-estado]")!;
function naLinha(): string {
  const atual = linha().querySelector<HTMLElement>(":scope > [data-camada]:not([data-sai])");
  if (!atual) return "";
  const copia = atual.cloneNode(true) as HTMLElement;
  copia.querySelectorAll("[data-sai]").forEach((sai) => sai.remove());
  return textosDaTela(copia.outerHTML).join(" ");
}
const listaEmTroca = () => container.querySelector<HTMLElement>('[data-lista-em-troca][aria-busy="true"][inert]');
const regiao = () => container.querySelector("[data-anunciador]")!;

describe("Receber: trocar o cliente mantém a lista anterior", () => {
  it("os avisos do cliente anterior ficam, aria-busy e inert, com a barra no topo; aos 5 s, Atualizando…; na chegada, os do novo", async () => {
    await montar();
    await passar(500);
    expect(container.textContent).toContain("AV-BTG-1 · Malharia Sul");
    expect(naLinha()).toBe("Atualizado às 10:42");
    const antes = container.innerHTML;
    const falado = regiao().textContent;

    estado.atrasoDosAvisos = 7_000;
    vi.setSystemTime(AGORA + 60_000);
    await act(async () => cliente.trocar("ITAU"));
    await passar(50);
    // A lista anterior fica, ocupada e sem toque; nada de "Carregando chegadas…", nem os avisos sumindo.
    expect(listaEmTroca(), "a lista anterior, aria-busy e inert").not.toBeNull();
    expect(listaEmTroca()!.textContent).toContain("AV-BTG-1 · Malharia Sul");
    expect(naLinha()).toBe("Atualizado às 10:42");
    await passar(300);
    expect(container.querySelector('.carregando-barra[data-lugar="topo"]')).not.toBeNull();
    const naTroca = container.innerHTML;
    // A contagem lembrada do cliente novo não é gravada com os avisos do anterior.
    expect(lerContagens("receber", "ITAU")).toBeNull();

    await passar(4_700);
    expect(naLinha()).toBe("Atualizando…");
    // A troca não fala: só a primeira leitura da tela diz "Carregando chegadas".
    expect(regiao().textContent).toBe(falado);

    await passar(2_100);
    expect(listaEmTroca()).toBeNull();
    expect(container.textContent).toContain("AV-ITAU-1 · Fornecedor Itaú");
    expect(container.textContent).not.toContain("AV-BTG-1");
    expect(naLinha()).toBe("Atualizado às 10:43");
    expect(lerContagens("receber", "ITAU")).toEqual(expect.objectContaining({ conferir: 2 }));

    vi.useRealTimers();
    const violacoesAntes = await violacoesDeAcessibilidade(antes);
    expect((await violacoesDeAcessibilidade(naTroca)).filter((violacao) => !violacoesAntes.includes(violacao))).toEqual([]);
  });
});

describe("Receber: a revisão da troca de cliente", () => {
  const botao = (texto: string) =>
    Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.textContent?.replace(/\s+/g, " ").trim() === texto);
  // Só a chegada do armazém tem "Conferir" (o aviso tem "Ver").
  const conferirDaChegada = () => botao("Conferir");

  it("na troca, só os avisos do cliente anterior ficam inert; a chegada do armazém, que a troca não relê, segue com o toque", async () => {
    await montar();
    await passar(500);
    estado.atrasoDosAvisos = 4_000;
    await act(async () => cliente.trocar("ITAU"));
    await passar(300);
    expect(listaEmTroca()!.textContent).toContain("AV-BTG-1 · Malharia Sul");
    expect(listaEmTroca()!.textContent).not.toContain("NF 4410");
    const conferir = conferirDaChegada();
    expect(conferir).toBeDefined();
    expect(conferir!.closest("[inert]")).toBeNull();
    await passar(4_000);
    expect(listaEmTroca()).toBeNull();
  });

  it("a troca que falha mostra o aviso no lugar da lista, nunca o vazio; a nova tentativa segue com o aviso, e os avisos do novo chegam", async () => {
    await montar();
    await passar(500);
    estado.avisosQueFalham.add("ITAU");
    await act(async () => cliente.trocar("ITAU"));
    await passar(200);
    expect(container.textContent).toContain("Não consegui carregar as chegadas.");
    expect(botao("Tentar de novo")).toBeDefined();
    expect(container.textContent).not.toContain("AV-BTG-1");
    expect(container.textContent).not.toContain("Para conferir");
    // O "Em aberto" não conta sem os avisos: fica com o bloco, fora da árvore.
    expect(container.querySelector('[aria-label="Situação das chegadas"]')?.textContent).not.toMatch(/Em aberto\s*·?\s*\d/);
    estado.avisosQueFalham.clear();
    estado.atrasoDosAvisos = 1_000;
    const tentar = botao("Tentar de novo")!;
    tentar.focus();
    await act(async () => tentar.click());
    await passar(100);
    // Os avisos do cliente anterior não voltam por baixo: o aviso fica, ocupado e com o foco.
    expect(container.textContent).toContain("Não consegui carregar as chegadas.");
    expect(container.textContent).not.toContain("AV-BTG-1");
    expect(botao("Tentando de novo…")?.getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(botao("Tentando de novo…"));
    await passar(1_000);
    expect(container.textContent).not.toContain("Não consegui carregar as chegadas.");
    expect(container.textContent).toContain("AV-ITAU-1 · Fornecedor Itaú");
    expect(document.activeElement).toBe(linha());
  });
});
