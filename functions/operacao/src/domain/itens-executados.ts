import { z } from "zod";

import type { ItemDoCatalogo } from "./demanda-direta.js";
import {
  chave,
  falha,
  horaEmSaoPaulo,
  informadoPor,
  instante,
  instanteDoRegistro,
  interpretar,
  invalid,
  meio,
  numero,
  origemDoRegistro,
  registroLido,
  type ContextoDoRegistro,
  type RegistroDaExecucao,
} from "./execucao.js";
import { deMilesimos, emMilesimos, itemLido, type ItemDaOs, type OsGravada } from "./os.js";

/**
 * Os itens executados da OS (docs/plataforma/fase-3-operacao.md, parte 3.7b).
 *
 * "Feito" é quanto da linha já foi executado, em número absoluto: o escritório
 * corrige para mais ou para menos, até o previsto da linha (o planejado mais o
 * que foi incluído em campo). Passar do previsto exige incluir: a inclusão
 * guarda a quantidade, quem pediu no local, o motivo e o instante, soma ao
 * feito e vira divergência na revisão (parte 3.10). Item que a OS não tinha
 * entra como linha nova, do catálogo ou avulsa, com o planejado zero. A
 * inclusão não mexe no saldo da demanda: só o planejado conta nele.
 * Nenhum campo de valor.
 */

export const MAX_INCLUSOES_POR_LINHA = 20;
export const MAX_LINHAS_DA_OS = 300;

const QUANTIDADE = /^\d{1,9}(\.\d{1,3})?$/;

export type Inclusao = RegistroDaExecucao & { quantidade: string; pedido_por: string; motivo: string };

export type ItemEmExecucao = ItemDaOs & {
  executado: string | null;
  /** Quando o feito foi informado pela última vez (UTC). */
  executado_em: string | null;
  incluidos: Inclusao[];
  /** A linha nasceu em campo (não estava no planejamento). */
  incluido_em_campo: boolean;
};

// --- Entrada ------------------------------------------------------------------------------

const quantidade = z.string().trim().regex(QUANTIDADE, "Quantidade inválida: use número com ponto e até 3 casas.");
const linha = z.string().trim().min(1, "Informe a linha.").max(64);

const Feito = z
  .object({ action: z.literal("executed"), idempotency_key: chave, numero, linha, executado: quantidade, instante, informado_por: informadoPor, meio })
  .strict();

const Incluido = z
  .object({
    action: z.literal("added"),
    idempotency_key: chave,
    numero,
    /** A linha da OS que ganha a inclusão... */
    linha: linha.optional(),
    /** ...ou o item do catálogo (vira linha nova se a OS não tiver)... */
    lpu_item_id: z.string().trim().min(1).max(120).optional(),
    /** ...ou o item avulso, com nome e unidade. */
    item: z.string().trim().min(2, "Item avulso: informe o nome.").max(160).optional(),
    unidade: z.string().trim().min(1).max(12).optional(),
    quantidade,
    pedido_por: z.string().trim().min(2, "Informe quem pediu no local.").max(120, "Use até 120 caracteres em quem pediu."),
    motivo: z.string().trim().min(3, "Informe o motivo.").max(300, "Use até 300 caracteres no motivo."),
    instante,
    informado_por: informadoPor,
    meio,
  })
  .strict()
  .refine((valor) => [valor.linha, valor.lpu_item_id, valor.item].filter(Boolean).length === 1, "Informe a linha da OS, o item do catálogo ou o item avulso (um deles).")
  .refine((valor) => !valor.item || Boolean(valor.unidade), "Item avulso: informe a unidade.");

export type PedidoDeFeito = z.infer<typeof Feito>;
export type PedidoDeInclusao = z.infer<typeof Incluido>;
export type PedidoDeItem = PedidoDeFeito | PedidoDeInclusao;

export function interpretarItem(data: unknown): PedidoDeItem {
  const acao = data && typeof data === "object" ? (data as Record<string, unknown>).action : undefined;
  if (acao === "executed") return interpretar(Feito, data);
  if (acao === "added") return interpretar(Incluido, data);
  invalid("action: use executed, added.");
}

// --- Regras -------------------------------------------------------------------------------

/** O previsto da linha em milésimos: o planejado mais o que foi incluído em campo. */
export function previsto(item: Pick<ItemEmExecucao, "planejado" | "incluidos">): number {
  return (emMilesimos(item.planejado) ?? 0) + item.incluidos.reduce((soma, inclusao) => soma + (emMilesimos(inclusao.quantidade) ?? 0), 0);
}

/** Os itens só recebem o feito com a OS em execução (a primeira etapa já registrada). */
function exigirEmExecucao(os: Pick<OsGravada, "status" | "tipo">): void {
  if (os.tipo === "vistoria") falha("A vistoria não tem itens da OS: os itens levantados vão no envio ao Comercial.");
  if (os.status === "em_execucao") return;
  if (os.status === "agendada") falha("Registre a primeira etapa antes dos itens.");
  if (os.status === "aberta") falha("Agende a OS antes de registrar o andamento.");
  if (os.status === "cancelada") falha("A OS está cancelada.");
  falha("A OS já foi concluída.");
}

function nomeDa(item: Pick<ItemDaOs, "item" | "descricao">): string {
  return item.item || item.descricao;
}

export type FeitoNaOs = {
  itens: ItemEmExecucao[];
  item: ItemEmExecucao;
  anterior: string | null;
  /** O registro do feito, para o evento: quando, por onde e quem informou. */
  registro: Pick<RegistroDaExecucao, "instante" | "canal" | "informado_por">;
};

/**
 * O feito da linha, em número absoluto, até o previsto. Passar dele pede a
 * inclusão. O feito com a hora de antes do último registrado na linha (o
 * celular que ficou sem sinal e enviou depois) não vale mais: é recusado.
 */
export function registrarFeito(os: OsGravada, itens: readonly ItemEmExecucao[], pedido: PedidoDeFeito, contexto: ContextoDoRegistro): FeitoNaOs {
  exigirEmExecucao(os);
  const atual = itens.find((item) => item.id === pedido.linha);
  if (!atual) invalid("O item não está na OS.");
  const quando = instanteDoRegistro(pedido.instante, os, contexto.agora);
  if (atual.executado_em && quando < atual.executado_em) {
    falha(`${nomeDa(atual)}: o feito das ${horaEmSaoPaulo(quando)} é de antes do último registrado (${atual.executado ?? "0"}, às ${horaEmSaoPaulo(atual.executado_em)}).`);
  }
  const feito = emMilesimos(pedido.executado) ?? 0;
  const limite = previsto(atual);
  if (feito > limite) {
    falha(`${nomeDa(atual)}: o feito (${pedido.executado}) passa do previsto (${deMilesimos(limite)}). Inclua o que foi além do planejado.`);
  }
  const { informado_por } = origemDoRegistro(os, pedido, contexto);
  const item: ItemEmExecucao = { ...atual, executado: deMilesimos(feito), executado_em: quando };
  return {
    itens: itens.map((existente) => (existente.id === item.id ? item : existente)),
    item,
    anterior: atual.executado,
    registro: { instante: quando, canal: contexto.canal, informado_por },
  };
}

export type InclusaoNaOs = { itens: ItemEmExecucao[]; item: ItemEmExecucao; inclusao: Inclusao; nova: boolean };

/**
 * Inclui o executado além do planejado: na linha da OS, na linha do mesmo
 * item do catálogo ou numa linha nova (do catálogo ou avulsa, com o id dado
 * pela gravação). Soma ao feito.
 */
export function registrarInclusao(
  os: OsGravada,
  itens: readonly ItemEmExecucao[],
  pedido: PedidoDeInclusao,
  contexto: ContextoDoRegistro,
  entrada: { catalogo: ItemDoCatalogo | null; idDaLinhaNova: string },
): InclusaoNaOs {
  exigirEmExecucao(os);
  const quantidadeIncluida = emMilesimos(pedido.quantidade) ?? 0;
  if (quantidadeIncluida <= 0) invalid("A quantidade incluída é maior que zero.");
  const quando = instanteDoRegistro(pedido.instante, os, contexto.agora);
  const inclusao: Inclusao = {
    quantidade: deMilesimos(quantidadeIncluida),
    pedido_por: pedido.pedido_por,
    motivo: pedido.motivo,
    instante: quando,
    canal: contexto.canal,
    ...origemDoRegistro(os, pedido, contexto),
    registrado_por: contexto.registrado_por,
    registrado_em: contexto.agora.toISOString(),
  };

  let atual: ItemEmExecucao | undefined;
  if (pedido.linha) {
    atual = itens.find((item) => item.id === pedido.linha);
    if (!atual) invalid("O item não está na OS.");
  } else if (pedido.lpu_item_id) {
    const doCatalogo = entrada.catalogo;
    if (!doCatalogo || doCatalogo.id !== pedido.lpu_item_id) falha(`O item ${pedido.lpu_item_id} não está no catálogo.`);
    if (!doCatalogo.ativo) falha(`O item ${doCatalogo.item} está inativo no catálogo.`);
    atual = itens.find((item) => item.lpu_item_id === doCatalogo.id);
  }

  if (atual) {
    if (atual.incluidos.length >= MAX_INCLUSOES_POR_LINHA) falha(`${nomeDa(atual)}: a linha já tem ${MAX_INCLUSOES_POR_LINHA} inclusões.`);
    const item: ItemEmExecucao = {
      ...atual,
      incluidos: [...atual.incluidos, inclusao],
      executado: deMilesimos((emMilesimos(atual.executado ?? "0") ?? 0) + quantidadeIncluida),
      // A inclusão soma; a que chega atrasada não volta a hora do último feito.
      executado_em: atual.executado_em && atual.executado_em > quando ? atual.executado_em : quando,
    };
    return { itens: itens.map((existente) => (existente.id === item.id ? item : existente)), item, inclusao, nova: false };
  }

  if (itens.length >= MAX_LINHAS_DA_OS) falha(`A OS já tem ${MAX_LINHAS_DA_OS} linhas.`);
  const doCatalogo = entrada.catalogo;
  const nome = doCatalogo ? doCatalogo.item : (pedido.item ?? "");
  const item: ItemEmExecucao = {
    id: entrada.idDaLinhaNova,
    lpu_item_id: doCatalogo?.id ?? null,
    codigo: null,
    item: nome,
    descricao: doCatalogo ? doCatalogo.descricao || doCatalogo.item : nome,
    servico: doCatalogo?.servico || null,
    unidade: doCatalogo ? doCatalogo.unidade || null : (pedido.unidade ?? null),
    planejado: "0",
    origem_local: null,
    destino_local: null,
    executado: inclusao.quantidade,
    executado_em: quando,
    incluidos: [inclusao],
    incluido_em_campo: true,
  };
  return { itens: [...itens, item], item, inclusao, nova: true };
}

// --- Leitura ------------------------------------------------------------------------------

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

/** Os itens gravados na OS com o que a execução guardou neles. */
export function itensEmExecucao(data: Record<string, unknown>): ItemEmExecucao[] {
  if (!Array.isArray(data.itens)) return [];
  return data.itens.map((bruto) => {
    const base = itemLido(bruto);
    const item = bruto as Record<string, unknown>;
    const executado = texto(item.executado);
    const incluidos = (Array.isArray(item.incluidos) ? item.incluidos : []).flatMap((cru): Inclusao[] => {
      if (!cru || typeof cru !== "object") return [];
      const inclusao = cru as Record<string, unknown>;
      const registro = registroLido(inclusao);
      const quantidadeLida = texto(inclusao.quantidade);
      if (!registro || emMilesimos(quantidadeLida) === null) return [];
      return [{ ...registro, quantidade: quantidadeLida, pedido_por: texto(inclusao.pedido_por), motivo: texto(inclusao.motivo) }];
    });
    return {
      ...base,
      executado: emMilesimos(executado) === null ? null : executado,
      executado_em: texto(item.executado_em) || null,
      incluidos,
      incluido_em_campo: item.incluido_em_campo === true,
    };
  });
}
