import { pgTable, text, serial, timestamp, integer, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const movementsTable = pgTable("movements", {
  id: serial("id").primaryKey(),
  data: date("data", { mode: "string" }).notNull(),
  tipo_mov: text("tipo_mov").notNull(),
  cod_sku: text("cod_sku").notNull(),
  produto: text("produto").notNull(),
  qtde: integer("qtde").notNull(),
  sinal: integer("sinal").notNull(),
  estoque_tipo: text("estoque_tipo"),
  origem: text("origem"),
  destino: text("destino"),
  evento_ref: text("evento_ref"),
  doc_nf: text("doc_nf"),
  responsavel: text("responsavel"),
  caixa_origem: text("caixa_origem"),
  estoque_resultante: integer("estoque_resultante"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertMovementSchema = createInsertSchema(movementsTable).omit({
  id: true,
  estoque_resultante: true,
  created_at: true,
});
export type InsertMovement = z.infer<typeof insertMovementSchema>;
export type Movement = typeof movementsTable.$inferSelect;
