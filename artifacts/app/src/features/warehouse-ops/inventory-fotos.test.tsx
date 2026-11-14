// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * As fotos do produto novo na Contagem (carregamento v2, parte 11): sobem
 * uma por vez com o progresso, e o "Adicionar foto" fica ocupado sem
 * `disabled` (com ele, o foco que estava no botão caía no corpo). Dados
 * sintéticos; o envio ao Storage é simulado.
 */

const estado = vi.hoisted(() => {
  const FOTO = "https://storage.googleapis.com/dute-prod.appspot.com/produtos/BTG/A.02.0809.002.P/frente.jpg";
  const irmao = (tamanho: string, numero: number) => ({
    id: `BTG-000${numero}`,
    cod_btg: `BTG-000${numero}`,
    sku_code: `BTG-000${numero}`,
    cod_cliente: `A.02.0809.002.${tamanho}`,
    produto: `Polo feminino piquet arpoador - ${tamanho}`,
    customer_code: "BTG Pactual",
    categoria: "Polo",
    genero: "Feminino",
    grupo: "VESTUÁRIO",
    cor: "Azul",
    marca: "Arpoador",
    tamanho,
    preco_unit: 39.9,
    photo_urls: [FOTO],
    photo_storage_paths: ["produtos/BTG/A.02.0809.002.P/frente.jpg"],
  });
  return {
    FOTO,
    // A ordem da API não é a dos tamanhos: o cartão põe em ordem.
    skus: [irmao("G", 133), irmao("P", 131), irmao("M", 132)],
    linhas: [] as Array<Record<string, unknown>>,
    envios: [] as Array<() => void>,
  };
});

vi.mock("@/features/warehouse-ops/shared", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/features/warehouse-ops/shared")>();
  return {
    ...original,
    uploadProductPhoto: (file: File) =>
      new Promise((resolve) => {
        estado.envios.push(() => resolve({ fileName: file.name, fileUrl: `https://example.com/${file.name}`, storagePath: `produtos/${file.name}` }));
      }),
  };
});

const CAIXA = {
  code: "CX-000150",
  customer_code: "BTG Pactual",
  status: "counting",
  location_id: "",
  origin: { session_id: "abertura-1" },
  conference_revision: 0,
  draft_line_count: 0,
  draft_unit_count: 0,
};

vi.mock("@/lib/warehouse-ops/model", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/warehouse-ops/model")>();
  return {
    ...original,
    fetchJson: async (url: string, init?: { method?: string; body?: string }) => {
      const { pathname } = new URL(url, "http://dute.local");
      if (pathname.startsWith("/api/warehouse/opening-inventory/session/")) {
        return { session_id: "abertura-1", customer_code: "BTG Pactual", status: "open", lines: [], line_count: 0, unit_count: 0, total_cost: 0 };
      }
      if (pathname === "/api/skus") return { items: estado.skus };
      if (pathname === "/api/products") return { items: [] };
      if (pathname === "/api/warehouse/boxes" || pathname === "/api/warehouse/positions") return { items: [], has_more: false };
      if (pathname === "/api/warehouse/opening-inventory/boxes" && init?.method === "POST") return { box: CAIXA, lines: [] };
      if (pathname === `/api/warehouse/opening-inventory/boxes/${CAIXA.code}/read`) return { box: CAIXA, lines: [] };
      if (pathname === `/api/warehouse/opening-inventory/boxes/${CAIXA.code}/lines`) {
        estado.linhas.push(JSON.parse(init?.body ?? "{}"));
        return { ok: true, box: CAIXA };
      }
      throw new Error(`Chamada inesperada: ${init?.method ?? "GET"} ${url}`);
    },
  };
});

vi.mock("@/lib/active-customer-context", () => ({
  useActiveCustomer: () => ({
    code: "BTG Pactual",
    active: { code: "BTG Pactual", name: "BTG Pactual", profile: { skuPrefix: "BTG", source: "published", template: "uniformes" } },
    isLoading: false,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));

import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosForaDaLista } from "@/test/textos";

import { OpeningInventoryWorkspace } from "./inventory";

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;
let client: QueryClient;

async function esperar(condicao: () => boolean, oQue: string) {
  // A mensagem do nome espera a pessoa parar de digitar (600 ms).
  for (let volta = 0; volta < 200; volta += 1) {
    if (condicao()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  throw new Error(`Não aconteceu: ${oQue}`);
}

/** O botão pelo rótulo; no BotaoDeAcao (carregamento v2, parte 13b), pela camada de repouso. */
function botao(texto: string) {
  return Array.from(document.querySelectorAll("button")).find(
    (button) => (button.querySelector('[data-camada="repouso"]') ?? button).textContent?.trim() === texto,
  );
}

function campo(seletor: string) {
  const elemento = document.querySelector<HTMLInputElement>(seletor);
  if (!elemento) throw new Error(`Sem o campo ${seletor}`);
  return elemento;
}

async function digitar(seletor: string, valor: string) {
  const elemento = campo(seletor);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(elemento, valor);
    elemento.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function digitarLetraALetra(seletor: string, valor: string) {
  for (let fim = 1; fim <= valor.length; fim += 1) await digitar(seletor, valor.slice(0, fim));
}

const CODIGO = "#opening-client-code";
const PRODUTO = "#opening-product";
const TAMANHO = "#opening-size";
const CATEGORIA = 'input[placeholder="Obrigatória para novo"]';
const MARCA = 'input[placeholder="Marca"]';
const COR = 'input[placeholder="Cor"]';
const CONTAGEM = 'input[placeholder="0"]';
const CUSTO = 'input[placeholder="R$ 0,00"]';

const texto = () => document.body.textContent ?? "";
const cartaoDaFamilia = () => texto().includes("Família A.02.0809.002 · 3 tamanhos no cadastro");
const lancar = () => botao("Salvar na conferência")!;
const selecionados = () => Array.from(document.querySelectorAll('button[role="combobox"]')).map((trigger) => trigger.textContent?.trim());

/** A caixa aberta e o catálogo do cliente lido: o formulário de lançar produto. */
async function abrirCaixa() {
  await esperar(() => Boolean(botao("Iniciar conferência da caixa")), "a sessão aberta");
  await act(async () => botao("Iniciar conferência da caixa")!.click());
  await esperar(() => Boolean(document.querySelector(CODIGO)) && !texto().includes("Verificando o catálogo"), "o formulário da caixa");
}

async function marcar(seletor: string) {
  await act(async () => document.querySelector<HTMLButtonElement>(seletor)!.click());
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // O Checkbox do Radix mede o controle dentro do formulário.
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  estado.linhas = [];
  estado.envios = [];
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  await act(async () => raiz!.render(<QueryClientProvider client={client}><OpeningInventoryWorkspace /></QueryClientProvider>));
  await abrirCaixa();
});

afterEach(() => {
  act(() => raiz?.unmount());
  client.clear();
  vi.unstubAllGlobals();
  container?.remove();
  raiz = null;
  container = null;
  document.body.innerHTML = "";
});

describe("as fotos do produto novo na Contagem", () => {
  it("\"Adicionar foto\" fica ocupado sem disabled enquanto as fotos sobem: o foco fica nele, e o progresso conta", async () => {
    const adicionar = () => botao("Adicionar foto")!;
    adicionar().focus();
    const entrada = campo("#opening-product-photo");
    Object.defineProperty(entrada, "files", { value: [new File(["x"], "f1.jpg", { type: "image/jpeg" }), new File(["x"], "f2.jpg", { type: "image/jpeg" })], configurable: true });
    await act(async () => {
      entrada.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(adicionar().getAttribute("aria-disabled")).toBe("true");
    expect(adicionar().hasAttribute("disabled")).toBe(false);
    expect(entrada.hasAttribute("disabled")).toBe(false);
    expect(document.activeElement).toBe(adicionar());
    // Ocupado, o toque não abre a escolha de novo.
    const abrir = vi.spyOn(entrada, "click");
    await act(async () => adicionar().click());
    expect(abrir).not.toHaveBeenCalled();
    const bloco = () => document.querySelector("[data-fotos-enviando]")!.outerHTML;
    const TEXTOS = ["Enviando fotos", /^\d$/, /^de \d$/, /^\d fotos? enviadas?$/];
    expect(document.querySelector('[data-fotos-enviando] [role="progressbar"]')?.getAttribute("aria-valuetext")).toBe("1 de 2 fotos");
    expect(textosForaDaLista(bloco(), TEXTOS)).toEqual([]);
    expect(await violacoesDeAcessibilidade(bloco())).toEqual([]);
    await act(async () => estado.envios[0]());
    await esperar(() => estado.envios.length === 2, "a segunda foto");
    await act(async () => estado.envios[1]());
    await esperar(() => !adicionar().hasAttribute("aria-disabled"), "o botão livre");
    expect(textosForaDaLista(bloco(), TEXTOS)).toEqual([]);
  });
});
