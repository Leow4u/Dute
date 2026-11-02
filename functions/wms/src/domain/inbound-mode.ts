import type { Firestore, Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

import { areaDePassagem } from "./areas-de-passagem.js";
import {
  CUSTOMERS_COLLECTION,
  TEMPLATES_WITH_BOX_RECEIVING,
  resolveOperationTemplate,
  type OperationTemplateKey,
} from "./customer-profile.js";

/**
 * Modo da chegada (docs/plataforma/recebimento-com-caixas.md, seção 4.1 e
 * parte 2 da seção 5).
 *
 * Cada chegada nasce por linha ou por caixa e guarda o modo em
 * `inbound_receipts.conference_mode`. Por linha é o recebimento de sempre: a
 * API REST v1, o aviso do portal e o Documentos criam por linha. Por caixa, a
 * conferência, as medidas, a etiqueta e a guarda são de cada caixa; a chegada
 * só nasce assim pela callable createInboundReceipt, no ambiente liberado e
 * para o cliente cujo modelo de operação confere por caixa (uniformes,
 * decisão 1).
 *
 * A liberação rege só a criação. Desligada, nenhuma chegada nova nasce por
 * caixa, e as que já nasceram seguem por caixa até o fim: quem as trata lê o
 * modo gravado, nunca a liberação.
 */

/**
 * Onde a chegada pode nascer por caixa: só a homologação, até o OK do
 * Leonardo para a produção. Cópia de RECEBIMENTO_POR_CAIXA_AMBIENTES_LIBERADOS
 * do app (lib/liberacao.ts), travada pelo platform-lists.test.ts do app.
 */
export const RECEBIMENTO_POR_CAIXA_PROJECTS = ["dute-homolog"];

export function boxReceivingEnabled(projectId: string | undefined) {
  return !!projectId && RECEBIMENTO_POR_CAIXA_PROJECTS.includes(projectId);
}

/** Os modos, os mesmos do app (lib/operations/types.ts, travados pelo operations.test.ts). */
export const INBOUND_CONFERENCE_MODES = ["per_line", "per_box"] as const;
export type InboundConferenceMode = (typeof INBOUND_CONFERENCE_MODES)[number];

/** O modo gravado na chegada. A chegada anterior ao campo é por linha. */
export function conferenceModeOf(
  receipt: Record<string, unknown> | undefined,
): InboundConferenceMode {
  return receipt?.conference_mode === "per_box" ? "per_box" : "per_line";
}

/** O modo pedido para uma chegada nova. Sem o campo, por linha. */
export function requestedConferenceMode(value: unknown): InboundConferenceMode {
  const mode = typeof value === "string" ? value.trim() : value;
  if (mode === undefined || mode === null || mode === "") return "per_line";
  if ((INBOUND_CONFERENCE_MODES as readonly unknown[]).includes(mode)) {
    return mode as InboundConferenceMode;
  }
  throw new HttpsError(
    "invalid-argument",
    `Modo da chegada desconhecido: ${String(value)}. Use ${INBOUND_CONFERENCE_MODES.join(" ou ")}.`,
  );
}

/**
 * O modelo de operação do cliente, do cadastro em Configurações › Clientes,
 * lido na transação. O cadastro grava `code` e `customer_code` iguais; os
 * dois valem para um cadastro antigo que só tenha um deles. Vale o cadastro
 * ativo; sem ele, o arquivado, porque arquivar não apaga o modelo (a projeção
 * client_profiles e o app também o usam). Sem cadastro nenhum, ou sem o
 * campo, vale o padrão, como no app (resolveOperationProfile).
 */
export async function readCustomerOperationTemplate(
  transaction: Transaction,
  db: Firestore,
  customerCode: string,
): Promise<OperationTemplateKey> {
  const [byCode, byCustomerCode] = await Promise.all([
    transaction.get(db.collection(CUSTOMERS_COLLECTION).where("code", "==", customerCode).limit(5)),
    transaction.get(
      db.collection(CUSTOMERS_COLLECTION).where("customer_code", "==", customerCode).limit(5),
    ),
  ]);
  const rows = [...byCode.docs, ...byCustomerCode.docs];
  const record =
    rows.find((row) => row.get("archived") !== true && row.get("status") !== "archived") ?? rows[0];
  return resolveOperationTemplate(record?.get("operation_template"));
}

/**
 * Confere o modo de uma chegada nova, na transação e antes de qualquer
 * escrita. Por linha vale sempre. Por caixa exige a liberação do ambiente (a
 * porta passa `boxReceivingEnabled(PROJECT_ID)`) e um modelo de operação que
 * confere por caixa.
 */
export async function assertNewReceiptMode(
  transaction: Transaction,
  db: Firestore,
  check: { customerCode: string; mode: InboundConferenceMode; boxReceivingEnabled: boolean },
) {
  if (check.mode === "per_line") return;
  if (!check.boxReceivingEnabled) {
    throw new HttpsError(
      "failed-precondition",
      "A conferência por caixa ainda não está liberada neste ambiente.",
      { code: "BOX_RECEIVING_NOT_RELEASED" },
    );
  }
  const template = await readCustomerOperationTemplate(transaction, db, check.customerCode);
  if (!TEMPLATES_WITH_BOX_RECEIVING.includes(template)) {
    throw new HttpsError(
      "failed-precondition",
      `${check.customerCode} usa o modelo de operação ${template}, que confere a chegada por linha.`,
      { code: "TEMPLATE_RECEIVES_PER_LINE", template },
    );
  }
}

/**
 * O local de uma linha da chegada nova (parte 4a). Por linha, fica como veio.
 * Por caixa, toda linha passa pela área de recebimento: a caixa só leva linha
 * do RECEBIMENTO (inbound-boxes.ts), e a entrada e a guarda da caixa acham o
 * saldo pelo local exato, então ele é gravado como "RECEBIMENTO" mesmo que
 * venha em minúsculas; outro local é recusado com a frase da caixa.
 */
export function boxReceiptLineLocation(
  mode: InboundConferenceMode,
  lineNumber: number,
  location: unknown,
): string {
  const local = typeof location === "string" ? location.trim() : "";
  if (mode !== "per_box") return local;
  if (!local || areaDePassagem(local) === "RECEBIMENTO") return "RECEBIMENTO";
  throw new HttpsError(
    "failed-precondition",
    `A linha ${lineNumber} vai direto para ${local.toUpperCase()}: na chegada por caixa, toda linha passa pela área de recebimento.`,
    { code: "BOX_RECEIPT_LINE_OUTSIDE_RECEIVING" },
  );
}

/**
 * A conferência e a entrada por linha não valem para a chegada por caixa: a
 * quantidade de cada linha vem das caixas (seção 4.3) e a entrada pede as
 * caixas fechadas e com destino (seção 4.4). Lê o modo gravado, nunca a
 * liberação.
 */
export function assertLineConference(
  receipt: Record<string, unknown>,
  action: "conferir" | "concluir",
) {
  if (conferenceModeOf(receipt) !== "per_box") return;
  const receiptNumber = String(receipt.receipt_number || receipt.id || "").trim();
  const reason =
    action === "conferir"
      ? "a quantidade de cada linha vem das caixas"
      : "concluir a entrada pede as caixas fechadas e com destino";
  throw new HttpsError(
    "failed-precondition",
    `A chegada ${receiptNumber} é conferida por caixa: ${reason}.`,
    { code: "RECEIPT_CONFERRED_PER_BOX" },
  );
}

/**
 * A guarda da caixa (parte 4f) move todas as linhas da caixa para a prateleira
 * reservada dela: a tarefa com box_code não anda pela guarda por linha, que
 * escolhe prateleira e quantidade de um SKU só (parte 4b).
 */
export function assertLinePutaway(task: Record<string, unknown>) {
  const boxCode = typeof task.box_code === "string" ? task.box_code.trim() : "";
  if (!boxCode) return;
  throw new HttpsError(
    "failed-precondition",
    `A guarda da caixa ${boxCode} é feita pela guarda da caixa: a prateleira e o conteúdo vêm dela.`,
    { code: "PUTAWAY_IS_BY_BOX" },
  );
}

/**
 * A guarda por linha move no máximo a quantidade da própria tarefa (decisão
 * 23): o resto do RECEBIMENTO é de outras tarefas, inclusive o conteúdo das
 * caixas do mesmo SKU. A tarefa sem quantidade gravada não tem teto.
 */
export function putawayQuantityWithinTask(task: Record<string, unknown>, quantity: number) {
  const limit = Number(task.quantity ?? task.total_units ?? 0);
  if (!Number.isFinite(limit) || limit <= 0 || quantity <= limit) return;
  const skuCode = String(task.sku_code ?? task.sku ?? "").trim();
  throw new HttpsError(
    "failed-precondition",
    `A tarefa guarda no máximo ${limit} un. de ${skuCode}.`,
    { code: "PUTAWAY_ABOVE_TASK", limit },
  );
}
