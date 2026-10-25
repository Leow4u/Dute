import { JSDOM } from "jsdom";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { typeOptions } from "@/lib/portal-stock";
import { groupFamilies } from "@/lib/stock-variants";
import { violacoesDeAcessibilidade } from "@/test/acessibilidade";
import { textosForaDaLista } from "@/test/textos";

import {
  ActiveFilterChips,
  CartPanel,
  FamilyCard,
  MarketplaceToolbar,
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
