import { Router } from "express";
import * as usersController from "../controllers/users.controller";

const router = Router();

router.get("/", usersController.getAll);
router.get("/:id", usersController.getById);

export default router;
