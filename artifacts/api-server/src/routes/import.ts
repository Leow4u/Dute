import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, productsTable, skusTable, movementsTable, ordersTable } from "@workspace/db";

const router = Router();

const requireAuth = (req: any, res: any, next: any) => {
  const auth = getAuth(req);
  if (!auth?.userId) return res.status(401).json({ error: "Unauthorized" });
  next();
};

// POST /api/import/bulk
router.post("/bulk", requireAuth, async (req: any, res: any) => {
  try {
    const { products = [], skus = [], movements = [], orders = [] } = req.body;
    const errors: string[] = [];

    let products_imported = 0;
    let skus_imported = 0;
    let movements_imported = 0;
    let orders_imported = 0;

    // Import products in batches
    if (products.length > 0) {
      const BATCH = 100;
      for (let i = 0; i < products.length; i += BATCH) {
        const batch = products.slice(i, i + BATCH).map((p: any) => ({
          cod_cliente: p.cod_cliente,
          genero: p.genero || null,
          categoria: p.categoria || null,
          grupo: p.grupo || null,
          produto: p.produto,
          cor: p.cor || null,
          tamanho: p.tamanho || null,
          preco_unit: p.preco_unit != null ? String(p.preco_unit) : null,
        }));
        try {
          const result = await db.insert(productsTable).values(batch).onConflictDoNothing().returning();
          products_imported += result.length;
        } catch (e: any) {
          errors.push(`Products batch ${i}: ${e.message}`);
        }
      }
    }

    // Import SKUs in batches
    if (skus.length > 0) {
      const BATCH = 100;
      for (let i = 0; i < skus.length; i += BATCH) {
        const batch = skus.slice(i, i + BATCH).map((s: any) => ({
          cod_btg: s.cod_btg,
          estoque_tipo: s.estoque_tipo || null,
          cod_cliente: s.cod_cliente,
          product_id: s.product_id || null,
          genero: s.genero || null,
          categoria: s.categoria || null,
          produto: s.produto,
          cor: s.cor || null,
          tamanho: s.tamanho || null,
          estoque_atual: s.estoque_atual ?? 0,
          estado: s.estado || null,
          rua: s.rua || null,
          prateleira: s.prateleira ? String(s.prateleira) : null,
          caixa: s.caixa || null,
          endereco: s.endereco || null,
        }));
        try {
          const result = await db.insert(skusTable).values(batch).returning();
          skus_imported += result.length;
        } catch (e: any) {
          errors.push(`SKUs batch ${i}: ${e.message}`);
        }
      }
    }

    // Import movements in batches
    if (movements.length > 0) {
      const BATCH = 100;
      for (let i = 0; i < movements.length; i += BATCH) {
        const batch = movements.slice(i, i + BATCH).map((m: any) => ({
          data: m.data,
          tipo_mov: m.tipo_mov,
          cod_sku: m.cod_sku,
          produto: m.produto,
          qtde: m.qtde,
          sinal: m.sinal,
          estoque_tipo: m.estoque_tipo || null,
          origem: m.origem || null,
          destino: m.destino || null,
          evento_ref: m.evento_ref || null,
          doc_nf: m.doc_nf || null,
          responsavel: m.responsavel || null,
          caixa_origem: m.caixa_origem || null,
        }));
        try {
          const result = await db.insert(movementsTable).values(batch).returning();
          movements_imported += result.length;
        } catch (e: any) {
          errors.push(`Movements batch ${i}: ${e.message}`);
        }
      }
    }

    // Import orders in batches
    if (orders.length > 0) {
      const BATCH = 100;
      for (let i = 0; i < orders.length; i += BATCH) {
        const batch = orders.slice(i, i + BATCH).map((o: any) => ({
          num_pedido: o.num_pedido,
          data_solic: o.data_solic || null,
          canal: o.canal || null,
          solicitante: o.solicitante || null,
          cod_cliente: o.cod_cliente,
          produto: o.produto,
          qtd_solic: o.qtd_solic,
          qtd_sep: o.qtd_sep ?? null,
          estoque: o.estoque || null,
          status: o.status || "Pendente",
          data_exped: o.data_exped || null,
          nf: o.nf || null,
          po_btg: o.po_btg || null,
          obs: o.obs || null,
        }));
        try {
          const result = await db.insert(ordersTable).values(batch).returning();
          orders_imported += result.length;
        } catch (e: any) {
          errors.push(`Orders batch ${i}: ${e.message}`);
        }
      }
    }

    res.json({ products_imported, skus_imported, movements_imported, orders_imported, errors });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
