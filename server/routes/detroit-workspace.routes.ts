import { Router } from "express";
import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { getDb } from "../db";
import { hqAuthRequired, requireHQPermission } from "../middleware/hqAuth";
import {
  applyUnknownDefaults,
  isDetroitRecordType,
  planDetroitImport,
  stringifyPayload,
  type DetroitDraft,
  type DetroitPublicRecord,
  type DetroitRecordType,
} from "../../shared/detroitWorkspace";

const router = Router();

const SELECT_COLUMNS = `id, record_type as type, title, status, payload_json as payloadJson,
  source_url as sourceUrl, verification_status as verificationStatus, created_by as createdBy,
  updated_by as updatedBy, created_at as createdAt, updated_at as updatedAt`;

async function ensureTable() {
  const db = await getDb();
  await db.exec(`CREATE TABLE IF NOT EXISTS detroit_workspace_records (
    id TEXT PRIMARY KEY, record_type TEXT NOT NULL, title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Needs verification', payload_json TEXT NOT NULL DEFAULT '{}',
    source_url TEXT, verification_status TEXT NOT NULL DEFAULT 'Unknown',
    created_by TEXT, updated_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`);
  return db;
}

function parsePayload(raw: unknown): Record<string, string> {
  try {
    return stringifyPayload(JSON.parse(String(raw || "{}")));
  } catch {
    return {};
  }
}

function toPublic(row: Record<string, unknown>): DetroitPublicRecord {
  const type = isDetroitRecordType(row.type) ? row.type : "property";
  return {
    id: String(row.id),
    type,
    title: String(row.title ?? ""),
    status: String(row.status ?? "Needs verification"),
    verificationStatus: String(row.verificationStatus ?? "Unknown"),
    sourceUrl: typeof row.sourceUrl === "string" ? row.sourceUrl : null,
    payload: applyUnknownDefaults(type, parsePayload(row.payloadJson)),
    createdBy: typeof row.createdBy === "string" ? row.createdBy : null,
    updatedBy: typeof row.updatedBy === "string" ? row.updatedBy : null,
    createdAt: String(row.createdAt ?? ""),
    updatedAt: String(row.updatedAt ?? ""),
  };
}

function validateWrite(body: Record<string, unknown>): { error?: string; type?: DetroitRecordType; title?: string; payload?: Record<string, string> } {
  if (!isDetroitRecordType(body.type) && body.type !== undefined) return { error: "Unsupported record type" };
  if (body.type !== undefined && !isDetroitRecordType(body.type)) return { error: "Unsupported record type" };
  if (typeof body.title === "string" && (!body.title.trim() || body.title.trim().length > 180)) {
    return { error: "A title of 1 to 180 characters is required" };
  }
  if (body.payload != null && (typeof body.payload !== "object" || Array.isArray(body.payload) || JSON.stringify(body.payload).length > 20000)) {
    return { error: "Record details must be an object under 20 KB" };
  }
  return {
    type: isDetroitRecordType(body.type) ? body.type : undefined,
    title: typeof body.title === "string" ? body.title.trim() : undefined,
    payload: body.payload === undefined ? undefined : stringifyPayload(body.payload),
  };
}

router.use(hqAuthRequired, requireHQPermission("hq.programs", "hq.grants", "hq.executive"));

router.get("/records", async (req, res) => {
  const db = await ensureTable();
  const type = String(req.query.type ?? "");
  if (type && !isDetroitRecordType(type)) return res.status(400).json({ error: "Unsupported record type" });
  const rows = await db.all(
    `SELECT ${SELECT_COLUMNS} FROM detroit_workspace_records ${type ? "WHERE record_type = ?" : ""} ORDER BY updated_at DESC LIMIT 500`,
    ...(type ? [type] : []),
  );
  res.json({ records: (rows as Record<string, unknown>[]).map(toPublic) });
});

router.get("/records/:id", async (req, res) => {
  const db = await ensureTable();
  const row = await db.get(`SELECT ${SELECT_COLUMNS} FROM detroit_workspace_records WHERE id = ?`, req.params.id);
  if (!row) return res.status(404).json({ error: "Record not found" });
  res.json({ record: toPublic(row as Record<string, unknown>) });
});

router.post("/records", async (req: Request, res: Response) => {
  const body = req.body ?? {};
  if (!isDetroitRecordType(body.type)) return res.status(400).json({ error: "Unsupported record type" });
  const checked = validateWrite(body);
  if (checked.error) return res.status(400).json({ error: checked.error });
  if (!checked.title) return res.status(400).json({ error: "A title of 1 to 180 characters is required" });
  const db = await ensureTable();
  const id = randomUUID();
  const now = new Date().toISOString();
  const payload = applyUnknownDefaults(body.type, checked.payload ?? {});
  await db.run(
    `INSERT INTO detroit_workspace_records (id, record_type, title, status, payload_json, source_url, verification_status, created_by, updated_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    body.type,
    checked.title,
    String(body.status || "Needs verification").slice(0, 80),
    JSON.stringify(payload),
    typeof body.sourceUrl === "string" ? body.sourceUrl.slice(0, 1000) : null,
    String(body.verificationStatus || "Unknown").slice(0, 80),
    req.hqUser?.email ?? null,
    req.hqUser?.email ?? null,
    now,
    now,
  );
  const record = await db.get(`SELECT ${SELECT_COLUMNS} FROM detroit_workspace_records WHERE id = ?`, id);
  res.status(201).json({ record: toPublic(record as Record<string, unknown>) });
});

router.patch("/records/:id", async (req: Request, res: Response) => {
  const db = await ensureTable();
  const old = await db.get<Record<string, unknown>>("SELECT * FROM detroit_workspace_records WHERE id = ?", req.params.id);
  if (!old) return res.status(404).json({ error: "Record not found" });
  const body = req.body ?? {};
  const checked = validateWrite({ ...body, type: body.type ?? old.record_type });
  if (checked.error) return res.status(400).json({ error: checked.error });
  const type = (checked.type ?? old.record_type) as DetroitRecordType;
  if (!isDetroitRecordType(type)) return res.status(400).json({ error: "Unsupported record type" });
  const title = checked.title ?? String(old.title);
  const payload = applyUnknownDefaults(
    type,
    checked.payload ?? parsePayload(old.payload_json),
  );
  const now = new Date().toISOString();
  await db.run(
    `UPDATE detroit_workspace_records SET record_type = ?, title = ?, status = ?, payload_json = ?, source_url = ?, verification_status = ?, updated_by = ?, updated_at = ? WHERE id = ?`,
    type,
    title,
    String(body.status ?? old.status).slice(0, 80),
    JSON.stringify(payload),
    body.sourceUrl === undefined ? old.source_url : (typeof body.sourceUrl === "string" ? body.sourceUrl.slice(0, 1000) : null),
    String(body.verificationStatus ?? old.verification_status).slice(0, 80),
    req.hqUser?.email ?? null,
    now,
    req.params.id,
  );
  const record = await db.get(`SELECT ${SELECT_COLUMNS} FROM detroit_workspace_records WHERE id = ?`, req.params.id);
  res.json({ ok: true, record: toPublic(record as Record<string, unknown>) });
});

router.post("/records/import", async (req: Request, res: Response) => {
  const incoming = Array.isArray(req.body?.records) ? req.body.records as DetroitDraft[] : null;
  if (!incoming) return res.status(400).json({ error: "records must be an array" });
  if (incoming.length > 500) return res.status(400).json({ error: "Import is limited to 500 records" });
  const db = await ensureTable();
  const rows = await db.all(`SELECT ${SELECT_COLUMNS} FROM detroit_workspace_records LIMIT 500`);
  const existing = (rows as Record<string, unknown>[]).map(toPublic);
  const plan = planDetroitImport(existing, incoming);
  const now = new Date().toISOString();
  const inserted: DetroitPublicRecord[] = [];
  for (const draft of plan.toInsert) {
    const id = randomUUID();
    const payload = applyUnknownDefaults(draft.type, stringifyPayload({
      ...draft.payload,
      importedFrom: typeof req.body?.source === "string" ? req.body.source.slice(0, 80) : "detroit-site-export",
    }));
    await db.run(
      `INSERT INTO detroit_workspace_records (id, record_type, title, status, payload_json, source_url, verification_status, created_by, updated_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      draft.type,
      draft.title,
      draft.status || "Needs verification",
      JSON.stringify(payload),
      draft.sourceUrl ?? null,
      draft.verificationStatus || "Unknown",
      req.hqUser?.email ?? null,
      req.hqUser?.email ?? null,
      now,
      now,
    );
    const record = await db.get(`SELECT ${SELECT_COLUMNS} FROM detroit_workspace_records WHERE id = ?`, id);
    inserted.push(toPublic(record as Record<string, unknown>));
  }
  res.status(201).json({
    imported: inserted.length,
    skippedDuplicates: plan.skippedDuplicates.length,
    invalid: plan.invalid.length,
    records: inserted,
    skippedTitles: plan.skippedDuplicates.map((draft) => draft.title),
    invalidReasons: plan.invalid.map((item) => item.reason),
  });
});

export default router;
