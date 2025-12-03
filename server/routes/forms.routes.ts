import { Router } from "express";
import * as formsController from "../controllers/forms.controller";
import { requireAuth, requireAdmin } from "../middleware/auth";

const router = Router();

router.get("/", requireAuth, formsController.listForms);
router.get("/:slug", requireAuth, formsController.getFormBySlug);
router.post("/:slug/submit", requireAuth, formsController.submitForm);

router.get("/:slug/submissions", requireAdmin, formsController.listSubmissionsForForm);
router.get("/submission/:id", requireAdmin, formsController.getSubmissionById);

export default router;
