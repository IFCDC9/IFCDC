import { Router } from "express";
import * as formsController from "../controllers/forms.controller";
import { requireAuth, requireAdmin, requireAdminOrSupervisor } from "../middleware/auth";

const router = Router();

router.get("/", requireAuth, formsController.listForms);
router.get("/:slug", requireAuth, formsController.getFormBySlug);
router.post("/:slug/submit", requireAuth, formsController.submitForm);

router.get("/:slug/submissions", requireAdmin, formsController.listSubmissionsForForm);
router.get("/submission/:id", requireAdmin, formsController.getSubmissionById);
router.patch("/submission/:id/status", requireAdminOrSupervisor, formsController.updateSubmissionStatus);
router.patch("/submission/:id/assign", requireAdminOrSupervisor, formsController.assignSubmission);

export default router;
