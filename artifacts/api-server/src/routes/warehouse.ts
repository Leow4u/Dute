import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, skusTable } from "@workspace/db";
import { sql, asc } from "drizzle-orm";

const router = Router();

const requireAuth = (req: any, res: any, next: any) => {
  const auth = getAuth(req);
  if (!auth?.userId) return res.status(401).json({ error: "Unauthorized" });
  next();
};

// GET /api/warehouse/map
router.get("/map", requireAuth, async (req: any, res: any) => {
  try {
    const skus = await db.select().from(skusTable)
      .orderBy(asc(skusTable.rua), asc(skusTable.prateleira), asc(skusTable.caixa), asc(skusTable.cod_btg));

    // Group: rua → prateleira → caixa → skus[]
    const map: Record<string, {
      rua: string;
      total_skus: number;
      total_caixas: number;
      total_pecas: number;
      prateleiras: Record<string, {
        prateleira: string;
        caixas: Record<string, { caixa: string; skus: any[] }>;
      }>;
    }> = {};

    for (const sku of skus) {
      const rua = sku.rua || "Sem Rua";
      const prateleira = sku.prateleira || "Sem Prateleira";
      const caixa = sku.caixa || "Sem Caixa";

      if (!map[rua]) {
        map[rua] = { rua, total_skus: 0, total_caixas: 0, total_pecas: 0, prateleiras: {} };
      }
      if (!map[rua].prateleiras[prateleira]) {
        map[rua].prateleiras[prateleira] = { prateleira, caixas: {} };
      }
      if (!map[rua].prateleiras[prateleira].caixas[caixa]) {
        map[rua].prateleiras[prateleira].caixas[caixa] = { caixa, skus: [] };
        map[rua].total_caixas++;
      }
      map[rua].prateleiras[prateleira].caixas[caixa].skus.push(sku);
      map[rua].total_skus++;
      map[rua].total_pecas += sku.estoque_atual;
    }

    const result = Object.values(map).map(r => ({
      rua: r.rua,
      total_skus: r.total_skus,
      total_caixas: r.total_caixas,
      total_pecas: r.total_pecas,
      prateleiras: Object.values(r.prateleiras).map(p => ({
        prateleira: p.prateleira,
        caixas: Object.values(p.caixas),
      })),
    }));

    res.json(result);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
