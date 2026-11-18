import { Router } from "express";
import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { getDb } from "../db";
import { hqAuthRequired, requireHQPermission } from "../middleware/hqAuth";

const router = Router();
const TYPES = ["property", "checklist", "comparison", "site_note", "work_plan", "budget", "contact", "application", "follow_up"] as const;
type RecordType = (typeof TYPES)[number];

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

router.use(hqAuthRequired, requireHQPermission("hq.programs", "hq.grants", "hq.executive"));

router.get("/records", async (req, res) => {
  const db = await ensureTable();
  const type = String(req.query.type ?? "");
  if (type && !TYPES.includes(type as RecordType)) return res.status(400).json({ error: "Unsupported record type" });
  const rows = await db.all(`SELECT id, record_type as type, title, status, payload_json as payloadJson,
    source_url as sourceUrl, verification_status as verificationStatus, created_by as createdBy,
    updated_by as updatedBy, created_at as createdAt, updated_at as updatedAt
    FROM detroit_workspace_records ${type ? "WHERE record_type = ?" : ""} ORDER BY updated_at DESC LIMIT 500`, ...(type ? [type] : []));
  res.json({ records: (rows as Record<string, unknown>[]).map((row) => ({ ...row, payload: JSON.parse(String(row.payloadJson || "{}")) })) });
});

router.post("/records", async (req: Request, res: Response) => {
  const { type, title, status, payload, sourceUrl, verificationStatus } = req.body ?? {};
  if (!TYPES.includes(type)) return res.status(400).json({ error: "Unsupported record type" });
  if (typeof title !== "string" || !title.trim() || title.trim().length > 180) return res.status(400).json({ error: "A title of 1 to 180 characters is required" });
  if (payload != null && (typeof payload !== "object" || Array.isArray(payload) || JSON.stringify(payload).length > 20000)) return res.status(400).json({ error: "Record details must be an object under 20 KB" });
  const db = await ensureTable();
  const id = randomUUID();
  const now = new Date().toISOString();
  await db.run(`INSERT INTO detroit_workspace_records (id, record_type, title, status, payload_json, source_url, verification_status, created_by, updated_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, type, title.trim(), String(status || "Needs verification").slice(0, 80), JSON.stringify(payload ?? {}), typeof sourceUrl === "string" ? sourceUrl.slice(0, 1000) : null, String(verificationStatus || "Unknown").slice(0, 80), req.hqUser?.email ?? null, req.hqUser?.email ?? null, now, now);
  const record = await db.get("SELECT id, record_type as type, title, status, payload_json as payloadJson, source_url as sourceUrl, verification_status as verificationStatus, created_at as createdAt, updated_at as updatedAt FROM detroit_workspace_records WHERE id = ?", id);
  res.status(201).json({ record: { ...record, payload: payload ?? {} } });
});

router.patch("/records/:id", async (req: Request, res: Response) => {
  const db = await ensureTable();
  const old = await db.get<Record<string, unknown>>("SELECT * FROM detroit_workspace_records WHERE id = ?", req.params.id);
  if (!old) return res.status(404).json({ error: "Record not found" });
  const body = req.body ?? {};
  const title = body.title === undefined ? old.title : body.title;
  const payload = body.payload === undefined ? JSON.parse(String(old.payload_json || "{}")) : body.payload;
  if (typeof title !== "string" || !title.trim() || title.trim().length > 180) return res.status(400).json({ error: "A title of 1 to 180 characters is required" });
  if (typeof payload !== "object" || !payload || Array.isArray(payload) || JSON.stringify(payload).length > 20000) return res.status(400).json({ error: "Record details must be an object under 20 KB" });
  const now = new Date().toISOString();
  await db.run(`UPDATE detroit_workspace_records SET title = ?, status = ?, payload_json = ?, source_url = ?, verification_status = ?, updated_by = ?, updated_at = ? WHERE id = ?`, title.trim(), String(body.status ?? old.status).slice(0, 80), JSON.stringify(payload), body.sourceUrl === undefined ? old.source_url : (typeof body.sourceUrl === "string" ? body.sourceUrl.slice(0, 1000) : null), String(body.verificationStatus ?? old.verification_status).slice(0, 80), req.hqUser?.email ?? null, now, req.params.id);
  res.json({ ok: true, id: req.params.id, updatedAt: now });
});

export default router;
