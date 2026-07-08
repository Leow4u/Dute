import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, skusTable } from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";

const router = Router();

const requireAuth = (req: any, res: any, next: any) => {
  const auth = getAuth(req);
  if (!auth?.userId) return res.status(401).json({ error: "Unauthorized" });
  next();
};

// GET /api/skus
router.get("/", requireAuth, async (req: any, res: any) => {
  try {
    const { cod_cliente, rua, prateleira, estoque_tipo, search, limit = "200", offset = "0" } = req.query;
    const conditions: any[] = [];
    if (cod_cliente) conditions.push(eq(skusTable.cod_cliente, cod_cliente as string));
    if (rua) conditions.push(eq(skusTable.rua, rua as string));
    if (prateleira) conditions.push(eq(skusTable.prateleira, prateleira as string));
    if (estoque_tipo) conditions.push(eq(skusTable.estoque_tipo, estoque_tipo as string));
    if (search) {
      conditions.push(
        sql`(${skusTable.cod_btg} ilike ${"%" + search + "%"} OR ${skusTable.cod_cliente} ilike ${"%" + search + "%"} OR ${skusTable.produto} ilike ${"%" + search + "%"} OR ${skusTable.caixa} ilike ${"%" + search + "%"})`
      );
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const [items, countResult] = await Promise.all([
      db.select().from(skusTable)
        .where(where)
        .orderBy(skusTable.rua, skusTable.prateleira, skusTable.caixa, skusTable.cod_btg)
        .limit(Number(limit))
        .offset(Number(offset)),
      db.select({ count: sql<number>`count(*)::int` }).from(skusTable).where(where),
    ]);
    res.json({ items, total: countResult[0].count });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/skus/:id
router.get("/:id", requireAuth, async (req: any, res: any) => {
  try {
    const id = Number(req.params.id);
    const [sku] = await db.select().from(skusTable).where(eq(skusTable.id, id));
    if (!sku) return res.status(404).json({ error: "Not found" });
    res.json(sku);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/skus
router.post("/", requireAuth, async (req: any, res: any) => {
  try {
    const body = req.body;
    if (!body.cod_btg || !body.cod_cliente || !body.produto) {
      return res.status(400).json({ error: "cod_btg, cod_cliente, produto are required" });
    }
    const [created] = await db.insert(skusTable).values({
      cod_btg: body.cod_btg,
      estoque_tipo: body.estoque_tipo || null,
      cod_cliente: body.cod_cliente,
      product_id: body.product_id || null,
      genero: body.genero || null,
      categoria: body.categoria || null,
      produto: body.produto,
      cor: body.cor || null,
      tamanho: body.tamanho || null,
      estoque_atual: body.estoque_atual ?? 0,
      estado: body.estado || null,
      rua: body.rua || null,
      prateleira: body.prateleira || null,
      caixa: body.caixa || null,
      endereco: body.endereco || null,
    }).returning();
    res.status(201).json(created);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/skus/:id
router.patch("/:id", requireAuth, async (req: any, res: any) => {
  try {
    const id = Number(req.params.id);
    const body = req.body;
    const updates: any = {};
    const fields = ["cod_btg", "estoque_tipo", "cod_cliente", "product_id", "genero", "categoria",
      "produto", "cor", "tamanho", "estoque_atual", "estado", "rua", "prateleira", "caixa", "endereco"];
    for (const f of fields) {
      if (body[f] !== undefined) updates[f] = body[f] !== "" ? body[f] : null;
    }
    const [updated] = await db.update(skusTable).set(updates).where(eq(skusTable.id, id)).returning();
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/skus/:id
router.delete("/:id", requireAuth, async (req: any, res: any) => {
  try {
    const id = Number(req.params.id);
    await db.delete(skusTable).where(eq(skusTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
