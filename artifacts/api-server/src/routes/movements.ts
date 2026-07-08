import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, movementsTable, skusTable } from "@workspace/db";
import { eq, and, gte, lte, desc, sql } from "drizzle-orm";

const router = Router();

const requireAuth = (req: any, res: any, next: any) => {
  const auth = getAuth(req);
  if (!auth?.userId) return res.status(401).json({ error: "Unauthorized" });
  next();
};

// GET /api/movements
router.get("/", requireAuth, async (req: any, res: any) => {
  try {
    const { cod_sku, tipo_mov, date_from, date_to, responsavel, limit = "100", offset = "0" } = req.query;
    const conditions: any[] = [];
    if (cod_sku) conditions.push(eq(movementsTable.cod_sku, cod_sku as string));
    if (tipo_mov) conditions.push(eq(movementsTable.tipo_mov, tipo_mov as string));
    if (responsavel) conditions.push(eq(movementsTable.responsavel, responsavel as string));
    if (date_from) conditions.push(gte(movementsTable.data, date_from as string));
    if (date_to) conditions.push(lte(movementsTable.data, date_to as string));
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const [items, countResult] = await Promise.all([
      db.select().from(movementsTable)
        .where(where)
        .orderBy(desc(movementsTable.data), desc(movementsTable.id))
        .limit(Number(limit))
        .offset(Number(offset)),
      db.select({ count: sql<number>`count(*)::int` }).from(movementsTable).where(where),
    ]);
    res.json({ items, total: countResult[0].count });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/movements
router.post("/", requireAuth, async (req: any, res: any) => {
  try {
    const body = req.body;
    if (!body.data || !body.tipo_mov || !body.cod_sku || !body.produto || body.qtde == null || body.sinal == null) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const created = await db.transaction(async (tx) => {
      const [sku] = await tx.select().from(skusTable)
        .where(eq(skusTable.cod_btg, body.cod_sku))
        .for("update");

      let estoque_resultante: number | null = null;
      if (sku) {
        const newStock = Math.max(0, sku.estoque_atual + (body.qtde * body.sinal));
        await tx.update(skusTable).set({ estoque_atual: newStock }).where(eq(skusTable.id, sku.id));
        estoque_resultante = newStock;
      }

      const [mov] = await tx.insert(movementsTable).values({
        data: body.data,
        tipo_mov: body.tipo_mov,
        cod_sku: body.cod_sku,
        produto: body.produto,
        qtde: body.qtde,
        sinal: body.sinal,
        estoque_tipo: body.estoque_tipo || null,
        origem: body.origem || null,
        destino: body.destino || null,
        evento_ref: body.evento_ref || null,
        doc_nf: body.doc_nf || null,
        responsavel: body.responsavel || null,
        caixa_origem: body.caixa_origem || null,
        estoque_resultante,
      }).returning();
      return mov;
    });
    res.status(201).json(created);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
