// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A linha de produto novo da chegada avulsa, pelo padrão do nome de
 * 06/11/2026: o Tamanho sai do fim do código, e o nome que repete ou
 * contradiz o tamanho desliga o envio, com a mensagem na linha. A linha de
 * produto do cadastro não ganha Tamanho nem é conferida (o nome antigo fica
 * até o passo 3).
 */

const estado = vi.hoisted(() => ({
  catalogo: [
    {
      id: "BTG-000090",
      cod_btg: "BTG-000090",
      sku_code: "BTG-000090",
      cod_cliente: "A.01.0806.090.GG",
      produto: "Camisa social - GG",
      customer_code: "BTG Pactual",
    },
  ],
}));

vi.mock("@/lib/warehouse-ops/model", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/warehouse-ops/model")>();
  return {
    ...original,
    fetchJson: async (url: string) => {
      const { pathname } = new URL(url, "http://dute.local");
      if (pathname === "/api/skus") return { items: estado.catalogo };
      if (pathname === "/api/products") return { items: [] };
      throw new Error(`Chamada inesperada: ${url}`);
    },
  };
});

vi.mock("@/features/warehouse-ops/shared", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/features/warehouse-ops/shared")>();
  return {
    ...original,
    uploadProductPhoto: async (file: File) => ({
      fileName: file.name,
      fileUrl: `https://example.com/${file.name}`,
      storagePath: `produtos/${file.name}`,
    }),
  };
});

vi.mock("@/lib/active-customer-context", () => ({
  useActiveCustomer: () => ({
    code: "BTG Pactual",
    active: { code: "BTG Pactual", name: "BTG Pactual" },
    isLoading: false,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));

import { UnplannedReceiptDialog } from "./receiving";

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;
let client: QueryClient;
let props: ComponentProps<typeof UnplannedReceiptDialog>;

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

function botao(texto: string) {
  return Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.trim() === texto);
}

async function clicar(texto: string) {
  const alvo = botao(texto);
  if (!alvo) throw new Error(`Sem o botão ${texto}`);
  await act(async () => alvo.click());
}

async function anexarFoto() {
  const entrada = campo("#receipt-photo-0");
  const foto = new File(["foto"], "frente.jpg", { type: "image/jpeg" });
  Object.defineProperty(entrada, "files", { value: [foto], configurable: true });
  await act(async () => {
    entrada.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await esperar(() => Boolean(document.querySelector('img[src="https://example.com/frente.jpg"]')), "a foto anexada");
}

const CODIGO = 'input[aria-label="Código do produto da linha 1"]';
const PRODUTO = 'input[placeholder="Produto"]';
const TAMANHO = 'input[placeholder="Tamanho"]';
const enviar = () => botao("Criar conferência")!;
const linha = () => document.querySelector<HTMLButtonElement>("button[aria-pressed]")!;

/** A linha de produto novo completa: código, cadastro novo, categoria, custo e foto. */
async function linhaDeProdutoNovo(nome: string) {
  await digitarLetraALetra(CODIGO, "A.01.0806.005.XG");
  await clicar("Cadastrar como novo");
  await digitar(PRODUTO, nome);
  await digitar('input[placeholder="Categoria *"]', "Polo");
  await digitar('input[placeholder="Custo"]', "48.9");
  await anexarFoto();
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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

describe("a chegada avulsa: o Tamanho do produto novo pelo código", () => {
  it("o fim do código preenche o Tamanho do cadastro novo", async () => {
    await digitarLetraALetra(CODIGO, "A.01.0806.005.XG");
    await clicar("Cadastrar como novo");
    expect(campo(TAMANHO).value).toBe("XG");
  });

  it("o Tamanho que a pessoa digitou fica, mesmo trocando o código", async () => {
    await digitarLetraALetra(CODIGO, "A.01.0806.005.XG");
    await clicar("Cadastrar como novo");
    await digitar(TAMANHO, "G");
    await digitar(CODIGO, "A.01.0806.005.GG");
    await clicar("Cadastrar como novo");
    expect(campo(TAMANHO).value).toBe("G");
  });

  it("a linha de produto do cadastro não ganha Tamanho", async () => {
    await digitarLetraALetra(CODIGO, "A.01.0806.090.GG");
    await esperar(() => campo('input[aria-label="SKU da linha 1"]').value === "BTG-000090", "o cadastro encontrado");
    await act(async () => {
      document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(props.onCreate).toHaveBeenCalledTimes(1);
    const enviado = vi.mocked(props.onCreate).mock.calls[0]![0] as { items: Array<Record<string, unknown>> };
    expect(enviado.items[0]).toMatchObject({ product_registration: "existing", product_name: "Camisa social - GG" });
    expect(enviado.items[0]!.size).toBeUndefined();
  });
});

describe("a chegada avulsa: o nome do produto novo no padrão", () => {
  it("o nome com o tamanho desliga o envio, com a mensagem na linha", async () => {
    await linhaDeProdutoNovo("Polo Masculino Piquet Preto XG");
    expect(enviar().disabled).toBe(true);
    await esperar(() => Boolean(document.getElementById("receipt-line-0-product-problema")), "a mensagem do nome");
    expect(document.getElementById("receipt-line-0-product-problema")!.textContent).toBe(
      "O tamanho XG fica no campo Tamanho. O nome é o mesmo em todos os tamanhos de A.01.0806.005.",
    );
    expect(campo(PRODUTO).getAttribute("aria-invalid")).toBe("true");
    expect(campo(PRODUTO).getAttribute("aria-describedby")).toBe("receipt-line-0-product-problema");
    expect(linha().textContent).toContain("Cadastro incompleto");

    await act(async () => {
      document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(props.onCreate).not.toHaveBeenCalled();

    await digitar(PRODUTO, "Polo Masculino Piquet Preto");
    expect(enviar().disabled).toBe(false);
    expect(document.getElementById("receipt-line-0-product-problema")).toBeNull();
    expect(linha().textContent).toContain("Produto novo confirmado");

    await act(async () => enviar().click());
    expect(props.onCreate).toHaveBeenCalledTimes(1);
    const enviado = vi.mocked(props.onCreate).mock.calls[0]![0] as { items: Array<Record<string, unknown>> };
    expect(enviado.items[0]).toMatchObject({
      product_registration: "new",
      client_item_code: "A.01.0806.005.XG",
      product_name: "Polo Masculino Piquet Preto",
      size: "XG",
    });
  });

  it("o Tamanho que contradiz o código desliga o envio, com a mensagem embaixo do Tamanho", async () => {
    await linhaDeProdutoNovo("Polo Masculino Piquet Preto");
    expect(enviar().disabled).toBe(false);
    await digitar(TAMANHO, "G");
    expect(enviar().disabled).toBe(true);
    await esperar(() => Boolean(document.getElementById("receipt-line-0-size-problema")), "a mensagem do Tamanho");
    expect(document.getElementById("receipt-line-0-size-problema")!.textContent).toBe(
      "O código A.01.0806.005.XG é do tamanho XG, e o Tamanho informado é G.",
    );
    expect(campo(TAMANHO).getAttribute("aria-describedby")).toBe("receipt-line-0-size-problema");
    expect(document.getElementById("receipt-line-0-product-problema")).toBeNull();
  });
});
