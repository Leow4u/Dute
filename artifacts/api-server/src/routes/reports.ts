import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, productsTable, skusTable, movementsTable, ordersTable } from "@workspace/db";
import { gte, lte, and } from "drizzle-orm";

const router = Router();

const requireAuth = (req: any, res: any, next: any) => {
  const auth = getAuth(req);
  if (!auth?.userId) return res.status(401).json({ error: "Unauthorized" });
  next();
};

// GET /api/reports/export
router.get("/export", requireAuth, async (req: any, res: any) => {
  try {
    const { type, date_from, date_to } = req.query;
    let data: any[] = [];

    if (type === "products") {
      data = await db.select().from(productsTable);
    } else if (type === "skus") {
      data = await db.select().from(skusTable);
    } else if (type === "movements") {
      const conditions: any[] = [];
      if (date_from) conditions.push(gte(movementsTable.data, date_from as string));
      if (date_to) conditions.push(lte(movementsTable.data, date_to as string));
      data = await db.select().from(movementsTable)
        .where(conditions.length > 0 ? and(...conditions) : undefined);
    } else if (type === "orders") {
      const conditions: any[] = [];
      if (date_from) conditions.push(gte(ordersTable.data_solic, date_from as string));
      if (date_to) conditions.push(lte(ordersTable.data_solic, date_to as string));
      data = await db.select().from(ordersTable)
        .where(conditions.length > 0 ? and(...conditions) : undefined);
    } else {
      return res.status(400).json({ error: "Invalid type. Must be products, skus, movements, or orders" });
    }

    res.json({ data, count: data.length });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
