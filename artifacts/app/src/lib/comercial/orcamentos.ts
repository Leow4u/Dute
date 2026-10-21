import type { Papel } from "@workspace/dominio";

import { dataBr } from "./clientes";
import { ROTA_ORCAMENTO } from "./navegacao";

/**
 * Regras puras da fila de orçamentos do Comercial (docs/mockups/ComFila.dc.html;
 * parte 11 de docs/plataforma/fase-6-comercial.md): a demanda e o orçamento
 * lidos do Firestore (`demands` e `quotes`, gravados só por functions/comercial,
 * domain/quotes.ts), os segmentos por etapa, a busca, os grupos, o tempo na
 * etapa, o segmento inicial por papel e a ficha resumida.
 *
 * As listas de etapa, situação, tipo de RV e origem da linha são cópias
 * literais de functions/comercial/src/domain/events.ts, travadas por
 * orcamentos.test.ts.
 */

type Registro = Record<string, unknown>;

export const ETAPAS_DEMANDA = [
  "em_montagem",
  "para_aprovar",
  "para_enviar",
  "aguardando_cliente",
  "para_planejar",
  "execucao_a_orcar",
  "aguardando_autorizacao",
  "a_faturar",
  "perdida",
  "cancelada",
] as const;
export type EtapaDemanda = (typeof ETAPAS_DEMANDA)[number];

export const STATUS_ORCAMENTO = ["rascunho", "para_aprovar", "aprovado", "enviado"] as const;
export type StatusOrcamento = (typeof STATUS_ORCAMENTO)[number];

export const TIPOS_RV = ["proposta", "aditivo", "execucao"] as const;
export type TipoRv = (typeof TIPOS_RV)[number];

export const ORIGENS_LINHA = ["tabela", "alterado", "avulso", "ajuste"] as const;
export type OrigemLinha = (typeof ORIGENS_LINHA)[number];

/**
 * As etapas da fila, na ordem do mockup. "A faturar" e "Cancelada" ficam
 * fora: a demanda já saiu do Comercial (autorização e faturamento têm tela
 * própria).
 */
export const ETAPAS_DA_FILA = [
  "em_montagem",
  "para_aprovar",
  "para_enviar",
  "aguardando_cliente",
  "para_planejar",
  "execucao_a_orcar",
  "aguardando_autorizacao",
  "perdida",
] as const satisfies readonly EtapaDemanda[];
export type EtapaDaFila = (typeof ETAPAS_DA_FILA)[number];

export const SEGMENTOS_DA_FILA = ["todas", ...ETAPAS_DA_FILA] as const;
export type SegmentoDaFila = (typeof SEGMENTOS_DA_FILA)[number];

/** Rótulo da etapa no selo da linha e da ficha. */
export const ETAPA_ROTULO: Record<EtapaDemanda, string> = {
  em_montagem: "Em montagem",
  para_aprovar: "Para aprovar",
  para_enviar: "Para enviar",
  aguardando_cliente: "Aguardando cliente",
  para_planejar: "Para planejar",
  execucao_a_orcar: "Execução a orçar",
  aguardando_autorizacao: "Aguardando autorização",
  a_faturar: "A faturar",
  perdida: "Perdida",
  cancelada: "Cancelada",
};

/** Rótulo do segmento e do grupo (no plural onde o mockup usa). */
export const SEGMENTO_ROTULO: Record<SegmentoDaFila, string> = {
  todas: "Todas",
  em_montagem: "Em montagem",
  para_aprovar: "Para aprovar",
  para_enviar: "Para enviar",
  aguardando_cliente: "Aguardando cliente",
  para_planejar: "Para planejar",
  execucao_a_orcar: "Execução a orçar",
  aguardando_autorizacao: "Aguardando autorização",
  perdida: "Perdidas",
};

export const TIPO_RV_ROTULO: Record<TipoRv, string> = {
  proposta: "Proposta",
  aditivo: "Aditivo",
  execucao: "Execução",
};

export const ORIGEM_ROTULO: Record<OrigemLinha, string> = {
  tabela: "Tabela",
  alterado: "Alterado",
  avulso: "Avulso",
  ajuste: "Ajuste",
};

// --- Cores das etapas -------------------------------------------------------------

/*
 * As cores do mockup (docs/mockups/README.md, "Status"), por token do tema
 * (index.css): cinza em montagem, âmbar esperando a Dutelog, violeta para
 * enviar, azul com o cliente, verde fechado, verde-água a faturar, vermelho
 * atrasado. Nada de cor fixa (theme-colors.test.ts).
 */
const NEUTRO = "border-border bg-muted text-foreground";
const AMBAR = "border-amber-soft-border bg-amber-soft text-amber-soft-foreground";
const VIOLETA = "border-violet-soft-border bg-violet-soft text-violet-soft-foreground";
const AZUL = "border-info-soft-border bg-info-soft text-info-soft-foreground";
const VERDE = "border-success-soft-border bg-success-soft text-success-soft-foreground";
const VERDE_AGUA = "border-teal-soft-border bg-teal-soft text-teal-soft-foreground";
const VERMELHO = "border-destructive-soft-border bg-destructive-soft text-destructive-soft-foreground";
const APAGADO = "border-transparent bg-muted text-muted-foreground";

const COR_DA_ETAPA: Record<EtapaDemanda, string> = {
  em_montagem: NEUTRO,
  para_aprovar: AMBAR,
  para_enviar: VIOLETA,
  aguardando_cliente: AZUL,
  para_planejar: VERDE,
  execucao_a_orcar: AMBAR,
  aguardando_autorizacao: AMBAR,
  a_faturar: VERDE_AGUA,
  perdida: APAGADO,
  cancelada: APAGADO,
};

const PONTO_DA_ETAPA: Record<EtapaDemanda, string> = {
  em_montagem: "bg-foreground",
  para_aprovar: "bg-amber-soft-foreground",
  para_enviar: "bg-violet-soft-foreground",
  aguardando_cliente: "bg-info-soft-foreground",
  para_planejar: "bg-success-soft-foreground",
  execucao_a_orcar: "bg-amber-soft-foreground",
  aguardando_autorizacao: "bg-amber-soft-foreground",
  a_faturar: "bg-teal-soft-foreground",
  perdida: "bg-muted-foreground",
  cancelada: "bg-muted-foreground",
};

/** Dias esperando a autorização de faturamento a partir dos quais a etapa fica vermelha. */
export const PRAZO_DA_AUTORIZACAO_DIAS = 30;

/** Classes do selo da etapa; a autorização que espera 30 dias ou mais fica vermelha. */
export function corDaEtapa(etapa: EtapaDemanda, dias?: number | null): string {
  if (etapa === "aguardando_autorizacao" && typeof dias === "number" && dias >= PRAZO_DA_AUTORIZACAO_DIAS) return VERMELHO;
  return COR_DA_ETAPA[etapa];
}

/** Classe do ponto da etapa (segmento e cabeçalho do grupo): a cor do texto do selo. */
export function pontoDaEtapa(etapa: EtapaDemanda): string {
  return PONTO_DA_ETAPA[etapa];
}

// --- Leitura dos documentos ---------------------------------------------------------

function texto(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function opcional(value: unknown): string | null {
  return texto(value) || null;
}

function isRegistro(value: unknown): value is Registro {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function daLista<T extends string>(lista: readonly T[], value: unknown, padrao: T): T {
  return (lista as readonly string[]).includes(texto(value)) ? (texto(value) as T) : padrao;
}

function inteiro(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

/** "10045" na RV 0; "10045 – RV01" em diante (o mesmo rótulo do servidor, domain/demanda.ts). */
export function rotuloDoOrcamento(numero: string, rv: number): string {
  return rv === 0 ? numero : `${numero} – RV${String(rv).padStart(2, "0")}`;
}

export type MarcoDaDemanda = { etapa: EtapaDemanda; em: string; porUid: string | null };
export type LinhaResumo = { origem: OrigemLinha; totalCents: number };

export type ItemDaFila = {
  numero: string;
  rotulo: string;
  rv: number;
  tipoRv: TipoRv;
  status: StatusOrcamento;
  edicao: number;
  etapa: EtapaDemanda;
  /** Desde quando está na etapa (ISO). */
  etapaDesde: string | null;
  customerCode: string;
  cliente: string;
  titulo: string | null;
  refCliente: string | null;
  numeroLegado: string | null;
  canal: string | null;
  recebidaEm: string | null;
  /** O "Para": contato do cliente e a empresa dele (a gerenciadora). */
  contatoId: string | null;
  empresa: string | null;
  origemLocalId: string | null;
  destinoLocalId: string | null;
  contratoId: string | null;
  tabelaNome: string | null;
  variante: string | null;
  dataBase: string | null;
  /** Total que o servidor calculou; null sem orçamento lido. */
  totalCents: number | null;
  linhas: LinhaResumo[];
  marcos: MarcoDaDemanda[];
  autorUid: string | null;
  /** O nome de quem montou, gravado pelo servidor (autor_nome): o comercial não lê `users`. */
  autorNome: string | null;
  passoEm: string | null;
  aprovacao: { porUid: string | null; em: string } | null;
  devolucao: { nota: string | null; porUid: string | null; em: string } | null;
  /** O envio ao cliente da RV em curso (quotes.envio, parte 10). */
  envio: { porUid: string | null; em: string } | null;
  /** As marcas que o servidor deu ao orçamento (preco_alterado, tabela_vencida...). */
  marcas: string[];
  /** A perda (parte 10), lida sem exigir o formato: motivo e quando. */
  perda: { motivo: string | null; em: string | null } | null;
};

function marcos(value: unknown): MarcoDaDemanda[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((marco) => {
    if (!isRegistro(marco) || !texto(marco.em)) return [];
    const etapa = texto(marco.etapa);
    if (!(ETAPAS_DEMANDA as readonly string[]).includes(etapa)) return [];
    return [{ etapa: etapa as EtapaDemanda, em: texto(marco.em), porUid: opcional(marco.por_uid) }];
  });
}

function linhasResumo(value: unknown): LinhaResumo[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((linha) => {
    if (!isRegistro(linha)) return [];
    const origem = texto(linha.origem);
    const total = inteiro(linha.total_cents);
    if (!(ORIGENS_LINHA as readonly string[]).includes(origem) || total === null) return [];
    return [{ origem: origem as OrigemLinha, totalCents: total }];
  });
}

function passoComQuem(value: unknown): { porUid: string | null; em: string } | null {
  if (!isRegistro(value) || !texto(value.em)) return null;
  return { porUid: opcional(value.por_uid), em: texto(value.em) };
}

function perdaDe(value: unknown): ItemDaFila["perda"] {
  if (value === null || value === undefined || value === false) return null;
  if (!isRegistro(value)) return { motivo: opcional(value), em: null };
  return { motivo: opcional(value.motivo) ?? opcional(value.descricao), em: opcional(value.em) };
}

/**
 * A linha da fila a partir de `demands/{numero}` e `quotes/{numero}`. Sem a
 * demanda (ou com etapa desconhecida) não há linha; sem o orçamento, a linha
 * aparece sem total.
 */
export function itemDaFila(numero: string, demanda: Registro | null, quote: Registro | null): ItemDaFila | null {
  if (!demanda) return null;
  const etapa = texto(demanda.etapa);
  if (!(ETAPAS_DEMANDA as readonly string[]).includes(etapa)) return null;
  const q = quote ?? {};
  const rv = inteiro(q.rv) ?? 0;
  const tabela = isRegistro(q.tabela) ? q.tabela : {};
  const solicitante = isRegistro(demanda.solicitante) ? demanda.solicitante : {};
  const origem = isRegistro(demanda.origem) ? demanda.origem : {};
  const destino = isRegistro(demanda.destino) ? demanda.destino : {};
  const devolucao = isRegistro(q.devolucao) && texto(q.devolucao.em)
    ? { nota: opcional(q.devolucao.nota), porUid: opcional(q.devolucao.por_uid), em: texto(q.devolucao.em) }
    : null;
  const customerCode = texto(demanda.customer_code) || texto(q.customer_code);
  return {
    numero,
    rotulo: opcional(q.rotulo) ?? rotuloDoOrcamento(numero, rv),
    rv,
    tipoRv: daLista(TIPOS_RV, q.tipo_rv, "proposta"),
    status: daLista(STATUS_ORCAMENTO, q.status, "rascunho"),
    edicao: inteiro(q.edicao) ?? 1,
    etapa: etapa as EtapaDemanda,
    etapaDesde: opcional(demanda.etapa_desde),
    customerCode,
    cliente: texto(demanda.customer_name) || customerCode,
    titulo: opcional(demanda.titulo),
    refCliente: opcional(demanda.ref_cliente),
    numeroLegado: opcional(demanda.numero_legado),
    canal: opcional(demanda.canal),
    recebidaEm: opcional(demanda.recebida_em),
    contatoId: opcional(solicitante.contato_id),
    empresa: opcional(solicitante.empresa),
    origemLocalId: opcional(origem.local_id),
    destinoLocalId: opcional(destino.local_id),
    contratoId: opcional(demanda.contrato_id),
    tabelaNome: opcional(tabela.nome),
    variante: opcional(tabela.variante),
    dataBase: opcional(q.data_base),
    totalCents: quote ? inteiro(q.total_cents) : null,
    linhas: linhasResumo(q.linhas),
    marcos: marcos(demanda.marcos),
    autorUid: opcional(q.autor_uid),
    autorNome: opcional(q.autor_nome),
    passoEm: opcional(q.passo_em),
    aprovacao: passoComQuem(q.aprovacao),
    devolucao,
    envio: passoComQuem(q.envio),
    marcas: Array.isArray(q.marcas) ? q.marcas.map(texto).filter(Boolean) : [],
    perda: perdaDe(demanda.perda),
  };
}

// --- Segmentos, busca e grupos ---------------------------------------------------------

export type ContagemDaFila = Record<SegmentoDaFila, number>;

function naFila(etapa: EtapaDemanda): etapa is EtapaDaFila {
  return (ETAPAS_DA_FILA as readonly string[]).includes(etapa);
}

/** Quantos orçamentos há em cada etapa da fila; Todas soma só as etapas da fila. */
export function contarSegmentos(itens: readonly ItemDaFila[]): ContagemDaFila {
  const contagem = Object.fromEntries(SEGMENTOS_DA_FILA.map((segmento) => [segmento, 0])) as ContagemDaFila;
  for (const item of itens) {
    if (!naFila(item.etapa)) continue;
    contagem[item.etapa] += 1;
    contagem.todas += 1;
  }
  return contagem;
}

/** Sem acento e em minúsculas: "Itaú" acha "itau". */
function semAcento(value: unknown): string {
  return texto(value).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Busca por número (com ou sem a RV), nº legado, cliente, referência ou
 * título. Várias palavras: todas precisam aparecer.
 */
export function correspondeABusca(item: ItemDaFila, busca: string): boolean {
  const termos = semAcento(busca).split(/\s+/).filter(Boolean);
  if (!termos.length) return true;
  const alvo = semAcento([item.numero, item.rotulo, item.numeroLegado, item.cliente, item.refCliente, item.titulo].filter(Boolean).join(" "));
  return termos.every((termo) => alvo.includes(termo));
}

export type GrupoDaFila = { etapa: EtapaDaFila; rotulo: string; itens: ItemDaFila[] };

function instante(value: string | null): number {
  const ms = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * Os grupos da fila, na ordem das etapas, só os que têm orçamento. Dentro do
 * grupo, quem espera há mais tempo vem primeiro; nas perdidas, a mais recente.
 */
export function filtrarFila(itens: readonly ItemDaFila[], segmento: SegmentoDaFila, busca: string): GrupoDaFila[] {
  const achados = itens.filter((item) => naFila(item.etapa) && correspondeABusca(item, busca));
  return ETAPAS_DA_FILA.filter((etapa) => segmento === "todas" || segmento === etapa)
    .map((etapa) => {
      const doGrupo = achados.filter((item) => item.etapa === etapa);
      const sentido = etapa === "perdida" ? -1 : 1;
      doGrupo.sort(
        (a, b) => sentido * (instante(a.etapaDesde) - instante(b.etapaDesde)) || a.numero.localeCompare(b.numero),
      );
      return { etapa, rotulo: SEGMENTO_ROTULO[etapa], itens: doGrupo };
    })
    .filter((grupo) => grupo.itens.length > 0);
}

/**
 * Onde a fila abre: o comercial em Para enviar quando há algo (senão Em
 * montagem); o owner, que aprova, em Para aprovar; os outros em Todas.
 */
export function segmentoInicial(role: Papel | string | null | undefined, contagem: ContagemDaFila): SegmentoDaFila {
  if (role === "comercial") return contagem.para_enviar > 0 ? "para_enviar" : "em_montagem";
  if (role === "owner") return "para_aprovar";
  return "todas";
}

// --- Tempo na etapa ---------------------------------------------------------------------

const FUSO = "America/Sao_Paulo";

const DIA = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" });
const DIA_MES_HORA = new Intl.DateTimeFormat("pt-BR", {
  timeZone: FUSO,
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** O dia (AAAA-MM-DD) em São Paulo, como o servidor (domain/demanda.ts). */
export function diaEmSaoPaulo(data: Date): string {
  return DIA.format(data);
}

function diasEntre(de: string, ate: string): number {
  const [a, b] = [de, ate].map((dia) => {
    const [ano, mes, d] = dia.split("-").map(Number);
    return Date.UTC(ano, mes - 1, d);
  });
  return Math.round((b - a) / 86_400_000);
}

/** Dias corridos (calendário de São Paulo) desde o instante; null sem instante válido. */
export function diasNaEtapa(desde: string | null, agora: Date): number | null {
  const inicio = desde ? Date.parse(desde) : Number.NaN;
  if (Number.isNaN(inicio)) return null;
  return Math.max(0, diasEntre(diaEmSaoPaulo(new Date(inicio)), diaEmSaoPaulo(agora)));
}

/** "21/10 09:05" em São Paulo. */
export function dataHoraCurta(iso: string | null): string | null {
  const ms = iso ? Date.parse(iso) : Number.NaN;
  if (Number.isNaN(ms)) return null;
  return DIA_MES_HORA.format(new Date(ms)).replace(",", "");
}

/**
 * Há quanto tempo está na etapa: "agora", "40 min", "hoje", "1 dia",
 * "6 dias". Na perdida e na cancelada, a data ("08/10").
 */
export function tempoNaEtapa(desde: string | null, agora: Date, etapa: EtapaDemanda): string {
  const inicio = desde ? Date.parse(desde) : Number.NaN;
  if (Number.isNaN(inicio)) return "";
  if (etapa === "perdida" || etapa === "cancelada") return (dataHoraCurta(desde) ?? "").slice(0, 5);
  const minutos = Math.floor(Math.max(0, agora.getTime() - inicio) / 60_000);
  if (minutos < 1) return "agora";
  if (minutos < 60) return `${minutos} min`;
  const dias = diasNaEtapa(desde, agora) ?? 0;
  if (dias === 0) return "hoje";
  return dias === 1 ? "1 dia" : `${dias} dias`;
}

// --- Ficha resumida -----------------------------------------------------------------------

export type LinhasDaOrigem = { origem: OrigemLinha; rotulo: string; quantidade: number; totalCents: number };

/** As linhas por origem (tabela, alterado, avulso, ajuste), com a quantidade e a soma. */
export function linhasPorOrigem(linhas: readonly LinhaResumo[]): LinhasDaOrigem[] {
  return ORIGENS_LINHA.map((origem) => {
    const daOrigem = linhas.filter((linha) => linha.origem === origem);
    return {
      origem,
      rotulo: ORIGEM_ROTULO[origem],
      quantidade: daOrigem.length,
      totalCents: daOrigem.reduce((soma, linha) => soma + linha.totalCents, 0),
    };
  }).filter((grupo) => grupo.quantidade > 0);
}

export type PassoDoHistorico = {
  rotulo: string;
  estado: "feito" | "pendente" | "perdido";
  /** "21/10 09:05" em São Paulo. */
  quando: string | null;
  detalhe: string | null;
};

/** Como o canal da demanda aparece no histórico e no pedido. */
export const CANAL_ROTULO: Record<string, string> = {
  email: "e-mail",
  telefone: "telefone",
  whatsapp: "WhatsApp",
  portal: "portal",
  wms: "WMS",
};

function pendente(rotulo: string): PassoDoHistorico {
  return { rotulo, estado: "pendente", quando: null, detalhe: null };
}

function ultimoMarco(item: ItemDaFila, etapas: readonly EtapaDemanda[]): MarcoDaDemanda | null {
  return [...item.marcos].reverse().find((marco) => etapas.includes(marco.etapa)) ?? null;
}

/**
 * Os marcos do orçamento com quem e quando: recebido, montado (enviado para
 * aprovação), aprovado e enviado ao cliente. De volta ao rascunho, o que
 * vinha depois do recebido fica pendente de novo; a devolução e a perda
 * aparecem como passo.
 */
export function historicoDoOrcamento(
  item: ItemDaFila,
  contexto: { nomeDe: (uid: string | null) => string | null; contato: string | null },
): PassoDoHistorico[] {
  const { nomeDe } = contexto;
  const canal = item.canal ? (CANAL_ROTULO[item.canal] ?? item.canal) : null;
  let origem: string | null = canal;
  if (contexto.contato) origem = canal === "e-mail" ? `e-mail de ${contexto.contato}` : [canal, contexto.contato].filter(Boolean).join(" · ");
  const passos: PassoDoHistorico[] = [
    { rotulo: "Recebido", estado: item.recebidaEm ? "feito" : "pendente", quando: dataHoraCurta(item.recebidaEm), detalhe: origem },
  ];
  if (item.status === "rascunho" && item.devolucao) {
    passos.push({ rotulo: "Devolvido", estado: "feito", quando: dataHoraCurta(item.devolucao.em), detalhe: nomeDe(item.devolucao.porUid) });
  }

  const rv = item.rv > 0 ? `RV${String(item.rv).padStart(2, "0")}` : null;
  const montado = item.status === "rascunho" ? null : (ultimoMarco(item, ["para_aprovar"]) ?? item.aprovacao);
  passos.push(
    montado
      ? {
          rotulo: "Montado",
          estado: "feito",
          quando: dataHoraCurta(montado.em),
          detalhe: [nomeDe(montado.porUid), rv].filter(Boolean).join(" · ") || null,
        }
      : pendente("Montado"),
  );

  const aprovado = item.status === "aprovado" || item.status === "enviado" ? item.aprovacao : null;
  // "Aprovado por Leonardo", como no mockup, quando quem lê pode ver o perfil de quem aprovou.
  const aprovador = aprovado ? nomeDe(aprovado.porUid) : null;
  passos.push(
    aprovado
      ? {
          rotulo: aprovador ? `Aprovado por ${aprovador}` : "Aprovado",
          estado: "feito",
          quando: dataHoraCurta(aprovado.em),
          detalhe: null,
        }
      : pendente("Aprovado"),
  );

  // A data do envio é a do servidor (quotes.envio); o marco da etapa só serve ao orçamento gravado antes dele.
  const enviado =
    item.status === "enviado" ? (item.envio ?? ultimoMarco(item, ["aguardando_cliente", "aguardando_autorizacao"])) : null;
  passos.push(
    enviado
      ? { rotulo: "Enviado", estado: "feito", quando: dataHoraCurta(enviado.em), detalhe: nomeDe(enviado.porUid) }
      : pendente("Enviado"),
  );

  if (item.etapa === "perdida" || item.etapa === "cancelada") {
    passos.push({
      rotulo: ETAPA_ROTULO[item.etapa],
      estado: "perdido",
      quando: dataHoraCurta(item.perda?.em ?? item.etapaDesde),
      detalhe: null,
    });
  }
  return passos;
}

/** "Contrato Itaú · até 30/06/2027"; "Sem contrato"; "—" enquanto o contrato não foi lido. */
export function rotuloDoContratoDoOrcamento(
  contratoId: string | null,
  contrato: { nome: string; vigenteAte: string | null } | null | undefined,
): string {
  if (!contratoId) return "Sem contrato";
  if (!contrato) return "—";
  return contrato.vigenteAte ? `${contrato.nome} · até ${dataBr(contrato.vigenteAte)}` : contrato.nome;
}

/** A ação da ficha: continuar a montagem, orçar a execução ou abrir o orçamento. */
export function acaoDaEtapa(etapa: EtapaDemanda): string {
  if (etapa === "em_montagem") return "Continuar montagem";
  if (etapa === "execucao_a_orcar") return "Orçar execução";
  return "Abrir orçamento";
}

/** A tela de montar o orçamento. */
export function hrefDoOrcamento(numero: string): string {
  return `${ROTA_ORCAMENTO}?numero=${encodeURIComponent(numero)}`;
}
