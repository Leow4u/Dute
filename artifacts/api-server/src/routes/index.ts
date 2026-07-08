import { Router } from "express";
import { getAuth } from "@clerk/express";
import healthRouter from "./health";
import productsRouter from "./products";
import skusRouter from "./skus";
import movementsRouter from "./movements";
import ordersRouter from "./orders";
import dashboardRouter from "./dashboard";
import warehouseRouter from "./warehouse";
import reportsRouter from "./reports";
import importRouter from "./import";
import billingRouter from "./billing";
import { getUserRole } from "../lib/roles";

const router = Router();

// Bloqueia o papel "cliente" nas rotas internas (inventário). O cliente só
// pode acessar o portal de faturas (/billing/me/*). Rotas de billing internas
// aplicam requireInterno individualmente.
const blockCliente = async (req: any, res: any, next: any) => {
  const auth = getAuth(req);
  if (auth?.userId) {
    let role;
    try {
      role = await getUserRole(auth.userId);
    } catch (err) {
      // Fail-closed: sem conseguir determinar o papel, negamos o acesso interno.
      req.log?.error(err, "falha ao resolver papel do usuário");
      return res.status(503).json({ error: "Não foi possível verificar as permissões. Tente novamente." });
    }
    if (role === "cliente") return res.status(403).json({ error: "Forbidden" });
  }
  next();
};

router.use(healthRouter);
router.use("/products", blockCliente, productsRouter);
router.use("/skus", blockCliente, skusRouter);
router.use("/movements", blockCliente, movementsRouter);
router.use("/orders", blockCliente, ordersRouter);
router.use("/dashboard", blockCliente, dashboardRouter);
router.use("/warehouse", blockCliente, warehouseRouter);
router.use("/reports", blockCliente, reportsRouter);
router.use("/import", blockCliente, importRouter);
router.use("/billing", billingRouter);

export default router;
