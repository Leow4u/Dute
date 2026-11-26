// Cópia literal de lib/dominio/src/eventos.ts (não edite aqui).
/**
 * Os Eventos do portal, do portal ao histórico
 * (docs/superpowers/specs/2026-11-26-eventos-design.md). O evento do cliente
 * se repete, e cada edição é o registro completo de uma vez: aberta e enviada
 * pelo cliente no portal, confirmada, executada e fechada pela Dutelog na
 * Armazenagem. Aqui ficam os status da edição, os tipos de momento do
 * cronograma, os limites dos campos e as regras puras que o app e o servidor
 * precisam ter iguais.
 *
 * Funções puras, sem Firestore nem Date: a ordem do cronograma compara o
 * texto `${data}T${hora}` (AAAA-MM-DD e HH:MM). functions/wms guarda uma
 * cópia literal (domain/eventos/dominio.ts), e os dois rodam os mesmos casos
 * de eventos.casos.json.
 */

/** Os status da edição, na ordem do fluxo (spec, "Os status e quem move cada um"). */
export const STATUS_DA_EDICAO = [
  "rascunho",
  "enviado",
  "confirmado",
  "separado",
  "no_evento",
  "retornado",
  "fechado",
  "cancelado",
] as const;
export type StatusDaEdicao = (typeof STATUS_DA_EDICAO)[number];

export const ROTULO_DO_STATUS: Record<StatusDaEdicao, string> = {
  rascunho: "Rascunho",
  enviado: "Enviado",
  confirmado: "Confirmado",
  separado: "Separado",
  no_evento: "No evento",
  retornado: "Retornado",
  fechado: "Fechado",
  cancelado: "Cancelado",
};

/** Os tipos de momento do cronograma, na ordem do formulário. Só o `outro` leva rótulo. */
export const TIPOS_DE_MOMENTO = [
  "coleta_no_cliente",
  "entrega_no_local",
  "montagem",
  "evento",
  "desmontagem",
  "retorno_ao_estoque",
  "entrega_de_volta",
  "outro",
] as const;
export type TipoDeMomento = (typeof TIPOS_DE_MOMENTO)[number];

export const ROTULO_DO_MOMENTO: Record<TipoDeMomento, string> = {
  coleta_no_cliente: "Coleta no cliente",
  entrega_no_local: "Entrega no local",
  montagem: "Montagem",
  evento: "Evento",
  desmontagem: "Desmontagem e coleta",
  retorno_ao_estoque: "Retorno ao estoque Dutelog",
  entrega_de_volta: "Entrega de volta no cliente",
  outro: "Outro momento",
};

/**
 * De onde vem o `feito` de um momento: registrado à mão na ficha, da entrega
 * do pedido ou do retorno. Os dois últimos têm o instante do fato: a hora não
 * se corrige, só a observação.
 */
export const ORIGENS_DO_FEITO = ["registro", "pedido", "retorno"] as const;
export type OrigemDoFeito = (typeof ORIGENS_DO_FEITO)[number];

/**
 * Os limites dos campos (spec, "Limites e mensagens"): caracteres nos textos,
 * linhas nas listas e a quantidade inteira de cada item.
 */
export const LIMITES = {
  nome: 120,
  descricao: 300,
  local: 160,
  endereco: 300,
  contatoNome: 120,
  contatoTelefone: 40,
  observacaoDoMomento: 300,
  observacoes: 2000,
  coletaOnde: 300,
  coletaObservacao: 500,
  itens: 100,
  quantidade: 1_000_000,
  momentos: 12,
  outros: 5,
  fotos: 200,
  documentos: 20,
  legenda: 60,
  equipeTexto: 120,
  veiculo: 60,
  retornoObservacaoDoItem: 120,
  retornoObservacao: 500,
  motivo: 500,
  label: 40,
  rotulo: 60,
} as const;

/**
 * Para onde cada status vai. O rascunho não se cancela: é excluído e não vira
 * história. A edição sem itens do estoque pula o separado. De no_evento em
 * diante não cancela mais: os itens já saíram. Fechado e cancelado não saem.
 */
export const TRANSICOES: Record<StatusDaEdicao, readonly StatusDaEdicao[]> = {
  rascunho: ["enviado"],
  enviado: ["confirmado", "cancelado"],
  confirmado: ["separado", "no_evento", "cancelado"],
  separado: ["no_evento", "cancelado"],
  no_evento: ["retornado"],
  retornado: ["fechado"],
  fechado: [],
  cancelado: [],
};

export function podeTransitar(de: StatusDaEdicao, para: StatusDaEdicao): boolean {
  return (TRANSICOES[de] ?? []).includes(para);
}

/** A edição ainda recebe registro: de rascunho a retornado. Fechada ou cancelada, nada mais se grava. */
export function edicaoAberta(status: unknown): boolean {
  return status !== "fechado" && status !== "cancelado" && (STATUS_DA_EDICAO as readonly unknown[]).includes(status);
}

/** Um momento do cronograma como foi previsto: o tipo, o rótulo do `outro` e o `previsto` da edição. */
export type MomentoPrevisto = {
  tipo: TipoDeMomento;
  rotulo?: string | null;
  data: string;
  hora: string;
  ate?: string | null;
  local?: string | null;
  observacao?: string | null;
};

/**
 * A primeira recusa do cronograma, ou null quando ele vale (spec, "O
 * cronograma"): até 12 momentos, até cinco do tipo outro; cada tipo uma vez,
 * menos o outro, que leva rótulo; o evento sempre com data; com itens do
 * estoque, a entrega no local com data e hora e o retorno ao estoque com
 * data; com coleta, a coleta no cliente com data; e as datas dos tipos fixos
 * crescendo na ordem da lista (o mesmo instante vale). O outro fica fora da
 * ordem: o formulário o põe depois dos sete, com a data que tiver.
 */
export function problemaDoCronograma(
  momentos: readonly MomentoPrevisto[],
  contexto: { comItensDoEstoque: boolean; comColeta: boolean },
): string | null {
  if (momentos.length > LIMITES.momentos) return `O cronograma leva até ${LIMITES.momentos} momentos`;
  if (momentos.filter((momento) => momento.tipo === "outro").length > LIMITES.outros) {
    return "O cronograma leva até cinco momentos do tipo outro";
  }
  const vistos = new Set<TipoDeMomento>();
  for (const momento of momentos) {
    if (momento.tipo === "outro") continue;
    if (vistos.has(momento.tipo)) return `O momento ${ROTULO_DO_MOMENTO[momento.tipo]} se repete`;
    vistos.add(momento.tipo);
  }
  if (momentos.some((momento) => momento.tipo === "outro" && !preenchido(momento.rotulo))) {
    return "Informe o rótulo do outro momento";
  }
  const doTipo = (tipo: TipoDeMomento) => momentos.find((momento) => momento.tipo === tipo);
  if (!preenchido(doTipo("evento")?.data)) return "Informe a data do evento";
  if (contexto.comItensDoEstoque) {
    const entrega = doTipo("entrega_no_local");
    if (!preenchido(entrega?.data) || !preenchido(entrega?.hora)) return "Informe a data e a hora da entrega no local";
    if (!preenchido(doTipo("retorno_ao_estoque")?.data)) return "Informe a data do retorno ao estoque";
  }
  if (contexto.comColeta && !preenchido(doTipo("coleta_no_cliente")?.data)) return "Informe a data da coleta no cliente";
  const fixos = momentos.filter((momento) => momento.tipo !== "outro");
  for (let posicao = 1; posicao < fixos.length; posicao += 1) {
    const anterior = fixos[posicao - 1];
    const momento = fixos[posicao];
    if (instante(momento) < instante(anterior)) {
      return `${ROTULO_DO_MOMENTO[momento.tipo]} está antes de ${ROTULO_DO_MOMENTO[anterior.tipo]}`;
    }
  }
  return null;
}

/** As peças que foram e não voltaram, nem avariadas: foi − voltou − avariadas, nunca negativo. */
export function naoVoltaram(foi: number, voltou: number, avariadas: number): number {
  return Math.max(0, foi - voltou - avariadas);
}

/** O label padrão da edição: o ano da data do momento evento ("2027"), ou null sem ele. */
export function labelPadrao(momentos: readonly MomentoPrevisto[]): string | null {
  const data = momentos.find((momento) => momento.tipo === "evento")?.data;
  return /^(\d{4})-/.exec(data ?? "")?.[1] ?? null;
}

function preenchido(texto: string | null | undefined): boolean {
  return typeof texto === "string" && texto.trim() !== "";
}

function instante(momento: MomentoPrevisto): string {
  return `${momento.data}T${momento.hora}`;
}
