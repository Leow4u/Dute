import { describe, expect, it } from "vitest";

import { edicao } from "@/test/eventos-necton";
import { EDICOES, EVENTOS, FEIRA_2026, HOJE, PRECOS, RASCUNHO } from "@/test/eventos-lista";

import { cartoesDaLista, contagemDosFiltros, filtrarCartoes } from "./lista";
import {
  ROTA_EVENTOS,
  ROTA_NOVO_EVENTO,
  eventoDaBusca,
  hrefDaEdicao,
  hrefDoEstoqueDoEvento,
  hrefDoNovoDoEvento,
  idDaEdicaoNaBusca,
} from "./navegacao";

/**
 * A lista do portal (docs/mockups/EventosPortalLista.dc.html): um cartão por
 * evento com a edição da vez, as anteriores, os filtros e a navegação.
 * Dados sintéticos (src/test/eventos-lista.ts).
 */

const cartao = (nome: string, cartoes = cartoesDaLista(EVENTOS, EDICOES, PRECOS, HOJE)) => cartoes.find((item) => item.evento.name === nome)!;

describe("os cartões da lista", () => {
  it("cartoesDaLista: a aberta é a atual, as anteriores por label, 'Nova edição a partir de 2026' só sem edição aberta; abrir fora do rascunho, continuar e excluirRascunho só nele", () => {
    const cartoes = cartoesDaLista(EVENTOS, EDICOES, PRECOS, HOJE);
    expect(cartoes.map((item) => item.evento.name)).toEqual([
      "B2B Conference Necton",
      "Encontro de Parceiros",
      "Workshop de líderes",
      "Lançamento do Fundo",
      "Convenção de vendas",
      "Feira de Investimentos",
    ]);
    const necton = cartao("B2B Conference Necton", cartoes);
    expect(necton).toMatchObject({
      selo: "Enviado à Dutelog",
      quando: { texto: "28 e 29/01/2027", rotulo: "Próxima edição" },
      local: "Hotel Unique · Av. Brigadeiro Luís Antônio, 4700",
      cronograma: "Montagem 28/01 10:00 · Evento 29/01 08:00 às 20:00 · Desmontagem 29/01 20:00",
      itens: "100 itens do estoque · 2.000 peças · coleta no cliente: 2.190 produtos",
      fechamento: null,
      etapa: 1,
      esta: true,
      acoes: { abrir: true, continuar: false, excluirRascunho: false, novaEdicaoAPartirDe: null },
    });
    expect(necton.anteriores).toEqual([]);

    const rascunho = cartao("Encontro de Parceiros", cartoes);
    expect(rascunho).toMatchObject({ selo: "Rascunho", etapa: 0, acoes: { abrir: false, continuar: true, excluirRascunho: true, novaEdicaoAPartirDe: null } });

    const workshop = cartao("Workshop de líderes", cartoes);
    expect(workshop).toMatchObject({
      selo: "No evento",
      quando: { texto: "24 e 25/11/2026", rotulo: "Em andamento" },
      cronograma: "Montagem feita 24/11 09:40 · Evento começou 25/11 08:00 · Desmontagem 25/11 18:00",
      itens: "9 itens do estoque · 22 peças",
      etapa: 4,
    });

    const feira = cartao("Feira de Investimentos", cartoes);
    expect(feira.atual.id).toBe(FEIRA_2026.id);
    expect(feira.anteriores.map((item) => item.label)).toEqual(["2025"]);
    expect(feira).toMatchObject({
      selo: "Fechado",
      quando: { texto: "14 a 16/05/2026", rotulo: "Última edição" },
      cronograma: null,
      itens: "18 itens do estoque · 64 peças · voltaram 63",
      fechamento: "Preço fechado R$ 12.400,00 · 31 fotos",
      etapa: null,
      esta: false,
      acoes: { abrir: true, continuar: false, excluirRascunho: false, novaEdicaoAPartirDe: "2026" },
    });
    expect(cartao("Convenção de vendas", cartoes).anteriores.map((item) => item.label)).toEqual(["2024", "2025"]);
  });

  it("a última edição cancelada: selo 'Cancelado', etapa null e a nova edição oferecida", () => {
    expect(cartao("Lançamento do Fundo")).toMatchObject({
      selo: "Cancelado",
      quando: { texto: "12/12/2026", rotulo: null },
      etapa: null,
      cronograma: null,
      esta: false,
      acoes: { abrir: true, continuar: false, excluirRascunho: false, novaEdicaoAPartirDe: "2026" },
    });
  });

  it("duas edições abertas do mesmo evento: a atual é a mudada por último, e a outra fica nas anteriores, sem a nova edição", () => {
    const nova = edicao({ ...RASCUNHO, id: "ced_00000000000000a2", label: "2028", updated_at: "2026-11-27T09:00:00.000Z" });
    const [encontro] = cartoesDaLista([EVENTOS[1]], [RASCUNHO, nova], [], HOJE);
    expect(encontro.atual.id).toBe(nova.id);
    expect(encontro.anteriores.map((item) => item.id)).toEqual([RASCUNHO.id]);
    expect(encontro.acoes.novaEdicaoAPartirDe).toBeNull();
  });

  it("filtros: Próximos 2, Em andamento 1, Fechados 3, Todos 6; a busca acha pelo local", () => {
    const cartoes = cartoesDaLista(EVENTOS, EDICOES, PRECOS, HOJE);
    expect(contagemDosFiltros(cartoes)).toEqual({ proximos: 2, em_andamento: 1, fechados: 3, todos: 6 });
    expect(filtrarCartoes(cartoes, "em_andamento", "").map((item) => item.evento.name)).toEqual(["Workshop de líderes"]);
    expect(filtrarCartoes(cartoes, "todos", "unique").map((item) => item.evento.name)).toEqual(["B2B Conference Necton"]);
    expect(filtrarCartoes(cartoes, "todos", "Nações").map((item) => item.evento.name)).toEqual(["Workshop de líderes"]);
    expect(filtrarCartoes(cartoes, "proximos", "feira")).toEqual([]);
    expect(filtrarCartoes(cartoes, "fechados", "feira").map((item) => item.evento.name)).toEqual(["Feira de Investimentos"]);
    expect(filtrarCartoes(cartoes, "todos", "LIDERES").map((item) => item.evento.name)).toEqual(["Workshop de líderes"]);
  });
});

describe("a navegação", () => {
  it("navegação: hrefDaEdicao('ced_1') e idDaEdicaoNaBusca('?id=ced_1') se desfazem; eventoDaBusca lê ?evento=", () => {
    expect(ROTA_EVENTOS).toBe("/portal/eventos");
    expect(ROTA_NOVO_EVENTO).toBe("/portal/eventos/novo");
    expect(hrefDaEdicao("ced_1")).toBe("/portal/eventos/edicao?id=ced_1");
    expect(idDaEdicaoNaBusca("?id=ced_1")).toBe("ced_1");
    expect(idDaEdicaoNaBusca(new URL(`https://x${hrefDaEdicao("ced_0123456789abcdef")}`).search)).toBe("ced_0123456789abcdef");
    expect(idDaEdicaoNaBusca("")).toBeNull();
    expect(idDaEdicaoNaBusca("?id=")).toBeNull();
    expect(eventoDaBusca("?evento=cve_1")).toBe("cve_1");
    expect(eventoDaBusca("evento=cve_2")).toBe("cve_2");
    expect(eventoDaBusca("?x=1")).toBeNull();
    expect(hrefDoEstoqueDoEvento("ced_1")).toBe("/portal/estoque?evento=ced_1");
    expect(hrefDoNovoDoEvento("cve_1")).toBe("/portal/eventos/novo?evento=cve_1");
  });
});
