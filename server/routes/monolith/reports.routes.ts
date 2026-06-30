import { Router } from "express";
import { authRequired, requireRole } from "../../middleware/legacyAuth";
import { getMonolithDb } from "../../monolith/dbAccess";
import { logAudit } from "../../monolith/audit";
import { ROLES } from "../../monolith/constants";
import {
  buildVolumeReportForUser,
  buildRiskMixReportForUser,
  buildProgramDashboardForUser,
  buildGoalsSummaryForUser,
} from "../../monolith/reportHelpers";

export function createReportsRouter(): Router {
  const router = Router();

// ----- Reports: Goals Summary (JSON) -----
router.get(
  "/reports/goals-summary",
  authRequired,
  requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER),
  async (req, res) => {
    try {
      let { from, to } = req.query as { from?: string; to?: string };

      const now = new Date();
      if (!from || !to) {
        const end = now;
        const start = new Date(now);
        start.setDate(start.getDate() - 90);
        from = from || start.toISOString();
        to = to || end.toISOString();
      }

      const summary = await buildGoalsSummaryForUser(req.user!, from, to);

      await logAudit(req, { action: "REPORT_GOALS_SUMMARY_JSON", targetType: "REPORT", targetId: null, extra: { from, to } });

      res.json({ from, to, programs: summary });
    } catch (err) {
      console.error("Error in /api/reports/goals-summary:", err);
      res.status(500).json({ error: "Failed to build goals summary report" });
    }
  }
);

// ----- Reports: Goals Summary (CSV) -----
router.get(
  "/reports/goals-summary.csv",
  authRequired,
  requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER),
  async (req, res) => {
    try {
      let { from, to } = req.query as { from?: string; to?: string };
      const now = new Date();

      if (!from || !to) {
        const end = now;
        const start = new Date(now);
        start.setDate(start.getDate() - 90);
        from = from || start.toISOString();
        to = to || end.toISOString();
      }

      const summary = await buildGoalsSummaryForUser(req.user!, from, to);

      await logAudit(req, { action: "REPORT_GOALS_SUMMARY_CSV", targetType: "REPORT", targetId: null, extra: { from, to } });

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="ifcdc_goals_summary.csv"');

      const rows: string[] = [];
      rows.push("program,total_goals,completed_in_range,from,to");

      for (const p of summary) {
        rows.push([p.program || "", p.totalGoals, p.completedInRange, from, to].join(","));
      }

      res.send(rows.join("\n"));
    } catch (err) {
      console.error("Error in /api/reports/goals-summary.csv:", err);
      res.status(500).setHeader("Content-Type", "text/plain; charset=utf-8").send("Failed to build goals summary CSV");
    }
  }
);

// ----- Reports: Program Dashboard (JSON) -----
router.get(
  "/reports/program-dashboard",
  authRequired,
  requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER),
  async (req, res) => {
    try {
      let { program, from, to } = req.query as { program?: string; from?: string; to?: string };

      if (!program) {
        return res.status(400).json({ error: "program is required" });
      }

      const now = new Date();
      if (!from || !to) {
        const end = now;
        const start = new Date(now);
        start.setDate(start.getDate() - 90);
        from = from || start.toISOString();
        to = to || end.toISOString();
      }

      const report = await buildProgramDashboardForUser(req.user!, program, from, to);

      await logAudit(req, { action: "REPORT_PROGRAM_DASHBOARD_JSON", targetType: "REPORT", targetId: null, extra: { program, from, to } });

      res.json(report);
    } catch (err) {
      console.error("Error in /api/reports/program-dashboard:", err);
      res.status(500).json({ error: "Failed to build program dashboard report" });
    }
  }
);

// ----- Reports: Volume (JSON) -----
router.get(
  "/reports/volume",
  authRequired,
  requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER),
  async (req, res) => {
    try {
      let { from, to, program } = req.query as { from?: string; to?: string; program?: string };
      const now = new Date();

      if (!from || !to) {
        const end = now;
        const start = new Date(now);
        start.setDate(start.getDate() - 30);
        from = from || start.toISOString();
        to = to || end.toISOString();
      }

      const report = await buildVolumeReportForUser(
        req.user!,
        from,
        to,
        program || null
      );

      await logAudit(req, { action: "REPORT_VOLUME_JSON", targetType: "REPORT", targetId: null, extra: {
        from,
        to,
        program,
      } });

      res.json(report);
    } catch (err) {
      console.error("Error in /api/reports/volume:", err);
      res.status(500).json({ error: "Failed to build volume report" });
    }
  }
);

// ----- Reports: Volume (CSV) -----
router.get(
  "/reports/volume.csv",
  authRequired,
  requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER),
  async (req, res) => {
    try {
      let { from, to, program } = req.query as { from?: string; to?: string; program?: string };
      const now = new Date();

      if (!from || !to) {
        const end = now;
        const start = new Date(now);
        start.setDate(start.getDate() - 30);
        from = from || start.toISOString();
        to = to || end.toISOString();
      }

      const report = await buildVolumeReportForUser(
        req.user!,
        from,
        to,
        program || null
      );

      await logAudit(req, { action: "REPORT_VOLUME_CSV", targetType: "REPORT", targetId: null, extra: {
        from,
        to,
        program,
      } });

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="ifcdc_volume_report.csv"'
      );

      const rows: string[] = [];
      rows.push("section,metric,category,value,from,to,program");

      // Summary
      rows.push(
        [
          "summary",
          "clients_served",
          "",
          report.totalClientsServed,
          report.from,
          report.to,
          report.program || "",
        ].join(",")
      );
      rows.push(
        [
          "summary",
          "appointments_total",
          "",
          report.totalAppointments,
          report.from,
          report.to,
          report.program || "",
        ].join(",")
      );
      rows.push(
        [
          "summary",
          "encounters_total",
          "",
          report.totalEncounters,
          report.from,
          report.to,
          report.program || "",
        ].join(",")
      );

      // Appointments by program
      for (const p of report.appointmentsByProgram || []) {
        rows.push(
          [
            "appointments_by_program",
            "appointments",
            p.program || "Unspecified",
            p.count,
            report.from,
            report.to,
            report.program || "",
          ].join(",")
        );
      }

      // Encounters by type
      for (const e of report.encountersByType || []) {
        rows.push(
          [
            "encounters_by_type",
            "encounters",
            e.type || "Unspecified",
            e.count,
            report.from,
            report.to,
            report.program || "",
          ].join(",")
        );
      }

      res.send(rows.join("\n"));
    } catch (err) {
      console.error("Error in /api/reports/volume.csv:", err);
      res.status(500)
        .setHeader("Content-Type", "text/plain; charset=utf-8")
        .send("Failed to build volume CSV");
    }
  }
);

// ----- Reports: Risk Mix (JSON) -----
router.get(
  "/reports/risk-mix",
  authRequired,
  requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER),
  async (req, res) => {
    try {
      const report = await buildRiskMixReportForUser(req.user!);

      await logAudit(req, { action: "REPORT_RISK_MIX_JSON", targetType: "REPORT", targetId: null, extra: {
        totalWithRisk: report.totalWithRisk,
      } });

      res.json(report);
    } catch (err) {
      console.error("Error in /api/reports/risk-mix:", err);
      res.status(500).json({ error: "Failed to build risk-mix report" });
    }
  }
);

// ----- Reports: Risk Mix (CSV) -----
router.get(
  "/reports/risk-mix.csv",
  authRequired,
  requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER),
  async (req, res) => {
    try {
      const report = await buildRiskMixReportForUser(req.user!);

      await logAudit(req, { action: "REPORT_RISK_MIX_CSV", targetType: "REPORT", targetId: null, extra: {
        totalWithRisk: report.totalWithRisk,
      } });

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="ifcdc_risk_mix_report.csv"'
      );

      const rows: string[] = [];
      rows.push("category,level,count,total_with_risk");

      const s = report.suicideRisk || {};
      const v = report.violenceRisk || {};

      rows.push(["suicideRisk", "LOW", s.LOW || 0, report.totalWithRisk || 0].join(","));
      rows.push(["suicideRisk", "MODERATE", s.MODERATE || 0, report.totalWithRisk || 0].join(","));
      rows.push(["suicideRisk", "HIGH", s.HIGH || 0, report.totalWithRisk || 0].join(","));
      rows.push(["suicideRisk", "UNKNOWN", s.UNKNOWN || 0, report.totalWithRisk || 0].join(","));

      rows.push(["violenceRisk", "LOW", v.LOW || 0, report.totalWithRisk || 0].join(","));
      rows.push(["violenceRisk", "MODERATE", v.MODERATE || 0, report.totalWithRisk || 0].join(","));
      rows.push(["violenceRisk", "HIGH", v.HIGH || 0, report.totalWithRisk || 0].join(","));
      rows.push(["violenceRisk", "UNKNOWN", v.UNKNOWN || 0, report.totalWithRisk || 0].join(","));

      res.send(rows.join("\n"));
    } catch (err) {
      console.error("Error in /api/reports/risk-mix.csv:", err);
      res.status(500)
        .setHeader("Content-Type", "text/plain; charset=utf-8")
        .send("Failed to build risk-mix CSV");
    }
  }
);

  return router;
}

export function registerReportsRoutes(app: import("express").Express): void {
  app.use("/api", createReportsRouter());
}
