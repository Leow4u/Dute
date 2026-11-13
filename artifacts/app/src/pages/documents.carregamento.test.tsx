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
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));

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
    await new Promise((pronto) => setTimeout(pronto, estado.postAtraso));
    const id = decodeURIComponent(url.pathname.split("/")[3] ?? "");
    const documento = estado.documentos.find((item) => item.id === id);
    if (metodo === "DELETE" && documento) Object.assign(documento, { status: "archived", archived_at: "2026-11-13T13:43:00Z" });
    return json({ ok: true });
  }
  await new Promise((pronto) => setTimeout(pronto, estado.atrasos[url.pathname] ?? 30));
  if (estado.falhas.has(url.pathname)) return json({ message: "Falha interna no servidor." }, 500);
  if (url.pathname === "/api/documents") return json({ items: estado.documentos });
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
