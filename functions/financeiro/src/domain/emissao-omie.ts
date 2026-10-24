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
  "falhas_seguidas",
  "cancelada_na_omie",
  "prefeitura_demorou",
] as const;
export type MotivoDaParada = (typeof MOTIVOS_DA_PARADA)[number];

export const ID_DA_EMISSAO = /^nfe_[a-f0-9]{20}$/;

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
  /** A rotina só chama a Omie para esta emissão a partir daqui (ISO, UTC). */
  proxima_em: string;
  /** Quando a OS foi faturada: o relógio da prefeitura. */
  faturada_em: string | null;
  edicao: number;
};

export function totalDaEmissao(emissao: Pick<Emissao, "itens">): number {
  return emissao.itens.reduce((soma, item) => soma + item.valor_cents, 0);
}

// --- O passo ------------------------------------------------------------------------------

export type Passo = "achar_cliente" | "incluir_os" | "conferir_ambiente" | "faturar_os" | "acompanhar" | "reenviar_os" | "cancelar_os";

/** O passo que a rotina dá agora, ou null quando a emissão espera uma pessoa, já acabou ou ainda não é hora. */
export function passoDaEmissao(emissao: Emissao, agora: Date): Passo | null {
  if (!ETAPAS_DA_ROTINA.includes(emissao.etapa)) return null;
  if (Date.parse(emissao.proxima_em) > agora.getTime()) return null;
  switch (emissao.etapa) {
    case "na_fila":
      return emissao.omie.cliente === null ? "achar_cliente" : "incluir_os";
    case "os_incluida":
      return emissao.omie.ambiente === null || emissao.omie.os === null ? "conferir_ambiente" : "faturar_os";
    case "na_prefeitura":
      return "acompanhar";
    case "reenviando":
      return "reenviar_os";
    case "cancelando":
      return "cancelar_os";
    default:
      return null;
  }
}

export type PedidoDaOmie = { servico: ServicoDaOmie; call: string; param: Record<string, unknown> };

/** "2026-10-24" → "24/10/2026", o formato das datas da Omie. */
export function dataDaOmie(dia: string): string {
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`;
}

export function cnpjFormatado(digitos: string): string {
  return /^\d{14}$/.test(digitos)
    ? `${digitos.slice(0, 2)}.${digitos.slice(2, 5)}.${digitos.slice(5, 8)}/${digitos.slice(8, 12)}-${digitos.slice(12)}`
    : digitos;
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
  return {
    ...emissao,
    ...mudanca,
    omie: { ...emissao.omie, ...(mudanca.omie ?? {}) },
    tentativas: 0,
    proxima_em: mudanca.proxima_em ?? agora.toISOString(),
    edicao: emissao.edicao + 1,
  };
}

function parou(emissao: Emissao, motivo: MotivoDaParada, mensagem: string, agora: Date): Emissao {
  return andou(emissao, { etapa: "parada", etapa_anterior: emissao.etapa, motivo_da_parada: motivo, mensagem }, agora);
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
 * espera (AMBIENTE_DA_OMIE); `consultas` conta as idas à prefeitura, para o
 * intervalo.
 */
export function comResposta(
  emissao: Emissao,
  passo: Passo,
  corpo: Record<string, unknown>,
  contexto: { agora: Date; ambiente: AmbienteDaOmie; consultas: number },
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
      // A OS já faturada (a rotina caiu entre o FaturarOS e a gravação) segue para a prefeitura.
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
        return {
          emissao: andou(
            emissao,
            {
              etapa: "autorizada",
              mensagem: null,
              mensagens_da_prefeitura: [],
              omie: {
                ...emissao.omie,
                nfse: soDigitos(rps.nNfse) || texto(rps.nNfse),
                codigo_verificacao: texto(rps.cCodVerif) || null,
                url_nfse: texto(rps.cUrlNfse) || null,
                url_pdf: texto(rps.cUrlPdfDest) || texto(rps.cUrlPdfDemo) || null,
              },
            },
            agora,
          ),
          efeito: "registrar_fatura",
        };
      }
      if (status === "003" && rps) {
        const mensagens = mensagensDaRps(rps);
        return {
          emissao: andou(emissao, { etapa: "rejeitada", mensagem: mensagens[0]?.descricao || "A prefeitura recusou a NFS-e.", mensagens_da_prefeitura: mensagens }, agora),
          efeito: "nenhum",
        };
      }
      const desde = Date.parse(emissao.faturada_em ?? emissao.proxima_em);
      if (agora.getTime() - desde > HORAS_NA_PREFEITURA * 60 * MINUTO) {
        return { emissao: parou(emissao, "prefeitura_demorou", `A prefeitura não respondeu em ${HORAS_NA_PREFEITURA} horas.`, agora), efeito: "nenhum" };
      }
      return { emissao: andou(emissao, { proxima_em: depois(agora, esperaNaPrefeitura(contexto.consultas) * MINUTO) }, agora), efeito: "nenhum" };
    }
    case "cancelar_os":
      return { emissao: andou(emissao, { etapa: "desistida", mensagem: null }, agora), efeito: "liberar_reservas" };
  }
}

/**
 * A falha da Omie aplicada à emissão. A chave inválida para a emissão (e a
 * rotina para de chamar a Omie). O limite só espera. O duplicado na inclusão
 * é a OS que já existe: segue para conferir. O resto conta como falha
 * seguida, com o intervalo dobrando, e para na sexta.
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
  if (tentativas >= FALHAS_ATE_PARAR) {
    return { ...parou(emissao, "falhas_seguidas", falha.mensagem, agora), tentativas };
  }
  return { ...emissao, tentativas, mensagem: falha.mensagem, proxima_em: depois(agora, Math.max(falha.esperar_ms, 2 ** tentativas * MINUTO)), edicao: emissao.edicao + 1 };
}

// --- As ações de uma pessoa ---------------------------------------------------------------

export type AcaoNaEmissao = "retomar" | "desistir";

/**
 * Retomar: a parada volta à etapa de onde parou, do zero nas falhas; a
 * rejeitada reenvia a RPS (a pessoa corrigiu na Omie). Desistir: com a OS
 * na Omie, cancela lá antes de liberar; sem ela, libera na hora.
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
  if (emissao.omie.os !== null && emissao.motivo_da_parada !== "cancelada_na_omie") {
    return { emissao: andou(emissao, { etapa: "cancelando", etapa_anterior: null, motivo_da_parada: null, mensagem: null }, agora), efeito: "nenhum" };
  }
  return { emissao: andou(emissao, { etapa: "desistida", etapa_anterior: null, motivo_da_parada: null, mensagem: null }, agora), efeito: "liberar_reservas" };
}
