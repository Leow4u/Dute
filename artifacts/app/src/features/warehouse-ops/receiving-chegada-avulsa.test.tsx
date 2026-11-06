// @vitest-environment jsdom
import { readFileSync } from "node:fs";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A chegada avulsa acha o produto pelo código em todo o catálogo do cliente
 * ativo. A lista da API devolve a página padrão (50 linhas,
 * DEFAULT_LIST_LIMIT em lib/cloud-api.ts, os maiores códigos primeiro)
 * quando a tela não pede um limite, e a busca lia só essa página: em
 * 30/10/2026 o A.01.0806.005.GG (BTG-000090) ficou fora dela, a pessoa
 * cadastrou como novo e as Functions recusaram com "já existe no cadastro
 * com SKU BTG-000090". A Contagem e as devoluções já pediam o catálogo
 * inteiro.
 */

const estado = vi.hoisted(() => {
  const PAGINA_PADRAO = 50;
  // 200 SKUs: a página padrão são os 50 maiores (BTG-000151 a 200), e o BTG-000090 fica fora dela.
  const catalogo = Array.from({ length: 200 }, (_, indice) => {
    const numero = String(indice + 1).padStart(3, "0");
    const sku = `BTG-000${numero}`;
    const codigo = `A.01.0806.${numero}.GG`;
    return {
      sku: { id: sku, cod_btg: sku, sku_code: sku, cod_cliente: codigo, cod_cliente_key: codigo, produto: `Camisa ${codigo}`, customer_code: "BTG Pactual", estoque_atual: 0 },
      produto: { id: codigo, cod_cliente: codigo, cod_cliente_key: codigo, produto: `Camisa ${codigo}`, customer_code: "BTG Pactual" },
    };
  });
  // `segurar` deixa a leitura do catálogo pendente até a promessa resolver; `falhar` faz a leitura recusar.
  return { PAGINA_PADRAO, catalogo, chamadas: [] as string[], customerCode: "BTG Pactual", segurar: null as Promise<void> | null, falhar: false };
});

vi.mock("@/lib/warehouse-ops/model", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/warehouse-ops/model")>();
  return {
    ...original,
    // A lista da API: a página pedida em `limit`, ou a padrão, em ordem
    // decrescente de código (como a rota de lib/cloud-api.ts).
    fetchJson: async (url: string) => {
      estado.chamadas.push(url);
      if (estado.falhar) throw new Error("Sem conexão");
      if (estado.segurar) await estado.segurar;
      const { pathname, searchParams } = new URL(url, "http://dute.local");
      const limite = Number(searchParams.get("limit")) || estado.PAGINA_PADRAO;
      const decrescente = [...estado.catalogo].reverse();
      if (pathname === "/api/skus") {
        return { items: decrescente.map((item) => item.sku).slice(0, limite), total: estado.catalogo.length };
      }
      if (pathname === "/api/products") {
        return { items: decrescente.map((item) => item.produto).slice(0, limite), total: estado.catalogo.length };
      }
      throw new Error(`Chamada inesperada: ${url}`);
    },
  };
});

vi.mock("@/lib/active-customer-context", () => ({
  useActiveCustomer: () => ({
    code: estado.customerCode,
    active: { code: estado.customerCode, name: estado.customerCode },
    isLoading: false,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));

import { UnplannedReceiptDialog } from "./receiving";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela } from "@/test/textos";

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;
let client: QueryClient;
let props: ComponentProps<typeof UnplannedReceiptDialog>;
async function renderDialog(patch: Partial<typeof props> = {}) {
  props = { ...props, ...patch };
  await act(async () => raiz!.render(<QueryClientProvider client={client}><UnplannedReceiptDialog {...props} /></QueryClientProvider>));
}
async function submit() {
  await act(async () => { document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
}
async function typeDocument(value: string) {
  const input = document.querySelector<HTMLInputElement>("#chegada-documento")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function esperar(condicao: () => boolean, oQue: string) {
  for (let volta = 0; volta < 50; volta += 1) {
    if (condicao()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  throw new Error(`Não aconteceu: ${oQue}`);
}

function campo(rotulo: string) {
  const elemento = document.querySelector<HTMLInputElement>(`input[aria-label="${rotulo}"]`);
  if (!elemento) throw new Error(`Sem o campo ${rotulo}`);
  return elemento;
}

async function digitar(rotulo: string, valor: string) {
  const elemento = campo(rotulo);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(elemento, valor);
    elemento.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  estado.chamadas.length = 0;
  estado.customerCode = "BTG Pactual";
  estado.segurar = null;
  estado.falhar = false;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  props = { open: true, isPending: false, onOpenChange: vi.fn(), onCreate: vi.fn(async () => undefined) };
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  await renderDialog();
  await esperar(
    () => estado.chamadas.some((url) => url.startsWith("/api/skus")) && estado.chamadas.some((url) => url.startsWith("/api/products")),
    "a leitura do catálogo",
  );
});

afterEach(() => {
  act(() => raiz?.unmount());
  client.clear();
  vi.unstubAllGlobals();
  container?.remove();
  raiz = null;
  container = null;
});

describe("a busca de produto da chegada avulsa", () => {
  it("pede o catálogo inteiro do cliente, não a página padrão da API", () => {
    const limites = estado.chamadas.map((url) => Number(new URL(url, "http://dute.local").searchParams.get("limit")));
    expect(limites).toHaveLength(2);
    // O shim corta em 2000 (CATALOG_READ_CAP, lib/cloud-api.ts) mesmo pedindo
    // mais, e conta a coleção inteira, de todos os clientes; pedir menos que
    // isso esconde produto.
    for (const limite of limites) expect(limite).toBeGreaterThanOrEqual(2000);
  });

  it("acha pelo código do cliente um produto fora da página de 50 e mostra o SKU dele", async () => {
    await digitar("Código do produto da linha 1", "A.01.0806.090.GG");
    await esperar(() => campo("SKU da linha 1").value === "BTG-000090", "o cadastro encontrado");
    expect(document.body.textContent).toContain("Cadastro encontrado");
    expect(document.body.textContent).not.toContain("Identificação pendente");
  });
});

/** Um QueryClient novo, sem o catálogo em cache, e a leitura como o teste pedir. */
async function remontar(ajuste: () => void) {
  act(() => raiz!.unmount());
  client.clear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  ajuste();
  raiz = createRoot(container!);
  await renderDialog();
}

function botao(texto: string) {
  return Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.trim() === texto);
}

function linha(numero: number) {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("button[aria-pressed]"))[numero - 1]!;
}

/**
 * Antes de o catálogo chegar, todo código caía em "Produto não localizado" e a
 * tela oferecia "Cadastrar como novo" para um produto que existe; as Functions
 * recusavam no fim, depois de a pessoa preencher categoria, custo e foto
 * (docs/plataforma/diagnostico-carregamento.md, decisão 6 de 06/11/2026).
 */
describe("antes de o catálogo chegar", () => {
  it("diz que está verificando, não oferece o cadastro novo e não conta zero", async () => {
    let soltar!: () => void;
    await remontar(() => {
      estado.segurar = new Promise<void>((pronto) => { soltar = pronto; });
    });
    await digitar("Código do produto da linha 1", "A.01.0806.090.GG");
    const texto = () => document.body.textContent ?? "";
    expect(texto()).toContain("Verificando o catálogo…");
    expect(linha(1).textContent).toContain("Verificando o catálogo");
    expect(texto()).not.toContain("Produto não localizado pelo código informado");
    expect(botao("Cadastrar como novo")).toBeUndefined();
    expect(texto()).toContain("Produtos existentes—");
    expect(texto()).toContain("Novos cadastros—");
    expect(botao("Criar conferência")!.disabled).toBe(true);

    estado.segurar = null;
    await act(async () => soltar());
    await esperar(() => campo("SKU da linha 1").value === "BTG-000090", "o cadastro encontrado");
    expect(linha(1).textContent).toContain("Cadastro encontrado");
    expect(texto()).not.toContain("Verificando o catálogo");
    expect(texto()).toContain("Produtos existentes1");
  });

  it("quando o catálogo não vem, mostra a falha, bloqueia o cadastro novo e deixa tentar de novo", async () => {
    await remontar(() => {
      estado.falhar = true;
    });
    await digitar("Código do produto da linha 1", "A.01.0806.090.GG");
    await esperar(() => (document.body.textContent ?? "").includes("Não consegui carregar o catálogo."), "a falha do catálogo");
    expect(linha(1).textContent).toContain("Sem catálogo");
    expect(botao("Cadastrar como novo")).toBeUndefined();
    expect(document.body.textContent).not.toContain("Produto não localizado pelo código informado");
    expect(botao("Criar conferência")!.disabled).toBe(true);

    estado.falhar = false;
    await act(async () => botao("Tentar de novo")!.click());
    await esperar(() => campo("SKU da linha 1").value === "BTG-000090", "o cadastro depois da nova tentativa");
    expect(linha(1).textContent).toContain("Cadastro encontrado");
    expect(document.body.textContent).not.toContain("Não consegui carregar o catálogo.");
  });
});

describe("as buscas de catálogo das telas do WMS", () => {
  it("toda leitura de /api/skus e /api/products de um formulário pede o limite", () => {
    for (const arquivo of ["./receiving.tsx", "./inventory.tsx", "./exceptions.tsx"]) {
      const fonte = readFileSync(new URL(arquivo, import.meta.url), "utf8");
      // Qualquer forma da chamada (genérico, aspas); um hook compartilhado de
      // busca de catálogo terá de entrar nesta lista.
      const leituras = [...fonte.matchAll(/fetchJson(?:<[^>]*>)?\(\s*["'`]\/api\/(?:skus|products)([^"'`]*)["'`]/g)];
      expect(leituras.length, arquivo).toBeGreaterThan(0);
      for (const leitura of leituras) {
        expect(leitura[1], `${arquivo}: ${leitura[0]}`).toMatch(/^\?limit=\d+$/);
        expect(Number(leitura[1]!.slice("?limit=".length)), `${arquivo}: ${leitura[0]}`).toBeGreaterThanOrEqual(2000);
      }
    }
  });
});


describe("a intenção de registrar chegada avulsa", () => {
  it("preserva formulário e payload exato após falha, trava envio síncrono e só limpa depois de sucesso", async () => {
    let resolve!: () => void;
    const onCreate = vi.fn().mockRejectedValueOnce(new Error("Sem conexão"))
      .mockImplementationOnce(() => new Promise<void>((done) => { resolve = done; }));
    await renderDialog({ onCreate });
    await digitar("Código do produto da linha 1", "A.01.0806.090.GG");
    await esperar(() => campo("SKU da linha 1").value === "BTG-000090", "produto");
    await typeDocument("0042-A");
    await submit();
    expect(props.onOpenChange).not.toHaveBeenCalled();
    expect(campo("Código do produto da linha 1").value).toBe("A.01.0806.090.GG");
    expect(document.querySelector<HTMLInputElement>("#chegada-documento")!.value).toBe("0042-A");
    await act(async () => {
      const form = document.querySelector("form")!;
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(onCreate).toHaveBeenCalledTimes(2);
    expect(onCreate.mock.calls[1][0]).toEqual(onCreate.mock.calls[0][0]);
    expect(props.onOpenChange).not.toHaveBeenCalled();
    await act(async () => resolve());
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    await renderDialog({ open: false });
    await renderDialog({ open: true });
    expect(campo("Código do produto da linha 1").value).toBe("");
    expect(document.querySelector<HTMLInputElement>("#chegada-documento")!.value).toBe("");
  });

  it("repete a intenção já enviada mesmo se catálogo ou fila mudaram após perder a resposta", async () => {
    const onCreate = vi.fn().mockRejectedValueOnce(new Error("Resposta perdida")).mockResolvedValueOnce(undefined);
    await renderDialog({ onCreate });
    await digitar("Código do produto da linha 1", "A.01.0806.090.GG");
    await esperar(() => campo("SKU da linha 1").value === "BTG-000090", "produto");
    await typeDocument("046143");
    await submit();
    // Refetch pode trazer o cadastro recém-criado ou a própria chegada; replay
    // precisa mandar o recibo original, independentemente do catálogo atual.
    await act(async () => { client.setQueryData(["receiving-product-lookup", "BTG Pactual"], []); });
    await renderDialog({ receipts: [{ id: "receiving:criada", title: "AVL-001", customer_code: "BTG Pactual", invoice_number: "046143", status: "created", items: [{ client_item_code: "A.01.0806.090.GG", expected_quantity: 1 }] }] });
    await submit();
    expect(onCreate).toHaveBeenCalledTimes(2);
    expect(onCreate.mock.calls[1][0]).toEqual(onCreate.mock.calls[0][0]);
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("resposta antiga não fecha nem apaga novo rascunho após trocar de cliente e voltar", async () => {
    let resolve!: () => void;
    const onCreate = vi.fn(() => new Promise<void>((done) => { resolve = done; }));
    await renderDialog({ onCreate });
    await digitar("Código do produto da linha 1", "A.01.0806.090.GG");
    await esperar(() => campo("SKU da linha 1").value === "BTG-000090", "produto");
    await submit();
    estado.customerCode = "Outro cliente";
    await renderDialog();
    estado.customerCode = "BTG Pactual";
    await renderDialog();
    await typeDocument("Nova intenção");
    await act(async () => resolve());
    expect(props.onOpenChange).not.toHaveBeenCalled();
    expect(document.querySelector<HTMLInputElement>("#chegada-documento")!.value).toBe("Nova intenção");
  });

  it("uma alteração deliberada depois do erro cria outra intenção e trocar cliente limpa o rascunho", async () => {
    const onCreate = vi.fn().mockRejectedValue(new Error("Sem conexão"));
    await renderDialog({ onCreate });
    await digitar("Código do produto da linha 1", "A.01.0806.090.GG");
    await esperar(() => campo("SKU da linha 1").value === "BTG-000090", "produto");
    await submit();
    await typeDocument("NF nova");
    await submit();
    expect(onCreate.mock.calls[1][0].idempotency_key).not.toBe(onCreate.mock.calls[0][0].idempotency_key);
    estado.customerCode = "Outro cliente";
    await renderDialog();
    expect(campo("Código do produto da linha 1").value).toBe("");
    expect(document.querySelector<HTMLInputElement>("#chegada-documento")!.value).toBe("");
  });
});


describe("possível duplicidade na criação", () => {
  it("exige decisão consciente para mesmo documento e itens, oferecendo abrir a chegada existente", async () => {
    const onCreate = vi.fn(async () => undefined);
    const onOpenReceipt = vi.fn();
    const existing = { id: "receiving:inb_avulso_1", title: "AVL-001", customer_code: "BTG Pactual", invoice_number: "046143", status: "checking", quantity: 1, items: [{ client_item_code: "A.01.0806.090.GG", sku_code: "BTG-000090", expected_quantity: 1 }] };
    await renderDialog({ receipts: [existing], onCreate, onOpenReceipt });
    await digitar("Código do produto da linha 1", "A.01.0806.090.GG");
    await esperar(() => campo("SKU da linha 1").value === "BTG-000090", "produto");
    await typeDocument("046143");
    expect(document.body.textContent).toContain("Possível duplicidade nos recebimentos carregados");
    expect(document.body.textContent).toContain("AVL-001");
    const warning = Array.from(document.querySelectorAll('[role="alert"]')).find((alert) => alert.textContent?.includes("Possível duplicidade"))!;
    expect(textosDaTela(warning.outerHTML)).toEqual(["Possível duplicidade nos recebimentos carregados", "Mesmo documento e itens declarados.", "AVL-001 · NF 046143 · 1 un. · em conferência", "Abrir recebimento", "Registrar outra entrega"]);
    expect(await violacoesDeAcessibilidade(warning.outerHTML)).toEqual([]);
    await submit();
    expect(onCreate).not.toHaveBeenCalled();
    const button = (text: string) => Array.from(document.querySelectorAll("button")).find((button) => button.textContent === text)!;
    await act(async () => button("Registrar outra entrega").click());
    await submit();
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("quantidades diferentes permitem outra entrega da mesma NF; abrir existente não cria", async () => {
    const onCreate = vi.fn(async () => undefined);
    const onOpenReceipt = vi.fn();
    const existing = { id: "receiving:inb_avulso_1", title: "AVL-001", customer_code: "BTG Pactual", invoice_number: "046143", status: "checking", items: [{ client_item_code: "A.01.0806.090.GG", expected_quantity: 2 }] };
    await renderDialog({ receipts: [existing], onCreate, onOpenReceipt });
    await digitar("Código do produto da linha 1", "A.01.0806.090.GG");
    await esperar(() => campo("SKU da linha 1").value === "BTG-000090", "produto");
    await typeDocument("046143");
    expect(document.body.textContent).not.toContain("Possível duplicidade");
    await renderDialog({ receipts: [{ ...existing, items: [{ client_item_code: "A.01.0806.090.GG", expected_quantity: 1 }] }] });
    const button = Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "Abrir recebimento")!;
    await act(async () => button.click());
    expect(onOpenReceipt).toHaveBeenCalledWith(expect.objectContaining({ id: existing.id }));
    expect(onCreate).not.toHaveBeenCalled();
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });
});
