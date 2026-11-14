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
 * Documentos no carregamento v2 (parte 13d; diagnóstico, seção 4.9 e
 * necessidades 2, 3, 5, 8 e 10). Antes:
 * - a lista dizia "Carregando documentos..." em texto seco;
 * - a leitura que falhava (também a releitura, com a lista na tela) trocava a
 *   lista pelo texto do erro, sem "Tentar de novo";
 * - a falha dos avisos de chegada era ignorada: as NFs do cliente sumiam sem
 *   aviso, e a lista vazia dizia "Nenhum documento ainda";
 * - as ações do menu de cada linha (Arquivar, Conhecimento, Mostrar) não
 *   mostravam nada enquanto gravavam, e o segundo toque gravava de novo;
 * - "Adicionar documento" abria com o cliente ativo ainda lendo (o documento
 *   iria para o cliente padrão).
 * Relógio simulado. Dados sintéticos.
 */

const estado = vi.hoisted(() => ({
  atrasos: {} as Record<string, number>,
  falhas: new Set<string>(),
  postAtraso: 1_000,
  documentos: [] as Array<Record<string, unknown>>,
  chamadas: [] as string[],
  corpos: [] as string[],
  toasts: [] as string[],
  falharPost: 0,
  carregandoCliente: false,
}));

vi.mock("@/lib/auth", () => ({ useAppUser: () => ({ user: { uid: "u-1", publicMetadata: { role: "admin" } }, isLoaded: true }) }));
vi.mock("@/lib/active-customer-context", () => ({
  useActiveCustomer: () => ({
    code: "BTG",
    active: { code: "BTG", name: "BTG Pactual" },
    options: [],
    isLoading: estado.carregandoCliente,
  }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: (aviso: { title: string }) => estado.toasts.push(aviso.title) }) }));

import Documents from "./documents";

const AGORA = Date.parse("2026-11-13T13:42:00Z");
const DOCUMENTOS = () => [
  { id: "doc1", title: "NF 48213", file_name: "nf-48213.pdf", document_type: "nf_entrada", storage_path: "d/1.pdf", file_url: "https://storage.example/1.pdf", status: "internal", created_at: "2026-11-12T12:00:00Z" },
  { id: "doc2", title: "Contrato de armazenagem", file_name: "contrato.pdf", document_type: "contrato", storage_path: "d/2.pdf", file_url: "https://storage.example/2.pdf", customer_visible: true, visibility: "customer", status: "published", created_at: "2026-11-10T12:00:00Z" },
];
const AVISOS = [
  { id: "creq1", customer_code: "BTG", invoice_number: "4521", supplier: "Malharia Sul", created_at: "2026-11-11T12:00:00Z", requested_by: { name: "Ana" }, attachments: [{ file_name: "nf-4521.pdf", storage_path: "c/4521.pdf", file_url: "https://storage.example/4521.pdf" }] },
];

async function servir(entrada: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(String(entrada instanceof Request ? entrada.url : entrada), "http://localhost");
  const metodo = (init?.method ?? "GET").toUpperCase();
  estado.chamadas.push(`${metodo} ${url.pathname}`);
  const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
  if (metodo !== "GET") {
    estado.corpos.push(`${metodo} ${url.pathname} ${String(init?.body ?? "")}`);
    await new Promise((pronto) => setTimeout(pronto, estado.postAtraso));
    if (estado.falharPost > 0) {
      estado.falharPost -= 1;
      return json({ message: "Falha interna no servidor." }, 500);
    }
    const id = decodeURIComponent(url.pathname.split("/")[3] ?? "");
    const documento = estado.documentos.find((item) => item.id === id);
    if (metodo === "DELETE" && documento) Object.assign(documento, { status: "archived", archived_at: "2026-11-13T13:43:00Z" });
    return json({ ok: true });
  }
  await new Promise((pronto) => setTimeout(pronto, estado.atrasos[url.pathname] ?? 30));
  if (estado.falhas.has(url.pathname)) return json({ message: "Falha interna no servidor." }, 500);
  if (url.pathname === "/api/documents") return json({ items: estado.documentos.map((documento) => ({ ...documento })) });
  if (url.pathname === "/api/customer-requests") return json({ items: AVISOS });
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
  estado.documentos = DOCUMENTOS();
  estado.chamadas = [];
  estado.corpos = [];
  estado.toasts = [];
  estado.falharPost = 0;
  estado.carregandoCliente = false;
  window.localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  cliente = new QueryClient({ defaultOptions: { queries: { retry: false, networkMode: "always", refetchOnWindowFocus: false } } });
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  container.remove();
  document.body.innerHTML = "";
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
          <Documents />
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
const linhaDaTabela = (titulo: string) => Array.from(container.querySelectorAll("tbody tr")).find((tr) => tr.textContent?.includes(titulo));
const menuDa = (titulo: string) => linhaDaTabela(titulo)?.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]');
function botao(rotulo: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (item) => (item.querySelector(".botao-acao-camada[data-atual]")?.textContent ?? item.textContent ?? "").trim() === rotulo,
  );
}

async function escolherNoMenu(titulo: string, item: string) {
  const menu = menuDa(titulo);
  if (!menu) throw new Error(`sem o menu de ${titulo}`);
  menu.focus();
  await act(async () => {
    menu.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
  });
  const opcao = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((elemento) => elemento.textContent?.trim() === item);
  if (!opcao) throw new Error(`sem ${item} no menu de ${titulo}`);
  await act(async () => opcao.click());
}

/** O HTML visto em cada estado, para o axe no fim do teste, com o relógio de verdade (o do jsdom dele). */
const paraOAxe: string[] = [];
async function axeDoQueVimos() {
  vi.useRealTimers();
  for (const html of paraOAxe.splice(0)) expect(await violacoesDeAcessibilidade(html)).toEqual([]);
}

describe("Documentos, antes de ler", () => {
  it("nunca \"Carregando documentos...\": a linha sob o título diz \"Carregando documentos…\" aos 300 ms, com as linhas-fantasma", async () => {
    estado.atrasos = { "/api/documents": 2_000, "/api/customer-requests": 2_000 };
    await montar();
    expect(texto()).not.toMatch(/Carregando documentos\.\.\.|Nenhum documento/);
    expect(container.querySelector("[data-fantasmas][data-visivel]")).toBeNull();
    await passar(350);
    expect(linha()?.textContent).toContain("Carregando documentos…");
    expect(container.querySelectorAll("tr[data-fantasmas][data-visivel]").length).toBeGreaterThan(0);
    expect(container.querySelector('tbody[aria-busy="true"]')?.getAttribute("aria-describedby")).toBe(linha()?.id);
    expect(
      textosForaDaLista(semAnunciador(), [
        "Documentos", "NFs, comprovantes e contratos do cliente ativo", "Adicionar documento", "Carregando documentos…", "Filtros",
        "Tipo de documento", "Todos", "NF", "Comprovante", "Contrato", "Outros", "Quem vê", "Cliente vê", "Só Dutelog", "Arquivados",
        "Documento", "Tipo", "Vinculado a", "Data", "Buscar por nome, NF ou pedido",
      ]),
    ).toEqual([]);
    paraOAxe.push(semAnunciador());
    await passar(2_000);
    expect(texto()).toContain("NF 48213");
    expect(texto()).toContain("NF 4521");
    expect(container.querySelector("[data-fantasmas]")).toBeNull();
    await axeDoQueVimos();
  });

  it("a leitura que falha sem nada lido mostra o aviso com \"Tentar de novo\", que relê", async () => {
    estado.falhas = new Set(["/api/documents"]);
    await montar();
    await passar(300);
    expect(texto()).toContain("Não consegui carregar os documentos.");
    const tentar = botao("Tentar de novo");
    expect(tentar).toBeDefined();
    estado.falhas = new Set();
    await act(async () => tentar!.click());
    await passar(300);
    expect(texto()).toContain("NF 48213");
  });

  it("a releitura que falha com a lista lida não a apaga: a linha diz \"Não consegui atualizar\"", async () => {
    await montar();
    await passar(300);
    expect(texto()).toContain("NF 48213");
    estado.falhas = new Set(["/api/documents"]);
    await act(async () => {
      void cliente.invalidateQueries({ queryKey: ["operational-documents"] });
    });
    await passar(300);
    expect(texto()).toContain("NF 48213");
    expect(linha()?.textContent).toContain("Não consegui atualizar");
  });

  it("os avisos de chegada que falham: o aviso diz que as NFs do cliente não vieram, e a lista vazia não afirma \"Nenhum documento ainda\"", async () => {
    estado.falhas = new Set(["/api/customer-requests"]);
    estado.documentos = [];
    await montar();
    await passar(300);
    expect(texto()).toContain("Não consegui carregar as NFs dos avisos de chegada.");
    expect(botao("Tentar de novo")).toBeDefined();
    expect(texto()).not.toContain("Nenhum documento ainda");
  });
});

describe("as ações de cada documento", () => {
  it("Arquivar: só a linha tocada espera, com o \"⋯\" ocupado (sem disabled) e \"Arquivando…\" aos 300 ms; o segundo toque não grava de novo", async () => {
    await montar();
    await passar(300);
    await escolherNoMenu("NF 48213", "Arquivar");
    const menu = menuDa("NF 48213")!;
    expect(menu.getAttribute("aria-disabled")).toBe("true");
    expect(menu.disabled).toBe(false);
    await passar(350);
    expect(menu.getAttribute("aria-busy")).toBe("true");
    expect(menu.querySelector("[data-spinner]")).not.toBeNull();
    expect(linhaDaTabela("NF 48213")?.textContent).toContain("Arquivando…");
    // A outra linha segue livre.
    const outro = menuDa("Contrato de armazenagem")!;
    expect(outro.getAttribute("aria-disabled")).toBeNull();
    // O menu da linha ocupada não abre: o segundo toque não grava de novo.
    await act(async () => {
      menu.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    });
    expect(document.querySelector('[role="menuitem"]')).toBeNull();
    paraOAxe.push(semAnunciador());
    await passar(2_000);
    expect(estado.chamadas.filter((chamada) => chamada.startsWith("DELETE")).length).toBe(1);
    // Arquivado, o documento sai de "Todos"; o foco que estava no "⋯" dele vai à linha de estado, nunca ao body.
    expect(linhaDaTabela("NF 48213")).toBeUndefined();
    expect(document.activeElement).toBe(linha());
    await axeDoQueVimos();
  });

  it("Adicionar documento espera o cliente ativo: o documento nunca vai para o cliente padrão", async () => {
    estado.carregandoCliente = true;
    await montar();
    await passar(300);
    const adicionar = botao("Adicionar documento")!;
    expect(adicionar.getAttribute("aria-disabled")).toBe("true");
    await act(async () => adicionar.click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});

const anuncio = () => container.querySelector("[data-anunciador]")?.textContent ?? "";
/** O texto da célula do documento (o nome e a linha de apoio). */
const celulaDoNome = (titulo: string) => (linhaDaTabela(titulo)?.querySelector("td")?.textContent ?? "").replace(/\s+/g, " ");
const conferirDa = (titulo: string) =>
  Array.from(linhaDaTabela(titulo)?.querySelectorAll<HTMLButtonElement>("button") ?? []).find((item) => /^Conferi/.test(item.textContent?.trim() ?? ""));
async function buscar(valor: string) {
  const campo = container.querySelector<HTMLInputElement>('input[placeholder="Buscar por nome, NF ou pedido"]')!;
  await act(async () => {
    const definir = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    definir.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
/** Os textos que a linha do documento pode mostrar: os dados e cada estado da ação (a trava contra legenda). */
const TEXTOS_DA_LINHA = [
  "NF 48213", "nf-48213.pdf", "Contrato de armazenagem", "contrato.pdf", "NF 4521", "nf-4521.pdf", "Anexado ao aviso de chegada",
  "Arquivando…", "Arquivando NF 48213…", "Ocultando do cliente…", "Enviando para o Conhecimento…", "Demorando mais que o normal", "·",
  /^\d+:\d{2}$/, "Sem confirmação do servidor", "Conferir", "Conferindo…", "Arquivado", "Oculto do cliente", "Enviado para o Conhecimento",
  "Falha interna no servidor.", "NF de entrada", "Contrato", "NF", "Só Dutelog", "Cliente vê", "Enviado pelo cliente", /^\d{2}\/\d{2}\/\d{2}$/, "—",
  /^(NF )?4521/, /Malharia Sul/, /Ana/,
];
const textosDasLinhas = () =>
  textosForaDaLista(Array.from(container.querySelectorAll("tbody tr")).map((tr) => tr.outerHTML).join(""), TEXTOS_DA_LINHA);

describe("as ações de cada documento, depois da revisão (parte 13d)", () => {
  it("o menu não reabre sozinho quando a linha solta, no sucesso nem na falha, e o foco fica no \"⋯\"", async () => {
    await montar();
    await passar(300);
    await escolherNoMenu("NF 48213", "Ocultar do cliente");
    await passar(4_000);
    const menu = menuDa("NF 48213")!;
    expect(menu.getAttribute("aria-disabled")).toBeNull();
    expect(menu.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector('[role="menuitem"]')).toBeNull();
    expect(document.activeElement).toBe(menu);
    estado.falharPost = 1;
    await escolherNoMenu("NF 48213", "Enviar para o Conhecimento");
    await passar(1_500);
    expect(linhaDaTabela("NF 48213")?.textContent).toContain("Falha interna no servidor.");
    expect(menuDa("NF 48213")!.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector('[role="menuitem"]')).toBeNull();
    await passar(3_000);
    expect(document.querySelector('[role="menuitem"]')).toBeNull();
  });

  it("no sucesso, a linha diz o que mudou (\"Arquivado\") até a lista relida chegar, no lugar da origem, sem crescer", async () => {
    await montar();
    await passar(300);
    const filhos = linhaDaTabela("NF 48213")!.querySelector("td")!.childElementCount;
    estado.atrasos = { "/api/documents": 3_000 };
    await escolherNoMenu("NF 48213", "Arquivar");
    await passar(350);
    // O apoio entra no lugar da origem: a célula tem as mesmas linhas.
    expect(celulaDoNome("NF 48213")).toContain("Arquivando…");
    expect(celulaDoNome("NF 48213")).not.toContain("nf-48213.pdf");
    expect(linhaDaTabela("NF 48213")!.querySelector("td")!.childElementCount).toBe(filhos);
    expect(textosDasLinhas()).toEqual([]);
    await passar(1_000);
    expect(estado.toasts).toContain("Documento arquivado");
    expect(celulaDoNome("NF 48213")).toContain("Arquivado");
    expect(linhaDaTabela("NF 48213")!.querySelector("td")!.childElementCount).toBe(filhos);
    const menu = menuDa("NF 48213")!;
    expect(menu.getAttribute("aria-describedby")).toBeTruthy();
    expect(document.getElementById(menu.getAttribute("aria-describedby")!)?.textContent).toContain("Arquivado");
    expect(textosDasLinhas()).toEqual([]);
    paraOAxe.push(semAnunciador());
    await passar(3_000);
    expect(linhaDaTabela("NF 48213")).toBeUndefined();
    await axeDoQueVimos();
  });

  it("o \"Conferir\" dos 70 s relê e diz \"Conferindo…\", nunca \"Arquivando…\" de novo; o botão fica com o foco e nada é reenviado", async () => {
    estado.postAtraso = 200_000;
    await montar();
    await passar(300);
    await escolherNoMenu("NF 48213", "Arquivar");
    await passar(70_100);
    expect(celulaDoNome("NF 48213")).toContain("Sem confirmação do servidor");
    expect(celulaDoNome("NF 48213")).not.toContain("Sem confirmação do servidor.");
    expect(textosDasLinhas()).toEqual([]);
    const conferir = conferirDa("NF 48213")!;
    expect(conferir.textContent?.trim()).toBe("Conferir");
    estado.atrasos = { "/api/documents": 3_000 };
    const antes = estado.chamadas.length;
    conferir.focus();
    await act(async () => conferir.click());
    await passar(400);
    expect(celulaDoNome("NF 48213")).not.toContain("Arquivando");
    expect(conferirDa("NF 48213")?.textContent?.trim()).toBe("Conferindo…");
    expect(conferirDa("NF 48213")?.getAttribute("aria-busy")).toBe("true");
    expect(document.activeElement).toBe(conferirDa("NF 48213"));
    expect(menuDa("NF 48213")?.getAttribute("aria-label")).toBe("Conferindo NF 48213…");
    expect(textosDasLinhas()).toEqual([]);
    await passar(2_000);
    expect(anuncio()).not.toContain("Arquivando");
    expect(estado.chamadas.slice(antes)).toEqual(["GET /api/documents"]);
    // A lista relida diz que não arquivou: a linha volta, e o foco vai ao "⋯" dela, nunca ao body.
    await passar(1_500);
    expect(conferirDa("NF 48213")).toBeUndefined();
    expect(document.activeElement).toBe(menuDa("NF 48213"));
  });

  it("a resposta que chega depois do \"Conferir\" que disse que não valeu relê a lista: o documento arquivado sai", async () => {
    estado.postAtraso = 75_000;
    await montar();
    await passar(300);
    await escolherNoMenu("NF 48213", "Arquivar");
    await passar(70_100);
    await act(async () => conferirDa("NF 48213")!.click());
    await passar(500);
    expect(conferirDa("NF 48213")).toBeUndefined();
    const lidas = estado.chamadas.filter((chamada) => chamada === "GET /api/documents").length;
    await passar(5_000);
    expect(estado.toasts).toContain("Documento arquivado");
    expect(estado.chamadas.filter((chamada) => chamada === "GET /api/documents").length).toBeGreaterThan(lidas);
    expect(linhaDaTabela("NF 48213")).toBeUndefined();
  });

  it("a linha que sai da lista e volta no meio da ação segue o mesmo relógio, sem anunciar de novo", async () => {
    estado.postAtraso = 40_000;
    await montar();
    await passar(300);
    await escolherNoMenu("NF 48213", "Arquivar");
    await passar(12_000);
    expect(celulaDoNome("NF 48213")).toContain("Demorando mais que o normal");
    expect(celulaDoNome("NF 48213")).toContain("0:12");
    await passar(2_100);
    const falados = anuncio();
    await buscar("Contrato");
    await passar(100);
    expect(linhaDaTabela("NF 48213")).toBeUndefined();
    await buscar("");
    await passar(350);
    expect(celulaDoNome("NF 48213")).toContain("Demorando mais que o normal");
    expect(celulaDoNome("NF 48213")).not.toContain("Arquivando…");
    await passar(2_100);
    expect(anuncio()).toBe(falados);
  });

  it("a repetição do \"Enviar para o Conhecimento\" depois da falha incerta leva a mesma chave ao servidor", async () => {
    estado.falharPost = 1;
    await montar();
    await passar(300);
    await escolherNoMenu("NF 48213", "Enviar para o Conhecimento");
    await passar(4_000);
    await escolherNoMenu("NF 48213", "Enviar para o Conhecimento");
    await passar(2_000);
    const chaves = estado.corpos
      .filter((corpo) => corpo.startsWith("POST /api/documents/doc1/extract"))
      .map((corpo) => (JSON.parse(corpo.slice(corpo.indexOf("{"))) as { idempotency_key?: string }).idempotency_key);
    expect(chaves).toHaveLength(2);
    expect(chaves[0]).toBeTruthy();
    expect(chaves[1]).toBe(chaves[0]);
  });

  it("o \"⋯\" tem 48 px no celular, e \"Adicionar documento\" esperando o cliente mostra a caixa, nunca só a opacidade", async () => {
    estado.carregandoCliente = true;
    await montar();
    await passar(350);
    const adicionar = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.textContent?.includes("Adicionar documento"))!;
    expect(adicionar.getAttribute("aria-busy")).toBe("true");
    expect(adicionar.querySelector("[data-spinner]")).not.toBeNull();
    expect(adicionar.className).not.toContain("opacity-45");
    expect(menuDa("NF 48213")?.className).toContain("max-md:size-12");
  });

  it("um brilho por cartão: o corpo da tabela lendo, nunca cada bloco; e a chegada entra em cascata", async () => {
    estado.atrasos = { "/api/documents": 2_000, "/api/customer-requests": 2_000 };
    await montar();
    await passar(350);
    expect(container.querySelector("tbody[aria-busy]")?.classList.contains("carregando-com-brilho")).toBe(true);
    expect(container.querySelectorAll("[data-esqueleto].carregando-com-brilho")).toHaveLength(0);
    await passar(1_700);
    expect(texto()).toContain("NF 48213");
    expect(container.querySelector("tbody[data-chegada]")).not.toBeNull();
    await passar(1_000);
    expect(container.querySelector("tbody[data-chegada]")).toBeNull();
  });
});

describe("a segunda visita a Documentos", () => {
  it("as linhas-fantasma lembram quantos documentos têm o selo do Conhecimento: a linha com o selo tem a terceira linha de texto", async () => {
    estado.documentos = [...DOCUMENTOS(), { id: "doc4", title: "NF 48190", file_name: "nf-48190.pdf", document_type: "nf_entrada", storage_path: "d/4.pdf", file_url: "https://storage.example/4.pdf", status: "internal", knowledge_status: "pending_approval", created_at: "2026-11-08T12:00:00Z" }];
    await montar();
    await passar(300);
    expect(texto()).toContain("Aguardando aprovação para o Conhecimento");
    act(() => raiz?.unmount());
    raiz = null;
    cliente.clear();
    estado.atrasos = { "/api/documents": 5_000, "/api/customer-requests": 5_000 };
    await montar();
    await passar(350);
    const fantasmas = Array.from(container.querySelectorAll("tbody tr[data-fantasmas]"));
    expect(fantasmas).toHaveLength(4);
    // A célula do nome: o nome e a origem; com o selo, a terceira linha.
    const linhasDoNome = fantasmas.map((tr) => tr.querySelector("td")!.querySelectorAll("[data-esqueleto]").length);
    expect(linhasDoNome.filter((linhas) => linhas === 3)).toHaveLength(1);
    const cartoes = Array.from(container.querySelectorAll("ul li[data-fantasmas]"));
    expect(cartoes.filter((li) => li.querySelector("[data-selo]"))).toHaveLength(1);
  });
});
