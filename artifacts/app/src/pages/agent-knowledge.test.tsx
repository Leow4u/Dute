// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosForaDaLista } from "@/test/textos";

/**
 * "Anexar ao Agent Dute" (carregamento v2, parte 11): o cadastro, o arquivo
 * em pedaços de 320 KB (em lotes de 10) e os trechos do texto. O prazo de 70
 * s conta de cada lote gravado, e não do começo: a gravação lenta, mas
 * andando, não desiste. O "Conferir" só dá o sucesso com o arquivo inteiro
 * gravado (o último pedaço e o último trecho), e diz "Conferindo…". As etapas
 * e o lugar do aviso ficam no formulário desde o repouso. Dados sintéticos.
 */

const estado = vi.hoisted(() => ({
  eventos: 0,
  gravados: [] as string[],
  lotes: [] as Array<{ ids: string[]; soltar: () => void; feito: boolean }>,
  toasts: [] as Array<{ title?: string }>,
  /** O Firestore sem o servidor: responde do cache, com sucesso, como o SDK faz sem rede. */
  soCache: false,
  /** A coleção cuja leitura falha (sem permissão), e os documentos que a base devolve. */
  falhaEm: null as string | null,
  documentos: [] as Array<{ id: string; data: () => Record<string, unknown> }>,
}));

vi.mock("@/lib/firebase", () => ({ firestore: {}, firebaseAuth: null }));
vi.mock("firebase/firestore", () => ({
  collection: (_db: unknown, nome: string) => ({ nome }),
  doc: (_db: unknown, nome: string, id: string) => ({ path: `${nome}/${id}` }),
  getDocs: async (fonte: { nome?: string }) => {
    if (fonte?.nome && fonte.nome === estado.falhaEm) throw Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" });
    return { docs: fonte?.nome === "ai_agent_knowledge" ? estado.documentos : [], metadata: { fromCache: estado.soCache } };
  },
  where: () => ({}),
  query: () => ({}),
  serverTimestamp: () => "agora",
  setDoc: async (ref: { path: string }) => {
    estado.gravados.push(ref.path);
  },
  writeBatch: () => {
    const ids: string[] = [];
    return {
      set: (ref: { path: string }) => ids.push(ref.path),
      commit: () =>
        new Promise<void>((resolver) => {
          const lote = { ids, feito: false, soltar: () => undefined as void };
          lote.soltar = () => {
            lote.feito = true;
            estado.gravados.push(...ids);
            resolver();
          };
          estado.lotes.push(lote);
        }),
    };
  },
  getDocFromServer: async (ref: { path: string }) => ({ exists: () => estado.gravados.includes(ref.path) }),
}));
vi.mock("@/components/agent/agent-notes", () => ({ AgentNotes: () => null }));
vi.mock("@/components/agent/agent-playbooks", () => ({ AgentPlaybooks: () => null }));
vi.mock("@/lib/auth", () => ({
  useAppUser: () => ({ user: { uid: "u1", publicMetadata: { role: "admin" } }, isLoaded: true }),
}));
vi.mock("@/lib/active-customer-context", () => ({
  useActiveCustomer: () => ({ code: "BTG Pactual", active: { code: "BTG Pactual", name: "BTG Pactual" }, options: [], isLoading: false }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: (t: { title?: string }) => estado.toasts.push(t) }) }));

import AgentKnowledge from "@/pages/agent-knowledge";

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;
let client: QueryClient;

async function drenar(vezes = 20) {
  for (let i = 0; i < vezes; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setImmediate(resolve));
    });
  }
}

async function passar(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
  await drenar(5);
}

const botao = (rotulo: string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((item) => {
    const camada = item.querySelector(".botao-acao-camada[data-atual]");
    return (camada?.textContent ?? item.textContent)?.trim() === rotulo;
  });

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance", "Date"] });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: RequestInfo | URL) => {
      if (String(entrada).includes("/api/ai/events")) estado.eventos += 1;
      return new Response("{}", { status: 200 });
    }),
  );
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  estado.eventos = 0;
  estado.gravados = [];
  estado.lotes = [];
  estado.toasts = [];
  estado.soCache = false;
  estado.falhaEm = null;
  estado.documentos = [];
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  await act(async () =>
    raiz!.render(
      <QueryClientProvider client={client}>
        <AgentKnowledge />
      </QueryClientProvider>,
    ),
  );
  await drenar();
});

afterEach(() => {
  act(() => raiz?.unmount());
  client.clear();
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Um PDF de 3 MB: 4 MB em base64, 13 pedaços de 320 KB, dois lotes. */
async function anexarPdf() {
  const arquivo = new File([new Uint8Array(3 * 1024 * 1024)], "manual.pdf", { type: "application/pdf" });
  Object.defineProperty(arquivo, "arrayBuffer", { value: async () => new Uint8Array(3 * 1024 * 1024).buffer });
  const entrada = document.querySelector<HTMLInputElement>("#knowledge-file")!;
  Object.defineProperty(entrada, "files", { value: [arquivo], configurable: true });
  await act(async () => {
    entrada.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => {
    botao("Anexar ao Agent Dute")!.click();
  });
  for (let i = 0; i < 200 && estado.lotes.length === 0; i += 1) await drenar(1);
  expect(estado.lotes).toHaveLength(1);
}

const toasts = () => estado.toasts.map((t) => t.title);
const principal = () => document.querySelector<HTMLButtonElement>("form .botao-acao")!;
const atual = () => principal().querySelector(".botao-acao-camada[data-atual]")?.textContent;
const partesDaEspera = () =>
  [document.querySelector('[data-progresso="etapas"]'), document.querySelector("[data-lugar-do-aviso]"), principal()].map((no) => no?.outerHTML ?? "").join("");
const TEXTOS_DA_ESPERA = [
  "Etapa",
  /^\d$/,
  /^de \d$/,
  "Cadastro",
  "Arquivo",
  "Trechos",
  "Sem confirmação do servidor",
  "Demorando mais que o normal",
  /^\d:\d\d$/,
  "Anexar ao Agent Dute",
  "Anexando…",
  "Conferindo…",
  "Anexado",
  "Não anexado",
  "Conferir",
];

describe("o prazo de 70 s no Conhecimento", () => {
  it("a gravação lenta, mas andando, não desiste aos 70 s do começo nem vira sucesso com os pedaços faltando", async () => {
    await anexarPdf();
    // O primeiro lote leva 40 s e sobe; o segundo ainda está subindo quando dá 70 s.
    await passar(40_000);
    await act(async () => estado.lotes[0].soltar());
    await drenar();
    expect(estado.lotes).toHaveLength(2);
    await passar(30_500);
    expect(document.body.textContent).not.toContain("Sem confirmação do servidor");
    expect(botao("Conferir")).toBeUndefined();
    expect(toasts()).not.toContain("Conhecimento anexado ao Agent Dute");
    // O segundo lote sobe: anexado, com o evento.
    await act(async () => estado.lotes[1].soltar());
    await drenar();
    expect(toasts()).toContain("Conhecimento anexado ao Agent Dute");
    expect(estado.eventos).toBe(1);
  });

  it("a gravação que para 70 s depois do último lote fica sem resposta; o Conferir com o arquivo pela metade volta a \"Anexar\"", async () => {
    await anexarPdf();
    await passar(10_000);
    await act(async () => estado.lotes[0].soltar());
    await drenar();
    // O segundo lote não termina.
    await passar(70_500);
    expect(document.body.textContent).toContain("Sem confirmação do servidor");
    expect(botao("Conferir")).toBeDefined();
    await passar(1_100);
    await act(async () => botao("Conferir")!.click());
    await drenar();
    await passar(1_000);
    expect(toasts()).not.toContain("Conhecimento anexado ao Agent Dute");
    expect(atual()).toBe("Anexar ao Agent Dute");
    expect(estado.eventos).toBe(0);
  });

  it("o Conferir com o arquivo inteiro gravado por baixo segue o sucesso e manda o evento que não tinha saído", async () => {
    await anexarPdf();
    await passar(10_000);
    await act(async () => estado.lotes[0].soltar());
    await drenar();
    await passar(70_500);
    expect(botao("Conferir")).toBeDefined();
    // A gravação termina por baixo, depois da desistência.
    await act(async () => estado.lotes[1].soltar());
    await drenar();
    expect(toasts()).not.toContain("Conhecimento anexado ao Agent Dute");
    await passar(1_100);
    await act(async () => botao("Conferir")!.click());
    await drenar();
    expect(toasts()).toContain("Conhecimento anexado ao Agent Dute");
    expect(estado.eventos).toBe(1);
  });

  it("em repouso, as etapas e o lugar do aviso já estão no formulário; o botão tem 44 px", async () => {
    expect(document.querySelector('[data-progresso="etapas"] [role="progressbar"]')?.getAttribute("aria-valuetext")).toBe("Etapa 1 de 2");
    expect(document.querySelector("[data-lugar-do-aviso]")).not.toBeNull();
    expect(principal().className).toContain("min-h-11");
    expect(textosForaDaLista(partesDaEspera(), TEXTOS_DA_ESPERA)).toEqual([]);
    vi.useRealTimers();
    expect(await violacoesDeAcessibilidade(partesDaEspera())).toEqual([]);
  });

  it("o arquivo de texto tem três etapas, com a forma estreita marcada para o formulário", async () => {
    const arquivo = new File(["linha um\nlinha dois"], "notas.txt", { type: "text/plain" });
    const entrada = document.querySelector<HTMLInputElement>("#knowledge-file")!;
    Object.defineProperty(entrada, "files", { value: [arquivo], configurable: true });
    await act(async () => {
      entrada.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(document.querySelector('[data-progresso="etapas"] [role="progressbar"]')?.getAttribute("aria-valuetext")).toBe("Etapa 1 de 3");
    expect(document.querySelector(".carregando-etapas")?.getAttribute("data-n")).toBe("3");
    expect(textosForaDaLista(partesDaEspera(), TEXTOS_DA_ESPERA)).toEqual([]);
  });
});

describe("a base do Conhecimento sem o servidor (carregamento v2, parte 12)", () => {
  it("a leitura que só achou o cache é falta de conexão, e nunca \"Sem documentos na base\" nem os contadores em 0", async () => {
    estado.soCache = true;
    await act(async () => {
      await client.resetQueries();
    });
    await passar(0);
    expect(document.body.textContent).not.toContain("Sem documentos na base");
    const falta = document.querySelector<HTMLElement>("[data-falta]");
    expect(falta).not.toBeNull();
    expect(falta!.textContent).toContain("Tentar de novo");
    // Os números não chegaram: nem "0", nem os blocos de quem ainda espera.
    expect(document.querySelectorAll('[data-esqueleto][data-forma="contagem"]')).toHaveLength(0);
    expect([...document.querySelectorAll("[data-contador]")].map((contador) => contador.textContent)).toEqual(Array(4).fill("—Não carregou"));
  });

  it("com o servidor, a base vazia diz que está vazia", async () => {
    // O react-query avisa a tela pelo relógio (setTimeout 0).
    await passar(0);
    expect(document.body.textContent).toContain("Sem documentos na base");
    expect(document.querySelector("[data-falta]")).toBeNull();
  });
});

describe("os contadores do Conhecimento, cada um pela leitura dele", () => {
  it("os arquivos fonte que falharam não prendem os números dos documentos, e dizem que não carregaram", async () => {
    estado.falhaEm = "ai_agent_knowledge_files";
    estado.documentos = [{ id: "doc-1", data: () => ({ title: "Procedimento de recebimento", chunk_count: 7, extraction_status: "processed" }) }];
    await act(async () => {
      await client.resetQueries();
    });
    await passar(120_000);
    const contadores = Object.fromEntries(
      [...document.querySelectorAll<HTMLElement>("[data-contador]")].map((contador) => [contador.dataset.contador, contador.textContent]),
    );
    expect(contadores).toEqual({ Documentos: "1", Consultáveis: "1", Trechos: "7", "Arquivos fonte": "—Não carregou" });
    expect(document.querySelectorAll('[data-esqueleto][data-forma="contagem"]')).toHaveLength(0);
    const naoCarregou = document.querySelector('[data-contador="Arquivos fonte"] .sr-only');
    expect(naoCarregou?.textContent).toBe("Não carregou");
  });
});
