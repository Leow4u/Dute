import { quandoEmTexto } from "./entrega";

/**
 * O retorno ao armazém do pedido de saída no WMS (docs/plataforma/fase-4-financeiro.md,
 * parte 4.5d): a OS de volta da entrega pela Dutelog, concluída, deixa o
 * retorno a receber no pedido; o armazém confere o que voltou e recebe uma
 * vez (`receiveOrderReturn`), numa devolução que segue para a disposição
 * física como as outras.
 */

export type RetornoAReceber = { orderId: string; numero: string; customerCode: string; os: string; chegouEm: string | null };

function texto(valor: unknown): string {
  return typeof valor === "string" || typeof valor === "number" ? String(valor).trim() : "";
}

/** O pedido com o retorno a receber (`orders/{id}.retorno`), ou null. */
export function retornoAReceber(id: string, dados: Record<string, unknown>): RetornoAReceber | null {
  const retorno = dados.retorno && typeof dados.retorno === "object" ? (dados.retorno as Record<string, unknown>) : null;
  if (!retorno || texto(retorno.status) !== "a_receber") return null;
  return {
    orderId: id,
    numero: texto(dados.order_number) || texto(dados.num_pedido) || id,
    customerCode: texto(dados.customer_code),
    os: texto(retorno.os),
    chegouEm: texto(retorno.chegou_em) || null,
  };
}

const DIA = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });
const HORA = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false });

/** "OS 10050-02 · chegou Sex 30/10 18:40". */
export function detalheDoRetorno(retorno: RetornoAReceber): string {
  const chegada = retorno.chegouEm && !Number.isNaN(Date.parse(retorno.chegouEm))
    ? `chegou ${quandoEmTexto(DIA.format(new Date(retorno.chegouEm)), HORA.format(new Date(retorno.chegouEm)))}`
    : null;
  return [retorno.os ? `OS ${retorno.os}` : null, chegada].filter(Boolean).join(" · ");
}

export type LinhaDoRetorno = { id: string; skuCode: string; clientItemCode: string; nome: string; saiu: number; voltou: string };

/** As linhas do pedido (`order_items`), com o que saiu; o que voltou começa igual. */
export function linhaDoRetorno(id: string, dados: Record<string, unknown>): LinhaDoRetorno | null {
  const skuCode = texto(dados.sku_code);
  const clientItemCode = texto(dados.client_item_code) || skuCode;
  const saiu = Number(dados.picked_qty || dados.allocated_qty || dados.requested_qty || 0);
  if (!skuCode || !(saiu > 0)) return null;
  return { id, skuCode, clientItemCode, nome: texto(dados.product_name) || skuCode, saiu, voltou: String(saiu) };
}

/** O que falta antes de receber: a quantidade inteira, de zero ao que saiu, e ao menos um item que voltou. */
export function problemaDoRetorno(linhas: readonly LinhaDoRetorno[]): string | null {
  for (const linha of linhas) {
    const valor = linha.voltou.trim();
    if (!/^\d+$/.test(valor)) return `${linha.nome}: informe quantos voltaram.`;
    if (Number(valor) > linha.saiu) return `${linha.nome}: voltaram mais do que saiu (${linha.saiu}).`;
  }
  if (!linhas.some((linha) => Number(linha.voltou) > 0)) return "Informe ao menos um item que voltou.";
  return null;
}

/** O que vai para `receiveOrderReturn`: só o que voltou. Chame só sem problema. */
export function pedidoDoRetorno(orderId: string, linhas: readonly LinhaDoRetorno[], notas: string, chave: string): Record<string, unknown> {
  return {
    idempotency_key: chave,
    order_id: orderId,
    items: linhas
      .filter((linha) => Number(linha.voltou) > 0)
      .map((linha) => ({ sku_code: linha.skuCode, client_item_code: linha.clientItemCode, product_name: linha.nome, quantity: Number(linha.voltou) })),
    ...(notas.trim() ? { notes: notas.trim().slice(0, 300) } : {}),
  };
}
