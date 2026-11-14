// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Anunciador } from "@/lib/carregando/anunciador";
import { ProvedorDaConexao } from "@/lib/carregando/estado-da-conexao";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { conexaoEm } from "@/test/conexao";
import { textosForaDaLista } from "@/test/textos";

/**
 * A Tabela de preços e a Cobrança no carregamento v2 (parte 13d; diagnóstico,
 * seção 4.8 e necessidades 2, 3, 5 e 8). Antes, a tabela dizia "Carregando
 * serviços..." numa célula, a cobrança mostrava os campos vazios e apagados
 * até a configuração chegar (a taxa parecia vazia), a releitura que falhava
 * não dizia nada, a falha usava o `ErroNaLeitura` direto (o "Tentando de
 * novo…" também na releitura automática) e "Salvar cobrança" só apagava e
 * trocava o texto por "Salvando...", com o foco no `body`. Relógio simulado.
 * Dados sintéticos.
 */

const estado = vi.hoisted(() => ({
  atrasos: {} as Record<string, number>,
  falhas: new Set<string>(),
  postAtraso: 1_000,
  postFalha: false,
  configSalva: null as null | Record<string, unknown>,
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));

import PriceList from "./price-list";

const AGORA = Date.parse("2026-11-13T13:42:00Z");
const PRECOS = [
  { id: 1, grupo: "armazenamento", item: "Posição palete", unidade: "posição", valor_unit: 45, auto_source: null, ordem: 1, ativo: true },
  { id: 3, grupo: "servicos", item: "Etiquetagem", unidade: "peça", valor_unit: 85, auto_source: null, ordem: 3, ativo: true },
];
const CONFIG = { id: 1, ad_valorem_rate: 0.005, cliente_nome: "BTG Pactual", cliente_email: "fatura@btg.example" };

async function servir(entrada: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(String(entrada instanceof Request ? entrada.url : entrada), "http://localhost");
  const metodo = (init?.method ?? "GET").toUpperCase();
  const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
  if (metodo !== "GET") {
    await new Promise((pronto) => setTimeout(pronto, estado.postAtraso));
    if (estado.postFalha) return json({ message: "Falha interna no servidor." }, 500);
    estado.configSalva = { ...CONFIG, ...(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>) };
    return json(estado.configSalva);
  }
  await new Promise((pronto) => setTimeout(pronto, estado.atrasos[url.pathname] ?? 30));
  if (estado.falhas.has(url.pathname)) return json({ message: "Falha interna no servidor." }, 500);
  if (url.pathname === "/api/billing/price-list") return json({ items: PRECOS });
  if (url.pathname === "/api/billing/config") return json(estado.configSalva ?? CONFIG);
  return json({ items: [] });
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
  estado.postFalha = false;
  estado.configSalva = null;
  window.localStorage.clear();
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

async function montar() {
  raiz = createRoot(container);
  await act(async () => {
    raiz!.render(
      <ProvedorDaConexao value={conexaoEm("conectado")}>
        <QueryClientProvider client={cliente}>
          <Anunciador />
          <PriceList />
        </QueryClientProvider>
      </ProvedorDaConexao>,
    );
  });
}

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
function botao(rotulo: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (item) => (item.querySelector(".botao-acao-camada[data-atual]")?.textContent ?? item.textContent ?? "").trim() === rotulo,
  );
}

/** O HTML visto em cada estado, para o axe no fim do teste, com o relógio de verdade (o do jsdom dele). */
const paraOAxe: string[] = [];
async function axeDoQueVimos() {
  vi.useRealTimers();
  for (const html of paraOAxe.splice(0)) expect(await violacoesDeAcessibilidade(html)).toEqual([]);
}

describe("a Tabela de preços antes de ler", () => {
  it("a linha sob \"Serviços e valores\" diz \"Carregando serviços…\" aos 300 ms, com as linhas-fantasma; a cobrança não mostra campos vazios", async () => {
    estado.atrasos = { "/api/billing/price-list": 2_000, "/api/billing/config": 2_000 };
    await montar();
    expect(texto()).not.toMatch(/Carregando serviços\.\.\.|Nenhum serviço/);
    // A cobrança não afirma uma taxa vazia: nem o campo nem o salvar existem antes de a configuração chegar.
    expect(container.querySelector("#billing-rate")).toBeNull();
    expect(botao("Salvar cobrança")).toBeUndefined();
    expect(container.querySelector("[data-fantasmas][data-visivel]")).toBeNull();
    await passar(350);
    expect(linha()?.textContent).toContain("Carregando serviços…");
    expect(container.querySelectorAll("tr[data-fantasmas][data-visivel]").length).toBeGreaterThan(0);
    const corpo = container.querySelector('tbody[aria-busy="true"]');
    expect(corpo?.getAttribute("aria-describedby")).toBe(linha()?.id);
    expect(container.querySelector('section[aria-busy="true"] h2')?.textContent).toBe("Cobrança");
    expect(
      textosForaDaLista(semAnunciador(), [
        "Serviços e valores", "Novo item", "Carregando serviços…", "Serviço", "Grupo", "Unidade", "Valor unit.", "Quantidade", "Cobrança",
        "Carregando a cobrança…", "Taxa ad valorem (%)", "Nome do cliente", "E-mail para envio da fatura",
      ]),
    ).toEqual([]);
    paraOAxe.push(semAnunciador());
    await passar(2_000);
    expect(texto()).toContain("Etiquetagem");
    expect(container.querySelector<HTMLInputElement>("#billing-rate")?.value).toBe("0.5");
    expect(linha()?.textContent).toMatch(/Atualizado às/);
    await axeDoQueVimos();
  });

  it("a tabela que falha sem nada lido diz que não conseguiu, com \"Tentar de novo\", nunca \"Nenhum serviço\"", async () => {
    estado.falhas = new Set(["/api/billing/price-list"]);
    await montar();
    await passar(300);
    expect(texto()).toContain("Não consegui carregar a tabela.");
    expect(botao("Tentar de novo")).toBeDefined();
    expect(texto()).not.toContain("Nenhum serviço");
  });

  it("a releitura que falha com a tabela lida não a apaga: a linha diz \"Não consegui atualizar\"", async () => {
    await montar();
    await passar(300);
    expect(texto()).toContain("Etiquetagem");
    estado.falhas = new Set(["/api/billing/price-list"]);
    await act(async () => {
      void cliente.invalidateQueries();
    });
    await passar(300);
    expect(texto()).toContain("Etiquetagem");
    expect(linha()?.textContent).toContain("Não consegui atualizar");
  });
});

describe("Salvar cobrança", () => {
  it("fica ocupado sem disabled, diz \"Salvando…\" aos 300 ms e o foco fica nele", async () => {
    await montar();
    await passar(300);
    const salvar = botao("Salvar cobrança");
    if (!salvar) throw new Error("sem Salvar cobrança");
    salvar.focus();
    await act(async () => {
      salvar.click();
    });
    expect(salvar.disabled).toBe(false);
    await passar(350);
    expect(salvar.getAttribute("aria-busy")).toBe("true");
    expect(salvar.textContent).toContain("Salvando…");
    expect(salvar.textContent).not.toContain("Salvando...");
    expect(document.activeElement).toBe(salvar);
    paraOAxe.push(semAnunciador());
    await passar(1_500);
    expect(salvar.getAttribute("aria-busy")).toBeNull();
    expect(document.activeElement).toBe(salvar);
    await axeDoQueVimos();
  });
});

const linhaDaCobranca = () => container.querySelectorAll("[data-linha-de-estado]")[1] ?? null;
const camadaAtual = (item: HTMLButtonElement | undefined) => item?.querySelector(".botao-acao-camada[data-atual]")?.textContent ?? null;
/** Os textos da Cobrança e da tabela lidas, e de cada estado da ação (a trava contra legenda, também nos estados). */
const TEXTOS_LIDOS = [
  "Serviços e valores", "Novo item", /^Atualizado às \d{2}:\d{2}$/, "Serviço", "Grupo", "Unidade", "Valor unit.", "Quantidade", "Posição palete",
  "Etiquetagem", "Armazenamento", "Serviços de Valor Agregado", "posição", "peça", /^R\$/, "Manual", "Cobrança", "Taxa ad valorem (%)",
  "Aplicada sobre o valor total do estoque.", "Nome do cliente", "E-mail para envio da fatura", "Salvar cobrança", "Salvando…", "Cobrança salva",
  "Cobrança não salva", "Conferir",
];

describe("a Tabela de preços depois da revisão (parte 13d)", () => {
  it("a tabela que falhou e é relida sem a pessoa pedir mantém o aviso, nunca volta a \"Carregando\" nem diz \"Tentando de novo…\"", async () => {
    estado.falhas = new Set(["/api/billing/price-list"]);
    await montar();
    await passar(300);
    expect(texto()).toContain("Não consegui carregar a tabela.");
    estado.atrasos = { "/api/billing/price-list": 3_000 };
    await act(async () => {
      void cliente.invalidateQueries({ queryKey: ["/api/billing/price-list"] });
    });
    await passar(1_000);
    expect(texto()).toContain("Não consegui carregar a tabela.");
    expect(botao("Tentar de novo")).toBeDefined();
    expect(texto()).not.toMatch(/Tentando de novo|Carregando serviços/);
  });

  it("a linha de estado da tabela fica na largura do cartão, fora da fileira do \"Novo item\": a demora no celular não o cobre", async () => {
    await montar();
    await passar(300);
    const novo = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.includes("Novo item"))!;
    expect(linha()?.parentElement?.contains(novo)).toBe(true);
    expect(novo.parentElement?.contains(linha())).toBe(false);
  });

  it("a cobrança que lê tem a casa do estado dela: \"Carregando a cobrança…\" aos 300 ms, a demora com \"Tentar de novo\" aos 10 s", async () => {
    estado.atrasos = { "/api/billing/config": 60_000 };
    await montar();
    await passar(350);
    expect(linhaDaCobranca()?.textContent).toContain("Carregando a cobrança…");
    const secao = container.querySelector('section[aria-busy="true"]');
    expect(secao?.getAttribute("aria-describedby")).toBe(linhaDaCobranca()?.id);
    await passar(10_200);
    expect(linhaDaCobranca()?.textContent).toContain("Demorando mais que o normal");
    expect(linhaDaCobranca()?.querySelector(".linha-de-estado-tentar")?.textContent).toBe("Tentar de novo");
  });

  it("o \"Tentar de novo\" da cobrança que falhou leva o foco à linha dela quando a cobrança chega, nunca ao body", async () => {
    estado.falhas = new Set(["/api/billing/config"]);
    await montar();
    await passar(300);
    expect(texto()).toContain("Não consegui carregar a cobrança.");
    const tentar = Array.from(container.querySelectorAll<HTMLButtonElement>("section button")).find((item) => item.textContent?.trim() === "Tentar de novo" && item.closest("section")?.querySelector("h2")?.textContent === "Cobrança");
    expect(tentar).toBeDefined();
    estado.falhas = new Set();
    tentar!.focus();
    await act(async () => tentar!.click());
    await passar(1_000);
    expect(container.querySelector("#billing-rate")).not.toBeNull();
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(linhaDaCobranca());
  });

  it("Salvar cobrança diz \"Cobrança salva\" até a configuração relida chegar; no erro, \"Cobrança não salva\" por 2 s", async () => {
    await montar();
    await passar(300);
    const salvar = botao("Salvar cobrança")!;
    estado.atrasos = { "/api/billing/config": 4_000 };
    salvar.focus();
    await act(async () => salvar.click());
    await passar(350);
    expect(textosForaDaLista(semAnunciador(), TEXTOS_LIDOS)).toEqual([]);
    await passar(1_200);
    expect(camadaAtual(salvar)).toBe("Cobrança salva");
    expect(salvar.getAttribute("aria-disabled")).toBe("true");
    expect(textosForaDaLista(semAnunciador(), TEXTOS_LIDOS)).toEqual([]);
    paraOAxe.push(semAnunciador());
    await passar(2_000);
    expect(camadaAtual(salvar)).toBe("Cobrança salva");
    await passar(2_000);
    expect(camadaAtual(salvar)).toBe("Salvar cobrança");
    expect(document.activeElement).toBe(salvar);
    estado.atrasos = {};
    estado.postFalha = true;
    await act(async () => salvar.click());
    await passar(1_600);
    expect(camadaAtual(salvar)).toBe("Cobrança não salva");
    expect(textosForaDaLista(semAnunciador(), TEXTOS_LIDOS)).toEqual([]);
    await passar(2_100);
    expect(camadaAtual(salvar)).toBe("Salvar cobrança");
    await axeDoQueVimos();
  });

  it("um brilho por cartão (o corpo da tabela e a cobrança), nunca um por bloco; e a chegada entra em cascata", async () => {
    estado.atrasos = { "/api/billing/price-list": 2_000, "/api/billing/config": 2_000 };
    await montar();
    await passar(350);
    expect(container.querySelector("tbody")?.classList.contains("carregando-com-brilho")).toBe(true);
    expect(container.querySelectorAll(".carregando-com-brilho")).toHaveLength(2);
    expect(container.querySelectorAll("[data-esqueleto].carregando-com-brilho")).toHaveLength(0);
    await passar(1_700);
    expect(texto()).toContain("Etiquetagem");
    expect(container.querySelector("tbody[data-chegada]")).not.toBeNull();
  });
});
