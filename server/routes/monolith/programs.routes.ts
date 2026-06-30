import { Router } from "express";
import { authRequired, requireRole } from "../../middleware/legacyAuth";
import { getMonolithDb } from "../../monolith/dbAccess";
import { logAudit } from "../../monolith/audit";
import { cryptoRandomId, ROLES, ROLE_VALUES } from "../../monolith/constants";

export function createProgramsRouter(): Router {
  const router = Router();

// ----- Programs -----
router.get("/programs", authRequired, async (req, res) => {
  const db = getMonolithDb();
  const rows = await db.all<{ id: string; code: string; name: string; description: string }[]>(
    "SELECT id, code, name, description FROM programs ORDER BY name ASC"
  );
  res.json(rows.map((p) => ({ id: p.id, code: p.code, name: p.name, description: p.description })));
});

// Logic Models API
router.get("/logic-models", authRequired, async (req, res) => {
  const db = getMonolithDb();
  const rows = await db.all<any[]>("SELECT * FROM logic_models ORDER BY program_name ASC");
  res.json(rows.map((m) => ({
    id: m.id,
    programCode: m.program_code,
    programName: m.program_name,
    inputs: JSON.parse(m.inputs),
    activities: JSON.parse(m.activities),
    outputs: JSON.parse(m.outputs),
    shortTermOutcomes: JSON.parse(m.short_term_outcomes),
    midTermOutcomes: JSON.parse(m.mid_term_outcomes),
    longTermImpact: JSON.parse(m.long_term_impact),
    createdAt: m.created_at,
    updatedAt: m.updated_at
  })));
});

router.get("/logic-models/:programCode", authRequired, async (req, res) => {
  const { programCode } = req.params;
  const db = getMonolithDb();
  const row = await db.get<any>("SELECT * FROM logic_models WHERE program_code = ?", programCode);
  if (!row) {
    return res.status(404).json({ error: "Logic model not found" });
  }
  res.json({
    id: row.id,
    programCode: row.program_code,
    programName: row.program_name,
    inputs: JSON.parse(row.inputs),
    activities: JSON.parse(row.activities),
    outputs: JSON.parse(row.outputs),
    shortTermOutcomes: JSON.parse(row.short_term_outcomes),
    midTermOutcomes: JSON.parse(row.mid_term_outcomes),
    longTermImpact: JSON.parse(row.long_term_impact),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
});


  return router;
}

export function registerProgramsRoutes(app: import("express").Express): void {
  app.use("/api", createProgramsRouter());
}
