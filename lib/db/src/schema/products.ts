import { pgTable, text, serial, timestamp, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const productsTable = pgTable("products", {
  id: serial("id").primaryKey(),
  cod_cliente: text("cod_cliente").notNull().unique(),
  genero: text("genero"),
  categoria: text("categoria"),
  grupo: text("grupo"),
  produto: text("produto").notNull(),
  cor: text("cor"),
  tamanho: text("tamanho"),
  preco_unit: numeric("preco_unit", { precision: 12, scale: 2 }),
  estoque_btg: integer("estoque_btg").notNull().default(0),
  custo_total: numeric("custo_total", { precision: 14, scale: 2 }),
  num_skus: integer("num_skus").notNull().default(0),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertProductSchema = createInsertSchema(productsTable).omit({
  id: true,
  estoque_btg: true,
  custo_total: true,
  num_skus: true,
  created_at: true,
  updated_at: true,
});
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof productsTable.$inferSelect;
