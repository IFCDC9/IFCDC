/**
 * AURA Software Engineering HTTP API
 */
import { Router, type Request, type Response } from "express";
import { hqAuthRequired, requireHQModule } from "../middleware/hqAuth";
import {
  buildSoftwareEngineeringDashboard,
  buildSoftwarePortfolioMap,
  compareDeployAlignment,
  decideFounderApproval,
  diagnoseIssue,
  handleSoftwareEngineeringCommand,
  listApprovals,
  listDiagnoses,
  prepareFixPackage,
  requestFounderApproval,
} from "../hq/auraSoftwareEngineeringEngine";
import { getIndexStats, refreshCodeIndex, searchCodeIndex } from "../hq/auraCodeIndexEngine";
import { runSoftwareEngineeringTests } from "../hq/auraSoftwareTestRunner";
import { getLocalGitStatus, summarizeWorkingDiff } from "../hq/auraSoftwareGitEngine";
import { ensureAuraSoftwareEngineeringTables } from "../hq/auraSoftwareEngineeringSchema";

const router = Router();

function isFounder(req: Request): boolean {
  const u = req.hqUser as { role?: string; email?: string; founderMode?: boolean } | undefined;
  if (!u) return false;
  if (u.founderMode) return true;
  if (u.role === "owner" || u.role === "founder") return true;
  const email = (u.email || "").toLowerCase();
  const master = (process.env.MASTER_OWNER_EMAIL || "service@ifcdc.org").toLowerCase();
  return email === master;
}

router.get("/dashboard", hqAuthRequired, requireHQModule("software_division"), async (_req, res) => {
  await ensureAuraSoftwareEngineeringTables();
  res.json(await buildSoftwareEngineeringDashboard());
});

router.get("/portfolio", hqAuthRequired, requireHQModule("software_division"), async (_req, res) => {
  res.json(await buildSoftwarePortfolioMap());
});

router.get("/index/stats", hqAuthRequired, requireHQModule("software_division"), async (_req, res) => {
  res.json(await getIndexStats());
});

router.get("/index/search", hqAuthRequired, requireHQModule("software_division"), async (req, res) => {
  res.json({
    results: await searchCodeIndex({
      q: typeof req.query.q === "string" ? req.query.q : undefined,
      kind: typeof req.query.kind === "string" ? req.query.kind : undefined,
      repoId: typeof req.query.repoId === "string" ? req.query.repoId : undefined,
      limit: req.query.limit ? Number(req.query.limit) : 40,
    }),
  });
});

router.post("/index/refresh", hqAuthRequired, requireHQModule("software_division"), async (req: Request, res: Response) => {
  if (!isFounder(req)) return res.status(403).json({ error: "Founder required to refresh code index" });
  const result = await refreshCodeIndex({
    actorEmail: req.hqUser?.email,
    repoId: typeof req.body?.repoId === "string" ? req.body.repoId : undefined,
  });
  res.json(result);
});

router.post("/diagnose", hqAuthRequired, requireHQModule("software_division"), async (req: Request, res: Response) => {
  const symptom = String(req.body?.symptom || req.body?.command || "").trim();
  if (!symptom) return res.status(400).json({ error: "symptom is required" });
  const diagnosis = await diagnoseIssue({
    symptom,
    repoId: typeof req.body?.repoId === "string" ? req.body.repoId : undefined,
    actorEmail: req.hqUser?.email,
    founderMode: isFounder(req),
  });
  res.json(diagnosis);
});

router.get("/diagnoses", hqAuthRequired, requireHQModule("software_division"), async (req, res) => {
  res.json({
    diagnoses: await listDiagnoses({
      status: typeof req.query.status === "string" ? req.query.status : undefined,
      limit: req.query.limit ? Number(req.query.limit) : 30,
    }),
  });
});

router.post("/change-packages", hqAuthRequired, requireHQModule("software_division"), async (req: Request, res: Response) => {
  if (!isFounder(req)) return res.status(403).json({ error: "Founder Mode required to prepare change packages" });
  const title = String(req.body?.title || "").trim();
  if (!title) return res.status(400).json({ error: "title is required" });
  const pkg = await prepareFixPackage({
    title,
    diagnosisId: typeof req.body?.diagnosisId === "string" ? req.body.diagnosisId : undefined,
    repoId: typeof req.body?.repoId === "string" ? req.body.repoId : undefined,
    proposedOps: Array.isArray(req.body?.proposedOps) ? req.body.proposedOps : undefined,
    actorEmail: req.hqUser?.email,
    founderMode: true,
  });
  res.status(201).json(pkg);
});

router.post("/tests", hqAuthRequired, requireHQModule("software_division"), async (req: Request, res: Response) => {
  if (!isFounder(req)) return res.status(403).json({ error: "Founder Mode required to run tests" });
  const result = await runSoftwareEngineeringTests({
    changePackageId: typeof req.body?.changePackageId === "string" ? req.body.changePackageId : undefined,
    relativeCwd: typeof req.body?.relativeCwd === "string" ? req.body.relativeCwd : undefined,
    commands: Array.isArray(req.body?.commands) ? req.body.commands.map(String) : undefined,
    actorEmail: req.hqUser?.email,
  });
  res.json(result);
});

router.post("/approvals", hqAuthRequired, requireHQModule("software_division"), async (req: Request, res: Response) => {
  if (!isFounder(req)) return res.status(403).json({ error: "Founder Mode required" });
  const repository = String(req.body?.repository || "").trim();
  const branch = String(req.body?.branch || "").trim();
  const service = String(req.body?.service || "").trim();
  const action = String(req.body?.action || "").trim();
  const riskSummary = String(req.body?.riskSummary || "").trim();
  if (!repository || !branch || !service || !action || !riskSummary) {
    return res.status(400).json({
      error: "repository, branch, service, action, and riskSummary are required",
    });
  }
  const row = await requestFounderApproval({
    changePackageId: typeof req.body?.changePackageId === "string" ? req.body.changePackageId : undefined,
    repository,
    branch,
    commitSha: typeof req.body?.commitSha === "string" ? req.body.commitSha : undefined,
    service,
    action: action as "push" | "push_and_pr" | "merge_main" | "deploy_production" | "rollback_production" | "migrate_production",
    riskSummary,
    note: typeof req.body?.note === "string" ? req.body.note : undefined,
    actorEmail: req.hqUser?.email,
  });
  res.status(201).json(row);
});

router.get("/approvals", hqAuthRequired, requireHQModule("software_division"), async (req, res) => {
  res.json({
    approvals: await listApprovals({
      status: typeof req.query.status === "string" ? req.query.status : undefined,
    }),
  });
});

router.post("/approvals/:id/decide", hqAuthRequired, requireHQModule("software_division"), async (req: Request, res: Response) => {
  const decision = req.body?.decision;
  if (decision !== "approve" && decision !== "reject") {
    return res.status(400).json({ error: "decision must be approve or reject" });
  }
  const result = await decideFounderApproval({
    approvalId: req.params.id,
    decision,
    actorEmail: req.hqUser?.email,
    note: typeof req.body?.note === "string" ? req.body.note : undefined,
    founderMode: isFounder(req),
  });
  if (!result.ok) return res.status(403).json(result);
  res.json(result);
});

router.get("/deploy/compare", hqAuthRequired, requireHQModule("software_division"), async (_req, res) => {
  res.json(await compareDeployAlignment());
});

router.get("/git/status", hqAuthRequired, requireHQModule("software_division"), async (_req, res) => {
  res.json(await getLocalGitStatus());
});

router.get("/git/diff", hqAuthRequired, requireHQModule("software_division"), async (_req, res) => {
  res.json(await summarizeWorkingDiff());
});

router.post("/command", hqAuthRequired, requireHQModule("software_division"), async (req: Request, res: Response) => {
  const command = String(req.body?.command || "").trim();
  if (!command) return res.status(400).json({ error: "command is required" });
  const result = await handleSoftwareEngineeringCommand({
    command,
    actorEmail: req.hqUser?.email,
    founderMode: isFounder(req),
    isFounder: isFounder(req),
  });
  res.json(result);
});

export default router;
