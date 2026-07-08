import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const skusTable = pgTable("skus", {
  id: serial("id").primaryKey(),
  cod_btg: text("cod_btg").notNull(),
  estoque_tipo: text("estoque_tipo"),
  cod_cliente: text("cod_cliente").notNull(),
  product_id: integer("product_id"),
  genero: text("genero"),
  categoria: text("categoria"),
  produto: text("produto").notNull(),
  cor: text("cor"),
  tamanho: text("tamanho"),
  estoque_atual: integer("estoque_atual").notNull().default(0),
  estado: text("estado"),
  rua: text("rua"),
  prateleira: text("prateleira"),
  caixa: text("caixa"),
  endereco: text("endereco"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  // Estoque/custo dos produtos são derivados via join skus.cod_cliente = products.cod_cliente
  index("skus_cod_cliente_idx").on(table.cod_cliente),
]);

export const insertSkuSchema = createInsertSchema(skusTable).omit({
  id: true,
  created_at: true,
  updated_at: true,
});
export type InsertSku = z.infer<typeof insertSkuSchema>;
export type Sku = typeof skusTable.$inferSelect;
