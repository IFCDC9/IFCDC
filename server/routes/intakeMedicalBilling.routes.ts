import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
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
import {
  completeFollowup,
  confirmAssignment,
  coordinationMeta,
  createCoordinationIntake,
  getCoordinationIntake,
  intakeCapabilities,
  listCoordinationIntakes,
  queueGenericNotice,
  recordOutsideReferral,
  setWorkflowStatus,
} from "../hq/hqIntakeEngine";
import { INTAKE_WORKSPACE_BANNER } from "../../shared/intakeMedicalBilling";
import { INTAKE_COORD_BANNER, HIPAA_COMPLIANCE_STATUS } from "../../shared/hqIntake";

const router = Router();

router.use(
  hqAuthRequired,
  requireHQPermission("hq.intake", "hq.intake.medical", "hq.intake.clinical", "hq.intake.department"),
);

function actor(req: Request) {
  return { id: req.hqUser?.id, role: req.hqUser?.role };
}

function fail(res: Response, error: unknown) {
  const status = typeof error === "object" && error && "status" in error ? Number((error as { status: number }).status) : 500;
  return res.status(status || 500).json(safeIntakeError(error));
}

function requireClinical(req: Request, res: Response, next: NextFunction) {
  if (!intakeCapabilities(req.hqUser?.role).canClinical) {
    return res.status(403).json({ error: "Clinical-restricted area. Access denied.", clinicalAccess: "denied" });
  }
  next();
}

function requireBilling(req: Request, res: Response, next: NextFunction) {
  if (!intakeCapabilities(req.hqUser?.role).canBilling) {
    return res.status(403).json({ error: "Billing workflow access denied." });
  }
  next();
}

router.get("/meta", (req, res) => {
  res.json({
    ...coordinationMeta(req.hqUser?.role),
    readyForBilling: false,
    notForRealPhi: true,
    hipaaCompliance: HIPAA_COMPLIANCE_STATUS,
    banner: `${INTAKE_COORD_BANNER} ${INTAKE_WORKSPACE_BANNER}`,
    eligibility: "Unknown",
    enrolledToBill: "Unknown",
    auraIsLicensedCoder: false,
    auraIsLicensedClinician: false,
    auraIsSamEntityAdministrator: false,
    claimSubmissionEnabled: false,
  });
});

router.get("/coordination", async (req, res) => {
  try {
    res.json(await listCoordinationIntakes(actor(req)));
  } catch (error) {
    fail(res, error);
  }
});

router.post("/coordination", async (req, res) => {
  try {
    res.json(await createCoordinationIntake(actor(req), req.body || {}));
  } catch (error) {
    fail(res, error);
  }
});

router.get("/coordination/:id", async (req, res) => {
  try {
    res.json(await getCoordinationIntake(actor(req), req.params.id));
  } catch (error) {
    fail(res, error);
  }
});

router.post("/coordination/:id/assignment", async (req, res) => {
  try {
    res.json(await confirmAssignment(actor(req), req.params.id, req.body || {}));
  } catch (error) {
    fail(res, error);
  }
});

router.post("/coordination/:id/referrals", async (req, res) => {
  try {
    res.json(await recordOutsideReferral(actor(req), req.params.id, req.body || {}));
  } catch (error) {
    fail(res, error);
  }
});

router.post("/coordination/:id/followups", async (req, res) => {
  try {
    res.json(await completeFollowup(actor(req), req.params.id, req.body || {}));
  } catch (error) {
    fail(res, error);
  }
});

router.post("/coordination/:id/status", async (req, res) => {
  try {
    res.json(await setWorkflowStatus(actor(req), req.params.id, String(req.body?.status || "")));
  } catch (error) {
    fail(res, error);
  }
});

router.post("/coordination/:id/notice", async (req, res) => {
  try {
    res.json(await queueGenericNotice(actor(req), req.params.id));
  } catch (error) {
    fail(res, error);
  }
});

router.get("/cases", async (req, res) => {
  try {
    if (!intakeCapabilities(req.hqUser?.role).canBilling && !intakeCapabilities(req.hqUser?.role).canClinical) {
      return res.status(403).json({ error: "Medical billing cases are a separate restricted workflow." });
    }
    res.json(await listIntakeCases(actor(req)));
  } catch (error) {
    fail(res, error);
  }
});

router.post("/cases", async (req, res) => {
  try {
    if (!intakeCapabilities(req.hqUser?.role).canBilling) {
      return res.status(403).json({ error: "Medical billing cases are a separate restricted workflow." });
    }
    res.json(await upsertIntakeCase(actor(req), req.body || {}));
  } catch (error) {
    fail(res, error);
  }
});

router.get("/cases/:id", async (req, res) => {
  try {
    const caps = intakeCapabilities(req.hqUser?.role);
    if (!caps.canBilling && !caps.canClinical) {
      return res.status(403).json({ error: "Medical billing cases are a separate restricted workflow." });
    }
    const bundle = await getIntakeBundle(actor(req), req.params.id);
    if (!caps.canClinical) {
      return res.json({ ...bundle, clinical: [], insurance: [], clinicalAccess: "denied" });
    }
    res.json(bundle);
  } catch (error) {
    fail(res, error);
  }
});

router.put("/cases/:id", async (req, res) => {
  try {
    if (!intakeCapabilities(req.hqUser?.role).canBilling) {
      return res.status(403).json({ error: "Medical billing cases are a separate restricted workflow." });
    }
    res.json(await upsertIntakeCase(actor(req), { ...req.body, id: req.params.id }));
  } catch (error) {
    fail(res, error);
  }
});

router.post("/cases/:id/insurance", requireClinical, async (req, res) => {
  try {
    res.json(await upsertInsurance(actor(req), req.params.id, req.body || {}));
  } catch (error) {
    fail(res, error);
  }
});

router.post("/cases/:id/clinical", requireClinical, async (req, res) => {
  try {
    res.json(await upsertClinical(actor(req), req.params.id, req.body || {}));
  } catch (error) {
    fail(res, error);
  }
});

router.post("/cases/:id/coding", requireBilling, async (req, res) => {
  try {
    res.json(await runCodingAssist(actor(req), req.params.id));
  } catch (error) {
    fail(res, error);
  }
});

router.post("/coding/:id/approve", requireBilling, async (req, res) => {
  try {
    res.json(await approveCoding(actor(req), req.params.id, req.body?.approved === true));
  } catch (error) {
    fail(res, error);
  }
});

router.post("/cases/:id/claims", requireBilling, async (req, res) => {
  try {
    res.json(await upsertDraftClaim(actor(req), req.params.id, req.body || {}));
  } catch (error) {
    fail(res, error);
  }
});

router.post("/claims/:id/submit", requireBilling, async (req, res) => {
  const result = await submitClaim(actor(req), req.params.id);
  res.status(409).json(result);
});

router.get("/audit", async (_req, res) => {
  try {
    res.json({ events: await listAuditSafe(), readyForBilling: false, hipaaCompliance: HIPAA_COMPLIANCE_STATUS });
  } catch (error) {
    fail(res, error);
  }
});

export default router;
