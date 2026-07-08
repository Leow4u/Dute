import {
  pgTable,
  text,
  serial,
  timestamp,
  integer,
  numeric,
  boolean,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ─────────────────────────────────────────────────────────────
// Tabela de Preços (LPU) — serviços cobráveis e seus valores unitários.
// auto_source define de onde a quantidade é derivada automaticamente:
//   null              → quantidade manual (digitada pela equipe)
//   'ad_valorem'      → 0,X% sobre o custo total do estoque (linha especial)
//   'mov_entrada_pecas' → soma de peças em entradas no mês
//   'mov_saida_pecas'   → soma de peças em saídas no mês
//   'mov_count'         → nº de movimentações no mês
// ─────────────────────────────────────────────────────────────
export const billingPriceListTable = pgTable("billing_price_list", {
  id: serial("id").primaryKey(),
  grupo: text("grupo").notNull(),
  item: text("item").notNull(),
  unidade: text("unidade"),
  valor_unit: numeric("valor_unit", { precision: 12, scale: 4 }).notNull().default("0"),
  auto_source: text("auto_source"),
  ordem: integer("ordem").notNull().default(0),
  ativo: boolean("ativo").notNull().default(true),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

// Configuração de cobrança (linha única, id=1).
export const billingConfigTable = pgTable("billing_config", {
  id: integer("id").primaryKey().default(1),
  ad_valorem_rate: numeric("ad_valorem_rate", { precision: 6, scale: 4 }).notNull().default("0.005"),
  cliente_nome: text("cliente_nome").notNull().default("BTG Pactual"),
  cliente_email: text("cliente_email"),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

// Competência mensal (um mês de cobrança).
export const billingPeriodsTable = pgTable("billing_periods", {
  id: serial("id").primaryKey(),
  competencia: text("competencia").notNull().unique(), // YYYY-MM
  status: text("status").notNull().default("aberto"), // aberto | emitido | pago
  // Snapshots preenchidos no momento da emissão (faturas imutáveis).
  ad_valorem_rate: numeric("ad_valorem_rate", { precision: 6, scale: 4 }),
  custo_estoque: numeric("custo_estoque", { precision: 16, scale: 2 }),
  total: numeric("total", { precision: 16, scale: 2 }),
  emitido_em: timestamp("emitido_em", { withTimezone: true }),
  emitido_por: text("emitido_por"),
  email_enviado_em: timestamp("email_enviado_em", { withTimezone: true }),
  pago_em: timestamp("pago_em", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

// Quantidades manuais por competência (só para meses em aberto).
export const billingManualTable = pgTable(
  "billing_period_manual",
  {
    id: serial("id").primaryKey(),
    period_id: integer("period_id").notNull(),
    price_list_id: integer("price_list_id").notNull(),
    qtde: numeric("qtde", { precision: 14, scale: 2 }).notNull().default("0"),
    observacao: text("observacao"),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [unique("billing_manual_period_item_uq").on(table.period_id, table.price_list_id)],
);

// Linhas congeladas da fatura (gravadas na emissão — imutáveis).
export const billingInvoiceItemsTable = pgTable("billing_invoice_items", {
  id: serial("id").primaryKey(),
  period_id: integer("period_id").notNull(),
  grupo: text("grupo").notNull(),
  item: text("item").notNull(),
  unidade: text("unidade"),
  qtde: numeric("qtde", { precision: 14, scale: 2 }).notNull().default("0"),
  valor_unit: numeric("valor_unit", { precision: 12, scale: 4 }).notNull().default("0"),
  total: numeric("total", { precision: 16, scale: 2 }).notNull().default("0"),
  ordem: integer("ordem").notNull().default(0),
});

export const insertPriceListSchema = createInsertSchema(billingPriceListTable).omit({
  id: true,
  created_at: true,
  updated_at: true,
});
export type PriceListItem = typeof billingPriceListTable.$inferSelect;
export type BillingPeriod = typeof billingPeriodsTable.$inferSelect;
export type BillingInvoiceItem = typeof billingInvoiceItemsTable.$inferSelect;
export type BillingConfig = typeof billingConfigTable.$inferSelect;
export { z };
