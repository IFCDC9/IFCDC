import { Router } from "express";
import type { Request, Response } from "express";
import { hqAuthRequired, requireHQPermission } from "../middleware/hqAuth";
import {
  approveCoding,
  getIntakeBundle,
  listAuditSafe,
  listIntakeCases,
  runCodingAssist,
  safeIntakeError,
  submitClaim,
  upsertClinical,
  upsertDraftClaim,
  upsertInsurance,
  upsertIntakeCase,
} from "../hq/intakeMedicalBillingEngine";
import { INTAKE_WORKSPACE_BANNER } from "../../shared/intakeMedicalBilling";

const router = Router();

router.use(hqAuthRequired, requireHQPermission("hq.intake.medical"));

function actor(req: Request) {
  return { id: req.hqUser?.id, role: req.hqUser?.role };
}

function fail(res: Response, error: unknown) {
  const status = typeof error === "object" && error && "status" in error ? Number((error as { status: number }).status) : 500;
  return res.status(status || 500).json(safeIntakeError(error));
}

router.get("/meta", (_req, res) => {
  res.json({
    readyForBilling: false,
    notForRealPhi: true,
    banner: INTAKE_WORKSPACE_BANNER,
    eligibility: "Unknown",
    enrolledToBill: "Unknown",
    auraIsLicensedCoder: false,
    auraIsSamEntityAdministrator: false,
    claimSubmissionEnabled: false,
  });
});

router.get("/cases", async (req, res) => {
  try {
    res.json(await listIntakeCases(actor(req)));
  } catch (error) {
    fail(res, error);
  }
});

router.post("/cases", async (req, res) => {
  try {
    res.json(await upsertIntakeCase(actor(req), req.body || {}));
  } catch (error) {
    fail(res, error);
  }
});

router.get("/cases/:id", async (req, res) => {
  try {
    res.json(await getIntakeBundle(actor(req), req.params.id));
  } catch (error) {
    fail(res, error);
  }
});

router.put("/cases/:id", async (req, res) => {
  try {
    res.json(await upsertIntakeCase(actor(req), { ...req.body, id: req.params.id }));
  } catch (error) {
    fail(res, error);
  }
});

router.post("/cases/:id/insurance", async (req, res) => {
  try {
    res.json(await upsertInsurance(actor(req), req.params.id, req.body || {}));
  } catch (error) {
    fail(res, error);
  }
});

router.post("/cases/:id/clinical", async (req, res) => {
  try {
    res.json(await upsertClinical(actor(req), req.params.id, req.body || {}));
  } catch (error) {
    fail(res, error);
  }
});

router.post("/cases/:id/coding", async (req, res) => {
  try {
    res.json(await runCodingAssist(actor(req), req.params.id));
  } catch (error) {
    fail(res, error);
  }
});

router.post("/coding/:id/approve", async (req, res) => {
  try {
    res.json(await approveCoding(actor(req), req.params.id, req.body?.approved === true));
  } catch (error) {
    fail(res, error);
  }
});

router.post("/cases/:id/claims", async (req, res) => {
  try {
    res.json(await upsertDraftClaim(actor(req), req.params.id, req.body || {}));
  } catch (error) {
    fail(res, error);
  }
});

router.post("/claims/:id/submit", async (req, res) => {
  const result = await submitClaim(actor(req), req.params.id);
  res.status(409).json(result);
});

router.get("/audit", async (_req, res) => {
  try {
    res.json({ events: await listAuditSafe(), readyForBilling: false });
  } catch (error) {
    fail(res, error);
  }
});

export default router;
