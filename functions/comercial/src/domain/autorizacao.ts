import { dataValida, diasEntre, somarDias } from "./contratos-datas.js";
import { cnpjRoot } from "./customer-identity.js";
import {
  autorizacoesDaDemanda,
  dataDeHoje,
  rotuloDaEtapa,
  validacaoDaDemanda,
  type EstadoDaDemanda,
  type EtapaDemanda,
} from "./demanda.js";
import { somarCentavos } from "./dinheiro.js";
import { MARCAS_AUTORIZACAO, TIPOS_AUTORIZACAO_CLIENTE } from "./events.js";

/**
 * Autorização de faturamento do cliente, no domínio (docs/plataforma/
 * fase-6-comercial.md, "Autorização de faturamento"; parte 15). Só regras
 * puras: a callable fica em autorizacoes.ts.
 *
 * - `client_authorizations/{id}` é o "pode faturar" do cliente: pedido e
 *   aceite (o Itaú), medição aprovada, portal ou outro registro. Cobre uma ou
 *   várias demandas do mesmo cliente, e uma demanda pode ter mais de uma
 *   (o complemento).
 * - A autorização leva a demanda de "aguardando autorização" a "a faturar"
 *   (a demanda guarda os ids em `autorizacao_ids`; etapaDaDemanda em
 *   demanda.ts); cancelada a última, a demanda volta a aguardar.
 * - Divergência não impede o registro: vira marca para conferir (o valor
 *   diferente da soma das RVs citadas, o tomador de outra raiz de CNPJ, a RV
 *   diferente da validada).
 * - A fila mostra há quantos dias o serviço espera o dinheiro, e o contrato
 *   com prazo de perda (autorizacao.prazo_perda_dias) avisa antes de perder.
 */

export { MARCAS_AUTORIZACAO, TIPOS_AUTORIZACAO_CLIENTE };

export type TipoAutorizacaoCliente = (typeof TIPOS_AUTORIZACAO_CLIENTE)[number];
export type MarcaAutorizacao = (typeof MARCAS_AUTORIZACAO)[number];

export const CLIENT_AUTHORIZATIONS_COLLECTION = "client_authorizations";
export const AUTHORIZATION_SCHEMA_VERSION = 1;

export const STATUS_AUTORIZACAO = ["registrada", "cancelada"] as const;
export type StatusAutorizacao = (typeof STATUS_AUTORIZACAO)[number];

/** Faixas de idade da fila de executados (ComAutorizacoes): até 30 dias, de 31 a 60, mais de 60. */
export const FAIXAS_DE_IDADE = ["ate_30", "31_60", "mais_60"] as const;
export type FaixaDeIdade = (typeof FAIXAS_DE_IDADE)[number];

/**
 * Avisos do prazo de perda, em dias que faltam: no prazo de 90 dias, avisa
 * aos 30, aos 60 e aos 80 dias de espera.
 */
export const AVISOS_ANTES_DA_PERDA = [60, 30, 10] as const;

/** Etapas em que o serviço ainda não virou NF: o prazo de perda corre nelas. */
export const ETAPAS_COM_PRAZO_DE_PERDA = ["aguardando_autorizacao", "a_faturar"] as const satisfies readonly EtapaDemanda[];

// --- Idade na fila -----------------------------------------------------------------------

/** A demanda com o que a idade usa: o período executado e a validação (com o instante). */
export type DemandaEsperando = Pick<EstadoDaDemanda, "validacao"> & { executado_de?: unknown; executado_ate?: unknown };

export type InicioDaEspera = { data: string; desde: "execucao" | "validacao" };

/** O dia (São Paulo) em que o cliente validou, a partir do instante gravado em `validacao.em`. */
function diaDaValidacao(demanda: DemandaEsperando): string | null {
  if (!validacaoDaDemanda(demanda)) return null;
  const em = (demanda.validacao as { em?: unknown }).em;
  if (typeof em !== "string" || Number.isNaN(Date.parse(em))) return null;
  return dataDeHoje(new Date(em));
}

/**
 * Desde quando o serviço espera o "pode faturar": o fim da execução (é a data
 * que a fila mostra, "executada 06/10") ou a validação do cliente, o que veio
 * antes. A execução sempre vem antes da validação; a validação só conta
 * sozinha na demanda sem o período executado (o legado). Sem nenhuma das
 * duas, null.
 */
export function inicioDaEspera(demanda: DemandaEsperando): InicioDaEspera | null {
  const execucao = dataValida(demanda.executado_ate) ? demanda.executado_ate : dataValida(demanda.executado_de) ? demanda.executado_de : null;
  const validacao = diaDaValidacao(demanda);
  if (execucao && (!validacao || execucao <= validacao)) return { data: execucao, desde: "execucao" };
  if (validacao) return { data: validacao, desde: "validacao" };
  return null;
}

/** Dias inteiros de espera até `hoje` (AAAA-MM-DD, São Paulo), nunca negativo; null sem data de início. */
export function diasEsperandoAutorizacao(demanda: DemandaEsperando, hoje: string): number | null {
  const inicio = inicioDaEspera(demanda);
  if (!inicio || !dataValida(hoje)) return null;
  return Math.max(0, diasEntre(inicio.data, hoje));
}

/** A faixa de idade da fila: até 30 dias, de 31 a 60, mais de 60. */
export function faixaDeIdade(dias: number): FaixaDeIdade {
  if (dias <= 30) return "ate_30";
  if (dias <= 60) return "31_60";
  return "mais_60";
}

// --- Prazo de perda ------------------------------------------------------------------------

/** O contrato com o que o alerta usa: `autorizacao.prazo_perda_dias` (parte 8). */
export type ContratoComPrazoDePerda = { autorizacao?: { prazo_perda_dias?: unknown } | null } | null | undefined;

export type AlertaDePrazoDePerda = {
  prazo_dias: number;
  /** Dias de espera hoje. */
  dias: number;
  /** O aviso alcançado, em dias de espera (30, 60 ou 80 no prazo de 90). */
  marco: number;
  /** Dias até o fim do prazo (0 no último dia; negativo depois dele). */
  restantes: number;
  /** O último dia do prazo (AAAA-MM-DD). */
  limite: string;
  /** Passou do último dia. */
  vencido: boolean;
  desde: InicioDaEspera["desde"];
};

/** Os avisos de um prazo, em dias de espera, do primeiro ao último: 90 → [30, 60, 80]. */
export function marcosDoPrazoDePerda(prazo: number): number[] {
  return [...new Set(AVISOS_ANTES_DA_PERDA.map((faltam) => Math.max(0, prazo - faltam)))].sort((a, b) => a - b);
}

/**
 * O alerta do prazo de perda da demanda em `hoje`, ou null. Só no contrato com
 * `autorizacao.prazo_perda_dias` e na demanda que ainda não virou NF
 * (aguardando autorização ou a faturar): avisa a partir do primeiro marco
 * (30 dias no prazo de 90), sobe aos 60 e aos 80, e continua depois do fim,
 * vencido, até a demanda sair dessas etapas.
 */
export function alertaDePrazoDePerda(
  contrato: ContratoComPrazoDePerda,
  demanda: DemandaEsperando & { etapa: unknown },
  hoje: string,
): AlertaDePrazoDePerda | null {
  const prazo = contrato?.autorizacao?.prazo_perda_dias;
  if (typeof prazo !== "number" || !Number.isInteger(prazo) || prazo <= 0) return null;
  if (!(ETAPAS_COM_PRAZO_DE_PERDA as readonly unknown[]).includes(demanda.etapa)) return null;
  const inicio = inicioDaEspera(demanda);
  const dias = diasEsperandoAutorizacao(demanda, hoje);
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

// --- Registro ------------------------------------------------------------------------------

/**
 * Por que a demanda não pode receber esta autorização, ou null. Só a demanda
 * do mesmo cliente que espera a autorização ou, no complemento, a que já está
 * a faturar por outra autorização.
 */
export function problemaDaDemandaParaAutorizar(
  numero: string,
  demanda: Pick<EstadoDaDemanda, "autorizacao_ids"> & { etapa: EtapaDemanda; customer_code?: unknown },
  customerCode: string,
): string | null {
  if (demanda.customer_code !== customerCode) return `A demanda ${numero} é de outro cliente.`;
  if (demanda.etapa === "aguardando_autorizacao") return null;
  if (demanda.etapa === "a_faturar" && autorizacoesDaDemanda(demanda).length > 0) return null;
  return `A demanda ${numero} está ${rotuloDaEtapa(demanda.etapa)}: a autorização é da demanda validada que aguarda autorização (ou complemento de outra já autorizada).`;
}

export type DemandaCitada = {
  /** A RV que o cliente cita. */
  rv: number;
  /** A RV que o cliente validou (validacao.rv), ou null. */
  rv_validada: number | null;
  /** O total da RV citada, como foi enviada (revisoes/{rv}.total_cents). */
  valor_cents: number;
};

/**
 * As marcas da autorização, na ordem de MARCAS_AUTORIZACAO.
 * - valor_diverge: o valor informado difere da soma das RVs citadas.
 * - tomador_outra_raiz: o tomador informado tem outra raiz de CNPJ que o
 *   cadastro (filial da mesma raiz não marca). Cadastro sem CNPJ válido marca:
 *   não há como conferir.
 * - rv_nao_validada: alguma demanda cita uma RV que não é a validada.
 */
export function marcasDaAutorizacao(entrada: {
  valor_cents: number;
  demandas: readonly DemandaCitada[];
  tomador_documento: string | null;
  documento_do_cadastro: unknown;
}): MarcaAutorizacao[] {
  const marcas = new Set<MarcaAutorizacao>();
  if (somarCentavos(entrada.demandas.map((demanda) => demanda.valor_cents)) !== entrada.valor_cents) marcas.add("valor_diverge");
  if (entrada.tomador_documento !== null) {
    const raiz = cnpjRoot(entrada.tomador_documento);
    if (raiz === null || raiz !== cnpjRoot(entrada.documento_do_cadastro)) marcas.add("tomador_outra_raiz");
  }
  if (entrada.demandas.some((demanda) => demanda.rv !== demanda.rv_validada)) marcas.add("rv_nao_validada");
  return MARCAS_AUTORIZACAO.filter((marca) => marcas.has(marca));
}

/** Normaliza o pedido ou o aceite para comparar: maiúsculas, sem espaço, ponto, barra nem hífen. */
export function chaveDoNumeroDoCliente(valor: string | null | undefined): string | null {
  const chave = (valor ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  return chave || null;
}
