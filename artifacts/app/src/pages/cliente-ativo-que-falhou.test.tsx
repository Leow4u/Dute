// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

import { activeCustomerStorageKey, LEGACY_CUSTOMER_CODE } from "@/lib/active-customer";
import { Anunciador } from "@/lib/carregando/anunciador";
import { textosForaDaLista } from "@/test/textos";

/**
 * O cliente ativo é a fronteira também quando a lista dos clientes falha
 * (carregamento v2, junção das partes 10 e 13; invariante 4). A parte 13e
 * passou a dizer a falha no seletor ("Não carregou") com o `falhou`, e o
 * `isLoading` deixou de valer na falha e na nova tentativa; as telas das
 * partes 13c e 13d só esperavam o `isLoading` e liam e gravavam com o cliente
 * padrão (o `code` cai nele sem a lista), mesmo com outro escolhido no
 * aparelho: o Fechamento lia o mês e emitia, a fatura lia, o Receber lia os
 * avisos, os Contratos abriam e "Adicionar documento" abria o formulário.
 * Agora a tela diz que o cliente ativo não carregou, com "Tentar de novo", que
 * lê de novo a lista dos clientes, nunca o dado da tela. Com o provedor de
 * verdade; fetch falso, dados sintéticos.
 */

const estado = vi.hoisted(() => ({
  chamadas: [] as Array<{ metodo: string; caminho: string; cliente: string | null; busca: string }>,
  clientesFalham: true,
  /** As leituras da lista dos clientes que esperam o teste soltar. */
  clientesPresos: null as Array<() => void> | null,
}));

vi.mock("@/lib/auth", () => ({ useAppUser: () => ({ user: { uid: "u-1", publicMetadata: { role: "owner" } }, isLoaded: true }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));
vi.mock("@/hooks/use-desktop", () => ({ useIsDesktop: () => true }));
vi.mock("@/lib/somente-armazenagem", () => ({ SOMENTE_ARMAZENAGEM: true }));
vi.mock("@/lib/operacao/leitura", () => ({
  useLeitura: () => ({ itens: [], erro: false, tentando: false, tentar: async () => undefined }),
  useDocumento: () => ({ item: undefined, erro: false, tentando: false, tentar: async () => undefined }),
}));
vi.mock("@/lib/telas-no-aparelho", () => ({
  telaSobDemanda: (nome: string) =>
    nome === "pages/comercial/contratos"
      ? ({ clienteCodigo }: { clienteCodigo: string }) => <p>{`Contratos de ${clienteCodigo}`}</p>
      : () => <p>outra aba</p>,
}));

import { ActiveCustomerProvider } from "@/lib/active-customer-context";

import Billing from "./billing";
import BillingHub from "./billing-hub";
import BillingInvoice from "./billing-invoice";
import Documents from "./documents";
import Receber from "./receber";

const PERFIS = [
  { customer_code: LEGACY_CUSTOMER_CODE, name: "BTG Pactual", operation_template: "uniformes", sku_prefix: "BTG" },
  { customer_code: "ACME", name: "Acme Móveis", operation_template: "uniformes", sku_prefix: "ACM" },
];

function periodo(competencia: string) {
  return {
    competencia,
    status: "emitido",
    custo_estoque: 0,
    ad_valorem_rate: 0,
    total: 5_400,
    emitido_em: "2026-11-02",
    pago_em: null,
    grupos: [{ grupo: "Armazenagem", total: 5_400, itens: [{ price_list_id: 1, item: "Posição palete", unidade: "posição", qtde: 120, valor_unit: 45, total: 5_400, auto: true }] }],
    emission: { can_emit: false, available_from: "2026-11-01" },
  };
}

const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });

async function servir(entrada: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(String(entrada instanceof Request ? entrada.url : entrada), "http://localhost");
  const metodo = (init?.method ?? "GET").toUpperCase();
  const cabecalhos = new Headers(init?.headers ?? (entrada instanceof Request ? entrada.headers : undefined));
  estado.chamadas.push({ metodo, caminho: url.pathname, cliente: cabecalhos.get("x-dute-cliente"), busca: url.search });
  if (url.pathname === "/api/client-profiles") {
    const presos = estado.clientesPresos;
    if (presos) await new Promise<void>((soltar) => presos.push(soltar));
    return estado.clientesFalham ? json({ message: "Falha interna no servidor." }, 500) : json({ items: PERFIS });
  }
  const mes = url.pathname.match(/^\/api\/billing\/periods\/(\d{4}-\d{2})$/);
  if (mes && metodo === "GET") return json(periodo(mes[1]));
  if (url.pathname === "/api/warehouse/ops") return json({ alerts: [], queues: {} });
  return json({ items: [] });
}

let raiz: Root | null = null;
let container: HTMLDivElement;
let consultas: QueryClient;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(servir));
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  estado.chamadas = [];
  estado.clientesFalham = true;
  estado.clientesPresos = null;
  window.localStorage.clear();
  // A pessoa escolheu outro cliente neste aparelho.
  window.localStorage.setItem(activeCustomerStorageKey("u-1"), "ACME");
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
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
});

async function esperar(assercao: () => void) {
  await vi.waitFor(async () => {
    await act(async () => {
      await Promise.resolve();
    });
    assercao();
  }, { timeout: 3_000 });
}

async function montar(tela: ReactElement, caminho: string) {
  window.history.replaceState(null, "", caminho);
  const { hook } = memoryLocation({ path: caminho.split("?")[0] });
  raiz = createRoot(container);
  await act(async () => {
    raiz!.render(
      <QueryClientProvider client={consultas}>
        <Router hook={hook}>
          <ActiveCustomerProvider>
            {tela}
            <Anunciador />
          </ActiveCustomerProvider>
        </Router>
      </QueryClientProvider>,
    );
  });
  // A lista dos clientes falhou: a tela já reagiu a ela.
  await esperar(() => expect(estado.chamadas.some((chamada) => chamada.caminho === "/api/client-profiles")).toBe(true));
  await esperar(() => expect(consultas.isFetching()).toBe(0));
}

const FALHA_DO_CLIENTE = "Não consegui carregar o cliente ativo.";
const naTela = () => {
  const copia = container.cloneNode(true) as HTMLElement;
  copia.querySelector("[data-anunciador]")?.remove();
  return copia.textContent ?? "";
};
const botoes = () => Array.from(container.querySelectorAll<HTMLButtonElement>("button"));
const tentar = () => botoes().find((botao) => botao.textContent?.trim() === "Tentar de novo");
/** O que a tela leu ou gravou pelo cliente: o mês, a fatura, os avisos. */
const peloCliente = () =>
  estado.chamadas.filter((chamada) => chamada.caminho.startsWith("/api/billing") || chamada.caminho === "/api/customer-requests");

describe("com a lista dos clientes que falhou", () => {
  it("o Fechamento não lê o mês do cliente padrão: diz a falha do cliente ativo, e Tentar de novo lê a lista dos clientes", async () => {
    await montar(<Billing />, "/faturamento?competencia=2026-10");
    await esperar(() => expect(naTela()).toContain(FALHA_DO_CLIENTE));
    expect(peloCliente()).toEqual([]);
    expect(naTela()).not.toContain("Posição palete");
    expect(botoes().some((botao) => /Marcar como paga|Emitir/.test(botao.textContent ?? ""))).toBe(false);
    // Os meses não afirmam o estado que não leram, nem ficam como quem ainda lê.
    expect(container.querySelector("[data-fantasmas]")).toBeNull();
    expect(textosForaDaLista(container.querySelector("[role='alert']")!.outerHTML, [FALHA_DO_CLIENTE, "Tentar de novo"])).toEqual([]);

    // A nova tentativa presa: a falha fica, e o mês continua sem ser lido com o cliente padrão.
    estado.clientesPresos = [];
    const presos = estado.clientesPresos;
    await act(async () => tentar()!.click());
    await esperar(() => expect(presos.length).toBe(1));
    expect(peloCliente()).toEqual([]);
    expect(naTela()).toContain(FALHA_DO_CLIENTE);

    // A lista chega: o mês é lido, com o cliente escolhido no aparelho.
    estado.clientesFalham = false;
    estado.clientesPresos = null;
    await act(async () => presos.splice(0).forEach((soltar) => soltar()));
    await esperar(() => expect(naTela()).toContain("Posição palete"));
    expect(naTela()).not.toContain(FALHA_DO_CLIENTE);
    expect(peloCliente().length).toBeGreaterThan(0);
    expect(peloCliente().every((chamada) => chamada.cliente === "ACME")).toBe(true);
  });

  it("a fatura não lê a do cliente padrão", async () => {
    await montar(<BillingInvoice />, "/faturamento/fatura?competencia=2026-10");
    await esperar(() => expect(naTela()).toContain(FALHA_DO_CLIENTE));
    expect(peloCliente()).toEqual([]);
    expect(naTela()).not.toContain("Posição palete");
    expect(tentar()).toBeDefined();
  });

  it("os Contratos não abrem com o cliente padrão", async () => {
    await montar(<BillingHub />, "/faturamento/contratos");
    await esperar(() => expect(naTela()).toContain(FALHA_DO_CLIENTE));
    expect(naTela()).not.toContain("Contratos de");
    expect(tentar()).toBeDefined();
  });

  it("o Receber não lê os avisos do cliente padrão, e a Chegada avulsa espera o cliente", async () => {
    await montar(<Receber />, "/wms/receber");
    await esperar(() => expect(naTela()).toContain(FALHA_DO_CLIENTE));
    const avulsa = botoes().find((botao) => botao.textContent?.trim() === "Chegada avulsa")!;
    expect(avulsa.getAttribute("aria-disabled")).toBe("true");
    await act(async () => avulsa.click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    // Enquanto a lista dos clientes lia, a tela leu com o provisório, como sempre (a parte 8); com a falha e na nova
    // tentativa, nenhuma leitura nova com o cliente padrão.
    const lidas = peloCliente().length;
    estado.clientesPresos = [];
    const presos = estado.clientesPresos;
    await act(async () => tentar()!.click());
    await esperar(() => expect(presos.length).toBe(1));
    expect(peloCliente()).toHaveLength(lidas);
    estado.clientesFalham = false;
    estado.clientesPresos = null;
    await act(async () => presos.splice(0).forEach((soltar) => soltar()));
    await esperar(() => expect(peloCliente().some((chamada) => chamada.busca.includes("customer_code=ACME"))).toBe(true));
    expect(peloCliente().slice(lidas).every((chamada) => chamada.busca.includes("customer_code=ACME"))).toBe(true);
    await esperar(() => expect(naTela()).not.toContain(FALHA_DO_CLIENTE));
  });

  it("\"Adicionar documento\" espera o cliente: o formulário não abre com o cliente padrão", async () => {
    await montar(<Documents />, "/documentos");
    let adicionar: HTMLButtonElement | undefined;
    await esperar(() => {
      adicionar = botoes().find((botao) => botao.textContent?.trim() === "Adicionar documento");
      expect(adicionar?.getAttribute("aria-disabled")).toBe("true");
    });
    await act(async () => adicionar!.click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
