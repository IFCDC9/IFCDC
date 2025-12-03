import { Router } from "express";
import * as chaptersController from "../controllers/chapters.controller";
import { requireAdmin } from "../middleware/auth";

const router = Router();

router.get("/", chaptersController.getAll);
router.get("/active", chaptersController.getActive);
router.get("/:id", chaptersController.getById);

router.post("/", requireAdmin, chaptersController.create);
router.patch("/:id", requireAdmin, chaptersController.update);
router.delete("/:id", requireAdmin, chaptersController.remove);

export default router;
