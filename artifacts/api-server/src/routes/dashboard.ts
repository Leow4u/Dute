import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, productsTable, skusTable, movementsTable, ordersTable } from "@workspace/db";
import { sql, desc, eq } from "drizzle-orm";

const router = Router();

const requireAuth = (req: any, res: any, next: any) => {
  const auth = getAuth(req);
  if (!auth?.userId) return res.status(401).json({ error: "Unauthorized" });
  next();
};

// GET /api/dashboard
router.get("/", requireAuth, async (req: any, res: any) => {
  try {
    const [
      productTotals,
      skuTotals,
      categoryStats,
      recentMovements,
      orderStatusCounts,
    ] = await Promise.all([
      db.select({
        total_produtos: sql<number>`count(distinct ${productsTable.id})::int`,
        total_pecas: sql<number>`coalesce(sum(${skusTable.estoque_atual}), 0)::int`,
        custo_total: sql<number>`coalesce(sum(${productsTable.preco_unit}::float8 * ${skusTable.estoque_atual}), 0)`,
      }).from(productsTable)
        .leftJoin(skusTable, eq(skusTable.cod_cliente, productsTable.cod_cliente)),

      db.select({
        total_skus: sql<number>`count(*)::int`,
      }).from(skusTable),

      db.select({
        categoria: productsTable.categoria,
        total_produtos: sql<number>`count(distinct ${productsTable.id})::int`,
        total_pecas: sql<number>`coalesce(sum(${skusTable.estoque_atual}), 0)::int`,
        custo_total: sql<number>`coalesce(sum(${productsTable.preco_unit}::float8 * ${skusTable.estoque_atual}), 0)`,
        pct_estoque: sql<number>`0`,
      }).from(productsTable)
        .leftJoin(skusTable, eq(skusTable.cod_cliente, productsTable.cod_cliente))
        .groupBy(productsTable.categoria)
        .orderBy(desc(sql`sum(${skusTable.estoque_atual})`))
        .limit(10),

      db.select().from(movementsTable)
        .orderBy(desc(movementsTable.data), desc(movementsTable.id))
        .limit(10),

      db.select({
        status: ordersTable.status,
        count: sql<number>`count(*)::int`,
      }).from(ordersTable)
        .groupBy(ordersTable.status),
    ]);

    const totalPecas = productTotals[0].total_pecas || 0;
    const custoTotal = Number(productTotals[0].custo_total) || 0;
    const adValorem = custoTotal * 0.005;

    // Compute pct_estoque
    const byCategory = categoryStats.map(c => ({
      ...c,
      pct_estoque: totalPecas > 0 ? Number(((c.total_pecas / totalPecas) * 100).toFixed(2)) : 0,
      custo_total: Number(c.custo_total),
    }));

    res.json({
      total_produtos: productTotals[0].total_produtos,
      total_pecas: totalPecas,
      total_skus: skuTotals[0].total_skus,
      custo_total: custoTotal,
      ad_valorem: adValorem,
      recent_movements: recentMovements,
      by_category: byCategory,
      order_status_counts: orderStatusCounts,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
