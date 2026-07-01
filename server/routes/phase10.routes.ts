import { Router } from "express";
import type { Request, Response } from "express";
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

const router = Router();
router.use(hqAuthRequired);

const phase10PackageCache = createPackageCache<Record<string, unknown>>(60_000);

router.get("/package", requireHQModule("executive"), async (req, res) => {
  const role = req.hqUser!.role;
  res.json(await phase10PackageCache.get(role, () => buildPhase10ExecutivePackage(role)));
});

router.get("/mission-control", requireHQModule("executive"), async (req, res) => {
  res.json(await buildMissionControlHome(req.hqUser!.role));
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
