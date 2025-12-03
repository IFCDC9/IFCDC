import { Router } from "express";
import * as chaptersController from "../controllers/chapters.controller";
import { requireAdmin } from "../middleware/auth";

const router = Router();

router.get("/", chaptersController.list);
router.get("/:id", chaptersController.getById);

router.post("/", requireAdmin, chaptersController.create);
router.put("/:id", requireAdmin, chaptersController.update);

export default router;
