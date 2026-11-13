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
 * "Para aprovar" com a ação por linha (carregamento v2, momento 4, parte 6b;
 * a prancha aprovada em 12/11/2026): aprovar a 1042 deixa a 1043 e a 1045
 * livres, o Recusar da 1042 fica aria-disabled, e a espera longa vira o
 * "Conferir", que relê a solicitação e nunca reenvia. Dados sintéticos.
 */

type Decisao = {
  id: string;
  acao: string;
  corpo: Record<string, unknown>;
  responder: (corpo: unknown, status?: number) => void;
};

const estado = vi.hoisted(() => ({
  toast: vi.fn(),
  solicitacoes: [] as Array<Record<string, unknown>>,
  ops: { queues: {}, alerts: [] } as Record<string, unknown>,
  avancos: [] as string[],
  decisoes: [] as Decisao[],
  leituras: [] as string[],
}));

vi.mock("@/lib/auth", () => ({ useAppUser: () => ({ user: { publicMetadata: { role: "admin" } } }) }));
vi.mock("@/lib/active-customer-context", () => ({ useActiveCustomer: () => ({ active: { code: "BTG", name: "BTG Pactual" }, code: "BTG" }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: estado.toast }) }));
vi.mock("@/lib/operacao/leitura", () => ({
  useLeitura: () => ({ itens: [], erro: false }),
  useDocumento: () => ({ item: undefined, erro: false }),
}));
vi.mock("@/features/warehouse-ops/opening-inventory-status", () => ({
  useOpeningInventorySession: () => ({ data: undefined }),
  OpeningInventoryNotice: () => null,
}));

import Pedidos, { noMeioDaFrase } from "./pedidos";

const AGORA = new Date("2026-11-13T13:00:00.000Z");

function solicitacao(numero: string, unidades: number) {
  return {
    id: `req_${numero}`,
    type: "retirada",
    customer_code: "BTG Pactual",
    description: `Pedido ${numero}`,
    status: "open",
    stock_reservation_status: "reserved",
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

async function servir(entrada: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(String(entrada), "http://localhost");
  const metodo = (init?.method ?? "GET").toUpperCase();
  if (url.pathname === "/api/warehouse/ops") return resposta(estado.ops);
  const avanco = url.pathname.match(/^\/api\/warehouse\/tasks\/([^/]+)\/advance$/);
  if (avanco && metodo === "POST") {
    // A entrega fica em andamento até o fim do teste.
    estado.avancos.push(decodeURIComponent(avanco[1]));
    return new Promise(() => undefined);
  }
  if (url.pathname === "/api/stock-balances") return resposta({ items: [] });
  if (url.pathname === "/api/customer-requests") return resposta({ items: estado.solicitacoes.map((item) => ({ ...item })) });
  const decisao = url.pathname.match(/^\/api\/customer-requests\/([^/]+)\/(approve|reject)$/);
  if (decisao && metodo === "POST") {
    return new Promise((resolver) => {
      estado.decisoes.push({
        id: decodeURIComponent(decisao[1]),
        acao: decisao[2],
        corpo: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
        responder: (corpo, status = 200) => resolver(resposta(corpo, status)),
      });
    });
  }
  const leitura = url.pathname.match(/^\/api\/customer-requests\/([^/]+)$/);
  if (leitura && metodo === "GET") {
    const id = decodeURIComponent(leitura[1]);
    estado.leituras.push(id);
    const achada = estado.solicitacoes.find((item) => item.id === id);
    return achada ? resposta({ ...achada }) : resposta({ message: "Registro não encontrado." }, 404);
  }
  throw new Error(`API inesperada: ${metodo} ${url.pathname}`);
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
  while (no && !no.querySelector("button")) no = no.parentElement;
  if (!no) throw new Error(`sem a linha ${titulo}`);
  return no;
}

/** O rótulo do botão em repouso: a camada de repouso do botão de ação, ou o texto do botão comum. */
function rotuloDeRepouso(botao: HTMLButtonElement): string {
  return (botao.querySelector('[data-camada="repouso"]')?.textContent ?? botao.textContent ?? "").trim();
}

/** O rótulo que está na tela: a camada atual do botão de ação, ou o texto do botão comum. */
function rotuloAtual(botao: HTMLButtonElement): string {
  return (botao.querySelector(".botao-acao-camada[data-atual]")?.textContent ?? botao.textContent ?? "").trim();
}

function botao(titulo: string, rotulo: "Aprovar" | "Recusar"): HTMLButtonElement {
  const achado = Array.from(linha(titulo).querySelectorAll("button")).find((item) => rotuloDeRepouso(item) === rotulo);
  if (!achado) throw new Error(`sem ${rotulo} em ${titulo}`);
  return achado;
}

async function tocar(alvo: HTMLButtonElement) {
  await act(async () => {
    alvo.click();
  });
}

function grupoParaAprovar(): HTMLElement {
  const grupo = Array.from(container!.querySelectorAll("section")).find((section) => section.querySelector("h2")?.textContent?.startsWith("Para aprovar"));
  if (!grupo) throw new Error("sem o grupo Para aprovar");
  return grupo;
}

function anuncio(): string {
  return container!.querySelector("[data-anunciador]")?.textContent ?? "";
}

/** Livre: nem desabilitado nem travado. */
function livre(alvo: HTMLButtonElement) {
  return !alvo.hasAttribute("disabled") && alvo.getAttribute("aria-disabled") !== "true";
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(AGORA);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(servir));
  estado.toast.mockReset();
  estado.decisoes.length = 0;
  estado.leituras.length = 0;
  estado.avancos.length = 0;
  estado.ops = { queues: {}, alerts: [] };
  estado.solicitacoes = [solicitacao("1042", 12), solicitacao("1043", 40), solicitacao("1045", 120)];
  cliente = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
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
  for (let vez = 0; vez < 20 && !container.textContent?.includes("Pedido 1045"); vez += 1) await passar(10);
  expect(container.textContent).toContain("Pedido 1045");
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

describe("cada linha de Para aprovar tem a própria ação", () => {
  it("aprovar a 1042 deixa a 1043 e a 1045 livres, e o Recusar da 1042 fica aria-disabled, sem disabled", async () => {
    await tocar(botao("Pedido 1042", "Aprovar"));
    await passar(CARREGANDO.atrasoMs);

    expect(estado.decisoes.map(({ id, acao }) => `${id}:${acao}`)).toEqual(["req_1042:approve"]);
    const aprovar = botao("Pedido 1042", "Aprovar");
    expect(aprovar.getAttribute("aria-busy")).toBe("true");
    expect(rotuloAtual(aprovar)).toBe("Aprovando…");
    const recusar = botao("Pedido 1042", "Recusar");
    expect(recusar.getAttribute("aria-disabled")).toBe("true");
    // Ocupado não é desabilitado: o foco não cai no body.
    expect(aprovar.hasAttribute("disabled")).toBe(false);
    expect(recusar.hasAttribute("disabled")).toBe(false);

    for (const titulo of ["Pedido 1043", "Pedido 1045"]) {
      expect(livre(botao(titulo, "Aprovar")), titulo).toBe(true);
      expect(livre(botao(titulo, "Recusar")), titulo).toBe(true);
    }

    // A 1043 aprova ao mesmo tempo, com a própria chave.
    await tocar(botao("Pedido 1043", "Aprovar"));
    expect(estado.decisoes.map(({ id, acao }) => `${id}:${acao}`)).toEqual(["req_1042:approve", "req_1043:approve"]);
    expect(estado.decisoes[1].corpo.idempotency_key).not.toBe(estado.decisoes[0].corpo.idempotency_key);

    // O segundo toque na 1042 não chama de novo.
    await tocar(botao("Pedido 1042", "Aprovar"));
    await tocar(botao("Pedido 1042", "Recusar"));
    expect(estado.decisoes).toHaveLength(2);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("a barra corre na borda de baixo da linha em andamento, e só nela", async () => {
    await tocar(botao("Pedido 1042", "Aprovar"));
    await passar(CARREGANDO.atrasoMs);
    const barras = Array.from(grupoParaAprovar().querySelectorAll("[data-barra]"));
    expect(barras).toHaveLength(1);
    expect(linha("Pedido 1042").contains(barras[0]) || barras[0].parentElement?.contains(linha("Pedido 1042"))).toBe(true);
    expect(barras[0].getAttribute("data-lugar")).toBe("linha");
    expect(barras[0].getAttribute("aria-hidden")).toBe("true");
  });

  it("aos 300 ms o anúncio, aos 3 s o objeto no apoio da linha e aos 10 s a demora com o relógio, sem Tentar de novo", async () => {
    await tocar(botao("Pedido 1042", "Aprovar"));
    await passar(CARREGANDO.atrasoMs);
    expect(anuncio()).toBe("Aprovando pedido 1042");
    expect(linha("Pedido 1042").textContent).toContain("Retirada · BTG Pactual");

    await passar(CARREGANDO.objetoNaLinhaMs - CARREGANDO.atrasoMs);
    expect(linha("Pedido 1042").textContent).toContain("Aprovando pedido 1042…");
    expect(linha("Pedido 1042").textContent).not.toContain("Retirada · BTG Pactual");
    // As outras linhas não mudam.
    expect(linha("Pedido 1043").textContent).toContain("Retirada · BTG Pactual");

    await passar(12_000 - CARREGANDO.objetoNaLinhaMs);
    const texto = linha("Pedido 1042").textContent ?? "";
    expect(texto).toContain("Demorando mais que o normal");
    expect(texto).toContain("0:12");
    expect(texto).not.toContain("Aprovando pedido 1042…");
    expect(texto).not.toContain("Tentar de novo");
    await passar(1_000);
    expect(linha("Pedido 1042").textContent).toContain("0:13");
    // O relógio fica fora da região viva; ela fala a demora uma vez.
    expect(anuncio()).toBe("Demorando mais que o normal");
    expect(grupoParaAprovar().querySelector("[aria-live]")).toBeNull();
  });
});

describe("as outras ações da tela", () => {
  it("a entrega em andamento não apaga a fila de aprovar", async () => {
    estado.ops = {
      alerts: [],
      queues: {
        expedition: {
          key: "expedition",
          tasks: [{ id: "ship_1", reference: "ship_ord_1", title: "PED-0001", status: "ready_to_dispatch", can_advance: true, exception_count: 0 }],
        },
      },
    };
    await act(async () => {
      await cliente.invalidateQueries({ queryKey: ["warehouse-ops"] });
    });
    await passar(10);
    const entregue = Array.from(container!.querySelectorAll("button")).find((item) => item.textContent === "Entregue")!;
    await tocar(entregue);
    const placa = document.querySelector<HTMLInputElement>("#placa")!;
    const definir = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      definir.call(placa, "ABC1D23");
      placa.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const confirmar = Array.from(document.querySelectorAll('[role="dialog"] button')).find((item) => item.textContent === "Confirmar entrega") as HTMLButtonElement;
    await tocar(confirmar);
    await passar(10);
    expect(estado.avancos).toEqual(["ship_1"]);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Registrando...");
    const voltar = Array.from(document.querySelectorAll('[role="dialog"] button')).find((item) => item.textContent === "Voltar") as HTMLButtonElement;
    await tocar(voltar);
    await passar(10);

    for (const titulo of ["Pedido 1042", "Pedido 1043", "Pedido 1045"]) {
      expect(livre(botao(titulo, "Aprovar")), titulo).toBe(true);
      expect(livre(botao(titulo, "Recusar")), titulo).toBe(true);
    }
    // O "Entregue" segue o busy de antes.
    expect(Array.from(container!.querySelectorAll("button")).find((item) => item.textContent === "Entregue")?.hasAttribute("disabled")).toBe(true);
  });
});

describe("o objeto no meio da frase", () => {
  it("a primeira palavra comum perde a maiúscula; a sigla e o número ficam", () => {
    expect(noMeioDaFrase("Pedido 1042")).toBe("pedido 1042");
    expect(noMeioDaFrase("Évento de fim de ano")).toBe("évento de fim de ano");
    expect(noMeioDaFrase("BTG Pactual")).toBe("BTG Pactual");
    expect(noMeioDaFrase("PED-0043")).toBe("PED-0043");
    expect(noMeioDaFrase("1042")).toBe("1042");
    expect(noMeioDaFrase("")).toBe("");
  });
});

describe("aos 70 s, Conferir relê em vez de reenviar", () => {
  async function semResposta() {
    await tocar(botao("Pedido 1042", "Aprovar"));
    await passar(CARREGANDO.desisteMs);
    const aprovar = botao("Pedido 1042", "Aprovar");
    expect(rotuloAtual(aprovar)).toBe("Conferir");
    expect(aprovar.getAttribute("aria-disabled")).toBeNull();
    expect(linha("Pedido 1042").textContent).toContain("Sem confirmação");
    expect(grupoParaAprovar().querySelectorAll("[data-barra]")).toHaveLength(0);
    return aprovar;
  }

  it("Conferir lê a solicitação; se ela não saiu de para aprovar, volta a Aprovar, e a nova tentativa leva a mesma chave", async () => {
    const conferir = await semResposta();
    expect(estado.decisoes).toHaveLength(1);

    await tocar(conferir);
    await passar(10);
    expect(estado.leituras).toEqual(["req_1042"]);
    expect(estado.decisoes).toHaveLength(1);
    const aprovar = botao("Pedido 1042", "Aprovar");
    expect(rotuloAtual(aprovar)).toBe("Aprovar");
    expect(linha("Pedido 1042").textContent).not.toContain("Sem confirmação");

    // A pessoa toca de novo (o toque único do botão ignora o segundo dentro de 1 s).
    await passar(1_000);
    await tocar(aprovar);
    expect(estado.decisoes).toHaveLength(2);
    expect(estado.decisoes[1].corpo.idempotency_key).toBe(estado.decisoes[0].corpo.idempotency_key);
    expect(estado.decisoes[1].corpo.expected_status).toBe("open");
  });

  it("Conferir que acha a solicitação aprovada segue o sucesso, sem reenviar, com o toast", async () => {
    const conferir = await semResposta();
    estado.solicitacoes[0].status = "approved";
    await tocar(conferir);
    await passar(CARREGANDO.atrasoMs + CARREGANDO.minimoMs);
    expect(estado.decisoes).toHaveLength(1);
    expect(rotuloAtual(botao("Pedido 1042", "Aprovar"))).toBe("Aprovado");
    expect(estado.toast).toHaveBeenCalledWith({ title: "Pedido 1042 aprovado" });
    // A resposta que chega depois não repete o toast.
    await act(async () => estado.decisoes[0].responder({ ok: true }));
    expect(estado.toast).toHaveBeenCalledTimes(1);
  });
});

describe("o resultado na linha", () => {
  it("no sucesso, Aprovado no botão e a barra completa em verde; a linha fica até a releitura, e o toast diz o número", async () => {
    await tocar(botao("Pedido 1042", "Aprovar"));
    await passar(400);
    estado.solicitacoes[0].status = "approved";
    await act(async () => estado.decisoes[0].responder({ ok: true }));
    await passar(CARREGANDO.minimoMs);
    expect(rotuloAtual(botao("Pedido 1042", "Aprovar"))).toBe("Aprovado");
    expect(grupoParaAprovar().querySelector("[data-barra]")?.getAttribute("data-estado")).toBe("ok");
    expect(estado.toast).toHaveBeenCalledWith({ title: "Pedido 1042 aprovado" });

    // O botão mostra o Aprovado aos 800 ms (300 + 500); a releitura já trouxe a
    // solicitação aprovada, mas a linha fica com ele 1 s, até os 1800 ms.
    await passar(CARREGANDO.sucessoVisivelMs - 200);
    expect(container!.textContent).toContain("Pedido 1042");
    expect(rotuloAtual(botao("Pedido 1042", "Aprovar"))).toBe("Aprovado");
    await passar(200);
    expect(container!.textContent).not.toContain("Pedido 1042");
    expect(grupoParaAprovar().querySelector("h2")?.textContent).toBe("Para aprovar2");
  });

  it("no erro, o selo Não aprovado e o motivo ficam na linha até a próxima ação, e o toast diz o motivo", async () => {
    await tocar(botao("Pedido 1042", "Aprovar"));
    await act(async () => estado.decisoes[0].responder({ message: "Saldo insuficiente para 12 un.", code: "failed-precondition" }, 400));
    await passar(10);
    const texto = () => linha("Pedido 1042").textContent ?? "";
    expect(rotuloAtual(botao("Pedido 1042", "Aprovar"))).toBe("Não aprovado");
    expect(texto()).toContain("Saldo insuficiente para 12 un.");
    expect(estado.toast).toHaveBeenCalledWith(expect.objectContaining({ description: "Saldo insuficiente para 12 un.", variant: "destructive" }));
    expect(grupoParaAprovar().querySelector("[data-barra]")?.getAttribute("data-estado")).toBe("erro");

    // Depois de 2 s o botão volta; o selo e o motivo ficam.
    await passar(CARREGANDO.erroVisivelMs);
    expect(rotuloAtual(botao("Pedido 1042", "Aprovar"))).toBe("Aprovar");
    expect(texto()).toContain("Não aprovado");
    expect(texto()).toContain("Saldo insuficiente para 12 un.");

    // A próxima ação tira o motivo; a recusa do servidor encerrou a chave.
    await tocar(botao("Pedido 1042", "Aprovar"));
    expect(texto()).not.toContain("Saldo insuficiente para 12 un.");
    expect(estado.decisoes[1].corpo.idempotency_key).not.toBe(estado.decisoes[0].corpo.idempotency_key);
  });

  it("a resposta sem confirmação do servidor não vira toast de erro: a linha fica com o Conferir", async () => {
    await tocar(botao("Pedido 1042", "Aprovar"));
    await act(async () => estado.decisoes[0].responder({ message: "deadline-exceeded", code: "deadline-exceeded" }, 504));
    await passar(10);
    expect(rotuloAtual(botao("Pedido 1042", "Aprovar"))).toBe("Conferir");
    expect(estado.toast).not.toHaveBeenCalled();
  });
});

describe("a recusa pelo diálogo, com o estado da linha", () => {
  async function digitarMotivo(texto: string) {
    const campo = document.querySelector<HTMLTextAreaElement>("#motivo-da-recusa")!;
    const definir = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    await act(async () => {
      definir.call(campo, texto);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function recusarDoDialogo(): HTMLButtonElement {
    const dialogo = document.querySelector('[role="dialog"]')!;
    return Array.from(dialogo.querySelectorAll("button")).find((item) => rotuloDeRepouso(item) === "Recusar")!;
  }

  it("o motivo vai com a chave da linha; a 1042 fica ocupada e as outras livres; no sucesso, o diálogo fecha", async () => {
    await tocar(botao("Pedido 1042", "Recusar"));
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Recusar solicitação");
    await digitarMotivo("Cliente desistiu");
    await tocar(recusarDoDialogo());
    await passar(CARREGANDO.atrasoMs);

    expect(estado.decisoes.map(({ id, acao }) => `${id}:${acao}`)).toEqual(["req_1042:reject"]);
    expect(estado.decisoes[0].corpo).toMatchObject({ expected_status: "open", reason: "Cliente desistiu" });
    expect(typeof estado.decisoes[0].corpo.idempotency_key).toBe("string");
    expect(rotuloAtual(recusarDoDialogo())).toBe("Recusando…");
    expect(botao("Pedido 1042", "Aprovar").getAttribute("aria-disabled")).toBe("true");
    expect(livre(botao("Pedido 1043", "Aprovar"))).toBe(true);

    estado.solicitacoes[0].status = "rejected";
    await act(async () => estado.decisoes[0].responder({ ok: true }));
    await passar(CARREGANDO.minimoMs);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(estado.toast).toHaveBeenCalledWith({ title: "Solicitação recusada." });
  });

  it("sem o motivo, o Recusar do diálogo não chama nada", async () => {
    await tocar(botao("Pedido 1042", "Recusar"));
    const recusar = recusarDoDialogo();
    expect(recusar.getAttribute("aria-disabled")).toBe("true");
    await tocar(recusar);
    expect(estado.decisoes).toHaveLength(0);
  });
});

describe("os textos e a acessibilidade de Para aprovar", () => {
  const PERMITIDOS: ReadonlyArray<string | RegExp> = [
    "Para aprovar",
    /^\d+$/,
    /^Pedido 104[235]$/,
    /^Retirada · BTG Pactual · \d+ itens · \d+ un\.$/,
    "há 25 min",
    /^· há \d+ min$/,
    "·",
    "Recusar",
    "Recusando…",
    "Recusado",
    "Não recusado",
    "Aprovar",
    "Aprovando…",
    "Aprovado",
    "Não aprovado",
    "Conferir",
    "Aprovando pedido 1042…",
    "Demorando mais que o normal",
    /^\d+:\d{2}$/,
    "Sem confirmação",
    "Saldo insuficiente para 12 un.",
  ];

  it("só rótulos, dados e ações, em cada estado da linha", async () => {
    const vistos: string[] = [];
    const olhar = () => vistos.push(...textosForaDaLista(grupoParaAprovar().outerHTML, PERMITIDOS));
    olhar();
    await tocar(botao("Pedido 1042", "Aprovar"));
    await passar(CARREGANDO.objetoNaLinhaMs);
    olhar();
    await passar(CARREGANDO.demoraMs);
    olhar();
    await passar(CARREGANDO.desisteMs);
    olhar();
    await tocar(botao("Pedido 1043", "Aprovar"));
    await act(async () => estado.decisoes[1].responder({ message: "Saldo insuficiente para 12 un.", code: "failed-precondition" }, 400));
    await passar(10);
    olhar();
    expect(vistos).toEqual([]);
  });

  it("o axe não acusa nada com uma linha em andamento", async () => {
    await tocar(botao("Pedido 1042", "Aprovar"));
    await passar(CARREGANDO.objetoNaLinhaMs);
    const html = grupoParaAprovar().outerHTML;
    expect(html).toContain("Aprovando pedido 1042…");
    // O axe usa o relógio de verdade.
    vi.useRealTimers();
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });
});
