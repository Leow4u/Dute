import { Router } from "express";
import healthRouter from "./health";
import productsRouter from "./products";
import skusRouter from "./skus";
import movementsRouter from "./movements";
import ordersRouter from "./orders";
import dashboardRouter from "./dashboard";
import warehouseRouter from "./warehouse";
import reportsRouter from "./reports";
import importRouter from "./import";

const router = Router();

router.use(healthRouter);
router.use("/products", productsRouter);
router.use("/skus", skusRouter);
router.use("/movements", movementsRouter);
router.use("/orders", ordersRouter);
router.use("/dashboard", dashboardRouter);
router.use("/warehouse", warehouseRouter);
router.use("/reports", reportsRouter);
router.use("/import", importRouter);

export default router;
