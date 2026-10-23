import { centavosDaLinha, dataValida, diasEntre, formatarReais, somarCentavos, somarDias } from "@workspace/dominio";

import { dataBr } from "./clientes";
import type { Conferido, Contrato } from "./contratos";

/**
 * Regras puras da aba Autorizações do Comercial (docs/mockups/ComAutorizacoes.dc.html;
 * docs/plataforma/fase-6-comercial.md, parte 15b, sobre o backend da 15a):
 *
 * - a fila "Executados aguardando autorização", agrupada por cliente, com a
 *   idade (dias desde o fim da execução) e o valor da RV validada;
 * - o filtro de idade (Todas, até 30 dias, de 31 a 60, mais de 60);
 * - a seleção (um cliente, um contrato e um tipo por autorização), a soma
 *   das RVs e a conferência com o valor do aceite;
 * - a entrada da callable recordAuthorization (registrar e cancelar);
 * - as autorizações registradas que ainda não viraram NF ("a faturar");
 * - os itens do Início (mais de 30 dias esperando e o prazo de perda).
 *
 * A idade e o prazo de perda são cópias das regras de
 * functions/comercial/src/domain/autorizacao.ts (as listas travadas em
 * autorizacoes.test.ts, com os mesmos casos). A tela lê pelo Firestore
 * (demands por canReadDemands, o resto por canReadPrices) e grava só pela
 * callable; o servidor confere de novo e recalcula todo valor.
 */

type Registro = Record<string, unknown>;

// --- Listas (travadas contra functions/comercial em autorizacoes.test.ts) ------------------

/** Faixas de idade da fila (autorizacao.ts, FAIXAS_DE_IDADE). */
export const FAIXAS_DE_IDADE = ["ate_30", "31_60", "mais_60"] as const;
export type FaixaDeIdade = (typeof FAIXAS_DE_IDADE)[number];

/** O filtro da fila: todas ou uma faixa, na ordem do mockup. */
export const FILTROS_DE_IDADE = ["todas", ...FAIXAS_DE_IDADE] as const;
export type FiltroDeIdade = (typeof FILTROS_DE_IDADE)[number];

export const ROTULO_DO_FILTRO: Record<FiltroDeIdade, string> = {
  todas: "Todas",
  ate_30: "Até 30 dias",
  "31_60": "31–60 dias",
  mais_60: "Mais de 60",
};

/** Avisos do prazo de perda, em dias que faltam (autorizacao.ts, AVISOS_ANTES_DA_PERDA). */
export const AVISOS_ANTES_DA_PERDA = [60, 30, 10] as const;

/** Etapas em que o prazo de perda corre (autorizacao.ts, ETAPAS_COM_PRAZO_DE_PERDA). */
export const ETAPAS_COM_PRAZO_DE_PERDA = ["aguardando_autorizacao", "a_faturar"] as const;

/** Tipos da autorização (events.ts, TIPOS_AUTORIZACAO_CLIENTE). */
export const TIPOS_AUTORIZACAO_CLIENTE = ["pedido_aceite", "medicao_aprovada", "portal", "outro"] as const;
export type TipoAutorizacaoCliente = (typeof TIPOS_AUTORIZACAO_CLIENTE)[number];

/** O que a autorização registrada pede para conferir (events.ts, MARCAS_AUTORIZACAO). */
export const MARCAS_AUTORIZACAO = ["valor_diverge", "tomador_outra_raiz", "rv_nao_validada"] as const;
export type MarcaAutorizacao = (typeof MARCAS_AUTORIZACAO)[number];

export const ROTULO_DA_MARCA: Record<MarcaAutorizacao, string> = {
  valor_diverge: "Valor diverge",
  tomador_outra_raiz: "Tomador de outra raiz",
  rv_nao_validada: "RV não validada",
};

/** Autorizações do contrato que fazem a demanda esperar (demanda.ts, AUTORIZACOES_QUE_ESPERAM). */
export const AUTORIZACOES_QUE_ESPERAM = ["pedido_aceite", "portal"] as const;

/**
 * O tipo que a tela registra: o que o contrato pedia na validação (pedido e
 * aceite, ou o pedido do portal do fornecedor), ou "outro registro" na
 * validação sem o tipo do contrato (o legado). A medição aprovada vem da
 * medição mensal (parte 16), nunca daqui.
 */
export type TipoDaFila = "pedido_aceite" | "portal" | "outro";

/** Acima disto a fila pinta os dias de vermelho e o Início avisa. */
export const DIAS_PARA_ATRASO = 30;

/** Etapas da validação que contam para a idade (demanda.ts, ETAPAS_DA_VALIDACAO). */
const ETAPAS_DA_VALIDACAO: readonly string[] = ["aguardando_autorizacao", "a_faturar"];

// --- Apoio --------------------------------------------------------------------------------

function texto(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function textoOuNull(value: unknown): string | null {
  return texto(value) || null;
}

function registroOuNull(value: unknown): Registro | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Registro) : null;
}

function umDe<T extends string>(lista: readonly T[], value: unknown, padrao: T): T {
  return typeof value === "string" && (lista as readonly string[]).includes(value) ? (value as T) : padrao;
}

function centavosOuNull(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** Sem acento e em minúsculas: a busca não diferencia "Itaú" de "itau". */
function semAcento(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function plural(quantidade: number, singular: string, pluralForma: string): string {
  return `${quantidade} ${quantidade === 1 ? singular : pluralForma}`;
}

/** "10045" na RV 0; "10045 – RV03" em diante, como o cliente cita no pedido e no aceite. */
export function rotuloDaRv(numero: string, rv: number | null): string {
  return rv === null || rv === 0 ? numero : `${numero} – RV${String(rv).padStart(2, "0")}`;
}

/** A chave do total de uma RV (quotes/{numero}/revisoes/{rv}). */
export function chaveDaRv(numero: string, rv: number): string {
  return `${numero}:${rv}`;
}

/** "12/08" no ano de hoje; "20/12/2025" em outro ano. */
function diaMes(data: string, hoje: string): string {
  const completa = dataBr(data);
  return data.slice(0, 4) === hoje.slice(0, 4) ? completa.slice(0, 5) : completa;
}

const DIA_EM_SAO_PAULO = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** O dia (AAAA-MM-DD) de um instante em São Paulo, como dataDeHoje em demanda.ts. */
function diaEmSaoPaulo(instante: string | null): string | null {
  if (!instante) return null;
  const valor = Date.parse(instante);
  return Number.isNaN(valor) ? null : DIA_EM_SAO_PAULO.format(new Date(valor));
}

// --- Leitura ------------------------------------------------------------------------------

export type ValidacaoDaDemanda = { rv: number; etapa: string; autorizacao: string | null; em: string | null };

/** A demanda (`demands/{numero}`) com o que a fila, o painel e o Início usam. Sem preço. */
export type DemandaDaFila = {
  numero: string;
  customerCode: string;
  /** O nome do cadastro quando a demanda nasceu (`customer_name`). */
  clienteNaDemanda: string | null;
  contratoId: string | null;
  etapa: string;
  titulo: string;
  refCliente: string | null;
  /** A empresa do contato que pediu (a gerenciadora). */
  gerenciadora: string | null;
  numeroLegado: string | null;
  executadoDe: string | null;
  executadoAte: string | null;
  /** A RV validada pelo cliente, a etapa a que levou, o tipo que o contrato pedia e quando. */
  validacao: ValidacaoDaDemanda | null;
  autorizacaoIds: string[];
};

/** Documento de `demands` como a tela usa. Sem cliente, fica fora. */
export function demandaDoRegistro(id: string, data: Registro): DemandaDaFila | null {
  const customerCode = texto(data.customer_code);
  if (!customerCode) return null;
  const validacao = registroOuNull(data.validacao);
  const rv = validacao?.rv;
  const validacaoLida =
    validacao && typeof rv === "number" && Number.isInteger(rv) && rv >= 0 && ETAPAS_DA_VALIDACAO.includes(texto(validacao.etapa))
      ? { rv, etapa: texto(validacao.etapa), autorizacao: textoOuNull(validacao.autorizacao), em: textoOuNull(validacao.em) }
      : null;
  const solicitante = registroOuNull(data.solicitante);
  const ids = Array.isArray(data.autorizacao_ids) ? data.autorizacao_ids : [];
  return {
    numero: texto(data.numero) || id,
    customerCode,
    clienteNaDemanda: textoOuNull(data.customer_name),
    contratoId: textoOuNull(data.contrato_id),
    etapa: texto(data.etapa),
    titulo: texto(data.titulo),
    refCliente: textoOuNull(data.ref_cliente),
    gerenciadora: solicitante ? textoOuNull(solicitante.empresa) : null,
    numeroLegado: textoOuNull(data.numero_legado),
    executadoDe: dataValida(data.executado_de) ? data.executado_de : null,
    executadoAte: dataValida(data.executado_ate) ? data.executado_ate : null,
    validacao: validacaoLida,
    autorizacaoIds: ids.filter((valor): valor is string => typeof valor === "string" && valor.length > 0),
  };
}

/**
 * Autorização de `client_authorizations/{id}`, como a tela usa. Um formato só
 * (functions/comercial, documentoDaAutorizacao): a registrada à mão (parte 15a)
 * e a da medição aprovada (parte 16a) têm `status` registrada ou cancelada,
 * `valor_cents` e `demanda_numeros`. A leitura aceita também o que a medição
 * gravava antes da unificação (a_faturar, demandas como números, total_cents).
 */
export type AutorizacaoRegistrada = {
  id: string;
  customerCode: string;
  contratoId: string | null;
  tipo: TipoAutorizacaoCliente;
  /** manual (recordAuthorization) ou medicao (a medição aprovada). */
  origem: "manual" | "medicao";
  pedido: string | null;
  aceite: string | null;
  recebidaEm: string | null;
  valorCents: number | null;
  /** Uma por demanda coberta; a da medição não cita a RV nem o valor da demanda. */
  demandas: Array<{ numero: string; rv: number | null; rotulo: string; valorCents: number | null }>;
  centroCusto: string | null;
  marcas: MarcaAutorizacao[];
  status: string;
  /** A medição de que a autorização veio (AAAA-MM), na medição aprovada. */
  competencia: string | null;
  medicaoId: string | null;
  registradaEm: string;
  /** Já usada no faturamento (NF, portal ou Omie, Fase 7): não está mais a faturar. */
  usada: boolean;
};

/**
 * As situações que a consulta das autorizadas lê: registrada e, nas medições aprovadas antes da
 * unificação, a_faturar (a mesma registrada, no formato antigo).
 */
export const SITUACOES_A_LER = ["registrada", "a_faturar"] as const;

/** A situação gravada: registrada ou cancelada; "a_faturar" é a medição aprovada do formato antigo (a registrada). */
function statusDoRegistro(value: unknown): string {
  return value === "a_faturar" ? "registrada" : texto(value);
}

export function autorizacaoDoRegistro(id: string, data: Registro): AutorizacaoRegistrada | null {
  const customerCode = texto(data.customer_code);
  if (!customerCode) return null;
  // Os números: demanda_numeros ou, no formato antigo da medição, `demandas` como lista de números.
  const citadas = (Array.isArray(data.demandas) ? data.demandas : []).map(registroOuNull).filter((item): item is Registro => item !== null);
  const numeros = Array.isArray(data.demanda_numeros)
    ? data.demanda_numeros
    : (Array.isArray(data.demandas) ? data.demandas : []).map((item) => (registroOuNull(item) ? registroOuNull(item)!.numero : item));
  const demandas = [...new Set(numeros.filter((numero): numero is string => typeof numero === "string" && numero.length > 0))].map((numero) => {
    const citada = citadas.find((item) => texto(item.numero) === numero);
    const rv = citada && typeof citada.rv === "number" && Number.isInteger(citada.rv) ? citada.rv : null;
    return {
      numero,
      rv,
      rotulo: citada && texto(citada.rotulo) ? texto(citada.rotulo) : rotuloDaRv(numero, rv),
      valorCents: citada ? centavosOuNull(citada.valor_cents) : null,
    };
  });
  const marcas = Array.isArray(data.marcas) ? MARCAS_AUTORIZACAO.filter((marca) => (data.marcas as unknown[]).includes(marca)) : [];
  // A registrada à mão grava o dia; a da medição, o instante da aprovação (o dia em São Paulo).
  const recebida = texto(data.recebida_em);
  const competencia = texto(data.competencia);
  return {
    id,
    customerCode,
    contratoId: textoOuNull(data.contrato_id),
    tipo: umDe(TIPOS_AUTORIZACAO_CLIENTE, data.tipo, "outro"),
    origem: data.origem === "medicao" || data.tipo === "medicao_aprovada" ? "medicao" : "manual",
    pedido: textoOuNull(data.pedido),
    aceite: textoOuNull(data.aceite),
    recebidaEm: dataValida(recebida) ? recebida : diaEmSaoPaulo(recebida),
    valorCents: centavosOuNull(data.valor_cents) ?? centavosOuNull(data.total_cents),
    demandas,
    centroCusto: textoOuNull(data.centro_custo),
    marcas,
    status: statusDoRegistro(data.status),
    competencia: /^\d{4}-\d{2}$/.test(competencia) ? competencia : null,
    medicaoId: textoOuNull(data.medicao_id),
    registradaEm: texto(data.registrada_em),
    usada: (Array.isArray(data.nf_ids) && data.nf_ids.length > 0) || Boolean(data.enviada_portal_em) || Boolean(data.omie_lancada_em),
  };
}

// --- Idade na fila (cópia de autorizacao.ts) ----------------------------------------------

type DemandaEsperando = Pick<DemandaDaFila, "executadoDe" | "executadoAte" | "validacao">;

export type InicioDaEspera = { data: string; desde: "execucao" | "validacao" };

/**
 * Desde quando o serviço espera o "pode faturar": o fim da execução (a data
 * que a fila mostra) ou a validação do cliente (o dia em São Paulo), o que
 * veio antes. A validação só conta sozinha na demanda sem o período
 * executado (o legado).
 */
export function inicioDaEspera(demanda: DemandaEsperando): InicioDaEspera | null {
  const execucao = dataValida(demanda.executadoAte) ? demanda.executadoAte : dataValida(demanda.executadoDe) ? demanda.executadoDe : null;
  const validacao = demanda.validacao ? diaEmSaoPaulo(demanda.validacao.em) : null;
  if (execucao && (!validacao || execucao <= validacao)) return { data: execucao, desde: "execucao" };
  if (validacao) return { data: validacao, desde: "validacao" };
  return null;
}

/** Dias inteiros de espera até `hoje`, nunca negativo; null sem data de início ou com hoje inválido. */
export function diasEsperando(demanda: DemandaEsperando, hoje: string): number | null {
  const inicio = inicioDaEspera(demanda);
  if (!inicio || !dataValida(hoje)) return null;
  return Math.max(0, diasEntre(inicio.data, hoje));
}

export function faixaDeIdade(dias: number): FaixaDeIdade {
  if (dias <= 30) return "ate_30";
  if (dias <= 60) return "31_60";
  return "mais_60";
}

// --- Prazo de perda (cópia de autorizacao.ts) ---------------------------------------------

export type AlertaDePrazoDePerda = {
  prazo_dias: number;
  dias: number;
  marco: number;
  restantes: number;
  limite: string;
  vencido: boolean;
  desde: InicioDaEspera["desde"];
};

/** Os avisos de um prazo, em dias de espera: 90 → [30, 60, 80]. */
export function marcosDoPrazoDePerda(prazo: number): number[] {
  return [...new Set(AVISOS_ANTES_DA_PERDA.map((faltam) => Math.max(0, prazo - faltam)))].sort((a, b) => a - b);
}

/**
 * O alerta do prazo de perda (`autorizacao.prazo_perda_dias` do contrato) em
 * `hoje`, ou null: só aguardando autorização ou a faturar, a partir do
 * primeiro aviso, e depois do fim, vencido. Conta do fim da execução
 * (pergunta 9 do desenho: a data do pedido do portal espera o Leonardo).
 */
export function alertaDePrazoDePerda(
  prazo: number | null | undefined,
  demanda: DemandaEsperando & Pick<DemandaDaFila, "etapa">,
  hoje: string,
): AlertaDePrazoDePerda | null {
  if (typeof prazo !== "number" || !Number.isInteger(prazo) || prazo <= 0) return null;
  if (!(ETAPAS_COM_PRAZO_DE_PERDA as readonly string[]).includes(demanda.etapa)) return null;
  const inicio = inicioDaEspera(demanda);
  const dias = diasEsperando(demanda, hoje);
  if (!inicio || dias === null) return null;
  const alcancados = marcosDoPrazoDePerda(prazo).filter((marco) => dias >= marco);
  if (!alcancados.length) return null;
  return {
    prazo_dias: prazo,
    dias,
    marco: alcancados[alcancados.length - 1],
    restantes: prazo - dias,
    limite: somarDias(inicio.data, prazo),
    vencido: dias > prazo,
    desde: inicio.desde,
  };
}

// --- Fila de executados -------------------------------------------------------------------

export type LinhaDaFila = {
  numero: string;
  /** A RV validada, a que a autorização cita. */
  rv: number | null;
  rotulo: string;
  legado: string | null;
  titulo: string;
  /** Referência do cliente · gerenciadora · executada 06/10. */
  detalhe: string;
  dias: number | null;
  faixa: FaixaDeIdade | null;
  /** Mais de 30 dias esperando: o badge fica vermelho. */
  atrasada: boolean;
  /** O total da RV validada como foi enviada; null enquanto não foi lido. */
  valorCents: number | null;
  customerCode: string;
  cliente: string;
  contratoId: string | null;
  tipo: TipoDaFila;
  /** Texto da busca, sem acento e em minúsculas. */
  busca: string;
};

function nomeDaDemanda(demanda: Pick<DemandaDaFila, "customerCode" | "clienteNaDemanda">, nomes: ReadonlyMap<string, string>): string {
  return nomes.get(demanda.customerCode) ?? demanda.clienteNaDemanda ?? demanda.customerCode;
}

function tipoDaDemanda(demanda: Pick<DemandaDaFila, "validacao">): TipoDaFila {
  return umDe<TipoDaFila>(AUTORIZACOES_QUE_ESPERAM, demanda.validacao?.autorizacao, "outro");
}

function porIdade(a: { dias: number | null; numero: string }, b: { dias: number | null; numero: string }): number {
  return (b.dias ?? -1) - (a.dias ?? -1) || a.numero.localeCompare(b.numero);
}

/**
 * A fila: as demandas que aguardam a autorização, cada uma com a RV
 * validada, a idade e o valor (`valores`, pela chaveDaRv). O mais antigo
 * primeiro.
 */
export function linhasDaFila(
  demandas: readonly DemandaDaFila[],
  contexto: { nomes: ReadonlyMap<string, string>; valores: ReadonlyMap<string, number>; hoje: string },
): LinhaDaFila[] {
  const { nomes, valores, hoje } = contexto;
  return demandas
    .filter((demanda) => demanda.etapa === "aguardando_autorizacao")
    .map((demanda) => {
      const rv = demanda.validacao?.rv ?? null;
      const rotulo = rotuloDaRv(demanda.numero, rv);
      const inicio = inicioDaEspera(demanda);
      const dias = diasEsperando(demanda, hoje);
      const cliente = nomeDaDemanda(demanda, nomes);
      const legado = demanda.numeroLegado ? `nº legado ${demanda.numeroLegado}` : null;
      const quando = inicio ? `${inicio.desde === "execucao" ? "executada" : "validada"} ${diaMes(inicio.data, hoje)}` : null;
      const detalhe = [demanda.refCliente, demanda.gerenciadora, quando].filter(Boolean).join(" · ");
      return {
        numero: demanda.numero,
        rv,
        rotulo,
        legado,
        titulo: demanda.titulo,
        detalhe,
        dias,
        faixa: dias === null ? null : faixaDeIdade(dias),
        atrasada: dias !== null && dias > DIAS_PARA_ATRASO,
        valorCents: rv === null ? null : (valores.get(chaveDaRv(demanda.numero, rv)) ?? null),
        customerCode: demanda.customerCode,
        cliente,
        contratoId: demanda.contratoId,
        tipo: tipoDaDemanda(demanda),
        busca: semAcento(
          [demanda.numero, rotulo, demanda.numeroLegado, demanda.titulo, demanda.refCliente, demanda.gerenciadora, cliente, demanda.customerCode]
            .filter(Boolean)
            .join(" "),
        ),
      };
    })
    .sort(porIdade);
}

function naBusca(linhas: readonly LinhaDaFila[], busca: string): LinhaDaFila[] {
  const termo = semAcento(busca.trim());
  return termo ? linhas.filter((linha) => linha.busca.includes(termo)) : [...linhas];
}

function noFiltro(linha: LinhaDaFila, filtro: FiltroDeIdade): boolean {
  return filtro === "todas" || linha.faixa === filtro;
}

/** Quantas linhas cada filtro mostra (com a busca aplicada). */
export function contarPorFaixa(linhas: readonly LinhaDaFila[], busca = ""): Record<FiltroDeIdade, number> {
  const achadas = naBusca(linhas, busca);
  return Object.fromEntries(FILTROS_DE_IDADE.map((filtro) => [filtro, achadas.filter((linha) => noFiltro(linha, filtro)).length])) as Record<
    FiltroDeIdade,
    number
  >;
}

/** A soma dos valores em centavos; null se algum ainda não foi lido. */
export function somaDasLinhas(linhas: readonly Pick<LinhaDaFila, "valorCents">[]): number | null {
  if (linhas.some((linha) => linha.valorCents === null)) return null;
  return somarCentavos(linhas.map((linha) => linha.valorCents as number));
}

export type GrupoDaFila = { customerCode: string; cliente: string; linhas: LinhaDaFila[]; totalCents: number | null };

/**
 * A fila agrupada por cliente, com o filtro de idade e a busca: o grupo com o
 * executado mais antigo primeiro, e dentro dele o mais antigo primeiro. O
 * total é o das linhas mostradas.
 */
export function gruposDaFila(linhas: readonly LinhaDaFila[], filtro: FiltroDeIdade, busca = ""): GrupoDaFila[] {
  const grupos = new Map<string, LinhaDaFila[]>();
  for (const linha of naBusca(linhas, busca).filter((item) => noFiltro(item, filtro))) {
    grupos.set(linha.customerCode, [...(grupos.get(linha.customerCode) ?? []), linha]);
  }
  return Array.from(grupos.entries())
    .map(([customerCode, doGrupo]) => {
      const ordenadas = [...doGrupo].sort(porIdade);
      return { customerCode, cliente: ordenadas[0].cliente, linhas: ordenadas, totalCents: somaDasLinhas(ordenadas) };
    })
    .sort(
      (a, b) =>
        (b.linhas[0].dias ?? -1) - (a.linhas[0].dias ?? -1) ||
        a.cliente.localeCompare(b.cliente, "pt-BR", { sensitivity: "base" }) ||
        a.customerCode.localeCompare(b.customerCode),
    );
}

// --- Seleção ------------------------------------------------------------------------------

/**
 * A linha cabe na autorização que está sendo montada: sem nada marcado,
 * qualquer uma; depois, só do mesmo cliente, do mesmo contrato e do mesmo
 * tipo (a callable recusa demandas de contratos diferentes).
 */
export function podeMarcar(linha: LinhaDaFila, marcadas: readonly LinhaDaFila[]): boolean {
  const base = marcadas[0];
  if (!base) return true;
  return linha.customerCode === base.customerCode && linha.contratoId === base.contratoId && linha.tipo === base.tipo;
}

/** As marcadas na ordem da fila; a que saiu da fila (já autorizada por outra pessoa) sai junto. */
export function linhasMarcadas(linhas: readonly LinhaDaFila[], marcadas: readonly string[]): LinhaDaFila[] {
  return linhas.filter((linha) => marcadas.includes(linha.numero));
}

/** Marca ou desmarca; a que não cabe na autorização é ignorada. */
export function alternarMarcacao(marcadas: readonly string[], linha: LinhaDaFila, linhas: readonly LinhaDaFila[]): string[] {
  if (marcadas.includes(linha.numero)) return marcadas.filter((numero) => numero !== linha.numero);
  return podeMarcar(linha, linhasMarcadas(linhas, marcadas)) ? [...marcadas, linha.numero] : [...marcadas];
}

/** O tipo da autorização das marcadas (todas do mesmo contrato); sem nada marcado, pedido e aceite. */
export function tipoDasLinhas(linhas: readonly Pick<LinhaDaFila, "tipo">[]): TipoDaFila {
  return linhas[0]?.tipo ?? "pedido_aceite";
}

export type RotulosDoTipo = { pedido: string; aceite: string | null; valor: string };

/** Os rótulos do painel pelo tipo: o portal não tem aceite. */
export function rotulosDoTipo(tipo: TipoDaFila): RotulosDoTipo {
  if (tipo === "portal") return { pedido: "Pedido do portal", aceite: null, valor: "Valor do pedido (R$)" };
  if (tipo === "outro") return { pedido: "Pedido", aceite: "Aceite", valor: "Valor autorizado (R$)" };
  return { pedido: "Pedido", aceite: "Aceite", valor: "Valor do aceite (R$)" };
}

// --- Valor e conferência ------------------------------------------------------------------

/**
 * O valor como a pessoa digita ("20.748,80", "R$ 20.748,8", "20748.80",
 * "1.234") em decimal com ponto e até 2 casas, o formato da callable. Com
 * vírgula, ela é a decimal e os pontos são milhar; sem vírgula, "1.234" é
 * milhar e "38.50" é decimal. Negativo ou fora disso: null.
 */
export function valorDaTela(valor: string): string | null {
  const bruto = String(valor ?? "")
    .replace(/R\$/gi, "")
    .replace(/[\s ]/g, "");
  if (!bruto) return null;
  let inteiro: string;
  let fracao = "";
  if (bruto.includes(",")) {
    const partes = bruto.split(",");
    if (partes.length !== 2) return null;
    if (!/^(?:\d{1,3}(?:\.\d{3})+|\d+)$/.test(partes[0]) || !/^\d{1,2}$/.test(partes[1])) return null;
    inteiro = partes[0].replace(/\./g, "");
    fracao = partes[1];
  } else if (/^\d{1,3}(?:\.\d{3})+$/.test(bruto)) {
    inteiro = bruto.replace(/\./g, "");
  } else {
    const partes = /^(\d+)(?:\.(\d{1,2}))?$/.exec(bruto);
    if (!partes) return null;
    inteiro = partes[1];
    fracao = partes[2] ?? "";
  }
  inteiro = inteiro.replace(/^0+(?=\d)/, "");
  if (inteiro.length > 13) return null;
  return fracao ? `${inteiro}.${fracao}` : inteiro;
}

function centavosDaTela(valor: string): number | null {
  const decimal = valorDaTela(valor);
  return decimal === null ? null : centavosDaLinha("1", decimal);
}

export type Conferencia = { tom: "ok" | "diverge"; texto: string };

/**
 * O valor do aceite contra a soma das RVs marcadas: igual, "Valor confere"
 * (verde); diferente, "Diverge em" a diferença (âmbar). A divergência não
 * impede o registro: o servidor grava a marca valor_diverge.
 */
export function conferenciaDoValor(valor: string, somaCents: number | null): Conferencia | null {
  if (somaCents === null || somaCents <= 0) return null;
  const centavos = centavosDaTela(valor);
  if (centavos === null) return null;
  const diferenca = centavos - somaCents;
  if (diferenca === 0) return { tom: "ok", texto: "Valor confere com a soma das RVs" };
  return { tom: "diverge", texto: `Diverge em ${formatarReais(Math.abs(diferenca))}` };
}

// --- Painel e entrada da callable ---------------------------------------------------------

export type ContratoDoPainel = { vigencia: string; codigoServico: string };

/** O contrato das marcadas no painel: até quando vale e o código de serviço padrão. */
export function contratoDoPainel(contrato: Contrato | null): ContratoDoPainel {
  if (!contrato) return { vigencia: "Sem contrato", codigoServico: "" };
  const fim = contrato.dados.vigente_ate;
  return {
    vigencia: fim ? `Contrato até ${dataBr(fim)}` : "Contrato sem prazo",
    codigoServico: contrato.dados.codigo_servico ?? "",
  };
}

export type FormAutorizacao = {
  pedido: string;
  aceite: string;
  /** AAAA-MM-DD (o campo de data do navegador). */
  recebidaEm: string;
  valor: string;
  tomador: string;
  centroCusto: string;
  /** null: o do contrato (a callable usa o dele quando não vem). */
  codigoServico: string | null;
  escopo: string;
  documentoNome: string;
  documentoReferencia: string;
};

export function formNovaAutorizacao(hoje: string): FormAutorizacao {
  return {
    pedido: "",
    aceite: "",
    recebidaEm: hoje,
    valor: "",
    tomador: "",
    centroCusto: "",
    codigoServico: null,
    escopo: "",
    documentoNome: "",
    documentoReferencia: "",
  };
}

/** Pedido e aceite como o cliente escreve (a regra da callable). */
const NUMERO_DO_CLIENTE = /^[A-Za-z0-9][A-Za-z0-9 ./_-]{0,59}$/;

/**
 * Entrada de recordAuthorization (record) para as demandas marcadas, com as
 * regras da callable (o servidor confere de novo): o tipo é o que o contrato
 * pedia na validação, cada demanda vai com a RV validada (a que a fila
 * mostra), o valor vai em decimal com ponto e o código de serviço só quando
 * a pessoa mudou o do contrato.
 */
export function payloadRegistrar(
  form: FormAutorizacao,
  linhas: readonly LinhaDaFila[],
  chave: string,
  hoje: string,
): Conferido<Registro> {
  const falha = (problema: string): Conferido<Registro> => ({ ok: false, problema });
  if (!linhas.length) return falha("Marque ao menos uma demanda.");
  const tipo = tipoDasLinhas(linhas);
  const pedido = form.pedido.trim() || null;
  const aceite = tipo === "portal" ? null : form.aceite.trim() || null;
  if (tipo === "pedido_aceite" && !pedido) return falha("Informe o pedido.");
  if (tipo === "pedido_aceite" && !aceite) return falha("Informe o aceite.");
  if (tipo === "portal" && !pedido) return falha("Informe o pedido do portal.");
  if (pedido && !NUMERO_DO_CLIENTE.test(pedido)) return falha("Pedido: letras, números, espaço, ponto, barra e hífen.");
  if (aceite && !NUMERO_DO_CLIENTE.test(aceite)) return falha("Aceite: letras, números, espaço, ponto, barra e hífen.");

  const recebida = form.recebidaEm.trim();
  if (!recebida) return falha("Informe quando a autorização chegou.");
  if (!dataValida(recebida)) return falha("Recebida em: data inválida.");
  if (recebida > hoje) return falha("Recebida em não pode ser depois de hoje.");

  const valor = valorDaTela(form.valor);
  if (valor === null) return falha("Informe o valor em reais (ex.: 20.748,80).");
  if (centavosDaLinha("1", valor) <= 0) return falha("O valor precisa ser maior que zero.");

  const tomador = form.tomador.trim() || null;
  if (tomador && tomador.length > 30) return falha("Tomador: informe o CNPJ (até 30 caracteres com a máscara).");
  const codigo = form.codigoServico?.trim() || null;
  if (codigo && !/^\d{3,5}$/.test(codigo)) return falha("Código de serviço: 3 a 5 algarismos (ex.: 1602).");
  const centroCusto = form.centroCusto.trim() || null;
  if (centroCusto && centroCusto.length > 60) return falha("Centro de custo: até 60 caracteres.");
  const escopo = form.escopo.trim() || null;
  if (escopo && escopo.length > 300) return falha("Escopo: até 300 caracteres.");

  const nome = form.documentoNome.trim();
  const referencia = form.documentoReferencia.trim();
  if (Boolean(nome) !== Boolean(referencia)) return falha("Documento: informe o nome e onde está.");
  if (nome.length > 200 || referencia.length > 500) return falha("Documento: nome até 200 caracteres e local até 500.");
  const documento = nome ? { nome, referencia } : null;
  if (!pedido && !documento) return falha("Registre a prova: o pedido ou o documento.");

  return {
    ok: true,
    valor: {
      action: "record",
      request_id: chave,
      customer_code: linhas[0].customerCode,
      tipo,
      pedido,
      aceite,
      recebida_em: recebida,
      valor,
      demandas: linhas.map((linha) => (linha.rv === null ? { numero: linha.numero } : { numero: linha.numero, rv: linha.rv })),
      tomador_documento: tomador,
      codigo_servico: codigo,
      centro_custo: centroCusto,
      escopo,
      documento,
    },
  };
}

/** Entrada de recordAuthorization (cancel): a autorização registrada por engano, com o motivo. */
export function payloadCancelar(autorizacaoId: string, motivo: string, chave: string): Conferido<Registro> {
  const limpo = motivo.trim();
  if (limpo.length < 3) return { ok: false, problema: "Diga por que a autorização é cancelada." };
  if (limpo.length > 500) return { ok: false, problema: "Motivo: até 500 caracteres." };
  return { ok: true, valor: { action: "cancel", request_id: chave, autorizacao_id: autorizacaoId, motivo: limpo } };
}

/** A confirmação no painel depois do registro. */
export function textoDoRegistro(registro: { pedido: string | null; demandas: number; valorCents: number }): string {
  const inicio = registro.pedido ? `Pedido ${registro.pedido} registrado` : "Autorização registrada";
  return `${inicio} · ${plural(registro.demandas, "demanda", "demandas")} · ${formatarReais(registro.valorCents)}`;
}

// --- Autorizadas, a faturar ---------------------------------------------------------------

export type LinhaAutorizada = {
  id: string;
  pedido: string;
  sub: string;
  cliente: string;
  demandas: string[];
  marcas: string[];
  /** Centro de custo e, no contrato com prazo de perda, até quando faturar. */
  info: string;
  valorCents: number | null;
  quando: string;
  /** A da medição aprovada: cancelar não reabre a medição. */
  daMedicao: boolean;
};

/** "2026-10" → "10/2026". */
function competenciaBr(competencia: string): string {
  return `${competencia.slice(5)}/${competencia.slice(0, 4)}`;
}

function subDaAutorizacao(autorizacao: AutorizacaoRegistrada): string {
  switch (autorizacao.tipo) {
    case "pedido_aceite":
      return autorizacao.aceite ? `Aceite ${autorizacao.aceite}` : "Pedido e aceite";
    case "portal":
      return "Portal do fornecedor";
    case "medicao_aprovada":
      return "Medição aprovada";
    default:
      return "Outro registro";
  }
}

/**
 * Até quando faturar as demandas da autorização, no contrato com prazo de
 * perda: o limite mais próximo entre elas (contado do fim da execução, como o
 * alerta). Sem prazo, ou sem as demandas lidas, null.
 */
function limiteDaAutorizacao(
  autorizacao: AutorizacaoRegistrada,
  demandas: readonly DemandaDaFila[],
  contratos: readonly Contrato[],
): string | null {
  const prazo = contratos.find((contrato) => contrato.id === autorizacao.contratoId)?.dados.autorizacao.prazo_perda_dias;
  if (typeof prazo !== "number" || prazo <= 0) return null;
  const limites = autorizacao.demandas
    .map((citada) => demandas.find((demanda) => demanda.numero === citada.numero))
    .map((demanda) => (demanda ? inicioDaEspera(demanda) : null))
    .filter((inicio): inicio is InicioDaEspera => inicio !== null)
    .map((inicio) => somarDias(inicio.data, prazo))
    .sort();
  return limites[0] ?? null;
}

/**
 * As autorizações registradas que ainda não foram usadas no faturamento (a
 * Fase 7 marca a NF, o portal e a Omie), a mais recente primeiro, com a busca
 * pelo pedido, pelo aceite, pela demanda e pelo cliente.
 */
export function autorizadasAFaturar(
  autorizacoes: readonly AutorizacaoRegistrada[],
  contexto: {
    nomes: ReadonlyMap<string, string>;
    demandas: readonly DemandaDaFila[];
    contratos: readonly Contrato[];
    hoje: string;
    busca?: string;
  },
): LinhaAutorizada[] {
  const termo = semAcento((contexto.busca ?? "").trim());
  return autorizacoes
    .filter((autorizacao) => autorizacao.status === "registrada" && !autorizacao.usada)
    .sort(
      (a, b) =>
        (b.recebidaEm ?? "").localeCompare(a.recebidaEm ?? "") || b.registradaEm.localeCompare(a.registradaEm) || a.id.localeCompare(b.id),
    )
    .map((autorizacao) => {
      const cliente = contexto.nomes.get(autorizacao.customerCode) ?? autorizacao.customerCode;
      const limite = limiteDaAutorizacao(autorizacao, contexto.demandas, contexto.contratos);
      const linha: LinhaAutorizada = {
        id: autorizacao.id,
        pedido: autorizacao.pedido ?? (autorizacao.competencia ? `Medição ${competenciaBr(autorizacao.competencia)}` : "Sem pedido"),
        sub: subDaAutorizacao(autorizacao),
        cliente,
        demandas: autorizacao.demandas.map((demanda) => demanda.rotulo),
        marcas: autorizacao.marcas.map((marca) => ROTULO_DA_MARCA[marca]),
        info: [autorizacao.centroCusto ? `CC ${autorizacao.centroCusto}` : null, limite ? `faturar até ${dataBr(limite)}` : null]
          .filter(Boolean)
          .join(" · "),
        valorCents: autorizacao.valorCents,
        quando: autorizacao.recebidaEm ? `autorizada ${diaMes(autorizacao.recebidaEm, contexto.hoje)}` : "",
        daMedicao: autorizacao.origem === "medicao",
      };
      const busca = semAcento(
        [
          autorizacao.pedido,
          autorizacao.aceite,
          autorizacao.competencia ? `Medição ${competenciaBr(autorizacao.competencia)}` : null,
          cliente,
          autorizacao.customerCode,
          autorizacao.centroCusto,
          ...autorizacao.demandas.flatMap((demanda) => [demanda.numero, demanda.rotulo]),
        ]
          .filter(Boolean)
          .join(" "),
      );
      return { linha, busca };
    })
    .filter(({ busca }) => !termo || busca.includes(termo))
    .map(({ linha }) => linha);
}

export function totalDasAutorizadas(linhas: readonly LinhaAutorizada[]): number {
  return somarCentavos(linhas.map((linha) => linha.valorCents).filter((valor): valor is number => valor !== null));
}

// --- Início -------------------------------------------------------------------------------

export type EsperandoNoInicio = { numero: string; rotulo: string; cliente: string; dias: number };

export type PrazoNoInicio = {
  numero: string;
  rotulo: string;
  cliente: string;
  /** O último dia para faturar (AAAA-MM-DD). */
  limite: string;
  restantes: number;
  vencido: boolean;
  /** Vencido ou no último aviso (10 dias antes do fim). */
  critico: boolean;
};

export type PendenciasDoInicio = { esperandoMaisDe30: EsperandoNoInicio[]; prazos: PrazoNoInicio[] };

/**
 * O que o Início mostra das autorizações: os executados que esperam a
 * autorização há mais de 30 dias (o mais antigo primeiro) e o prazo de perda
 * de cada demanda de contrato com prazo, aguardando ou a faturar (o mais
 * próximo primeiro).
 */
export function autorizacoesParaOInicio(
  demandas: readonly DemandaDaFila[],
  contratos: readonly Contrato[],
  nomes: ReadonlyMap<string, string>,
  hoje: string,
): PendenciasDoInicio {
  const esperandoMaisDe30 = demandas
    .filter((demanda) => demanda.etapa === "aguardando_autorizacao")
    .map((demanda) => ({
      numero: demanda.numero,
      rotulo: rotuloDaRv(demanda.numero, demanda.validacao?.rv ?? null),
      cliente: nomeDaDemanda(demanda, nomes),
      dias: diasEsperando(demanda, hoje),
    }))
    .filter((item): item is EsperandoNoInicio => item.dias !== null && item.dias > DIAS_PARA_ATRASO)
    .sort(porIdade);

  const prazos = demandas
    .flatMap((demanda) => {
      const prazo = contratos.find((contrato) => contrato.id === demanda.contratoId)?.dados.autorizacao.prazo_perda_dias;
      const alerta = alertaDePrazoDePerda(prazo, demanda, hoje);
      if (!alerta) return [];
      const ultimo = marcosDoPrazoDePerda(alerta.prazo_dias).at(-1);
      return [
        {
          numero: demanda.numero,
          rotulo: rotuloDaRv(demanda.numero, demanda.validacao?.rv ?? null),
          cliente: nomeDaDemanda(demanda, nomes),
          limite: alerta.limite,
          restantes: alerta.restantes,
          vencido: alerta.vencido,
          critico: alerta.vencido || alerta.marco === ultimo,
        },
      ];
    })
    .sort((a, b) => a.limite.localeCompare(b.limite) || a.numero.localeCompare(b.numero));

  return { esperandoMaisDe30, prazos };
}

// --- Perda por prazo de faturamento (Fase 7, parte 7.5b) ------------------------------------

export type LinhaDoPrazoVencido = {
  numero: string;
  /** A RV validada: a ação confere a etapa e a RV que a tela viu. */
  rv: number;
  etapa: (typeof ETAPAS_COM_PRAZO_DE_PERDA)[number];
  rotulo: string;
  titulo: string;
  cliente: string;
  /** O último dia do prazo (AAAA-MM-DD). */
  limite: string;
};

/**
 * As demandas com o prazo de perda do contrato vencido, aguardando a
 * autorização ou a faturar: a que venceu antes primeiro. Só elas se perdem
 * por prazo de faturamento (problemaDaPerda em functions/comercial).
 */
export function prazosVencidos(
  demandas: readonly DemandaDaFila[],
  contratos: readonly Contrato[],
  nomes: ReadonlyMap<string, string>,
  hoje: string,
): LinhaDoPrazoVencido[] {
  return demandas
    .flatMap((demanda) => {
      const prazo = contratos.find((contrato) => contrato.id === demanda.contratoId)?.dados.autorizacao.prazo_perda_dias;
      const alerta = alertaDePrazoDePerda(prazo, demanda, hoje);
      if (!alerta?.vencido || !demanda.validacao) return [];
      return [
        {
          numero: demanda.numero,
          rv: demanda.validacao.rv,
          etapa: demanda.etapa as LinhaDoPrazoVencido["etapa"],
          rotulo: rotuloDaRv(demanda.numero, demanda.validacao.rv),
          titulo: demanda.titulo,
          cliente: nomeDaDemanda(demanda, nomes),
          limite: alerta.limite,
        },
      ];
    })
    .sort((a, b) => a.limite.localeCompare(b.limite) || a.numero.localeCompare(b.numero));
}

/** O pedido para advanceDemand: perder pelo prazo de faturamento, com a etapa e a RV que a tela viu. */
export function payloadPerderPorPrazo(linha: LinhaDoPrazoVencido, nota: string, chave: string): Registro {
  const texto = nota.trim();
  return {
    action: "lose",
    request_id: chave,
    numero: linha.numero,
    expected_etapa: linha.etapa,
    expected_rv: linha.rv,
    motivo: "prazo_faturamento",
    ...(texto ? { nota: texto.slice(0, 1000) } : {}),
  };
}

export const ROTULO_DA_ETAPA_COM_PRAZO: Record<LinhaDoPrazoVencido["etapa"], string> = {
  aguardando_autorizacao: "Aguardando autorização",
  a_faturar: "A faturar",
};