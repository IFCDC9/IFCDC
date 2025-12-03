import { Response } from "express";
import prisma from "../db/client";
import { AuthRequest } from "../middleware/auth";

export const overview = async (_req: AuthRequest, res: Response) => {
  try {
    const incidentForm = await prisma.form.findUnique({
      where: { slug: "incident_report" },
      select: { id: true },
    });

    const whereIncident = incidentForm ? { formId: incidentForm.id } : { formId: -1 };

    const totalIncidents = await prisma.formSubmission.count({ where: whereIncident });

    const highRiskIncidents = await prisma.formSubmission.count({
      where: { ...whereIncident, riskLevel: "high" },
    });

    const openIncidents = await prisma.formSubmission.count({
      where: { ...whereIncident, status: "open" },
    });

    const inReview = await prisma.formSubmission.count({
      where: { ...whereIncident, status: "in_review" },
    });

    const resolved = await prisma.formSubmission.count({
      where: { ...whereIncident, status: "resolved" },
    });

    const intakeForm = await prisma.form.findUnique({
      where: { slug: "participant_intake" },
      select: { id: true },
    });

    const totalIntakes = intakeForm
      ? await prisma.formSubmission.count({ where: { formId: intakeForm.id } })
      : 0;

    const caseNoteForm = await prisma.form.findUnique({
      where: { slug: "case_note" },
      select: { id: true },
    });

    const totalCaseNotes = caseNoteForm
      ? await prisma.formSubmission.count({ where: { formId: caseNoteForm.id } })
      : 0;

    res.json({
      incidents: {
        total: totalIncidents,
        highRisk: highRiskIncidents,
        open: openIncidents,
        inReview,
        resolved,
      },
      intakes: {
        total: totalIntakes,
      },
      caseNotes: {
        total: totalCaseNotes,
      },
    });
  } catch (err) {
    console.error("Error building overview report:", err);
    res.status(500).json({ message: "Error building overview report" });
  }
};

export const incidentsByProgram = async (_req: AuthRequest, res: Response) => {
  try {
    const incidentForm = await prisma.form.findUnique({
      where: { slug: "incident_report" },
      select: { id: true },
    });

    if (!incidentForm) return res.json({ series: [] });

    const incidents = await prisma.formSubmission.findMany({
      where: { formId: incidentForm.id },
      select: { data: true },
    });

    const counts: Record<string, number> = {};

    incidents.forEach((sub) => {
      const data = sub.data as Record<string, any>;
      const program = data.program || "unknown";
      counts[program] = (counts[program] || 0) + 1;
    });

    const series = Object.entries(counts).map(([program, count]) => ({
      program,
      count,
    }));

    res.json({ series });
  } catch (err) {
    console.error("Error building incidents by program:", err);
    res.status(500).json({ message: "Error building program report" });
  }
};

export const incidentsTimeSeries = async (req: AuthRequest, res: Response) => {
  try {
    const days = parseInt((req.query.days as string) || "30", 10);
    const since = new Date();
    since.setDate(since.getDate() - days);

    const incidentForm = await prisma.form.findUnique({
      where: { slug: "incident_report" },
      select: { id: true },
    });

    if (!incidentForm) return res.json({ points: [] });

    const incidents = await prisma.formSubmission.findMany({
      where: {
        formId: incidentForm.id,
        createdAt: { gte: since },
      },
      select: {
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });

    const byDay: Record<string, number> = {};
    incidents.forEach((sub) => {
      const d = sub.createdAt.toISOString().slice(0, 10);
      byDay[d] = (byDay[d] || 0) + 1;
    });

    const points = Object.entries(byDay).map(([date, count]) => ({ date, count }));

    res.json({ since: since.toISOString(), points });
  } catch (err) {
    console.error("Error building time-series report:", err);
    res.status(500).json({ message: "Error building time-series report" });
  }
};

export const exportIncidentsCsv = async (_req: AuthRequest, res: Response) => {
  try {
    const incidentForm = await prisma.form.findUnique({
      where: { slug: "incident_report" },
      select: { id: true },
    });

    if (!incidentForm) {
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=incidents.csv");
      return res.send("No incident form found");
    }

    const incidents = await prisma.formSubmission.findMany({
      where: { formId: incidentForm.id },
      include: {
        submittedBy: { select: { id: true, name: true, email: true } },
        assignedTo: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const headers = [
      "id",
      "createdAt",
      "status",
      "riskLevel",
      "flagged",
      "submittedBy",
      "assignedTo",
      "program",
      "incidentDate",
      "incidentTime",
      "location",
      "description",
    ];

    const escapeCSV = (val: any): string => {
      if (val === null || val === undefined) return "";
      const str = String(val);
      if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const rows = incidents.map((inc) => {
      const data = inc.data as Record<string, any>;
      return [
        inc.id,
        inc.createdAt.toISOString(),
        inc.status,
        inc.riskLevel,
        inc.flagged ? "Yes" : "No",
        inc.submittedBy?.name || "",
        inc.assignedTo?.name || "",
        data.program || "",
        data.incidentDate || "",
        data.incidentTime || "",
        data.location || "",
        data.description || "",
      ].map(escapeCSV).join(",");
    });

    const csv = [headers.join(","), ...rows].join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=incidents.csv");
    res.send(csv);
  } catch (err) {
    console.error("Error exporting incidents CSV:", err);
    res.status(500).json({ message: "Error exporting incidents" });
  }
};
