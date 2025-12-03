import { Router } from "express";
import * as queueController from "../controllers/queue.controller";
import { requireAdminOrSupervisor } from "../middleware/auth";

const router = Router();

router.get("/my-queue", requireAdminOrSupervisor, queueController.myQueue);
router.get("/high-risk", requireAdminOrSupervisor, queueController.highRiskQueue);

export default router;
