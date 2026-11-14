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
  codeProvavel: undefined as string | undefined,
  recarregar: null as null | (() => Promise<unknown>),
  chamadas: [] as string[],
  postFalha: false,
  primeiroAtraso: {} as Record<string, number>,
}));

vi.mock("@/lib/auth", () => ({ useAppUser: () => ({ user: { uid: "u-1", publicMetadata: { role: "admin" } }, isLoaded: true }) }));
vi.mock("@/lib/active-customer-context", () => ({
  useActiveCustomer: () => ({
    code: "BTG",
    isLoading: estado.carregandoCliente,
    codeProvavel: estado.codeProvavel ?? "BTG",
    tentar: estado.recarregar ?? (() => Promise.resolve()),
  }),
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
  estado.chamadas.push(`${metodo} ${url.pathname}`);
  if (metodo !== "GET") {
    await new Promise((pronto) => setTimeout(pronto, estado.postAtraso));
    if (estado.postFalha) {
      return new Response(JSON.stringify({ message: "Falha interna no servidor." }), { status: 500, headers: { "content-type": "application/json" } });
    }
    const pago = url.pathname.match(/\/periods\/(\d{4}-\d{2})\/pay$/);
    if (pago) estado.status[pago[1]] = "pago";
    const manual = url.pathname.match(/\/periods\/(\d{4}-\d{2})\/manual$/);
    if (manual) {
      const corpo = JSON.parse(String(init?.body ?? "{}")) as { items?: Array<{ qtde: number }> };
      estado.qtd[manual[1]] = corpo.items?.[0]?.qtde ?? 0;
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  }
  const primeiro = estado.primeiroAtraso[url.pathname];
  if (primeiro !== undefined) delete estado.primeiroAtraso[url.pathname];
  const atraso = primeiro ?? Object.entries(estado.atrasos).find(([caminho]) => url.pathname === caminho)?.[1] ?? 30;
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
  estado.codeProvavel = undefined;
  estado.recarregar = null;
  estado.chamadas = [];
  estado.postFalha = false;
  estado.primeiroAtraso = {};
  window.localStorage.clear();
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
    await esperar(() => !botao(/Salvar quantidades|Salvando…|Quantidades salvas/), "o botão sai depois da releitura");
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
    await esperar(() => !botao(/Marcar como paga|Marcando como paga…|Marcada como paga/), "o botão sai depois da releitura");
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

/** Os textos do mês aberto com alterações e de cada estado das ações (a trava contra legenda, também nos estados da ação). */
const TEXTOS_DO_MES = [
  "Outubro de 2026", "Novembro de 2026", "Setembro de 2026", "Agosto de 2026", "Outro mês", /^Atualizado às \d{2}:\d{2}$/, "Cobrado automaticamente",
  "calculado pelo sistema", "Posição palete", /^120 posição × R\$/, /^R\$/, "Serviços do mês", "quantidade lançada por você", "quantidades congeladas",
  "Serviço", "Qtde", "Valor unit.", "Total", "Observação", "Etiquetagem", "peça", /total previsto$/, /· total$/, "Em aberto", "Emitida", "Paga",
  /^Pago|^Emitid/, "Inclui alterações ainda não salvas.", "Mesmo cálculo que será congelado na emissão.", "Valores congelados na emissão.",
  "Alterações não salvas", "Salve antes de emitir.", "Quantidades salvas", /encerrado$|ainda não terminou$/, "Pronto para emitir.",
  /^Emissão liberada a partir de/, /^Emitida em/, "Disponível para a cliente em Faturas.", "Aguardando pagamento", /^Paga em/,
  "Salvar quantidades", "Salvando…", "Quantidades não salvas", "Ver prévia da fatura (PDF)", "Ver fatura (PDF)", "Emitir e publicar para a cliente",
  "Marcar como paga", "Marcando como paga…", "Marcada como paga", "Não marcada como paga", "Conferir", /·/, /^\d+$/,
];

async function digitarQuantidade(valor: string) {
  const campo = container.querySelector<HTMLInputElement>('input[aria-label="Quantidade de Etiquetagem"]')!;
  await act(async () => {
    const definir = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    definir.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("o Fechamento depois da revisão (parte 13d)", () => {
  it("com o cliente ativo preso, o \"Tentar de novo\" da demora lê de novo os clientes, nunca o mês do cliente padrão", async () => {
    estado.carregandoCliente = true;
    let releu = 0;
    estado.recarregar = () => {
      releu += 1;
      return Promise.resolve();
    };
    await montar(Billing);
    await passar(10_500);
    expect(linha()?.textContent).toContain("Demorando mais que o normal");
    const tentar = Array.from(container.querySelectorAll<HTMLButtonElement>(".linha-de-estado-tentar")).find((item) => item.textContent === "Tentar de novo");
    expect(tentar).toBeDefined();
    await tocar(tentar, "Tentar de novo");
    await passar(2_000);
    expect(releu).toBe(1);
    expect(estado.chamadas.filter((chamada) => chamada.startsWith("GET /api/billing"))).toEqual([]);
    expect(texto()).not.toContain("Posição palete");
    expect(container.querySelector('input[aria-label="Quantidade de Etiquetagem"]')).toBeNull();
    expect(botao("Marcar como paga")).toBeUndefined();
  });

  it("o esqueleto do mês, com o cliente ativo lendo, tem as linhas lembradas do cliente que a tela vai operar", async () => {
    window.localStorage.setItem("dute:contagem-lembrada:fechamento:BTG", JSON.stringify({ automaticos: 1, servicos: 1 }));
    window.localStorage.setItem("dute:contagem-lembrada:fechamento:ACME", JSON.stringify({ automaticos: 4, servicos: 1 }));
    estado.carregandoCliente = true;
    estado.codeProvavel = "ACME";
    await montar(Billing);
    await passar(350);
    const automaticos = container.querySelector("section [data-fantasmas]");
    expect(automaticos?.childElementCount).toBe(4);
  });

  it("a lista dos meses que falha diz que não veio, com \"Tentar de novo\", que relê; o mês na tela segue", async () => {
    estado.falhas = new Set(["/api/billing/periods"]);
    await montar(Billing);
    await passar(300);
    expect(texto()).toContain("Posição palete");
    expect(texto()).toContain("Não consegui carregar os meses.");
    const tentar = botao("Tentar de novo");
    expect(tentar).toBeDefined();
    estado.falhas = new Set();
    await tocar(tentar, "Tentar de novo");
    await esperar(() => Boolean(cartaoDoMes("Outubro de 2026")?.textContent?.includes("Emitida")), "os meses relidos");
    expect(texto()).not.toContain("Não consegui carregar os meses.");
    expect(document.activeElement).not.toBe(document.body);
  });

  it("a faixa dos meses nasce com a forma final: os meses que a lista vai trazer entram como cartões-fantasma, sem salto na chegada", async () => {
    estado.atrasos = { "/api/billing/periods": 2_000 };
    estado.status = { "2026-08": "pago", "2026-09": "pago", "2026-10": "emitido", "2026-11": "aberto" };
    await montar(Billing);
    const faixa = () => cartaoDoMes("Novembro de 2026")!.parentElement!;
    expect(faixa().childElementCount).toBe(5);
    await passar(350);
    expect(faixa().querySelectorAll("[data-fantasmas][data-visivel]")).toHaveLength(2);
    await passar(2_000);
    expect(faixa().querySelectorAll("[data-fantasmas]")).toHaveLength(0);
    expect(faixa().childElementCount).toBe(5);
    // Com a lembrança de três meses deste cliente, um cartão-fantasma só.
    act(() => raiz?.unmount());
    raiz = null;
    cliente.clear();
    window.localStorage.setItem("dute:contagem-lembrada:fechamento-meses:BTG", JSON.stringify({ meses: 3 }));
    await montar(Billing);
    expect(faixa().querySelectorAll("[data-fantasmas]")).toHaveLength(1);
  });

  it("Salvar quantidades diz \"Quantidades salvas\" do fim da chamada até o mês relido chegar; no erro, \"Quantidades não salvas\" por 2 s", async () => {
    window.history.replaceState(null, "", "/faturamento?competencia=2026-11");
    await montar(Billing);
    await esperar(() => texto().includes("Etiquetagem"), "o mês");
    await digitarQuantidade("7");
    estado.atrasos = { "/api/billing/periods/2026-11": 4_000 };
    const salvar = botao("Salvar quantidades");
    await tocar(salvar, "Salvar quantidades");
    await passar(350);
    expect(textosForaDaLista(semAnunciador(), TEXTOS_DO_MES)).toEqual([]);
    await passar(1_200);
    // O servidor já disse que salvou; o mês relido ainda não chegou.
    expect(salvar!.querySelector(".botao-acao-camada[data-atual]")?.textContent).toBe("Quantidades salvas");
    expect(salvar!.getAttribute("aria-disabled")).toBe("true");
    expect(textosForaDaLista(semAnunciador(), TEXTOS_DO_MES)).toEqual([]);
    paraOAxe.push(semAnunciador());
    await passar(2_000);
    expect(salvar!.querySelector(".botao-acao-camada[data-atual]")?.textContent).toBe("Quantidades salvas");
    await esperar(() => !botao(/Salvar quantidades|Quantidades salvas/), "o botão sai com o mês relido");
    expect(document.activeElement?.textContent).toContain("Ver prévia da fatura (PDF)");
    // No erro, o botão diz que não salvou e volta.
    estado.atrasos = {};
    await digitarQuantidade("9");
    estado.postFalha = true;
    const deNovo = botao("Salvar quantidades");
    await tocar(deNovo, "Salvar quantidades");
    await passar(1_600);
    expect(deNovo!.querySelector(".botao-acao-camada[data-atual]")?.textContent).toBe("Quantidades não salvas");
    expect(textosForaDaLista(semAnunciador(), TEXTOS_DO_MES)).toEqual([]);
    await passar(2_100);
    expect(deNovo!.querySelector(".botao-acao-camada[data-atual]")?.textContent).toBe("Salvar quantidades");
    await axeDoQueVimos();
  });

  it("Marcar como paga diz \"Marcada como paga\" até o mês relido chegar", async () => {
    await montar(Billing);
    await esperar(() => Boolean(botao("Marcar como paga")), "o mês emitido");
    estado.atrasos = { "/api/billing/periods/2026-10": 4_000 };
    const pagar = botao("Marcar como paga");
    await tocar(pagar, "Marcar como paga");
    await passar(1_600);
    expect(pagar!.querySelector(".botao-acao-camada[data-atual]")?.textContent).toBe("Marcada como paga");
    expect(textosForaDaLista(semAnunciador(), TEXTOS_DO_MES)).toEqual([]);
    await esperar(() => !botao(/Marcar como paga|Marcada como paga/), "o botão sai com o mês relido");
    expect(document.activeElement?.textContent).toContain("Ver fatura (PDF)");
  });

  it("um brilho por cartão no esqueleto do mês, nunca um por bloco; e a chegada entra em cascata", async () => {
    estado.atrasos = { "/api/billing/periods/2026-10": 2_000 };
    await montar(Billing);
    await passar(350);
    expect(container.querySelectorAll(".carregando-com-brilho")).toHaveLength(3);
    expect(container.querySelectorAll("[data-esqueleto].carregando-com-brilho")).toHaveLength(0);
    await passar(1_700);
    expect(texto()).toContain("Posição palete");
    expect(container.querySelector("[data-chegada]")).not.toBeNull();
  });
});

describe("a fatura depois da revisão (parte 13d)", () => {
  it("aos 10 s, \"Demorando mais que o normal\" vem com \"Tentar de novo\", que lê de novo a fatura presa", async () => {
    window.history.replaceState(null, "", "/faturamento/fatura?competencia=2026-10");
    estado.primeiroAtraso = { "/api/billing/periods/2026-10": 600_000 };
    await montar(BillingInvoice);
    await passar(10_500);
    expect(texto()).toContain("Demorando mais que o normal");
    const tentar = botao("Tentar de novo");
    expect(tentar).toBeDefined();
    expect(textosForaDaLista(semAnunciador(), ["Fechamento do mês", "Carregando a fatura…", "Demorando mais que o normal", "Tentar de novo"])).toEqual([]);
    paraOAxe.push(semAnunciador());
    await tocar(tentar, "Tentar de novo");
    await esperar(() => texto().includes("Posição palete"), "a fatura relida");
    // A espera sai com o foco no "Tentar de novo": ele vai à volta para o Fechamento, nunca ao body.
    expect(document.activeElement?.textContent).toContain("Fechamento do mês");
    await axeDoQueVimos();
  });

  it("com o cliente ativo preso, o \"Tentar de novo\" lê de novo os clientes, nunca a fatura do cliente padrão", async () => {
    window.history.replaceState(null, "", "/faturamento/fatura?competencia=2026-10");
    estado.carregandoCliente = true;
    let releu = 0;
    estado.recarregar = () => {
      releu += 1;
      return Promise.resolve();
    };
    await montar(BillingInvoice);
    await passar(10_500);
    await tocar(botao("Tentar de novo"), "Tentar de novo");
    await passar(1_000);
    expect(releu).toBe(1);
    expect(estado.chamadas).toEqual([]);
  });
});
