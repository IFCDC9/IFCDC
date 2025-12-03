import { Router } from "express";
import * as formsController from "../controllers/forms.controller";
import { requireAuth } from "../middleware/auth";

const router = Router();

router.get("/", requireAuth(), formsController.listForms);
router.get("/:slug", requireAuth(), formsController.getFormBySlug);
router.post("/:slug/submit", requireAuth(), formsController.submitForm);

router.get("/:slug/submissions", requireAuth(["admin"]), formsController.listSubmissionsForForm);
router.get("/submission/:id", requireAuth(["admin"]), formsController.getSubmissionById);
router.patch("/submission/:id/status", requireAuth(["admin", "supervisor"]), formsController.updateSubmissionStatus);
router.patch("/submission/:id/assign", requireAuth(["admin", "supervisor"]), formsController.assignSubmission);

export default router;
