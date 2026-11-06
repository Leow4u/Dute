import { JSDOM } from "jsdom";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { typeOptions } from "@/lib/portal-stock";
import { groupFamilies } from "@/lib/stock-variants";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosDaTela, textosForaDaLista } from "@/test/textos";

import {
  ActiveFilterChips,
  CartPanel,
  FamilyCard,
  MarketplaceToolbar,
  ProductDetailPanel,
  StockFilterGroups,
  StockList,
  activeCatalogFilters,
  groupInventoryProducts,
  problemaDoPrazoDoPedido,
  problemaDoTamanhoDoPedido,
} from "./estoque";
import type { DataDeEntrada } from "./datas-de-entrada";
import type { InventoryItem } from "./shared";

function renderCart(outboundBlocked: boolean, cartKey = "") {
  const noop = () => undefined;
  return renderToStaticMarkup(
    <CartPanel
      cartKey={cartKey}
      seed={0}
      lines={[]}
      isSubmitting={false}
      isSavingEvent={false}
      outboundBlocked={outboundBlocked}
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
}

describe("pedido do portal durante a abertura", () => {
  it("mostra a faixa uma vez, sem repetir o aviso embaixo do botão", () => {
    const html = renderCart(true);
    expect(html.match(/Inventário inicial em andamento/g)).toHaveLength(1);
    expect(html).toContain("O envio espera o fim da contagem.");
    expect(html).not.toContain("A abertura do estoque ainda não terminou.");
  });

  it("sem a trava, não mostra a faixa", () => {
    expect(renderCart(false)).not.toContain("Inventário inicial em andamento");
  });
});

describe("a quantidade no carrinho", () => {
  // No teste de ponta a ponta de 01/11/2026, 100 aparecia como "10C": o campo
  // tinha 44px e as setas do campo numérico do navegador comiam o terceiro
  // dígito. As setas sobram (o − e o + estão ao lado) e o campo cabe 4 dígitos.
  it("o campo mostra 100 inteiro: sem as setas do navegador e com largura para quatro dígitos", () => {
    const [toalha] = groupInventoryProducts([estoque[2]!]);
    const html = renderToStaticMarkup(
      <CartPanel
        cartKey=""
        seed={0}
        lines={[{ product: toalha!, quantity: 100 }]}
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
    const campo = new JSDOM(html).window.document.querySelector<HTMLInputElement>(
      'input[aria-label="Quantidade de Toalha de academia"]',
    );
    expect(campo?.getAttribute("value")).toBe("100");
    const classes = campo?.className.split(/\s+/) ?? [];
    expect(classes).toContain("[appearance:textfield]");
    expect(classes).toContain("[&::-webkit-inner-spin-button]:appearance-none");
    expect(classes).toContain("[&::-webkit-outer-spin-button]:appearance-none");
    expect(classes).toContain("w-14");
  });
});

describe("pedido do portal neste aparelho", () => {
  it("sem saber de quem é o pedido, não diz que está salvo", () => {
    expect(renderCart(false)).not.toContain("Salvo neste aparelho");
  });

  it("antes de gravar no storage, não diz que está salvo", () => {
    expect(renderCart(false, "dute.portal.pedido.BTG Pactual.uid-ana")).not.toContain("Salvo neste aparelho");
  });
});


// Como a projeção do portal chega: nome é a descrição, categoria é o tipo.
const estoque: InventoryItem[] = [
  {
    sku_code: "BTG-000101",
    client_item_code: "A.01.0805.002.PP",
    product_name: "Polo feminina piquet azul marinho PP",
    category: "Polo",
    qty_on_hand: 12,
    qty_available: 12,
    primary_photo_url: "https://fotos.exemplo/polo-feminina.jpg",
  },
  {
    sku_code: "BTG-000102",
    client_item_code: "A.01.0809.002.PP",
    product_name: "Polo masculino piquet arpoador PP",
    category: "Polo",
    qty_on_hand: 18,
    qty_available: 18,
  },
  {
    sku_code: "BTG-000103",
    client_item_code: "C.0659.001.U",
    product_name: "Toalha de academia",
    category: "Toalha",
    qty_on_hand: 672,
    qty_available: 672,
    primary_photo_url: "https://fotos.exemplo/toalha.jpg",
  },
];

const noop = () => undefined;

function renderCard(item: InventoryItem) {
  const products = groupInventoryProducts([item]);
  const [family] = groupFamilies(
    products,
    (product) => product.clientItemCode ?? product.clientCode,
    (product) => product.key,
  );
  return renderToStaticMarkup(
    <FamilyCard
      family={family!}
      cart={{}}
      draftQuantities={{}}
      onDraftQuantityChange={noop}
      onAdd={noop}
      onDetails={noop}
      onReplenish={noop}
      onArchive={noop}
    />,
  );
}

describe("gênero no estoque do portal", () => {
  it("o cartão com foto leva FEM sobre a foto, em cor, e diz Feminino ao leitor de tela", () => {
    const html = renderCard(estoque[0]!);
    expect(html.match(/>FEM</g)).toHaveLength(1);
    expect(html).toContain("bg-gender-fem-soft");
    expect(html).toContain('<span class="sr-only">Feminino</span>');
    // Sobre a foto: antes da linha do tipo, que abre o corpo do cartão.
    expect(html.indexOf(">FEM<")).toBeLessThan(html.indexOf("Polo · A.01.0805.002"));
  });

  it("sem foto, o chip vai na linha do tipo", () => {
    const html = renderCard(estoque[1]!);
    expect(html.match(/>MASC</g)).toHaveLength(1);
    expect(html).toContain("bg-gender-masc-soft");
    expect(html.indexOf(">MASC<")).toBeGreaterThan(html.indexOf("Polo · A.01.0809.002"));
  });

  it("produto sem gênero no nome não leva chip", () => {
    expect(renderCard(estoque[2]!)).not.toContain("bg-gender-");
  });

  it("a lista leva o mesmo chip ao lado do nome", () => {
    const html = renderToStaticMarkup(
      <StockList
        products={groupInventoryProducts(estoque)}
        cart={{}}
        draftQuantities={{}}
        onDraftQuantityChange={noop}
        onAdd={noop}
        onDetails={noop}
        onReplenish={noop}
        onArchive={noop}
      />,
    );
    expect(html.match(/>FEM</g)).toHaveLength(1);
    expect(html.match(/>MASC</g)).toHaveLength(1);
    expect(html.match(/bg-gender-/g)).toHaveLength(2);
  });
});

describe("em recebimento no estoque do portal (parte 7d)", () => {
  // Do mockup PortalEstoqueRecebimento: a polo chegando, ainda sem guarda, e a calça na prateleira.
  const polo: InventoryItem = {
    sku_code: "BTG-000201",
    client_item_code: "A.01.0806.005.GG",
    product_name: "Camisa polo manga longa GG",
    category: "Polo",
    qty_on_hand: 24,
    qty_available: 0,
    qty_receiving: 24,
  };
  const calca: InventoryItem = {
    sku_code: "BTG-000202",
    client_item_code: "B.02.0110.001.42",
    product_name: "Calça social 42",
    category: "Calça",
    qty_on_hand: 76,
    qty_available: 64,
    qty_receiving: 0,
    qty_reserved: 12,
  };
  // Com prateleira e peça chegando: 64 livres, 6 chegando, 12 reservados.
  const misto: InventoryItem = { ...calca, qty_on_hand: 82, qty_receiving: 6 };
  const lista = (items: InventoryItem[]) =>
    renderToStaticMarkup(
      <StockList
        products={groupInventoryProducts(items)}
        cart={{}}
        draftQuantities={{}}
        onDraftQuantityChange={noop}
        onAdd={noop}
        onDetails={noop}
        onReplenish={noop}
        onArchive={noop}
      />,
    );
  /** Cada linha da lista: o produto e os números sob Disponível, Em recebimento e Reservado. */
  const linhas = (html: string) => {
    const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
    const resultado = [...dom.window.document.querySelectorAll("tbody tr")].map((linha) => {
      const celulas = [...linha.querySelectorAll("td")].map((celula) => celula.textContent?.trim() ?? "");
      return { codigo: celulas[0], disponivel: celulas[2], recebimento: celulas[3], reservado: celulas[4], pedido: celulas[5] };
    });
    dom.window.close();
    return resultado;
  };
  const card = (items: InventoryItem[]) => {
    const [family] = groupFamilies(
      groupInventoryProducts(items),
      (product) => product.clientItemCode ?? product.clientCode,
      (product) => product.key,
    );
    return renderToStaticMarkup(
      <FamilyCard
        family={family!}
        cart={{}}
        draftQuantities={{}}
        onDraftQuantityChange={noop}
        onAdd={noop}
        onDetails={noop}
        onReplenish={noop}
        onArchive={noop}
      />,
    );
  };
  const detalhe = (item: InventoryItem, datasDeEntrada?: DataDeEntrada[]) =>
    renderToStaticMarkup(
      <ProductDetailPanel
        product={groupInventoryProducts([item])[0]!}
        cart={{}}
        draftQuantity={0}
        isPending={false}
        onClose={noop}
        onDraftQuantityChange={noop}
        onAdd={noop}
        onReplenish={noop}
        onArchive={noop}
        datasDeEntrada={datasDeEntrada}
      />,
    );
  /** O valor de um fato do detalhe, pelo rótulo dele. */
  const fato = (html: string, rotulo: string) => html.match(new RegExp(`>${rotulo}</p><p[^>]*>([^<]*)</p>`))?.[1];
  const DICA_DE_REPOSICAO = "Avise a Dutelog sobre a reposição";

  it("o produto soma o em recebimento da projeção; a projeção ainda sem o campo conta zero", () => {
    const [p, c] = groupInventoryProducts([polo, calca]).sort((left, right) => left.sku.localeCompare(right.sku));
    expect([p!.available, p!.receiving, p!.total]).toEqual([0, 24, 24]);
    expect([c!.available, c!.receiving, c!.reserved]).toEqual([64, 0, 12]);
    expect(groupInventoryProducts([estoque[1]!])[0]!.receiving).toBe(0);
  });

  it("a lista: a coluna fica entre o disponível e o reservado, cada número sob o seu cabeçalho, e o disponível não conta o que chega", () => {
    const html = lista([polo, misto]);
    const cabecalho = [...html.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((match) => match[1]);
    expect(cabecalho).toEqual(["Código", "Produto", "Disponível", "Em recebimento", "Reservado", "Pedido"]);
    const porCodigo = Object.fromEntries(linhas(html).map((linha) => [linha.codigo, linha]));
    expect(porCodigo["A.01.0806.005.GG"]).toMatchObject({ disponivel: "0", recebimento: "24", reservado: "0" });
    expect(porCodigo["B.02.0110.001.42"]).toMatchObject({ disponivel: "64", recebimento: "6", reservado: "12" });
    // Só o produto chegando leva o número em destaque e o selo; os botões dele continuam.
    expect(html.match(/bg-info-soft px-2/g)).toHaveLength(2);
    expect(html.match(/>Em recebimento<\/span>/g)).toHaveLength(1);
    expect(porCodigo["A.01.0806.005.GG"]!.pedido).toBe("Avisar reposiçãoArquivar");
    expect(porCodigo["B.02.0110.001.42"]!.pedido).toBe("Adicionar");
    expect(html).not.toContain("Sem saldo");
  });

  it("a lista mostra só rótulos, dados e ações e passa no axe", async () => {
    const html = lista([polo, calca]);
    expect(textosDaTela(html)).toEqual([
      "Código", "Produto", "Disponível", "Em recebimento", "Reservado", "Pedido",
      "B.02.0110.001.42", "Calça social · 42", "Calça", "64", "0", "12", "Adicionar",
      "A.01.0806.005.GG", "Camisa polo manga longa · GG", "Polo", "24", "Avisar reposição", "Arquivar",
    ]);
    // Uma linha por tamanho: o nome com o tamanho também no contador.
    expect(html).toContain('title="Calça social · 42"');
    expect(html).toContain('aria-label="Quantidade de Calça social · 42"');
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("o card do produto só chegando: o selo, a linha do em recebimento e os botões de hoje; textos e axe", async () => {
    const html = card([polo]);
    expect(textosDaTela(html)).toEqual([
      "Em recebimento", "Polo · A.01.0806.005", "Camisa polo manga longa · GG", "Sem saldo no momento", "24", "em recebimento", "Avisar reposição", "Arquivar",
    ]);
    expect(html).toContain('text-info-soft-foreground">24</span> em recebimento');
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("o card com prateleira e peça chegando: o disponível é só o da prateleira, sem o selo", () => {
    expect(textosDaTela(card([misto]))).toEqual(["Calça · B.02.0110.001", "Calça social · 42", "64", "disponíveis", "6", "em recebimento", "Adicionar"]);
    expect(textosDaTela(card([calca]))).not.toContain("em recebimento");
  });

  it("o card agrupado: sem tamanho com saldo, abre no tamanho chegando; o tamanho chegando não diz esgotado", () => {
    const pp: InventoryItem = { ...polo, sku_code: "BTG-000200", client_item_code: "A.01.0806.005.PP", product_name: "Camisa polo manga longa PP", qty_on_hand: 0, qty_receiving: 0 };
    expect(textosDaTela(card([pp, polo]))).toEqual([
      "Em recebimento", "Polo · A.01.0806.005", "Camisa polo manga longa", "PP", "esgotado", "GG", "em recebimento",
      "Sem saldo no momento", "24", "em recebimento neste tamanho", "Avisar reposição", "Arquivar",
    ]);
    // Com um tamanho com saldo, o card abre nele, sem o selo; o tamanho chegando continua dizendo que está em recebimento.
    const m: InventoryItem = { ...polo, sku_code: "BTG-000199", client_item_code: "A.01.0806.005.M", product_name: "Camisa polo manga longa M", qty_on_hand: 10, qty_available: 10, qty_receiving: 0 };
    expect(textosDaTela(card([m, polo]))).toEqual([
      "Polo · A.01.0806.005", "Camisa polo manga longa", "M", "10 disp.", "GG", "em recebimento", "10", "disponíveis neste tamanho", "Adicionar",
    ]);
  });

  it("o detalhe do produto só chegando: o em recebimento com o valor, nada para pedir e o aviso sem reposição; textos e axe", async () => {
    const html = detalhe(polo);
    expect([fato(html, "Disponível para pedido"), fato(html, "Em recebimento"), fato(html, "Total físico")]).toEqual(["0", "24", "24"]);
    expect(html).toContain("Há peças deste produto em recebimento na Dutelog: entram no disponível para pedido depois da guarda.");
    expect(html).not.toContain(DICA_DE_REPOSICAO);
    expect(textosDaTela(html)).toEqual([
      "Detalhe do produto", "PO", "Polo", "A.01.0806.005.GG", "Camisa polo manga longa · GG", "Em recebimento",
      "Disponível para pedido", "0", "No pedido", "24", "Total físico",
      "Há peças deste produto em recebimento na Dutelog: entram no disponível para pedido depois da guarda.",
      "Avisar reposição", "Arquivar",
    ]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("o detalhe com prateleira e peça chegando: o disponível só da prateleira, o em recebimento à parte e, com saldo, sem aviso", () => {
    const html = detalhe(misto);
    expect([fato(html, "Disponível para pedido"), fato(html, "Em recebimento"), fato(html, "Reservado"), fato(html, "Total físico")]).toEqual(["64", "6", "12", "82"]);
    expect(html).not.toContain(">Em recebimento</span>");
    expect(html).not.toContain("Saldo disponível. Escolha a quantidade");
    // Sem nada chegando e sem saldo, o aviso de reposição volta.
    expect(detalhe({ ...polo, qty_on_hand: 0, qty_receiving: 0 })).toContain(DICA_DE_REPOSICAO);
    expect(fato(detalhe(calca), "Em recebimento")).toBeUndefined();
  });

  it("o detalhe com as datas de entrada (FIFO por data, parte 5): uma linha por dia, depois dos números e antes do rodapé; textos e axe", async () => {
    const html = detalhe(calca, [
      { desde: "2026-10-22", pecas: 16 },
      { desde: "2026-10-30", pecas: 30 },
      { desde: "2026-11-03", pecas: 60 },
    ]);
    const textos = textosDaTela(html);
    const inicio = textos.indexOf("Por data de entrada");
    expect(textos.slice(inicio, inicio + 7)).toEqual([
      "Por data de entrada", "desde 22/10/2026", "16 peças", "desde 30/10/2026", "30 peças", "desde 03/11/2026", "60 peças",
    ]);
    expect(inicio).toBeGreaterThan(textos.indexOf("Reservado"));
    expect(inicio).toBeLessThan(textos.indexOf("Adicionar ao pedido"));
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
    // Sem datas (carregando, sem prateleira ou com erro), a seção não aparece.
    expect(detalhe(calca, [])).not.toContain("Por data de entrada");
  });
});

describe("o detalhe do produto que rola (docs/mockups/PortalDetalhe*.dc.html, 04/11/2026)", () => {
  const toalha = groupInventoryProducts([estoque[2]!])[0]!;
  const camisa: InventoryItem = {
    sku_code: "BTG-000401",
    client_item_code: "A.01.0806.005.GG",
    product_name: "Camisa polo manga longa GG",
    category: "Polo",
    qty_on_hand: 0,
    qty_available: 0,
    qty_receiving: 0,
  };
  const detalhe = (props: Partial<ComponentProps<typeof ProductDetailPanel>> = {}) =>
    renderToStaticMarkup(
      <ProductDetailPanel
        product={toalha}
        cart={{}}
        draftQuantity={1}
        isPending={false}
        onClose={noop}
        onDraftQuantityChange={noop}
        onAdd={noop}
        onReplenish={noop}
        onArchive={noop}
        {...props}
      />,
    );
  const montar = (html: string) => new JSDOM(`<!doctype html><body>${html}</body>`).window.document;
  /** O valor de um número do detalhe, pelo rótulo dele. */
  const valor = (html: string, rotulo: string) => html.match(new RegExp(`>${rotulo}</p><p[^>]*>([^<]*)</p>`))?.[1];
  const classes = (elemento: Element | null | undefined) => elemento?.className.split(/\s+/) ?? [];

  it("o cabeçalho numa linha (título e fechar), o corpo que rola e a ação no rodapé, fora do corpo", () => {
    const raiz = montar(detalhe()).body.firstElementChild!;
    expect(classes(raiz)).toEqual(expect.arrayContaining(["flex", "min-h-0", "flex-1", "flex-col"]));
    const [cabecalho, corpo, rodape] = [...raiz.children];
    expect(raiz.children).toHaveLength(3);
    expect(cabecalho!.textContent).toBe("Detalhe do produto");
    expect(cabecalho!.querySelector('button[aria-label="Fechar detalhe"]')).not.toBeNull();
    expect(raiz.querySelector(".lucide-eye")).toBeNull();
    expect(classes(corpo)).toEqual(expect.arrayContaining(["min-h-0", "flex-1", "overflow-y-auto"]));
    expect(corpo!.textContent).not.toContain("Adicionar ao pedido");
    expect([...rodape!.querySelectorAll("button")].map((botao) => botao.textContent)).toContain("Adicionar ao pedido");
    // Sem saldo, "Avisar reposição" e "Arquivar" também ficam no rodapé.
    const semSaldo = montar(detalhe({ product: groupInventoryProducts([camisa])[0]! })).body.firstElementChild!;
    expect([...semSaldo.children[2]!.querySelectorAll("button")].map((botao) => botao.textContent)).toEqual(["Avisar reposição", "Arquivar"]);
    expect(semSaldo.children[1]!.textContent).not.toContain("Avisar reposição");
  });

  it("a foto inteira num quadro mais baixo e sem selo por cima; sem foto, o quadro menor com a sigla e o tipo", () => {
    const foto = montar(detalhe()).querySelector("img")!;
    expect(classes(foto)).toContain("object-contain");
    expect(classes(foto)).not.toContain("object-cover");
    expect(classes(foto.parentElement)).toContain("h-[200px]");
    const quadro = montar(detalhe({ product: groupInventoryProducts([camisa])[0]! })).querySelector('[data-testid="detalhe-foto"]');
    expect(classes(quadro)).toContain("h-[132px]");
    expect(quadro?.textContent).toBe("POPolo");
  });

  it("com o contador em 1, como o cliente vê: disponível e no pedido, sem sobra nem quantidade selecionada, e sem aviso com saldo; textos e axe", async () => {
    const html = detalhe({ cart: { [toalha.key]: 10 } });
    expect([valor(html, "Disponível para pedido"), valor(html, "No pedido")]).toEqual(["662", "10"]);
    expect(textosDaTela(html)).toEqual([
      "Detalhe do produto", "C.0659.001.U", "Toalha de academia", "Toalha",
      "Disponível para pedido", "662", "No pedido", "10", "Total físico", "672",
      "Adicionar ao pedido",
    ]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("os avisos ficam só nos casos que informam, no tom e com o ícone da situação, e nenhum com o ícone da IA", () => {
    const casos: Array<[string, string, string, string]> = [
      [detalhe({ product: groupInventoryProducts([{ ...camisa, qty_on_hand: 24, qty_receiving: 24 }])[0]! }), "bg-info-soft", "lucide-package-open", "Há peças deste produto em recebimento na Dutelog"],
      [detalhe({ product: groupInventoryProducts([camisa])[0]! }), "bg-destructive-soft", "lucide-triangle-alert", "Produto sem saldo disponível."],
      [detalhe({ cart: { [toalha.key]: 672 } }), "bg-success-soft", "lucide-shopping-cart", "Todo o saldo disponível já está no seu pedido."],
      [detalhe({ product: groupInventoryProducts([{ ...estoque[2]!, estoque_minimo: 700 } as InventoryItem])[0]! }), "bg-warning-soft", "lucide-trending-down", "Estoque baixo."],
    ];
    for (const [html, tom, icone, texto] of casos) {
      const aviso = montar(html).querySelector('[data-testid="detalhe-aviso"]');
      expect(aviso?.textContent).toContain(texto);
      expect(classes(aviso)).toContain(tom);
      expect(aviso?.querySelector(`svg.${icone}`)).not.toBeNull();
      expect(html).not.toContain("lucide-sparkles");
    }
    expect(montar(detalhe()).querySelector('[data-testid="detalhe-aviso"]')).toBeNull();
  });

  it("o selo da situação aparece uma vez, na linha do tipo, e não mais sobre a foto", () => {
    const html = detalhe({ product: groupInventoryProducts([{ ...camisa, qty_on_hand: 24, qty_receiving: 24 }])[0]! });
    expect(html.match(/Em recebimento<\/span>/g)).toHaveLength(1);
  });

  it("o selo Baixo estoque leva o ícone de queda, não o da IA", () => {
    const html = renderCard({ ...estoque[2]!, estoque_minimo: 700 } as InventoryItem);
    expect(html).toContain("Baixo estoque");
    expect(html).toContain("lucide-trending-down");
    expect(html).not.toContain("lucide-sparkles");
  });

  it("os tamanhos no detalhe: os botões do card, o escolhido marcado e a foto da família no tamanho sem foto; textos e axe", async () => {
    const pp: InventoryItem = {
      sku_code: "BTG-000301",
      client_item_code: "A.01.0805.002.PP",
      product_name: "Polo masculino piquet azul marinho PP",
      category: "Polo",
      qty_on_hand: 12,
      qty_available: 12,
      primary_photo_url: "https://fotos.exemplo/polo-azul-marinho.jpg",
    };
    const m: InventoryItem = { ...pp, sku_code: "BTG-000302", client_item_code: "A.01.0805.002.M", product_name: "Polo masculino piquet azul marinho M", qty_on_hand: 267, qty_available: 267, primary_photo_url: undefined };
    const produtos = groupInventoryProducts([pp, m]);
    const [familia] = groupFamilies(produtos, (produto) => produto.clientItemCode ?? produto.clientCode, (produto) => produto.key);
    const medio = produtos.find((produto) => produto.sku === "BTG-000302")!;
    const html = detalhe({ product: medio, family: familia });
    const documento = montar(html);
    const grupo = documento.querySelector('[role="group"]')!;
    expect(documento.getElementById(grupo.getAttribute("aria-labelledby")!)?.textContent).toBe("Tamanho");
    expect([...grupo.querySelectorAll("button")].map((botao) => [botao.textContent, botao.getAttribute("aria-pressed")])).toEqual([
      ["PP12 disp.", "false"],
      ["M267 disp.", "true"],
    ]);
    const foto = documento.querySelector("img")!;
    // A foto pode ser a de outro tamanho: leva o nome da família, sem o tamanho.
    expect([foto.getAttribute("src"), foto.getAttribute("alt")]).toEqual(["https://fotos.exemplo/polo-azul-marinho.jpg", "Polo masculino piquet azul marinho"]);
    // Com os botões, o nome da família no cabeçalho; o tamanho escolhido está nos botões e no contador.
    expect(documento.querySelector("h2")?.textContent).toBe("Polo masculino piquet azul marinho");
    expect(documento.querySelector('[data-testid="detalhe-rodape"] input')?.getAttribute("aria-label")).toBe("Quantidade de Polo masculino piquet azul marinho · M");
    expect(textosDaTela(html)).toEqual([
      "Detalhe do produto", "A.01.0805.002.M", "Polo masculino piquet azul marinho", "Polo", "MASC", "Masculino",
      "Tamanho", "PP", "12 disp.", "M", "267 disp.",
      "Disponível para pedido", "267", "No pedido", "0",
      "Adicionar ao pedido",
    ]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
    // Sem a família, ou com um tamanho só, o detalhe não mostra os botões e o cabeçalho diz o tamanho.
    expect(detalhe({ product: medio })).not.toContain('role="group"');
    expect(montar(detalhe({ product: medio })).querySelector("h2")?.textContent).toBe("Polo masculino piquet azul marinho · M");
  });

  it("depois de adicionar, o painel segue aberto com a confirmação e o Ver pedido; textos e axe", async () => {
    const html = detalhe({ cart: { [toalha.key]: 10 }, adicionado: 10, onOpenCart: noop });
    const rodape = montar(html).querySelector('[data-testid="detalhe-rodape"]')!;
    expect(rodape.querySelector('[role="status"]')?.textContent).toBe("10 peças adicionadas ao pedido");
    expect([...rodape.querySelectorAll("button")].map((botao) => botao.textContent)).toContain("Ver pedido");
    expect(montar(detalhe({ adicionado: 1, onOpenCart: noop })).querySelector('[role="status"]')?.textContent).toBe("1 peça adicionada ao pedido");
    // Antes de adicionar, o status existe e fica vazio: o leitor de tela anuncia quando ele muda.
    expect(montar(detalhe()).querySelector('[data-testid="detalhe-rodape"] [role="status"]')?.textContent).toBe("");
    expect(textosForaDaLista(html, [
      "Detalhe do produto", "C.0659.001.U", "Toalha de academia", "Toalha",
      "Disponível para pedido", "662", "No pedido", "10", "Total físico", "672",
      "10 peças adicionadas ao pedido", "Ver pedido", "Adicionar ao pedido",
    ])).toEqual([]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });
});

const categorias = typeOptions(groupInventoryProducts(estoque));
const contagens = { todos: 3, disponiveis: 3, baixo: 0, zerado: 0, arquivados: 0 };

function renderToolbar(props: Partial<ComponentProps<typeof MarketplaceToolbar>> = {}) {
  return renderToStaticMarkup(
    <MarketplaceToolbar
      searchTerm=""
      stockFilter="todos"
      categoryFilters={[]}
      categories={categorias}
      sortMode="maior-saldo"
      viewMode="cards"
      groupVariants
      onGroupVariantsChange={noop}
      resultCount={3}
      filterCounts={contagens}
      activeFilterCount={0}
      hasActiveFilters={false}
      onSearchChange={noop}
      onStockFilterChange={noop}
      onCategoryFiltersChange={noop}
      onSortModeChange={noop}
      onViewModeChange={noop}
      onClearFilters={noop}
      {...props}
    />,
  );
}

/** Os controles que sobram abaixo de md: fora de tudo o que tem a classe `hidden`. */
function controlesNoCelular(html: string) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
  const controles = [...dom.window.document.querySelectorAll("input, select, button")]
    .filter((elemento) => !elemento.closest(".hidden"))
    .map((elemento) => elemento.getAttribute("aria-label") ?? elemento.textContent?.trim() ?? "");
  dom.window.close();
  return controles;
}

describe("barra e resultados do estoque", () => {
  it("no celular, os controles da barra são a busca e o botão de filtros", () => {
    expect(controlesNoCelular(renderToolbar())).toEqual(["Buscar por nome ou código", "Filtros"]);
  });

  it("a busca tem texto de 16px no celular, para o Safari não aproximar a tela", () => {
    const dom = new JSDOM(renderToolbar());
    const busca = dom.window.document.querySelector("input")!;
    expect(busca.classList.contains("text-base")).toBe(true);
    expect(busca.classList.contains("text-sm")).toBe(false);
    expect(busca.classList.contains("md:text-sm")).toBe(true);
    dom.window.close();
  });

  it("o botão conta filtros de saldo e tipo, sem contar a ordenação", () => {
    const html = renderToolbar({ stockFilter: "disponiveis", categoryFilters: ["polo"], sortMode: "nome", activeFilterCount: 2, hasActiveFilters: true });
    expect(controlesNoCelular(html)).toEqual(["Buscar por nome ou código", "Filtros, 2 ativos"]);
  });

  it("oferece saldo, resultado, ordenação e exibição; o pedido fica no cabeçalho da página", () => {
    const dom = new JSDOM(renderToolbar());
    const documento = dom.window.document;
    const saldo = documento.querySelector<HTMLSelectElement>('select[aria-label="Filtrar por saldo"]')!;
    expect(saldo).not.toBeNull();
    expect([...saldo.options].map((option) => option.value)).toEqual(["todos", "disponiveis", "baixo", "zerado"]);
    expect(saldo.disabled).toBe(false);
    expect(documento.querySelector('[aria-label="Formato de visualização"]')).not.toBeNull();
    expect(documento.querySelector('[role="switch"]')).not.toBeNull();
    expect(documento.querySelector('[aria-label="Ordenar produtos"]')).not.toBeNull();
    expect(documento.querySelector('[role="status"]')?.textContent).toBe("3 itens encontrados");
    expect(documento.querySelector('[aria-label^="Abrir pedido"]')).toBeNull();
    dom.window.close();
  });

  it("em arquivados, desativa saldo e indica que todos os saldos estão incluídos", () => {
    const dom = new JSDOM(renderToolbar({ stockFilter: "arquivados", activeFilterCount: 1, hasActiveFilters: true }));
    const saldo = dom.window.document.querySelector<HTMLSelectElement>('select[aria-label="Filtrar por saldo"]')!;
    expect(saldo.disabled).toBe(true);
    expect(saldo.selectedOptions[0]?.textContent).toContain("Todos os saldos");
    dom.window.close();
  });

  it("a barra passa no axe", async () => {
    expect(await violacoesDeAcessibilidade(renderToolbar())).toEqual([]);
  });
});

describe("painel de filtros do estoque no celular", () => {
  function renderGrupos(viewMode: "cards" | "lista" = "cards") {
    return renderToStaticMarkup(
      <StockFilterGroups
        stockFilter="disponiveis"
        filterCounts={contagens}
        categoryFilters={["polo"]}
        categories={categorias}
        sortMode="maior-saldo"
        viewMode={viewMode}
        groupVariants
        onStockFilterChange={noop}
        onCategoryFiltersChange={noop}
        onSortModeChange={noop}
        onViewModeChange={noop}
        onGroupVariantsChange={noop}
      />,
    );
  }

  it("leva saldo, tipos, cadastro, ordem e exibição em grupos nomeados", () => {
    const dom = new JSDOM(renderGrupos());
    for (const grupo of ["Saldo", "Ordenar", "Exibição"]) {
      expect(dom.window.document.querySelector(`[role="group"][aria-label="${grupo}"]`), grupo).not.toBeNull();
    }
    expect([...dom.window.document.querySelectorAll("fieldset legend")].map((legend) => legend.textContent)).toEqual(["Tipo de produto", "Cadastro"]);
    expect(dom.window.document.querySelector('[aria-label="Formato de visualização"]')).not.toBeNull();
    expect(dom.window.document.body.textContent).toContain("Agrupar tamanhos");
    dom.window.close();
  });

  it("na lista, sem cards, não oferece agrupar tamanhos", () => {
    expect(renderGrupos("lista")).not.toContain("Agrupar tamanhos");
  });

  it("permite mais de um tipo com checkboxes rotulados e busca", () => {
    const dom = new JSDOM(renderGrupos());
    const documento = dom.window.document;
    expect(documento.querySelector('input[aria-label="Buscar tipo de produto"]')).not.toBeNull();
    expect(documento.querySelectorAll('[role="checkbox"]')).toHaveLength(3);
    for (const label of ["Todos os tipos", "Polo", "Toalha"]) {
      expect([...documento.querySelectorAll("label")].some((elemento) => elemento.textContent === label)).toBe(true);
    }
    dom.window.close();
  });

  it("os grupos passam no axe", async () => {
    expect(await violacoesDeAcessibilidade(renderGrupos())).toEqual([]);
  });
});

describe("filtros ativos do estoque", () => {
  it("conta saldo e cada tipo selecionado, sem preferência de ordenação", () => {
    expect(
      activeCatalogFilters({ stockFilter: "baixo", categoryFilters: ["polo", "toalha"], categories: categorias }),
    ).toEqual([
      { key: "situacao", label: "Abaixo do mínimo" },
      { key: "tipo:polo", label: "Polo" },
      { key: "tipo:toalha", label: "Toalha" },
    ]);
  });

  it("arquivados é um filtro de cadastro, sem saldo contraditório", () => {
    expect(activeCatalogFilters({ stockFilter: "arquivados", categoryFilters: [], categories: categorias })).toEqual([
      { key: "cadastro", label: "Arquivados" },
    ]);
  });

  it("no padrão, não há nada ativo nem etiqueta", () => {
    const ativos = activeCatalogFilters({ stockFilter: "todos", categoryFilters: [], categories: categorias });
    expect(ativos).toEqual([]);
    expect(renderToStaticMarkup(<ActiveFilterChips filters={ativos} onRemove={noop} />)).toBe("");
  });

  it("cada etiqueta tem uma ação nomeada para tirar o próprio filtro e passa no axe", async () => {
    const html = renderToStaticMarkup(
      <ActiveFilterChips
        filters={[
          { key: "situacao", label: "Com saldo" },
          { key: "tipo:polo", label: "Polo" },
          { key: "tipo:toalha", label: "Toalha" },
        ]}
        onRemove={noop}
      />,
    );
    for (const filtro of ["Com saldo", "Polo", "Toalha"]) {
      expect(html).toContain(`aria-label="Tirar o filtro ${filtro}"`);
    }
    expect(textosForaDaLista(html, ["Com saldo", "Polo", "Toalha"])).toEqual([]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });
});

describe("o tamanho do pedido", () => {
  it("até 100 itens de separação vai; acima, o carrinho avisa antes de enviar", () => {
    expect(problemaDoTamanhoDoPedido(100)).toBeNull();
    expect(problemaDoTamanhoDoPedido(130)).toBe("Um pedido leva até 100 itens de separação; este tem 130. Divida em mais de um pedido.");
  });
});

describe("o prazo do pedido", () => {
  const agora = new Date("2026-10-25T13:00:00-03:00");
  it("sem prazo vale; de agora em diante vale; no passado, o carrinho avisa", () => {
    expect(problemaDoPrazoDoPedido("", agora)).toBeNull();
    expect(problemaDoPrazoDoPedido("2026-10-26T13:00", agora)).toBeNull();
    expect(problemaDoPrazoDoPedido("2026-10-27T09:30", agora)).toBeNull();
    expect(problemaDoPrazoDoPedido("2026-10-24T18:00", agora)).toBe("O prazo já passou. Escolha quando o pedido precisa chegar, de agora em diante.");
  });
});
