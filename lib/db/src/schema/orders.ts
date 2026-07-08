import { pgTable, text, serial, timestamp, integer, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const ordersTable = pgTable("orders", {
  id: serial("id").primaryKey(),
  num_pedido: text("num_pedido").notNull(),
  data_solic: date("data_solic", { mode: "string" }),
  canal: text("canal"),
  solicitante: text("solicitante"),
  cod_cliente: text("cod_cliente").notNull(),
  produto: text("produto").notNull(),
  qtd_solic: integer("qtd_solic").notNull(),
  qtd_sep: integer("qtd_sep"),
  estoque: text("estoque"),
  status: text("status").notNull().default("Pendente"),
  data_exped: date("data_exped", { mode: "string" }),
  nf: text("nf"),
  po_btg: text("po_btg"),
  obs: text("obs"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertOrderSchema = createInsertSchema(ordersTable).omit({
  id: true,
  created_at: true,
  updated_at: true,
});
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order = typeof ordersTable.$inferSelect;
