import type { LinhaDoSaldo } from "../operacao/demandas";
import type { FormularioDoPlano, OsNoPlano } from "../operacao/planejar";

/**
 * A duração sugerida no Planejar OS (docs/plataforma/fase-5-memoria.md, parte
 * 5.2b): o pedido de cada OS do plano, os textos da sugestão e a decisão da
 * pessoa. A conta é do servidor (functions/core, suggestDuration); aqui só o
 * que a tela monta e mostra. A sugestão é o tempo de trabalho, sem o
 * deslocamento: "Usar" põe o fim a partir do início, e quem planeja soma o
 * trajeto.
 */

export type BaseDoItem = { escopo: "cliente" | "geral"; execucoes: number; homem_minuto_por_unidade: number; os_recentes: string[] };
export type ItemSugerido = { lpu_item_id: string | null; item: string; quantidade: string; minutos: number | null; base: BaseDoItem | null };
export type HistoricoDoPlanejamento = { escopo: "cliente" | "geral"; execucoes: number; erro_medio_pct: number; acima_da_janela: number };

export type Sugestao = {
  pessoas: number;
  itens: ItemSugerido[];
  minutos_total: number | null;
  completa: boolean;
  divisao: { os: number; minutos_por_os: number } | null;
  plano_otimista: HistoricoDoPlanejamento | null;
};

export type PedidoDeSugestao = {
  demanda: string;
  pessoas: number;
  itens: Array<{ lpu_item_id: string | null; item: string; quantidade: string }>;
};

/** A sugestão de uma OS na tela: a do pedido de agora (pela chave), carregando, pronta ou com erro. */
export type SugestaoNaTela = { chave: string; estado: "carregando" | "pronto" | "erro"; sugestao: Sugestao | null };

/** O que a pessoa fez com a sugestão daquela OS: usou (o fim que ela pôs) ou ignorou. Vale para a chave do pedido. */
export type DecisaoNaTela = { chave: string; usou: string | null; ignorou: boolean };

/** A quantidade como digitada, com vírgula ou ponto; null quando não é quantidade positiva. */
function quantidadeLida(valor: string | undefined): string | null {
  const limpo = (valor ?? "").trim().replace(",", ".");
  if (!/^\d{1,9}(\.\d{1,3})?$/.test(limpo) || Number(limpo) <= 0) return null;
  return limpo;
}

/**
 * O pedido da OS do plano: a equipe que vai nela e as linhas com quantidade.
 * Sem equipe ou sem nenhum item da tabela, não há o que sugerir.
 */
export function pedidoDaSugestao(form: FormularioDoPlano, indice: number, saldo: readonly LinhaDoSaldo[], demanda: string): PedidoDeSugestao | null {
  const os = form.ordens[indice];
  if (!os) return null;
  const pessoas = form.equipe.filter((pessoa) => pessoa.ordens.includes(indice)).length;
  const itens = saldo.flatMap((linha) => {
    const quantidade = quantidadeLida(os.itens[linha.id]);
    return quantidade ? [{ lpu_item_id: linha.lpuItemId ?? null, item: linha.item, quantidade }] : [];
  });
  if (pessoas < 1 || !itens.some((item) => item.lpu_item_id)) return null;
  return { demanda, pessoas, itens };
}

export function chaveDoPedido(pedido: PedidoDeSugestao): string {
  return JSON.stringify(pedido);
}

/** "45 min", "2h", "2h30". */
export function duracaoEmTexto(minutos: number): string {
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return resto ? `${horas}h${String(resto).padStart(2, "0")}` : `${horas}h`;
}

/** O início da janela mais os minutos, ou null quando passa do dia. */
export function somarMinutos(inicio: string, minutos: number): string | null {
  const match = /^(\d{2}):(\d{2})$/.exec(inicio);
  if (!match) return null;
  const total = Number(match[1]) * 60 + Number(match[2]) + minutos;
  if (total > 23 * 60 + 59) return null;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** A janela em minutos, ou null sem início e fim. */
export function minutosDaJanela(inicio: string, fim: string): number | null {
  const [hi, mi] = inicio.split(":").map(Number);
  const [hf, mf] = fim.split(":").map(Number);
  if (![hi, mi, hf, mf].every(Number.isFinite)) return null;
  const minutos = hf * 60 + mf - (hi * 60 + mi);
  return minutos > 0 ? minutos : null;
}

/** O começo da janela quando "Usar" chega sem início: o começo do dia de trabalho. */
export const INICIO_PADRAO = "08:00";

/** A janela com a sugestão: o fim a partir do início (ou do começo do dia), ou null quando passa do dia. */
export function janelaComSugestao(os: OsNoPlano, minutos: number): OsNoPlano | null {
  const inicio = os.inicio || INICIO_PADRAO;
  const fim = somarMinutos(inicio, minutos);
  return fim ? { ...os, inicio, fim } : null;
}

function plural(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`;
}

/** "6 execuções do cliente", "40 execuções na média interna". */
export function baseEmTexto(base: BaseDoItem): string {
  return `${plural(base.execucoes, "execução", "execuções")} ${base.escopo === "cliente" ? "do cliente" : "na média interna"}`;
}

const DECIMAL = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

/** As OS de onde a base saiu, as três mais recentes. */
export const OS_NA_ORIGEM_DA_TELA = 3;

/**
 * "Mesa · 10 min por unidade com 2 pessoas · 6 execuções do cliente: 10041-01, 10040-01";
 * sem base, "Cadeira · sem base".
 */
export function itemEmTexto(item: ItemSugerido, pessoas: number): string {
  if (!item.base) return `${item.item} · sem base`;
  const porUnidade = DECIMAL.format(item.base.homem_minuto_por_unidade / pessoas);
  const origem = item.base.os_recentes.slice(0, OS_NA_ORIGEM_DA_TELA);
  return `${item.item} · ${porUnidade} min por unidade com ${plural(pessoas, "pessoa", "pessoas")} · ${baseEmTexto(item.base)}${origem.length ? `: ${origem.join(", ")}` : ""}`;
}

/** "Duração sugerida 2h30 com 2 pessoas". */
export function duracaoSugeridaEmTexto(sugestao: Sugestao): string | null {
  if (sugestao.minutos_total === null) return null;
  return `Duração sugerida ${duracaoEmTexto(sugestao.minutos_total)} com ${plural(sugestao.pessoas, "pessoa", "pessoas")}`;
}

/** "Passa de 8h: 2 OS de 5h". */
export function divisaoEmTexto(divisao: NonNullable<Sugestao["divisao"]>): string {
  return `Passa de 8h: ${divisao.os} OS de ${duracaoEmTexto(divisao.minutos_por_os)}`;
}

/** "Os planos deste cliente passam da janela em 22%, na média de 6 OS." */
export function planoOtimistaEmTexto(historico: HistoricoDoPlanejamento): string {
  const quem = historico.escopo === "cliente" ? "Os planos deste cliente" : "Os planos";
  return `${quem} passam da janela em ${historico.erro_medio_pct}%, na média de ${historico.execucoes} OS.`;
}

/** A decisão da pessoa, pela tela: ignorou, recusou; usou e manteve o fim, aceitou; o resto, mudou. */
export function decisaoDaSugestao(decisao: DecisaoNaTela | undefined, chave: string, fim: string): "aceitou" | "mudou" | "recusou" {
  if (decisao?.chave === chave && decisao.ignorou) return "recusou";
  if (decisao?.chave === chave && decisao.usou && decisao.usou === fim) return "aceitou";
  return "mudou";
}

/** A resposta que vai ao answerSuggestion quando a OS é salva. */
export function respostaDaSugestao(
  pedido: PedidoDeSugestao,
  os: string,
  osNoPlano: OsNoPlano,
  decisao: DecisaoNaTela | undefined,
  idempotencyKey: string,
): Record<string, unknown> {
  return {
    idempotency_key: idempotencyKey,
    ...pedido,
    os,
    decisao: decisaoDaSugestao(decisao, chaveDoPedido(pedido), osNoPlano.fim),
    minutos_escolhidos: minutosDaJanela(osNoPlano.inicio, osNoPlano.fim),
  };
}
