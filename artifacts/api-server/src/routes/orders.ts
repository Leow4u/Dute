import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, ordersTable } from "@workspace/db";
import { eq, and, gte, lte, sql, desc, ilike } from "drizzle-orm";

const router = Router();

const requireAuth = (req: any, res: any, next: any) => {
  const auth = getAuth(req);
  if (!auth?.userId) return res.status(401).json({ error: "Unauthorized" });
  next();
};

// GET /api/orders
router.get("/", requireAuth, async (req: any, res: any) => {
  try {
    const { status, num_pedido, solicitante, date_from, date_to, limit = "100", offset = "0" } = req.query;
    const conditions: any[] = [];
    if (status) conditions.push(eq(ordersTable.status, status as string));
    if (num_pedido) conditions.push(eq(ordersTable.num_pedido, num_pedido as string));
    if (solicitante) conditions.push(ilike(ordersTable.solicitante, `%${solicitante}%`));
    if (date_from) conditions.push(gte(ordersTable.data_solic, date_from as string));
    if (date_to) conditions.push(lte(ordersTable.data_solic, date_to as string));
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const [items, countResult] = await Promise.all([
      db.select().from(ordersTable)
        .where(where)
        .orderBy(desc(ordersTable.data_solic), desc(ordersTable.id))
        .limit(Number(limit))
        .offset(Number(offset)),
      db.select({ count: sql<number>`count(*)::int` }).from(ordersTable).where(where),
    ]);
    res.json({ items, total: countResult[0].count });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/orders/:id
router.get("/:id", requireAuth, async (req: any, res: any) => {
  try {
    const id = Number(req.params.id);
    const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, id));
    if (!order) return res.status(404).json({ error: "Not found" });
    res.json(order);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/orders
router.post("/", requireAuth, async (req: any, res: any) => {
  try {
    const body = req.body;
    if (!body.num_pedido || !body.cod_cliente || !body.produto || body.qtd_solic == null) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    const [created] = await db.insert(ordersTable).values({
      num_pedido: body.num_pedido,
      data_solic: body.data_solic || null,
      canal: body.canal || null,
      solicitante: body.solicitante || null,
      cod_cliente: body.cod_cliente,
      produto: body.produto,
      qtd_solic: body.qtd_solic,
      qtd_sep: body.qtd_sep ?? null,
      estoque: body.estoque || null,
      status: body.status || "Pendente",
      data_exped: body.data_exped || null,
      nf: body.nf || null,
      po_btg: body.po_btg || null,
      obs: body.obs || null,
    }).returning();
    res.status(201).json(created);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/orders/:id
router.patch("/:id", requireAuth, async (req: any, res: any) => {
  try {
    const id = Number(req.params.id);
    const body = req.body;
    const updates: any = {};
    const fields = ["num_pedido", "data_solic", "canal", "solicitante", "cod_cliente", "produto",
      "qtd_solic", "qtd_sep", "estoque", "status", "data_exped", "nf", "po_btg", "obs"];
    for (const f of fields) {
      if (body[f] !== undefined) updates[f] = body[f] !== "" ? body[f] : null;
    }
    const [updated] = await db.update(ordersTable).set(updates).where(eq(ordersTable.id, id)).returning();
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/orders/:id
router.delete("/:id", requireAuth, async (req: any, res: any) => {
  try {
    const id = Number(req.params.id);
    await db.delete(ordersTable).where(eq(ordersTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
