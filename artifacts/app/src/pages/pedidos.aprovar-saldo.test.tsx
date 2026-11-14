// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Anunciador } from "@/lib/carregando/anunciador";
import { CARREGANDO } from "@/lib/carregando/tempo";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosForaDaLista } from "@/test/textos";

/**
 * "Para aprovar" enquanto os saldos são lidos (carregamento v2, parte 13i;
 * o diagnóstico, seção 4.3 e seção 6, item 10): a linha fica neutra. O
 * Aprovar e o Recusar ficam no lugar, travados (aria-disabled, nunca
 * disabled), e o apoio diz "Conferindo saldo…" em tinta, só aos 300 ms; o
 * ícone de alerta em âmbar, que é da demora e da falta, não entra. Quando os
 * saldos chegam, os botões soltam. No celular, as duas ações da linha têm
 * 48 px, com 8 px entre elas. Dados sintéticos.
 */

const estado = vi.hoisted(() => ({
  solicitacoes: [] as Array<Record<string, unknown>>,
  /** Com a lista, a leitura dos saldos espera até o teste soltar. */
  saldosPresos: null as Array<() => void> | null,
  /** O saldo livre de cada SKU. */
  disponivel: 500,
}));

vi.mock("@/lib/auth", () => ({ useAppUser: () => ({ user: { publicMetadata: { role: "admin" } } }) }));
vi.mock("@/lib/active-customer-context", () => ({ useActiveCustomer: () => ({ active: { code: "BTG", name: "BTG Pactual" }, code: "BTG" }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/operacao/leitura", () => ({
  useLeitura: () => ({ itens: [], erro: false }),
  useDocumento: () => ({ item: undefined, erro: false }),
}));
vi.mock("@/features/warehouse-ops/opening-inventory-status", () => ({
  useOpeningInventorySession: () => ({ data: undefined }),
  OpeningInventoryNotice: () => null,
}));

import Pedidos from "./pedidos";

const AGORA = new Date("2026-11-13T13:00:00.000Z");

function solicitacao(numero: string, unidades: number) {
  return {
    id: `req_${numero}`,
    type: "retirada",
    customer_code: "BTG Pactual",
    description: `Pedido ${numero}`,
    status: "open",
    // Sem a reserva feita no envio: a aprovação confere o saldo.
    stock_reservation_status: "pending",
    created_at: new Date(AGORA.getTime() - 25 * 60_000).toISOString(),
    items: [
      { sku_code: "BTG-000001", quantity: unidades - 2 },
      { sku_code: "BTG-000002", quantity: 1 },
      { sku_code: "BTG-000003", quantity: 1 },
    ],
  };
}

function resposta(corpo: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => corpo, text: async () => JSON.stringify(corpo) };
}

async function servir(entrada: RequestInfo | URL) {
  const url = new URL(String(entrada), "http://localhost");
  if (url.pathname === "/api/warehouse/ops") return resposta({ queues: {}, alerts: [] });
  if (url.pathname === "/api/stock-balances") {
    const presos = estado.saldosPresos;
    if (presos) await new Promise<void>((soltar) => presos.push(soltar));
    return resposta({
      items: ["BTG-000001", "BTG-000002", "BTG-000003"].map((sku) => ({ sku_code: sku, customer_code: "BTG Pactual", location_id: "A-01", qty_available: estado.disponivel })),
    });
  }
  if (url.pathname === "/api/customer-requests") return resposta({ items: estado.solicitacoes.map((item) => ({ ...item })) });
  throw new Error(`API inesperada: ${url.pathname}`);
}

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;
let cliente: QueryClient;

async function passar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** A linha da solicitação: o primeiro ancestral do título que tem botões. */
function linha(titulo: string): HTMLElement {
  const nome = Array.from(container!.querySelectorAll("p")).find((p) => p.firstChild?.textContent === titulo);
  let no = nome?.parentElement ?? null;
  while (no && !no.querySelector("button, a")) no = no.parentElement;
  if (!no) throw new Error(`sem a linha ${titulo}`);
  return no;
}

/** O rótulo do botão em repouso: a camada de repouso do botão de ação. */
function rotuloDeRepouso(botao: HTMLButtonElement): string {
  return (botao.querySelector('[data-camada="repouso"]')?.textContent ?? botao.textContent ?? "").trim();
}

function botao(titulo: string, rotulo: "Aprovar" | "Recusar"): HTMLButtonElement | undefined {
  return Array.from(linha(titulo).querySelectorAll("button")).find((item) => rotuloDeRepouso(item) === rotulo);
}

function grupoParaAprovar(): HTMLElement {
  const grupo = Array.from(container!.querySelectorAll("section")).find((section) => section.querySelector("h2")?.textContent?.startsWith("Para aprovar"));
  if (!grupo) throw new Error("sem o grupo Para aprovar");
  return grupo;
}

async function montar() {
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  await act(async () => {
    raiz!.render(
      <QueryClientProvider client={cliente}>
        <Anunciador />
        <Pedidos />
      </QueryClientProvider>,
    );
  });
}

/** Até a linha da 1045 entrar na lista, de 10 em 10 ms. */
async function esperarAsLinhas() {
  for (let vez = 0; vez < 20 && !container!.textContent?.includes("Pedido 1045"); vez += 1) await passar(10);
  expect(container!.textContent).toContain("Pedido 1045");
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AGORA);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(servir));
  estado.saldosPresos = null;
  estado.disponivel = 500;
  estado.solicitacoes = [solicitacao("1042", 12), solicitacao("1043", 40), solicitacao("1045", 120)];
  cliente = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  container?.remove();
  container = null;
  cliente.clear();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Para aprovar enquanto os saldos são lidos", () => {
  it("a linha fica neutra: o Aprovar e o Recusar no lugar, travados, e Conferindo saldo… só aos 300 ms, sem o alerta âmbar", async () => {
    estado.saldosPresos = [];
    await montar();
    await esperarAsLinhas();

    const daLinha = linha("Pedido 1042");
    // Nada do ícone de alerta nem do texto da espera seca, desde 0 ms.
    expect(grupoParaAprovar().querySelector(".lucide-triangle-alert, .lucide-alert-triangle")).toBeNull();
    expect(grupoParaAprovar().textContent).not.toContain("Consultando saldos");
    // O ícone da fila tem o tom dela; o aviso em âmbar é o parágrafo do note.
    expect(grupoParaAprovar().querySelector("p.text-warning-soft-foreground")).toBeNull();
    // Os botões ficam no lugar, travados sem disabled (o foco não cai no body), e o "Ver itens" não entra no lugar deles.
    const aprovar = botao("Pedido 1042", "Aprovar");
    const recusar = botao("Pedido 1042", "Recusar");
    expect(aprovar, "Aprovar").toBeDefined();
    expect(recusar, "Recusar").toBeDefined();
    for (const alvo of [aprovar!, recusar!]) {
      expect(alvo.getAttribute("aria-disabled")).toBe("true");
      expect(alvo.hasAttribute("disabled")).toBe(false);
    }
    expect(Array.from(daLinha.querySelectorAll("a")).map((link) => link.textContent)).not.toContain("Ver itens");
    // Antes de 300 ms, a linha diz o que diria sem a espera.
    expect(daLinha.textContent).toContain("Retirada · BTG Pactual");
    expect(daLinha.textContent).not.toContain("Conferindo saldo…");

    // O toque no Aprovar travado não decide nada.
    await act(async () => aprovar!.click());
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("/approve"))).toBe(false);

    await passar(CARREGANDO.atrasoMs);
    const apoio = Array.from(linha("Pedido 1042").querySelectorAll("span")).find((span) => span.textContent === "Conferindo saldo…");
    expect(apoio, "o apoio da espera").toBeDefined();
    expect(apoio!.className).toContain("text-foreground");
    expect(apoio!.className).not.toMatch(/amber|warning/);
    expect(grupoParaAprovar().querySelector(".lucide-triangle-alert, .lucide-alert-triangle")).toBeNull();

    // Os saldos chegam: os botões soltam e o apoio volta ao resumo.
    await act(async () => {
      for (const soltar of estado.saldosPresos!.splice(0)) soltar();
    });
    await vi.waitFor(
      async () => {
        await passar(10);
        const solto = botao("Pedido 1042", "Aprovar")!;
        expect(solto.getAttribute("aria-disabled")).toBeNull();
      },
      { timeout: 3_000 },
    );
    expect(linha("Pedido 1042").textContent).not.toContain("Conferindo saldo…");
    expect(botao("Pedido 1042", "Recusar")!.getAttribute("aria-disabled")).toBeNull();
  });

  it("só rótulos, dados e ações, e o axe não acusa nada com a espera do saldo", async () => {
    estado.saldosPresos = [];
    await montar();
    await esperarAsLinhas();
    await passar(CARREGANDO.atrasoMs);
    const html = grupoParaAprovar().outerHTML;
    expect(html).toContain("Conferindo saldo…");
    expect(
      textosForaDaLista(html, [
        "Para aprovar",
        /^\d+$/,
        /^Pedido 104[235]$/,
        /^Retirada · BTG Pactual · \d+ itens · \d+ un\.$/,
        "há 25 min",
        /^· há \d+ min$/,
        "·",
        "Conferindo saldo…",
        "Recusar",
        "Recusando…",
        "Recusado",
        "Não recusado",
        "Aprovar",
        "Aprovando…",
        "Aprovado",
        "Não aprovado",
        "Conferir",
      ]),
    ).toEqual([]);
    // O axe usa o relógio de verdade.
    vi.useRealTimers();
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });
});

describe("as ações da linha no celular", () => {
  it("o Recusar e o Aprovar têm 48 px no celular, com 8 px entre eles", async () => {
    await montar();
    await esperarAsLinhas();
    const aprovar = botao("Pedido 1042", "Aprovar")!;
    const recusar = botao("Pedido 1042", "Recusar")!;
    // A medida de verdade é a do navegador; aqui, as classes que a garantem.
    expect(aprovar.className).toContain("max-md:min-h-12");
    expect(recusar.className).toContain("max-md:min-h-12");
    expect(aprovar.parentElement).toBe(recusar.parentElement);
    expect(aprovar.parentElement!.className).toContain("gap-2");
  });
});

/**
 * A revisão da parte 13i, no navegador: a espera do saldo não mexe na lista
 * nem pisca. "Conferindo saldo…" fica no lugar do resumo sem mudar a altura
 * da linha (o resumo continua ocupando o lugar, escondido, e a espera fica por
 * cima, numa linha de 20 px); o indicador que apareceu fica pelo menos 500 ms,
 * com os botões travados junto; antes de 300 ms o botão travado não esmaece
 * (a trava vale desde 0 ms, mas nada aparece); e o foco que estava no botão
 * travado vai ao "Ver itens" quando o saldo chega com falta, nunca ao body.
 */
describe("a espera do saldo sem salto, sem piscar e com o foco", () => {
  const soltarSaldos = async () => {
    await act(async () => {
      for (const soltar of estado.saldosPresos!.splice(0)) soltar();
    });
  };

  it("o resumo fica no lugar, escondido, sob \"Conferindo saldo…\": a altura da linha não muda", async () => {
    estado.saldosPresos = [];
    await montar();
    await esperarAsLinhas();
    await passar(CARREGANDO.atrasoMs);
    const daLinha = linha("Pedido 1042");
    const espera = Array.from(daLinha.querySelectorAll<HTMLElement>("span")).find((span) => span.textContent?.trim() === "Conferindo saldo…");
    expect(espera, "a espera").toBeDefined();
    // A espera e o resumo na mesma célula da grade: a linha mede o maior dos dois, o resumo.
    const celula = espera!.parentElement!;
    expect(celula.className).toContain("grid");
    const resumo = Array.from(celula.children).find((filho) => filho !== espera) as HTMLElement | undefined;
    expect(resumo?.textContent).toMatch(/^Retirada · BTG Pactual · 3 itens · 12 un\./);
    expect(resumo!.className).toContain("invisible");
    expect(resumo!.getAttribute("aria-hidden")).toBe("true");
    for (const filho of [espera!, resumo!]) {
      expect(filho.className).toContain("col-start-1");
      expect(filho.className).toContain("row-start-1");
    }
    // A espera numa linha de texto de 20 px (o h-5), sem o inline-flex que levava a linha a 21,3 px.
    expect(espera!.className).toContain("h-5");
    expect(espera!.className).not.toContain("inline-flex");
  });

  it("o saldo que chega logo depois dos 300 ms não pisca: \"Conferindo saldo…\" fica 500 ms, com os botões travados", async () => {
    estado.saldosPresos = [];
    await montar();
    await esperarAsLinhas();
    await passar(CARREGANDO.atrasoMs + 50);
    expect(linha("Pedido 1042").textContent).toContain("Conferindo saldo…");
    await soltarSaldos();
    await passar(10);
    // 60 ms depois de aparecer: o indicador fica até completar 500 ms, e os botões seguem travados com ele.
    expect(linha("Pedido 1042").textContent).toContain("Conferindo saldo…");
    expect(botao("Pedido 1042", "Aprovar")!.getAttribute("aria-disabled")).toBe("true");
    await passar(CARREGANDO.minimoMs - 100);
    expect(linha("Pedido 1042").textContent).toContain("Conferindo saldo…");
    await vi.waitFor(
      async () => {
        await passar(10);
        expect(linha("Pedido 1042").textContent).not.toContain("Conferindo saldo…");
      },
      { timeout: 3_000 },
    );
    expect(botao("Pedido 1042", "Aprovar")!.getAttribute("aria-disabled")).toBeNull();
  });

  it("antes de 300 ms, o botão travado pelo saldo não esmaece: a trava vale, mas nada aparece", async () => {
    estado.saldosPresos = [];
    await montar();
    await esperarAsLinhas();
    const aprovar = botao("Pedido 1042", "Aprovar")!;
    expect(aprovar.getAttribute("aria-disabled")).toBe("true");
    expect(aprovar.className).not.toContain("opacity-45");
    expect(botao("Pedido 1042", "Recusar")!.className).not.toContain("opacity-45");
    await passar(CARREGANDO.atrasoMs);
    expect(botao("Pedido 1042", "Aprovar")!.className).toContain("opacity-45");
    expect(botao("Pedido 1042", "Recusar")!.className).toContain("opacity-45");
    // O saldo rápido (antes de 300 ms) nunca esmaece.
    act(() => raiz?.unmount());
    raiz = null;
    container?.remove();
    cliente.clear();
    estado.saldosPresos = [];
    await montar();
    await esperarAsLinhas();
    await passar(100);
    await soltarSaldos();
    const vistos: boolean[] = [];
    for (let feito = 0; feito < 600; feito += 20) {
      await passar(20);
      vistos.push(botao("Pedido 1042", "Aprovar")!.className.includes("opacity-45"));
    }
    expect(vistos.some(Boolean)).toBe(false);
  });

  it("com o foco no Aprovar travado, o saldo que chega com falta leva o foco ao \"Ver itens\", não ao body", async () => {
    estado.saldosPresos = [];
    estado.disponivel = 50;
    await montar();
    await esperarAsLinhas();
    const aprovar = botao("Pedido 1045", "Aprovar")!;
    aprovar.focus();
    expect(document.activeElement).toBe(aprovar);
    await soltarSaldos();
    await vi.waitFor(
      async () => {
        await passar(20);
        expect(linha("Pedido 1045").textContent).toContain("Ver itens");
      },
      { timeout: 3_000 },
    );
    await passar(20);
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.textContent).toBe("Ver itens");
  });
});
