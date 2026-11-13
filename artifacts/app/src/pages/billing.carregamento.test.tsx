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
import { textosForaDaLista } from "@/test/textos";

/**
 * O Fechamento do mês e a fatura no carregamento v2 (parte 13d; diagnóstico,
 * seção 4.8 e necessidades 2, 3, 5 e 10). Antes, o mês dizia "Calculando
 * Outubro de 2026..." em texto seco, os cartões dos meses nasciam "Em aberto"
 * até a lista dos meses chegar (o mês emitido parecia aberto, também quando a
 * lista falhava), "Salvar quantidades" e "Marcar como paga" só apagavam
 * (`disabled`, sem rótulo nem indicador) e o foco caía no `body`; a fatura
 * dizia "Carregando fatura..." e, na falha, só o texto do servidor, sem
 * "Tentar de novo". Relógio simulado. Dados sintéticos.
 */

const estado = vi.hoisted(() => ({
  atrasos: {} as Record<string, number>,
  falhas: new Set<string>(),
  postAtraso: 1_000,
  status: {} as Record<string, string>,
  qtd: {} as Record<string, number>,
  carregandoCliente: false,
}));

vi.mock("@/lib/auth", () => ({ useAppUser: () => ({ user: { uid: "u-1", publicMetadata: { role: "admin" } }, isLoaded: true }) }));
vi.mock("@/lib/active-customer-context", () => ({
  useActiveCustomer: () => ({ code: "BTG", isLoading: estado.carregandoCliente }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));

import Billing from "./billing";
import BillingInvoice from "./billing-invoice";

// 13:42 UTC de 13/11/2026: o mês a fechar é outubro.
const AGORA = Date.parse("2026-11-13T13:42:00Z");

function periodo(competencia: string) {
  const status = estado.status[competencia] ?? "aberto";
  const qtde = estado.qtd[competencia] ?? 2;
  return {
    competencia,
    status,
    custo_estoque: 0,
    ad_valorem_rate: 0,
    total: 5_400 + qtde * 85,
    emitido_em: status === "aberto" ? null : `${competencia}-28T12:00:00Z`,
    pago_em: status === "pago" ? `${competencia}-30T12:00:00Z` : null,
    grupos: [
      { grupo: "Armazenagem", total: 5_400, itens: [{ price_list_id: 1, item: "Posição palete", unidade: "posição", qtde: 120, valor_unit: 45, total: 5_400, auto: true }] },
      { grupo: "Serviços", total: qtde * 85, itens: [{ price_list_id: 3, item: "Etiquetagem", unidade: "peça", qtde, valor_unit: 85, total: qtde * 85, observacao: "" }] },
    ],
    emission: { can_emit: competencia < "2026-11", available_from: "2026-12-01" },
  };
}

async function servir(entrada: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(String(entrada instanceof Request ? entrada.url : entrada), "http://localhost");
  const metodo = (init?.method ?? "GET").toUpperCase();
  if (metodo !== "GET") {
    await new Promise((pronto) => setTimeout(pronto, estado.postAtraso));
    const pago = url.pathname.match(/\/periods\/(\d{4}-\d{2})\/pay$/);
    if (pago) estado.status[pago[1]] = "pago";
    const manual = url.pathname.match(/\/periods\/(\d{4}-\d{2})\/manual$/);
    if (manual) {
      const corpo = JSON.parse(String(init?.body ?? "{}")) as { items?: Array<{ qtde: number }> };
      estado.qtd[manual[1]] = corpo.items?.[0]?.qtde ?? 0;
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  }
  const atraso = Object.entries(estado.atrasos).find(([caminho]) => url.pathname === caminho)?.[1] ?? 30;
  await new Promise((pronto) => setTimeout(pronto, atraso));
  if (estado.falhas.has(url.pathname)) {
    return new Response(JSON.stringify({ message: "Falha interna no servidor." }), { status: 500, headers: { "content-type": "application/json" } });
  }
  const mes = url.pathname.match(/^\/api\/billing\/periods\/(\d{4}-\d{2})$/);
  const corpo = mes
    ? periodo(mes[1])
    : url.pathname === "/api/billing/periods"
      ? { items: Object.entries(estado.status).map(([competencia, status]) => ({ competencia, status, total: 48_210 })) }
      : { items: [] };
  return new Response(JSON.stringify(corpo), { status: 200, headers: { "content-type": "application/json" } });
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
  estado.postAtraso = 1_000;
  estado.status = { "2026-09": "pago", "2026-10": "emitido", "2026-11": "aberto" };
  estado.qtd = {};
  estado.carregandoCliente = false;
  window.history.replaceState(null, "", "/faturamento");
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

async function esperar(condicao: () => boolean, oQue: string) {
  for (let volta = 0; volta < 400; volta += 1) {
    if (condicao()) return;
    await passar(10);
  }
  throw new Error(`Não aconteceu: ${oQue}`);
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

/** O HTML da tela sem a região do Anunciador (o que ele diz não é texto da tela). */
const semAnunciador = () => {
  const copia = container.cloneNode(true) as HTMLElement;
  copia.querySelector("[data-anunciador]")?.remove();
  return copia.innerHTML;
};
const texto = () => {
  const copia = container.cloneNode(true) as HTMLElement;
  copia.querySelector("[data-anunciador]")?.remove();
  return (copia.textContent ?? "").replace(/\s+/g, " ");
};
const linha = () => container.querySelector("[data-linha-de-estado]");
const cartaoDoMes = (mes: string) =>
  Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((botao) => botao.textContent?.includes(mes));

/** O botão pelo rótulo atual (a camada atual do BotaoDeAcao, ou o texto inteiro). */
function botao(rotulo: string | RegExp): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((item) => {
    const atual = (item.querySelector(".botao-acao-camada[data-atual]")?.textContent ?? item.textContent ?? "").replace(/\s+/g, " ").trim();
    return typeof rotulo === "string" ? atual === rotulo : rotulo.test(atual);
  });
}

async function tocar(alvo: HTMLElement | undefined, oQue: string) {
  if (!alvo) throw new Error(`sem ${oQue}`);
  alvo.focus();
  await act(async () => {
    alvo.click();
  });
}

/** O HTML visto em cada estado, para o axe no fim do teste, com o relógio de verdade (o do jsdom dele). */
const paraOAxe: string[] = [];
async function axeDoQueVimos() {
  vi.useRealTimers();
  for (const html of paraOAxe.splice(0)) expect(await violacoesDeAcessibilidade(html)).toEqual([]);
}

describe("o Fechamento do mês antes de ler", () => {
  it("nunca \"Calculando...\": aos 300 ms, a linha diz \"Carregando outubro de 2026…\", com o esqueleto do mês e a região ocupada", async () => {
    estado.atrasos = { "/api/billing/periods/2026-10": 2_000, "/api/billing/periods": 2_000 };
    await montar(Billing);
    expect(texto()).not.toMatch(/Calculando|\.\.\./);
    // Antes de 300 ms, nada aparece: o esqueleto fica no lugar, invisível.
    expect(container.querySelector("[data-fantasmas][data-visivel]")).toBeNull();
    await passar(350);
    expect(linha()?.textContent).toContain("Carregando outubro de 2026…");
    expect(container.querySelector("[data-fantasmas][data-visivel]")).not.toBeNull();
    const ocupada = container.querySelector('[aria-busy="true"][aria-describedby]');
    expect(ocupada?.getAttribute("aria-describedby")).toBe(linha()?.id);
    expect(
      textosForaDaLista(semAnunciador(), [
        "Outubro de 2026", "Novembro de 2026", "Outro mês", "Carregando outubro de 2026…", "Cobrado automaticamente", "Serviços do mês",
      ]),
    ).toEqual([]);
    paraOAxe.push(semAnunciador());
    await passar(2_000);
    expect(texto()).toContain("Posição palete");
    expect(container.querySelector("[data-fantasmas]")).toBeNull();
    await axeDoQueVimos();
  });

  it("com o cliente ativo ainda lendo, a espera é a mesma: \"Carregando outubro de 2026…\", nunca \"Calculando\"", async () => {
    estado.carregandoCliente = true;
    await montar(Billing);
    await passar(350);
    expect(linha()?.textContent).toContain("Carregando outubro de 2026…");
    expect(texto()).not.toContain("Calculando");
  });

  it("o cartão do mês não diz \"Em aberto\" antes de a lista dos meses chegar: o bloco no lugar do estado", async () => {
    estado.atrasos = { "/api/billing/periods": 2_000 };
    await montar(Billing);
    await passar(300);
    // Outubro está emitido: até a lista chegar, a tela não sabe e não afirma.
    expect(texto()).toContain("Posição palete");
    expect(cartaoDoMes("Outubro de 2026")?.textContent).not.toContain("Em aberto");
    expect(cartaoDoMes("Outubro de 2026")?.querySelector("[data-esqueleto]")).not.toBeNull();
    await passar(2_000);
    expect(cartaoDoMes("Outubro de 2026")?.textContent).toContain("Emitida");
  });

  it("a lista dos meses que falha: o cartão diz \"—\", nunca \"Em aberto\"", async () => {
    estado.falhas = new Set(["/api/billing/periods"]);
    await montar(Billing);
    await passar(300);
    expect(cartaoDoMes("Outubro de 2026")?.textContent).not.toContain("Em aberto");
    expect(cartaoDoMes("Outubro de 2026")?.textContent).toContain("—");
    expect(cartaoDoMes("Novembro de 2026")?.textContent).toContain("—");
  });
});

describe("as ações do Fechamento", () => {
  it("Salvar quantidades: ocupado sem disabled, \"Salvando…\" aos 300 ms, e o foco vai a \"Ver prévia da fatura (PDF)\" quando o botão sai", async () => {
    window.history.replaceState(null, "", "/faturamento?competencia=2026-11");
    await montar(Billing);
    await esperar(() => texto().includes("Etiquetagem"), "o mês");
    const campo = container.querySelector<HTMLInputElement>('input[aria-label="Quantidade de Etiquetagem"]')!;
    await act(async () => {
      const definir = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      definir.call(campo, "7");
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const salvar = botao("Salvar quantidades");
    await tocar(salvar, "Salvar quantidades");
    await passar(10);
    expect(salvar!.disabled).toBe(false);
    expect(salvar!.getAttribute("aria-disabled")).toBe("true");
    await passar(340);
    expect(salvar!.getAttribute("aria-busy")).toBe("true");
    expect(salvar!.textContent).toContain("Salvando…");
    expect(document.activeElement).toBe(salvar);
    await esperar(() => !botao(/Salvar quantidades|Salvando…/), "o botão sai depois da releitura");
    expect(document.activeElement?.textContent).toContain("Ver prévia da fatura (PDF)");
    expect(estado.qtd["2026-11"]).toBe(7);
  });

  it("Marcar como paga: ocupado sem disabled, \"Marcando como paga…\" aos 300 ms, e o foco vai a \"Ver fatura (PDF)\" quando o botão sai", async () => {
    await montar(Billing);
    await esperar(() => Boolean(botao("Marcar como paga")), "o mês emitido");
    const pagar = botao("Marcar como paga");
    await tocar(pagar, "Marcar como paga");
    expect(pagar!.disabled).toBe(false);
    await passar(350);
    expect(pagar!.getAttribute("aria-busy")).toBe("true");
    expect(pagar!.textContent).toContain("Marcando como paga…");
    expect(document.activeElement).toBe(pagar);
    paraOAxe.push(semAnunciador());
    await esperar(() => !botao(/Marcar como paga|Marcando como paga…/), "o botão sai depois da releitura");
    expect(document.activeElement?.textContent).toContain("Ver fatura (PDF)");
    expect(estado.status["2026-10"]).toBe("pago");
    await axeDoQueVimos();
  });
});

describe("a fatura", () => {
  it("lendo: nada antes de 300 ms e depois \"Carregando a fatura…\", nunca \"Carregando fatura...\"", async () => {
    window.history.replaceState(null, "", "/faturamento/fatura?competencia=2026-10");
    estado.atrasos = { "/api/billing/periods/2026-10": 2_000 };
    await montar(BillingInvoice);
    expect(texto()).not.toContain("Carregando");
    await passar(350);
    expect(texto()).toContain("Carregando a fatura…");
    expect(texto()).not.toContain("...");
    expect(textosForaDaLista(semAnunciador(), ["Fechamento do mês", "Carregando a fatura…"])).toEqual([]);
    paraOAxe.push(semAnunciador());
    await axeDoQueVimos();
  });

  it("a leitura que falha diz que não conseguiu, com \"Tentar de novo\", que relê", async () => {
    window.history.replaceState(null, "", "/faturamento/fatura?competencia=2026-10");
    estado.falhas = new Set(["/api/billing/periods/2026-10"]);
    await montar(BillingInvoice);
    await passar(300);
    expect(texto()).toContain("Não consegui carregar a fatura.");
    const tentar = botao("Tentar de novo");
    expect(tentar).toBeDefined();
    expect(textosForaDaLista(semAnunciador(), ["Fechamento do mês", "Não consegui carregar a fatura.", "Tentar de novo"])).toEqual([]);
    estado.falhas = new Set();
    await tocar(tentar, "Tentar de novo");
    await esperar(() => texto().includes("Posição palete"), "a fatura relida");
  });
});
