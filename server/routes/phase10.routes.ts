import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { hqAuthRequired, requireHQModule } from "../middleware/hqAuth";
import {
  buildPhase10ExecutivePackage,
  buildMissionControlHome,
  buildEnterpriseAIPackage,
  buildCrossDivisionOperations,
  buildDecisionIntelligence,
  buildCommandConsole,
  buildUniversalSearchIndex,
  askExecutiveQA,
  resolveRoleHomePath,
} from "../hq/phase10ExecutivePlatform";
import { runScenarioAnalysis, type ScenarioInput } from "../hq/scenarioModeling";
import { buildExecutiveTaskHub } from "../hq/executiveTaskHub";
import { createPackageCache } from "../hq/packageCache";
import { queryHqAudit } from "../hq/hqAuditLog";
import {
  buildMissionControlCommandCenter,
  listMissions,
  createMission,
  updateMission,
  deleteMission,
  listMissionTimeline,
  addMissionTimelineEvent,
  listObjectives,
  createObjective,
  updateObjective,
  deleteObjective,
  listMissionTasks,
  createMissionTask,
  updateMissionTask,
  approveMissionTask,
  rejectMissionTask,
  getTaskHistory,
  listFounderDecisions,
  createFounderDecision,
  decideFounderDecision,
  listExecutiveNotes,
  createExecutiveNote,
} from "../hq/missionControlEngine";

const router = Router();
router.use(hqAuthRequired);

const phase10PackageCache = createPackageCache<Record<string, unknown>>(60_000);

function actor(req: Request) {
  return { id: req.hqUser!.id, email: req.hqUser!.email };
}

function requireFounder(req: Request, res: Response, next: NextFunction) {
  const role = String(req.hqUser?.role ?? "").toLowerCase();
  if (role === "owner" || role === "founder") return next();
  return res.status(403).json({ error: "Founder access required for this action" });
}

/** Mission Control writes — founder, executive, administrator only (not grant_manager / board_member). */
function requireMissionControlWrite(req: Request, res: Response, next: NextFunction) {
  const role = String(req.hqUser?.role ?? "").toLowerCase();
  if (["owner", "founder", "executive", "administrator", "admin"].includes(role)) return next();
  return res.status(403).json({ error: "Mission Control write access required" });
}

router.get("/package", requireHQModule("executive"), async (req, res) => {
  const role = req.hqUser!.role;
  res.json(await phase10PackageCache.get(role, () => buildPhase10ExecutivePackage(role)));
});

router.get("/mission-control", requireHQModule("executive"), async (req, res) => {
  res.json(await buildMissionControlCommandCenter(req.hqUser!.role));
});

router.get("/mission-control/legacy", requireHQModule("executive"), async (req, res) => {
  res.json(await buildMissionControlHome(req.hqUser!.role));
});

// ─── Missions ───────────────────────────────────────────────────────────────
router.get("/missions", requireHQModule("executive"), async (req, res) => {
  const status = req.query.status as string | undefined;
  res.json({ missions: await listMissions(status ? { status: status as "planning" | "active" | "at_risk" | "complete" } : undefined) });
});

router.post("/missions", requireHQModule("executive"), requireMissionControlWrite, async (req, res) => {
  const { title } = req.body ?? {};
  if (!String(title ?? "").trim()) return res.status(400).json({ error: "title is required" });
  const mission = await createMission(req.body, actor(req));
  res.status(201).json({ mission });
});

router.patch("/missions/:id", requireHQModule("executive"), requireMissionControlWrite, async (req, res) => {
  const mission = await updateMission(req.params.id, req.body, actor(req));
  if (!mission) return res.status(404).json({ error: "Mission not found" });
  res.json({ mission });
});

router.delete("/missions/:id", requireHQModule("executive"), requireMissionControlWrite, async (req, res) => {
  const result = await deleteMission(req.params.id, actor(req));
  if (!result.ok) return res.status(404).json({ error: "Mission not found" });
  res.json({ ok: true });
});

router.get("/missions/:id/timeline", requireHQModule("executive"), async (req, res) => {
  res.json({ events: await listMissionTimeline(req.params.id) });
});

router.post("/missions/:id/timeline", requireHQModule("executive"), requireMissionControlWrite, async (req, res) => {
  const { title } = req.body ?? {};
  if (!String(title ?? "").trim()) return res.status(400).json({ error: "title is required" });
  const event = await addMissionTimelineEvent(req.params.id, req.body, actor(req));
  res.status(201).json({ event });
});

// ─── Strategic objectives ─────────────────────────────────────────────────────
router.get("/objectives", requireHQModule("executive"), async (req, res) => {
  res.json({
    objectives: await listObjectives({
      objectiveType: req.query.objectiveType as "annual" | "quarterly" | "department_milestone" | undefined,
      status: req.query.status as string | undefined,
    }),
  });
});

router.post("/objectives", requireHQModule("executive"), requireMissionControlWrite, async (req, res) => {
  const { title } = req.body ?? {};
  if (!String(title ?? "").trim()) return res.status(400).json({ error: "title is required" });
  const objective = await createObjective(req.body, actor(req));
  res.status(201).json({ objective });
});

router.patch("/objectives/:id", requireHQModule("executive"), requireMissionControlWrite, async (req, res) => {
  const objective = await updateObjective(req.params.id, req.body, actor(req));
  if (!objective) return res.status(404).json({ error: "Objective not found" });
  res.json({ objective });
});

router.delete("/objectives/:id", requireHQModule("executive"), requireMissionControlWrite, async (req, res) => {
  const result = await deleteObjective(req.params.id, actor(req));
  if (!result.ok) return res.status(404).json({ error: "Objective not found" });
  res.json({ ok: true });
});

// ─── Mission tasks ────────────────────────────────────────────────────────────
router.get("/mission-tasks", requireHQModule("executive"), async (req, res) => {
  res.json({
    tasks: await listMissionTasks({
      status: req.query.status as "pending" | "in_progress" | "approved" | "rejected" | "completed" | undefined,
      missionId: req.query.missionId as string | undefined,
    }),
  });
});

router.post("/mission-tasks", requireHQModule("executive"), requireMissionControlWrite, async (req, res) => {
  const { title } = req.body ?? {};
  if (!String(title ?? "").trim()) return res.status(400).json({ error: "title is required" });
  const task = await createMissionTask(req.body, actor(req));
  res.status(201).json({ task });
});

router.patch("/mission-tasks/:id", requireHQModule("executive"), requireMissionControlWrite, async (req, res) => {
  const task = await updateMissionTask(req.params.id, req.body, actor(req));
  if (!task) return res.status(404).json({ error: "Task not found" });
  res.json({ task });
});

router.post("/mission-tasks/:id/approve", requireHQModule("executive"), requireMissionControlWrite, async (req, res) => {
  const task = await approveMissionTask(req.params.id, actor(req));
  if (!task) return res.status(404).json({ error: "Task not found" });
  res.json({ task });
});

router.post("/mission-tasks/:id/reject", requireHQModule("executive"), requireMissionControlWrite, async (req, res) => {
  const task = await rejectMissionTask(req.params.id, String(req.body?.reason ?? ""), actor(req));
  if (!task) return res.status(404).json({ error: "Task not found" });
  res.json({ task });
});

router.get("/mission-tasks/:id/history", requireHQModule("executive"), async (req, res) => {
  res.json({ history: await getTaskHistory(req.params.id) });
});

// ─── Founder panel ────────────────────────────────────────────────────────────
router.get("/founder-decisions", requireHQModule("executive"), async (req, res) => {
  res.json({ decisions: await listFounderDecisions(req.query.status as string | undefined) });
});

router.post("/founder-decisions", requireHQModule("executive"), requireFounder, async (req, res) => {
  const { title } = req.body ?? {};
  if (!String(title ?? "").trim()) return res.status(400).json({ error: "title is required" });
  const decision = await createFounderDecision(req.body, actor(req));
  res.status(201).json({ decision });
});

router.post("/founder-decisions/:id/decide", requireHQModule("executive"), requireFounder, async (req, res) => {
  const decision = String(req.body?.decision ?? "");
  if (decision !== "approved" && decision !== "rejected") {
    return res.status(400).json({ error: "decision must be approved or rejected" });
  }
  const row = await decideFounderDecision(req.params.id, decision, req.body?.note, actor(req));
  if (!row) return res.status(404).json({ error: "Decision not found" });
  res.json({ decision: row });
});

router.get("/executive-notes", requireHQModule("executive"), async (_req, res) => {
  res.json({ notes: await listExecutiveNotes() });
});

router.post("/executive-notes", requireHQModule("executive"), requireFounder, async (req, res) => {
  const { title, body } = req.body ?? {};
  if (!String(title ?? "").trim() || !String(body ?? "").trim()) {
    return res.status(400).json({ error: "title and body are required" });
  }
  const note = await createExecutiveNote(req.body, actor(req));
  res.status(201).json({ note });
});

router.get("/audit", requireHQModule("executive"), async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 100)));
  const entityType = (req.query.entityType as string | undefined) ?? undefined;
  const entries = await queryHqAudit({
    limit,
    entityType,
    action: req.query.action as string | undefined,
    actorEmail: req.query.actorEmail as string | undefined,
  });
  const missionTypes = new Set([
    "hq_mission",
    "hq_strategic_objective",
    "hq_mission_task",
    "hq_founder_decision",
    "hq_executive_note",
  ]);
  const filtered = entries.filter((e: { entity_type?: string }) =>
    missionTypes.has(String(e.entity_type ?? ""))
  );
  res.json({ entries: filtered });
});

router.get("/role-home", async (req, res) => {
  res.json({
    path: resolveRoleHomePath(req.hqUser!.role),
    role: req.hqUser!.role,
  });
});

router.get("/enterprise-ai", requireHQModule("aura"), async (_req, res) => {
  res.json(await buildEnterpriseAIPackage());
});

router.post("/enterprise-ai/ask", requireHQModule("aura"), async (req: Request, res: Response) => {
  const question = String(req.body?.question ?? "").trim();
  if (!question) return res.status(400).json({ error: "question required" });
  res.json(await askExecutiveQA(question));
});

router.get("/operations", requireHQModule("executive"), async (_req, res) => {
  res.json(await buildCrossDivisionOperations());
});

router.get("/tasks", async (_req, res) => {
  res.json(await buildExecutiveTaskHub(30));
});

router.get("/decision-intelligence", requireHQModule("analytics"), async (_req, res) => {
  res.json(await buildDecisionIntelligence());
});

router.post("/scenarios", requireHQModule("analytics"), async (req: Request, res: Response) => {
  const input = (req.body ?? {}) as ScenarioInput;
  res.json(await runScenarioAnalysis(input));
});

router.get("/command-console", async (_req, res) => {
  res.json(await buildCommandConsole());
});

router.get("/search", async (req, res) => {
  const q = String(req.query.q ?? "");
  if (!q.trim()) return res.json({ query: q, results: [], count: 0 });
  res.json(await buildUniversalSearchIndex(q));
});

export default router;
