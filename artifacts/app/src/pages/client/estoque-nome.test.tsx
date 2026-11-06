// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JSDOM } from "jsdom";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

import { groupFamilies } from "@/lib/stock-variants";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela, textosForaDaLista } from "@/test/textos";

vi.mock("@/lib/auth", () => ({
  useAppUser: () => ({ user: { uid: "uid-ana", publicMetadata: { role: "cliente", customer_code: "BTG Pactual" } }, isLoaded: true }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => undefined }) }));

import { CartPanel, ClienteEstoque, FamilyCard, ProductDetailPanel, groupInventoryProducts } from "./estoque";
import type { InventoryItem } from "./shared";

/**
 * O padrão do nome no Estoque do portal (decisão do Leonardo de 06/11/2026,
 * docs/mockups/NomePortalEstoque, NomePortalDetalhe e NomePortalPedido): o
 * nome é o mesmo em todos os tamanhos da família, e o tamanho fica nos botões
 * ou depois do ponto. No print, o card trazia "Polo masculino piquet preto -
 * XG" no título ao escolher o XG. Os nomes gravados ainda têm o tamanho no
 * fim até a planilha do passo 3; a tela fica certa antes e depois. Dados
 * sintéticos.
 */

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const SKU: Record<string, string> = { PP: "BTG-000801", P: "BTG-000802", M: "BTG-000803", G: "BTG-000804", GG: "BTG-000805", XG: "BTG-000806" };

function polo(tamanho: string, disponivel: number, nome = `Polo masculino piquet preto - ${tamanho}`): InventoryItem {
  return {
    sku_code: SKU[tamanho],
    client_item_code: `A.01.0806.005.${tamanho}`,
    product_name: nome,
    category: "Polo",
    qty_on_hand: disponivel,
    qty_available: disponivel,
  };
}

const CALCA_42: InventoryItem = {
  sku_code: "BTG-000084",
  client_item_code: "A.01.0712.001.42",
  product_name: "Calça social masculino preta 42",
  category: "Calça",
  qty_on_hand: 30,
  qty_available: 30,
};

const TOALHA: InventoryItem = {
  sku_code: "BTG-000103",
  client_item_code: "C.0659.001.U",
  product_name: "Toalha de academia",
  category: "Toalha",
  qty_on_hand: 672,
  qty_available: 672,
};

const noop = () => undefined;

function familias(itens: InventoryItem[]) {
  return groupFamilies(
    groupInventoryProducts(itens),
    (produto) => produto.clientItemCode ?? produto.clientCode,
    (produto) => produto.key,
  );
}

function cartao(itens: InventoryItem[]) {
  const [familia] = familias(itens);
  return (
    <FamilyCard
      family={familia!}
      cart={{}}
      draftQuantities={{}}
      onDraftQuantityChange={noop}
      onAdd={noop}
      onDetails={noop}
      onReplenish={noop}
      onArchive={noop}
    />
  );
}

/** O botão do nome do card (o que abre o detalhe pelo texto). */
function tituloDoCard(card: ParentNode) {
  return card.querySelector("div.min-w-0 > button")?.textContent ?? null;
}

/** Os nomes que o contador dá ao leitor de tela: o −, o campo e o +. */
function rotulosDoContador(escopo: ParentNode) {
  const campo = escopo.querySelector('input[type="number"]');
  const grupo = campo?.parentElement;
  return [...(grupo?.querySelectorAll("button, input") ?? [])].map((elemento) => elemento.getAttribute("aria-label"));
}

let raiz: Root | null = null;
let container: HTMLDivElement | null = null;
let consultas: QueryClient | null = null;

async function montar(elemento: ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  raiz = createRoot(container);
  await act(async () => raiz!.render(elemento));
  return container;
}

async function clicar(elemento: Element) {
  await act(async () => (elemento as HTMLElement).click());
}

function botao(texto: string, escopo: ParentNode = document) {
  const encontrado = [...escopo.querySelectorAll("button")].find((item) => item.textContent?.trim() === texto);
  expect(encontrado, `botão ${texto}`).toBeDefined();
  return encontrado!;
}

/** O Estoque do portal inteiro com o catálogo `itens`, até o primeiro card aparecer. */
async function abrirOEstoque(itens: InventoryItem[]) {
  vi.stubGlobal("fetch", vi.fn(async (entrada: RequestInfo | URL) => {
    const url = new URL(String(entrada), window.location.origin);
    const corpo = url.pathname === "/api/client/overview"
      ? { customer: { code: "BTG Pactual", name: "BTG Pactual" }, inventory: { items: itens } }
      : {};
    return new Response(JSON.stringify(corpo), { status: 200, headers: { "content-type": "application/json" } });
  }));
  consultas = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await montar(
    <QueryClientProvider client={consultas}>
      <Router ssrPath="/portal/estoque"><ClienteEstoque /></Router>
    </QueryClientProvider>,
  );
  for (let tentativa = 0; tentativa < 100 && !document.querySelector('[data-testid="stock-card"]'); tentativa += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  expect(document.querySelector('[data-testid="stock-card"]'), "catálogo carregado").not.toBeNull();
}

beforeEach(() => window.localStorage.clear());

afterEach(async () => {
  await act(async () => raiz?.unmount());
  consultas?.clear();
  container?.remove();
  raiz = null;
  container = null;
  consultas = null;
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("o nome no card do Estoque do portal", () => {
  it("com os botões de tamanho, o nome é o da família, sem o tamanho, qualquer que seja o tamanho escolhido; o contador diz o tamanho", async () => {
    const tela = await montar(cartao([polo("XG", 60), polo("P", 71), polo("M", 198)].map((item) => ({ ...item, primary_photo_url: "https://fotos.exemplo/polo-preta.jpg" }))));
    const card = tela.querySelector('[data-testid="stock-card"]')!;
    const foto = card.querySelector('button[aria-label^="Ver detalhes de"]')!;
    for (const [tamanho, disponivel] of [["P", "71"], ["M", "198"], ["XG", "60"], ["P", "71"]] as const) {
      await clicar(botao(`${tamanho}${disponivel} disp.`, card));
      expect(tituloDoCard(card)).toBe("Polo masculino piquet preto");
      expect(foto.getAttribute("aria-label")).toBe("Ver detalhes de Polo masculino piquet preto");
      expect(rotulosDoContador(card)).toEqual([
        `Diminuir quantidade de Polo masculino piquet preto · ${tamanho}`,
        `Quantidade de Polo masculino piquet preto · ${tamanho}`,
        `Aumentar quantidade de Polo masculino piquet preto · ${tamanho}`,
      ]);
      expect(textosDaTela(card.outerHTML)).toEqual([
        "MASC", "Masculino", "Polo · A.01.0806.005", "Polo masculino piquet preto",
        "P", "71 disp.", "M", "198 disp.", "XG", "60 disp.",
        disponivel, "disponíveis neste tamanho", "Adicionar",
      ]);
    }
    expect(await violacoesDeAcessibilidade(card.outerHTML)).toEqual([]);
  });

  it("o nome vem do primeiro tamanho na ordem dos botões, não do que tem mais saldo nem do escolhido", async () => {
    // O XG tem mais saldo e vem antes na lista; os botões começam no P.
    const tela = await montar(cartao([polo("XG", 90, "POLO MASC PIQUET PRETO XG"), polo("P", 71, "Polo masculino piquet preto P")]));
    const card = tela.querySelector('[data-testid="stock-card"]')!;
    expect([...card.querySelectorAll('[role="group"] button')].map((item) => item.firstElementChild?.textContent)).toEqual(["P", "XG"]);
    expect(tituloDoCard(card)).toBe("Polo masculino piquet preto");
    await clicar(botao("XG90 disp.", card));
    expect(tituloDoCard(card)).toBe("Polo masculino piquet preto");
    expect(card.querySelector('input[type="number"]')?.getAttribute("aria-label")).toBe("Quantidade de Polo masc piquet preto · XG");
  });

  it("o card de um tamanho só leva o nome e o tamanho depois do ponto; o tamanho único fica só com o nome; textos e axe", async () => {
    const html = renderToStaticMarkup(cartao([{ ...polo("M", 198), primary_photo_url: "https://fotos.exemplo/polo-preta.jpg" }]));
    const documento = new JSDOM(`<!doctype html><body>${html}</body>`).window.document;
    expect(tituloDoCard(documento)).toBe("Polo masculino piquet preto · M");
    expect(documento.querySelector('button[aria-label^="Ver detalhes de"]')?.getAttribute("aria-label")).toBe("Ver detalhes de Polo masculino piquet preto · M");
    expect(documento.querySelector('[role="group"]')).toBeNull();
    expect(rotulosDoContador(documento)).toEqual([
      "Diminuir quantidade de Polo masculino piquet preto · M",
      "Quantidade de Polo masculino piquet preto · M",
      "Aumentar quantidade de Polo masculino piquet preto · M",
    ]);
    expect(textosDaTela(html)).toEqual(["MASC", "Masculino", "Polo · A.01.0806.005", "Polo masculino piquet preto · M", "198", "disponíveis", "Adicionar"]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);

    const toalha = new JSDOM(`<!doctype html><body>${renderToStaticMarkup(cartao([TOALHA]))}</body>`).window.document;
    expect(tituloDoCard(toalha)).toBe("Toalha de academia");
    expect(toalha.querySelector('input[type="number"]')?.getAttribute("aria-label")).toBe("Quantidade de Toalha de academia");
  });
});

describe("o nome nas linhas de Seu pedido", () => {
  const produtos = groupInventoryProducts([polo("GG", 94), polo("XG", 60), CALCA_42]);
  const produto = (sku: string) => produtos.find((item) => item.sku === sku)!;
  const html = renderToStaticMarkup(
    <CartPanel
      cartKey=""
      seed={0}
      lines={[
        { product: produto("BTG-000805"), quantity: 20 },
        { product: produto("BTG-000806"), quantity: 15 },
        { product: produto("BTG-000084"), quantity: 6 },
      ]}
      isSubmitting={false}
      isSavingEvent={false}
      outboundBlocked={false}
      expanded={false}
      onToggleExpanded={noop}
      onClose={noop}
      onSaveEvent={noop}
      onIncrement={noop}
      onDecrement={noop}
      onQuantityChange={noop}
      onRemove={noop}
      onSubmit={noop}
    />,
  );
  const linhas = () => [...new JSDOM(`<!doctype html><body>${html}</body>`).window.document.querySelectorAll("ul > li")];

  it("cada linha diz o nome e o tamanho depois do ponto, com o código e o disponível embaixo", () => {
    expect(linhas().map((linha) => [...linha.querySelectorAll("span.block")].map((parte) => parte.textContent))).toEqual([
      ["Polo masculino piquet preto · GG", "A.01.0806.005.GG · 74 disponíveis"],
      ["Polo masculino piquet preto · XG", "A.01.0806.005.XG · 45 disponíveis"],
      ["Calça social masculino preta · 42", "A.01.0712.001.42 · 24 disponíveis"],
    ]);
  });

  it("o contador e o remover dizem o tamanho ao leitor de tela; textos e axe", async () => {
    expect(linhas().map((linha) => [...linha.querySelectorAll("[aria-label]")].map((elemento) => elemento.getAttribute("aria-label")))).toEqual([
      [
        "Diminuir quantidade de Polo masculino piquet preto · GG",
        "Quantidade de Polo masculino piquet preto · GG",
        "Aumentar quantidade de Polo masculino piquet preto · GG",
        "Remover Polo masculino piquet preto · GG",
      ],
      [
        "Diminuir quantidade de Polo masculino piquet preto · XG",
        "Quantidade de Polo masculino piquet preto · XG",
        "Aumentar quantidade de Polo masculino piquet preto · XG",
        "Remover Polo masculino piquet preto · XG",
      ],
      [
        "Diminuir quantidade de Calça social masculino preta · 42",
        "Quantidade de Calça social masculino preta · 42",
        "Aumentar quantidade de Calça social masculino preta · 42",
        "Remover Calça social masculino preta · 42",
      ],
    ]);
    const lista = linhas().map((linha) => linha.outerHTML).join("");
    expect(textosForaDaLista(lista, [
      "Polo masculino piquet preto · GG", "A.01.0806.005.GG · 74 disponíveis",
      "Polo masculino piquet preto · XG", "A.01.0806.005.XG · 45 disponíveis",
      "Calça social masculino preta · 42", "A.01.0712.001.42 · 24 disponíveis",
    ])).toEqual([]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });
});

describe("a busca do Estoque pelo nome que a tela mostra", () => {
  // Depois da planilha do passo 3: o mesmo nome nos três tamanhos.
  const limpos = [polo("P", 71, "Polo Masculino Piquet Preto"), polo("M", 198, "Polo Masculino Piquet Preto"), polo("XG", 60, "Polo Masculino Piquet Preto"), TOALHA];

  async function buscar(texto: string) {
    const campo = document.querySelector<HTMLInputElement>('input[aria-label="Buscar por nome ou código"]')!;
    const definir = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      definir.call(campo, texto);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  const titulos = () => [...document.querySelectorAll('[data-testid="stock-card"]')].map(tituloDoCard);

  it("acha pelo nome e o tamanho, pelo nome da família, pelo código e pelo tipo", async () => {
    await abrirOEstoque(limpos);
    expect(titulos()).toEqual(["Toalha de academia", "Polo Masculino Piquet Preto"]);
    await buscar("piquet preto xg");
    expect(titulos()).toEqual(["Polo Masculino Piquet Preto · XG"]);
    await buscar("piquet preto");
    expect(titulos()).toEqual(["Polo Masculino Piquet Preto"]);
    await buscar("A.01.0806.005.M");
    expect(titulos()).toEqual(["Polo Masculino Piquet Preto · M"]);
    await buscar("toalha");
    expect(titulos()).toEqual(["Toalha de academia"]);
  });

  it("com os nomes de hoje, com o tamanho no fim, acha do mesmo jeito", async () => {
    await abrirOEstoque([polo("P", 71), polo("M", 198), polo("XG", 60)]);
    expect(titulos()).toEqual(["Polo masculino piquet preto"]);
    await buscar("piquet preto xg");
    expect(titulos()).toEqual(["Polo masculino piquet preto · XG"]);
  });
});

describe("a família que o portal junta sem ser de tamanhos", () => {
  // O agrupamento do portal junta qualquer fim de código de 1 a 4 letras ou
  // números (lib/stock-variants.ts); para o domínio, o trecho que não é
  // tamanho não faz família (familiaDoCodigo). Aí o nome do card, do detalhe
  // e do diálogo é o da variação escolhida, como antes do padrão.
  const CANECA_300: InventoryItem = {
    sku_code: "BTG-000901",
    client_item_code: "A.09.0001.002",
    product_name: "Caneca BTG 300 ml",
    category: "Caneca",
    qty_on_hand: 40,
    qty_available: 40,
    primary_photo_url: "https://fotos.exemplo/caneca-300.jpg",
  };
  const CANECA_500: InventoryItem = {
    ...CANECA_300,
    sku_code: "BTG-000902",
    client_item_code: "A.09.0001.003",
    product_name: "Caneca BTG 500 ml",
    qty_on_hand: 25,
    qty_available: 25,
    primary_photo_url: "https://fotos.exemplo/caneca-500.jpg",
  };
  const KIT_MASCULINO: InventoryItem = {
    sku_code: "BTG-000911",
    client_item_code: "A.07.0001.001",
    product_name: "Kit boas-vindas masculino",
    category: "Kit",
    qty_on_hand: 12,
    qty_available: 12,
  };
  const KIT_FEMININO: InventoryItem = {
    ...KIT_MASCULINO,
    sku_code: "BTG-000912",
    client_item_code: "A.07.0001.002",
    product_name: "Kit boas-vindas feminino",
    qty_on_hand: 9,
    qty_available: 9,
  };
  const SKU_DA_CAMISA: Record<string, string> = { G: "BTG-000921", G1: "BTG-000922", G2: "BTG-000923" };
  // G1 e G2 não são tamanhos para o domínio (tamanhoDoCodigo dá null).
  const camisa = (tamanho: string, disponivel: number): InventoryItem => ({
    sku_code: SKU_DA_CAMISA[tamanho],
    client_item_code: `A.01.0900.001.${tamanho}`,
    product_name: `Camisa social ${tamanho}`,
    category: "Camisa",
    qty_on_hand: disponivel,
    qty_available: disponivel,
  });

  const detalheDa = (itens: InventoryItem[], indice: number) => {
    const [familia] = familias(itens);
    return renderToStaticMarkup(
      <ProductDetailPanel
        product={familia!.variants[indice]!.item}
        family={familia}
        cart={{}}
        draftQuantity={1}
        isPending={false}
        onClose={noop}
        onDraftQuantityChange={noop}
        onAdd={noop}
        onReplenish={noop}
        onArchive={noop}
      />,
    );
  };
  const documentoDe = (html: string) => new JSDOM(`<!doctype html><body>${html}</body>`).window.document;
  const chips = (escopo: ParentNode) => [...escopo.querySelectorAll("span[title]")].map((chip) => chip.getAttribute("title"));

  function dialogo() {
    const painel = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(painel, "detalhe aberto").not.toBeNull();
    return painel!;
  }

  /** O nome que o leitor de tela ouve ao abrir o detalhe: o título do diálogo. */
  function nomeDoDialogo() {
    return document.getElementById(dialogo().getAttribute("aria-labelledby") ?? "")?.textContent ?? null;
  }

  it("as canecas 002 e 003 num card: o nome, o Ver detalhes de e o contador são os da escolhida; textos e axe", async () => {
    const tela = await montar(cartao([CANECA_300, CANECA_500]));
    const card = tela.querySelector('[data-testid="stock-card"]')!;
    const foto = card.querySelector('button[aria-label^="Ver detalhes de"]')!;
    expect([...card.querySelectorAll('[role="group"] button')].map((item) => item.textContent)).toEqual(["00240 disp.", "00325 disp."]);
    expect(tituloDoCard(card)).toBe("Caneca BTG 300 ml");
    for (const [variacao, disponivel, nome] of [["003", "25", "Caneca BTG 500 ml"], ["002", "40", "Caneca BTG 300 ml"]] as const) {
      await clicar(botao(`${variacao}${disponivel} disp.`, card));
      expect(tituloDoCard(card)).toBe(nome);
      expect(foto.getAttribute("aria-label")).toBe(`Ver detalhes de ${nome}`);
      expect(rotulosDoContador(card)).toEqual([
        `Diminuir quantidade de ${nome}`,
        `Quantidade de ${nome}`,
        `Aumentar quantidade de ${nome}`,
      ]);
      expect(textosDaTela(card.outerHTML)).toEqual([
        "Caneca · A.09.0001", nome, "002", "40 disp.", "003", "25 disp.", disponivel, "disponíveis neste tamanho", "Adicionar",
      ]);
      expect(await violacoesDeAcessibilidade(card.outerHTML)).toEqual([]);
    }
  });

  it("o chip de gênero é o da escolhida, como o nome", async () => {
    const tela = await montar(cartao([KIT_MASCULINO, KIT_FEMININO]));
    const card = tela.querySelector('[data-testid="stock-card"]')!;
    expect([tituloDoCard(card), chips(card)]).toEqual(["Kit boas-vindas masculino", ["Masculino"]]);
    await clicar(botao("0029 disp.", card));
    expect([tituloDoCard(card), chips(card)]).toEqual(["Kit boas-vindas feminino", ["Feminino"]]);
    expect(textosDaTela(card.outerHTML)).toEqual([
      "Kit · A.07.0001", "FEM", "Feminino", "Kit boas-vindas feminino", "001", "12 disp.", "002", "9 disp.", "9", "disponíveis neste tamanho", "Adicionar",
    ]);
  });

  it("tamanho que o domínio não conhece (G1, G2), sozinho ou junto de um que ele conhece: o nome é o do escolhido", async () => {
    const tela = await montar(cartao([camisa("G2", 5), camisa("G1", 8)]));
    const card = tela.querySelector('[data-testid="stock-card"]')!;
    expect([...card.querySelectorAll('[role="group"] button')].map((item) => item.firstElementChild?.textContent)).toEqual(["G1", "G2"]);
    expect(tituloDoCard(card)).toBe("Camisa social G1");
    await clicar(botao("G25 disp.", card));
    expect(tituloDoCard(card)).toBe("Camisa social G2");
    expect(card.querySelector('input[type="number"]')?.getAttribute("aria-label")).toBe("Quantidade de Camisa social G2");
    // Com o G, que o domínio conhece, a família continua com um fim que não é tamanho: cada um com o próprio nome.
    expect(tituloDoCard(documentoDe(renderToStaticMarkup(cartao([camisa("G", 10), camisa("G1", 8)]))))).toBe("Camisa social · G");
    expect(tituloDoCard(documentoDe(renderToStaticMarkup(cartao([camisa("G", 0), camisa("G1", 8)]))))).toBe("Camisa social G1");
  });

  it("no detalhe, embaixo do código, o nome e o chip da escolhida; textos e axe", async () => {
    const html = detalheDa([CANECA_300, CANECA_500], 1);
    const documento = documentoDe(html);
    const titulo = documento.querySelector("h2")!;
    expect([titulo.previousElementSibling?.textContent, titulo.textContent]).toEqual(["A.09.0001.003", "Caneca BTG 500 ml"]);
    expect(documento.querySelector('[data-testid="detalhe-rodape"] input')?.getAttribute("aria-label")).toBe("Quantidade de Caneca BTG 500 ml");
    expect(textosDaTela(html)).toEqual([
      "Detalhe do produto", "A.09.0001.003", "Caneca BTG 500 ml", "Caneca",
      "Tamanho", "002", "40 disp.", "003", "25 disp.",
      "Disponível para pedido", "25", "No pedido", "0",
      "Adicionar ao pedido",
    ]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);

    const kit = documentoDe(detalheDa([KIT_MASCULINO, KIT_FEMININO], 1));
    expect([kit.querySelector("h2")?.textContent, chips(kit)]).toEqual(["Kit boas-vindas feminino", ["Feminino"]]);
  });

  it("o nome do diálogo do detalhe é o da escolhida no card e nos botões do detalhe; a polo continua com o da família", async () => {
    await abrirOEstoque([CANECA_300, CANECA_500, polo("P", 71), polo("XG", 60)]);
    const card = (titulo: string) => {
      const encontrado = [...document.querySelectorAll('[data-testid="stock-card"]')].find((item) => tituloDoCard(item) === titulo);
      expect(encontrado, `card ${titulo}`).toBeDefined();
      return encontrado!;
    };
    const cardDaCaneca = card("Caneca BTG 300 ml");
    await clicar(botao("00325 disp.", cardDaCaneca));
    await clicar(botao("Caneca BTG 500 ml", cardDaCaneca));
    expect([nomeDoDialogo(), dialogo().querySelector("h2")?.textContent]).toEqual(["Caneca BTG 500 ml", "Caneca BTG 500 ml"]);
    await clicar(botao("00240 disp.", dialogo()));
    expect([nomeDoDialogo(), dialogo().querySelector("h2")?.textContent]).toEqual(["Caneca BTG 300 ml", "Caneca BTG 300 ml"]);
    await clicar(dialogo().querySelector('button[aria-label="Fechar detalhe"]')!);
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    const cardDaPolo = card("Polo masculino piquet preto");
    await clicar(botao("XG60 disp.", cardDaPolo));
    await clicar(botao("Polo masculino piquet preto", cardDaPolo));
    expect([nomeDoDialogo(), dialogo().querySelector("h2")?.textContent]).toEqual(["Polo masculino piquet preto", "Polo masculino piquet preto"]);
  });
});
