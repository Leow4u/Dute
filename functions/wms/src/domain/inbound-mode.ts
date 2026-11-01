import type { Firestore, Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";

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
 * dois valem para um cadastro antigo que só tenha um deles. Sem cadastro
 * ativo ou sem o campo vale o padrão, como no resto do sistema.
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
  const active = [...byCode.docs, ...byCustomerCode.docs].find(
    (row) => row.get("archived") !== true && row.get("status") !== "archived",
  );
  return resolveOperationTemplate(active?.get("operation_template"));
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
