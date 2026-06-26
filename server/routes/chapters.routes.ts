import { Router } from "express";
import * as chaptersController from "../controllers/chapters.controller";
import { requireAuth } from "../middleware/auth";

const router = Router();

router.get("/", chaptersController.list);
router.get("/:id", chaptersController.getById);

router.post("/", requireAuth(["admin"]), chaptersController.create);
router.put("/:id", requireAuth(["admin"]), chaptersController.update);

export default router;
