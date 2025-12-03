import { Router } from "express";
import * as chaptersController from "../controllers/chapters.controller";

const router = Router();

router.get("/", chaptersController.getAll);
router.get("/active", chaptersController.getActive);
router.get("/:id", chaptersController.getById);
router.post("/", chaptersController.create);
router.patch("/:id", chaptersController.update);
router.delete("/:id", chaptersController.remove);

export default router;
