import { randomBytes } from "node:crypto";

import type { FormaDePagamento } from "./fatura.js";
import type { FalhaDaOmie, ServicoDaOmie } from "./omie.js";

/**
 * A emissão da NFS-e pela Omie, pura (parte 7.4a; desenho em
 * docs/plataforma/fase-7-financeiro-unificado.md, "A NFS-e pela Omie").
 *
 * A emissão (`nf_emissoes/{id}`) anda por etapas, uma chamada da Omie por
 * vez. O id é o `cCodIntOS` da OS: a Omie recusa a segunda OS com o mesmo
 * código, e a Dute então lê a que existe pelo `StatusOS`. Daqui saem o passo
 * seguinte de cada etapa, o pedido de cada passo e o que a resposta, ou a
 * falha, faz com a emissão. A gravação (7.4b) só aplica o resultado.
 */

export const EMISSOES_COLLECTION = "nf_emissoes";

export const ETAPAS_DA_EMISSAO = [
  "na_fila",
  "os_incluida",
  "na_prefeitura",
  "autorizada",
  "rejeitada",
  "reenviando",
  "cancelando",
  "parada",
  "desistida",
] as const;
export type EtapaDaEmissao = (typeof ETAPAS_DA_EMISSAO)[number];

/** As etapas em que a rotina chama a Omie. As outras esperam uma pessoa ou acabaram. */
export const ETAPAS_DA_ROTINA: readonly EtapaDaEmissao[] = ["na_fila", "os_incluida", "na_prefeitura", "reenviando", "cancelando"];

/** As etapas em que as demandas e as competências continuam reservadas para a emissão. */
export const ETAPAS_QUE_RESERVAM: readonly EtapaDaEmissao[] = ["na_fila", "os_incluida", "na_prefeitura", "rejeitada", "reenviando", "cancelando", "parada"];

export const MOTIVOS_DA_PARADA = [
  "cliente_nao_achado",
  "cliente_repetido",
  "ambiente_errado",
  "chave",
  "sem_chaves",
  "falhas_seguidas",
  "cancelada_na_omie",
  "prefeitura_demorou",
  "fatura_recusada",
  "nfse_autorizada",
] as const;
export type MotivoDaParada = (typeof MOTIVOS_DA_PARADA)[number];

export const ID_DA_EMISSAO = /^nfe_[a-f0-9]{20}$/;

/** O campo da reserva na demanda e na competência da armazenagem (parte 7.4b). */
export const CAMPO_DA_RESERVA = "emissao_nf";

/**
 * A emissão que reservou a demanda ou a competência: `emissao_nf.id`. O
 * Comercial lê o mesmo campo (functions/comercial/src/domain/demanda.ts,
 * emissaoNfDaDemanda) e não tira a demanda reservada de A faturar.
 */
export function emissaoReservada(dados: Record<string, unknown>): string | null {
  const reserva = dados[CAMPO_DA_RESERVA];
  if (!reserva || typeof reserva !== "object") return null;
  const id = (reserva as Record<string, unknown>).id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

/** Os códigos de integração dos serviços que o contador cadastra na Omie. */
export const SERVICO_DAS_OS = "DUTE-OS";
export const SERVICO_DA_ARMAZENAGEM = "DUTE-ARMAZENAGEM";

/** Depois de quantas falhas seguidas a emissão para. */
export const FALHAS_ATE_PARAR = 6;

/** Quanto tempo a prefeitura pode levar antes de a emissão parar. */
export const HORAS_NA_PREFEITURA = 72;

export type AmbienteDaOmie = "H" | "P";

/** O ambiente da Omie de cada projeto: a homologação nunca fatura numa Omie em produção. */
export const AMBIENTE_DA_OMIE: Readonly<Record<string, AmbienteDaOmie>> = { "dute-homolog": "H", "dute-prod": "P" };

/** A liberação da emissão pela Omie (como a do Financeiro, só a homologação até o lançamento). */
export const OMIE_AMBIENTES_LIBERADOS = ["dute-homolog"] as const;

export function omieLiberada(projectId: string | null | undefined): boolean {
  return (OMIE_AMBIENTES_LIBERADOS as readonly string[]).includes(String(projectId ?? "").trim());
}

/**
 * O que a conta da empresa na Omie pede além do serviço: a categoria de
 * receita e a conta corrente da parcela. O contador passa; até lá, ficam
 * fora do pedido e a Omie usa o padrão dela.
 */
export type ConfiguracaoDaOmie = { categoria: string | null; conta_corrente: number | null };

export const CONFIGURACAO_DA_OMIE: Readonly<Record<string, ConfiguracaoDaOmie>> = {
  "dute-homolog": { categoria: null, conta_corrente: null },
  "dute-prod": { categoria: null, conta_corrente: null },
};

export type ItemDaEmissao = {
  origem: "demanda" | "armazenagem";
  /** O número da demanda ou o id da competência. */
  referencia: string;
  descricao: string;
  valor_cents: number;
};

export type DadosDaOmie = {
  cliente: number | null;
  os: number | null;
  numero_os: string | null;
  ambiente: AmbienteDaOmie | null;
  nfse: string | null;
  codigo_verificacao: string | null;
  url_nfse: string | null;
  url_pdf: string | null;
};

export type MensagemDaPrefeitura = { codigo: string; descricao: string; correcao: string };

export type Emissao = {
  id: string;
  customer_code: string;
  customer_name: string | null;
  /** O CNPJ do cadastro, só os dígitos: é por ele que o cliente é achado na Omie. */
  cnpj: string;
  itens: ItemDaEmissao[];
  vencimento: string;
  forma: FormaDePagamento;
  observacao: string | null;
  etapa: EtapaDaEmissao;
  /** A etapa de onde a parada volta quando alguém retoma. */
  etapa_anterior: EtapaDaEmissao | null;
  motivo_da_parada: MotivoDaParada | null;
  mensagem: string | null;
  mensagens_da_prefeitura: MensagemDaPrefeitura[];
  omie: DadosDaOmie;
  /** Falhas seguidas no passo atual. */
  tentativas: number;
  /** Idas à prefeitura nesta etapa, para o intervalo entre elas. */
  consultas: number;
  /** A rotina só chama a Omie para esta emissão a partir daqui (ISO, UTC). */
  proxima_em: string;
  /** Quando a OS foi faturada: o relógio da prefeitura. */
  faturada_em: string | null;
  /**
   * A próxima chamada confere a OS na Omie antes (StatusOS): a chamada
   * anterior que grava (FaturarOS, ReenviarOS ou CancelarOS) falhou, e a
   * Omie pode ter gravado com a resposta perdida.
   */
  conferir: boolean;
  edicao: number;
};

export function totalDaEmissao(emissao: Pick<Emissao, "itens">): number {
  return emissao.itens.reduce((soma, item) => soma + item.valor_cents, 0);
}

export function novoIdDeEmissao(aleatorio: () => string = () => randomBytes(10).toString("hex")): string {
  const id = `nfe_${aleatorio()}`;
  if (!ID_DA_EMISSAO.test(id)) throw new Error("Id de emissão inválido.");
  return id;
}

export const DADOS_DA_OMIE_VAZIOS: DadosDaOmie = {
  cliente: null,
  os: null,
  numero_os: null,
  ambiente: null,
  nfse: null,
  codigo_verificacao: null,
  url_nfse: null,
  url_pdf: null,
};

const FORMAS = ["boleto", "pix", "transferencia", "cartao", "dinheiro"] as const;

function lida(condicao: boolean): void {
  if (!condicao) throw new Error("Emissão ilegível.");
}

function textoOuNull(valor: unknown): string | null {
  return typeof valor === "string" && valor ? valor : null;
}

function numeroOuNull(valor: unknown): number | null {
  return typeof valor === "number" && Number.isInteger(valor) && valor > 0 ? valor : null;
}

/** A emissão gravada, conferida campo a campo: a rotina e as ações só trabalham com a emissão inteira. */
export function emissaoLida(id: string, dados: Record<string, unknown>): Emissao {
  lida(ID_DA_EMISSAO.test(id));
  lida((ETAPAS_DA_EMISSAO as readonly string[]).includes(String(dados.etapa)));
  lida(typeof dados.customer_code === "string" && dados.customer_code.length > 0);
  lida(typeof dados.cnpj === "string" && /^\d{11}(\d{3})?$/.test(dados.cnpj));
  lida(Array.isArray(dados.itens) && dados.itens.length > 0);
  const itens = (dados.itens as unknown[]).map((item) => {
    const registro = (item ?? {}) as Record<string, unknown>;
    lida(registro.origem === "demanda" || registro.origem === "armazenagem");
    lida(typeof registro.referencia === "string" && typeof registro.descricao === "string");
    lida(typeof registro.valor_cents === "number" && Number.isSafeInteger(registro.valor_cents) && registro.valor_cents >= 0);
    return { origem: registro.origem as ItemDaEmissao["origem"], referencia: registro.referencia as string, descricao: registro.descricao as string, valor_cents: registro.valor_cents as number };
  });
  lida(typeof dados.vencimento === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dados.vencimento));
  lida((FORMAS as readonly string[]).includes(String(dados.forma)));
  lida(typeof dados.proxima_em === "string" && !Number.isNaN(Date.parse(dados.proxima_em)));
  lida(Number.isInteger(dados.edicao) && (dados.edicao as number) >= 1);
  const omie = (dados.omie ?? {}) as Record<string, unknown>;
  const ambiente = omie.ambiente === "H" || omie.ambiente === "P" ? omie.ambiente : null;
  const motivo = (MOTIVOS_DA_PARADA as readonly string[]).includes(String(dados.motivo_da_parada)) ? (dados.motivo_da_parada as MotivoDaParada) : null;
  const anterior = (ETAPAS_DA_EMISSAO as readonly string[]).includes(String(dados.etapa_anterior)) ? (dados.etapa_anterior as EtapaDaEmissao) : null;
  const mensagens = Array.isArray(dados.mensagens_da_prefeitura) ? (dados.mensagens_da_prefeitura as Record<string, unknown>[]) : [];
  return {
    id,
    customer_code: dados.customer_code as string,
    customer_name: textoOuNull(dados.customer_name),
    cnpj: dados.cnpj as string,
    itens,
    vencimento: dados.vencimento as string,
    forma: dados.forma as FormaDePagamento,
    observacao: textoOuNull(dados.observacao),
    etapa: dados.etapa as EtapaDaEmissao,
    etapa_anterior: anterior,
    motivo_da_parada: motivo,
    mensagem: textoOuNull(dados.mensagem),
    mensagens_da_prefeitura: mensagens.map((mensagem) => ({ codigo: String(mensagem?.codigo ?? ""), descricao: String(mensagem?.descricao ?? ""), correcao: String(mensagem?.correcao ?? "") })),
    omie: {
      cliente: numeroOuNull(omie.cliente),
      os: numeroOuNull(omie.os),
      numero_os: textoOuNull(omie.numero_os),
      ambiente,
      nfse: textoOuNull(omie.nfse),
      codigo_verificacao: textoOuNull(omie.codigo_verificacao),
      url_nfse: textoOuNull(omie.url_nfse),
      url_pdf: textoOuNull(omie.url_pdf),
    },
    tentativas: Number.isInteger(dados.tentativas) ? (dados.tentativas as number) : 0,
    consultas: Number.isInteger(dados.consultas) ? (dados.consultas as number) : 0,
    proxima_em: dados.proxima_em as string,
    faturada_em: textoOuNull(dados.faturada_em),
    conferir: dados.conferir === true,
    edicao: dados.edicao as number,
  };
}

// --- O passo ------------------------------------------------------------------------------

export type Passo = "achar_cliente" | "incluir_os" | "conferir_ambiente" | "faturar_os" | "acompanhar" | "reenviar_os" | "cancelar_os" | "conferir_os";

/** As chamadas que gravam na Omie e que, repetidas às cegas, a Omie recusaria ou faria duas vezes. */
const PASSOS_QUE_GRAVAM: readonly Passo[] = ["faturar_os", "reenviar_os", "cancelar_os"];

/** O passo que a rotina dá agora, ou null quando a emissão espera uma pessoa, já acabou ou ainda não é hora. */
export function passoDaEmissao(emissao: Emissao, agora: Date): Passo | null {
  if (!ETAPAS_DA_ROTINA.includes(emissao.etapa)) return null;
  if (Date.parse(emissao.proxima_em) > agora.getTime()) return null;
  switch (emissao.etapa) {
    case "na_fila":
      return emissao.omie.cliente === null ? "achar_cliente" : "incluir_os";
    case "os_incluida":
      if (emissao.omie.ambiente === null || emissao.omie.os === null) return "conferir_ambiente";
      return emissao.conferir ? "conferir_os" : "faturar_os";
    case "na_prefeitura":
      return "acompanhar";
    case "reenviando":
      return emissao.conferir ? "conferir_os" : "reenviar_os";
    case "cancelando":
      return emissao.conferir ? "conferir_os" : "cancelar_os";
    default:
      return null;
  }
}

export type PedidoDaOmie = { servico: ServicoDaOmie; call: string; param: Record<string, unknown> };

/** "2026-10-24" → "24/10/2026", o formato das datas da Omie. */
export function dataDaOmie(dia: string): string {
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`;
}

/** O CNPJ (ou o CPF) no formato que a Omie guarda. */
export function cnpjFormatado(digitos: string): string {
  if (/^\d{14}$/.test(digitos)) return `${digitos.slice(0, 2)}.${digitos.slice(2, 5)}.${digitos.slice(5, 8)}/${digitos.slice(8, 12)}-${digitos.slice(12)}`;
  if (/^\d{11}$/.test(digitos)) return `${digitos.slice(0, 3)}.${digitos.slice(3, 6)}.${digitos.slice(6, 9)}-${digitos.slice(9)}`;
  return digitos;
}

function reais(cents: number): number {
  return Number((cents / 100).toFixed(2));
}

/** A OS da fatura: um item por demanda e por competência, com o serviço do contador e uma parcela. */
export function osDaEmissao(emissao: Emissao, hoje: string, configuracao: ConfiguracaoDaOmie): Record<string, unknown> {
  if (emissao.omie.cliente === null) throw new Error("A OS precisa do cliente da Omie.");
  const adicionais: Record<string, unknown> = {
    cDadosAdicNF: [`Emissão Dute ${emissao.id}`, emissao.observacao].filter(Boolean).join(" · ").slice(0, 500),
  };
  if (configuracao.categoria) adicionais.cCodCateg = configuracao.categoria;
  if (configuracao.conta_corrente !== null) adicionais.nCodCC = configuracao.conta_corrente;
  return {
    Cabecalho: {
      cCodIntOS: emissao.id,
      nCodCli: emissao.omie.cliente,
      dDtPrevisao: dataDaOmie(hoje),
      cEtapa: "50",
      nQtdeParc: 1,
    },
    InformacoesAdicionais: adicionais,
    ServicosPrestados: emissao.itens.map((item, indice) => ({
      nSeqItem: indice + 1,
      cCodIntServico: item.origem === "armazenagem" ? SERVICO_DA_ARMAZENAGEM : SERVICO_DAS_OS,
      cDescServ: item.descricao.slice(0, 500),
      nQtde: 1,
      nValUnit: reais(item.valor_cents),
    })),
    Parcelas: [{ nParcela: 1, dDtVenc: dataDaOmie(emissao.vencimento), nValor: reais(totalDaEmissao(emissao)), nPercentual: 100 }],
  };
}

export function pedidoDoPasso(passo: Passo, emissao: Emissao, hoje: string, configuracao: ConfiguracaoDaOmie): PedidoDaOmie {
  const chave = { cCodIntOS: emissao.id, ...(emissao.omie.os !== null ? { nCodOS: emissao.omie.os } : {}) };
  switch (passo) {
    case "achar_cliente":
      return {
        servico: "geral/clientes",
        call: "ListarClientes",
        param: { pagina: 1, registros_por_pagina: 20, apenas_importado_api: "N", clientesFiltro: { cnpj_cpf: cnpjFormatado(emissao.cnpj) } },
      };
    case "incluir_os":
      return { servico: "servicos/os", call: "IncluirOS", param: osDaEmissao(emissao, hoje, configuracao) };
    case "conferir_ambiente":
      return { servico: "servicos/os", call: "StatusOS", param: { cCodIntOS: emissao.id } };
    case "faturar_os":
      return { servico: "servicos/osp", call: "FaturarOS", param: chave };
    case "acompanhar":
      return { servico: "servicos/os", call: "StatusOS", param: { ...chave, lMsg: true } };
    case "reenviar_os":
      return { servico: "servicos/osp", call: "ReenviarOS", param: chave };
    case "cancelar_os":
      return { servico: "servicos/osp", call: "CancelarOS", param: { ...chave, cCancelarNfse: "S" } };
    case "conferir_os":
      return { servico: "servicos/os", call: "StatusOS", param: { ...chave, lMsg: true } };
  }
}

// --- A resposta ---------------------------------------------------------------------------

/** O que a gravação faz depois do passo, além de guardar a emissão nova. */
export type Efeito = "nenhum" | "registrar_fatura" | "liberar_reservas";

export type Avanco = { emissao: Emissao; efeito: Efeito };

const MINUTO = 60_000;

function depois(agora: Date, ms: number): string {
  return new Date(agora.getTime() + ms).toISOString();
}

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : typeof valor === "number" ? String(valor) : "";
}

function inteiroPositivo(valor: unknown): number | null {
  const numero = typeof valor === "string" ? Number(valor) : valor;
  return typeof numero === "number" && Number.isInteger(numero) && numero > 0 ? numero : null;
}

function soDigitos(valor: unknown): string {
  return texto(valor).replace(/\D/g, "");
}

function andou(emissao: Emissao, mudanca: Partial<Emissao>, agora: Date): Emissao {
  const mudouDeEtapa = mudanca.etapa !== undefined && mudanca.etapa !== emissao.etapa;
  return {
    ...emissao,
    ...mudanca,
    omie: { ...emissao.omie, ...(mudanca.omie ?? {}) },
    tentativas: 0,
    consultas: mudouDeEtapa ? 0 : (mudanca.consultas ?? emissao.consultas),
    proxima_em: mudanca.proxima_em ?? agora.toISOString(),
    edicao: emissao.edicao + 1,
  };
}

function parou(emissao: Emissao, motivo: MotivoDaParada, mensagem: string, agora: Date): Emissao {
  return andou(emissao, { etapa: "parada", etapa_anterior: emissao.etapa, motivo_da_parada: motivo, mensagem }, agora);
}

/**
 * Sem as chaves da API no ambiente, a emissão que é hora de andar para e
 * espera uma pessoa, em vez de ficar na fila com as reservas presas:
 * desistir solta as reservas; retomar, com as chaves, volta de onde parou.
 */
export function paradaSemChaves(emissao: Emissao, agora: Date): Avanco {
  return { emissao: parou(emissao, "sem_chaves", "As chaves da API da Omie não estão neste ambiente.", agora), efeito: "nenhum" };
}

/** O intervalo entre as consultas à prefeitura: 2, 5, 10 e depois 15 minutos. */
export function esperaNaPrefeitura(consultas: number): number {
  return [2, 5, 10][consultas] ?? 15;
}

function rpsMaisRecente(corpo: Record<string, unknown>): Record<string, unknown> | null {
  const lista = Array.isArray(corpo.ListaRpsNfse) ? (corpo.ListaRpsNfse as unknown[]) : [];
  const validas = lista.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  return validas.length ? validas[validas.length - 1] : null;
}

/** O número, o código de verificação e os links da NFS-e autorizada (004). */
function dadosDaNfse(emissao: Emissao, rps: Record<string, unknown>): DadosDaOmie {
  return {
    ...emissao.omie,
    nfse: soDigitos(rps.nNfse) || texto(rps.nNfse),
    codigo_verificacao: texto(rps.cCodVerif) || null,
    url_nfse: texto(rps.cUrlNfse) || null,
    url_pdf: texto(rps.cUrlPdfDest) || texto(rps.cUrlPdfDemo) || null,
  };
}

/** A prefeitura passou do prazo de resposta desde que a OS foi faturada. */
function prefeituraDemorou(emissao: Emissao, agora: Date): boolean {
  return agora.getTime() - Date.parse(emissao.faturada_em ?? emissao.proxima_em) > HORAS_NA_PREFEITURA * 60 * MINUTO;
}

/** "00000815" → "815", como a nota aparece para a pessoa. */
function numeroDaNfse(nfse: string): string {
  return nfse.replace(/^0+(?=\d)/, "");
}

function mensagensDaRps(rps: Record<string, unknown>): MensagemDaPrefeitura[] {
  const lista = Array.isArray(rps.mensagens) ? (rps.mensagens as unknown[]) : [];
  return lista
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({ codigo: texto(item.cCodigo).slice(0, 40), descricao: texto(item.cDescricao).slice(0, 500), correcao: texto(item.cCorrecao).slice(0, 500) }))
    .filter((mensagem) => mensagem.descricao || mensagem.correcao)
    .slice(0, 10);
}

/**
 * A resposta da Omie aplicada à emissão. `ambiente` é o que o projeto
 * espera (AMBIENTE_DA_OMIE).
 */
export function comResposta(
  emissao: Emissao,
  passo: Passo,
  corpo: Record<string, unknown>,
  contexto: { agora: Date; ambiente: AmbienteDaOmie },
): Avanco {
  const { agora } = contexto;
  switch (passo) {
    case "achar_cliente": {
      const lista = Array.isArray(corpo.clientes_cadastro) ? (corpo.clientes_cadastro as Record<string, unknown>[]) : [];
      const ativos = lista.filter((cliente) => soDigitos(cliente.cnpj_cpf) === emissao.cnpj && texto(cliente.inativo).toUpperCase() !== "S");
      const codigos = [...new Set(ativos.map((cliente) => inteiroPositivo(cliente.codigo_cliente_omie)).filter((codigo): codigo is number => codigo !== null))];
      if (!codigos.length) {
        return { emissao: parou(emissao, "cliente_nao_achado", `Nenhum cliente ativo com o CNPJ ${cnpjFormatado(emissao.cnpj)} na Omie.`, agora), efeito: "nenhum" };
      }
      if (codigos.length > 1) {
        return { emissao: parou(emissao, "cliente_repetido", `${codigos.length} clientes ativos com o CNPJ ${cnpjFormatado(emissao.cnpj)} na Omie.`, agora), efeito: "nenhum" };
      }
      return { emissao: andou(emissao, { omie: { ...emissao.omie, cliente: codigos[0] } }, agora), efeito: "nenhum" };
    }
    case "incluir_os": {
      const os = inteiroPositivo(corpo.nCodOS);
      return { emissao: andou(emissao, { etapa: "os_incluida", mensagem: null, omie: { ...emissao.omie, os, numero_os: texto(corpo.cNumOS) || null } }, agora), efeito: "nenhum" };
    }
    case "conferir_ambiente": {
      const os = inteiroPositivo(corpo.nCodOS);
      const ambiente = texto(corpo.cAmbiente).toUpperCase();
      const omie = { ...emissao.omie, os: os ?? emissao.omie.os, numero_os: texto(corpo.cNumOS) || emissao.omie.numero_os };
      if (ambiente !== contexto.ambiente) {
        const esperado = contexto.ambiente === "H" ? "homologação" : "produção";
        return { emissao: parou({ ...emissao, omie }, "ambiente_errado", `A Omie está emitindo em ${ambiente === "P" ? "produção" : ambiente === "H" ? "homologação" : "ambiente desconhecido"}, e este ambiente da Dute só emite em ${esperado}.`, agora), efeito: "nenhum" };
      }
      if (omie.os === null) {
        return { emissao: comFalha(emissao, passo, { tipo: "recusa", mensagem: "A Omie não devolveu o código da OS.", esperar_ms: 2 * MINUTO }, agora), efeito: "nenhum" };
      }
      // A OS que alguém já faturou na Omie segue para a prefeitura.
      const faturada = texto(corpo.cFaturada).toUpperCase() === "S";
      return {
        emissao: andou(emissao, faturada ? { etapa: "na_prefeitura", faturada_em: emissao.faturada_em ?? agora.toISOString(), omie: { ...omie, ambiente } } : { omie: { ...omie, ambiente } }, agora),
        efeito: "nenhum",
      };
    }
    case "faturar_os":
    case "reenviar_os":
      return {
        emissao: andou(emissao, { etapa: "na_prefeitura", mensagem: null, mensagens_da_prefeitura: [], faturada_em: emissao.faturada_em ?? agora.toISOString(), proxima_em: depois(agora, esperaNaPrefeitura(0) * MINUTO) }, agora),
        efeito: "nenhum",
      };
    case "acompanhar": {
      const rps = rpsMaisRecente(corpo);
      const status = texto(rps?.cStatusRps) || texto(rps?.cStatusLote);
      if (texto(corpo.cCancelada).toUpperCase() === "S" || status === "005") {
        return { emissao: parou(emissao, "cancelada_na_omie", "A OS foi cancelada na Omie.", agora), efeito: "nenhum" };
      }
      if (status === "004" && rps && texto(rps.nNfse)) {
        return { emissao: andou(emissao, { etapa: "autorizada", mensagem: null, mensagens_da_prefeitura: [], omie: dadosDaNfse(emissao, rps) }, agora), efeito: "registrar_fatura" };
      }
      if (status === "003" && rps) {
        const mensagens = mensagensDaRps(rps);
        return {
          emissao: andou(emissao, { etapa: "rejeitada", mensagem: mensagens[0]?.descricao || "A prefeitura recusou a NFS-e.", mensagens_da_prefeitura: mensagens }, agora),
          efeito: "nenhum",
        };
      }
      return esperarAPrefeitura(emissao, agora);
    }
    case "cancelar_os":
      return { emissao: andou(emissao, { etapa: "desistida", mensagem: null }, agora), efeito: "liberar_reservas" };
    case "conferir_os":
      return conferida(emissao, corpo, agora);
  }
}

/** A prefeitura ainda processa a RPS: a próxima consulta espera mais, até o prazo; depois dele, a emissão para. */
function esperarAPrefeitura(emissao: Emissao, agora: Date): Avanco {
  if (prefeituraDemorou(emissao, agora)) {
    return { emissao: parou(emissao, "prefeitura_demorou", `A prefeitura não respondeu em ${HORAS_NA_PREFEITURA} horas.`, agora), efeito: "nenhum" };
  }
  return { emissao: andou(emissao, { consultas: emissao.consultas + 1, proxima_em: depois(agora, esperaNaPrefeitura(emissao.consultas) * MINUTO) }, agora), efeito: "nenhum" };
}

/**
 * A OS conferida na Omie: depois da falha de uma chamada que grava e, no
 * cancelamento, sempre antes do CancelarOS. O que a Omie já fez segue em
 * frente: a OS faturada vai à prefeitura, a RPS que saiu da recusa (003)
 * também, e a OS cancelada desiste e solta as reservas (ou, fora do
 * cancelamento, para a emissão). O que ainda não aconteceu volta a chamar,
 * com as falhas contando até a sexta.
 *
 * A Dute não cancela NFS-e autorizada: no cancelamento, a OS só se cancela
 * sem faturar ou com a RPS recusada. A nota autorizada para a emissão, e a
 * RPS que a prefeitura ainda processa faz esperar.
 */
function conferida(emissao: Emissao, corpo: Record<string, unknown>, agora: Date): Avanco {
  const rps = rpsMaisRecente(corpo);
  const status = texto(rps?.cStatusRps) || texto(rps?.cStatusLote);
  const cancelada = texto(corpo.cCancelada).toUpperCase() === "S" || status === "005";
  const faturada = texto(corpo.cFaturada).toUpperCase() === "S";
  const deNovo: Avanco = { emissao: { ...andou(emissao, { conferir: false }, agora), tentativas: emissao.tentativas }, efeito: "nenhum" };
  if (emissao.etapa === "cancelando") {
    if (cancelada) return { emissao: andou(emissao, { etapa: "desistida", conferir: false, mensagem: null }, agora), efeito: "liberar_reservas" };
    if (!faturada || status === "003") return deNovo;
    if (status === "004" && rps && texto(rps.nNfse)) {
      const omie = dadosDaNfse(emissao, rps);
      const mensagem = `A NFS-e ${numeroDaNfse(omie.nfse ?? "")} foi autorizada na prefeitura, e a Dute não cancela nota autorizada.`;
      return { emissao: andou(emissao, { etapa: "parada", etapa_anterior: "na_prefeitura", motivo_da_parada: "nfse_autorizada", mensagem, conferir: false, omie }, agora), efeito: "nenhum" };
    }
    return esperarAPrefeitura(emissao, agora);
  }
  if (cancelada) return { emissao: parou({ ...emissao, conferir: false }, "cancelada_na_omie", "A OS foi cancelada na Omie.", agora), efeito: "nenhum" };
  const naPrefeitura = (mudanca: Partial<Emissao>): Avanco => ({ emissao: andou(emissao, { etapa: "na_prefeitura", conferir: false, mensagem: null, ...mudanca }, agora), efeito: "nenhum" });
  if (emissao.etapa === "os_incluida") {
    return faturada ? naPrefeitura({ faturada_em: emissao.faturada_em ?? agora.toISOString() }) : deNovo;
  }
  return status && status !== "003" ? naPrefeitura({ mensagens_da_prefeitura: [] }) : deNovo;
}

/**
 * A falha da Omie aplicada à emissão. A chave inválida para a emissão (e a
 * rotina para de chamar a Omie). O limite só espera. O duplicado na inclusão
 * é a OS que já existe: segue para conferir. O resto conta como falha
 * seguida, com o intervalo dobrando, e para na sexta; depois da chamada que
 * grava, a próxima confere a OS antes.
 */
export function comFalha(emissao: Emissao, passo: Passo, falha: FalhaDaOmie, agora: Date): Emissao {
  if (falha.tipo === "duplicado" && passo === "incluir_os") {
    return andou(emissao, { etapa: "os_incluida", mensagem: null }, agora);
  }
  if (falha.tipo === "chave") return parou(emissao, "chave", falha.mensagem, agora);
  if (falha.tipo === "limite") {
    return { ...emissao, mensagem: falha.mensagem, proxima_em: depois(agora, falha.esperar_ms), edicao: emissao.edicao + 1 };
  }
  const tentativas = emissao.tentativas + 1;
  const conferir = emissao.conferir || PASSOS_QUE_GRAVAM.includes(passo);
  if (tentativas >= FALHAS_ATE_PARAR) {
    return { ...parou({ ...emissao, conferir }, "falhas_seguidas", falha.mensagem, agora), tentativas };
  }
  return { ...emissao, conferir, tentativas, mensagem: falha.mensagem, proxima_em: depois(agora, Math.max(falha.esperar_ms, 2 ** tentativas * MINUTO)), edicao: emissao.edicao + 1 };
}

// --- As ações de uma pessoa ---------------------------------------------------------------

export type AcaoNaEmissao = "retomar" | "desistir";

/**
 * Retomar: a parada volta à etapa de onde parou, do zero nas falhas; a
 * rejeitada reenvia a RPS (a pessoa corrigiu na Omie). Desistir: sem a OS na
 * Omie, ou com ela cancelada lá, libera na hora; com a NFS-e autorizada, a
 * nota vale na prefeitura e se cancela na Omie antes; com a OS, a rotina
 * confere a OS e só cancela a que não tem nota autorizada.
 */
export function comAcao(emissao: Emissao, acao: AcaoNaEmissao, agora: Date): Avanco | { problema: string } {
  if (acao === "retomar") {
    if (emissao.etapa === "rejeitada") return { emissao: andou(emissao, { etapa: "reenviando", mensagem: null }, agora), efeito: "nenhum" };
    if (emissao.etapa === "parada") {
      if (emissao.motivo_da_parada === "cancelada_na_omie") return { problema: "A OS foi cancelada na Omie: desista e emita de novo." };
      const volta = emissao.etapa_anterior && ETAPAS_DA_ROTINA.includes(emissao.etapa_anterior) ? emissao.etapa_anterior : "na_fila";
      return { emissao: andou(emissao, { etapa: volta, etapa_anterior: null, motivo_da_parada: null, mensagem: null }, agora), efeito: "nenhum" };
    }
    return { problema: "Só a emissão parada ou rejeitada se retoma." };
  }
  if (!["parada", "rejeitada"].includes(emissao.etapa)) return { problema: "Só a emissão parada ou rejeitada se desiste." };
  if (emissao.omie.os === null || emissao.motivo_da_parada === "cancelada_na_omie") {
    return { emissao: andou(emissao, { etapa: "desistida", etapa_anterior: null, motivo_da_parada: null, mensagem: null }, agora), efeito: "liberar_reservas" };
  }
  if (emissao.omie.nfse) {
    return { problema: `A NFS-e ${numeroDaNfse(emissao.omie.nfse)} foi autorizada e vale na prefeitura: cancele a nota na Omie e tente de novo antes de desistir.` };
  }
  return { emissao: andou(emissao, { etapa: "cancelando", etapa_anterior: null, motivo_da_parada: null, mensagem: null, conferir: true }, agora), efeito: "nenhum" };
}
