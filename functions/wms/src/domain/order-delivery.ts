import { createHash } from "node:crypto";

import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { z } from "genkit";

import { createEvent, type OperationalActor } from "./operations.js";

/**
 * A entrega do pedido de saída (docs/plataforma/fase-4-financeiro.md, parte
 * 4.5a; docs/mockups/WmsExpedicao.dc.html): pela Dutelog (o destino, a data
 * e a hora, o contato, a montagem e o retorno ao armazém) ou retirada pelo
 * cliente (a data e a hora, quem retira, o documento e a placa). Fica em
 * `orders/{id}.entrega`, gravada só por esta callable, antes da saída.
 *
 * A entrega pela Dutelog vira demanda e OS na Operação (parte 4.5b,
 * functions/operacao), que grava de volta em `entrega.demanda` o número da
 * demanda. Depois disso a entrega não muda por aqui: quem muda é a
 * Operação, na demanda. A retirada não gera demanda nem OS.
 */

export const ORDERS_COLLECTION = "orders";
export const ENTREGA_MODOS = ["dutelog", "retirada"] as const;
export type EntregaModo = (typeof ENTREGA_MODOS)[number];
export const ENTREGA_SCHEMA_VERSION = 1;

/** As chaves em ordem: o mapa lido do Firestore e o pedido comparam igual. */
function canonico(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(canonico);
  if (valor && typeof valor === "object") {
    return Object.fromEntries(
      Object.entries(valor as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([chave, item]) => [chave, canonico(item)]),
    );
  }
  return valor;
}

function digest(valor: unknown, tamanho = 32): string {
  return createHash("sha256").update(JSON.stringify(canonico(valor))).digest("hex").slice(0, tamanho);
}

const DATA = /^(\d{4})-(\d{2})-(\d{2})$/;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const PLACA = /^[A-Z]{3}\d[A-Z0-9]\d{2}$/;

function dataValida(valor: string): boolean {
  const partes = DATA.exec(valor);
  if (!partes) return false;
  const [ano, mes, dia] = partes.slice(1).map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  return data.getUTCFullYear() === ano && data.getUTCMonth() === mes - 1 && data.getUTCDate() === dia;
}

const mensagens: z.ZodErrorMap = (issue) => {
  const campo = issue.path.join(".") || "entrada";
  if (issue.code === z.ZodIssueCode.unrecognized_keys) return { message: `Campo não aceito: ${issue.keys.join(", ")}.` };
  if (issue.code === z.ZodIssueCode.invalid_type && issue.received === "undefined") return { message: `Informe ${campo}.` };
  if (issue.code === z.ZodIssueCode.invalid_union_discriminator) return { message: "Escolha a entrega pela Dutelog ou a retirada pelo cliente." };
  return { message: `${campo}: valor inválido.` };
};

const linha = (min: number, max: number, rotulo: string) =>
  z
    .string()
    .trim()
    .min(min, `Informe ${rotulo}.`)
    .max(max, `Use até ${max} caracteres em ${rotulo}.`)
    .transform((valor) => valor.replace(/\s+/g, " "));

const opcional = (max: number, rotulo: string) =>
  z
    .string()
    .trim()
    .max(max, `Use até ${max} caracteres em ${rotulo}.`)
    .nullable()
    .optional()
    .transform((valor) => (valor ? valor.replace(/\s+/g, " ") : null));

const data = z.string().trim().refine(dataValida, "Data inválida: use aaaa-mm-dd.");
const hora = z.string().trim().regex(HORA, "Hora inválida: use hh:mm.");
const telefone = z
  .string()
  .trim()
  .nullable()
  .optional()
  .transform((valor) => (valor ? valor.replace(/[\s().-]/g, "") : null))
  .refine((valor) => valor == null || /^\+?\d{8,15}$/.test(valor), "Telefone do contato inválido: use DDD e número.");
const placa = z
  .string()
  .trim()
  .nullable()
  .optional()
  .transform((valor) => (valor ? valor.replace(/[\s-]/g, "").toUpperCase() : null))
  .refine((valor) => valor == null || PLACA.test(valor), "Placa inválida: use ABC1D23 ou ABC1234.");

const PelaDutelog = z
  .object({
    modo: z.literal("dutelog"),
    destino: linha(3, 160, "o destino"),
    data,
    hora,
    contato: z
      .object({ nome: linha(2, 80, "o contato"), telefone })
      .strict()
      .nullable()
      .optional()
      .transform((valor) => valor ?? null),
    montagem: z.boolean().optional().transform((valor) => valor ?? false),
    /** A desmontagem e o retorno ao armazém (o evento que volta): gera recebimento. */
    retorno: z
      .object({ data, hora })
      .strict()
      .nullable()
      .optional()
      .transform((valor) => valor ?? null),
  })
  .strict();

const PeloCliente = z
  .object({
    modo: z.literal("retirada"),
    data,
    hora,
    quem_retira: linha(2, 80, "quem retira"),
    documento: opcional(30, "o documento"),
    placa,
  })
  .strict();

const DefinirEntrega = z
  .object({
    /** A escolha é idempotente por si (a mesma escolha não grava de novo); a chave vem do app como nas outras. */
    idempotency_key: z.string().trim().max(200).optional(),
    order_id: z.string().trim().min(1, "Informe o pedido.").max(200).refine((valor) => !valor.includes("/"), "Pedido inválido."),
    entrega: z.discriminatedUnion("modo", [PelaDutelog, PeloCliente]),
  })
  .strict();

export type PedidoDeEntrega = z.infer<typeof DefinirEntrega>;
export type Entrega = PedidoDeEntrega["entrega"];

export function interpretarEntrega(input: unknown): PedidoDeEntrega {
  const parsed = DefinirEntrega.safeParse(input ?? {}, { errorMap: mensagens });
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Dados inválidos.");
  return parsed.data;
}

/** A data e a hora em São Paulo (sem horário de verão desde 2019), como instante. */
export function instanteDaEntrega(dia: string, horario: string): number {
  return Date.parse(`${dia}T${horario}:00-03:00`);
}

const DIA_EM_SAO_PAULO = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });

function texto(valor: unknown): string {
  return typeof valor === "string" || typeof valor === "number" ? String(valor).trim() : "";
}

/** O pedido que já saiu (ou foi cancelado) não muda a entrega. */
export function pedidoFechado(status: unknown): boolean {
  const valor = texto(status).toUpperCase();
  return valor === "EXPEDIDO" || valor === "ENTREGUE" || valor.startsWith("CANCEL");
}

/**
 * Por que a entrega não pode ser gravada, ou null. O pedido existe, ainda não
 * saiu; a entrega pela Dutelog que já virou demanda muda na Operação; a data
 * é de hoje em diante (em São Paulo); o retorno vem depois da entrega.
 */
export function problemaDaEntrega(pedido: Record<string, unknown>, entrega: Entrega, agora: Date): string | null {
  if (pedidoFechado(pedido.status)) return "O pedido já saiu do armazém: a entrega não muda mais.";
  const atual = pedido.entrega && typeof pedido.entrega === "object" ? (pedido.entrega as Record<string, unknown>) : null;
  const demanda = texto(atual?.demanda);
  if (demanda) return `A entrega já virou a demanda ${demanda} na Operação: mude por lá.`;
  if (entrega.data < DIA_EM_SAO_PAULO.format(agora)) return "A data da entrega já passou.";
  if (entrega.modo === "dutelog" && entrega.retorno) {
    if (instanteDaEntrega(entrega.retorno.data, entrega.retorno.hora) <= instanteDaEntrega(entrega.data, entrega.hora)) {
      return "O retorno ao armazém vem depois da entrega.";
    }
  }
  return null;
}

/** O que fica no pedido: a escolha, sem texto vazio. */
export function entregaGravada(entrega: Entrega, iso: string, uid: string): Record<string, unknown> {
  return {
    ...entrega,
    demanda: null,
    os_numeros: [],
    definida_em: iso,
    definida_por_uid: uid,
    schema_version: ENTREGA_SCHEMA_VERSION,
  };
}

/** A mesma escolha de antes (sem os carimbos): repetir não grava nem gera evento. */
export function mesmaEntrega(atual: unknown, entrega: Entrega): boolean {
  if (!atual || typeof atual !== "object") return false;
  const { definida_em: _em, definida_por_uid: _por, demanda: _demanda, os_numeros: _os, schema_version: _versao, ...escolha } = atual as Record<string, unknown>;
  return digest(escolha, 64) === digest(entrega, 64);
}

export async function setOrderDeliveryTransaction(
  db: Firestore,
  input: unknown,
  actor: OperationalActor,
  agora: () => Date = () => new Date(),
): Promise<{ ok: true; order_id: string; modo: EntregaModo; changed: boolean }> {
  const pedido = interpretarEntrega(input);
  const ref = db.collection(ORDERS_COLLECTION).doc(pedido.order_id);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new HttpsError("not-found", "Pedido não encontrado.");
    const dados = snapshot.data() ?? {};
    const customerCode = texto(dados.customer_code);
    if (!customerCode) throw new HttpsError("failed-precondition", "O pedido está sem o cliente.");
    if (mesmaEntrega(dados.entrega, pedido.entrega)) return { ok: true as const, order_id: ref.id, modo: pedido.entrega.modo, changed: false };
    const problema = problemaDaEntrega(dados, pedido.entrega, agora());
    if (problema) throw new HttpsError("failed-precondition", problema);

    const iso = agora().toISOString();
    transaction.update(ref, { entrega: entregaGravada(pedido.entrega, iso, actor.uid), updated_at: FieldValue.serverTimestamp() });
    const numero = texto(dados.order_number) || texto(dados.num_pedido) || ref.id;
    createEvent(
      transaction,
      db,
      `evt_expedicao_entrega_${digest({ pedido: ref.id, entrega: pedido.entrega, iso }, 24)}`,
      {
        type: "expedicao.delivery_set",
        title: pedido.entrega.modo === "dutelog" ? "Entrega pela Dutelog definida" : "Retirada pelo cliente definida",
        description: numero,
        severity: "info",
        entity_type: "pedido",
        entity_id: ref.id,
        customer_code: customerCode,
        // Sem o destino, o contato, quem retira, o documento nem a placa: ficam só no pedido.
        payload: {
          order_id: ref.id,
          modo: pedido.entrega.modo,
          data: pedido.entrega.data,
          montagem: pedido.entrega.modo === "dutelog" ? pedido.entrega.montagem : false,
          retorno: pedido.entrega.modo === "dutelog" ? Boolean(pedido.entrega.retorno) : false,
        },
        occurred_at: iso,
        source: "functions_order_delivery",
      },
      actor,
    );
    return { ok: true as const, order_id: ref.id, modo: pedido.entrega.modo, changed: true };
  });
}
