import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, productsTable, skusTable } from "@workspace/db";
import { eq, ilike, and, sql, desc } from "drizzle-orm";

// Estoque e custo são derivados dos SKUs em tempo de leitura (fonte da verdade:
// skus.estoque_atual, atualizado pelas movimentações). custo = preço unit. × estoque.
const estoqueBtgSql = sql<number>`coalesce(sum(${skusTable.estoque_atual}), 0)::int`;
const numSkusSql = sql<number>`count(${skusTable.id})::int`;
const custoTotalSql = sql<number>`coalesce(${productsTable.preco_unit}::float8 * coalesce(sum(${skusTable.estoque_atual}), 0), 0)`;

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
      db.select({
        id: productsTable.id,
        cod_cliente: productsTable.cod_cliente,
        genero: productsTable.genero,
        categoria: productsTable.categoria,
        grupo: productsTable.grupo,
        produto: productsTable.produto,
        cor: productsTable.cor,
        tamanho: productsTable.tamanho,
        preco_unit: sql<number | null>`${productsTable.preco_unit}::float8`,
        estoque_btg: estoqueBtgSql,
        num_skus: numSkusSql,
        custo_total: custoTotalSql,
        created_at: productsTable.created_at,
        updated_at: productsTable.updated_at,
      }).from(productsTable)
        .leftJoin(skusTable, eq(skusTable.cod_cliente, productsTable.cod_cliente))
        .where(where)
        .groupBy(productsTable.id)
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
    const totalRow = await db.select({ total: sql<number>`coalesce(sum(${skusTable.estoque_atual}), 0)::int` }).from(skusTable);
    const total = totalRow[0].total;
    const stats = await db.select({
      categoria: productsTable.categoria,
      total_produtos: sql<number>`count(distinct ${productsTable.id})::int`,
      total_pecas: sql<number>`coalesce(sum(${skusTable.estoque_atual}), 0)::int`,
      custo_total: sql<number>`coalesce(sum(${productsTable.preco_unit}::float8 * ${skusTable.estoque_atual}), 0)`,
      pct_estoque: sql<number>`round(coalesce(sum(${skusTable.estoque_atual}), 0)::numeric / nullif(${total}, 0) * 100, 2)`,
    })
      .from(productsTable)
      .leftJoin(skusTable, eq(skusTable.cod_cliente, productsTable.cod_cliente))
      .groupBy(productsTable.categoria)
      .orderBy(desc(sql`sum(${skusTable.estoque_atual})`));
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
    const [product] = await db.select({
      id: productsTable.id,
      cod_cliente: productsTable.cod_cliente,
      genero: productsTable.genero,
      categoria: productsTable.categoria,
      grupo: productsTable.grupo,
      produto: productsTable.produto,
      cor: productsTable.cor,
      tamanho: productsTable.tamanho,
      preco_unit: sql<number | null>`${productsTable.preco_unit}::float8`,
      estoque_btg: estoqueBtgSql,
      num_skus: numSkusSql,
      custo_total: custoTotalSql,
      created_at: productsTable.created_at,
      updated_at: productsTable.updated_at,
    }).from(productsTable)
      .leftJoin(skusTable, eq(skusTable.cod_cliente, productsTable.cod_cliente))
      .where(eq(productsTable.id, id))
      .groupBy(productsTable.id);
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
