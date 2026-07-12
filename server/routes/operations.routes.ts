import { Router } from "express";
import { getDb } from "../db";
import { hqAuthRequired, requireHQModule } from "../middleware/hqAuth";
import { ensureOperationsTables, buildOperationsOverview, opsId, EMPTY_OPERATIONS_OVERVIEW } from "../hq/operationsSchema";
import {
  buildOperationsCommandCenter,
  listOpsTasks,
  createOpsTask,
  updateOpsTask,
} from "../hq/operationsCommandEngine";
import {
  ensureExecutiveOperationsFoundation,
  buildExecutiveOperationsDashboard,
  buildDepartmentMatrix,
  buildExecutiveOperationsReport,
  buildAutomationStatus,
  listOpsProjects,
  createOpsProject,
  updateOpsProject,
  createOpsMilestone,
  listComplianceFilings,
  createComplianceFiling,
  updateComplianceFiling,
  EXECUTIVE_DEPARTMENTS,
} from "../hq/executiveOperationsFoundation";

const router = Router();

router.use(hqAuthRequired);
router.use(async (_req, _res, next) => {
  try {
    await ensureOperationsTables();
    next();
  } catch (e) {
    next(e);
  }
});

router.get("/overview", async (_req, res) => {
  try {
    res.json(await buildOperationsOverview());
  } catch (error) {
    console.error("GET /operations/overview error:", error);
    res.json({ ...EMPTY_OPERATIONS_OVERVIEW });
  }
});

/** Build 60 — Executive Operations Center foundation */
router.get("/foundation/dashboard", requireHQModule("operations"), async (_req, res) => {
  try {
    res.json(await buildExecutiveOperationsDashboard());
  } catch (error) {
    console.error("GET /operations/foundation/dashboard error:", error);
    res.status(500).json({ error: "Failed to build executive operations dashboard" });
  }
});

router.get("/foundation/departments", requireHQModule("operations"), async (_req, res) => {
  try {
    res.json(await buildDepartmentMatrix());
  } catch (error) {
    console.error("GET /operations/foundation/departments error:", error);
    res.status(500).json({ error: "Failed to build department matrix" });
  }
});

router.get("/foundation/catalog", requireHQModule("operations"), async (_req, res) => {
  res.json({ departments: EXECUTIVE_DEPARTMENTS });
});

router.get("/foundation/report", requireHQModule("operations"), async (_req, res) => {
  try {
    res.json(await buildExecutiveOperationsReport());
  } catch (error) {
    console.error("GET /operations/foundation/report error:", error);
    res.status(500).json({ error: "Failed to build executive operations report" });
  }
});

router.get("/foundation/automation", requireHQModule("operations"), async (_req, res) => {
  try {
    res.json(await buildAutomationStatus());
  } catch (error) {
    console.error("GET /operations/foundation/automation error:", error);
    res.status(500).json({ error: "Failed to load automation status" });
  }
});

router.get("/foundation/compliance", requireHQModule("operations"), async (req, res) => {
  res.json({ filings: await listComplianceFilings(req.query.status as string | undefined) });
});

router.post("/foundation/compliance", requireHQModule("operations"), async (req, res) => {
  if (!req.body?.title) return res.status(400).json({ error: "title is required" });
  const filing = await createComplianceFiling(req.body);
  res.status(201).json({ filing });
});

router.patch("/foundation/compliance/:id", requireHQModule("operations"), async (req, res) => {
  const filing = await updateComplianceFiling(req.params.id, req.body);
  if (!filing) return res.status(404).json({ error: "Filing not found" });
  res.json({ filing });
});

router.get("/projects", requireHQModule("operations"), async (req, res) => {
  res.json({ projects: await listOpsProjects(req.query.status as string | undefined) });
});

router.post("/projects", requireHQModule("operations"), async (req, res) => {
  if (!req.body?.title) return res.status(400).json({ error: "title is required" });
  const project = await createOpsProject(req.body, {
    email: (req as { hqUser?: { email?: string } }).hqUser?.email,
  });
  res.status(201).json({ project });
});

router.patch("/projects/:id", requireHQModule("operations"), async (req, res) => {
  const project = await updateOpsProject(req.params.id, req.body);
  if (!project) return res.status(404).json({ error: "Project not found" });
  res.json({ project });
});

router.post("/projects/:id/milestones", requireHQModule("operations"), async (req, res) => {
  if (!req.body?.title) return res.status(400).json({ error: "title is required" });
  const milestone = await createOpsMilestone(req.params.id, req.body);
  res.status(201).json({ milestone });
});

router.get("/command-center/v3/platform", requireHQModule("operations"), async (_req, res) => {
  res.json(await buildOperationsCommandCenter());
});

router.get("/tasks", requireHQModule("operations"), async (req, res) => {
  res.json({ tasks: await listOpsTasks(req.query.status as string | undefined) });
});

router.post("/tasks", requireHQModule("operations"), async (req, res) => {
  const { title } = req.body;
  if (!title) return res.status(400).json({ error: "title is required" });
  await ensureExecutiveOperationsFoundation();
  const task = await createOpsTask(req.body, { email: (req as { hqUser?: { email?: string } }).hqUser?.email });
  res.status(201).json({ task });
});

router.patch("/tasks/:id", requireHQModule("operations"), async (req, res) => {
  await ensureExecutiveOperationsFoundation();
  const task = await updateOpsTask(req.params.id, req.body);
  if (!task) return res.status(404).json({ error: "Task not found" });
  res.json({ task });
});

function crudRoutes(
  table: string,
  fields: string[],
  module: string,
  requiredFields: string[] = ["title"]
) {
  const r = Router();
  r.use(requireHQModule(module));

  r.get("/", async (_req, res) => {
    const db = await getDb();
    const rows = await db.all(`SELECT * FROM ${table} ORDER BY created_at DESC`);
    res.json({ items: rows });
  });

  r.post("/", async (req, res) => {
    const db = await getDb();
    const now = new Date().toISOString();
    const id = opsId();
    const body = req.body as Record<string, unknown>;
    const primary = requiredFields[0];
    if (primary && !body[primary] && !body.name && !body.title && !body.address) {
      return res.status(400).json({ error: "Required fields missing" });
    }
    const cols = ["id", ...fields.filter((f) => f !== "id"), "created_at"];
    const vals = [id, ...fields.filter((f) => f !== "id").map((f) => body[f] ?? null), now];
    if (table === "hq_documents") {
      cols.push("updated_at");
      vals.push(now);
    }
    await db.run(
      `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
      ...vals
    );
    const row = await db.get(`SELECT * FROM ${table} WHERE id = ?`, id);
    res.status(201).json(row);
  });

  r.patch("/:id", async (req, res) => {
    const db = await getDb();
    const body = req.body as Record<string, unknown>;
    const sets = Object.keys(body).filter((k) => fields.includes(k) || k === "status" || k === "notes");
    if (!sets.length) return res.status(400).json({ error: "No valid fields" });
    const params = sets.map((k) => `${k} = ?`);
    if (table === "hq_documents") params.push("updated_at = ?");
    await db.run(
      `UPDATE ${table} SET ${params.join(", ")} WHERE id = ?`,
      ...sets.map((k) => body[k]),
      ...(table === "hq_documents" ? [new Date().toISOString()] : []),
      req.params.id
    );
    res.json(await db.get(`SELECT * FROM ${table} WHERE id = ?`, req.params.id));
  });

  return r;
}

router.use("/housing/units", crudRoutes("housing_units", ["address", "unit_type", "status", "capacity", "monthly_rent", "program_id", "notes"], "programs", ["address"]));
router.use("/housing/applications", crudRoutes("housing_applications", ["person_id", "unit_id", "status", "applied_at", "case_manager_id", "notes"], "programs"));
router.use("/housing/placements", crudRoutes("housing_placements", ["application_id", "unit_id", "person_id", "move_in_date", "move_out_date", "status"], "programs"));

router.use("/scholarships/programs", crudRoutes("scholarship_programs", ["name", "amount", "deadline", "status", "requirements"], "programs", ["name"]));
router.use("/scholarships/applications", crudRoutes("scholarship_applications", ["program_id", "person_id", "status", "amount_requested", "amount_awarded", "submitted_at", "notes"], "programs"));

router.use("/media/content", crudRoutes("media_content", ["title", "content_type", "channel", "status", "scheduled_at", "published_at", "author_person_id", "description"], "programs", ["title"]));
router.use("/media/broadcasts", crudRoutes("media_broadcasts", ["title", "platform", "scheduled_at", "duration_min", "status"], "programs", ["title"]));

router.use("/documents", crudRoutes("hq_documents", ["title", "category", "file_url", "version", "person_id", "grant_id", "department_id", "access_level"], "settings", ["title"]));

router.use("/assets", crudRoutes("assets", ["name", "category", "asset_tag", "location", "assigned_person_id", "facility_id", "value_cents", "status", "purchase_date"], "operations", ["name"]));

router.use("/fleet/vehicles", crudRoutes("fleet_vehicles", ["name", "make", "model", "year", "license_plate", "vin", "status", "assigned_person_id", "mileage", "last_service_date"], "operations", ["name"]));
router.use("/fleet/maintenance", crudRoutes("fleet_maintenance", ["vehicle_id", "service_type", "service_date", "cost_cents", "notes"], "operations"));

router.use("/facilities", crudRoutes("facilities", ["name", "address", "facility_type", "sqft", "status", "manager_person_id"], "operations", ["name"]));
router.use("/facilities/work-orders", crudRoutes("facility_work_orders", ["facility_id", "title", "priority", "status", "assigned_person_id", "due_date", "completed_at"], "operations", ["title"]));

router.use("/board/meetings", crudRoutes("board_meetings", ["title", "meeting_date", "location", "status", "agenda", "minutes"], "board", ["title"]));
router.use("/board/actions", crudRoutes("board_action_items", ["meeting_id", "title", "assigned_person_id", "due_date", "status"], "board", ["title"]));

router.use("/compliance/policies", crudRoutes("compliance_policies", ["title", "category", "effective_date", "review_date", "status", "owner_person_id", "description"], "compliance", ["title"]));
router.use("/compliance/risks", crudRoutes("compliance_risks", ["title", "risk_level", "category", "status", "mitigated_at", "owner_person_id", "description"], "compliance", ["title"]));

router.use("/calendar/events", crudRoutes("org_events", ["title", "event_type", "start_at", "end_at", "location", "department_id", "program_id", "person_id", "all_day", "status", "description"], "programs", ["title"]));

export default router;
