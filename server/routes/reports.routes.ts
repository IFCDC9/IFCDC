import { Router } from "express";
import * as reportsController from "../controllers/reports.controller";
import { requireAdminOrSupervisor } from "../middleware/auth";

const router = Router();

router.get("/overview", requireAdminOrSupervisor, reportsController.overview);
router.get("/incidents/by-program", requireAdminOrSupervisor, reportsController.incidentsByProgram);
router.get("/incidents/time-series", requireAdminOrSupervisor, reportsController.incidentsTimeSeries);
router.get("/incidents/export/csv", requireAdminOrSupervisor, reportsController.exportIncidentsCsv);

export default router;
