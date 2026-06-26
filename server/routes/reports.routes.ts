import { Router } from "express";
import * as reportsController from "../controllers/reports.controller";
import { requireAuth } from "../middleware/auth";

const router = Router();

router.get("/overview", requireAuth(["admin", "supervisor"]), reportsController.overview);
router.get("/incidents/by-program", requireAuth(["admin", "supervisor"]), reportsController.incidentsByProgram);
router.get("/incidents/time-series", requireAuth(["admin", "supervisor"]), reportsController.incidentsTimeSeries);
router.get("/incidents/export/csv", requireAuth(["admin", "supervisor"]), reportsController.exportIncidentsCsv);

export default router;
