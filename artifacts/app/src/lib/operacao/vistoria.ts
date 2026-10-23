import type { OsDaFila } from "./fila";
import type { DemandaDoHoje } from "./hoje";

/**
 * A vistoria vista pelo escritório (docs/plataforma/fase-3-operacao.md,
 * parte 3.11c): quando a demanda recebe vistoria (as mesmas regras de
 * functions/operacao, problemaParaAbrirVistoria) e quando ela espera a
 * Operação, por ter a visita técnica pedida pelo Comercial e nenhuma
 * vistoria ainda. O servidor confere de novo.
 */

/** As etapas do Comercial antes do escopo fechado pelo cliente. */
export const ETAPAS_ANTES_DO_ESCOPO = ["em_montagem", "para_aprovar", "para_enviar", "aguardando_cliente"] as const;

type DemandaParaVistoria = Pick<DemandaDoHoje, "entrada" | "fora" | "etapa" | "escopoRv">;

/** Por que a demanda não recebe vistoria, ou null: antes do escopo fechado, do Comercial, uma por vez. */
export function problemaParaAbrirVistoria(demanda: DemandaParaVistoria, ordens: readonly Pick<OsDaFila, "numero" | "tipo" | "status">[]): string | null {
  if (demanda.entrada === "direta") return "A demanda direta não tem vistoria: a Operação executa e o Comercial orça depois.";
  if (demanda.fora === "cancelada") return "A demanda foi cancelada no Comercial.";
  if (demanda.fora === "perdida" || demanda.etapa === "perdida") return "A demanda foi perdida no Comercial.";
  if (demanda.escopoRv !== null || !(ETAPAS_ANTES_DO_ESCOPO as readonly string[]).includes(demanda.etapa)) {
    return "A vistoria vem antes do escopo fechado: a demanda já foi fechada pelo cliente.";
  }
  const emAberto = ordens.find((os) => os.tipo === "vistoria" && (os.status === "aberta" || os.status === "agendada" || os.status === "em_execucao"));
  if (emAberto) return `A demanda já tem a vistoria ${emAberto.numero} em aberto.`;
  return null;
}

/**
 * A vistoria que espera a Operação: o Comercial pediu a visita técnica, a
 * demanda ainda recebe vistoria e nenhuma foi aberta (a cancelada não conta).
 */
export function vistoriaPedida(demanda: DemandaParaVistoria & Pick<DemandaDoHoje, "numero" | "visitaTecnica">, ordens: readonly Pick<OsDaFila, "numero" | "demanda" | "tipo" | "status">[]): boolean {
  if (!demanda.visitaTecnica) return false;
  const daDemanda = ordens.filter((os) => os.demanda === demanda.numero);
  if (daDemanda.some((os) => os.tipo === "vistoria" && os.status !== "cancelada")) return false;
  return problemaParaAbrirVistoria(demanda, daDemanda) === null;
}
