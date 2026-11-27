import { ROTULO_DO_STATUS, STATUS_DA_EDICAO, type StatusDaEdicao, type TipoDeMomento } from "@workspace/dominio";

/**
 * Os rótulos do portal dos Eventos (docs/mockups/EventosPortalLista.dc.html e
 * EventosPortalNovo.dc.html): o selo de cada status, as sete etapas, os nomes
 * curtos dos momentos na linha do cartão, os rótulos dos campos do
 * cronograma e os filtros da lista.
 */

/** O selo do cartão: o rótulo do status, com o enviado dizendo a quem. */
export const SELO_DO_STATUS: Record<StatusDaEdicao, string> = { ...ROTULO_DO_STATUS, enviado: "Enviado à Dutelog" };

/** As sete etapas do cartão, de rascunho a fechado; o cancelado sai do caminho. */
export const ETAPAS_DA_EDICAO = STATUS_DA_EDICAO.filter((status) => status !== "cancelado");

/** A etapa da edição (de 0 a 6), ou null na cancelada. */
export function etapaDaEdicao(status: StatusDaEdicao): number | null {
  const indice = (ETAPAS_DA_EDICAO as readonly string[]).indexOf(status);
  return indice >= 0 ? indice : null;
}

/** O nome curto do momento na linha do cronograma do cartão ("Montagem 28/01 10:00"). */
export const ROTULO_CURTO_DO_MOMENTO: Record<TipoDeMomento, string> = {
  coleta_no_cliente: "Coleta",
  entrega_no_local: "Entrega",
  montagem: "Montagem",
  evento: "Evento",
  desmontagem: "Desmontagem",
  retorno_ao_estoque: "Retorno",
  entrega_de_volta: "Entrega de volta",
  outro: "Outro",
};

/** Os nomes acessíveis dos campos de cada linha do cronograma, como a prancha; `ate` null onde a linha não tem fim. */
export const CAMPOS_DO_MOMENTO: Record<TipoDeMomento, { data: string; hora: string; ate: string | null; observacao: string }> = {
  coleta_no_cliente: { data: "Data da coleta no cliente", hora: "Hora da coleta no cliente", ate: null, observacao: "Observação da coleta no cliente" },
  entrega_no_local: { data: "Data da entrega no local", hora: "Hora da entrega no local", ate: null, observacao: "Observação da entrega no local" },
  montagem: { data: "Data da montagem", hora: "Hora da montagem", ate: "Fim da montagem", observacao: "Observação da montagem" },
  evento: { data: "Data do evento", hora: "Hora do evento", ate: "Fim do evento", observacao: "Observação do evento" },
  desmontagem: { data: "Data da desmontagem", hora: "Hora da desmontagem", ate: null, observacao: "Observação da desmontagem" },
  retorno_ao_estoque: { data: "Data do retorno ao estoque", hora: "Hora do retorno ao estoque", ate: null, observacao: "Observação do retorno" },
  entrega_de_volta: { data: "Data da entrega de volta", hora: "Hora da entrega de volta", ate: null, observacao: "Observação da entrega de volta" },
  outro: { data: "Data do outro momento", hora: "Hora do outro momento", ate: "Fim do outro momento", observacao: "Observação do outro momento" },
};

export const ROTULO_DO_OUTRO = "Rótulo do outro momento";

export const FILTROS_DA_LISTA = ["proximos", "em_andamento", "fechados", "todos"] as const;
export type FiltroDaLista = (typeof FILTROS_DA_LISTA)[number];

export const ROTULO_DO_FILTRO: Record<FiltroDaLista, string> = {
  proximos: "Próximos",
  em_andamento: "Em andamento",
  fechados: "Fechados",
  todos: "Todos",
};

/** O filtro de cada status: rascunho a separado são próximos; no evento e retornado, em andamento; fechado e cancelado, fechados. */
export const FILTRO_DO_STATUS: Record<StatusDaEdicao, Exclude<FiltroDaLista, "todos">> = {
  rascunho: "proximos",
  enviado: "proximos",
  confirmado: "proximos",
  separado: "proximos",
  no_evento: "em_andamento",
  retornado: "em_andamento",
  fechado: "fechados",
  cancelado: "fechados",
};
