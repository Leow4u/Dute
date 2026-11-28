import { edicaoAberta } from "@workspace/dominio";

import { limitesDoPeriodo, linhaDoCronograma, periodoDaEdicao, rotuloDoPeriodo } from "./cronograma";
import { linhaDoFechamento, linhaDosItens } from "./itens";
import type { EventoView, PrecoDaEdicao } from "./leitura";
import { FILTRO_DO_STATUS, FILTROS_DA_LISTA, SELO_DO_STATUS, etapaDaEdicao, type FiltroDaLista } from "./rotulos";
import type { EdicaoView } from "./tipos";

/**
 * A lista do portal (docs/mockups/EventosPortalLista.dc.html): um cartão por
 * evento ativo com edição, com a edição da vez (a aberta, senão a última),
 * as anteriores pelo label, o que o cartão mostra e as ações. A edição aberta
 * tem as etapas e a linha do cronograma; a fechada e a cancelada, não, como
 * a prancha.
 */

export type RotuloDoQuando = "Próxima edição" | "Última edição" | "Em andamento";

export type CartaoDoEvento = {
  evento: EventoView;
  atual: EdicaoView;
  /** As outras edições do evento, pelo label. */
  anteriores: EdicaoView[];
  quando: { texto: string; rotulo: RotuloDoQuando | null } | null;
  /** "<local> · <endereço>". */
  local: string | null;
  cronograma: string | null;
  itens: string | null;
  fechamento: string | null;
  selo: string;
  /** A etapa da edição aberta, de 0 a 5; null na fechada e na cancelada (sem as etapas). */
  etapa: number | null;
  /** A edição da vez está aberta: o rodapé a marca "(esta)". */
  esta: boolean;
  acoes: { abrir: boolean; continuar: boolean; excluirRascunho: boolean; novaEdicaoAPartirDe: string | null };
};

function semAcento(valor: string): string {
  return valor.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const maisRecente = (a: EdicaoView, b: EdicaoView) => (b.updated_at ?? "").localeCompare(a.updated_at ?? "");

function porLabel(a: EdicaoView, b: EdicaoView): number {
  if (a.label === null || b.label === null) return a.label === b.label ? 0 : a.label === null ? 1 : -1;
  return a.label.localeCompare(b.label, "pt-BR", { numeric: true });
}

/** A edição da vez: a aberta mudada por último; sem aberta, a última criada (a capa diz qual) ou a mudada por último. */
function edicaoDaVez(evento: EventoView, edicoes: readonly EdicaoView[]): EdicaoView {
  const abertas = edicoes.filter((edicao) => edicaoAberta(edicao.status)).sort(maisRecente);
  return abertas[0] ?? edicoes.find((edicao) => edicao.id === evento.last_edition_id) ?? [...edicoes].sort(maisRecente)[0];
}

function cartaoDe(evento: EventoView, edicoes: readonly EdicaoView[], precos: ReadonlyMap<string, PrecoDaEdicao>, hoje: string): CartaoDoEvento {
  const atual = edicaoDaVez(evento, edicoes);
  const aberta = edicaoAberta(atual.status);
  const periodo = periodoDaEdicao(atual.cronograma);
  const emAndamento = FILTRO_DO_STATUS[atual.status] === "em_andamento";
  const algumaAberta = edicoes.some((edicao) => edicaoAberta(edicao.status));
  return {
    evento,
    atual,
    anteriores: edicoes.filter((edicao) => edicao !== atual).sort(porLabel),
    // A cancelada não é próxima nem última: o selo já diz.
    quando: periodo
      ? { texto: periodo, rotulo: atual.status === "cancelado" ? null : emAndamento ? "Em andamento" : rotuloDoPeriodo(atual.cronograma, hoje) }
      : null,
    local: atual.onde.local ? [atual.onde.local, atual.onde.endereco].filter(Boolean).join(" · ") : null,
    cronograma: aberta ? linhaDoCronograma(atual.cronograma) : null,
    itens: linhaDosItens(atual),
    fechamento: linhaDoFechamento(atual, precos.get(atual.id) ?? null),
    selo: SELO_DO_STATUS[atual.status],
    etapa: aberta ? etapaDaEdicao(atual.status) : null,
    esta: aberta,
    acoes: {
      abrir: atual.status !== "rascunho",
      continuar: atual.status === "rascunho",
      excluirRascunho: atual.status === "rascunho",
      novaEdicaoAPartirDe: algumaAberta ? null : atual.label,
    },
  };
}

const ORDEM_DO_GRUPO: Record<Exclude<FiltroDaLista, "todos">, number> = { proximos: 0, em_andamento: 1, fechados: 2 };

/** As próximas pelo primeiro dia, as em andamento também, depois as outras do dia mais recente ao mais antigo; e o nome. */
function ordemDosCartoes(a: CartaoDoEvento, b: CartaoDoEvento): number {
  const grupoA = FILTRO_DO_STATUS[a.atual.status];
  const grupoB = FILTRO_DO_STATUS[b.atual.status];
  if (grupoA !== grupoB) return ORDEM_DO_GRUPO[grupoA] - ORDEM_DO_GRUPO[grupoB];
  const diasA = limitesDoPeriodo(a.atual.cronograma);
  const diasB = limitesDoPeriodo(b.atual.cronograma);
  const porDia =
    grupoA === "fechados"
      ? (diasB?.ultimo ?? "").localeCompare(diasA?.ultimo ?? "")
      : (diasA?.primeiro ?? "9999").localeCompare(diasB?.primeiro ?? "9999");
  return porDia || a.evento.name.localeCompare(b.evento.name, "pt-BR");
}

export function cartoesDaLista(
  eventos: readonly EventoView[],
  edicoes: readonly EdicaoView[],
  precos: readonly PrecoDaEdicao[],
  hoje: string,
): CartaoDoEvento[] {
  const porEvento = new Map<string, EdicaoView[]>();
  for (const edicao of edicoes) porEvento.set(edicao.event_id, [...(porEvento.get(edicao.event_id) ?? []), edicao]);
  const precoDe = new Map(precos.map((preco) => [preco.id, preco]));
  return eventos
    .filter((evento) => evento.status === "active" && porEvento.get(evento.id)?.length)
    .map((evento) => cartaoDe(evento, porEvento.get(evento.id)!, precoDe, hoje))
    .sort(ordemDosCartoes);
}

/** O filtro pelo status da edição da vez e a busca pelo nome e pelo local, sem acento. */
export function filtrarCartoes(cartoes: readonly CartaoDoEvento[], filtro: FiltroDaLista, busca: string): CartaoDoEvento[] {
  const procura = semAcento(busca.trim());
  return cartoes.filter((cartao) => {
    if (filtro !== "todos" && FILTRO_DO_STATUS[cartao.atual.status] !== filtro) return false;
    if (!procura) return true;
    return [cartao.evento.name, cartao.atual.onde.local ?? "", cartao.atual.onde.endereco ?? ""].some((texto) => semAcento(texto).includes(procura));
  });
}

export function contagemDosFiltros(cartoes: readonly CartaoDoEvento[]): Record<FiltroDaLista, number> {
  return Object.fromEntries(FILTROS_DA_LISTA.map((filtro) => [filtro, filtrarCartoes(cartoes, filtro, "").length])) as Record<FiltroDaLista, number>;
}
