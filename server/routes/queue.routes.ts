import { Router } from "express";
import * as queueController from "../controllers/queue.controller";
import { requireAuth } from "../middleware/auth";

const router = Router();

router.get("/my-queue", requireAuth(["admin", "supervisor"]), queueController.myQueue);
router.get("/high-risk", requireAuth(["admin", "supervisor"]), queueController.highRiskQueue);

export default router;
