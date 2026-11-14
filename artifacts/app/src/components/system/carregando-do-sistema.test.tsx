// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosForaDaLista } from "@/test/textos";

/**
 * O Sistema, a Infraestrutura e o painel do owner no carregamento v2 (parte
 * 13e). Antes: o "Verificar agora" girava e se desabilitava também na
 * releitura de 2 min; o quadro do servidor dizia "Verificando" com o ponto
 * cinza parado, e os da Infra, "Verificando…" com o ponto verde (e "—" verde
 * na falha); os incidentes diziam "Carregando..." solto; o Numerar só
 * apagava; a falha da Infra e a do painel não tinham "Tentar de novo"; e a
 * releitura do painel que falhava apagava o painel lido. Dados sintéticos.
 */

const estado = vi.hoisted(() => ({
  papel: "admin",
  respostas: {} as Record<string, Array<() => Promise<Response>>>,
  leituras: {} as Record<string, number>,
}));

vi.mock("@/lib/auth", () => ({ useAppUser: () => ({ user: { uid: "u1", publicMetadata: { role: estado.papel } } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));

import SettingsSystem from "@/pages/settings-system";
import { BUILD_COMMIT } from "@/lib/build-info";
import { InfraSection, InfraTiles } from "./infra-panels";
import { OwnerDashboard } from "./owner-dashboard";

const SAUDE = {
  ok: true,
  checked_at: "2026-11-13T12:00:00Z",
  firestore_ms: 12,
  last_event: null,
  incidents: [],
};

const INFRA = {
  checked_at: "2026-11-13T12:00:00Z",
  settings: { billing_table: null },
  errors: { status: "ok", total: 0, blocked: 0, services: 0, groups: [] },
  functions: { status: "ok", total: 1, ok: 1, sem_acesso: 0, nao_publicada: 0, codebases: ["default"], last_deploy_at: null, list: [] },
  latency: { status: "ok", total: 0, services: [] },
  billing: { status: "not_configured" },
};

const PAINEL = {
  generated_at: "2026-11-13T12:00:00Z",
  settings: { input_per_million: 0, output_per_million: 0, monthly_budget: null },
  usage: {
    priced: true,
    month: { cost: 0, by_kind: { chat: 0, rotinas: 0, leitura_nota: 0 }, projection: 0, budget: null, over_budget: false },
    days: [
      { day: "2026-11-12", cost: 0, count: 0 },
      { day: "2026-11-13", cost: 0, count: 0 },
    ],
    week: { count: 0, avg_latency_ms: null, fallback: 0, failed: 0, by_role: [] },
    today: { count: 4, fallback: 0, failed: 0 },
    problems: [],
  },
  usage_truncated: false,
  routines: { list: [], active: 0, failed: 0, problems: [] },
};

const json = (corpo: unknown, status = 200) => async () => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
const presa = () => new Promise<Response>(() => undefined);
const lenta = (corpo: unknown, ms: number) => () => new Promise<Response>((pronto) => setTimeout(() => pronto(new Response(JSON.stringify(corpo), { status: 200 })), ms));

let raiz: Root | null = null;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  estado.papel = "admin";
  estado.respostas = {};
  estado.leituras = {};
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const caminho = new URL(url, window.location.origin).pathname;
      estado.leituras[caminho] = (estado.leituras[caminho] ?? 0) + 1;
      const fila = estado.respostas[caminho] ?? [];
      const proxima = fila.length > 1 ? fila.shift()! : fila[0];
      return proxima ? proxima() : json({})();
    }),
  );
  container = document.createElement("div");
  document.body.append(container);
  raiz = createRoot(container);
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const espera = (ms: number) => act(async () => new Promise((pronto) => setTimeout(pronto, ms)));

/**
 * Espera a tela chegar ao estado, em passos de 20 ms, até 3 s. Os marcos (os 300 ms da caixa, a resposta da
 * leitura) dependem do relógio de verdade: com a máquina ocupada, um tempo fixo logo depois do marco falha à toa.
 */
async function ate(condicao: () => unknown, limiteMs = 3_000) {
  const fim = Date.now() + limiteMs;
  while (!condicao()) {
    if (Date.now() > fim) throw new Error("A tela não chegou ao estado esperado em 3 s.");
    await espera(20);
  }
}
let cliente: QueryClient;

async function montar(tela: ReactNode) {
  cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => raiz!.render(<QueryClientProvider client={cliente}>{tela}</QueryClientProvider>));
}

/** O botão pelo rótulo; o botão de ação, pela camada que está na tela. */
function botao(rotulo: string) {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent?.trim() === rotulo || item.querySelector(".botao-acao-camada[data-atual]")?.textContent?.trim() === rotulo,
  );
}

function quadro(rotulo: string) {
  return [...container.querySelectorAll<HTMLElement>("div.rounded-lg")].find((item) => item.firstElementChild?.textContent === rotulo)!;
}

describe("Sistema na primeira leitura", () => {
  it("o quadro do servidor não afirma nada: o bloco e, aos 300 ms, a caixa com Verificando…, sem o ponto", async () => {
    estado.respostas["/api/system/health"] = [presa];
    await montar(<SettingsSystem />);
    expect(quadro("Servidor").querySelector("[data-esqueleto]")).not.toBeNull();
    expect(quadro("Servidor").textContent).not.toContain("Verificando");
    // Cada região tem o seu relógio: a caixa do servidor e a dos incidentes passam dos 300 ms quase juntas.
    await ate(() => quadro("Servidor").textContent?.includes("Verificando…") && container.textContent?.includes("Carregando incidentes…"));
    expect(quadro("Servidor").textContent).toContain("Verificando…");
    expect(quadro("Servidor").querySelector("[data-spinner]")).not.toBeNull();
    expect(quadro("Servidor").querySelector(".bg-slate-300, .bg-green-600")).toBeNull();
    // Os incidentes: a caixa e o rótulo no gerúndio, não o "Carregando..." solto.
    expect(container.textContent).toContain("Carregando incidentes…");
    expect(container.textContent).not.toContain("Carregando...");
    // O "Verificar agora" não gira sozinho na primeira leitura nem fica desabilitado.
    const verificar = botao("Verificar agora")!;
    expect(verificar.disabled).toBe(false);
    expect(verificar.hasAttribute("aria-busy")).toBe(false);
    expect(container.querySelector(".animate-spin")).toBeNull();
    expect(
      textosForaDaLista(container.innerHTML, [
        "Sistema", "O sistema está no ar e com a versão certa?", "Verificar agora", "Verificando…", "Verificando o sistema…", "Conferir",
        "Servidor", "Versão publicada", /^build de /, BUILD_COMMIT, "Último registro de operação",
        "Incidentes", "Registrar incidente", "Carregando incidentes…",
      ]),
    ).toEqual([]);
    expect(await violacoesDeAcessibilidade(container.innerHTML)).toEqual([]);
  });

  it("sem resposta e sem nada lido: a falha com Tentar de novo no lugar dos incidentes", async () => {
    estado.respostas["/api/system/health"] = [json({ message: "Falhou." }, 500)];
    await montar(<SettingsSystem />);
    await ate(() => quadro("Servidor").textContent?.includes("Sem resposta"));
    expect(quadro("Servidor").textContent).toContain("Sem resposta");
    const incidentes = container.querySelector("section")!;
    expect(incidentes.querySelector('[role="alert"]')?.textContent).toBe("Sem resposta do servidor.");
    expect(botao("Tentar de novo")).toBeTruthy();
    await act(async () => botao("Tentar de novo")!.click());
    await ate(() => estado.leituras["/api/system/health"] === 2);
    expect(estado.leituras["/api/system/health"]).toBe(2);
  });
});

describe("o Verificar agora do Sistema", () => {
  it("a releitura automática não o gira nem o desabilita; o toque mostra Verificando o sistema… com aria-busy", async () => {
    // A leitura tocada fica presa: o "Verificando…" não depende de pegar a janela entre os 300 ms e a resposta.
    estado.respostas["/api/system/health"] = [json(SAUDE), lenta(SAUDE, 800), presa];
    await montar(<SettingsSystem />);
    await ate(() => quadro("Servidor").textContent?.includes("Respondendo"));
    expect(quadro("Servidor").textContent).toContain("Respondendo");
    // A releitura automática (o intervalo de 2 min): nada muda no botão.
    await act(async () => void cliente.invalidateQueries({ queryKey: ["system-health"] }));
    await espera(400);
    expect(botao("Verificar agora")!.hasAttribute("aria-busy")).toBe(false);
    expect(botao("Verificar agora")!.disabled).toBe(false);
    // A releitura automática termina antes do toque, para o toque não pegar carona nela.
    await ate(() => cliente.isFetching() === 0);
    // O toque da pessoa.
    await act(async () => botao("Verificar agora")!.click());
    await ate(() => container.querySelector('button[aria-busy="true"] .botao-acao-camada[data-atual]')?.textContent === "Verificando o sistema…");
    const tocado = container.querySelector<HTMLButtonElement>('button[aria-busy="true"]')!;
    // O gerúndio diz o quê: não é o "Verificando…" do quadro do servidor, nem o do "Ver o que muda".
    expect(tocado.querySelector(".botao-acao-camada[data-atual]")?.textContent).toBe("Verificando o sistema…");
    expect(tocado.getAttribute("aria-disabled")).toBe("true");
    expect(tocado.disabled).toBe(false);
  });
});

describe("o Numerar do Sistema", () => {
  it("Ver o que muda diz Conferindo a numeração… e o Numerar agora espera, sem disabled", async () => {
    estado.papel = "owner";
    estado.respostas["/api/system/health"] = [json(SAUDE)];
    estado.respostas["/api/system/dashboard"] = [json(PAINEL)];
    estado.respostas["/api/system/infra"] = [json(INFRA)];
    estado.respostas["/api/system/request-numbers"] = [presa];
    await montar(<SettingsSystem />);
    await ate(() => botao("Ver o que muda"));
    await act(async () => botao("Ver o que muda")!.click());
    await ate(() => container.querySelector('button[aria-busy="true"] .botao-acao-camada[data-atual]')?.textContent === "Conferindo a numeração…");
    const ver = container.querySelector<HTMLButtonElement>('button[aria-busy="true"]')!;
    expect(ver.querySelector(".botao-acao-camada[data-atual]")?.textContent).toBe("Conferindo a numeração…");
    const numerar = botao("Numerar agora")!;
    expect(numerar.getAttribute("aria-disabled")).toBe("true");
    expect(numerar.disabled).toBe(false);
    expect(ver.disabled).toBe(false);
    const numeracao = [...container.querySelectorAll("section")].find((secao) => secao.textContent?.includes("Numerar pedidos e envios antigos"))!;
    expect(
      textosForaDaLista(numeracao.outerHTML, [
        "Numerar pedidos e envios antigos", /^Dá número PED-\/ENV-/, "Ver o que muda", "Conferindo a numeração…", "Numerar agora", "Numerando…",
        "Numerado", "Não numerado", "Conferir",
      ]),
    ).toEqual([]);
    // No celular, os dois e o Verificar agora têm o alvo de 44 px.
    expect(ver.className).toContain("max-md:min-h-11");
    expect(numerar.className).toContain("max-md:min-h-11");
    expect(botao("Verificar agora")!.className).toContain("max-md:min-h-11");
  });
});

describe("a Infraestrutura", () => {
  it("os quadros lendo não mostram o ponto verde; sem leitura, Sem leitura em vermelho", async () => {
    estado.respostas["/api/system/infra"] = [presa];
    await montar(<InfraTiles />);
    await ate(() => container.textContent?.includes("Verificando…"));
    expect(container.textContent).toContain("Verificando…");
    expect(container.querySelector(".bg-green-600")).toBeNull();
    expect(container.querySelector("[data-spinner]")).not.toBeNull();
    act(() => raiz!.unmount());
    raiz = createRoot(container);
    estado.respostas["/api/system/infra"] = [json({ message: "Sem permissão." }, 500)];
    await montar(<InfraTiles />);
    await ate(() => container.textContent?.includes("Sem leitura"));
    expect(container.textContent).toContain("Sem leitura");
    expect(container.querySelector(".bg-green-600")).toBeNull();
    expect(container.querySelector(".bg-red-600")).not.toBeNull();
    expect(
      textosForaDaLista(container.innerHTML, ["Erros do servidor · 24 h", "Functions", "Verificando…", "Sem leitura", "Veja a seção Infraestrutura"]),
    ).toEqual([]);
  });

  it("a consulta que falhou tem Tentar de novo; a verificação que falha depois não apaga o painel", async () => {
    estado.respostas["/api/system/infra"] = [json({ message: "Sem permissão." }, 500), json(INFRA), json({ message: "Caiu." }, 500)];
    await montar(<InfraSection agentMonthCost={null} />);
    await ate(() => container.textContent?.includes("Consultando o Google Cloud…") || container.textContent?.includes("Não consegui consultar"));
    await ate(() => container.textContent?.includes("Não consegui consultar a infraestrutura"));
    expect(container.textContent).toContain("Não consegui consultar a infraestrutura: Sem permissão.");
    await act(async () => botao("Tentar de novo")!.click());
    await ate(() => container.textContent?.includes("Erros do servidor"));
    expect(container.textContent).toContain("Erros do servidor");
    await act(async () => void cliente.refetchQueries({ queryKey: ["system-infra"] }));
    await ate(() => container.textContent?.includes("Não consegui verificar de novo"));
    expect(container.textContent).toContain("Erros do servidor");
    expect(container.textContent).toContain("Não consegui verificar de novo: Caiu.");
    const falha = container.querySelector<HTMLElement>("[data-falha-na-secao]")!;
    expect(textosForaDaLista(falha.outerHTML, ["Não consegui verificar de novo: Caiu.", "Tentar de novo", "Tentando de novo…"])).toEqual([]);
    expect(await violacoesDeAcessibilidade(container.innerHTML)).toEqual([]);
  });
});

describe("o painel do owner", () => {
  it("lendo, a caixa com o rótulo; a releitura que falha não apaga o painel lido", async () => {
    estado.respostas["/api/system/dashboard"] = [lenta(PAINEL, 500), json({ message: "Caiu." }, 500)];
    estado.respostas["/api/system/infra"] = [json(INFRA)];
    await montar(<OwnerDashboard />);
    await ate(() => container.textContent?.includes("Carregando o painel…"));
    expect(container.textContent).toContain("Carregando o painel…");
    expect(container.querySelector("[data-carregando-na-regiao] [data-spinner]")).not.toBeNull();
    await ate(() => container.textContent?.includes("Agent Dute hoje"));
    expect(container.textContent).toContain("Agent Dute hoje");
    await act(async () => void cliente.refetchQueries({ queryKey: ["system-dashboard"] }));
    await ate(() => container.textContent?.includes("Não consegui atualizar o painel"));
    expect(container.textContent).toContain("Agent Dute hoje");
    expect(container.textContent).toContain("Não consegui atualizar o painel: Caiu.");
  });

  it("a releitura de 1 min que falha fica escrita, sem falar; a seguinte não muda o Tentar de novo", async () => {
    estado.respostas["/api/system/dashboard"] = [json(PAINEL), json({ message: "Caiu." }, 500), presa];
    estado.respostas["/api/system/infra"] = [json(INFRA)];
    await montar(<OwnerDashboard />);
    await ate(() => container.textContent?.includes("Agent Dute hoje"));
    // A releitura do intervalo (a pessoa não pediu): a falha fica escrita em cima do painel, sem região viva.
    await act(async () => void cliente.refetchQueries({ queryKey: ["system-dashboard"] }));
    await ate(() => container.textContent?.includes("Não consegui atualizar o painel"));
    const falha = container.querySelector<HTMLElement>("[data-falha-na-secao]")!;
    expect(falha.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(textosForaDaLista(falha.outerHTML, ["Não consegui atualizar o painel: Caiu.", "Tentar de novo", "Tentando de novo…"])).toEqual([]);
    // A releitura automática seguinte (presa): o botão não vira "Tentando de novo…", nem fica ocupado.
    await act(async () => void cliente.refetchQueries({ queryKey: ["system-dashboard"] }));
    await espera(600);
    const tentar = falha.querySelector<HTMLButtonElement>("button")!;
    expect(tentar.textContent).toBe("Tentar de novo");
    expect(tentar.hasAttribute("aria-busy")).toBe(false);
    expect(tentar.hasAttribute("aria-disabled")).toBe(false);
  });
});

describe("a nova tentativa que dá certo", () => {
  it("nos incidentes, o foco que estava no Tentar de novo vai ao título da seção, nunca ao body", async () => {
    estado.respostas["/api/system/health"] = [json({ message: "Falhou." }, 500), lenta(SAUDE, 200)];
    await montar(<SettingsSystem />);
    await ate(() => botao("Tentar de novo"));
    botao("Tentar de novo")!.focus();
    await act(async () => botao("Tentar de novo")!.click());
    await ate(() => container.textContent?.includes("Nenhum incidente registrado."));
    await espera(50);
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.textContent).toBe("Incidentes");
  });

  it("na Infraestrutura, o foco que estava no Tentar de novo não cai no body", async () => {
    estado.respostas["/api/system/infra"] = [json({ message: "Sem permissão." }, 500), lenta(INFRA, 200)];
    await montar(
      <main>
        <h1>Sistema</h1>
        <InfraSection agentMonthCost={null} />
      </main>,
    );
    await ate(() => botao("Tentar de novo"));
    botao("Tentar de novo")!.focus();
    await act(async () => botao("Tentar de novo")!.click());
    await ate(() => container.textContent?.includes("Erros do servidor"));
    await espera(50);
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.tagName).toMatch(/^H[1-6]$/);
  });
});

describe("o Verificar agora da Infraestrutura", () => {
  it("diz o que verifica, tem 44 px no celular e, com o ponteiro em cima, só sublinha (sem o fundo do ghost)", async () => {
    estado.respostas["/api/system/infra"] = [json(INFRA), presa];
    await montar(<InfraSection agentMonthCost={null} />);
    await ate(() => container.textContent?.includes("Erros do servidor"));
    const verificar = botao("Verificar agora")!;
    expect(verificar.className).toContain("hover:bg-transparent");
    expect(verificar.className).toContain("max-md:min-h-11");
    await act(async () => verificar.click());
    await ate(() => container.querySelector('button[aria-busy="true"] .botao-acao-camada[data-atual]')?.textContent === "Verificando a infraestrutura…");
  });
});
