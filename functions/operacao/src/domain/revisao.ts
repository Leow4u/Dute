import { HttpsError } from "firebase-functions/https";
import { z } from "zod";

import { conclusaoLida } from "./conclusao.js";
import { chave, falha, interpretar, invalid, numero, type EtapaRegistrada, type QuemRegistrou } from "./execucao.js";
import { previsto, type ItemEmExecucao } from "./itens-executados.js";
import { deMilesimos, emMilesimos, type OsGravada } from "./os.js";

/**
 * A revisão interna da OS (docs/plataforma/fase-3-operacao.md, parte 3.10a;
 * docs/mockups/OpRevisao.dc.html). A coordenação confere o que o campo
 * concluiu e decide cada divergência entre o planejado e o executado:
 *
 * - Feito a mais: cobrar na execução (na demanda direta, ou quando o saldo
 *   livre do escopo cobre), pedir aditivo ao Comercial (demanda com escopo
 *   fechado) ou absorver sem cobrar, com motivo.
 * - Feito a menos: passar para a próxima OS (o que falta volta ao saldo) ou
 *   encerrar sem executar.
 * - Antes de decidir, o executado pode ser corrigido, com motivo (a contagem
 *   do campo estava errada); a divergência é a que resta.
 *
 * Cada linha guarda o `consumido`: quanto do saldo da demanda a OS levou,
 * que é o que o saldo passa a contar (o planejado continua guardado, para a
 * IA medir o erro do planejamento). E o `a_cobrar`: o que a execução fatura.
 * Divergência sem decisão não conclui a revisão. Nenhum campo de valor.
 */

/** O tempo real que ainda é de uma ida a campo, em minutos (cerca de 69 dias); acima disso, a revisão não grava o tempo. */
export const MINUTOS_REAIS_PLAUSIVEIS = 100_000;

export const DECISOES_A_MAIS = ["cobrar", "aditivo", "absorver"] as const;
export const DECISOES_A_MENOS = ["proxima_os", "encerrar"] as const;
export const DECISOES = [...DECISOES_A_MAIS, ...DECISOES_A_MENOS] as const;
export type DecisaoDaRevisao = (typeof DECISOES)[number];

export const DECISAO_ROTULO: Record<DecisaoDaRevisao, string> = {
  cobrar: "Cobrar na execução",
  aditivo: "Pedir aditivo ao Comercial",
  absorver: "Absorver sem cobrar",
  proxima_os: "Passar para a próxima OS",
  encerrar: "Encerrar sem executar",
};

export const MAX_NOTA = 1000;
export const MAX_MOTIVO = 300;

const QUANTIDADE = /^\d{1,9}(\.\d{1,3})?$/;

// --- Entrada ------------------------------------------------------------------------------

const motivo = z.string().trim().min(3, "Informe o motivo.").max(MAX_MOTIVO, `Use até ${MAX_MOTIVO} caracteres no motivo.`);

const LinhaRevisada = z
  .object({
    linha: z.string().trim().min(1, "Informe a linha.").max(64),
    /** O executado corrigido (a contagem do campo estava errada). */
    executado: z.string().trim().regex(QUANTIDADE, "Quantidade inválida: use número com ponto e até 3 casas.").optional(),
    motivo_da_correcao: motivo.optional(),
    decisao: z.enum(DECISOES).optional(),
    motivo: motivo.optional(),
  })
  .strict();

const Revisar = z
  .object({
    idempotency_key: chave,
    numero,
    linhas: z.array(LinhaRevisada).max(300).optional().transform((valor) => valor ?? []),
    nota: z.string().trim().max(MAX_NOTA, `Use até ${MAX_NOTA} caracteres na nota.`).optional(),
  })
  .strict();

const Reabrir = z
  .object({
    idempotency_key: chave,
    numero,
    motivo: z.string().trim().min(3, "Informe o motivo da reabertura.").max(MAX_MOTIVO, `Use até ${MAX_MOTIVO} caracteres no motivo.`),
  })
  .strict();

export type PedidoDeRevisao = z.infer<typeof Revisar>;
export type PedidoDeReabertura = z.infer<typeof Reabrir>;

export function interpretarRevisao(data: unknown): PedidoDeRevisao {
  return interpretar(Revisar, data);
}

export function interpretarReabertura(data: unknown): PedidoDeReabertura {
  return interpretar(Reabrir, data);
}

// --- Regras -------------------------------------------------------------------------------

export type LinhaDaRevisao = {
  linha: string;
  lpu_item_id: string | null;
  item: string;
  unidade: string | null;
  planejado: string;
  /** O feito que o campo registrou. */
  executado: string;
  /** O feito corrigido na revisão, ou null. */
  corrigido: string | null;
  motivo_da_correcao: string | null;
  /** O executado (corrigido) menos o planejado. */
  diferenca: string;
  sinal: "a_mais" | "a_menos" | "igual";
  decisao: DecisaoDaRevisao | null;
  motivo: string | null;
  /** Quanto do saldo da demanda a OS levou. */
  consumido: string;
  /** O que a execução fatura desta linha. */
  a_cobrar: string;
};

export type AditivoPedido = { os: string; linha: string; lpu_item_id: string | null; item: string; unidade: string | null; quantidade: string };

export type RevisaoDaOs = {
  instante: string;
  registrado_por: QuemRegistrou;
  /** A janela da OS, em minutos (null sem início e fim). */
  minutos_planejados: number | null;
  /** Da primeira etapa à conclusão, em minutos. */
  minutos_reais: number | null;
  pessoas: number;
  linhas: LinhaDaRevisao[];
  aditivo: AditivoPedido[];
  nota: string | null;
};

/** O contexto da demanda para a decisão: se é direta e o saldo livre de cada linha do escopo (sem esta OS). */
export type DemandaParaRevisao = { direta: boolean; saldoLivre: ReadonlyMap<string, number> };

function nomeDa(item: Pick<ItemEmExecucao, "item" | "descricao">): string {
  return item.item || item.descricao;
}

function minutosDaJanela(janela: OsGravada["janela"]): number | null {
  if (!janela?.inicio || !janela.fim) return null;
  const [hi, mi] = janela.inicio.split(":").map(Number);
  const [hf, mf] = janela.fim.split(":").map(Number);
  const minutos = hf * 60 + mf - (hi * 60 + mi);
  return minutos > 0 ? minutos : null;
}

/**
 * Revisa a OS em revisão: cada linha que diverge (depois da correção) leva
 * uma decisão válida para o sinal dela; linha sem divergência não leva
 * decisão. Devolve a revisão, os itens com o consumido e o pedido de aditivo.
 */
export function revisarOs(
  os: OsGravada,
  entrada: { itens: readonly ItemEmExecucao[]; etapas: readonly EtapaRegistrada[]; conclusao: { instante: string } | null; demanda: DemandaParaRevisao },
  pedido: PedidoDeRevisao,
  contexto: { agora: Date; registrado_por: QuemRegistrou },
): { revisao: RevisaoDaOs; itens: Array<ItemEmExecucao & { consumido: string }> } {
  if (os.status !== "em_revisao") {
    if (os.status === "revisada") falha("A OS já foi revisada.");
    if (os.status === "cancelada") falha("A OS está cancelada.");
    falha("Conclua a OS antes de revisar.");
  }
  const porLinha = new Map<string, PedidoDeRevisao["linhas"][number]>();
  for (const informada of pedido.linhas) {
    if (porLinha.has(informada.linha)) invalid("Informe cada linha uma vez só.");
    if (!entrada.itens.some((item) => item.id === informada.linha)) invalid("O item não está na OS.");
    porLinha.set(informada.linha, informada);
  }

  const linhas: LinhaDaRevisao[] = [];
  const aditivo: AditivoPedido[] = [];
  const itens = entrada.itens.map((item) => {
    const informada = porLinha.get(item.id);
    const nome = nomeDa(item);
    const planejado = emMilesimos(item.planejado) ?? 0;
    const registrado = emMilesimos(item.executado ?? "0") ?? 0;
    let executado = registrado;
    if (informada?.executado !== undefined) {
      const corrigido = emMilesimos(informada.executado) ?? 0;
      if (corrigido === registrado) invalid(`${nome}: a quantidade corrigida é a mesma do campo.`);
      if (corrigido > previsto(item)) invalid(`${nome}: a quantidade corrigida passa do previsto (${deMilesimos(previsto(item))}).`);
      if (!informada.motivo_da_correcao) invalid(`${nome}: informe o motivo da correção.`);
      executado = corrigido;
    } else if (informada?.motivo_da_correcao) {
      invalid(`${nome}: o motivo da correção vai com a quantidade corrigida.`);
    }
    const diferenca = executado - planejado;
    const sinal = diferenca > 0 ? "a_mais" : diferenca < 0 ? "a_menos" : "igual";
    const decisao = informada?.decisao ?? null;

    if (sinal === "igual" && decisao) invalid(`${nome} não diverge: não leva decisão.`);
    if (sinal !== "igual" && !decisao) {
      invalid(`${nome}: decida a divergência (${diferenca > 0 ? "+" : "−"}${deMilesimos(Math.abs(diferenca))}).`);
    }
    if (sinal === "a_mais" && decisao && !(DECISOES_A_MAIS as readonly string[]).includes(decisao)) {
      invalid(`${nome}: o feito a mais se cobra na execução, vai para aditivo ou se absorve.`);
    }
    if (sinal === "a_menos" && decisao && !(DECISOES_A_MENOS as readonly string[]).includes(decisao)) {
      invalid(`${nome}: o feito a menos passa para a próxima OS ou se encerra.`);
    }
    if (decisao === "absorver" && !informada?.motivo) invalid(`${nome}: informe por que absorver sem cobrar.`);
    if (decisao === "aditivo" && entrada.demanda.direta) {
      invalid(`${nome}: a demanda direta orça a execução inteira; cobre na execução.`);
    }
    if (decisao === "cobrar" && !entrada.demanda.direta) {
      const livre = entrada.demanda.saldoLivre.get(item.id);
      if (livre === undefined) falha(`${nome} não está no escopo fechado: peça aditivo ou absorva.`);
      if (diferenca > livre) falha(`${nome}: o saldo livre da demanda é ${deMilesimos(Math.max(livre, 0))}; o que passa dele vai para aditivo.`);
    }
    if (decisao === "proxima_os" && !entrada.demanda.saldoLivre.has(item.id)) invalid(`${nome} não está no escopo da demanda: encerre.`);

    // O saldo conta o consumido; a execução fatura o a cobrar.
    const consumido = decisao === "cobrar" || decisao === "proxima_os" ? executado : planejado;
    const aCobrar = sinal === "a_mais" && decisao !== "cobrar" ? planejado : executado;
    if (decisao === "aditivo") {
      aditivo.push({ os: os.numero, linha: item.id, lpu_item_id: item.lpu_item_id, item: nome, unidade: item.unidade, quantidade: deMilesimos(diferenca) });
    }
    linhas.push({
      linha: item.id,
      lpu_item_id: item.lpu_item_id,
      item: nome,
      unidade: item.unidade,
      planejado: deMilesimos(planejado),
      executado: deMilesimos(registrado),
      corrigido: informada?.executado !== undefined ? deMilesimos(executado) : null,
      motivo_da_correcao: informada?.motivo_da_correcao ?? null,
      diferenca: `${diferenca < 0 ? "-" : ""}${deMilesimos(Math.abs(diferenca))}`,
      sinal,
      decisao,
      motivo: informada?.motivo ?? null,
      consumido: deMilesimos(consumido),
      a_cobrar: deMilesimos(aCobrar),
    });
    return { ...item, consumido: deMilesimos(consumido) };
  });

  const primeira = entrada.etapas[0]?.instante ?? null;
  const fim = entrada.conclusao?.instante ?? entrada.etapas.at(-1)?.instante ?? null;
  const decorridos = primeira && fim ? Math.max(0, Math.round((Date.parse(fim) - Date.parse(primeira)) / 60_000)) : null;
  // A OS é uma ida a campo. Mais que MINUTOS_REAIS_PLAUSIVEIS é a OS reaberta
  // meses depois (as etapas ficam) ou esquecida aberta: sem tempo real, e a
  // memória (o erro do planejamento) não conta a OS.
  const minutosReais = decorridos !== null && decorridos <= MINUTOS_REAIS_PLAUSIVEIS ? decorridos : null;
  return {
    revisao: {
      instante: contexto.agora.toISOString(),
      registrado_por: contexto.registrado_por,
      minutos_planejados: minutosDaJanela(os.janela),
      minutos_reais: minutosReais,
      pessoas: os.equipe.length,
      linhas,
      aditivo,
      nota: pedido.nota ? pedido.nota : null,
    },
    itens,
  };
}

/** Quem reabre a OS revisada: só owner e admin. */
export function exigirQuemReabre(role: string): void {
  if (role !== "owner" && role !== "admin") throw new HttpsError("permission-denied", "Só owner e admin reabrem a OS revisada.");
}

// --- Resumo na demanda --------------------------------------------------------------------

export type ResumoDaOperacao = {
  /** As OS revisadas da demanda. */
  os_revisadas: string[];
  /** As OS que ainda não foram revisadas nem canceladas. */
  os_em_aberto: string[];
  /** O dia da primeira e da última OS revisada (São Paulo), ou null. */
  periodo: { de: string; ate: string } | null;
  /** Por linha, somado nas OS revisadas: o executado, o que se cobra, o que se absorveu e o que foi para aditivo. */
  itens: Array<{ linha: string; lpu_item_id: string | null; item: string; unidade: string | null; executado: string; a_cobrar: string; absorvido: string; aditivo: string }>;
  /** O que a revisão pediu de aditivo ao Comercial. */
  aditivo: Array<AditivoPedido & { pedido_em: string }>;
  atualizado_em: string;
};

export type OsParaResumo = { numero: string; status: string; janela: OsGravada["janela"]; data: Record<string, unknown> };

/** As OS de serviço da demanda para o resumo, com a OS `numero` no estado novo: a vistoria (parte 3.11a) não executa o escopo e fica de fora. */
export function paraResumo(
  ordens: readonly OsGravada[],
  brutos: ReadonlyMap<string, Record<string, unknown>>,
  numero: string,
  status: string,
  dados: Record<string, unknown>,
): OsParaResumo[] {
  return ordens.filter((os) => os.tipo !== "vistoria").map((os) =>
    os.numero === numero ? { numero, status, janela: os.janela, data: dados } : { numero: os.numero, status: os.status, janela: os.janela, data: brutos.get(os.numero) ?? {} },
  );
}

function dataEmSaoPaulo(instante: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(instante));
}

/** A revisão gravada na OS, ou null. */
export function revisaoLida(data: Record<string, unknown>): RevisaoDaOs | null {
  const bruto = data.revisao;
  if (!bruto || typeof bruto !== "object") return null;
  const revisao = bruto as Record<string, unknown>;
  if (typeof revisao.instante !== "string" || !Array.isArray(revisao.linhas)) return null;
  return revisao as unknown as RevisaoDaOs;
}

/**
 * O resumo que a Operação grava na demanda (`demands/{numero}.operacao`):
 * recontado a cada revisão a partir de todas as OS da demanda. O Comercial
 * só lê.
 */
export function resumoDaOperacao(ordens: readonly OsParaResumo[], agora: Date): ResumoDaOperacao {
  const revisadas = ordens.filter((os) => os.status === "revisada");
  const porLinha = new Map<string, ResumoDaOperacao["itens"][number] & { m: [number, number, number, number] }>();
  const aditivo: ResumoDaOperacao["aditivo"] = [];
  const dias: string[] = [];
  for (const os of revisadas) {
    const revisao = revisaoLida(os.data);
    if (!revisao) continue;
    const conclusao = conclusaoLida(os.data);
    dias.push(os.janela?.data ?? dataEmSaoPaulo(conclusao?.instante ?? revisao.instante));
    for (const linha of revisao.linhas) {
      const atual = porLinha.get(linha.linha) ?? {
        linha: linha.linha,
        lpu_item_id: linha.lpu_item_id,
        item: linha.item,
        unidade: linha.unidade,
        executado: "0",
        a_cobrar: "0",
        absorvido: "0",
        aditivo: "0",
        m: [0, 0, 0, 0] as [number, number, number, number],
      };
      const executado = emMilesimos(linha.corrigido ?? linha.executado) ?? 0;
      const aCobrar = emMilesimos(linha.a_cobrar) ?? 0;
      const diferenca = Math.max(0, executado - (emMilesimos(linha.planejado) ?? 0));
      atual.m[0] += executado;
      atual.m[1] += aCobrar;
      if (linha.decisao === "absorver") atual.m[2] += diferenca;
      if (linha.decisao === "aditivo") atual.m[3] += diferenca;
      porLinha.set(linha.linha, atual);
    }
    for (const pedido of revisao.aditivo ?? []) aditivo.push({ ...pedido, pedido_em: revisao.instante });
  }
  dias.sort();
  return {
    os_revisadas: revisadas.map((os) => os.numero).sort(),
    os_em_aberto: ordens.filter((os) => os.status !== "revisada" && os.status !== "cancelada").map((os) => os.numero).sort(),
    periodo: dias.length ? { de: dias[0], ate: dias.at(-1) as string } : null,
    itens: [...porLinha.values()].map(({ m, ...linha }) => ({
      ...linha,
      executado: deMilesimos(m[0]),
      a_cobrar: deMilesimos(m[1]),
      absorvido: deMilesimos(m[2]),
      aditivo: deMilesimos(m[3]),
    })),
    aditivo,
    atualizado_em: agora.toISOString(),
  };
}

/**
 * A demanda direta aberta pela Operação vai à Execução a orçar quando a
 * última OS dela é revisada (nenhuma em aberto): é o mesmo `executado_de` e
 * `executado_ate` que o Comercial lê (etapaDaDemanda, parte 3.4c).
 */
export function diretaExecutada(demanda: Record<string, unknown>, resumo: ResumoDaOperacao): boolean {
  return demanda.entrada === "direta" && demanda.aberta_pela === "operacao" && demanda.etapa === "para_planejar" && resumo.os_em_aberto.length === 0 && resumo.periodo !== null;
}

/** O que muda na demanda direta executada: o período, o registro, a etapa e o marco. */
export function fechamentoDaDireta(demanda: Record<string, unknown>, periodo: { de: string; ate: string }, iso: string, uid: string): Record<string, unknown> {
  return {
    executado_de: periodo.de,
    executado_ate: periodo.ate,
    registro_execucao: { etapa_antes: "para_planejar", rv: null, em: iso, por_uid: uid, origem: "operacao" },
    etapa: "execucao_a_orcar",
    etapa_desde: iso,
    marcos: [...(Array.isArray(demanda.marcos) ? demanda.marcos : []), { etapa: "execucao_a_orcar", em: iso, por_uid: uid }],
  };
}
