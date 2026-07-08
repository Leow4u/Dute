import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, productsTable } from "@workspace/db";
import { eq, ilike, and, sql, desc } from "drizzle-orm";

const router = Router();

const requireAuth = (req: any, res: any, next: any) => {
  const auth = getAuth(req);
  if (!auth?.userId) return res.status(401).json({ error: "Unauthorized" });
  next();
};

// GET /api/products
router.get("/", requireAuth, async (req: any, res: any) => {
  try {
    const { categoria, grupo, genero, search, limit = "100", offset = "0" } = req.query;
    const conditions: any[] = [];
    if (categoria) conditions.push(eq(productsTable.categoria, categoria as string));
    if (grupo) conditions.push(eq(productsTable.grupo, grupo as string));
    if (genero) conditions.push(eq(productsTable.genero, genero as string));
    if (search) {
      conditions.push(
        sql`(${productsTable.cod_cliente} ilike ${"%" + search + "%"} OR ${productsTable.produto} ilike ${"%" + search + "%"} OR ${productsTable.cor} ilike ${"%" + search + "%"})`
      );
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const [items, countResult] = await Promise.all([
      db.select().from(productsTable)
        .where(where)
        .orderBy(productsTable.cod_cliente)
        .limit(Number(limit))
        .offset(Number(offset)),
      db.select({ count: sql<number>`count(*)::int` }).from(productsTable).where(where),
    ]);
    res.json({ items, total: countResult[0].count });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/products/stats
router.get("/stats", requireAuth, async (req: any, res: any) => {
  try {
    const totalPecas = await db.select({ total: sql<number>`sum(estoque_btg)::int` }).from(productsTable);
    const stats = await db.select({
      categoria: productsTable.categoria,
      total_produtos: sql<number>`count(*)::int`,
      total_pecas: sql<number>`sum(estoque_btg)::int`,
      custo_total: sql<number>`coalesce(sum(custo_total::numeric), 0)`,
      pct_estoque: sql<number>`round(sum(estoque_btg)::numeric / nullif(${totalPecas[0].total}, 0) * 100, 2)`,
    })
      .from(productsTable)
      .groupBy(productsTable.categoria)
      .orderBy(desc(sql`sum(estoque_btg)`));
    res.json(stats);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/products/:id
router.get("/:id", requireAuth, async (req: any, res: any) => {
  try {
    const id = Number(req.params.id);
    const [product] = await db.select().from(productsTable).where(eq(productsTable.id, id));
    if (!product) return res.status(404).json({ error: "Not found" });
    res.json(product);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/products
router.post("/", requireAuth, async (req: any, res: any) => {
  try {
    const { cod_cliente, genero, categoria, grupo, produto, cor, tamanho, preco_unit } = req.body;
    if (!cod_cliente || !produto) return res.status(400).json({ error: "cod_cliente and produto are required" });
    const [created] = await db.insert(productsTable).values({
      cod_cliente,
      genero: genero || null,
      categoria: categoria || null,
      grupo: grupo || null,
      produto,
      cor: cor || null,
      tamanho: tamanho || null,
      preco_unit: preco_unit != null ? String(preco_unit) : null,
    }).returning();
    res.status(201).json(created);
  } catch (err: any) {
    req.log.error(err);
    if (err.code === "23505") return res.status(409).json({ error: "cod_cliente already exists" });
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/products/:id
router.patch("/:id", requireAuth, async (req: any, res: any) => {
  try {
    const id = Number(req.params.id);
    const { cod_cliente, genero, categoria, grupo, produto, cor, tamanho, preco_unit } = req.body;
    const updates: any = {};
    if (cod_cliente !== undefined) updates.cod_cliente = cod_cliente;
    if (genero !== undefined) updates.genero = genero;
    if (categoria !== undefined) updates.categoria = categoria;
    if (grupo !== undefined) updates.grupo = grupo;
    if (produto !== undefined) updates.produto = produto;
    if (cor !== undefined) updates.cor = cor;
    if (tamanho !== undefined) updates.tamanho = tamanho;
    if (preco_unit !== undefined) updates.preco_unit = preco_unit != null ? String(preco_unit) : null;
    const [updated] = await db.update(productsTable).set(updates).where(eq(productsTable.id, id)).returning();
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/products/:id
router.delete("/:id", requireAuth, async (req: any, res: any) => {
  try {
    const id = Number(req.params.id);
    await db.delete(productsTable).where(eq(productsTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
