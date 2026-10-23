import { createHash } from "node:crypto";

import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { z } from "genkit";

import { createEvent, createReturnReceiptTransaction, type OperationalActor } from "./operations.js";

/**
 * O retorno ao armazém do pedido de saída (docs/plataforma/fase-4-financeiro.md,
 * parte 4.5d): a OS de volta da entrega pela Dutelog, concluída, marca em
 * `orders/{id}.retorno` o retorno a receber (functions/operacao, a
 * conclusão). O WMS confere o que voltou e recebe uma vez: a devolução do
 * pedido (`returns`, com os itens para a disposição física) nasce com a
 * chave do pedido, e o pedido guarda o retorno recebido com a devolução.
 */

export const ORDERS_COLLECTION = "orders";
export const RETORNO_FONTE = "retorno_do_pedido";

function texto(valor: unknown): string {
  return typeof valor === "string" || typeof valor === "number" ? String(valor).trim() : "";
}

function registro(valor: unknown): Record<string, unknown> | null {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? (valor as Record<string, unknown>) : null;
}

function digest(valor: unknown, tamanho = 24): string {
  return createHash("sha256").update(JSON.stringify(valor)).digest("hex").slice(0, tamanho);
}

const mensagens: z.ZodErrorMap = (issue) => {
  const campo = issue.path.join(".") || "entrada";
  if (issue.code === z.ZodIssueCode.unrecognized_keys) return { message: `Campo não aceito: ${issue.keys.join(", ")}.` };
  if (issue.code === z.ZodIssueCode.invalid_type && issue.received === "undefined") return { message: `Informe ${campo}.` };
  return { message: `${campo}: valor inválido.` };
};

const itemDoRetorno = z
  .object({
    sku_code: z.string().trim().min(1).max(120),
    client_item_code: z.string().trim().min(1).max(120),
    product_name: z.string().trim().max(200).optional(),
    quantity: z.number().int("Informe a quantidade inteira.").positive("Informe a quantidade que voltou."),
  })
  .strict();

const ReceberRetorno = z
  .object({
    idempotency_key: z.string().trim().max(200).optional(),
    order_id: z.string().trim().min(1, "Informe o pedido.").max(200).refine((valor) => !valor.includes("/"), "Pedido inválido."),
    items: z.array(itemDoRetorno).min(1, "Informe o que voltou.").max(100),
    notes: z.string().trim().max(300).optional(),
  })
  .strict();

export type PedidoDeRetorno = z.infer<typeof ReceberRetorno>;

export function interpretarRetorno(input: unknown): PedidoDeRetorno {
  const parsed = ReceberRetorno.safeParse(input ?? {}, { errorMap: mensagens });
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Dados inválidos.");
  return parsed.data;
}

export type RetornoDoPedido = { status: string; os: string; demanda: string; returnId: string | null };

export function retornoDoPedido(pedido: Record<string, unknown>): RetornoDoPedido | null {
  const retorno = registro(pedido.retorno);
  if (!retorno) return null;
  return { status: texto(retorno.status), os: texto(retorno.os), demanda: texto(retorno.demanda), returnId: texto(retorno.return_id) || null };
}

/** Por que o retorno não se recebe, ou null: só o retorno a receber, uma vez. */
export function problemaDoRetorno(pedido: Record<string, unknown>): string | null {
  if (!texto(pedido.customer_code)) return "O pedido está sem o cliente.";
  const retorno = retornoDoPedido(pedido);
  if (!retorno) return "O pedido não tem retorno da Operação a receber.";
  if (retorno.status === "recebido") return "O retorno do pedido já foi recebido.";
  if (retorno.status !== "a_receber") return "O pedido não tem retorno da Operação a receber.";
  return null;
}

/** A chave da devolução do pedido: uma só por pedido, qualquer que seja a tentativa. */
export function chaveDaDevolucao(orderId: string): string {
  return `pedido:${orderId}`;
}

export async function receiveOrderReturnFlow(
  db: Firestore,
  input: unknown,
  actor: OperationalActor,
  agora: () => Date = () => new Date(),
): Promise<Record<string, unknown>> {
  const pedido = interpretarRetorno(input);
  const ref = db.collection(ORDERS_COLLECTION).doc(pedido.order_id);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new HttpsError("not-found", "Pedido não encontrado.");
  const dados = snapshot.data() ?? {};
  const problema = problemaDoRetorno(dados);
  if (problema) throw new HttpsError("failed-precondition", problema);
  const retorno = retornoDoPedido(dados)!;
  const customerCode = texto(dados.customer_code);
  const numero = texto(dados.order_number) || texto(dados.num_pedido) || ref.id;
  const iso = agora().toISOString();

  // A devolução tem recibo próprio (operations): repetir a mesma chave devolve a mesma.
  const devolucao = await createReturnReceiptTransaction(
    db,
    {
      customer_code: customerCode,
      source: RETORNO_FONTE,
      reference: [numero, retorno.os ? `OS ${retorno.os}` : null].filter(Boolean).join(" · "),
      notes: pedido.notes,
      received_at: iso,
      idempotency_key: chaveDaDevolucao(ref.id),
      items: pedido.items.map((item) => ({ ...item, product_name: item.product_name || undefined })),
    },
    actor,
  );
  const returnId = texto(devolucao.return_id) || texto(devolucao.id);

  // Marca o retorno recebido no pedido, uma vez.
  await db.runTransaction(async (transaction) => {
    const atual = await transaction.get(ref);
    const agoraNoPedido = retornoDoPedido(atual.data() ?? {});
    if (agoraNoPedido?.status === "recebido") return;
    transaction.update(ref, {
      "retorno.status": "recebido",
      "retorno.return_id": returnId,
      "retorno.recebido_em": iso,
      "retorno.recebido_por_uid": actor.uid,
      updated_at: FieldValue.serverTimestamp(),
    });
    createEvent(
      transaction,
      db,
      `evt_expedicao_retorno_${digest({ pedido: ref.id, returnId })}`,
      {
        type: "expedicao.return_linked",
        title: "Retorno do pedido recebido",
        description: numero,
        severity: "info",
        entity_type: "pedido",
        entity_id: ref.id,
        customer_code: customerCode,
        payload: { order_id: ref.id, return_id: returnId, os: retorno.os || null, linhas: pedido.items.length },
        occurred_at: iso,
        source: "functions_order_return",
      },
      actor,
    );
  });
  return { ...devolucao, order_id: ref.id };
}
