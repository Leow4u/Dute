// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosForaDaLista } from "@/test/textos";

/**
 * "Adicionar documento" (carregamento v2, parte 11 e momento 6): o arquivo
 * sobe e o documento é cadastrado, em duas etapas. O arquivo que já subiu
 * não sobe de novo na repetição, mas só para o mesmo cliente (o
 * `customer_code` é a fronteira): trocar o cliente ativo faz o arquivo subir
 * de novo, na pasta do novo. As etapas e o lugar do aviso ficam no diálogo
 * desde o repouso; o "Conferir" relê e diz "Conferindo…". Dados sintéticos.
 */

const estado = vi.hoisted(() => ({
  cliente: "Cliente A",
  chamadas: [] as Array<{ url: string; metodo: string; corpo: Record<string, unknown> | null }>,
  cadastroFalha: true,
  /** O cadastro sem resposta no prazo: o 504 do deadline-exceeded. */
  cadastroSemResposta: false,
  /** A leitura da lista espera até o teste soltar (o Conferir em andamento). */
  listaPresa: null as Array<() => void> | null,
  /** O envio do arquivo espera até o teste soltar (o diálogo gravando). */
  envioPreso: null as Array<() => void> | null,
  /** O que a lista devolve. */
  lista: [] as Array<Record<string, unknown>>,
  toasts: [] as unknown[],
}));

vi.mock("@/lib/auth", () => ({
  useAppUser: () => ({ user: { uid: "u1", publicMetadata: { role: "admin" } }, isLoaded: true }),
}));
vi.mock("@/lib/active-customer-context", () => ({
  useActiveCustomer: () => ({
    code: estado.cliente,
    active: { code: estado.cliente, name: estado.cliente },
    options: [],
    isLoading: false,
  }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: (t: unknown) => estado.toasts.push(t) }) }));
vi.mock("@/lib/file-base64", () => ({ fileToBase64: async () => "QUJD" }));

import Documents from "@/pages/documents";

function resposta(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
}

async function servir(entrada: RequestInfo | URL, init?: RequestInit) {
  const url = String(entrada);
  const metodo = (init?.method ?? "GET").toUpperCase();
  const corpo = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
  estado.chamadas.push({ url, metodo, corpo });
  if (url.startsWith("/api/documents/upload") && metodo === "POST") {
    const preso = estado.envioPreso;
    if (preso) await new Promise<void>((soltar) => preso.push(soltar));
    const pasta = String(corpo?.customer_code).replace(/\s+/g, "_");
    return resposta({
      file_name: "nf.pdf",
      file_url: `https://storage.example/operational-documents/${pasta}/2026-11/1-nf.pdf`,
      storage_path: `operational-documents/${pasta}/2026-11/1-nf.pdf`,
      content_type: "application/pdf",
      size_bytes: 3,
    });
  }
  if (url === "/api/documents" && metodo === "POST") {
    if (estado.cadastroSemResposta) return resposta({ message: "O servidor não respondeu a tempo. Confira antes de tentar de novo.", code: "deadline-exceeded" }, 504);
    if (estado.cadastroFalha) return resposta({ message: "Falha interna no servidor. Tente novamente ou avise o time técnico.", code: "internal" }, 500);
    return resposta({ id: "doc-1" }, 201);
  }
  if (url.startsWith("/api/documents")) {
    const presa = estado.listaPresa;
    if (presa) await new Promise<void>((soltar) => presa.push(soltar));
    return resposta({ items: estado.lista });
  }
  if (url.startsWith("/api/customer-requests")) return resposta({ items: [] });
  throw new Error(`Chamada inesperada: ${metodo} ${url}`);
}

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;
let client: QueryClient;

async function esperar(condicao: () => boolean, oQue: string) {
  for (let volta = 0; volta < 300; volta += 1) {
    if (condicao()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  throw new Error(`Não aconteceu: ${oQue}`);
}

const botao = (rotulo: string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((item) => {
    const camada = item.querySelector(".botao-acao-camada[data-atual]");
    return (camada?.textContent ?? item.textContent)?.trim() === rotulo;
  });

async function clicar(elemento: HTMLElement | undefined, oQue: string) {
  if (!elemento) throw new Error(`sem ${oQue}`);
  await act(async () => {
    elemento.click();
  });
}

async function render() {
  await act(async () =>
    raiz!.render(
      <QueryClientProvider client={client}>
        <Documents />
      </QueryClientProvider>,
    ),
  );
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(servir));
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  estado.cliente = "Cliente A";
  estado.chamadas = [];
  estado.cadastroFalha = true;
  estado.cadastroSemResposta = false;
  estado.listaPresa = null;
  estado.envioPreso = null;
  estado.lista = [];
  estado.toasts = [];
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  await render();
});

afterEach(() => {
  act(() => raiz?.unmount());
  client.clear();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const dialogo = () => document.querySelector<HTMLElement>('[role="dialog"]');
const noDialogo = (rotulo: string) =>
  Array.from(dialogo()?.querySelectorAll<HTMLButtonElement>("button") ?? []).find((item) => {
    const camada = item.querySelector(".botao-acao-camada[data-atual]");
    return (camada?.textContent ?? item.textContent)?.trim() === rotulo;
  });
const principal = () => dialogo()!.querySelector<HTMLButtonElement>(".botao-acao")!;
const atual = (botaoDeAcao: HTMLButtonElement) => botaoDeAcao.querySelector(".botao-acao-camada[data-atual]")?.textContent;

async function escolherArquivo(nome = "nf.pdf") {
  const entrada = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  const arquivo = new File(["ABC"], nome, { type: "application/pdf" });
  Object.defineProperty(entrada, "files", { value: [arquivo], configurable: true });
  await act(async () => {
    entrada.dispatchEvent(new Event("change", { bubbles: true }));
  });
  return arquivo;
}

/** Os textos das partes do diálogo que o carregamento mudou: as etapas, o aviso e o rodapé. */
const TEXTOS_DA_ESPERA = [
  "Etapa",
  /^\d$/,
  /^de \d$/,
  "Arquivo",
  "Cadastro",
  "Sem confirmação do servidor",
  "Demorando mais que o normal",
  /^\d:\d\d$/,
  "Cancelar",
  "Adicionar",
  "Adicionando…",
  "Conferindo…",
  "Adicionado",
  "Não adicionado",
  "Conferir",
];
const partesDaEspera = () =>
  [dialogo()!.querySelector('[data-progresso="etapas"]'), dialogo()!.querySelector("[data-lugar-do-aviso]"), principal().parentElement]
    .map((no) => no?.outerHTML ?? "")
    .join("");

describe("o arquivo já enviado e a troca do cliente ativo", () => {
  it("depois da troca de cliente, o documento novo não aponta para o arquivo da pasta do cliente anterior", async () => {
    await clicar(botao("Adicionar documento"), "Adicionar documento");
    await escolherArquivo();
    await clicar(botao("Adicionar"), "Adicionar");
    // O arquivo sobe na pasta do A; o cadastro falha.
    await esperar(() => estado.toasts.length > 0, "a falha do cadastro");
    const cadastros = () => estado.chamadas.filter((c) => c.url === "/api/documents" && c.metodo === "POST");
    expect(cadastros()).toHaveLength(1);
    expect(cadastros()[0].corpo?.customer_code).toBe("Cliente A");
    // Depois dos 2 s do "Não adicionado", Cancelar fecha.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2_100));
    });
    await clicar(botao("Cancelar"), "Cancelar");
    await esperar(() => !document.querySelector('[role="dialog"]'), "o diálogo fechado");

    // A pessoa troca o cliente ativo no menu e adiciona de novo.
    estado.cliente = "Cliente B";
    estado.cadastroFalha = false;
    await render();
    await clicar(botao("Adicionar documento"), "Adicionar documento");
    await esperar(() => Boolean(document.querySelector('[role="dialog"]')), "o diálogo aberto");
    await clicar(botao("Adicionar"), "Adicionar de novo");
    await esperar(() => cadastros().length === 2, "o segundo cadastro");
    const segundo = cadastros()[1].corpo!;
    const envios = estado.chamadas.filter((c) => c.url.startsWith("/api/documents/upload"));
    expect(segundo.customer_code).toBe("Cliente B");
    // O arquivo do documento do B mora na pasta do B: subiu de novo.
    expect(envios.map((c) => c.corpo?.customer_code)).toEqual(["Cliente A", "Cliente B"]);
    expect(String(segundo.storage_path)).toContain("operational-documents/Cliente_B/");
    expect(String(segundo.file_url)).toContain("operational-documents/Cliente_B/");
  });

  it("no mesmo cliente, a repetição usa o arquivo que já subiu: não sobe duas vezes", async () => {
    await clicar(botao("Adicionar documento"), "Adicionar documento");
    await escolherArquivo();
    await clicar(botao("Adicionar"), "Adicionar");
    await esperar(() => estado.toasts.length > 0, "a falha do cadastro");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2_100));
    });
    estado.cadastroFalha = false;
    await clicar(botao("Adicionar"), "Adicionar de novo");
    const cadastros = () => estado.chamadas.filter((c) => c.url === "/api/documents" && c.metodo === "POST");
    await esperar(() => cadastros().length === 2, "o segundo cadastro");
    expect(estado.chamadas.filter((c) => c.url.startsWith("/api/documents/upload"))).toHaveLength(1);
  });
});

describe("as etapas, o aviso e o Conferir", () => {
  it("em repouso, as etapas e o lugar do aviso já estão no diálogo, e os botões do rodapé têm 44 px", async () => {
    await clicar(botao("Adicionar documento"), "Adicionar documento");
    await esperar(() => Boolean(dialogo()), "o diálogo aberto");
    expect(dialogo()!.querySelector('[role="progressbar"]')?.getAttribute("aria-valuetext")).toBe("Etapa 1 de 2");
    expect([...dialogo()!.querySelectorAll<HTMLElement>("[data-etapa]")].map((etapa) => etapa.dataset.etapa)).toEqual(["fila", "fila"]);
    expect(dialogo()!.querySelector("[data-lugar-do-aviso]")).not.toBeNull();
    expect(noDialogo("Cancelar")?.className).toContain("min-h-11");
    expect(principal().className).toContain("min-h-11");
    expect(textosForaDaLista(partesDaEspera(), TEXTOS_DA_ESPERA)).toEqual([]);
    // O axe nas partes que a espera mudou: o resto do diálogo (o Select do tipo) não muda aqui, e o jsdom não lê o texto dele.
    expect(await violacoesDeAcessibilidade(partesDaEspera())).toEqual([]);
  });

  it("sem resposta no cadastro: \"Sem confirmação do servidor\" e o Conferir, que relê, diz \"Conferindo…\" e não reenvia", async () => {
    estado.cadastroSemResposta = true;
    await clicar(botao("Adicionar documento"), "Adicionar documento");
    await escolherArquivo();
    await clicar(botao("Adicionar"), "Adicionar");
    await esperar(() => atual(principal()) === "Conferir", "o Conferir");
    expect(dialogo()!.textContent).toContain("Sem confirmação do servidor");
    expect(document.body.textContent).not.toContain("deadline-exceeded");
    // Conferindo, a leitura fica presa até o teste soltar. O toque seguinte espera o intervalo do toque único.
    estado.listaPresa = [];
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1_100));
    });
    await clicar(principal(), "Conferir");
    await esperar(() => atual(principal()) === "Conferindo…", "o Conferindo…");
    expect(dialogo()!.textContent).toContain("Sem confirmação do servidor");
    expect(dialogo()!.querySelectorAll('[data-etapa="andamento"]')).toHaveLength(0);
    expect(noDialogo("Cancelar")?.getAttribute("aria-disabled")).toBe("true");
    expect(noDialogo("Fechar")?.getAttribute("aria-disabled")).toBe("true");
    expect(textosForaDaLista(partesDaEspera(), TEXTOS_DA_ESPERA)).toEqual([]);
    expect(await violacoesDeAcessibilidade(partesDaEspera())).toEqual([]);
    // O cadastro valeu por lá: a lista traz o documento com o arquivo enviado, e segue o sucesso.
    const enviado = estado.chamadas.find((c) => c.url.startsWith("/api/documents/upload"));
    estado.lista = [{ id: "doc-1", storage_path: `operational-documents/${String(enviado?.corpo?.customer_code).replace(/\s+/g, "_")}/2026-11/1-nf.pdf` }];
    for (const soltar of estado.listaPresa.splice(0)) soltar();
    estado.listaPresa = null;
    await esperar(() => !dialogo(), "o diálogo fechado");
    expect(estado.chamadas.filter((c) => c.url === "/api/documents" && c.metodo === "POST")).toHaveLength(1);
    expect(estado.toasts).toContainEqual({ title: "Documento adicionado" });
  });
});

describe("o diálogo gravando (carregamento v2, parte 13a)", () => {
  it("com o arquivo subindo, o Esc e o toque fora não fecham, o X e o Cancelar ficam aria-disabled e o X tem 44 px no celular", async () => {
    estado.envioPreso = [];
    await clicar(botao("Adicionar documento"), "Adicionar documento");
    await escolherArquivo();
    await clicar(botao("Adicionar"), "Adicionar");
    await esperar(() => estado.envioPreso!.length === 1 && Boolean(dialogo()?.hasAttribute("data-ocupado")), "o arquivo subindo");
    await act(async () => {
      (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
    });
    await clicar(noDialogo("Fechar"), "Fechar");
    await clicar(noDialogo("Cancelar"), "Cancelar");
    expect(dialogo()).not.toBeNull();
    for (const rotulo of ["Fechar", "Cancelar"]) {
      expect(noDialogo(rotulo)?.getAttribute("aria-disabled"), rotulo).toBe("true");
      expect(noDialogo(rotulo)?.disabled, rotulo).toBe(false);
    }
    expect(noDialogo("Fechar")?.className).toContain("max-md:size-11");
    expect(document.activeElement).not.toBe(document.body);
    for (const soltar of estado.envioPreso!.splice(0)) soltar();
    estado.envioPreso = null;
  });
});
