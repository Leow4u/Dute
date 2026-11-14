// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { Anunciador } from "@/lib/carregando/anunciador";
import { CARREGANDO } from "@/lib/carregando/tempo";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { gravarRefluxos, type RefluxosGravados } from "@/test/refluxo";
import { textosDaTela, textosForaDaLista } from "@/test/textos";

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
  respostasDoAvanco: [] as Array<(corpo: unknown, status?: number) => void>,
  decisoes: [] as Decisao[],
  leituras: [] as string[],
  /** Com a lista, a leitura das filas espera até o teste soltar (a releitura que chega depois). */
  opsPresas: null as Array<() => void> | null,
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
  if (url.pathname === "/api/warehouse/ops") {
    const presas = estado.opsPresas;
    if (presas) await new Promise<void>((soltar) => presas.push(soltar));
    return resposta(estado.ops);
  }
  const avanco = url.pathname.match(/^\/api\/warehouse\/tasks\/([^/]+)\/advance$/);
  if (avanco && metodo === "POST") {
    // A entrega fica em andamento até o teste responder.
    estado.avancos.push(decodeURIComponent(avanco[1]));
    return new Promise((resolver) => estado.respostasDoAvanco.push((corpo, status) => resolver(resposta(corpo, status))));
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
  estado.respostasDoAvanco.length = 0;
  estado.opsPresas = null;
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

describe("o anúncio da espera da linha", () => {
  it("a aprovação que acaba antes da vez do anúncio dela não é anunciada depois do resultado", async () => {
    const falados: string[] = [];
    const ouvir = async (ms: number) => {
      for (let feito = 0; feito < ms; feito += 50) {
        await passar(50);
        const texto = anuncio();
        if (texto && texto !== falados[falados.length - 1]) falados.push(texto);
      }
    };
    // A 1043 aprova primeiro e ocupa a região; a 1042 pede o anúncio dela, que espera a vez.
    await tocar(botao("Pedido 1043", "Aprovar"));
    await ouvir(500);
    await tocar(botao("Pedido 1042", "Aprovar"));
    await ouvir(1_000);
    expect(falados).toEqual(["Aprovando pedido 1043"]);
    // A 1042 é aprovada antes da vez do anúncio: o toast diz o resultado, e a região não diz "Aprovando" depois.
    const aprovacao = estado.decisoes.find((decisao) => decisao.id === "req_1042")!;
    await act(async () => aprovacao.responder({ ...estado.solicitacoes[0], status: "approved" }));
    await ouvir(3_000);
    expect(falados).toEqual(["Aprovando pedido 1043"]);
  });
});

describe("as outras ações da tela", () => {
  /**
   * A entrega do PED-0001 em andamento (carregamento v2, parte 11): as
   * etapas Saída → Entrega, o "Voltar" aria-disabled e o diálogo que não
   * fecha enquanto ela anda.
   */
  async function entregaEmAndamento() {
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
    const confirmar = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find((item) => rotuloAtual(item) === "Confirmar entrega")!;
    await tocar(confirmar);
    await passar(CARREGANDO.atrasoMs);
    expect(estado.avancos).toEqual(["ship_1"]);
    const dialogo = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(rotuloAtual(confirmar)).toBe("Confirmando…");
    expect(confirmar.getAttribute("aria-busy")).toBe("true");
    expect(dialogo.querySelector('[role="progressbar"]')?.getAttribute("aria-valuetext")).toBe("Etapa 1 de 2");
    // Só rótulos: a etapa, as duas etapas e os números.
    expect(textosDaTela(dialogo.querySelector('[data-progresso="etapas"]')!.outerHTML)).toEqual(["Etapa", "1", "de 2", "Saída", "2", "Entrega"]);
    return confirmar;
  }

  it("a entrega anda em etapas, segura o diálogo e não apaga a fila de aprovar", async () => {
    await entregaEmAndamento();
    // O Voltar fica aria-disabled e o diálogo não fecha, nem pelo Esc.
    const voltar = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find((item) => item.textContent === "Voltar")!;
    expect(voltar.getAttribute("aria-disabled")).toBe("true");
    await tocar(voltar);
    await act(async () => {
      document.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await passar(10);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();

    for (const titulo of ["Pedido 1042", "Pedido 1043", "Pedido 1045"]) {
      expect(livre(botao(titulo, "Aprovar")), titulo).toBe(true);
      expect(livre(botao(titulo, "Recusar")), titulo).toBe(true);
    }
  });

  it("a segunda etapa entra com a resposta da primeira, e o fim fecha o diálogo", async () => {
    await entregaEmAndamento();
    await act(async () => estado.respostasDoAvanco[0]({ ok: true }));
    await passar(10);
    expect(estado.avancos).toEqual(["ship_1", "ship_1"]);
    expect(document.querySelector('[role="dialog"] [role="progressbar"]')?.getAttribute("aria-valuetext")).toBe("Etapa 2 de 2");
    await act(async () => estado.respostasDoAvanco[1]({ ok: true }));
    await passar(10);
    expect(estado.toast).toHaveBeenCalledWith({ title: "Entrega confirmada. Estoque baixado." });
    await passar(500);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("sem resposta no prazo, \"Sem confirmação do servidor\" e o Conferir, que relê a fila e não reenvia", async () => {
    const confirmar = await entregaEmAndamento();
    await act(async () => estado.respostasDoAvanco[0]({ message: "O servidor não respondeu a tempo. Confira antes de tentar de novo.", code: "deadline-exceeded" }, 504));
    // O "em andamento" fica o mínimo de 500 ms na tela antes do fim.
    await passar(CARREGANDO.minimoMs);
    expect(rotuloAtual(confirmar)).toBe("Conferir");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Sem confirmação do servidor");
    // Nenhum texto cru em inglês.
    expect(document.body.textContent).not.toContain("deadline-exceeded");
    await passar(1_000);
    await tocar(confirmar);
    await passar(10);
    // Releu e o pedido continua para entregar: volta a "Confirmar entrega", sem reenviar.
    expect(estado.avancos).toEqual(["ship_1"]);
    expect(rotuloAtual(confirmar)).toBe("Confirmar entrega");
  });

  /** A saída do PED-0001 fica sem resposta: o diálogo dele em "Conferir". */
  async function entregaSemResposta() {
    const confirmar = await entregaEmAndamento();
    await act(async () => estado.respostasDoAvanco[0]({ message: "O servidor não respondeu a tempo. Confira antes de tentar de novo.", code: "deadline-exceeded" }, 504));
    await passar(1_500);
    expect(rotuloAtual(confirmar)).toBe("Conferir");
    return confirmar;
  }

  const noDialogo = (rotulo: string) =>
    Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find((item) => rotuloAtual(item) === rotulo);

  it("conferindo, que só relê: o botão diz \"Conferindo…\", o \"Sem confirmação do servidor\" fica e o diálogo não fecha", async () => {
    const confirmar = await entregaSemResposta();
    estado.opsPresas = [];
    await tocar(confirmar);
    await passar(CARREGANDO.atrasoMs + 100);
    expect(rotuloAtual(confirmar)).toBe("Conferindo…");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Sem confirmação do servidor");
    // Nenhuma etapa volta a andar: nada foi reenviado.
    expect(document.querySelectorAll('[role="dialog"] [data-etapa="andamento"]')).toHaveLength(0);
    expect(noDialogo("Voltar")?.getAttribute("aria-disabled")).toBe("true");
    expect(noDialogo("Fechar")?.getAttribute("aria-disabled")).toBe("true");
    expect(estado.avancos).toEqual(["ship_1"]);
    for (const soltar of estado.opsPresas.splice(0)) soltar();
    estado.opsPresas = null;
    // A leitura volta (o act segura os efeitos até o fim de cada passo) e o mínimo de 500 ms do "Conferindo…" passa.
    await passar(10);
    await passar(1_000);
    expect(rotuloAtual(confirmar)).toBe("Confirmar entrega");
  });

  it("o pedido que outra pessoa cancelou durante a espera não vira \"Entrega confirmada\"", async () => {
    const confirmar = await entregaSemResposta();
    estado.ops = {
      alerts: [],
      queues: {
        expedition: {
          key: "expedition",
          tasks: [{ id: "ship_1", reference: "ship_ord_1", title: "PED-0001", status: "cancelled", can_advance: false, exception_count: 0 }],
        },
      },
    };
    await tocar(confirmar);
    await passar(1_000);
    const titulos = estado.toast.mock.calls.map((chamada) => (chamada[0] as { title?: string }).title);
    expect(titulos).not.toContain("Entrega confirmada. Estoque baixado.");
    expect(titulos).toContain("Entrega não confirmada");
    expect(estado.avancos).toEqual(["ship_1"]);
  });

  it("o \"Sem confirmação\" de um pedido não passa para o diálogo de outro", async () => {
    await entregaSemResposta();
    // O PED-0002 também está para entregar; a pessoa fecha pelo Voltar e abre a entrega dele.
    estado.ops = {
      alerts: [],
      queues: {
        expedition: {
          key: "expedition",
          tasks: [
            { id: "ship_1", reference: "ship_ord_1", title: "PED-0001", status: "ready_to_dispatch", can_advance: true, exception_count: 0 },
            { id: "ship_2", reference: "ship_ord_2", title: "PED-0002", status: "ready_to_dispatch", can_advance: true, exception_count: 0 },
          ],
        },
      },
    };
    await tocar(noDialogo("Voltar")!);
    await passar(300);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => {
      await cliente.invalidateQueries({ queryKey: ["warehouse-ops"] });
    });
    await passar(50);
    // O "Entregue" da linha do PED-0002: o primeiro ancestral com o número dele e sem o do outro.
    const doSegundo = Array.from(container!.querySelectorAll<HTMLButtonElement>("button")).find((item) => {
      if (item.textContent !== "Entregue") return false;
      let no: HTMLElement | null = item.parentElement;
      while (no && !(no.textContent ?? "").includes("PED-")) no = no.parentElement;
      return Boolean(no && (no.textContent ?? "").includes("PED-0002") && !(no.textContent ?? "").includes("PED-0001"));
    })!;
    await tocar(doSegundo);
    await passar(50);
    const dialogo = document.querySelector('[role="dialog"]')!;
    expect(dialogo.querySelector("h2")?.textContent).toBe("PED-0002: entregue");
    const principal = dialogo.querySelector<HTMLButtonElement>(".botao-acao")!;
    expect(rotuloAtual(principal)).toBe("Confirmar entrega");
    expect(dialogo.textContent).not.toContain("Sem confirmação do servidor");
  });

  it("as etapas e o lugar do aviso ficam no diálogo desde o repouso, e os botões do rodapé têm 44 px", async () => {
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
    await tocar(Array.from(container!.querySelectorAll("button")).find((item) => item.textContent === "Entregue")!);
    const dialogo = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialogo.querySelector('[role="progressbar"]')?.getAttribute("aria-valuetext")).toBe("Etapa 1 de 2");
    expect([...dialogo.querySelectorAll<HTMLElement>("[data-etapa]")].map((etapa) => etapa.dataset.etapa)).toEqual(["fila", "fila"]);
    expect(dialogo.querySelector("[data-lugar-do-aviso]")).not.toBeNull();
    expect(noDialogo("Voltar")?.className).toContain("min-h-11");
    expect(dialogo.querySelector(".botao-acao")?.className).toContain("min-h-11");
    expect(textosForaDaLista(dialogo.outerHTML, ["PED-0001: entregue", "Quem levou", "Placa", "Quem recebeu (opcional)", "Etapa", "1", "de 2", "Saída", "2", "Entrega", "Voltar", "Confirmar entrega", "Confirmando…", "Conferindo…", "Entregue", "Não confirmada", "Conferir", "Fechar"])).toEqual([]);
    vi.useRealTimers();
    expect(await violacoesDeAcessibilidade(dialogo.outerHTML)).toEqual([]);
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
    // Aos 1800 ms a linha esmaece, ainda com o Aprovado, e 200 ms depois deixa a fila (parte 6c).
    await passar(200);
    expect(rotuloAtual(botao("Pedido 1042", "Aprovar"))).toBe("Aprovado");
    await passar(CARREGANDO.saiLinhaMs + CARREGANDO.contaMs);
    expect(grupoParaAprovar().textContent).not.toContain("Pedido 1042");
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

describe("a linha que sai sem salto (parte 6c)", () => {
  const ALTURA = 80;
  const VAZIO = 52;
  const TAMPA = 16;
  const medirDeVerdade = Element.prototype.getBoundingClientRect;

  /**
   * O jsdom não tem layout. O falso empilha os grupos como a tela: o título
   * (40 px), 10 px, o cartão (80 px por linha, ou 52 px com o vazio) e 24 px
   * até o grupo seguinte. As tampas da moldura têm 16 px, e o meio vai de 1
   * px por baixo de uma a 1 px por baixo da outra. O transform não conta.
   */
  function noLayout(alvo: HTMLElement): [number, number] | null {
    let y = 100;
    for (const secao of Array.from(container!.querySelectorAll("section"))) {
      const titulo = secao.querySelector(":scope > h2");
      const cartao = titulo?.nextElementSibling;
      if (!titulo || !cartao) continue;
      const linhas = Array.from(cartao.querySelectorAll(":scope > div > [data-chave]"));
      const altura = linhas.length ? linhas.length * ALTURA : VAZIO;
      const topo = y + 50;
      const caixas = new Map<Element, [number, number]>([
        [titulo, [y, 40]],
        [cartao, [topo, altura]],
      ]);
      linhas.forEach((linha, indice) => caixas.set(linha, [topo + indice * ALTURA, ALTURA]));
      const vazio = cartao.querySelector(":scope > p");
      if (vazio) caixas.set(vazio, [topo, VAZIO]);
      const pecas: Array<[string, number, number]> = [
        ["topo", 0, TAMPA],
        ["meio", TAMPA - 1, altura - 2 * TAMPA + 2],
        ["base", altura - TAMPA, TAMPA],
      ];
      for (const [nome, desde, alto] of pecas) {
        const peca = cartao.querySelector(`:scope > [data-moldura="${nome}"]`);
        if (peca) caixas.set(peca, [topo + desde, alto]);
      }
      const achada = caixas.get(alvo);
      if (achada) return achada;
      y = topo + altura + 24;
    }
    return null;
  }

  let refluxos: RefluxosGravados;

  beforeEach(() => {
    refluxos = gravarRefluxos();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const caixa = noLayout(this);
      if (!caixa) return medirDeVerdade.call(this);
      // O lugar no layout, mais o que falta dos refluxos que correm na peça (lineares, para o teste).
      const [lugar, height] = caixa;
      const top = lugar + refluxos.noMeio(this);
      return { top, bottom: top + height, left: 0, right: 900, width: 900, height, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    });
  });

  afterEach(() => {
    refluxos.restaurar();
  });

  function grupo(titulo: string): HTMLElement {
    const achado = Array.from(container!.querySelectorAll("section")).find((section) => section.querySelector("h2")?.textContent?.startsWith(titulo));
    if (!achado) throw new Error(`sem o grupo ${titulo}`);
    return achado;
  }

  function naFila(chave: string): HTMLElement | null {
    return container!.querySelector<HTMLElement>(`[data-chave="${chave}"]`);
  }

  function moldura(titulo: string, nome: "topo" | "meio" | "base"): HTMLElement {
    const peca = grupo(titulo).querySelector<HTMLElement>(`[data-moldura="${nome}"]`);
    if (!peca) throw new Error(`sem a moldura ${nome} em ${titulo}`);
    return peca;
  }

  /** De onde a peça parte nos refluxos que correm nela: o deslocamento e a escala (parada, 0 e 1). */
  function partida(peca: HTMLElement): { anda: number; estica: number } {
    const correndo = refluxos.correndo(peca);
    return { anda: correndo.reduce((soma, refluxo) => soma + refluxo.anda, 0), estica: correndo.reduce((produto, refluxo) => produto * refluxo.estica, 1) };
  }

  /**
   * Aprova a linha com o foco no Aprovar dela. A resposta chega aos 400 ms e
   * a releitura já traz o pedido em separação; o Aprovado entra aos 800 ms e
   * fica 1 s: aos 1800 ms a ação solta a linha. Para 1 ms antes disso.
   */
  async function aprovarComOFoco(titulo: string, indice: number) {
    const aprovar = botao(titulo, "Aprovar");
    aprovar.focus();
    await tocar(aprovar);
    await passar(400);
    const id = `req_${titulo.split(" ")[1]}`;
    estado.solicitacoes.find((item) => item.id === id)!.status = "approved";
    estado.ops = {
      alerts: [],
      queues: {
        picking: {
          key: "picking",
          tasks: [{ id: `pick_ord_${id}`, reference: `pick_ord_${id}`, title: `PED-${titulo.split(" ")[1]}`, status: "planned", can_advance: true, customer_request_id: id, exception_count: 0, items: [] }],
        },
      },
    };
    await act(async () => estado.decisoes[indice].responder({ ok: true }));
    await passar(1_800 - 400 - 1);
  }

  it("depois do Aprovado, a linha esmaece com ele, sai, as de baixo sobem por FLIP, a contagem rola e o pedido entra em Para separar com o realce", async () => {
    await aprovarComOFoco("Pedido 1042", 0);
    expect(rotuloAtual(botao("Pedido 1042", "Aprovar"))).toBe("Aprovado");
    // O pedido já está na releitura, mas não fica em dois grupos ao mesmo tempo.
    expect(grupo("Para separar").textContent).not.toContain("PED-1042");

    await passar(1);
    expect(naFila("req_1042")?.dataset.naLista).toBe("saindo");
    expect(naFila("req_1042")?.hasAttribute("inert")).toBe(true);
    // Congelada: o Aprovado fica até ela sair.
    expect(rotuloAtual(botao("Pedido 1042", "Aprovar"))).toBe("Aprovado");
    expect(grupo("Para separar").textContent).not.toContain("PED-1042");

    await passar(CARREGANDO.saiLinhaMs);
    expect(naFila("req_1042")).toBeNull();
    // A 1043 e a 1045 sobem 80 px só por transform.
    expect(partida(naFila("req_1043")!)).toEqual({ anda: 80, estica: 1 });
    expect(partida(naFila("req_1045")!)).toEqual({ anda: 80, estica: 1 });
    // A contagem rola de 3 para 2: só o 2 fica na árvore.
    const conta = grupoParaAprovar().querySelector("h2")!;
    expect(conta.querySelector('[data-conta="sai"]')?.textContent).toBe("3");
    expect(conta.querySelector('[data-conta="sai"]')?.getAttribute("aria-hidden")).toBe("true");
    expect(conta.querySelector('[data-conta="entra"]')?.textContent).toBe("2");
    // O pedido entra em Para separar com o realce: foi aprovado nesta tela.
    expect(naFila("ord_req_1042")?.dataset.naLista).toBe("chegando");
    expect(naFila("ord_req_1042")?.hasAttribute("data-realce")).toBe(true);
    expect(naFila("ord_req_1042")?.textContent).toContain("PED-1042");

    await passar(CARREGANDO.contaMs);
    expect(conta.textContent).toBe("Para aprovar2");
    await passar(CARREGANDO.chegaEsperaMs + CARREGANDO.destaqueMs - CARREGANDO.contaMs);
    expect(naFila("ord_req_1042")?.dataset.naLista).toBe("parada");
    expect(naFila("ord_req_1042")?.hasAttribute("data-realce")).toBe(false);
  });

  it("o refluxo leva junto o cartão, os títulos e os grupos de baixo, de uma vez, e nenhuma linha fica fora do cartão", async () => {
    await aprovarComOFoco("Pedido 1042", 0);
    await passar(1);
    // Antes: Para aprovar com 3 linhas, Para separar e Para entregar vazios (o vazio mede 52 px).
    const observadas = {
      "aprovar.base": moldura("Para aprovar", "base"),
      "aprovar.meio": moldura("Para aprovar", "meio"),
      "aprovar.topo": moldura("Para aprovar", "topo"),
      "separar.titulo": grupo("Para separar").querySelector("h2")!,
      "separar.topo": moldura("Para separar", "topo"),
      "separar.meio": moldura("Para separar", "meio"),
      "separar.base": moldura("Para separar", "base"),
      "entregar.titulo": grupo("Para entregar").querySelector("h2")!,
      "entregar.topo": moldura("Para entregar", "topo"),
      "entregar.base": moldura("Para entregar", "base"),
      "1043": naFila("req_1043")!,
      "1045": naFila("req_1045")!,
    };

    await passar(CARREGANDO.saiLinhaMs);
    const partidas = Object.fromEntries(Object.entries(observadas).map(([nome, peca]) => [nome, partida(peca)]));
    // Para aprovar perde 80 px: a base e as linhas de baixo sobem 80; o meio encolhe de 210 para 130 px, do alto.
    expect(partidas["aprovar.base"]).toEqual({ anda: 80, estica: 1 });
    expect(partidas["aprovar.topo"]).toEqual({ anda: 0, estica: 1 });
    expect(partidas["aprovar.meio"].anda).toBe(0);
    expect(partidas["aprovar.meio"].estica).toBeCloseTo(210 / 130, 5);
    expect(partidas["1043"]).toEqual({ anda: 80, estica: 1 });
    expect(partidas["1045"]).toEqual({ anda: 80, estica: 1 });
    // Para separar sobe 80 px e cresce de 52 para 80: o topo e o título sobem 80, a base só 52.
    expect(partidas["separar.titulo"]).toEqual({ anda: 80, estica: 1 });
    expect(partidas["separar.topo"]).toEqual({ anda: 80, estica: 1 });
    expect(partidas["separar.meio"].anda).toBe(80);
    expect(partidas["separar.meio"].estica).toBeCloseTo(22 / 50, 5);
    expect(partidas["separar.base"]).toEqual({ anda: 52, estica: 1 });
    // O grupo de baixo sobe o que sobrou: 80 − 28 = 52 px.
    expect(partidas["entregar.titulo"]).toEqual({ anda: 52, estica: 1 });
    expect(partidas["entregar.topo"]).toEqual({ anda: 52, estica: 1 });
    expect(partidas["entregar.base"]).toEqual({ anda: 52, estica: 1 });
    // As que mudaram de lugar refluem juntas, no mesmo instante; o topo de Para aprovar, que fica, não.
    for (const [nome, peca] of Object.entries(observadas)) expect(refluxos.correndo(peca).length > 0, nome).toBe(nome !== "aprovar.topo");
    expect(new Set(refluxos.todos().map((refluxo) => refluxo.inicio)).size).toBe(1);
    // A que chega não reflui: entra, depois que o cartão chegou.
    expect(refluxos.de(naFila("ord_req_1042")!)).toEqual([]);

    // Nenhuma linha fica fora do cartão no começo do refluxo: cada uma parte de dentro da moldura que parte com ela.
    const baseDaMoldura = noLayout(observadas["aprovar.base"])!;
    const fundo = baseDaMoldura[0] + baseDaMoldura[1] + partidas["aprovar.base"].anda;
    const alto = noLayout(observadas["aprovar.topo"])![0] + partidas["aprovar.topo"].anda;
    for (const chave of ["1043", "1045"] as const) {
      const [topo, altura] = noLayout(observadas[chave])!;
      expect(topo + partidas[chave].anda, chave).toBeGreaterThanOrEqual(alto);
      expect(topo + altura + partidas[chave].anda, chave).toBeLessThanOrEqual(fundo);
    }
    // E o cartão não recorta a altura: a linha que sobe não some atrás da borda.
    const cartao = grupoParaAprovar().querySelector("h2")!.nextElementSibling!;
    expect(cartao.className).not.toMatch(/\boverflow-hidden\b/);

    await passar(CARREGANDO.refluiMs);
    for (const [nome, peca] of Object.entries(observadas)) expect(refluxos.correndo(peca), nome).toEqual([]);
  });

  it("só o pedido aprovado nesta tela chega com o realce; o que outra pessoa aprovou e a solicitação nova do portal, na mesma releitura, chegam sem sinal", async () => {
    // A 1043 é aprovada aqui; enquanto isso, outra pessoa aprova a 1042 e o portal manda a 1047.
    await tocar(botao("Pedido 1043", "Aprovar"));
    estado.solicitacoes[0].status = "approved";
    estado.solicitacoes[1].status = "approved";
    estado.solicitacoes.push(solicitacao("1047", 8));
    const separacao = (id: string) => ({ ...tarefa("pick", id, "planned"), customer_request_id: id });
    estado.ops = { alerts: [], queues: { picking: { key: "picking", tasks: [separacao("req_1042"), separacao("req_1043")] } } };
    await act(async () => estado.decisoes[0].responder({ ok: true }));
    await reler();
    expect(naFila("req_1042")?.dataset.naLista).toBe("saindo");
    // A solicitação nova do portal chega a Para aprovar sem o realce.
    expect(naFila("req_1047")?.dataset.naLista).toBe("chegando");
    expect(naFila("req_1047")?.hasAttribute("data-realce")).toBe(false);

    await passar(CARREGANDO.saiLinhaMs);
    const da1042 = grupo("Para separar").querySelector<HTMLElement>('[data-chave="ord_req_1042"]');
    expect(da1042?.dataset.naLista).toBe("chegando");
    expect(da1042?.hasAttribute("data-realce")).toBe(false);

    // A 1043 sai depois do "Aprovado", e o pedido dela chega com o realce.
    for (let vez = 0; vez < 60 && !naFila("ord_req_1043"); vez += 1) await passar(50);
    const da1043 = grupo("Para separar").querySelector<HTMLElement>('[data-chave="ord_req_1043"]');
    expect(da1043?.dataset.naLista).toBe("chegando");
    expect(da1043?.hasAttribute("data-realce")).toBe(true);
    expect(grupo("Para separar").querySelector('[data-chave="ord_req_1042"]')?.hasAttribute("data-realce")).toBe(false);
  });

  it("a linha que espera o dedo depois de outra pessoa decidir fica à vista, com o foco de quem está nela, mas não dispara ação", async () => {
    const aprovar = botao("Pedido 1042", "Aprovar");
    aprovar.focus();
    const lista = naFila("req_1042")!.parentElement!;
    await act(async () => {
      lista.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    // Outra pessoa aprovou: a releitura tira a 1042 da fila, mas o dedo segura a lista.
    estado.solicitacoes[0].status = "approved";
    await reler();
    const linha42 = naFila("req_1042")!;
    expect(linha42.dataset.naLista).toBe("esperando");
    expect(linha42.hasAttribute("inert")).toBe(false);
    for (const rotulo of ["Aprovar", "Recusar"] as const) {
      const alvo = botao("Pedido 1042", rotulo);
      expect(alvo.getAttribute("aria-disabled"), rotulo).toBe("true");
      expect(alvo.hasAttribute("disabled"), rotulo).toBe(false);
      // Com a cara de travado (a 0,45, sem hover nem toque: data-trava-da-espera no index.css).
      expect(alvo.hasAttribute("data-trava-da-espera"), rotulo).toBe(true);
    }
    // Quem estava nela continua com o foco.
    expect(document.activeElement).toBe(botao("Pedido 1042", "Aprovar"));

    // O toque não chama a callable nem abre a recusa.
    await tocar(botao("Pedido 1042", "Aprovar"));
    await tocar(botao("Pedido 1042", "Recusar"));
    await passar(10);
    expect(estado.decisoes).toHaveLength(0);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    // As outras linhas seguem livres.
    expect(livre(botao("Pedido 1043", "Aprovar"))).toBe(true);
    expect(botao("Pedido 1043", "Aprovar").getAttribute("aria-disabled")).toBeNull();

    // Quando o dedo sai, ela esmaece, ainda com a cara de travada, e o foco vai para a linha seguinte.
    await passar(CARREGANDO.dedoMs);
    expect(naFila("req_1042")?.dataset.naLista).toBe("saindo");
    expect(botao("Pedido 1042", "Aprovar").hasAttribute("data-trava-da-espera")).toBe(true);
    expect(document.activeElement).toBe(botao("Pedido 1043", "Aprovar"));
  });

  it("o foco vai para o Aprovar da linha seguinte, e a nova primeira linha herda o Aprovar principal", async () => {
    const principal = (titulo: string) => botao(titulo, "Aprovar").className.includes("bg-primary");
    expect(principal("Pedido 1042")).toBe(true);
    expect(principal("Pedido 1043")).toBe(false);

    await aprovarComOFoco("Pedido 1042", 0);
    expect(document.activeElement).toBe(botao("Pedido 1042", "Aprovar"));
    await passar(1);
    expect(document.activeElement).toBe(botao("Pedido 1043", "Aprovar"));

    await passar(CARREGANDO.saiLinhaMs);
    expect(principal("Pedido 1043")).toBe(true);
    expect(principal("Pedido 1045")).toBe(false);
    expect(document.activeElement).toBe(botao("Pedido 1043", "Aprovar"));
  });

  it("sem linha seguinte, o foco vai para o título do grupo", async () => {
    await aprovarComOFoco("Pedido 1045", 0);
    await passar(1);
    expect(document.activeElement).toBe(grupoParaAprovar().querySelector("h2"));
  });

  it("a contagem do título no leitor de tela já não conta a linha que esmaece (inert): a última que sai deixa o grupo sem número", async () => {
    /** O texto que o leitor de tela lê: sem o que está aria-hidden. */
    const lido = (no: Element): string =>
      Array.from(no.childNodes)
        .map((filho) => (filho.nodeType === Node.TEXT_NODE ? filho.textContent : (filho as Element).getAttribute("aria-hidden") === "true" ? "" : lido(filho as Element)))
        .join("");
    estado.solicitacoes = [solicitacao("1042", 12), solicitacao("1043", 40)];
    await reler();
    await passar(CARREGANDO.chegaEsperaMs + CARREGANDO.destaqueMs);
    const titulo = grupoParaAprovar().querySelector("h2")!;
    expect(lido(titulo)).toBe("Para aprovar2");

    // Outra pessoa aprova a 1042: na tela ainda são 2 até ela sair; no leitor de tela, já 1.
    estado.solicitacoes[0].status = "approved";
    await reler();
    expect(naFila("req_1042")?.dataset.naLista).toBe("saindo");
    expect(titulo.textContent).toContain("2");
    expect(lido(titulo)).toBe("Para aprovar1");

    // A última sai com o foco: o título recebe o foco já sem número.
    await passar(CARREGANDO.saiLinhaMs + CARREGANDO.contaMs);
    botao("Pedido 1043", "Aprovar").focus();
    estado.solicitacoes[1].status = "approved";
    await reler();
    expect(document.activeElement).toBe(titulo);
    expect(titulo.textContent).toContain("1");
    expect(lido(titulo)).toBe("Para aprovar");
  });

  it("com um toque na fila nos últimos 700 ms, a linha espera com o Aprovado e o pedido não muda de grupo", async () => {
    await aprovarComOFoco("Pedido 1042", 0);
    const lista = naFila("req_1043")!.parentElement!;
    await act(async () => {
      lista.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });

    await passar(1);
    expect(naFila("req_1042")?.dataset.naLista).toBe("esperando");
    expect(rotuloAtual(botao("Pedido 1042", "Aprovar"))).toBe("Aprovado");
    await passar(CARREGANDO.dedoMs - 2);
    expect(naFila("req_1042")?.dataset.naLista).toBe("esperando");
    expect(grupo("Para separar").textContent).not.toContain("PED-1042");

    await passar(1);
    expect(naFila("req_1042")?.dataset.naLista).toBe("saindo");
    await passar(CARREGANDO.saiLinhaMs);
    expect(naFila("req_1042")).toBeNull();
    expect(naFila("ord_req_1042")?.dataset.naLista).toBe("chegando");
  });

  it("o axe não acusa nada com a linha saindo", async () => {
    await aprovarComOFoco("Pedido 1042", 0);
    await passar(1);
    expect(naFila("req_1042")?.dataset.naLista).toBe("saindo");
    const html = grupoParaAprovar().outerHTML;
    vi.useRealTimers();
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  /** Uma tarefa do pedido A: a separação ou a expedição pronta para sair. */
  const tarefa = (fila: "pick" | "ship", pedido: string, status: string) => ({
    id: `${fila}_ord_${pedido}`,
    reference: `${fila}_ord_${pedido}`,
    title: `PED-${pedido}`,
    status,
    can_advance: status !== "completed",
    exception_count: 0,
    items: [],
  });

  async function reler() {
    await act(async () => {
      await cliente.invalidateQueries();
    });
    await passar(50);
  }

  it("o pedido que sai de Para separar só entra em Para entregar quando a linha dele saiu, nunca nos dois grupos", async () => {
    estado.ops = { alerts: [], queues: { picking: { key: "picking", tasks: [tarefa("pick", "A", "planned")] } } };
    await reler();
    await passar(CARREGANDO.chegaEsperaMs + CARREGANDO.destaqueMs);
    expect(grupo("Para separar").textContent).toContain("PED-A");

    estado.ops = {
      alerts: [],
      queues: {
        picking: { key: "picking", tasks: [tarefa("pick", "A", "completed")] },
        expedition: { key: "expedition", tasks: [tarefa("ship", "A", "ready_to_dispatch")] },
      },
    };
    await reler();
    const emSeparar = () => grupo("Para separar").querySelector<HTMLElement>('[data-chave="ord_A"]');
    expect(emSeparar()?.dataset.naLista).toBe("saindo");
    expect(grupo("Para entregar").textContent).not.toContain("PED-A");
    expect(grupo("Para entregar").querySelector("h2")?.textContent).toBe("Para entregar");

    await passar(CARREGANDO.saiLinhaMs);
    expect(emSeparar()).toBeNull();
    expect(grupo("Para entregar").textContent).toContain("PED-A");
    // Separado na bancada, não nesta tela: entra sem o realce.
    const emEntregar = grupo("Para entregar").querySelector<HTMLElement>('[data-chave="ord_A"]');
    expect(emEntregar?.dataset.naLista).toBe("chegando");
    expect(emEntregar?.hasAttribute("data-realce")).toBe(false);
    await passar(CARREGANDO.contaMs);
    expect(grupo("Para entregar").querySelector("h2")?.textContent).toBe("Para entregar1");
  });

  /** Para entregar com A e B, já parados (a chegada da releitura passou). */
  async function paraEntregarComAeB() {
    estado.solicitacoes = [];
    estado.ops = { alerts: [], queues: { expedition: { key: "expedition", tasks: [tarefa("ship", "A", "ready_to_dispatch"), tarefa("ship", "B", "ready_to_dispatch")] } } };
    await reler();
    await passar(CARREGANDO.chegaEsperaMs + CARREGANDO.destaqueMs);
  }

  const emEntregar = (pedido: string) => grupo("Para entregar").querySelector<HTMLElement>(`[data-chave="ord_${pedido}"]`);
  const entregue = (pedido: string) => emEntregar(pedido)!.querySelector<HTMLButtonElement>("button[data-foco-da-linha]")!;

  it("Para entregar: a linha que sai (o Entregue, a releitura) esmaece, o foco vai para o Entregue da seguinte e as de baixo sobem por FLIP", async () => {
    await paraEntregarComAeB();
    expect(entregue("A").textContent).toBe("Entregue");
    entregue("A").focus();
    // A foi entregue: a releitura o tira da fila.
    estado.ops = { alerts: [], queues: { expedition: { key: "expedition", tasks: [tarefa("ship", "B", "ready_to_dispatch")] } } };
    await reler();
    expect(emEntregar("A")?.dataset.naLista).toBe("saindo");
    expect(emEntregar("A")?.hasAttribute("inert")).toBe(true);
    expect(document.activeElement).toBe(entregue("B"));

    await passar(CARREGANDO.saiLinhaMs);
    expect(emEntregar("A")).toBeNull();
    expect(partida(emEntregar("B")!)).toEqual({ anda: 80, estica: 1 });
    // A contagem rola de 2 para 1, e a única linha herda a ação principal.
    const titulo = grupo("Para entregar").querySelector("h2")!;
    expect(titulo.querySelector('[data-conta="sai"]')?.textContent).toBe("2");
    expect(entregue("B").className).toContain("bg-primary");
    expect(document.activeElement).toBe(entregue("B"));
  });

  it("Para entregar pelo Entregue: a linha sai enquanto o diálogo fecha, e o foco vai para o Entregue da seguinte, não para o corpo", async () => {
    await paraEntregarComAeB();
    await tocar(entregue("A"));
    const placa = document.querySelector<HTMLInputElement>("#placa")!;
    const definir = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      definir.call(placa, "ABC1D23");
      placa.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const confirmar = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find((item) => rotuloAtual(item) === "Confirmar entrega")!;
    await tocar(confirmar);
    await passar(10);
    expect(estado.avancos).toEqual(["ship_ord_A"]);
    // A releitura depois da entrega já não traz o A.
    estado.ops = { alerts: [], queues: { expedition: { key: "expedition", tasks: [tarefa("ship", "B", "ready_to_dispatch")] } } };
    await act(async () => estado.respostasDoAvanco[0]({ ok: true }));
    await passar(10);
    await act(async () => estado.respostasDoAvanco[1]({ ok: true }));
    await passar(10);
    expect(estado.toast).toHaveBeenCalledWith({ title: "Entrega confirmada. Estoque baixado." });
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    await passar(CARREGANDO.saiLinhaMs + CARREGANDO.refluiMs);
    expect(emEntregar("A")).toBeNull();
    expect(document.activeElement).toBe(entregue("B"));
  });

  it("Para entregar: sob o dedo a linha espera; sem linha seguinte, o foco vai para o título do grupo", async () => {
    await paraEntregarComAeB();
    entregue("B").focus();
    await act(async () => {
      emEntregar("B")!.parentElement!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    estado.ops = { alerts: [], queues: { expedition: { key: "expedition", tasks: [tarefa("ship", "A", "ready_to_dispatch")] } } };
    await reler();
    expect(emEntregar("B")?.dataset.naLista).toBe("esperando");
    expect(entregue("B").getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(entregue("B"));

    await passar(CARREGANDO.dedoMs);
    expect(emEntregar("B")?.dataset.naLista).toBe("saindo");
    expect(document.activeElement).toBe(grupo("Para entregar").querySelector("h2"));
  });

  /** Abre a entrega do pedido pelo Entregue, com o foco nele, como pelo teclado. */
  async function abrirEntregue(pedido: string) {
    entregue(pedido).focus();
    await tocar(entregue(pedido));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  }

  function noDialogo(rotulo: string): HTMLButtonElement {
    const achado = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find((item) => rotuloAtual(item) === rotulo);
    if (!achado) throw new Error(`sem ${rotulo} no diálogo`);
    return achado;
  }

  async function confirmarEntrega() {
    const placa = document.querySelector<HTMLInputElement>("#placa")!;
    const definir = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      definir.call(placa, "ABC1D23");
      placa.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await tocar(noDialogo("Confirmar entrega"));
    await passar(10);
    await act(async () => estado.respostasDoAvanco[0]({ ok: true }));
    await passar(10);
    await act(async () => estado.respostasDoAvanco[1]({ ok: true }));
    await passar(10);
  }

  it("o diálogo fechado pelo Voltar devolve o foco ao Entregue da linha, e não ao corpo", async () => {
    await paraEntregarComAeB();
    await abrirEntregue("A");
    await tocar(noDialogo("Voltar"));
    await passar(20);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(entregue("A"));
  });

  it("o pedido que passou de Para separar a Para entregar devolve o foco em Para entregar, e não no Separar de outro pedido", async () => {
    estado.solicitacoes = [];
    estado.ops = { alerts: [], queues: { picking: { key: "picking", tasks: [tarefa("pick", "A", "planned"), tarefa("pick", "B", "planned")] } } };
    await reler();
    await passar(CARREGANDO.chegaEsperaMs + CARREGANDO.destaqueMs);
    // Outra pessoa separou o A na bancada: a releitura o leva a Para entregar.
    estado.ops = {
      alerts: [],
      queues: {
        picking: { key: "picking", tasks: [tarefa("pick", "A", "completed"), tarefa("pick", "B", "planned")] },
        expedition: { key: "expedition", tasks: [tarefa("ship", "A", "ready_to_dispatch")] },
      },
    };
    await reler();
    await passar(CARREGANDO.saiLinhaMs + CARREGANDO.refluiMs + CARREGANDO.chegaEsperaMs + CARREGANDO.destaqueMs);
    expect(grupo("Para separar").querySelector('[data-chave="ord_A"]')).toBeNull();
    expect(emEntregar("A")?.dataset.naLista).toBe("parada");

    // Pelo Voltar, o foco volta ao Entregue do A.
    await abrirEntregue("A");
    await tocar(noDialogo("Voltar"));
    await passar(20);
    expect(document.activeElement).toBe(entregue("A"));

    // Entregue, com a releitura já sem o A: o foco vai para o título de Para entregar, o grupo de onde ele saiu.
    await abrirEntregue("A");
    estado.ops = { alerts: [], queues: { picking: { key: "picking", tasks: [tarefa("pick", "B", "planned")] } } };
    await confirmarEntrega();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(grupo("Para entregar").querySelector("h2"));
  });

  it("a releitura que chega depois de o diálogo fechar: o foco fica no Entregue da linha e, quando ela sai, vai para o da seguinte", async () => {
    await paraEntregarComAeB();
    await abrirEntregue("A");
    // A releitura da entrega demora: o diálogo fecha antes de ela chegar.
    estado.opsPresas = [];
    estado.ops = { alerts: [], queues: { expedition: { key: "expedition", tasks: [tarefa("ship", "B", "ready_to_dispatch")] } } };
    await confirmarEntrega();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(emEntregar("A")?.dataset.naLista).toBe("parada");
    expect(document.activeElement).toBe(entregue("A"));

    const presas = estado.opsPresas;
    estado.opsPresas = null;
    await act(async () => {
      for (const soltar of presas) soltar();
    });
    await passar(50);
    expect(emEntregar("A")?.dataset.naLista).toBe("saindo");
    expect(document.activeElement).toBe(entregue("B"));
    await passar(CARREGANDO.saiLinhaMs + CARREGANDO.refluiMs);
    expect(document.activeElement).toBe(entregue("B"));
  });

  it("a recusa fechada pelo Voltar devolve o foco ao Recusar da linha", async () => {
    const recusar = botao("Pedido 1043", "Recusar");
    recusar.focus();
    await tocar(recusar);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await tocar(noDialogo("Voltar"));
    await passar(20);
    expect(document.activeElement).toBe(botao("Pedido 1043", "Recusar"));
  });

  it("no celular, a linha que sai com o foco o passa ao Entregue da seguinte que se vê, e não à cópia escondida do computador", async () => {
    // No celular (abaixo do sm), o que está dentro de um .hidden não se vê: as ações do computador.
    Object.defineProperty(HTMLElement.prototype, "checkVisibility", {
      configurable: true,
      writable: true,
      value: function checkVisibility(this: HTMLElement) {
        return this.closest(".hidden") === null;
      },
    });
    onTestFinished(() => {
      delete (HTMLElement.prototype as { checkVisibility?: unknown }).checkVisibility;
    });
    await paraEntregarComAeB();
    const visivel = (pedido: string) => {
      const copias = Array.from(emEntregar(pedido)!.querySelectorAll<HTMLButtonElement>("button[data-foco-da-linha]"));
      expect(copias).toHaveLength(2);
      return copias.find((copia) => copia.closest(".hidden") === null)!;
    };
    visivel("A").focus();
    estado.ops = { alerts: [], queues: { expedition: { key: "expedition", tasks: [tarefa("ship", "B", "ready_to_dispatch")] } } };
    await reler();
    expect(emEntregar("A")?.dataset.naLista).toBe("saindo");
    expect(document.activeElement).toBe(visivel("B"));
  });

  it("a linha que sai de Para separar fica com a ação principal até sair, e só então a de baixo herda", async () => {
    estado.solicitacoes = [];
    estado.ops = { alerts: [], queues: { picking: { key: "picking", tasks: [tarefa("pick", "A", "planned"), tarefa("pick", "B", "planned")] } } };
    await reler();
    await passar(CARREGANDO.destaqueMs);
    const separar = (pedido: string) => naFila(`ord_${pedido}`)!.querySelector<HTMLElement>("a[data-foco-da-linha]")!;
    expect(separar("A").className).toContain("bg-primary");
    expect(separar("B").className).not.toContain("bg-primary");

    // O pedido A foi cancelado: sai de todas as filas.
    estado.ops = { alerts: [], queues: { picking: { key: "picking", tasks: [tarefa("pick", "B", "planned")] } } };
    await reler();
    expect(naFila("ord_A")?.dataset.naLista).toBe("saindo");
    expect(separar("B").className).not.toContain("bg-primary");

    await passar(CARREGANDO.saiLinhaMs);
    expect(naFila("ord_A")).toBeNull();
    expect(separar("B").className).toContain("bg-primary");
  });

  it("a primeira leitura com dado entra de uma vez, sem realce, também depois de uma falha", async () => {
    act(() => raiz?.unmount());
    cliente.clear();
    estado.ops = { alerts: [], queues: { picking: { key: "picking", tasks: [tarefa("pick", "A", "planned")] } } };
    let falhar = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (entrada: RequestInfo | URL, init?: RequestInit) => {
        if (falhar && new URL(String(entrada), "http://localhost").pathname === "/api/warehouse/ops") return resposta({ message: "Falha interna." }, 500);
        return servir(entrada, init);
      }),
    );
    raiz = createRoot(container!);
    await act(async () => {
      raiz!.render(
        <QueryClientProvider client={cliente}>
          <Anunciador />
          <Pedidos />
        </QueryClientProvider>,
      );
    });
    await passar(50);
    expect(container!.textContent).toContain("Não consegui carregar os pedidos.");

    falhar = false;
    await reler();
    expect(grupo("Para separar").textContent).toContain("PED-A");
    for (const chave of ["req_1042", "req_1043", "req_1045", "ord_A"]) expect(naFila(chave)?.dataset.naLista, chave).toBe("parada");
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

  it("no Não recusado, sem o motivo, o Recusar do diálogo também não chama nada", async () => {
    await tocar(botao("Pedido 1042", "Recusar"));
    await digitarMotivo("Cliente desistiu");
    await tocar(recusarDoDialogo());
    await act(async () => estado.decisoes[0].responder({ message: "Solicitação bloqueada.", code: "failed-precondition" }, 400));
    await passar(10);
    expect(rotuloAtual(recusarDoDialogo())).toBe("Não recusado");

    // Passado o toque único, e ainda no Não recusado, a pessoa apaga o motivo.
    await passar(1_100);
    await digitarMotivo("");
    const recusar = recusarDoDialogo();
    expect(rotuloAtual(recusar)).toBe("Não recusado");
    expect(recusar.getAttribute("aria-disabled")).toBe("true");
    await tocar(recusar);
    expect(estado.decisoes).toHaveLength(1);

    // Com o motivo de novo, a recusa sai.
    await digitarMotivo("Cliente desistiu do pedido");
    await tocar(recusarDoDialogo());
    expect(estado.decisoes).toHaveLength(2);
    expect(estado.decisoes[1].corpo.reason).toBe("Cliente desistiu do pedido");
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
