import { describe, expect, it } from "vitest";

import { edicao, edicaoDaNecton, feito, momento } from "@/test/eventos-necton";

import { cartoesDaLista, contagemDosFiltros, filtrarCartoes } from "./lista";
import type { EventoView, PrecoDaEdicao } from "./leitura";
import {
  ROTA_EVENTOS,
  ROTA_NOVO_EVENTO,
  eventoDaBusca,
  hrefDaEdicao,
  hrefDoEstoqueDoEvento,
  hrefDoNovoDoEvento,
  idDaEdicaoNaBusca,
} from "./navegacao";
import type { EdicaoView } from "./tipos";

/**
 * A lista do portal (docs/mockups/EventosPortalLista.dc.html): um cartão por
 * evento com a edição da vez, as anteriores, os filtros e a navegação.
 * Dados sintéticos.
 */

const HOJE = "2026-11-27";

function evento(id: string, name: string, extra: Partial<EventoView> = {}): EventoView {
  return { id, customer_code: "BTG", name, description: null, status: "active", editions_count: 1, last_edition_id: null, last_edition_label: null, ...extra };
}

function itens(quantos: number, pecas: number, voltaram: number | null = null) {
  return Array.from({ length: quantos }, (_, indice) => {
    const quantity = indice === 0 ? pecas - (quantos - 1) : 1;
    return {
      sku_code: `BTG-${String(indice + 1).padStart(6, "0")}`,
      client_item_code: null,
      product_name: `Item ${indice + 1}`,
      size: null,
      category: null,
      quantity,
      foi: voltaram === null ? null : quantity,
      voltou: voltaram === null ? null : indice === 0 ? quantity - (pecas - voltaram) : quantity,
      avariadas: null,
      nao_voltaram: null,
      observacao: null,
    };
  });
}

const NECTON = edicaoDaNecton({ status: "enviado", edicao: 5, updated_at: "2026-11-27T17:40:00.000Z" });

const RASCUNHO = edicao({
  id: "ced_00000000000000a1",
  event_id: "cve_00000000000000a1",
  event_name: "Encontro de Parceiros",
  label: "2027",
  status: "rascunho",
  onde: { local: "Casa Tua", endereco: null, contato: { nome: null, telefone: null } },
  cronograma: [momento("evento", { data: "2027-03-10", hora: "19:00" })],
  updated_at: "2026-11-26T10:00:00.000Z",
});

const WORKSHOP = edicao({
  id: "ced_00000000000000b1",
  event_id: "cve_00000000000000b1",
  event_name: "Workshop de líderes",
  label: "2026",
  status: "no_evento",
  onde: { local: "Grand Hyatt", endereco: "Av. das Nações Unidas, 13301", contato: { nome: null, telefone: null } },
  cronograma: [
    momento("montagem", { data: "2026-11-24", hora: "08:00" }, { feito: feito("2026-11-24T11:00:00.000Z", "2026-11-24T12:40:00.000Z") }),
    momento("evento", { data: "2026-11-25", hora: "08:00" }, { feito: feito("2026-11-25T11:00:00.000Z") }),
    momento("desmontagem", { data: "2026-11-25", hora: "18:00" }),
  ],
  itens: itens(9, 22),
  updated_at: "2026-11-25T11:00:00.000Z",
});

const FEIRA_2025 = edicao({
  id: "ced_00000000000000c0",
  event_id: "cve_00000000000000c1",
  event_name: "Feira de Investimentos",
  label: "2025",
  status: "fechado",
  onde: { local: "Expo Center Norte", endereco: "Rua José Bernardo Pinto, 333", contato: { nome: null, telefone: null } },
  cronograma: [momento("evento", { data: "2025-05-15" })],
  updated_at: "2025-06-01T10:00:00.000Z",
});

const FEIRA_2026 = edicao({
  ...FEIRA_2025,
  id: "ced_00000000000000c1",
  label: "2026",
  cronograma: [momento("entrega_no_local", { data: "2026-05-14", hora: "07:00" }), momento("evento", { data: "2026-05-15" }), momento("desmontagem", { data: "2026-05-16" })],
  itens: itens(18, 64, 63),
  updated_at: "2026-06-02T10:00:00.000Z",
});

const CONVENCAO = [2024, 2025, 2026].map((ano) =>
  edicao({
    id: `ced_00000000000${ano}d`,
    event_id: "cve_00000000000000d1",
    event_name: "Convenção de vendas",
    label: String(ano),
    status: "fechado",
    onde: { local: "Espaço Unimed", endereco: "Rua Tagipuru, 795", contato: { nome: null, telefone: null } },
    cronograma: [momento("evento", { data: `${ano}-09-03` })],
    itens: itens(12, 31, 31),
    updated_at: `${ano}-09-10T10:00:00.000Z`,
  }),
);

const CANCELADA = edicao({
  id: "ced_00000000000000e1",
  event_id: "cve_00000000000000e1",
  event_name: "Lançamento do Fundo",
  label: "2026",
  status: "cancelado",
  onde: { local: "Hotel Fasano", endereco: null, contato: { nome: null, telefone: null } },
  cronograma: [momento("evento", { data: "2026-12-12" })],
  updated_at: "2026-11-20T10:00:00.000Z",
});

const EVENTOS: EventoView[] = [
  evento("cve_0123456789abcdef", "B2B Conference Necton", { last_edition_id: NECTON.id, last_edition_label: "2027" }),
  evento("cve_00000000000000a1", "Encontro de Parceiros", { last_edition_id: RASCUNHO.id }),
  evento("cve_00000000000000b1", "Workshop de líderes", { last_edition_id: WORKSHOP.id }),
  evento("cve_00000000000000c1", "Feira de Investimentos", { editions_count: 2, last_edition_id: FEIRA_2026.id, last_edition_label: "2026" }),
  evento("cve_00000000000000d1", "Convenção de vendas", { editions_count: 3, last_edition_id: CONVENCAO[2].id }),
  evento("cve_00000000000000e1", "Lançamento do Fundo", { last_edition_id: CANCELADA.id }),
  // A capa sem edição (o rascunho excluído) não vira cartão.
  evento("cve_00000000000000f1", "Sem edição"),
];

const EDICOES: EdicaoView[] = [NECTON, RASCUNHO, WORKSHOP, FEIRA_2025, FEIRA_2026, ...CONVENCAO, CANCELADA];

const PRECOS: PrecoDaEdicao[] = [{ id: FEIRA_2026.id, valor_declarado_cents: null, fechado_cents: 1_240_000 }];

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
      fechamento: "Preço fechado R$ 12.400,00",
      etapa: null,
      esta: false,
      acoes: { abrir: true, continuar: false, excluirRascunho: false, novaEdicaoAPartirDe: "2026" },
    });
    expect(cartao("Convenção de vendas", cartoes).anteriores.map((item) => item.label)).toEqual(["2024", "2025"]);
  });

  it("a última edição cancelada: selo 'Cancelado', etapa null e a nova edição oferecida", () => {
    expect(cartao("Lançamento do Fundo")).toMatchObject({
      selo: "Cancelado",
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
