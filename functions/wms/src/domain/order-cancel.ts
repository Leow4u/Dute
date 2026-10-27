import { HttpsError } from "firebase-functions/https";
import { z } from "genkit";

/**
 * Cancelar pedido (pergunta 59, docs/plataforma/plano-de-implantacao.md;
 * canvas "Telas das decisões de 26/10", item 6). A coordenação cancela, com o
 * motivo, o pedido de saída aprovado que ainda não saiu do armazém. A
 * transação (`cancelWarehouseOrderTransaction`, domain/operations.ts) solta
 * a reserva, cancela as tarefas abertas e, no que já foi separado, passa o
 * item no razão para a EXPEDICAO e abre a guarda de volta à posição. O
 * cliente vê no portal "Cancelado pela Dutelog" e a data, sem o motivo.
 *
 * Aqui ficam as regras sem banco: o pedido de cancelamento, quando o pedido
 * se cancela e quando a solicitação de saída se encerra.
 */

/** Onde o separado do pedido cancelado espera a guarda, como o RECEBIMENTO na entrada. */
export const LOCAL_DO_CANCELADO = "EXPEDICAO";

/** O que o portal mostra no pedido cancelado pela Dutelog. */
export const ROTULO_DO_CANCELADO = "Cancelado pela Dutelog";

/** Os status do pedido que ainda está no armazém: aprovado, separado ou embalado. */
export const STATUS_CANCELAVEIS = ["PENDENTE", "SEPARACAO", "EM_EXPEDICAO"] as const;

/** As tarefas de cada tipo que o cancelamento fecha: as que ainda não terminaram. */
const TAREFAS_ABERTAS: Record<"picking" | "packing" | "shipping", readonly string[]> = {
  picking: ["planned", "in_progress"],
  packing: ["ready", "in_progress"],
  shipping: ["ready_to_dispatch"],
};

function texto(valor: unknown): string {
  return typeof valor === "string" || typeof valor === "number" ? String(valor).trim() : "";
}

const mensagens: z.ZodErrorMap = (issue) => {
  if (issue.code === z.ZodIssueCode.unrecognized_keys) return { message: `Campo não aceito: ${issue.keys.join(", ")}.` };
  if (issue.code === z.ZodIssueCode.invalid_type && issue.received === "undefined") {
    const campo = String(issue.path[0] ?? "");
    if (campo === "reason") return { message: "Informe o motivo do cancelamento." };
    if (campo === "order_id") return { message: "Informe o pedido." };
  }
  return { message: "Pedido de cancelamento inválido." };
};

const CancelarPedido = z
  .object({
    order_id: z
      .string()
      .trim()
      .min(1, "Informe o pedido.")
      .max(200, "Pedido inválido.")
      .refine((valor) => !valor.includes("/"), "Pedido inválido."),
    reason: z
      .string()
      .trim()
      .min(3, "Informe o motivo do cancelamento.")
      .max(500, "Use até 500 caracteres no motivo.")
      .transform((valor) => valor.replace(/\s+/g, " ")),
    idempotency_key: z.string().trim().min(8, "Pedido de cancelamento inválido.").max(200, "Pedido de cancelamento inválido."),
  })
  .strict();

export type PedidoDeCancelamento = z.infer<typeof CancelarPedido>;

export function interpretarCancelamento(input: unknown): PedidoDeCancelamento {
  const lido = CancelarPedido.safeParse(input ?? {}, { errorMap: mensagens });
  if (!lido.success) throw new HttpsError("invalid-argument", lido.error.issues[0]?.message ?? "Pedido de cancelamento inválido.");
  return lido.data;
}

/** O pedido já cancelado: cancelar de novo devolve o mesmo, sem gravar. */
export function pedidoJaCancelado(status: unknown): boolean {
  return texto(status).toUpperCase().startsWith("CANCEL");
}

/** Por que o pedido não se cancela, ou null. */
export function problemaDoCancelamento(status: unknown): string | null {
  const valor = texto(status).toUpperCase();
  if (pedidoJaCancelado(valor)) return null;
  if (valor === "EXPEDIDO" || valor === "ENTREGUE") return "O pedido já saiu do armazém: não se cancela mais.";
  if (!(STATUS_CANCELAVEIS as readonly string[]).includes(valor)) return `Pedido em ${valor || "status vazio"} não se cancela.`;
  return null;
}

/** A tarefa ainda não terminou: o cancelamento a fecha. */
export function tarefaAberta(tipo: keyof typeof TAREFAS_ABERTAS, status: unknown): boolean {
  return TAREFAS_ABERTAS[tipo].includes(texto(status).toLowerCase());
}

/**
 * A solicitação de saída se encerra só depois da entrega (pergunta 59): antes
 * dela, "Encerrar" deixava a reserva presa e as tarefas abertas, e o portal
 * mostrava "Entregue". Para mudar o pedido antes, é "Cancelar pedido".
 */
export function problemaDoEncerramento(solicitacao: Record<string, unknown>): string | null {
  const entregue =
    texto(solicitacao.operational_status).toLowerCase() === "delivered" ||
    texto(solicitacao.fulfillment_status).toLowerCase() === "completed";
  return entregue ? null : "O pedido ainda não foi entregue: encerre depois da entrega. Para desistir dele, use Cancelar pedido.";
}
