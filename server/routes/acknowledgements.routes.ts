import { Router } from "express";
import * as acknowledgementsController from "../controllers/acknowledgements.controller";

const router = Router();

router.get("/", acknowledgementsController.getStats);
router.get("/user/:userId", acknowledgementsController.getByUserId);
router.get("/chapter/:chapterId", acknowledgementsController.getByChapterId);
router.post("/", acknowledgementsController.create);

export default router;
