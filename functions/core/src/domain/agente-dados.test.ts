import type { ColecoesFalsas } from "./agente-banco-falso.test.js";

/**
 * Apoio dos testes do Agent Dute (partes 5.5c e 5.5d), sem teste próprio: os
 * dados sintéticos de dois clientes. Tudo que é do outro cliente leva "SAFRA"
 * no texto, para o vazamento aparecer na resposta.
 */

export function porId(...documentos: Array<Record<string, unknown> & { id: string }>) {
  return Object.fromEntries(documentos.map(({ id, ...dados }) => [id, dados]));
}

export const DADOS_DA_ARMAZENAGEM: ColecoesFalsas = {
  client_inventory: porId(
    { id: "i1", customer_code: "ITAU", sku_code: "ITAU-000001", client_item_code: "POLO-M", product_name: "Camisa polo", qty_on_hand: 30, qty_reserved: 5, estoque_minimo: 40 },
    { id: "i2", customer_code: "ITAU", sku_code: "ITAU-000002", product_name: "Caneca", qty_on_hand: 0 },
    { id: "i3", customer_code: "ITAU", sku_code: "ITAU-000003", product_name: "Boné antigo", qty_on_hand: 2, client_archived: true },
    { id: "s1", customer_code: "SAFRA", sku_code: "SAFRA-000001", product_name: "Camisa polo SAFRA", qty_on_hand: 900 },
  ),
  client_request_status: porId(
    { id: "r1", customer_code: "ITAU", request_number: "PED-0043", type: "pedido", title: "Faria Lima", status: "approved", operational_status: "dispatched", updated_at: "2026-10-22T12:00:00.000Z" },
    { id: "r2", customer_code: "ITAU", request_number: "PED-0044", type: "pedido", status: "rejected", decision_reason: "Sem saldo", updated_at: "2026-10-21T12:00:00.000Z" },
    { id: "r9", customer_code: "SAFRA", request_number: "PED-9999", type: "pedido", title: "SAFRA Faria Lima", status: "approved", updated_at: "2026-10-23T12:00:00.000Z" },
  ),
  customer_requests: porId(
    { id: "r1", customer_code: "ITAU", request_number: "PED-0043", status: "approved", items: [{ client_item_code: "POLO-M", product_name: "Camisa polo", quantity: 3 }], created_at: "2026-10-20T12:00:00.000Z" },
    { id: "r3", customer_code: "ITAU", request_number: "PED-0045", status: "pending", type: "pedido", item_count: 2, created_at: "2026-10-18T12:00:00.000Z" },
    { id: "r9", customer_code: "SAFRA", request_number: "PED-9999", status: "pending", items: [{ product_name: "SAFRA item" }], created_at: "2026-10-01T12:00:00.000Z" },
  ),
  movements: porId(
    { id: "m1", customer_code: "ITAU", client_item_code: "POLO-M", product_name: "Camisa polo", tipo_mov: "SAIDA", quantity: 3, data: "2026-10-10T12:00:00.000Z" },
    { id: "m2", customer_code: "ITAU", client_item_code: "POLO-M", product_name: "Camisa polo", tipo_mov: "ENTRADA", quantity: 10, data: "2026-10-05T12:00:00.000Z" },
    { id: "m3", customer_code: "ITAU", client_item_code: "POLO-M", tipo_mov: "SAIDA", quantity: 99, data: "2026-08-01T12:00:00.000Z" },
    { id: "m9", customer_code: "SAFRA", client_item_code: "SAFRA-POLO", tipo_mov: "SAIDA", quantity: 500, data: "2026-10-10T12:00:00.000Z" },
  ),
  client_documents: porId(
    { id: "d1", customer_code: "ITAU", title: "Contrato de armazenagem", document_type: "contrato", customer_visible: true, created_at: "2026-09-01T12:00:00.000Z" },
    { id: "d2", customer_code: "ITAU", title: "Proposta interna", customer_visible: false },
    { id: "d9", customer_code: "SAFRA", title: "Contrato SAFRA", customer_visible: true },
  ),
  ai_agent_knowledge: porId(
    { id: "k1", customer_code: "ITAU", status: "active", title: "Contrato de armazenagem", source_document_id: "d1" },
    { id: "k2", customer_code: "ITAU", status: "active", title: "Proposta interna", source_document_id: "d2" },
    { id: "k9", customer_code: "SAFRA", status: "active", title: "Contrato SAFRA", source_document_id: "d9" },
  ),
  ai_agent_knowledge_chunks: porId(
    { id: "k1_0001", customer_code: "ITAU", knowledge_id: "k1", text: "A armazenagem é cobrada por posição.", title: "Contrato de armazenagem" },
    { id: "k2_0001", customer_code: "ITAU", knowledge_id: "k2", text: "Margem interna da proposta.", title: "Proposta interna" },
    { id: "k9_0001", customer_code: "SAFRA", knowledge_id: "k9", text: "Cláusula SAFRA.", title: "Contrato SAFRA" },
  ),
  inbound_receipts: porId(
    { id: "rc1", customer_code: "ITAU", receipt_number: "REC-0001", status: "checking", supplier: "Fornecedor A", created_at: "2026-10-20T12:00:00.000Z" },
    { id: "rc9", customer_code: "SAFRA", receipt_number: "REC-SAFRA", status: "checking", created_at: "2026-10-20T12:00:00.000Z" },
  ),
  pick_tasks: porId(
    { id: "p1", customer_code: "ITAU", order_number: "PED-0043", status: "picking", total_units: 3, created_at: "2026-10-21T12:00:00.000Z", updated_at: "2026-10-22T12:00:00.000Z" },
    { id: "p9", customer_code: "SAFRA", order_number: "PED-SAFRA", status: "picking", updated_at: "2026-10-22T12:00:00.000Z" },
  ),
  putaway_tasks: porId({ id: "g9", customer_code: "SAFRA", receipt_number: "REC-SAFRA", status: "planned", updated_at: "2026-10-22T12:00:00.000Z" }),
  stock_balances: porId(
    { id: "b1", customer_code: "ITAU", client_item_code: "POLO-M", product_name: "Camisa polo", location_id: "A-01-01", qty_on_hand: 30 },
    { id: "b9", customer_code: "SAFRA", client_item_code: "POLO-M", product_name: "Camisa polo SAFRA", location_id: "SAFRA-01", qty_on_hand: 900 },
  ),
  events: porId(
    { id: "e1", customer_code: "ITAU", title: "Pedido PED-0043 aprovado", actor: { name: "Ops", role: "interno" }, occurred_at: "2026-10-20T12:00:00.000Z" },
    { id: "e9", customer_code: "SAFRA", title: "Pedido SAFRA aprovado", occurred_at: "2026-10-21T12:00:00.000Z" },
  ),
  ai_stock_age: porId(
    { id: "a1", customer_code: "ITAU", sku_code: "ITAU-000001", client_item_code: "POLO-M", saldo: 30, relogio: { primeira_entrada: "2026-03-01T12:00:00.000Z", ultima_entrada: "2026-03-01T12:00:00.000Z", ultima_saida: "2026-06-01T12:00:00.000Z" } },
    { id: "a2", customer_code: "ITAU", sku_code: "ITAU-000002", saldo: 4, relogio: { primeira_entrada: "2026-10-01T12:00:00.000Z", ultima_entrada: "2026-10-01T12:00:00.000Z", ultima_saida: null } },
    { id: "a9", customer_code: "SAFRA", sku_code: "SAFRA-000001", saldo: 9, relogio: { primeira_entrada: "2025-01-01T12:00:00.000Z", ultima_entrada: "2025-01-01T12:00:00.000Z", ultima_saida: null } },
  ),
};
