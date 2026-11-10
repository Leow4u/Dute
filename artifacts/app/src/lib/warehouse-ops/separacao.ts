import { quantidadeDoItem, type GrupoDaLista } from "./lista-de-separacao";
import type { WarehouseTask, WarehouseTaskItem } from "./model";
import { volumesDaLinhaGravados } from "./volumes-do-pedido";

/**
 * Separar com o progresso salvo (docs/plataforma/separacao-com-caixas.md,
 * partes 2 e 5; docs/mockups/WmsSepararBancada.dc.html): o que a bancada e a
 * fila de Pedidos dizem de um pedido em separação. Só leitura e texto: quem
 * grava é o servidor (functions/wms, domain/pick-progress.ts).
 */

/** O endereço da bancada do pedido: o pedido vai na busca, como na lista. */
export const ROTA_DA_BANCADA = "/pedidos/separar";

export function hrefDaBancada(pedido: string): string {
  return `${ROTA_DA_BANCADA}?pedido=${encodeURIComponent(pedido)}`;
}

/** O id da tarefa de separação no servidor: a fila a traz como "picking:<id>". */
export function idDaTarefaDeSeparacao(tarefa: Pick<WarehouseTask, "id"> | undefined): string | null {
  const id = String(tarefa?.id ?? "").replace(/^picking:/, "").trim();
  return id || null;
}

/** Os motivos da diferença, os mesmos do servidor (short-pick.ts). */
export const MOTIVOS_DA_DIFERENCA = [
  { valor: "falta", rotulo: "Falta" },
  { valor: "avaria", rotulo: "Avaria" },
] as const;

export type MotivoDaDiferenca = (typeof MOTIVOS_DA_DIFERENCA)[number]["valor"];

const numero = new Intl.NumberFormat("pt-BR");

function texto(valor: unknown): string {
  return String(valor ?? "").trim();
}

/** A linha da separação como a tela a lê, do documento `pick_lines`. */
export function itemDaLinhaDeSeparacao(id: string, data: Record<string, unknown>): WarehouseTaskItem {
  const quantidade = Number(data.qty_to_pick ?? data.requested_qty ?? 0) || 0;
  const por = data.separated_by && typeof data.separated_by === "object" ? (data.separated_by as { name?: unknown; email?: unknown }) : null;
  return {
    id,
    line_number: data.line_number == null ? undefined : Number(data.line_number),
    sku: texto(data.sku_code) || undefined,
    sku_code: texto(data.sku_code) || undefined,
    client_item_code: texto(data.client_item_code) || undefined,
    name: texto(data.product_name) || undefined,
    product_name: texto(data.product_name) || undefined,
    quantity: quantidade,
    expected_quantity: quantidade,
    picked_quantity: Number(data.qty_picked ?? data.picked_qty ?? 0) || 0,
    status: texto(data.status) || undefined,
    location: texto(data.location_id) || undefined,
    ...progressoDaLinha(data, por),
  };
}

/**
 * O progresso gravado na linha; sem `separated_at`, a linha está por separar.
 * A linha que a separação já concluiu conta como separada no que a conclusão
 * gravou: é o pedido que parou entre a separação e a embalagem.
 */
function progressoDaLinha(data: Record<string, unknown>, por: { name?: unknown; email?: unknown } | null) {
  const concluida = texto(data.status) === "completed";
  const separadaEm = texto(data.separated_at) || (concluida ? instante(data.picked_at) || instante(data.updated_at) || "concluída" : "");
  if (!separadaEm) return {};
  return {
    separated_qty: Number((concluida ? data.qty_picked : data.separated_qty) ?? 0) || 0,
    separated_at: separadaEm,
    separated_by: texto(por?.name) || texto(por?.email) || undefined,
    shortage_reason: texto(concluida ? data.shortage_reason : data.separated_shortage_reason) || undefined,
    shortage_detail: texto(concluida ? data.shortage_detail : data.separated_shortage_detail) || undefined,
    separated_boxes: caixasDaLinhaGravadas(data.separated_boxes),
    separated_volumes: volumesDaLinhaGravados(data.separated_volumes),
  };
}

/** De quais caixas a linha saiu, como o servidor grava (`separated_boxes`). */
function caixasDaLinhaGravadas(valor: unknown) {
  if (!Array.isArray(valor)) return undefined;
  const caixas = valor.flatMap((caixa) => {
    const linha = caixa && typeof caixa === "object" ? (caixa as Record<string, unknown>) : null;
    const box_code = texto(linha?.box_code).toUpperCase();
    const qty = Number(linha?.qty ?? 0) || 0;
    return box_code && qty > 0 ? [{ box_code, qty, whole: linha?.whole === true || undefined, emptied: linha?.emptied === true || undefined }] : [];
  });
  return caixas.length ? caixas : undefined;
}

/** O instante de um carimbo do Firestore, em ISO; sem data válida, "". */
function instante(valor: unknown): string {
  if (!valor) return "";
  if (typeof valor === "string") return valor;
  if (valor instanceof Date) return valor.toISOString();
  const carimbo = valor as { toDate?: () => Date; seconds?: unknown; _seconds?: unknown };
  if (typeof carimbo.toDate === "function") return carimbo.toDate().toISOString();
  const segundos = Number(carimbo.seconds ?? carimbo._seconds);
  return Number.isFinite(segundos) ? new Date(segundos * 1000).toISOString() : "";
}

export type EstadoDaLinha = "pendente" | "separada" | "com_diferenca";

export function estadoDaLinha(item: WarehouseTaskItem): EstadoDaLinha {
  if (!item.separated_at) return "pendente";
  return Number(item.separated_qty ?? 0) < quantidadeDoItem(item) ? "com_diferenca" : "separada";
}

export type ProgressoDoPedido = {
  itens: number;
  separados: number;
  unidades: number;
  unidadesSeparadas: number;
  /** As linhas separadas a menos: o pedido com diferença só conclui com a coordenação. */
  comDiferenca: number;
};

export function progressoDoPedido(itens: readonly WarehouseTaskItem[]): ProgressoDoPedido {
  const separadas = itens.filter((item) => estadoDaLinha(item) !== "pendente");
  return {
    itens: itens.length,
    separados: separadas.length,
    unidades: itens.reduce((soma, item) => soma + quantidadeDoItem(item), 0),
    unidadesSeparadas: separadas.reduce((soma, item) => soma + (Number(item.separated_qty ?? 0) || 0), 0),
    comDiferenca: separadas.filter((item) => estadoDaLinha(item) === "com_diferenca").length,
  };
}

/** "10 de 116 itens". */
export function itensDoProgresso(progresso: Pick<ProgressoDoPedido, "itens" | "separados">): string {
  return `${numero.format(progresso.separados)} de ${numero.format(progresso.itens)} ${progresso.itens === 1 ? "item" : "itens"}`;
}

/** "665 de 3.335 un." */
export function unidadesDoProgresso(progresso: Pick<ProgressoDoPedido, "unidades" | "unidadesSeparadas">): string {
  return `${numero.format(progresso.unidadesSeparadas)} de ${numero.format(progresso.unidades)} un.`;
}

/** "106 itens por separar"; com tudo separado, null. */
export function textoPorSeparar(progresso: Pick<ProgressoDoPedido, "itens" | "separados">): string | null {
  const faltam = progresso.itens - progresso.separados;
  if (faltam <= 0) return null;
  return `${numero.format(faltam)} ${faltam === 1 ? "item" : "itens"} por separar`;
}

/** "1 linha com diferença"; sem diferença, null. */
export function textoComDiferenca(progresso: Pick<ProgressoDoPedido, "comDiferenca">): string | null {
  if (progresso.comDiferenca <= 0) return null;
  return `${numero.format(progresso.comDiferenca)} ${progresso.comDiferenca === 1 ? "linha" : "linhas"} com diferença`;
}

/** A parte da barra já separada, de 0 a 100, pelas unidades. */
export function percentualSeparado(progresso: Pick<ProgressoDoPedido, "itens" | "separados">): number {
  if (progresso.itens <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((progresso.separados / progresso.itens) * 100)));
}

const DIA_E_MES = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });

/** "em separação desde 10/11", no horário de São Paulo; sem a data, "em separação". */
export function emSeparacaoDesde(comecouEm: unknown): string {
  const instante = comecouEm ? new Date(String(comecouEm)).getTime() : Number.NaN;
  return Number.isFinite(instante) ? `em separação desde ${DIA_E_MES.format(new Date(instante))}` : "em separação";
}

/** A separação do pedido já começou: a tarefa em andamento ou alguma linha separada. */
export function separacaoComecou(tarefa: Pick<WarehouseTask, "status" | "separation_started_at"> | undefined, itens: readonly WarehouseTaskItem[]): boolean {
  if (!tarefa) return false;
  return Boolean(tarefa.separation_started_at) || String(tarefa.status ?? "") === "in_progress" || itens.some((item) => item.separated_at);
}

/** "em separação desde 12/11 · 2 de 5 itens": o selo do pedido na fila; antes de começar, null. */
export function seloDaSeparacao(tarefa: Pick<WarehouseTask, "status" | "separation_started_at"> | undefined, itens: readonly WarehouseTaskItem[]): string | null {
  if (!separacaoComecou(tarefa, itens)) return null;
  return `${emSeparacaoDesde(tarefa?.separation_started_at)} · ${itensDoProgresso(progressoDoPedido(itens))}`;
}

/** "separado 1 de 2 · Avaria": a linha separada a menos. */
export function textoDaDiferenca(item: WarehouseTaskItem): string {
  const motivo = MOTIVOS_DA_DIFERENCA.find((opcao) => opcao.valor === texto(item.shortage_reason).toLowerCase())?.rotulo;
  const separado = `separado ${numero.format(Number(item.separated_qty ?? 0) || 0)} de ${numero.format(quantidadeDoItem(item))}`;
  return motivo ? `${separado} · ${motivo}` : separado;
}

/** O que o cabeçalho da prateleira diz do progresso: "2 de 4", ou tudo separado. */
export function progressoDoGrupo(grupo: Pick<GrupoDaLista, "linhas">): { separados: number; itens: number; completo: boolean; texto: string } {
  const separados = grupo.linhas.filter((linha) => estadoDaLinha(linha.item) !== "pendente").length;
  const itens = grupo.linhas.length;
  return { separados, itens, completo: itens > 0 && separados === itens, texto: `${numero.format(separados)} de ${numero.format(itens)}` };
}

/**
 * "Concluir separação" liga com todas as linhas tratadas; o pedido com
 * diferença, só para a coordenação (decisão 14). O servidor confere de novo.
 */
export function podeConcluirSeparacao(progresso: ProgressoDoPedido, coordenacao: boolean): boolean {
  return progresso.itens > 0 && progresso.separados === progresso.itens && (progresso.comDiferenca === 0 || coordenacao);
}

/** "Registrar diferença" só com o separado abaixo do pedido e o motivo escolhido. */
export function diferencaValida(pedido: number, separado: number, motivo: string): boolean {
  return Number.isFinite(separado) && separado >= 0 && separado < pedido && MOTIVOS_DA_DIFERENCA.some((opcao) => opcao.valor === motivo);
}
