import { Response } from "express";
import { prisma } from "../prisma";
import { AuthedRequest } from "../middleware/auth";

export const overview = async (_req: AuthedRequest, res: Response) => {
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

export const incidentsByProgram = async (_req: AuthedRequest, res: Response) => {
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

export const incidentsTimeSeries = async (req: AuthedRequest, res: Response) => {
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

function escapeCsv(value: any): string {
  if (typeof value !== "string") return String(value ?? "");
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export const exportIncidentsCsv = async (req: AuthedRequest, res: Response) => {
  try {
    const { start, end } = req.query as { start?: string; end?: string };

    const incidentForm = await prisma.form.findUnique({
      where: { slug: "incident_report" },
      select: { id: true },
    });

    if (!incidentForm) {
      return res.status(404).send("Incident form not found");
    }

    const where: any = { formId: incidentForm.id };

    if (start || end) {
      where.createdAt = {};
      if (start) where.createdAt.gte = new Date(start);
      if (end) {
        const endDate = new Date(end);
        endDate.setHours(23, 59, 59, 999);
        where.createdAt.lte = endDate;
      }
    }

    const submissions = await prisma.formSubmission.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        createdAt: true,
        riskLevel: true,
        status: true,
        flagged: true,
        data: true,
      },
    });

    const header = [
      "id",
      "createdAt",
      "riskLevel",
      "status",
      "flagged",
      "incidentDate",
      "incidentTime",
      "location",
      "program",
      "incidentType",
      "staffName",
    ];

    const rows = [header.join(",")];

    submissions.forEach((sub) => {
      const d = (sub.data || {}) as Record<string, any>;
      const row = [
        sub.id,
        sub.createdAt.toISOString(),
        sub.riskLevel,
        sub.status,
        sub.flagged ? "1" : "0",
        d.incident_date || "",
        d.incident_time || "",
        escapeCsv(d.location || ""),
        d.program || "",
        Array.isArray(d.incident_type) ? d.incident_type.join("|") : (d.incident_type || ""),
        d.staff_name || "",
      ];
      rows.push(row.join(","));
    });

    const csv = rows.join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="ifcdc_incidents_${Date.now()}.csv"`
    );
    res.send(csv);
  } catch (err) {
    console.error("Error exporting CSV:", err);
    res.status(500).send("Error exporting CSV");
  }
};
