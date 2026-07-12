import { Router } from "express";
import { hqAuthRequired, requireHQModule } from "../middleware/hqAuth";
import {
  ensurePolicyGovernanceTables,
  buildPolicyDashboard,
  listPolicyCategories,
  searchPolicies,
  getPolicy,
  createPolicy,
  updatePolicy,
  submitPolicyForApproval,
  approvePolicy,
  publishPolicy,
  acknowledgePolicy,
  listAcknowledgments,
  listReviewReminders,
  listPolicyActivity,
  buildPolicyComplianceReport,
} from "../hq/policyGovernanceEngine";

const router = Router();

router.use(hqAuthRequired);
router.use(async (_req, _res, next) => {
  try {
    await ensurePolicyGovernanceTables();
    next();
  } catch (e) {
    next(e);
  }
});

function actor(req: { hqUser?: { email?: string } }) {
  return { email: req.hqUser?.email };
}

router.get("/dashboard", requireHQModule("policies"), async (_req, res) => {
  try {
    res.json(await buildPolicyDashboard());
  } catch (error) {
    console.error("GET /policies/dashboard error:", error);
    res.status(500).json({ error: "Failed to build policy dashboard" });
  }
});

router.get("/categories", requireHQModule("policies"), async (_req, res) => {
  res.json({ categories: await listPolicyCategories() });
});

router.get("/search", requireHQModule("policies"), async (req, res) => {
  const policies = await searchPolicies({
    q: req.query.q as string | undefined,
    category: req.query.category as string | undefined,
    department: req.query.department as string | undefined,
    approval_status: req.query.approval_status as string | undefined,
    status: req.query.status as string | undefined,
  });
  res.json({ policies, count: policies.length });
});

router.get("/reviews", requireHQModule("policies"), async (_req, res) => {
  res.json({ reviews: await listReviewReminders() });
});

router.get("/acknowledgments", requireHQModule("policies"), async (req, res) => {
  res.json({
    acknowledgments: await listAcknowledgments(req.query.policy_id as string | undefined),
  });
});

router.get("/activity", requireHQModule("policies"), async (req, res) => {
  const limit = Number(req.query.limit ?? 100);
  res.json({ activity: await listPolicyActivity(Number.isFinite(limit) ? limit : 100) });
});

router.get("/report", requireHQModule("policies"), async (_req, res) => {
  try {
    res.json(await buildPolicyComplianceReport());
  } catch (error) {
    console.error("GET /policies/report error:", error);
    res.status(500).json({ error: "Failed to build policy compliance report" });
  }
});

router.get("/:id", requireHQModule("policies"), async (req, res) => {
  const detail = await getPolicy(req.params.id);
  if (!detail) return res.status(404).json({ error: "Policy not found" });
  res.json(detail);
});

router.post("/", requireHQModule("policies"), async (req, res) => {
  if (!req.body?.title) return res.status(400).json({ error: "title is required" });
  const detail = await createPolicy(req.body, actor(req));
  res.status(201).json(detail);
});

router.patch("/:id", requireHQModule("policies"), async (req, res) => {
  const detail = await updatePolicy(req.params.id, req.body, actor(req));
  if (!detail) return res.status(404).json({ error: "Policy not found" });
  res.json(detail);
});

router.post("/:id/submit", requireHQModule("policies"), async (req, res) => {
  const detail = await submitPolicyForApproval(req.params.id, actor(req));
  if (!detail) return res.status(404).json({ error: "Policy not found" });
  res.json(detail);
});

router.post("/:id/approve", requireHQModule("policies"), async (req, res) => {
  const { approved_by, signature_text, signer_email, signer_role } = req.body ?? {};
  if (!approved_by || !signature_text) {
    return res.status(400).json({ error: "approved_by and signature_text are required" });
  }
  const detail = await approvePolicy(
    req.params.id,
    { approved_by, signature_text, signer_email, signer_role },
    actor(req)
  );
  if (!detail) return res.status(404).json({ error: "Policy not found" });
  res.json(detail);
});

router.post("/:id/publish", requireHQModule("policies"), async (req, res) => {
  const detail = await publishPolicy(req.params.id, actor(req));
  if (!detail) return res.status(404).json({ error: "Policy not found" });
  res.json(detail);
});

router.post("/:id/acknowledge", requireHQModule("policies"), async (req, res) => {
  const { person_name, signature_text, person_id, person_email, person_role } = req.body ?? {};
  if (!person_name || !signature_text) {
    return res.status(400).json({ error: "person_name and signature_text are required" });
  }
  const ack = await acknowledgePolicy(req.params.id, {
    person_name,
    signature_text,
    person_id,
    person_email,
    person_role,
  });
  if (!ack) return res.status(404).json({ error: "Policy not found" });
  res.status(201).json({ acknowledgment: ack });
});

export default router;
