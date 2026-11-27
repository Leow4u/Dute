import { LIMITES, TIPOS_DE_MOMENTO, type TipoDeMomento } from "@workspace/dominio";

import { ROTULO_CURTO_DO_MOMENTO } from "./rotulos";
import type { MomentoPrevisto, MomentoView } from "./tipos";

/**
 * O cronograma na tela do portal (docs/superpowers/specs/2026-11-26-eventos-design.md,
 * "O cronograma"): as linhas do formulário, o que delas vai ao patch, o
 * período e a linha do cartão da lista. As datas são texto (AAAA-MM-DD); os
 * instantes do feito saem na hora de São Paulo.
 */

/**
 * Uma linha do formulário: o `id` do momento gravado (null na que ainda não
 * foi gravada), os campos como a pessoa os vê ("" no vazio) e o `local`, sem
 * coluna aqui, que só guarda o previsto que a ficha da Armazenagem edita.
 */
export type LinhaDoCronograma = {
  id: string | null;
  tipo: TipoDeMomento;
  /** Só no outro. */
  rotulo: string;
  data: string;
  hora: string;
  ate: string;
  local: string;
  observacao: string;
};

const TIPOS_FIXOS = TIPOS_DE_MOMENTO.filter((tipo) => tipo !== "outro");

/** Os dias que contam no período: a entrega no local, a montagem, o evento e a desmontagem. */
const TIPOS_DO_PERIODO: readonly TipoDeMomento[] = ["entrega_no_local", "montagem", "evento", "desmontagem"];

const DIA = /^(\d{4})-(\d{2})-(\d{2})$/;

function linhaVazia(tipo: TipoDeMomento): LinhaDoCronograma {
  return { id: null, tipo, rotulo: "", data: "", hora: "", ate: "", local: "", observacao: "" };
}

function linhaDoMomento(momento: MomentoView): LinhaDoCronograma {
  return {
    id: momento.id || null,
    tipo: momento.tipo,
    rotulo: momento.rotulo ?? "",
    data: momento.previsto.data ?? "",
    hora: momento.previsto.hora ?? "",
    ate: momento.previsto.ate ?? "",
    local: momento.previsto.local ?? "",
    observacao: momento.previsto.observacao ?? "",
  };
}

/** Os sete tipos na ordem, preenchidos pelo gravado, e os outros gravados depois deles. */
export function linhasDoFormulario(cronograma: readonly MomentoView[]): LinhaDoCronograma[] {
  const fixas = TIPOS_FIXOS.map((tipo) => {
    const gravado = cronograma.find((momento) => momento.tipo === tipo);
    return gravado ? linhaDoMomento(gravado) : linhaVazia(tipo);
  });
  return [...fixas, ...cronograma.filter((momento) => momento.tipo === "outro").map(linhaDoMomento)];
}

/** "Outro momento": a linha vazia do tipo outro, até cinco. */
export function adicionarOutro(linhas: readonly LinhaDoCronograma[]): LinhaDoCronograma[] {
  if (linhas.filter((linha) => linha.tipo === "outro").length >= LIMITES.outros) return [...linhas];
  return [...linhas, linhaVazia("outro")];
}

/**
 * O cronograma do patch: a linha sem data não vai; toda linha com data vai,
 * com a hora vazia em null em qualquer tipo (decisão 12: a da entrega no
 * local só é exigida no envio). O `id` vai só na linha que o tem: o servidor
 * funde por ele e o momento gravado mantém o id e o feito. O vazio vira null;
 * o rótulo, só no outro.
 */
export function cronogramaDasLinhas(linhas: readonly LinhaDoCronograma[]): MomentoPrevisto[] {
  return linhas
    .filter((linha) => linha.data.trim() !== "")
    .map((linha) => ({
      ...(linha.id ? { id: linha.id } : {}),
      tipo: linha.tipo,
      ...(linha.tipo === "outro" ? { rotulo: linha.rotulo.trim() || null } : {}),
      data: linha.data.trim(),
      hora: linha.hora.trim() || null,
      ate: linha.ate.trim() || null,
      local: linha.local.trim() || null,
      observacao: linha.observacao.trim() || null,
    }));
}

/** "28/01". */
export function formatarDia(data: string): string {
  const partes = DIA.exec(data);
  return partes ? `${partes[3]}/${partes[2]}` : data;
}

const INSTANTE = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "24/11 09:40", na hora de São Paulo. */
export function formatarInstante(iso: string): string {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return "";
  const parte = (tipo: string) => INSTANTE.formatToParts(data).find((item) => item.type === tipo)?.value ?? "";
  return `${parte("day")}/${parte("month")} ${parte("hour")}:${parte("minute")}`;
}

function diasDoPeriodo(cronograma: readonly MomentoView[]): string[] {
  return cronograma
    .filter((momento) => TIPOS_DO_PERIODO.includes(momento.tipo) && DIA.test(momento.previsto.data))
    .map((momento) => momento.previsto.data)
    .sort();
}

/** O primeiro e o último dia do período (AAAA-MM-DD), para ordenar a lista; null sem nenhum. */
export function limitesDoPeriodo(cronograma: readonly MomentoView[]): { primeiro: string; ultimo: string } | null {
  const dias = diasDoPeriodo(cronograma);
  return dias.length ? { primeiro: dias[0], ultimo: dias[dias.length - 1] } : null;
}

function diaSeguinte(dia: string, outro: string): boolean {
  const emMs = (texto: string) => {
    const [, ano, mes, dd] = DIA.exec(texto)!;
    return Date.UTC(Number(ano), Number(mes) - 1, Number(dd));
  };
  return emMs(outro) - emMs(dia) === 24 * 60 * 60 * 1000;
}

/**
 * Do menor ao maior dia entre a entrega no local, a montagem, o evento e a
 * desmontagem: "03/09/2026", "28 e 29/01/2027", "14 a 16/05/2026",
 * "30/01 a 02/02/2027"; null sem nenhum deles.
 */
export function periodoDaEdicao(cronograma: readonly MomentoView[]): string | null {
  const dias = diasDoPeriodo(cronograma);
  if (!dias.length) return null;
  const primeiro = dias[0];
  const ultimo = dias[dias.length - 1];
  const [, ano1, mes1, dia1] = DIA.exec(primeiro)!;
  const [, ano2, mes2, dia2] = DIA.exec(ultimo)!;
  if (primeiro === ultimo) return `${dia1}/${mes1}/${ano1}`;
  const liga = diaSeguinte(primeiro, ultimo) ? "e" : "a";
  if (ano1 !== ano2) return `${dia1}/${mes1}/${ano1} ${liga} ${dia2}/${mes2}/${ano2}`;
  if (mes1 !== mes2) return `${dia1}/${mes1} ${liga} ${dia2}/${mes2}/${ano2}`;
  return `${dia1} ${liga} ${dia2}/${mes2}/${ano2}`;
}

/** O último dia do período em diante de hoje é a próxima edição; antes, a última. */
export function rotuloDoPeriodo(cronograma: readonly MomentoView[], hoje: string): "Próxima edição" | "Última edição" | null {
  const dias = diasDoPeriodo(cronograma);
  if (!dias.length) return null;
  return dias[dias.length - 1] >= hoje ? "Próxima edição" : "Última edição";
}

function trechoDoMomento(momento: MomentoView): string {
  const rotulo = ROTULO_CURTO_DO_MOMENTO[momento.tipo];
  const fim = momento.feito?.fim ? formatarInstante(momento.feito.fim) : "";
  if (fim) return momento.tipo === "evento" ? `Evento terminou ${fim}` : `${rotulo} feita ${fim}`;
  const inicio = momento.feito?.inicio ? formatarInstante(momento.feito.inicio) : "";
  if (inicio) return `${rotulo} começou ${inicio}`;
  const dia = formatarDia(momento.previsto.data);
  const hora = momento.previsto.hora;
  // O fim previsto só conta no evento: a montagem da Necton, até 19:00, mostra só o começo.
  const ate = momento.tipo === "evento" ? momento.previsto.ate : null;
  if (hora && ate) return `${rotulo} ${dia} ${hora} às ${ate}`;
  if (hora) return `${rotulo} ${dia} ${hora}`;
  if (ate) return `${rotulo} ${dia} até ${ate}`;
  return `${rotulo} ${dia}`;
}

/**
 * A montagem, o evento e a desmontagem numa linha, por " · ": o previsto
 * ("Montagem 28/01 10:00 · Evento 29/01 08:00 às 20:00") ou o feito
 * ("Montagem feita 24/11 09:40", "Evento começou 25/11 08:00"); null sem
 * nenhum dos três.
 */
export function linhaDoCronograma(cronograma: readonly MomentoView[]): string | null {
  const trechos = (["montagem", "evento", "desmontagem"] as const)
    .map((tipo) => cronograma.find((momento) => momento.tipo === tipo && DIA.test(momento.previsto.data)))
    .filter((momento): momento is MomentoView => Boolean(momento))
    .map(trechoDoMomento);
  return trechos.length ? trechos.join(" · ") : null;
}
