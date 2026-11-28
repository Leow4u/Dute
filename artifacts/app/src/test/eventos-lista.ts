import type { EventoView, PrecoDaEdicao } from "@/lib/eventos/leitura";
import type { EdicaoView, FotoView, ItemView } from "@/lib/eventos/tipos";

import { edicao, edicaoDaNecton, feito, momento } from "./eventos-necton";

/**
 * A lista do portal dos Eventos como dado dos testes
 * (docs/mockups/EventosPortalLista.dc.html): seis eventos com edição (dois
 * próximos, um em andamento e três fechados, um deles cancelado) e uma capa
 * sem edição. Dados sintéticos.
 */

export const HOJE = "2026-11-27";

export function evento(id: string, name: string, extra: Partial<EventoView> = {}): EventoView {
  return { id, customer_code: "BTG", name, description: null, status: "active", editions_count: 1, last_edition_id: null, last_edition_label: null, ...extra };
}

/** `quantos` itens com `pecas` peças; com `voltaram`, o registro do retorno. */
export function itensDeTeste(quantos: number, pecas: number, voltaram: number | null = null): ItemView[] {
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

function fotos(quantas: number): FotoView[] {
  return Array.from({ length: quantas }, (_, indice) => ({
    id: `ft_${String(indice).padStart(16, "0")}`,
    caminho: `eventos/BTG/ced/fotos/ft_${indice}.jpg`,
    momento_id: null,
    legenda: null,
    instante: null,
    registrado_por: null,
    registrado_em: null,
  }));
}

export const NECTON_ENVIADA = edicaoDaNecton({ status: "enviado", edicao: 5, updated_at: "2026-11-27T17:40:00.000Z" });

export const RASCUNHO = edicao({
  id: "ced_00000000000000a1",
  event_id: "cve_00000000000000a1",
  event_name: "Encontro de Parceiros",
  label: "2027",
  status: "rascunho",
  onde: { local: "Casa Tua", endereco: null, contato: { nome: null, telefone: null } },
  cronograma: [momento("evento", { data: "2027-03-10", hora: "19:00" })],
  updated_at: "2026-11-26T10:00:00.000Z",
});

export const WORKSHOP = edicao({
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
  itens: itensDeTeste(9, 22),
  updated_at: "2026-11-25T11:00:00.000Z",
});

export const FEIRA_2025 = edicao({
  id: "ced_00000000000000c0",
  event_id: "cve_00000000000000c1",
  event_name: "Feira de Investimentos",
  label: "2025",
  status: "fechado",
  onde: { local: "Expo Center Norte", endereco: "Rua José Bernardo Pinto, 333", contato: { nome: null, telefone: null } },
  cronograma: [momento("evento", { data: "2025-05-15" })],
  updated_at: "2025-06-01T10:00:00.000Z",
});

export const FEIRA_2026 = edicao({
  ...FEIRA_2025,
  id: "ced_00000000000000c1",
  label: "2026",
  cronograma: [momento("entrega_no_local", { data: "2026-05-14", hora: "07:00" }), momento("evento", { data: "2026-05-15" }), momento("desmontagem", { data: "2026-05-16" })],
  itens: itensDeTeste(18, 64, 63),
  fotos: fotos(31),
  updated_at: "2026-06-02T10:00:00.000Z",
});

export const CONVENCAO = [2024, 2025, 2026].map((ano) =>
  edicao({
    id: `ced_00000000000${ano}d`,
    event_id: "cve_00000000000000d1",
    event_name: "Convenção de vendas",
    label: String(ano),
    status: "fechado",
    onde: { local: "Espaço Unimed", endereco: "Rua Tagipuru, 795", contato: { nome: null, telefone: null } },
    cronograma: [momento("evento", { data: `${ano}-09-03` })],
    itens: itensDeTeste(12, 31, 31),
    updated_at: `${ano}-09-10T10:00:00.000Z`,
  }),
);

export const CANCELADA = edicao({
  id: "ced_00000000000000e1",
  event_id: "cve_00000000000000e1",
  event_name: "Lançamento do Fundo",
  label: "2026",
  status: "cancelado",
  onde: { local: "Hotel Fasano", endereco: null, contato: { nome: null, telefone: null } },
  cronograma: [momento("evento", { data: "2026-12-12" })],
  updated_at: "2026-11-20T10:00:00.000Z",
});

export const EVENTOS: EventoView[] = [
  evento("cve_0123456789abcdef", "B2B Conference Necton", { last_edition_id: NECTON_ENVIADA.id, last_edition_label: "2027" }),
  evento("cve_00000000000000a1", "Encontro de Parceiros", { last_edition_id: RASCUNHO.id }),
  evento("cve_00000000000000b1", "Workshop de líderes", { last_edition_id: WORKSHOP.id }),
  evento("cve_00000000000000c1", "Feira de Investimentos", { editions_count: 2, last_edition_id: FEIRA_2026.id, last_edition_label: "2026" }),
  evento("cve_00000000000000d1", "Convenção de vendas", { editions_count: 3, last_edition_id: CONVENCAO[2].id }),
  evento("cve_00000000000000e1", "Lançamento do Fundo", { last_edition_id: CANCELADA.id }),
  // A capa sem edição (o rascunho excluído) não vira cartão.
  evento("cve_00000000000000f1", "Sem edição"),
];

export const EDICOES: EdicaoView[] = [NECTON_ENVIADA, RASCUNHO, WORKSHOP, FEIRA_2025, FEIRA_2026, ...CONVENCAO, CANCELADA];

export const PRECOS: PrecoDaEdicao[] = [{ id: FEIRA_2026.id, valor_declarado_cents: null, fechado_cents: 1_240_000 }];
