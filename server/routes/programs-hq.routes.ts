import { Router } from "express";
import type { Request, Response } from "express";
import { getDb } from "../db";
import { hqAuthRequired, requireHQModule } from "../middleware/hqAuth";
import {
  ensureProgramModuleTables,
  programId,
  PROGRAM_SLUGS,
  PROGRAM_DEFINITIONS,
  getProgramSummary,
  type ProgramSlug,
} from "../hq/programsSchema";
import {
  ensureProgramFinanceBudget,
  syncProgramSpentFromLedger,
  getProgramFinancialSummary,
} from "../hq/programFinanceIntegration";
import { notifyProgramBudgetThreshold } from "../hq/criticalAlerts";

const router = Router();

router.use(hqAuthRequired, requireHQModule("programs"));
router.use(async (_req, _res, next) => {
  try {
    await ensureProgramModuleTables();
    next();
  } catch (e) {
    next(e);
  }
});

function assertSlug(slug: string): slug is ProgramSlug {
  return (PROGRAM_SLUGS as readonly string[]).includes(slug);
}

router.get("/modules", async (_req, res) => {
  const db = await getDb();
  const programs = await db.all("SELECT * FROM hq_program_registry ORDER BY name");
  const summaries = await Promise.all(
    (programs as { slug: string }[]).map(async (p) => {
      const s = await getProgramSummary(p.slug);
      return { slug: p.slug, name: (s?.program as { name: string })?.name, counts: s?.counts, budget: s?.program };
    })
  );
  res.json({ programs: summaries, definitions: PROGRAM_DEFINITIONS });
});

router.get("/modules/:slug", async (req, res) => {
  if (!assertSlug(req.params.slug)) return res.status(404).json({ error: "Program not found" });
  const summary = await getProgramSummary(req.params.slug);
  if (!summary) return res.status(404).json({ error: "Program not found" });
  res.json(summary);
});

router.patch("/modules/:slug/budget", async (req: Request, res: Response) => {
  if (!assertSlug(req.params.slug)) return res.status(404).json({ error: "Program not found" });
  const { budget_allocated, budget_spent } = req.body;
  const db = await getDb();
  const now = new Date().toISOString();
  const sets: string[] = ["updated_at = ?"];
  const vals: unknown[] = [now];
  if (budget_allocated != null) { sets.push("budget_allocated = ?"); vals.push(Number(budget_allocated)); }
  if (budget_spent != null) { sets.push("budget_spent = ?"); vals.push(Number(budget_spent)); }
  vals.push(req.params.slug);
  await db.run(`UPDATE hq_program_registry SET ${sets.join(", ")} WHERE slug = ?`, ...vals);

  const budgetId = await ensureProgramFinanceBudget(req.params.slug, { email: req.hqUser?.email });
  await syncProgramSpentFromLedger(req.params.slug);

  const prog = await db.get<{ name: string; budget_allocated: number; budget_spent: number }>(
    "SELECT name, budget_allocated, budget_spent FROM hq_program_registry WHERE slug = ?", req.params.slug
  );
  if (prog) {
    await notifyProgramBudgetThreshold({
      programName: prog.name,
      slug: req.params.slug,
      spent: prog.budget_spent,
      allocated: prog.budget_allocated,
    }).catch(() => undefined);
  }

  res.json({
    program: await db.get("SELECT * FROM hq_program_registry WHERE slug = ?", req.params.slug),
    financeBudgetId: budgetId,
  });
});

router.get("/modules/:slug/finance", async (req, res) => {
  if (!assertSlug(req.params.slug)) return res.status(404).json({ error: "Program not found" });
  const summary = await getProgramFinancialSummary(req.params.slug);
  if (!summary) return res.status(404).json({ error: "Program not found" });
  res.json(summary);
});

router.get("/modules/:slug/participants", async (req, res) => {
  if (!assertSlug(req.params.slug)) return res.status(404).json({ error: "Program not found" });
  const db = await getDb();
  const rows = await db.all(
    `SELECT pp.*, p.first_name, p.last_name, p.email
     FROM hq_program_participants pp
     LEFT JOIN people p ON p.id = pp.person_id
     WHERE pp.program_slug = ? ORDER BY pp.enrolled_at DESC`,
    req.params.slug
  );
  res.json({ participants: rows });
});

router.post("/modules/:slug/participants", async (req: Request, res: Response) => {
  if (!assertSlug(req.params.slug)) return res.status(404).json({ error: "Program not found" });
  const { person_id, participant_name, status, outcome_status, outcome_notes } = req.body;
  if (!person_id && !participant_name) {
    return res.status(400).json({ error: "person_id or participant_name is required" });
  }
  const db = await getDb();
  const now = new Date().toISOString();
  const id = programId();
  await db.run(
    `INSERT INTO hq_program_participants (id, program_slug, person_id, participant_name, status, enrolled_at, outcome_status, outcome_notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, req.params.slug, person_id ?? null, participant_name ?? null,
    status ?? "active", now.slice(0, 10), outcome_status ?? null, outcome_notes ?? null, now, now
  );
  res.status(201).json({ participant: await db.get("SELECT * FROM hq_program_participants WHERE id = ?", id) });
});

router.patch("/modules/:slug/participants/:id", async (req: Request, res: Response) => {
  const { status, outcome_status, outcome_notes } = req.body;
  const db = await getDb();
  const now = new Date().toISOString();
  await db.run(
    `UPDATE hq_program_participants SET status = COALESCE(?, status), outcome_status = COALESCE(?, outcome_status),
     outcome_notes = COALESCE(?, outcome_notes), updated_at = ? WHERE id = ? AND program_slug = ?`,
    status ?? null, outcome_status ?? null, outcome_notes ?? null, now, req.params.id, req.params.slug
  );
  res.json({ participant: await db.get("SELECT * FROM hq_program_participants WHERE id = ?", req.params.id) });
});

router.get("/modules/:slug/staff", async (req, res) => {
  if (!assertSlug(req.params.slug)) return res.status(404).json({ error: "Program not found" });
  const db = await getDb();
  const rows = await db.all(
    `SELECT ps.*, p.first_name, p.last_name, p.email, p.organization_role
     FROM hq_program_staff ps JOIN people p ON p.id = ps.person_id
     WHERE ps.program_slug = ? ORDER BY ps.assigned_at DESC`,
    req.params.slug
  );
  res.json({ staff: rows });
});

router.post("/modules/:slug/staff", async (req: Request, res: Response) => {
  const { person_id, role } = req.body;
  if (!person_id) return res.status(400).json({ error: "person_id is required" });
  const db = await getDb();
  const now = new Date().toISOString();
  const id = programId();
  await db.run(
    `INSERT INTO hq_program_staff (id, program_slug, person_id, role, assigned_at, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    id, req.params.slug, person_id, role ?? "coordinator", now.slice(0, 10), now
  );
  res.status(201).json({ staff: await db.get("SELECT * FROM hq_program_staff WHERE id = ?", id) });
});

router.delete("/modules/:slug/staff/:id", async (req, res) => {
  const db = await getDb();
  await db.run("DELETE FROM hq_program_staff WHERE id = ? AND program_slug = ?", req.params.id, req.params.slug);
  res.json({ ok: true });
});

router.get("/modules/:slug/events", async (req, res) => {
  if (!assertSlug(req.params.slug)) return res.status(404).json({ error: "Program not found" });
  const db = await getDb();
  const rows = await db.all(
    "SELECT * FROM hq_program_events WHERE program_slug = ? ORDER BY start_at DESC LIMIT 100",
    req.params.slug
  );
  res.json({ events: rows });
});

router.post("/modules/:slug/events", async (req: Request, res: Response) => {
  const { title, event_type, start_at, end_at, location, status, notes } = req.body;
  if (!title || !start_at) return res.status(400).json({ error: "title and start_at are required" });
  const db = await getDb();
  const now = new Date().toISOString();
  const id = programId();
  await db.run(
    `INSERT INTO hq_program_events (id, program_slug, title, event_type, start_at, end_at, location, status, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, req.params.slug, title, event_type ?? "session", start_at, end_at ?? null,
    location ?? null, status ?? "scheduled", notes ?? null, now
  );
  res.status(201).json({ event: await db.get("SELECT * FROM hq_program_events WHERE id = ?", id) });
});

router.get("/modules/:slug/metrics", async (req, res) => {
  if (!assertSlug(req.params.slug)) return res.status(404).json({ error: "Program not found" });
  const db = await getDb();
  const rows = await db.all("SELECT * FROM hq_program_metrics WHERE program_slug = ? ORDER BY metric_label", req.params.slug);
  res.json({ metrics: rows });
});

router.patch("/modules/:slug/metrics/:id", async (req: Request, res: Response) => {
  const { metric_value, target_value } = req.body;
  const db = await getDb();
  const now = new Date().toISOString();
  await db.run(
    `UPDATE hq_program_metrics SET metric_value = COALESCE(?, metric_value), target_value = COALESCE(?, target_value), recorded_at = ? WHERE id = ? AND program_slug = ?`,
    metric_value ?? null, target_value ?? null, now.slice(0, 10), req.params.id, req.params.slug
  );
  res.json({ metric: await db.get("SELECT * FROM hq_program_metrics WHERE id = ?", req.params.id) });
});

router.get("/modules/:slug/documents", async (req, res) => {
  if (!assertSlug(req.params.slug)) return res.status(404).json({ error: "Program not found" });
  const db = await getDb();
  const rows = await db.all("SELECT * FROM hq_program_documents WHERE program_slug = ? ORDER BY created_at DESC", req.params.slug);
  res.json({ documents: rows });
});

router.post("/modules/:slug/documents", async (req: Request, res: Response) => {
  const { title, category, file_url } = req.body;
  if (!title) return res.status(400).json({ error: "title is required" });
  const db = await getDb();
  const now = new Date().toISOString();
  const id = programId();
  await db.run(
    `INSERT INTO hq_program_documents (id, program_slug, title, category, file_url, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    id, req.params.slug, title, category ?? "general", file_url ?? null, now
  );
  res.status(201).json({ document: await db.get("SELECT * FROM hq_program_documents WHERE id = ?", id) });
});

router.get("/modules/:slug/compliance", async (req, res) => {
  if (!assertSlug(req.params.slug)) return res.status(404).json({ error: "Program not found" });
  const db = await getDb();
  const rows = await db.all("SELECT * FROM hq_program_compliance WHERE program_slug = ? ORDER BY due_date ASC", req.params.slug);
  res.json({ compliance: rows });
});

router.post("/modules/:slug/compliance", async (req: Request, res: Response) => {
  if (!assertSlug(req.params.slug)) return res.status(404).json({ error: "Program not found" });
  const { requirement, category, due_date, notes } = req.body;
  if (!requirement) return res.status(400).json({ error: "requirement is required" });
  const db = await getDb();
  const now = new Date().toISOString();
  const id = programId();
  await db.run(
    `INSERT INTO hq_program_compliance (id, program_slug, requirement, category, due_date, status, notes, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
    id, req.params.slug, requirement, category ?? "regulatory", due_date ?? null, notes ?? null, now
  );
  res.status(201).json({ item: await db.get("SELECT * FROM hq_program_compliance WHERE id = ?", id) });
});

router.patch("/modules/:slug/compliance/:id", async (req: Request, res: Response) => {
  const { status, notes } = req.body;
  const db = await getDb();
  const now = new Date().toISOString();
  await db.run(
    `UPDATE hq_program_compliance SET status = COALESCE(?, status), notes = COALESCE(?, notes),
     completed_at = CASE WHEN ? = 'completed' THEN ? ELSE completed_at END WHERE id = ? AND program_slug = ?`,
    status ?? null, notes ?? null, status ?? null, now, req.params.id, req.params.slug
  );
  res.json({ item: await db.get("SELECT * FROM hq_program_compliance WHERE id = ?", req.params.id) });
});

router.get("/modules/:slug/performance-report", async (req, res) => {
  if (!assertSlug(req.params.slug)) return res.status(404).json({ error: "Program not found" });
  const summary = await getProgramSummary(req.params.slug);
  if (!summary) return res.status(404).json({ error: "Program not found" });
  const db = await getDb();
  const [compliance, finance] = await Promise.all([
    db.all("SELECT * FROM hq_program_compliance WHERE program_slug = ?", req.params.slug),
    getProgramFinancialSummary(req.params.slug),
  ]);
  const program = summary.program as { name: string; budget_allocated: number; budget_spent: number };
  const metrics = summary.metrics as { metric_label: string; metric_value: number; target_value: number }[];
  const onTarget = metrics.filter((m) => m.target_value && m.metric_value >= m.target_value).length;

  res.json({
    title: `${program.name} — Performance Report`,
    generatedAt: new Date().toISOString(),
    program: summary.program,
    counts: summary.counts,
    metrics,
    metricsOnTarget: onTarget,
    metricsTotal: metrics.length,
    compliance,
    finance,
    narrative: [
      `${program.name} serves ${summary.counts.participants} active participants with ${summary.counts.staff} assigned staff.`,
      `Budget utilization: ${program.budget_allocated > 0 ? Math.round((program.budget_spent / program.budget_allocated) * 100) : 0}% ($${program.budget_spent.toLocaleString()} of $${program.budget_allocated.toLocaleString()}).`,
      `${onTarget} of ${metrics.length} outcome metrics meeting target.`,
      `${(compliance as { status: string }[]).filter((c) => c.status === "pending").length} compliance item(s) pending.`,
    ].join(" "),
  });
});

export default router;
