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
  const detalhe = (item: InventoryItem) =>
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
      "B.02.0110.001.42", "Calça social 42", "Calça", "64", "0", "12", "Adicionar",
      "A.01.0806.005.GG", "Camisa polo manga longa GG", "Polo", "24", "Avisar reposição", "Arquivar",
    ]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("o card do produto só chegando: o selo, a linha do em recebimento e os botões de hoje; textos e axe", async () => {
    const html = card([polo]);
    expect(textosDaTela(html)).toEqual([
      "Em recebimento", "Polo · A.01.0806.005", "Camisa polo manga longa GG", "Sem saldo no momento", "24", "em recebimento", "Avisar reposição", "Arquivar",
    ]);
    expect(html).toContain('text-info-soft-foreground">24</span> em recebimento');
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("o card com prateleira e peça chegando: o disponível é só o da prateleira, sem o selo", () => {
    expect(textosDaTela(card([misto]))).toEqual(["Calça · B.02.0110.001", "Calça social 42", "64", "disponíveis", "6", "em recebimento", "Adicionar"]);
    expect(textosDaTela(card([calca]))).not.toContain("em recebimento");
  });

  it("o card agrupado: sem tamanho com saldo, abre no tamanho chegando; o tamanho chegando não diz esgotado", () => {
    const pp: InventoryItem = { ...polo, sku_code: "BTG-000200", client_item_code: "A.01.0806.005.PP", product_name: "Camisa polo manga longa PP", qty_on_hand: 0, qty_receiving: 0 };
    expect(textosDaTela(card([pp, polo]))).toEqual([
      "Em recebimento", "Polo · A.01.0806.005", "Camisa polo manga longa GG", "PP", "esgotado", "GG", "em recebimento",
      "Sem saldo no momento", "24", "em recebimento neste tamanho", "Avisar reposição", "Arquivar",
    ]);
    // Com um tamanho com saldo, o card abre nele, sem o selo; o tamanho chegando continua dizendo que está em recebimento.
    const m: InventoryItem = { ...polo, sku_code: "BTG-000199", client_item_code: "A.01.0806.005.M", product_name: "Camisa polo manga longa M", qty_on_hand: 10, qty_available: 10, qty_receiving: 0 };
    expect(textosDaTela(card([m, polo]))).toEqual([
      "Polo · A.01.0806.005", "Camisa polo manga longa M", "M", "10 disp.", "GG", "em recebimento", "10", "disponíveis neste tamanho", "Adicionar",
    ]);
  });

  it("o detalhe do produto só chegando: o em recebimento com o valor, nada para pedir e a dica sem reposição; textos e axe", async () => {
    const html = detalhe(polo);
    expect([fato(html, "Disponível para pedido"), fato(html, "Em recebimento"), fato(html, "Total físico")]).toEqual(["0", "24", "24"]);
    expect(html).toContain("Há peças deste produto em recebimento na Dutelog: entram no disponível para pedido depois da guarda.");
    expect(html).not.toContain(DICA_DE_REPOSICAO);
    expect(textosDaTela(html)).toEqual([
      "Detalhe do produto", "PO", "Polo", "Em recebimento", "A.01.0806.005.GG", "Camisa polo manga longa GG",
      "Disponível para pedido", "0", "No pedido", "24", "Total físico",
      "Há peças deste produto em recebimento na Dutelog: entram no disponível para pedido depois da guarda.",
      "Avisar reposição", "Arquivar",
    ]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });

  it("o detalhe com prateleira e peça chegando: o disponível só da prateleira, o em recebimento à parte e a dica de saldo", () => {
    const html = detalhe(misto);
    expect([fato(html, "Disponível para pedido"), fato(html, "Em recebimento"), fato(html, "Reservado"), fato(html, "Total físico")]).toEqual(["64", "6", "12", "82"]);
    expect(html).not.toContain(">Em recebimento</span>");
    expect(html).toContain("Saldo disponível. Escolha a quantidade e clique em Adicionar para incluir no pedido.");
    // Sem nada chegando e sem saldo, a dica de hoje volta.
    expect(detalhe({ ...polo, qty_on_hand: 0, qty_receiving: 0 })).toContain(DICA_DE_REPOSICAO);
    expect(fato(detalhe(calca), "Em recebimento")).toBeUndefined();
  });
});

const categorias = typeOptions(groupInventoryProducts(estoque));
const contagens = { todos: 3, disponiveis: 3, baixo: 0, zerado: 0, arquivados: 0 };

function renderToolbar(props: Partial<ComponentProps<typeof MarketplaceToolbar>> = {}) {
  return renderToStaticMarkup(
    <MarketplaceToolbar
      searchTerm=""
      stockFilter="todos"
      categoryFilter="todos"
      categories={categorias}
      sortMode="relevancia"
      viewMode="cards"
      groupVariants
      onGroupVariantsChange={noop}
      cartQuantity={0}
      cartOpen={false}
      filterCounts={contagens}
      activeFilterCount={0}
      hasActiveFilters={false}
      onSearchChange={noop}
      onStockFilterChange={noop}
      onCategoryFilterChange={noop}
      onSortModeChange={noop}
      onViewModeChange={noop}
      onClearFilters={noop}
      onCartToggle={noop}
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

const textosDaBarra = [
  "Cards",
  "Lista",
  "Agrupar tamanhos",
  "Pedido",
  "0",
  "Situação",
  /^(Todos|Com saldo|Abaixo do mínimo|Sem saldo) · \d+$/,
  "Arquivados",
  /^Todos os tipos \(\d+\)$/,
  /^(Polo|Toalha) \(\d+\)$/,
  "Mais relevantes",
  "Maior saldo",
  "Menor saldo",
  "Nome: A-Z",
];

describe("barra do estoque no celular", () => {
  it("presa no topo, fica só a busca e o botão de filtros", () => {
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

  it("o botão diz quantos filtros estão ativos", () => {
    const html = renderToolbar({ stockFilter: "disponiveis", sortMode: "nome", activeFilterCount: 2, hasActiveFilters: true });
    expect(html).toContain('aria-label="Filtros, 2 ativos"');
    expect(controlesNoCelular(html)).toEqual(["Buscar por nome ou código", "Filtros, 2 ativos"]);
  });

  it("no desktop a barra continua com formato, tamanhos, pedido, situação, tipo e ordem", () => {
    const html = renderToolbar();
    expect(html).toContain('aria-label="Formato de visualização"');
    expect(html).toContain('role="switch"');
    expect(html).toContain("Pedido");
    expect(html).toContain('aria-label="Filtrar por tipo"');
    expect(html).toContain('aria-label="Ordenar produtos"');
    expect(html).toContain("Com saldo · 3");
  });

  it("mostra só rótulos, dados e ações e passa no axe", async () => {
    const html = renderToolbar();
    expect(textosForaDaLista(html, textosDaBarra)).toEqual([]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });
});

describe("painel de filtros do estoque no celular", () => {
  function renderGrupos(viewMode: "cards" | "lista" = "cards") {
    return renderToStaticMarkup(
      <StockFilterGroups
        stockFilter="disponiveis"
        filterCounts={contagens}
        categoryFilter="polo"
        categories={categorias}
        sortMode="relevancia"
        viewMode={viewMode}
        groupVariants
        onStockFilterChange={noop}
        onCategoryFilterChange={noop}
        onSortModeChange={noop}
        onViewModeChange={noop}
        onGroupVariantsChange={noop}
      />,
    );
  }

  it("leva situação, tipo, ordem e exibição", () => {
    const html = renderGrupos();
    for (const grupo of ["Situação", "Tipo", "Ordenar", "Exibição"]) {
      expect(html).toContain(`role="group" aria-label="${grupo}"`);
    }
    expect(html).toContain('aria-label="Formato de visualização"');
    expect(html).toContain("Agrupar tamanhos");
  });

  it("na lista, sem cards, não oferece agrupar tamanhos", () => {
    expect(renderGrupos("lista")).not.toContain("Agrupar tamanhos");
  });

  it("o tipo é um seletor de 16px, para o Safari não aproximar a tela", () => {
    const dom = new JSDOM(renderGrupos());
    const tipo = dom.window.document.querySelector('select[aria-label="Filtrar por tipo"]')!;
    expect(tipo.classList.contains("text-base")).toBe(true);
    dom.window.close();
  });

  it("mostra só rótulos, dados e ações e passa no axe", async () => {
    const html = renderGrupos();
    expect(
      textosForaDaLista(html, [...textosDaBarra, "Tipo", "Ordenar", "Exibição"]),
    ).toEqual([]);
    expect(await violacoesDeAcessibilidade(html)).toEqual([]);
  });
});

describe("filtros ativos do estoque", () => {
  it("contam situação, tipo e ordem fora do padrão, na ordem do painel", () => {
    expect(
      activeCatalogFilters({ stockFilter: "baixo", categoryFilter: "polo", categories: categorias, sortMode: "maior-saldo" }),
    ).toEqual([
      { key: "situacao", label: "Abaixo do mínimo" },
      { key: "tipo", label: "Polo" },
      { key: "ordem", label: "Maior saldo" },
    ]);
  });

  it("no padrão, não há nada ativo nem etiqueta", () => {
    const ativos = activeCatalogFilters({
      stockFilter: "todos",
      categoryFilter: "todos",
      categories: categorias,
      sortMode: "relevancia",
    });
    expect(ativos).toEqual([]);
    expect(renderToStaticMarkup(<ActiveFilterChips filters={ativos} onRemove={noop} />)).toBe("");
  });

  it("cada etiqueta tira o próprio filtro e passa no axe", async () => {
    const html = renderToStaticMarkup(
      <ActiveFilterChips
        filters={[
          { key: "situacao", label: "Com saldo" },
          { key: "tipo", label: "Polo" },
        ]}
        onRemove={noop}
      />,
    );
    expect(html).toContain('aria-label="Tirar o filtro Com saldo"');
    expect(html).toContain('aria-label="Tirar o filtro Polo"');
    expect(textosForaDaLista(html, ["Com saldo", "Polo"])).toEqual([]);
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
