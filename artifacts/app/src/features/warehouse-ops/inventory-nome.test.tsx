// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O produto novo na Contagem (inventário de abertura), pelo padrão do nome de
 * 06/11/2026 (docs/mockups/NomeWmsContagem.dc.html): o Tamanho sai do fim do
 * código; o código novo de uma família do cadastro mostra o cartão da família
 * e preenche só o que está vazio; o nome que repete ou contradiz o tamanho
 * desliga o lançamento, com a mensagem embaixo do campo.
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

import { OpeningInventoryWorkspace, familiaNoCadastro } from "./inventory";
import type { ProductLookupItem } from "./shared";

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

function botao(texto: string) {
  return Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.trim() === texto);
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

describe("a Contagem: o Tamanho pelo código", () => {
  it("o fim do código preenche o Tamanho e acompanha a digitação, sem passar por cima do que a pessoa digitou", async () => {
    await digitarLetraALetra(CODIGO, "A.01.0900.001.G");
    expect(campo(TAMANHO).value).toBe("G");
    await digitar(CODIGO, "A.01.0900.001.GG");
    expect(campo(TAMANHO).value).toBe("GG");

    await digitar(TAMANHO, "EG");
    await digitar(CODIGO, "A.01.0900.001.XG");
    expect(campo(TAMANHO).value).toBe("EG");
  });
});

describe("a Contagem: o cartão da família", () => {
  it("o código novo de uma família do cadastro mostra a família e preenche os campos vazios com os dados do irmão", async () => {
    await digitarLetraALetra(CODIGO, "A.02.0809.002.GG");
    await esperar(cartaoDaFamilia, "o cartão da família");

    const cartao = Array.from(document.querySelectorAll('[role="status"]')).find((item) => item.textContent?.includes("Família A.02.0809.002"))!;
    expect(cartao.textContent).toContain("Polo Feminino Piquet Arpoador · P, M e G · tamanho GG novo");
    expect(cartao.textContent).toContain("Cadastrar o tamanho GG como novo");
    expect(texto()).not.toContain("Produto não localizado pelo código informado");

    expect(campo(PRODUTO).value).toBe("Polo Feminino Piquet Arpoador");
    expect(campo(TAMANHO).value).toBe("GG");
    expect(campo(CATEGORIA).value).toBe("Polo");
    expect(campo(MARCA).value).toBe("Arpoador");
    expect(campo(COR).value).toBe("Azul");
    expect(selecionados()).toEqual(expect.arrayContaining(["Feminino", "VESTUÁRIO"]));
    expect(document.querySelector<HTMLImageElement>('img[alt="Foto 1 do produto"]')?.src).toBe(estado.FOTO);

    // O mesmo controle do aviso de produto novo: cadastrar como novo.
    const novo = document.querySelector<HTMLButtonElement>("#opening-family-new")!;
    expect(novo.getAttribute("aria-checked")).toBe("false");
    await marcar("#opening-family-new");
    expect(novo.getAttribute("aria-checked")).toBe("true");
  });

  it("nunca passa por cima do que a pessoa já digitou", async () => {
    await digitar(PRODUTO, "Polo Arpoador Edição Especial");
    await digitar(COR, "Rosa");
    await digitarLetraALetra(CODIGO, "A.02.0809.002.GG");
    await esperar(cartaoDaFamilia, "o cartão da família");

    expect(campo(PRODUTO).value).toBe("Polo Arpoador Edição Especial");
    expect(campo(COR).value).toBe("Rosa");
    expect(campo(CATEGORIA).value).toBe("Polo");
    expect(campo(MARCA).value).toBe("Arpoador");
  });

  it("trocar para um código sem família tira o que a tela preencheu e deixa o que a pessoa digitou", async () => {
    await digitarLetraALetra(CODIGO, "A.02.0809.002.GG");
    await esperar(cartaoDaFamilia, "o cartão da família");
    await digitar(COR, "Rosa");

    await digitar(CODIGO, "A.01.0900.001.M");
    await esperar(() => texto().includes("Produto não localizado pelo código informado"), "o aviso de produto novo");
    expect(cartaoDaFamilia()).toBe(false);
    expect(campo(PRODUTO).value).toBe("");
    expect(campo(CATEGORIA).value).toBe("");
    expect(campo(MARCA).value).toBe("");
    expect(campo(COR).value).toBe("Rosa");
    expect(campo(TAMANHO).value).toBe("M");
    expect(document.querySelector('img[alt="Foto 1 do produto"]')).toBeNull();
  });
});

describe("a Contagem: o nome do produto novo no padrão", () => {
  async function produtoNovoCompleto() {
    await digitarLetraALetra(CODIGO, "A.02.0809.002.GG");
    await esperar(cartaoDaFamilia, "o cartão da família");
    await marcar("#opening-family-new");
    await digitar(CONTAGEM, "24");
    await digitar(CUSTO, "39.9");
    await marcar("#opening-confirm-box");
    await esperar(() => lancar().disabled === false, "o lançamento ligado");
  }

  it("o nome com o tamanho desliga o lançamento e a mensagem aparece embaixo do Produto", async () => {
    await produtoNovoCompleto();

    // Enquanto a pessoa digita, a letra solta no fim não acende a mensagem.
    await digitar(PRODUTO, "Polo Feminino P");
    expect(lancar().disabled).toBe(true);
    expect(document.getElementById("opening-product-problema")).toBeNull();

    await digitar(PRODUTO, "Polo Feminino Piquet Arpoador GG");
    expect(lancar().disabled).toBe(true);
    await esperar(() => Boolean(document.getElementById("opening-product-problema")), "a mensagem do nome");
    expect(document.getElementById("opening-product-problema")!.textContent).toBe(
      "O tamanho GG fica no campo Tamanho. O nome é o mesmo em todos os tamanhos de A.02.0809.002.",
    );
    expect(campo(PRODUTO).getAttribute("aria-invalid")).toBe("true");
    expect(campo(PRODUTO).getAttribute("aria-describedby")).toBe("opening-product-problema");
    expect(campo(TAMANHO).getAttribute("aria-invalid")).toBeNull();

    await digitar(PRODUTO, "Polo Feminino Piquet Arpoador");
    expect(lancar().disabled).toBe(false);
    expect(document.getElementById("opening-product-problema")).toBeNull();
    expect(campo(PRODUTO).getAttribute("aria-invalid")).toBeNull();
  });

  it("o Tamanho que contradiz o código desliga o lançamento, com a mensagem embaixo do Tamanho", async () => {
    await produtoNovoCompleto();
    await digitar(TAMANHO, "G");
    expect(lancar().disabled).toBe(true);
    await esperar(() => Boolean(document.getElementById("opening-size-problema")), "a mensagem do Tamanho");
    expect(document.getElementById("opening-size-problema")!.textContent).toBe("O código A.02.0809.002.GG é do tamanho GG, e o Tamanho informado é G.");
    expect(campo(TAMANHO).getAttribute("aria-describedby")).toBe("opening-size-problema");
    expect(document.getElementById("opening-product-problema")).toBeNull();

    await digitar(TAMANHO, "GG");
    expect(lancar().disabled).toBe(false);
  });

  it("o produto novo vai com o nome da família, o tamanho do código e as fotos do irmão", async () => {
    await produtoNovoCompleto();
    await act(async () => lancar().click());
    await esperar(() => estado.linhas.length === 1, "o lançamento");
    expect(estado.linhas[0]).toMatchObject({
      product_registration: "new",
      client_item_code: "A.02.0809.002.GG",
      product_name: "Polo Feminino Piquet Arpoador",
      size: "GG",
      category: "Polo",
      genero: "Feminino",
      grupo: "VESTUÁRIO",
      brand: "Arpoador",
      color: "Azul",
      counted_qty: 24,
      photo_urls: [estado.FOTO],
      photo_storage_paths: ["produtos/BTG/A.02.0809.002.P/frente.jpg"],
    });
    expect(estado.linhas[0]!.sku_code).toBeUndefined();
  });
});

describe("a família no cadastro", () => {
  const produto = (codigo: string, nome: string, extra: Partial<ProductLookupItem> = {}): ProductLookupItem => ({
    id: codigo,
    skuCode: "",
    clientCode: codigo,
    productName: nome,
    barcode: "",
    brand: "",
    size: "",
    color: "",
    photoUrl: "",
    unitCost: 0,
    hasSku: true,
    source: {},
    ...extra,
  });

  it("o nome mais comum entre os irmãos, no padrão; no empate, o do primeiro tamanho", () => {
    const familia = familiaNoCadastro("A.01.0806.005.XG", [
      produto("A.01.0806.005.G", "POLO MASCULINO PIQUET PRETO G"),
      produto("A.01.0806.005.M", "Polo masculino piquet preto - M"),
      produto("A.01.0806.005.P", "Polo Masc Piquet Preto P"),
      produto("A.01.0900.001.XG", "Outra família"),
    ]);
    expect(familia).toMatchObject({ familia: "A.01.0806.005", tamanho: "XG", tamanhos: ["P", "M", "G"], nome: "Polo Masculino Piquet Preto" });
    expect(familia!.irmao.clientCode).toBe("A.01.0806.005.P");

    const empate = familiaNoCadastro("A.01.0806.005.XG", [
      produto("A.01.0806.005.G", "Polo Grande"),
      produto("A.01.0806.005.M", "Polo Médio"),
    ]);
    expect(empate?.nome).toBe("Polo Médio");
  });

  it("sem tamanho no fim do código ou sem irmão, não há família", () => {
    const catalogo = [produto("A.01.0806.005.G", "Polo")];
    expect(familiaNoCadastro("A.01.0806.005", catalogo)).toBeNull();
    expect(familiaNoCadastro("BTG-000131", catalogo)).toBeNull();
    expect(familiaNoCadastro("A.01.0806.006.G", catalogo)).toBeNull();
    expect(familiaNoCadastro("a.01.0806.005.gg", catalogo)?.familia).toBe("A.01.0806.005");
  });

  it("gênero e grupo só entram quando são opções do cadastro", () => {
    const familia = familiaNoCadastro("A.01.0806.005.XG", [
      produto("A.01.0806.005.G", "Polo", { source: { genero: "MASC", grupo: "Roupas", categoria: "Polo" } }),
    ]);
    expect(familia).toMatchObject({ genero: "", grupo: "", categoria: "Polo" });
  });
});
