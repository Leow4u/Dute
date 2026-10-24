import { FALHAS_ATE_PARAR, dataDaOmie, type ConfiguracaoDaOmie, type PedidoDaOmie } from "./emissao-omie.js";
import type { FalhaDaOmie } from "./omie.js";

/**
 * A baixa na Omie, pura (parte 7.4g; desenho em
 * docs/plataforma/fase-7-financeiro-unificado.md, "A NFS-e pela Omie").
 *
 * O pagamento registrado na Dute de uma fatura que saiu pela Omie põe na
 * fila, na mesma transação, a baixa do título que a OS gerou lá: uma baixa
 * por pagamento (`nf_baixas`, o id sai do pagamento). A rotina da Omie lança
 * o recebimento no título (LancarRecebimento) com um código de integração
 * que também sai do pagamento; o estorno do pagamento cancela o recebimento
 * (CancelarRecebimento) pelo mesmo código.
 *
 * Antes de lançar e antes de cancelar, a rotina confere o título
 * (PesquisarLancamentos pela OS): se o recebimento com o código já está lá,
 * não lança de novo; se não está, não há o que cancelar. Assim a resposta
 * perdida (a Omie gravou, a Dute não soube) não duplica a baixa, qualquer
 * que seja o texto do erro. A falha espera e tenta de novo, e nunca desfaz o
 * recebimento na Dute: a baixa é só o espelho dele na Omie.
 */

export const BAIXAS_COLLECTION = "nf_baixas";

export const ETAPAS_DA_BAIXA = ["na_fila", "lancada", "cancelando", "cancelada", "parada", "dispensada"] as const;
export type EtapaDaBaixa = (typeof ETAPAS_DA_BAIXA)[number];

/** As etapas em que a rotina anda; nas outras, a baixa acabou ou espera uma pessoa. */
export const ETAPAS_DA_ROTINA_DA_BAIXA: readonly EtapaDaBaixa[] = ["na_fila", "cancelando"];

export const MOTIVOS_DA_PARADA_DA_BAIXA = [
  "titulo_nao_achado",
  "titulo_repetido",
  "titulo_liquidado",
  "sem_conta_corrente",
  "chave",
  "sem_chaves",
  "falhas_seguidas",
] as const;
export type MotivoDaParadaDaBaixa = (typeof MOTIVOS_DA_PARADA_DA_BAIXA)[number];

export const ID_DA_BAIXA = /^bxa_[a-f0-9]{24}$/;
const ID_DO_PAGAMENTO = /^pag_([a-f0-9]{24})$/;

function sufixoDoPagamento(pagamentoId: string): string {
  const match = ID_DO_PAGAMENTO.exec(pagamentoId);
  if (!match) throw new Error("Pagamento inválido.");
  return match[1];
}

/** A baixa do pagamento: o mesmo sufixo, uma só por pagamento. */
export function idDaBaixa(pagamentoId: string): string {
  return `bxa_${sufixoDoPagamento(pagamentoId)}`;
}

/** O código de integração do recebimento na Omie (até 20 caracteres): DUTE e 16 dígitos do pagamento. */
export function codigoDaBaixa(pagamentoId: string): string {
  return `DUTE${sufixoDoPagamento(pagamentoId).slice(0, 16)}`;
}

export type DadosDaBaixaNaOmie = {
  /** A OS da emissão (nCodOS): é por ela que o título é achado. */
  os: number;
  /** O título que a OS gerou (nCodTitulo). */
  titulo: number | null;
  /** A conta corrente do recebimento: a da configuração ou a do título. */
  conta_corrente: number | null;
  /** O recebimento lançado (codigo_baixa, nCodLanc na pesquisa). */
  baixa: number | null;
  /** Se o título ficou liquidado com o recebimento. */
  liquidado: boolean | null;
};

export type Baixa = {
  id: string;
  pagamento_id: string;
  fatura_id: string;
  emissao_id: string;
  customer_code: string;
  valor_cents: number;
  /** O dia do recebimento na Dute (AAAA-MM-DD). */
  recebido_em: string;
  /** O código de integração do recebimento na Omie. */
  codigo: string;
  etapa: EtapaDaBaixa;
  /** A etapa de onde a parada volta quando alguém retoma. */
  etapa_anterior: EtapaDaBaixa | null;
  motivo_da_parada: MotivoDaParadaDaBaixa | null;
  mensagem: string | null;
  /** O título conferido nesta etapa, depois da última falha: só então a rotina lança ou cancela. */
  conferida: boolean;
  omie: DadosDaBaixaNaOmie;
  tentativas: number;
  proxima_em: string;
  edicao: number;
};

export type PagamentoDaBaixa = Pick<Baixa, "pagamento_id" | "fatura_id" | "emissao_id" | "customer_code" | "valor_cents" | "recebido_em"> & { os: number };

export function novaBaixa(pagamento: PagamentoDaBaixa, agora: Date): Baixa {
  return {
    id: idDaBaixa(pagamento.pagamento_id),
    pagamento_id: pagamento.pagamento_id,
    fatura_id: pagamento.fatura_id,
    emissao_id: pagamento.emissao_id,
    customer_code: pagamento.customer_code,
    valor_cents: pagamento.valor_cents,
    recebido_em: pagamento.recebido_em,
    codigo: codigoDaBaixa(pagamento.pagamento_id),
    etapa: "na_fila",
    etapa_anterior: null,
    motivo_da_parada: null,
    mensagem: null,
    conferida: false,
    omie: { os: pagamento.os, titulo: null, conta_corrente: null, baixa: null, liquidado: null },
    tentativas: 0,
    proxima_em: agora.toISOString(),
    edicao: 1,
  };
}

function inteiroPositivo(valor: unknown): number | null {
  const numero = typeof valor === "string" && valor.trim() ? Number(valor) : valor;
  return typeof numero === "number" && Number.isSafeInteger(numero) && numero > 0 ? numero : null;
}

function textoOuNull(valor: unknown): string | null {
  return typeof valor === "string" && valor ? valor : null;
}

function lida(condicao: boolean): void {
  if (!condicao) throw new Error("Baixa ilegível.");
}

/**
 * A fatura que saiu pela Omie (a rotina da parte 7.4d grava `origem_nf`, a
 * emissão e a OS): só ela tem baixa. As outras, registradas à mão, ou de
 * antes da OS, devolvem null.
 */
export function osDaFatura(dados: Record<string, unknown>): { emissao_id: string; os: number } | null {
  if (dados.origem_nf !== "omie" || typeof dados.emissao_id !== "string" || !dados.emissao_id) return null;
  const os = inteiroPositivo(((dados.omie ?? {}) as Record<string, unknown>).os);
  return os === null ? null : { emissao_id: dados.emissao_id, os };
}

/** A baixa gravada, conferida campo a campo: a rotina e o estorno só trabalham com a baixa inteira. */
export function baixaLida(id: string, dados: Record<string, unknown>): Baixa {
  lida(ID_DA_BAIXA.test(id));
  lida((ETAPAS_DA_BAIXA as readonly string[]).includes(String(dados.etapa)));
  lida(typeof dados.pagamento_id === "string" && ID_DO_PAGAMENTO.test(dados.pagamento_id) && idDaBaixa(dados.pagamento_id) === id);
  lida(typeof dados.fatura_id === "string" && /^fat_[a-f0-9]{24}$/.test(dados.fatura_id));
  lida(typeof dados.emissao_id === "string" && dados.emissao_id.length > 0);
  lida(typeof dados.customer_code === "string" && dados.customer_code.length > 0);
  lida(typeof dados.valor_cents === "number" && Number.isSafeInteger(dados.valor_cents) && dados.valor_cents > 0);
  lida(typeof dados.recebido_em === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dados.recebido_em));
  lida(typeof dados.proxima_em === "string" && !Number.isNaN(Date.parse(dados.proxima_em)));
  lida(Number.isInteger(dados.edicao) && (dados.edicao as number) >= 1);
  const omie = (dados.omie ?? {}) as Record<string, unknown>;
  const os = inteiroPositivo(omie.os);
  lida(os !== null);
  const anterior = (ETAPAS_DA_BAIXA as readonly string[]).includes(String(dados.etapa_anterior)) ? (dados.etapa_anterior as EtapaDaBaixa) : null;
  const motivo = (MOTIVOS_DA_PARADA_DA_BAIXA as readonly string[]).includes(String(dados.motivo_da_parada)) ? (dados.motivo_da_parada as MotivoDaParadaDaBaixa) : null;
  return {
    id,
    pagamento_id: dados.pagamento_id as string,
    fatura_id: dados.fatura_id as string,
    emissao_id: dados.emissao_id as string,
    customer_code: dados.customer_code as string,
    valor_cents: dados.valor_cents as number,
    recebido_em: dados.recebido_em as string,
    codigo: codigoDaBaixa(dados.pagamento_id as string),
    etapa: dados.etapa as EtapaDaBaixa,
    etapa_anterior: anterior,
    motivo_da_parada: motivo,
    mensagem: textoOuNull(dados.mensagem),
    conferida: dados.conferida === true,
    omie: {
      os: os as number,
      titulo: inteiroPositivo(omie.titulo),
      conta_corrente: inteiroPositivo(omie.conta_corrente),
      baixa: inteiroPositivo(omie.baixa),
      liquidado: typeof omie.liquidado === "boolean" ? omie.liquidado : null,
    },
    tentativas: Number.isInteger(dados.tentativas) ? (dados.tentativas as number) : 0,
    proxima_em: dados.proxima_em as string,
    edicao: dados.edicao as number,
  };
}

// --- O passo ------------------------------------------------------------------------------

export type PassoDaBaixa = "conferir" | "lancar" | "cancelar";

/** O passo que a rotina dá agora, ou null quando a baixa acabou, espera uma pessoa ou ainda não é hora. */
export function passoDaBaixa(baixa: Baixa, agora: Date): PassoDaBaixa | null {
  if (!ETAPAS_DA_ROTINA_DA_BAIXA.includes(baixa.etapa)) return null;
  if (Date.parse(baixa.proxima_em) > agora.getTime()) return null;
  if (!baixa.conferida) return "conferir";
  return baixa.etapa === "na_fila" ? "lancar" : "cancelar";
}

/** Reais com duas casas, do jeito que a Omie lê o decimal. */
function reaisDaOmie(centavos: number): number {
  return Number((centavos / 100).toFixed(2));
}

export function pedidoDaBaixa(passo: PassoDaBaixa, baixa: Baixa): PedidoDaOmie {
  switch (passo) {
    case "conferir":
      return { servico: "financas/pesquisartitulos", call: "PesquisarLancamentos", param: { nPagina: 1, nRegPorPagina: 50, nCodOS: baixa.omie.os, cNatureza: "R" } };
    case "lancar":
      if (baixa.omie.titulo === null || baixa.omie.conta_corrente === null) throw new Error("O lançamento precisa do título e da conta corrente.");
      return {
        servico: "financas/contareceber",
        call: "LancarRecebimento",
        param: {
          codigo_lancamento: baixa.omie.titulo,
          codigo_baixa_integracao: baixa.codigo,
          codigo_conta_corrente: baixa.omie.conta_corrente,
          valor: reaisDaOmie(baixa.valor_cents),
          data: dataDaOmie(baixa.recebido_em),
          observacao: `Recebimento registrado na Dute (${baixa.pagamento_id}).`,
        },
      };
    case "cancelar":
      return {
        servico: "financas/contareceber",
        call: "CancelarRecebimento",
        param: baixa.omie.baixa !== null ? { codigo_baixa: baixa.omie.baixa } : { codigo_baixa_integracao: baixa.codigo },
      };
  }
}

// --- A resposta ---------------------------------------------------------------------------

const MINUTO = 60_000;

function depois(agora: Date, ms: number): string {
  return new Date(agora.getTime() + ms).toISOString();
}

function andou(baixa: Baixa, mudanca: Partial<Baixa>, agora: Date): Baixa {
  return {
    ...baixa,
    ...mudanca,
    omie: { ...baixa.omie, ...(mudanca.omie ?? {}) },
    tentativas: 0,
    proxima_em: mudanca.proxima_em ?? agora.toISOString(),
    edicao: baixa.edicao + 1,
  };
}

function parou(baixa: Baixa, motivo: MotivoDaParadaDaBaixa, mensagem: string, agora: Date): Baixa {
  return andou(baixa, { etapa: "parada", etapa_anterior: baixa.etapa, motivo_da_parada: motivo, mensagem, conferida: false }, agora);
}

/** A falha conta, espera o dobro a cada vez e para na sexta seguida; a próxima tentativa confere antes. */
function falhou(baixa: Baixa, motivo: MotivoDaParadaDaBaixa, mensagem: string, esperarMs: number, agora: Date): Baixa {
  const tentativas = baixa.tentativas + 1;
  if (tentativas >= FALHAS_ATE_PARAR) return { ...parou(baixa, motivo, mensagem, agora), tentativas };
  return { ...baixa, conferida: false, tentativas, mensagem, proxima_em: depois(agora, Math.max(esperarMs, 2 ** tentativas * MINUTO)), edicao: baixa.edicao + 1 };
}

type TituloNaOmie = { titulo: number; conta_corrente: number | null; liquidado: boolean; recebimentos: Array<{ codigo: number | null; integracao: string }> };

function lista(valor: unknown): Record<string, unknown>[] {
  return Array.isArray(valor) ? valor.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
}

/** Os títulos a receber da OS, fora os cancelados, com os recebimentos de cada um. */
function titulosDaOs(corpo: Record<string, unknown>, os: number): TituloNaOmie[] {
  return lista(corpo.titulosEncontrados).flatMap((item) => {
    const cabecalho = (item.cabecTitulo ?? {}) as Record<string, unknown>;
    const titulo = inteiroPositivo(cabecalho.nCodTitulo);
    if (titulo === null || inteiroPositivo(cabecalho.nCodOS) !== os) return [];
    if (String(cabecalho.cStatus ?? "").toUpperCase() === "CANCELADO") return [];
    const resumo = (item.resumo ?? {}) as Record<string, unknown>;
    return [
      {
        titulo,
        conta_corrente: inteiroPositivo(cabecalho.nCodCC),
        liquidado: String(resumo.cLiquidado ?? "").toUpperCase() === "S",
        recebimentos: lista(item.lancamentos).map((lancamento) => ({ codigo: inteiroPositivo(lancamento.nCodLanc), integracao: String(lancamento.cCodIntLanc ?? "").trim() })),
      },
    ];
  });
}

function oRecebimento(baixa: Baixa, titulos: readonly TituloNaOmie[]): { titulo: TituloNaOmie; codigo: number | null } | null {
  for (const titulo of titulos) {
    const achado = titulo.recebimentos.find((recebimento) => recebimento.integracao.toLowerCase() === baixa.codigo.toLowerCase());
    if (achado) return { titulo, codigo: achado.codigo };
  }
  return null;
}

/** O que a resposta da Omie faz com a baixa, no passo dado. */
export function comRespostaDaBaixa(baixa: Baixa, passo: PassoDaBaixa, corpo: Record<string, unknown>, agora: Date, configuracao: ConfiguracaoDaOmie): Baixa {
  if (passo === "lancar") {
    return andou(baixa, { etapa: "lancada", conferida: false, mensagem: null, omie: { ...baixa.omie, baixa: inteiroPositivo(corpo.codigo_baixa), liquidado: String(corpo.liquidado ?? "").toUpperCase() === "S" } }, agora);
  }
  if (passo === "cancelar") return andou(baixa, { etapa: "cancelada", conferida: false, mensagem: null }, agora);

  const titulos = titulosDaOs(corpo, baixa.omie.os);
  const recebimento = oRecebimento(baixa, titulos);
  if (baixa.etapa === "cancelando") {
    // Sem o recebimento com o código, não há o que desfazer na Omie.
    if (!recebimento) return andou(baixa, { etapa: "cancelada", conferida: false, mensagem: null }, agora);
    return comTituloConferido(baixa, { titulo: recebimento.titulo.titulo, baixa: recebimento.codigo ?? baixa.omie.baixa }, agora);
  }
  // A resposta da última tentativa se perdeu, mas a Omie gravou: está lançada.
  if (recebimento) {
    return andou(baixa, { etapa: "lancada", conferida: false, mensagem: null, omie: { ...baixa.omie, titulo: recebimento.titulo.titulo, baixa: recebimento.codigo, liquidado: recebimento.titulo.liquidado } }, agora);
  }
  if (!titulos.length) return falhou(baixa, "titulo_nao_achado", "O título da OS ainda não está na Omie.", 2 * MINUTO, agora);
  if (titulos.length > 1) return parou(baixa, "titulo_repetido", `A OS tem ${titulos.length} títulos a receber na Omie.`, agora);
  const [titulo] = titulos;
  if (titulo.liquidado) return parou(baixa, "titulo_liquidado", "O título da OS já está recebido na Omie, sem o recebimento da Dute.", agora);
  const contaCorrente = configuracao.conta_corrente ?? titulo.conta_corrente;
  if (contaCorrente === null) return parou(baixa, "sem_conta_corrente", "O título não tem conta corrente na Omie, e a configuração da Dute também não.", agora);
  return comTituloConferido(baixa, { titulo: titulo.titulo, conta_corrente: contaCorrente }, agora);
}

/** O título conferido: o passo seguinte lança ou cancela. As falhas seguem contando até a ação dar certo. */
function comTituloConferido(baixa: Baixa, omie: Partial<DadosDaBaixaNaOmie>, agora: Date): Baixa {
  return { ...andou(baixa, { conferida: true, mensagem: null, omie: { ...baixa.omie, ...omie } }, agora), tentativas: baixa.tentativas };
}

/**
 * A falha da chamada: a chave para; o limite só espera; o resto conta e a
 * próxima tentativa confere antes. O duplicado no lançamento também: se o
 * recebimento com o código está na Omie, a conferência o acha e a baixa
 * fica lançada.
 */
export function comFalhaDaBaixa(baixa: Baixa, falha: FalhaDaOmie, agora: Date): Baixa {
  if (falha.tipo === "chave") return parou(baixa, "chave", falha.mensagem, agora);
  if (falha.tipo === "limite") return { ...baixa, mensagem: falha.mensagem, proxima_em: depois(agora, falha.esperar_ms), edicao: baixa.edicao + 1 };
  return falhou(baixa, "falhas_seguidas", falha.mensagem, falha.esperar_ms, agora);
}

/** Sem as chaves da API no ambiente, a baixa que é hora de andar para e espera uma pessoa. */
export function baixaSemChaves(baixa: Baixa, agora: Date): Baixa {
  return parou(baixa, "sem_chaves", "As chaves da API da Omie não estão neste ambiente.", agora);
}

/**
 * O estorno do pagamento na Dute, na mesma transação: a baixa que pode ter
 * saído (o título já conferido, o lançamento feito ou tentado) vai a
 * cancelar na Omie; a que nunca conferiu o título não saiu nem está saindo,
 * porque a rotina só lança depois de conferir, e fica cancelada aqui. A que
 * acabou ou foi dispensada não muda (null).
 */
export function baixaNoEstorno(baixa: Baixa, agora: Date): Baixa | null {
  if (baixa.etapa !== "na_fila" && baixa.etapa !== "lancada" && baixa.etapa !== "parada") return null;
  const saiu = baixa.etapa === "lancada" || baixa.conferida || baixa.omie.titulo !== null;
  return andou(baixa, { etapa: saiu ? "cancelando" : "cancelada", etapa_anterior: null, motivo_da_parada: null, mensagem: null, conferida: false }, agora);
}

// --- As ações de uma pessoa (parte 7.4h) ----------------------------------------------------

export type AcaoNaBaixa = "retomar" | "dispensar";

/**
 * Retomar: a parada volta à etapa de onde parou (lançar ou cancelar), do
 * zero nas falhas, conferindo o título antes. Dispensar: a pessoa resolveu
 * na Omie à mão, e a baixa acaba sem a rotina. Só a parada tem ação.
 */
export function comAcaoNaBaixa(baixa: Baixa, acao: AcaoNaBaixa, agora: Date): Baixa | { problema: string } {
  if (baixa.etapa !== "parada") return { problema: acao === "retomar" ? "Só a baixa parada se retoma." : "Só a baixa parada se dispensa." };
  if (acao === "dispensar") return andou(baixa, { etapa: "dispensada", etapa_anterior: null, motivo_da_parada: null, mensagem: null, conferida: false }, agora);
  const volta = baixa.etapa_anterior && ETAPAS_DA_ROTINA_DA_BAIXA.includes(baixa.etapa_anterior) ? baixa.etapa_anterior : "na_fila";
  return andou(baixa, { etapa: volta, etapa_anterior: null, motivo_da_parada: null, mensagem: null, conferida: false }, agora);
}
