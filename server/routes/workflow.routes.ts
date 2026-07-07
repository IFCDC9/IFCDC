import { Router } from "express";
import type { Request, Response } from "express";
import { hqAuthRequired, requireHQModule } from "../middleware/hqAuth";
import {
  buildWorkflowDashboard,
  listWorkflowDefinitions,
  listWorkflowInstances,
  listScheduledJobs,
  processApprovalTask,
  runScheduledJobs,
  runDueScheduledJobs,
  runSingleScheduledJob,
  setScheduledJobEnabled,
  createWorkflowInstance,
} from "../hq/workflowEngine";
import {
  getWorkflowInstanceDetail,
  getWorkflowSteps,
  advanceWorkflowStep,
  ensureWorkflowStepTables,
} from "../hq/workflowOrchestration";

const router = Router();
router.use(hqAuthRequired, requireHQModule("executive"));

router.get("/dashboard", async (_req, res) => {
  await ensureWorkflowStepTables().catch(() => undefined);
  res.json(await buildWorkflowDashboard());
});

router.get("/definitions", async (_req, res) => {
  res.json({ definitions: await listWorkflowDefinitions() });
});

router.get("/instances", async (req, res) => {
  const status = String(req.query.status ?? "").trim() || undefined;
  const workflowKey = String(req.query.workflow_key ?? "").trim() || undefined;
  res.json({ instances: await listWorkflowInstances({ status, workflowKey, limit: 50 }) });
});

router.get("/jobs", async (_req, res) => {
  res.json({ jobs: await listScheduledJobs() });
});

router.get("/instances/:id", async (req, res) => {
  const detail = await getWorkflowInstanceDetail(req.params.id);
  if (!detail) return res.status(404).json({ error: "Instance not found" });
  res.json(detail);
});

router.get("/instances/:id/steps", async (req, res) => {
  res.json({ steps: await getWorkflowSteps(req.params.id) });
});

router.post("/instances/:id/advance", async (req: Request, res: Response) => {
  const action = req.body?.action ?? "approve";
  if (!["approve", "reject", "complete"].includes(action)) {
    return res.status(400).json({ error: "action must be approve, reject, or complete" });
  }
  const result = await advanceWorkflowStep(req.params.id, action, { email: req.hqUser?.email });
  if (!result.success) return res.status(400).json(result);
  res.json(result);
});

router.post("/instances", async (req: Request, res: Response) => {
  const { workflowKey, title, entityType, entityId, assignedTo, priority, payload, dueAt } = req.body;
  if (!workflowKey || !title) return res.status(400).json({ error: "workflowKey and title required" });
  const instance = await createWorkflowInstance({
    workflowKey, title, entityType, entityId, assignedTo, priority, payload, dueAt,
  });
  res.status(201).json({ instance });
});

router.post("/approvals/:taskId", async (req: Request, res: Response) => {
  const action = req.body?.action;
  if (!["approve", "reject", "complete"].includes(action)) {
    return res.status(400).json({ error: "action must be approve, reject, or complete" });
  }
  const result = await processApprovalTask(
    req.params.taskId,
    action,
    { id: req.hqUser?.id, email: req.hqUser?.email }
  );
  if (!result.success) return res.status(400).json(result);
  res.json(result);
});

router.post("/run-scheduled", async (req: Request, res: Response) => {
  res.json(await runScheduledJobs(req.hqUser?.email));
});

router.post("/run-due", async (req: Request, res: Response) => {
  res.json(await runDueScheduledJobs(req.hqUser?.email));
});

router.post("/jobs/:jobKey/run", async (req: Request, res: Response) => {
  const result = await runSingleScheduledJob(req.params.jobKey, req.hqUser?.email);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.patch("/jobs/:jobKey", async (req: Request, res: Response) => {
  const enabled = req.body?.enabled;
  if (typeof enabled !== "boolean") {
    return res.status(400).json({ error: "enabled boolean required" });
  }
  const job = await setScheduledJobEnabled(req.params.jobKey, enabled, req.hqUser?.email);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json({ job });
});

export default router;
