import { HttpsError } from "firebase-functions/https";
import { z } from "zod";

import type { ItemDoPedido } from "./demanda-direta.js";

/**
 * A entrega do pedido de saída do WMS pela Dutelog (docs/plataforma/fase-4-financeiro.md,
 * parte 4.5b; docs/mockups/WmsExpedicao.dc.html): o WMS grava a escolha em
 * `orders/{id}.entrega` (parte 4.5a) e a Operação abre a demanda direta dela,
 * com o canal `wms` e o pedido (`pedido_wms`), e as OS: a ida (o transporte
 * e, pedida, a montagem), agendada para a data e a hora da entrega, e, com o
 * retorno ao armazém, a volta (a desmontagem e o retorno), agendada para o
 * dia do retorno e marcada para gerar o recebimento no WMS (parte 4.5d).
 * A retirada pelo cliente não gera demanda nem OS.
 *
 * A entrega é lida do pedido, nunca do navegador: quem chama só diz o pedido.
 */

export const ORDERS_COLLECTION = "orders";
/** O lugar de onde a ida sai e para onde a volta retorna. */
export const ARMAZEM = "Armazém Dutelog";

const AbrirDemandaDoArmazem = z
  .object({
    idempotency_key: z.string().trim().min(1, "Informe a chave de idempotência.").max(200),
    order_id: z.string().trim().min(1, "Informe o pedido.").max(200).refine((valor) => !valor.includes("/"), "Pedido inválido."),
  })
  .strict();

export type PedidoDaDemandaDoArmazem = z.infer<typeof AbrirDemandaDoArmazem>;

const mensagens: z.ZodErrorMap = (issue) => {
  const campo = issue.path.join(".") || "entrada";
  if (issue.code === z.ZodIssueCode.unrecognized_keys) return { message: `Campo não aceito: ${issue.keys.join(", ")}.` };
  if (issue.code === z.ZodIssueCode.invalid_type && issue.received === "undefined") return { message: `Informe ${campo}.` };
  return { message: `${campo}: valor inválido.` };
};

export function interpretarDemandaDoArmazem(data: unknown): PedidoDaDemandaDoArmazem {
  const parsed = AbrirDemandaDoArmazem.safeParse(data ?? {}, { errorMap: mensagens });
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Dados inválidos.");
  return parsed.data;
}

function texto(valor: unknown): string {
  return typeof valor === "string" || typeof valor === "number" ? String(valor).trim() : "";
}

function registro(valor: unknown): Record<string, unknown> | null {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? (valor as Record<string, unknown>) : null;
}

/** A entrega pela Dutelog, como o WMS gravou (functions/wms/src/domain/order-delivery.ts). */
export type EntregaPelaDutelog = {
  destino: string;
  data: string;
  hora: string;
  contato: { nome: string; telefone: string | null } | null;
  montagem: boolean;
  retorno: { data: string; hora: string } | null;
  definidaEm: string | null;
  demanda: string | null;
};

export type PedidoDoWms = { id: string; numero: string; customerCode: string; status: string; entrega: Record<string, unknown> | null };

export function pedidoDoWms(id: string, dados: Record<string, unknown>): PedidoDoWms {
  return {
    id,
    numero: texto(dados.order_number) || texto(dados.num_pedido) || id,
    customerCode: texto(dados.customer_code),
    status: texto(dados.status).toUpperCase(),
    entrega: registro(dados.entrega),
  };
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Por que o pedido não vira demanda, ou a entrega pela Dutelog dele. Sem
 * entrega definida, ou com a retirada pelo cliente, não há OS; o pedido que
 * saiu, foi cancelado ou já virou demanda também não.
 */
export function entregaDoPedido(pedido: PedidoDoWms): EntregaPelaDutelog | string {
  if (!pedido.customerCode) return "O pedido está sem o cliente.";
  if (pedido.status === "EXPEDIDO" || pedido.status === "ENTREGUE" || pedido.status.startsWith("CANCEL")) return "O pedido já saiu do armazém.";
  const entrega = pedido.entrega;
  if (!entrega) return "Defina a entrega do pedido no WMS.";
  if (texto(entrega.modo) === "retirada") return "A retirada pelo cliente não gera OS.";
  if (texto(entrega.modo) !== "dutelog") return "Defina a entrega do pedido no WMS.";
  const demanda = texto(entrega.demanda);
  if (demanda) return `A entrega já virou a demanda ${demanda}.`;
  const destino = texto(entrega.destino);
  const data = texto(entrega.data);
  const hora = texto(entrega.hora);
  if (!destino || !DATA.test(data) || !HORA.test(hora)) return "A entrega do pedido está incompleta no WMS.";
  const contato = registro(entrega.contato);
  const retorno = registro(entrega.retorno);
  const dataDoRetorno = texto(retorno?.data);
  const horaDoRetorno = texto(retorno?.hora);
  return {
    destino,
    data,
    hora,
    contato: contato && texto(contato.nome).length >= 2 ? { nome: texto(contato.nome).slice(0, 80), telefone: texto(contato.telefone) || null } : null,
    montagem: entrega.montagem === true,
    retorno: retorno && DATA.test(dataDoRetorno) && HORA.test(horaDoRetorno) ? { data: dataDoRetorno, hora: horaDoRetorno } : null,
    definidaEm: texto(entrega.definida_em) || null,
    demanda: null,
  };
}

/** A data e a hora em São Paulo (sem horário de verão desde 2019), no formato que a direta pede. */
export function instanteDeSaoPaulo(data: string, hora: string): string {
  return new Date(`${data}T${hora}:00-03:00`).toISOString();
}

/**
 * Os itens pedidos da demanda, avulsos e sem preço: uma viagem de ida, a
 * montagem quando pedida e, com o retorno, a viagem de volta. Os nomes levam
 * as palavras que dão o serviço da OS (servicosDosItens).
 */
export function itensDaEntrega(pedido: Pick<PedidoDoWms, "numero">, entrega: Pick<EntregaPelaDutelog, "montagem" | "retorno">): { pedidos: ItemDoPedido[]; ida: number[]; volta: number[] } {
  const pedidos: ItemDoPedido[] = [{ lpu_item_id: null, item: `Transporte do pedido ${pedido.numero}`, unidade: "viagem", quantidade: "1" }];
  const ida = [0];
  if (entrega.montagem) {
    pedidos.push({ lpu_item_id: null, item: "Montagem no destino", unidade: "vb", quantidade: "1" });
    ida.push(pedidos.length - 1);
  }
  const volta: number[] = [];
  if (entrega.retorno) {
    pedidos.push({ lpu_item_id: null, item: `Desmontagem e retorno ao armazém do pedido ${pedido.numero}`, unidade: "viagem", quantidade: "1" });
    volta.push(pedidos.length - 1);
  }
  return { pedidos, ida, volta };
}

/** "Entrega do pedido PED-0118". */
export function tituloDaEntrega(pedido: Pick<PedidoDoWms, "numero">): string {
  return `Entrega do pedido ${pedido.numero}`.slice(0, 120);
}

/** O pedido do WMS a que a OS de volta retorna (`retorno_ao_armazem`, gravado pela abertura da entrega), ou null. */
export function retornoAoArmazem(os: Record<string, unknown>): { order_id: string; order_number: string } | null {
  const retorno = registro(os.retorno_ao_armazem);
  const orderId = texto(retorno?.order_id);
  if (!orderId || orderId.includes("/")) return null;
  return { order_id: orderId, order_number: texto(retorno?.order_number) || orderId };
}

/**
 * O retorno que a conclusão da volta grava no pedido do WMS (parte 4.5d): a
 * OS, a demanda e quando chegou, a receber no WMS. O retorno já recebido não
 * volta a ser esperado (a OS reaberta e concluída de novo não o repete).
 */
export function retornoNoPedido(pedido: Record<string, unknown>, os: { numero: string; demanda: string }, instante: string): Record<string, unknown> | null {
  const atual = registro(pedido.retorno);
  if (texto(atual?.status) === "recebido") return null;
  return { status: "a_receber", os: os.numero, demanda: os.demanda, chegou_em: instante, return_id: null };
}

