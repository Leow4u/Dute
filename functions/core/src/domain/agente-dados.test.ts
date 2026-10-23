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

/** A Operação, o Comercial, o Financeiro e a memória (parte 5.5d), com o mesmo "SAFRA" no outro cliente. */
export const DADOS_DOS_MODULOS: ColecoesFalsas = {
  demands: porId(
    { id: "10050", numero: "10050", customer_code: "ITAU", etapa: "para_planejar", titulo: "Mudança Faria Lima", execucao: { de: "2026-10-27", ate: "2026-10-28", a_definir: false }, os_numeros: ["10050-01", "10050-02"], escopo: [{ item: "Mesa", unidade: "un", quantidade: "12" }], updated_at: "2026-10-22T12:00:00.000Z" },
    { id: "10051", numero: "10051", customer_code: "ITAU", etapa: "em_montagem", titulo: "Proposta em montagem", updated_at: "2026-10-23T12:00:00.000Z" },
    { id: "10049", numero: "10049", customer_code: "ITAU", etapa: "paga", titulo: "Montagem antiga", faturamento: { nf: { numero: "1234" } }, updated_at: "2026-09-10T12:00:00.000Z" },
    { id: "10090", numero: "10090", customer_code: "SAFRA", etapa: "para_planejar", titulo: "SAFRA mudança", updated_at: "2026-10-23T12:00:00.000Z" },
  ),
  service_orders: porId(
    {
      id: "10050-01",
      numero: "10050-01",
      customer_code: "ITAU",
      demanda: "10050",
      tipo: "servico",
      status: "agendada",
      janela: { data: "2026-10-27", inicio: "08:00", fim: "12:00" },
      servicos: ["transporte", "montagem"],
      equipe: [{ colaborador_id: "col_1", nome: "Carlos", papel: "lider" }],
      veiculos: [{ veiculo_id: "vei_1", placa: "ABC1D23", tipo: "caminhão" }],
      itens: [{ item: "Mesa", unidade: "un", planejado: "12" }],
    },
    { id: "10050-02", numero: "10050-02", customer_code: "ITAU", demanda: "10050", tipo: "servico", status: "cancelada", janela: { data: "2026-10-28", inicio: null, fim: null } },
    { id: "10090-01", numero: "10090-01", customer_code: "SAFRA", demanda: "10090", tipo: "servico", status: "agendada", janela: { data: "2026-10-27", inicio: "09:00", fim: null }, equipe: [{ nome: "SAFRA equipe" }] },
  ),
  quotes: porId(
    {
      id: "10050",
      numero: "10050",
      customer_code: "ITAU",
      rv: 1,
      tipo_rv: "proposta",
      status: "enviado",
      data_base: "2026-10-01",
      validade_dias: 15,
      subtotal_cents: 1250000,
      ajustes_cents: 0,
      total_cents: 1250000,
      linhas: [
        { lpu_item_id: "lpu_mesa", item: "Mesa", servico: "Montagem", unidade: "un", quantidade: "12", preco: "850.00", total_cents: 1020000, origem: "tabela" },
        { lpu_item_id: "lpu_arm", item: "Armário", servico: "Montagem", unidade: "un", quantidade: "2", preco: "1150", total_cents: 230000, origem: "alterado" },
      ],
      updated_at: "2026-10-22T12:00:00.000Z",
    },
    { id: "10051", numero: "10051", customer_code: "ITAU", rv: 0, status: "rascunho", total_cents: 50000, linhas: [], updated_at: "2026-10-23T12:00:00.000Z" },
    { id: "10090", numero: "10090", customer_code: "SAFRA", status: "enviado", total_cents: 999900, linhas: [{ lpu_item_id: "lpu_mesa", item: "Mesa SAFRA", quantidade: "12" }], updated_at: "2026-10-23T12:00:00.000Z" },
  ),
  price_tables: porId(
    { id: "pt_itau", customer_code: "ITAU", nome: "Tabela Itaú 2026", status: "ativa", vigente_de: "2026-01-01", precos: { lpu_mesa: { preco: "850.00" } } },
    { id: "pt_padrao", customer_code: null, nome: "Padrão Dutelog", status: "ativa", vigente_de: "2026-01-01", precos: { lpu_mesa: { preco: "900" }, lpu_arm: { preco: "1200" } } },
    { id: "pt_safra", customer_code: "SAFRA", nome: "Tabela SAFRA", status: "ativa", precos: { lpu_mesa: { preco: "1" } } },
  ),
  lpu_items: porId(
    { id: "lpu_mesa", item: "Mesa", servico: "Montagem", unidade: "un", categoria: "Mobiliário", ativo: true, orcavel: true },
    { id: "lpu_arm", item: "Armário", servico: "Montagem", unidade: "un", categoria: "Mobiliário", ativo: true, orcavel: true },
    { id: "lpu_velho", item: "Mesa antiga", servico: "Montagem", ativo: false },
    { id: "lpu_guarda", item: "Mesa guardada", servico: "Armazenagem", ativo: true, orcavel: false },
  ),
  client_invoices: porId(
    { id: "ITAU__2026-09", customer_code: "ITAU", competencia: "2026-09", status: "emitido", payment_status: "issued", total_cents: 300000, emitido_em: "2026-10-05T12:00:00.000Z" },
    { id: "ITAU__2026-08", customer_code: "ITAU", competencia: "2026-08", status: "pago", payment_status: "paid", total_cents: 280000, pago_em: "2026-09-20T12:00:00.000Z" },
    { id: "SAFRA__2026-09", customer_code: "SAFRA", competencia: "2026-09", status: "emitido", total_cents: 12300 },
  ),
  client_faturas: porId(
    { id: "fat_1", customer_code: "ITAU", nf: { numero: "1234", serie: "1" }, status: "enviada", valor_cents: 1250000, recebido_cents: 250000, saldo_cents: 1000000, vencimento: "2026-10-10", demandas: [{ numero: "10049", titulo: "Montagem antiga" }] },
    { id: "fat_9", customer_code: "SAFRA", nf: { numero: "9999" }, status: "enviada", valor_cents: 1, vencimento: "2026-10-10", demandas: [{ numero: "10090", titulo: "SAFRA mudança" }] },
  ),
  faturas: porId(
    { id: "fat_1", customer_code: "ITAU", nf: { numero: "1234", serie: "1" }, status: "enviada", valor_cents: 1250000, recebido_cents: 250000, vencimento: "2026-10-10" },
    { id: "fat_2", customer_code: "ITAU", nf: { numero: "1300" }, status: "emitida", valor_cents: 80000, recebido_cents: 0, vencimento: "2026-11-10" },
    { id: "fat_3", customer_code: "ITAU", nf: { numero: "1100" }, status: "paga", valor_cents: 50000, recebido_cents: 50000, vencimento: "2026-08-10" },
    { id: "fat_9", customer_code: "SAFRA", nf: { numero: "SAFRA-9" }, status: "enviada", valor_cents: 1, vencimento: "2026-10-01" },
  ),
  ai_measures: porId(
    { id: "med_itau_mesa", tipo: "duracao_item", escopo: "cliente", customer_code: "ITAU", lpu_item_id: "lpu_mesa", item: "Mesa", unidade: "un", homem_minuto_por_unidade: 30, execucoes: 6, os_recentes: ["10040-01"] },
    { id: "med_itau_arm", tipo: "duracao_item", escopo: "cliente", customer_code: "ITAU", lpu_item_id: "lpu_arm", item: "Armário", unidade: "un", homem_minuto_por_unidade: 50, execucoes: 2, os_recentes: ["10041-01"] },
    { id: "med_geral_mesa", tipo: "duracao_item", escopo: "geral", customer_code: null, lpu_item_id: "lpu_mesa", item: "Mesa", unidade: "un", homem_minuto_por_unidade: 28, execucoes: 40, os_recentes: ["10090-01"] },
    { id: "med_geral_arm", tipo: "duracao_item", escopo: "geral", customer_code: null, lpu_item_id: "lpu_arm", item: "Armário", unidade: "un", homem_minuto_por_unidade: 45, execucoes: 20, os_recentes: ["10090-01"] },
    { id: "med_geral_cad", tipo: "duracao_item", escopo: "geral", customer_code: null, lpu_item_id: "lpu_cad", item: "Cadeira", unidade: "un", homem_minuto_por_unidade: 5, execucoes: 3, os_recentes: ["10090-01"] },
    { id: "med_itau_plano", tipo: "erro_planejamento", escopo: "cliente", customer_code: "ITAU", erro_medio_pct: 22, execucoes: 8, os_recentes: ["10040-01"] },
    { id: "med_safra_mesa", tipo: "duracao_item", escopo: "cliente", customer_code: "SAFRA", lpu_item_id: "lpu_mesa", item: "Mesa SAFRA", homem_minuto_por_unidade: 99, execucoes: 50 },
  ),
  ai_case_memory: porId(
    {
      id: "10049",
      demanda: "10049",
      customer_code: "ITAU",
      titulo: "Montagem antiga",
      itens: [{ lpu_item_id: "lpu_mesa", item: "Mesa", unidade: "un", orcado: "10", realizado: "10" }],
      vetor: { lpu_mesa: 2.398, lpu_arm: 1.099 },
      orcado_cents: 1100000,
      realizado_cents: 1200000,
      executado_de: "2026-09-01",
      executado_ate: "2026-09-02",
      os: ["10049-01"],
      resumo: "Montagem antiga, orçado R$ 11.000,00",
      fechada_em: "2026-09-10T12:00:00.000Z",
    },
    { id: "10080", demanda: "10080", customer_code: "ITAU", titulo: "Outra coisa", itens: [], vetor: { lpu_outro: 1 }, fechada_em: "2026-08-10T12:00:00.000Z" },
    { id: "10095", demanda: "10095", customer_code: "SAFRA", titulo: "SAFRA caso", itens: [], vetor: { lpu_mesa: 2.398, lpu_arm: 1.099 }, orcado_cents: 1, fechada_em: "2026-09-11T12:00:00.000Z" },
  ),
};
