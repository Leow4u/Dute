// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * As fotos da chegada avulsa (carregamento v2, parte 11 e momento 6): sobem
 * uma por vez, com "Enviando fotos" e "1 de 4"; a escolha de 6 leva 4 e diz
 * "Só 4 fotos sobem por vez." (antes, o corte era calado); e o diálogo não
 * fecha enquanto elas sobem (antes, o Esc e o Cancelar fechavam e as fotos
 * se perdiam). Dados sintéticos.
 */

type Envio = { nome: string; aoProgredir?: (fracao: number) => void; resolver: () => void };
const estado = vi.hoisted(() => ({ envios: [] as Envio[] }));

vi.mock("@/lib/warehouse-ops/model", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/warehouse-ops/model")>();
  return {
    ...original,
    fetchJson: async (url: string) => {
      const { pathname } = new URL(url, "http://dute.local");
      if (pathname === "/api/skus" || pathname === "/api/products") return { items: [] };
      throw new Error(`Chamada inesperada: ${url}`);
    },
  };
});

vi.mock("@/features/warehouse-ops/shared", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/features/warehouse-ops/shared")>();
  return {
    ...original,
    uploadProductPhoto: (file: File, _codigo: string, _cliente: string, aoProgredir?: (fracao: number) => void) =>
      new Promise((resolve) => {
        estado.envios.push({
          nome: file.name,
          aoProgredir,
          resolver: () => resolve({ fileName: file.name, fileUrl: `https://example.com/${file.name}`, storagePath: `produtos/${file.name}` }),
        });
      }),
  };
});

vi.mock("@/lib/active-customer-context", () => ({
  useActiveCustomer: () => ({ code: "BTG Pactual", active: { code: "BTG Pactual", name: "BTG Pactual" }, isLoading: false }),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));

import { textosDaTela } from "@/test/textos";

import { UnplannedReceiptDialog } from "./receiving";

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;
let client: QueryClient;
let props: ComponentProps<typeof UnplannedReceiptDialog>;

async function esperar(condicao: () => boolean, oQue: string) {
  for (let volta = 0; volta < 200; volta += 1) {
    if (condicao()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  throw new Error(`Não aconteceu: ${oQue}`);
}

async function digitar(seletor: string, valor: string) {
  const elemento = document.querySelector<HTMLInputElement>(seletor)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(elemento, valor);
    elemento.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** A linha de produto novo, que é a que pede foto. */
async function linhaDeProdutoNovo() {
  const codigo = "A.01.0806.005.XG";
  for (let fim = 1; fim <= codigo.length; fim += 1) await digitar('input[aria-label="Código do produto da linha 1"]', codigo.slice(0, fim));
  await esperar(() => Boolean(Array.from(document.querySelectorAll("button")).find((botao) => botao.textContent?.trim() === "Cadastrar como novo")), "o cadastro novo");
  await act(async () => Array.from(document.querySelectorAll("button")).find((botao) => botao.textContent?.trim() === "Cadastrar como novo")!.click());
}

async function escolherFotos(quantas: number) {
  await linhaDeProdutoNovo();
  const entrada = document.querySelector<HTMLInputElement>("#receipt-photo-0")!;
  const fotos = Array.from({ length: quantas }, (_, indice) => new File(["foto"], `foto-${indice + 1}.jpg`, { type: "image/jpeg" }));
  Object.defineProperty(entrada, "files", { value: fotos, configurable: true });
  await act(async () => {
    entrada.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function soltar(indice: number) {
  await act(async () => {
    estado.envios[indice].resolver();
    await Promise.resolve();
  });
}

const barra = () => document.querySelector<HTMLElement>('[data-fotos-enviando] [role="progressbar"]');
const cancelar = () => Array.from(document.querySelectorAll("button")).find((botao) => botao.textContent?.trim() === "Cancelar")!;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  estado.envios = [];
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  props = { open: true, isPending: false, onOpenChange: vi.fn(), onCreate: vi.fn(async () => undefined) };
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  await act(async () => raiz!.render(<QueryClientProvider client={client}><UnplannedReceiptDialog {...props} /></QueryClientProvider>));
  await esperar(() => client.getQueryData(["receiving-product-lookup", "BTG Pactual"]) !== undefined, "o catálogo");
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

describe("as fotos da chegada avulsa", () => {
  it("sobem uma por vez, com \"Enviando fotos\" e a contagem; a escolha de 6 leva 4 e diz por quê", async () => {
    await escolherFotos(6);
    // Só rótulos e dados: o aviso da escolha, o título e a contagem.
    expect(textosDaTela(document.querySelector("[data-fotos-enviando]")!.outerHTML)).toEqual(["Só 4 fotos sobem por vez.", "Enviando fotos", "1", "de 4"]);
    expect(barra()?.getAttribute("aria-label")).toBe("Enviando fotos");
    expect(barra()?.getAttribute("aria-valuetext")).toBe("1 de 4 fotos");
    expect(estado.envios.map((envio) => envio.nome)).toEqual(["foto-1.jpg"]);
    await act(async () => estado.envios[0].aoProgredir?.(0.5));
    expect(document.querySelector<HTMLElement>('[data-segmento][data-estado="andamento"]')?.style.getPropertyValue("--f")).toBe("0.5");
    await soltar(0);
    expect(estado.envios.map((envio) => envio.nome)).toEqual(["foto-1.jpg", "foto-2.jpg"]);
    expect(barra()?.getAttribute("aria-valuetext")).toBe("2 de 4 fotos");
    await soltar(1);
    await soltar(2);
    await soltar(3);
    expect(estado.envios).toHaveLength(4);
    await esperar(() => Boolean(document.querySelector('img[src="https://example.com/foto-4.jpg"]')), "as fotos na linha");
    expect(document.querySelector("[data-fotos-enviando]")?.textContent).toContain("4 fotos enviadas");
    expect(barra()?.getAttribute("aria-valuetext")).toBe("4 de 4 fotos");
  });

  it("o diálogo não fecha enquanto as fotos sobem: nem o Esc, nem o Cancelar", async () => {
    await escolherFotos(2);
    const dialogo = document.querySelector<HTMLElement>('[role="dialog"]')!;
    await act(async () => {
      dialogo.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(cancelar().getAttribute("aria-disabled")).toBe("true");
    await act(async () => cancelar().click());
    expect(props.onOpenChange).not.toHaveBeenCalled();
    await soltar(0);
    await soltar(1);
    // Com as fotos na linha, o Cancelar volta a fechar.
    expect(cancelar().hasAttribute("aria-disabled")).toBe(false);
    await act(async () => cancelar().click());
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });
});
