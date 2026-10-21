import { dataValida, diasEntre, somarDias } from "./contratos-datas.js";
import { cnpjNormalizado, cnpjRoot } from "./customer-identity.js";
import {
  AUTORIZACOES_QUE_ESPERAM,
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
 *   diferente da soma das RVs citadas e do que falta autorizar nelas, o
 *   tomador de outra raiz de CNPJ, a RV diferente da validada).
 * - O tipo segue o que o contrato pedia na validação: pedido e aceite, ou o
 *   pedido do portal do fornecedor.
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

/** Como a autorização se chama na mensagem: o tipo que o contrato pede. */
const TIPO_NA_MENSAGEM: Record<(typeof AUTORIZACOES_QUE_ESPERAM)[number], string> = {
  pedido_aceite: "pedido e aceite: registre como pedido e aceite, com os dois números",
  portal: "pedido no portal do fornecedor: registre como portal, com o pedido do portal",
};

/**
 * Por que o tipo informado não serve à demanda, ou null. A validação guarda o
 * tipo que o contrato pedia (`validacao.autorizacao`, parte 10), e só pedido
 * e aceite ou portal levam a "aguardando autorização": no contrato com pedido
 * e aceite, a NF do cliente leva os dois números; no portal, o pedido do
 * portal. A medição aprovada vem da medição mensal, nunca deste registro.
 */
export function problemaDoTipoDaAutorizacao(
  tipo: TipoAutorizacaoCliente,
  numero: string,
  demanda: Pick<EstadoDaDemanda, "validacao">,
): string | null {
  if (tipo === "medicao_aprovada") return "A medição aprovada se registra na medição mensal, não aqui.";
  const exigido = (demanda.validacao as { autorizacao?: unknown } | null | undefined)?.autorizacao;
  if (!(AUTORIZACOES_QUE_ESPERAM as readonly unknown[]).includes(exigido) || exigido === tipo) return null;
  return `A demanda ${numero} é de contrato com autorização por ${TIPO_NA_MENSAGEM[exigido as (typeof AUTORIZACOES_QUE_ESPERAM)[number]]}.`;
}

// --- Tomador -------------------------------------------------------------------------------

/**
 * O tomador como chegou: o CNPJ inteiro (pode ser de filial) ou, como no
 * e-mail de autorização do Itaú, com parte da raiz escondida
 * ("11.222.XXX/0001-81"), que o servidor completa com a raiz do cadastro.
 */
export type TomadorDaEntrada = { tipo: "inteiro"; cnpj: string } | { tipo: "mascarado"; mascara: string } | { tipo: "invalido" };

/** O que esconde parte da raiz no e-mail do cliente: X ou asterisco. */
const ESCONDIDO = /[X*]/;

/**
 * Lê o tomador da entrada; vazio é null. Mascarado: 14 caracteres sem a
 * máscara, X ou * só na raiz (os 8 primeiros), a filial e os dois dígitos
 * verificadores à mostra. O CNPJ inteiro válido vale como veio, mesmo com X
 * (o CNPJ alfanumérico).
 */
export function lerTomador(valor: string | null | undefined): TomadorDaEntrada | null {
  if (!valor?.trim()) return null;
  const cnpj = cnpjNormalizado(valor);
  if (cnpj) return { tipo: "inteiro", cnpj };
  const mascara = valor.toUpperCase().replace(/[^0-9A-Z*]/g, "");
  const raiz = mascara.slice(0, 8);
  if (/^[0-9A-Z*]{8}[0-9A-Z]{4}[0-9]{2}$/.test(mascara) && ESCONDIDO.test(raiz)) return { tipo: "mascarado", mascara };
  return { tipo: "invalido" };
}

/**
 * Completa o tomador mascarado com a raiz do cadastro: os caracteres à mostra
 * precisam ser os da raiz e os dígitos verificadores precisam fechar. Senão,
 * o motivo (o CNPJ inteiro resolve).
 */
export function completarTomador(mascara: string, documentoDoCadastro: unknown): { cnpj: string } | { problema: string } {
  const raiz = cnpjRoot(documentoDoCadastro);
  if (!raiz) return { problema: "O cadastro do cliente não tem CNPJ para completar o tomador mascarado: informe o CNPJ inteiro." };
  if (![...mascara.slice(0, 8)].every((caractere, indice) => ESCONDIDO.test(caractere) || caractere === raiz[indice])) {
    return { problema: "O tomador mascarado tem outra raiz de CNPJ que o cadastro: informe o CNPJ inteiro." };
  }
  const cnpj = cnpjNormalizado(`${raiz}${mascara.slice(8)}`);
  if (!cnpj) return { problema: "O tomador mascarado não fecha com a raiz do cadastro (dígitos verificadores): informe o CNPJ inteiro." };
  return { cnpj };
}

// --- Valor e marcas ------------------------------------------------------------------------

export type DemandaCitada = {
  /** A RV que o cliente cita. */
  rv: number;
  /** A RV que o cliente validou (validacao.rv), ou null. */
  rv_validada: number | null;
  /** O total da RV citada, como foi enviada (revisoes/{rv}.total_cents). */
  valor_cents: number;
};

/** Outra autorização ativa de alguma das demandas: o valor e as demandas que ela cobre. */
export type OutraAutorizacao = { valor_cents: number; demanda_numeros: readonly string[] };

/**
 * O que falta autorizar nas demandas (o complemento): a soma das RVs citadas
 * menos o valor das outras autorizações ativas delas. Sem outra, é a soma.
 * null quando alguma outra também cobre demanda fora desta: não há como
 * repartir o valor dela.
 */
export function saldoDaAutorizacao(numeros: readonly string[], somaCents: number, outras: readonly OutraAutorizacao[]): number | null {
  if (outras.some((outra) => outra.demanda_numeros.some((numero) => !numeros.includes(numero)))) return null;
  return somaCents - somarCentavos(outras.map((outra) => outra.valor_cents));
}

/**
 * As marcas da autorização, na ordem de MARCAS_AUTORIZACAO.
 * - valor_diverge: o valor informado difere da soma das RVs citadas e do
 *   saldo (o que falta autorizar nelas; saldoDaAutorizacao). O complemento
 *   que fecha o saldo não marca.
 * - tomador_outra_raiz: o tomador informado tem outra raiz de CNPJ que o
 *   cadastro (filial da mesma raiz não marca). Cadastro sem CNPJ válido marca:
 *   não há como conferir.
 * - rv_nao_validada: alguma demanda cita uma RV que não é a validada.
 */
export function marcasDaAutorizacao(entrada: {
  valor_cents: number;
  demandas: readonly DemandaCitada[];
  saldo_cents?: number | null;
  tomador_documento: string | null;
  documento_do_cadastro: unknown;
}): MarcaAutorizacao[] {
  const marcas = new Set<MarcaAutorizacao>();
  const soma = somarCentavos(entrada.demandas.map((demanda) => demanda.valor_cents));
  if (entrada.valor_cents !== soma && entrada.valor_cents !== entrada.saldo_cents) marcas.add("valor_diverge");
  if (entrada.tomador_documento !== null) {
    const raiz = cnpjRoot(entrada.tomador_documento);
    if (raiz === null || raiz !== cnpjRoot(entrada.documento_do_cadastro)) marcas.add("tomador_outra_raiz");
  }
  if (entrada.demandas.some((demanda) => demanda.rv !== demanda.rv_validada)) marcas.add("rv_nao_validada");
  return MARCAS_AUTORIZACAO.filter((marca) => marcas.has(marca));
}

// --- Documento único -----------------------------------------------------------------------

/**
 * O documento de `client_authorizations`, um só para as duas origens: o
 * registro à mão (recordAuthorization) e a medição aprovada (advanceMedicao).
 * O que uma origem não tem vai vazio (null, [] ou 0), nunca ausente: a tela,
 * as regras e o cancelamento leem os mesmos campos. Sem os carimbos de
 * servidor (created_at, updated_at), que quem grava acrescenta.
 *
 * - `status` é registrada ou cancelada. A medição aprovada nasce registrada
 *   (antes da unificação gravava "a_faturar"; statusDaAutorizacao lê os dois).
 * - `valor_cents` é o que o cliente autorizou: o valor do aceite, ou o total
 *   aprovado da medição (antes, total_cents).
 * - `demanda_numeros` é a lista de números das demandas cobertas (a da medição
 *   cresce com a pendente que for validada depois); `demandas` guarda, por
 *   demanda, a RV citada e o total dela, e na medição fica vazia.
 */
export type EntradaDoDocumento = {
  id: string;
  customer_code: string;
  contrato_id: string | null;
  tipo: TipoAutorizacaoCliente;
  recebida_em: string;
  valor_cents: number;
  demanda_numeros: readonly string[];
  registrada_por: string;
  registrada_por_papel: string;
  registrada_em: string;
  operation_id: string;
  origem?: "manual" | "medicao";
  soma_cents?: number;
  saldo_cents?: number | null;
  demandas?: ReadonlyArray<{ numero: string; rv: number; rotulo: string; valor_cents: number }>;
  pedido?: string | null;
  aceite?: string | null;
  chave_pedido_aceite?: string | null;
  tomador_documento?: string | null;
  codigo_servico?: string | null;
  centro_custo?: string | null;
  ref_cliente?: string | null;
  escopo?: string | null;
  email_link?: string | null;
  documento?: { nome: string; referencia: string } | null;
  marcas?: readonly MarcaAutorizacao[];
  medicao_id?: string | null;
  competencia?: string | null;
  demandas_pendentes?: ReadonlyArray<{ numero: string; motivo: string }>;
  contato_id?: string | null;
};

export function documentoDaAutorizacao(entrada: EntradaDoDocumento): Record<string, unknown> {
  return {
    id: entrada.id,
    customer_code: entrada.customer_code,
    contrato_id: entrada.contrato_id,
    tipo: entrada.tipo,
    origem: entrada.origem ?? "manual",
    pedido: entrada.pedido ?? null,
    aceite: entrada.aceite ?? null,
    chave_pedido_aceite: entrada.chave_pedido_aceite ?? null,
    recebida_em: entrada.recebida_em,
    valor_cents: entrada.valor_cents,
    soma_cents: entrada.soma_cents ?? entrada.valor_cents,
    saldo_cents: entrada.saldo_cents ?? null,
    demandas: [...(entrada.demandas ?? [])],
    demanda_numeros: [...entrada.demanda_numeros],
    demandas_pendentes: [...(entrada.demandas_pendentes ?? [])],
    tomador_documento: entrada.tomador_documento ?? null,
    codigo_servico: entrada.codigo_servico ?? null,
    centro_custo: entrada.centro_custo ?? null,
    ref_cliente: entrada.ref_cliente ?? null,
    escopo: entrada.escopo ?? null,
    email_link: entrada.email_link ?? null,
    documento: entrada.documento ?? null,
    marcas: [...(entrada.marcas ?? [])],
    medicao_id: entrada.medicao_id ?? null,
    competencia: entrada.competencia ?? null,
    contato_id: entrada.contato_id ?? null,
    status: "registrada" satisfies StatusAutorizacao,
    registrada_por: entrada.registrada_por,
    registrada_por_papel: entrada.registrada_por_papel,
    registrada_em: entrada.registrada_em,
    cancelada_por: null,
    cancelada_em: null,
    motivo_cancelamento: null,
    // Reservados para a Fase 7 (NF, portal do cliente e Omie).
    nf_ids: [],
    enviada_portal_em: null,
    omie_lancada_em: null,
    operation_id: entrada.operation_id,
    schema_version: AUTHORIZATION_SCHEMA_VERSION,
  };
}

/**
 * A situação gravada, lendo também o formato antigo da medição aprovada
 * ("a_faturar", que é a registrada). null para o que não se reconhece.
 */
export function statusDaAutorizacao(autorizacao: { status?: unknown }): StatusAutorizacao | null {
  if (autorizacao.status === "registrada" || autorizacao.status === "a_faturar") return "registrada";
  if (autorizacao.status === "cancelada") return "cancelada";
  return null;
}

/**
 * Os números das demandas cobertas: `demanda_numeros` ou, no formato antigo da
 * medição, `demandas` como lista de números. Sem repetição, na ordem gravada.
 */
export function numerosDaAutorizacao(autorizacao: { demanda_numeros?: unknown; demandas?: unknown }): string[] {
  const lista = Array.isArray(autorizacao.demanda_numeros)
    ? autorizacao.demanda_numeros
    : Array.isArray(autorizacao.demandas)
      ? autorizacao.demandas.map((item) => (item && typeof item === "object" ? (item as { numero?: unknown }).numero : item))
      : [];
  return [...new Set(lista.filter((numero): numero is string => typeof numero === "string" && /^\d{5,8}$/.test(numero)))];
}

/** O valor autorizado em centavos (`valor_cents`; no formato antigo da medição, `total_cents`), ou null. */
export function valorDaAutorizacao(autorizacao: { valor_cents?: unknown; total_cents?: unknown }): number | null {
  const valor = autorizacao.valor_cents ?? autorizacao.total_cents;
  return typeof valor === "number" && Number.isSafeInteger(valor) && valor >= 0 ? valor : null;
}

/** Normaliza o pedido ou o aceite para comparar: maiúsculas, sem espaço, ponto, barra nem hífen. */
export function chaveDoNumeroDoCliente(valor: string | null | undefined): string | null {
  const chave = (valor ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  return chave || null;
}
