import { HttpsError } from "firebase-functions/https";

/**
 * Separar a menos (pergunta 59, docs/plataforma/plano-de-implantacao.md;
 * canvas "Telas das decisões de 26/10", item 6). No "Separado", a coordenação
 * informa o separado de cada linha; a linha com menos que o pedido leva o
 * motivo da diferença (falta ou avaria) e, se quiser, um detalhe. A transação
 * (`advanceWarehouseTaskTransaction`, domain/operations.ts) solta a diferença
 * da reserva e segue com o separado. Quem opera o armazém registra a falta
 * pelo Tratar, como antes.
 *
 * Aqui fica a regra sem banco: a conferência das linhas da separação.
 */

export const MOTIVOS_DA_DIFERENCA = ["falta", "avaria"] as const;
export type MotivoDaDiferenca = (typeof MOTIVOS_DA_DIFERENCA)[number];

/** Quem separa a menos: a coordenação, como no Cancelar pedido. */
const PAPEIS_QUE_SEPARAM_A_MENOS = ["owner", "admin", "interno"];

/** O que a tela manda como linha conferida. */
const STATUS_CONFERIDOS = ["confirmed", "ok", "picked", "completed"];

const DETALHE_MAXIMO = 300;

export type LinhaDaSeparacao = {
  id: string;
  /** O nome do produto, ou o SKU, para a mensagem. */
  produto: string;
  pedido: number;
};

export type ConferenciaDaLinha = {
  qty_picked?: unknown;
  status?: unknown;
  shortage_reason?: unknown;
  shortage_detail?: unknown;
};

export type LinhaSeparada = {
  id: string;
  pedido: number;
  separado: number;
  diferenca: number;
  motivo?: MotivoDaDiferenca;
  detalhe?: string;
};

function texto(valor: unknown): string {
  return typeof valor === "string" || typeof valor === "number" ? String(valor).trim() : "";
}

/**
 * A conferência de cada linha: separado de 0 ao pedido, nunca mais. A linha a
 * menos é só da coordenação e pede o motivo. Sem nada separado, o pedido não
 * segue: para desistir dele, é Cancelar pedido.
 */
export function conferirSeparacao(
  linhas: LinhaDaSeparacao[],
  conferencias: Map<string, ConferenciaDaLinha>,
  papel: string,
): LinhaSeparada[] {
  const separadas = linhas.map((linha): LinhaSeparada => {
    const conferencia = conferencias.get(linha.id);
    if (!conferencia) {
      throw new HttpsError("failed-precondition", `Linha ${linha.id} não foi conferida fisicamente.`);
    }
    if (!STATUS_CONFERIDOS.includes(texto(conferencia.status) || "confirmed")) {
      throw new HttpsError("failed-precondition", `Linha ${linha.id} não está OK para concluir o picking.`);
    }
    const separado = Number(conferencia.qty_picked);
    if (!Number.isFinite(separado) || separado < 0) {
      throw new HttpsError("invalid-argument", `Quantidade física de ${linha.id} inválida.`);
    }
    if (separado > linha.pedido) {
      throw new HttpsError(
        "failed-precondition",
        `Linha ${linha.id} tem ${separado} unidade(s) físicas, mas esperava ${linha.pedido}. Registre exceção antes de concluir.`,
      );
    }
    const diferenca = linha.pedido - separado;
    if (diferenca === 0) return { id: linha.id, pedido: linha.pedido, separado, diferenca };
    if (!PAPEIS_QUE_SEPARAM_A_MENOS.includes(papel)) {
      throw new HttpsError("permission-denied", "Só a coordenação separa a menos. Registre a falta pelo Tratar.");
    }
    const motivo = texto(conferencia.shortage_reason).toLowerCase();
    if (!(MOTIVOS_DA_DIFERENCA as readonly string[]).includes(motivo)) {
      throw new HttpsError("invalid-argument", `Informe o motivo da diferença em ${linha.produto}.`);
    }
    const detalhe = texto(conferencia.shortage_detail).replace(/\s+/g, " ");
    if (detalhe.length > DETALHE_MAXIMO) {
      throw new HttpsError("invalid-argument", `Use até ${DETALHE_MAXIMO} caracteres no detalhe.`);
    }
    return {
      id: linha.id,
      pedido: linha.pedido,
      separado,
      diferenca,
      motivo: motivo as MotivoDaDiferenca,
      detalhe: detalhe || undefined,
    };
  });
  if (separadas.every((linha) => linha.separado === 0)) {
    throw new HttpsError("failed-precondition", "Nada foi separado. Para desistir do pedido, use Cancelar pedido.");
  }
  return separadas;
}
