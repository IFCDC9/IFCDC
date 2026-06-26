import { Router } from "express";
import type { Request, Response } from "express";
import { getDb } from "../db";
import { hqAuthRequired, requireHQModule, requireHQPermission } from "../middleware/hqAuth";
import { docId } from "../hq/documentsSchema";
import { saveHqFileBase64 } from "../hq/hqFileStorage";
import { grantId } from "../hq/grantsSchema";
import { toHQRole } from "../hq/enterpriseRoles";

const router = Router();

router.use(hqAuthRequired, requireHQModule("settings"));

function canViewAccessLevel(role: string, accessLevel: string): boolean {
  const hqRole = toHQRole(role);
  if (["founder", "executive", "administrator"].includes(hqRole)) return true;
  if (accessLevel === "internal") return true;
  if (accessLevel === "confidential") {
    return ["hr", "finance", "grant_manager", "board_member"].includes(hqRole);
  }
  if (accessLevel === "board") {
    return hqRole === "board_member";
  }
  return false;
}

async function linkGrantDocument(
  db: Awaited<ReturnType<typeof getDb>>,
  grantRef: string,
  title: string,
  fileUrl: string | null,
  userEmail: string
) {
  const grant = await db.get<{ id: string }>(
    "SELECT id FROM grant_opportunities WHERE id = ? OR title LIKE ? LIMIT 1",
    grantRef,
    `%${grantRef}%`
  );
  if (!grant) return null;
  const now = new Date().toISOString();
  const gDocId = grantId();
  await db.run(
    `INSERT INTO grant_documents (id, opportunity_id, name, doc_type, doc_category, file_url, notes, status, uploaded_at, created_at)
     VALUES (?, ?, ?, 'attachment', 'vault', ?, ?, 'approved', ?, ?)`,
    gDocId,
    grant.id,
    title,
    fileUrl,
    `Linked from Document Center by ${userEmail}`,
    now,
    now
  );
  return gDocId;
}

router.get("/overview", async (_req, res) => {
  const db = await getDb();
  const total = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM hq_documents"))?.c ?? 0;
  const byCategory = await db.all(
    `SELECT category, COUNT(*) as count FROM hq_documents GROUP BY category ORDER BY count DESC`
  );
  const pending = (await db.get<{ c: number }>(
    "SELECT COUNT(*) as c FROM hq_documents WHERE approval_status = 'pending'"
  ))?.c ?? 0;
  res.json({ total, byCategory, pendingApprovals: pending });
});

router.get("/", async (req, res) => {
  const db = await getDb();
  const q = String(req.query.q ?? "").trim();
  const category = String(req.query.category ?? "").trim();
  const grant_id = String(req.query.grant_id ?? "").trim();
  const person_id = String(req.query.person_id ?? "").trim();
  let sql = "SELECT * FROM hq_documents WHERE 1=1";
  const params: string[] = [];
  if (category) {
    sql += " AND category = ?";
    params.push(category);
  }
  if (grant_id) {
    sql += " AND grant_id = ?";
    params.push(grant_id);
  }
  if (person_id) {
    sql += " AND person_id = ?";
    params.push(person_id);
  }
  if (q) {
    sql += " AND (title LIKE ? OR category LIKE ? OR ocr_text LIKE ?)";
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  sql += " ORDER BY updated_at DESC LIMIT 100";
  const rows = await db.all(sql, ...params);
  const role = req.hqUser?.role ?? "";
  const documents = rows.filter((d: { access_level?: string }) =>
    canViewAccessLevel(role, d.access_level ?? "internal")
  );
  res.json({ documents });
});

router.post("/upload", async (req: Request, res: Response) => {
  const { fileName, base64, mimeType, title, category, access_level, grant_id, person_id, requires_approval } =
    req.body ?? {};
  if (!fileName || !base64 || !title) {
    return res.status(400).json({ error: "fileName, base64, and title are required" });
  }
  try {
    const saved = await saveHqFileBase64(String(fileName), String(base64), mimeType ? String(mimeType) : undefined);
    const db = await getDb();
    const now = new Date().toISOString();
    const id = docId();
    const approvalStatus = requires_approval === false ? "approved" : "pending";
    await db.run(
      `INSERT INTO hq_documents (id, title, category, file_url, version, person_id, grant_id, department_id, access_level, approval_status, submitted_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      title,
      category ?? "general",
      saved.url,
      person_id ?? null,
      grant_id ?? null,
      null,
      access_level ?? "internal",
      approvalStatus,
      req.hqUser?.email ?? "",
      now,
      now
    );
    await db.run(
      `INSERT INTO hq_document_versions (id, document_id, version, title, file_url, change_notes, uploaded_by, created_at)
       VALUES (?, ?, 1, ?, ?, 'Initial upload', ?, ?)`,
      docId(),
      id,
      title,
      saved.url,
      req.hqUser?.email ?? "",
      now
    );
    if (grant_id) {
      await linkGrantDocument(db, String(grant_id), title, saved.url, req.hqUser?.email ?? "");
    }
    res.status(201).json({
      document: await db.get("SELECT * FROM hq_documents WHERE id = ?", id),
      file: saved,
    });
  } catch (error) {
    console.error("Document upload error:", error);
    res.status(500).json({ error: "Failed to upload document" });
  }
});

router.get("/:id", async (req, res) => {
  const db = await getDb();
  const doc = await db.get<{ access_level?: string }>("SELECT * FROM hq_documents WHERE id = ?", req.params.id);
  if (!doc) return res.status(404).json({ error: "Document not found" });
  if (!canViewAccessLevel(req.hqUser?.role ?? "", doc.access_level ?? "internal")) {
    return res.status(403).json({ error: "Access denied for this document" });
  }
  const versions = await db.all(
    "SELECT * FROM hq_document_versions WHERE document_id = ? ORDER BY version DESC",
    req.params.id
  );
  res.json({ document: doc, versions });
});

router.post("/", async (req: Request, res: Response) => {
  const { title, category, file_url, access_level, person_id, grant_id, department_id, requires_approval } = req.body;
  if (!title) return res.status(400).json({ error: "title is required" });
  const db = await getDb();
  const now = new Date().toISOString();
  const id = docId();
  const approvalStatus = requires_approval === false ? "approved" : "pending";
  await db.run(
    `INSERT INTO hq_documents (id, title, category, file_url, version, person_id, grant_id, department_id, access_level, approval_status, submitted_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    title,
    category ?? "general",
    file_url ?? null,
    person_id ?? null,
    grant_id ?? null,
    department_id ?? null,
    access_level ?? "internal",
    approvalStatus,
    req.hqUser?.email ?? "",
    now,
    now
  );
  await db.run(
    `INSERT INTO hq_document_versions (id, document_id, version, title, file_url, change_notes, uploaded_by, created_at)
     VALUES (?, ?, 1, ?, ?, 'Initial upload', ?, ?)`,
    docId(),
    id,
    title,
    file_url ?? null,
    req.hqUser?.email ?? "",
    now
  );
  if (grant_id && file_url) {
    await linkGrantDocument(db, String(grant_id), title, file_url, req.hqUser?.email ?? "");
  }
  res.status(201).json({ document: await db.get("SELECT * FROM hq_documents WHERE id = ?", id) });
});

router.post("/:id/versions", async (req: Request, res: Response) => {
  const { title, file_url, change_notes } = req.body;
  const db = await getDb();
  const doc = await db.get<{ id: string; version: number; title: string; access_level?: string }>(
    "SELECT id, version, title, access_level FROM hq_documents WHERE id = ?",
    req.params.id
  );
  if (!doc) return res.status(404).json({ error: "Document not found" });
  if (!canViewAccessLevel(req.hqUser?.role ?? "", doc.access_level ?? "internal")) {
    return res.status(403).json({ error: "Access denied" });
  }
  const nextVersion = (doc.version ?? 1) + 1;
  const now = new Date().toISOString();
  const newTitle = title ?? doc.title;
  await db.run(
    `UPDATE hq_documents SET title = ?, file_url = ?, version = ?, updated_at = ? WHERE id = ?`,
    newTitle,
    file_url ?? null,
    nextVersion,
    now,
    req.params.id
  );
  await db.run(
    `INSERT INTO hq_document_versions (id, document_id, version, title, file_url, change_notes, uploaded_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    docId(),
    req.params.id,
    nextVersion,
    newTitle,
    file_url ?? null,
    change_notes ?? "Updated",
    req.hqUser?.email ?? "",
    now
  );
  res.status(201).json({
    document: await db.get("SELECT * FROM hq_documents WHERE id = ?", req.params.id),
    version: nextVersion,
  });
});

router.patch("/:id", async (req: Request, res: Response) => {
  const { title, category, access_level } = req.body;
  const db = await getDb();
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (title) {
    sets.push("title = ?");
    vals.push(title);
  }
  if (category) {
    sets.push("category = ?");
    vals.push(category);
  }
  if (access_level) {
    sets.push("access_level = ?");
    vals.push(access_level);
  }
  if (!sets.length) return res.status(400).json({ error: "No valid fields" });
  sets.push("updated_at = ?");
  vals.push(new Date().toISOString(), req.params.id);
  await db.run(`UPDATE hq_documents SET ${sets.join(", ")} WHERE id = ?`, ...vals);
  res.json({ document: await db.get("SELECT * FROM hq_documents WHERE id = ?", req.params.id) });
});

router.post("/:id/ocr-index", async (req: Request, res: Response) => {
  const { text } = req.body;
  if (!text || typeof text !== "string") {
    return res.status(400).json({ error: "text is required for OCR indexing" });
  }
  const db = await getDb();
  const doc = await db.get("SELECT id FROM hq_documents WHERE id = ?", req.params.id);
  if (!doc) return res.status(404).json({ error: "Document not found" });
  const now = new Date().toISOString();
  await db.run(`UPDATE hq_documents SET ocr_text = ?, updated_at = ? WHERE id = ?`, text.slice(0, 50000), now, req.params.id);
  res.json({ document: await db.get("SELECT id, title, ocr_text, updated_at FROM hq_documents WHERE id = ?", req.params.id) });
});

router.post("/:id/sign", async (req: Request, res: Response) => {
  const { signatureData, signerName } = req.body;
  if (!signatureData) return res.status(400).json({ error: "signatureData is required" });
  const db = await getDb();
  const doc = await db.get("SELECT id, approval_status FROM hq_documents WHERE id = ?", req.params.id);
  if (!doc) return res.status(404).json({ error: "Document not found" });
  const now = new Date().toISOString();
  const signer = signerName ?? req.hqUser?.email ?? "Unknown";
  await db.run(
    `UPDATE hq_documents SET signature_status = 'signed', signed_by = ?, signed_at = ?, signature_data = ?, updated_at = ? WHERE id = ?`,
    signer,
    now,
    String(signatureData).slice(0, 10000),
    now,
    req.params.id
  );
  res.json({ document: await db.get("SELECT * FROM hq_documents WHERE id = ?", req.params.id) });
});

router.patch("/:id/approval", requireHQPermission("hq.settings", "hq.executive"), async (req: Request, res: Response) => {
  const { action } = req.body;
  if (!["approve", "reject"].includes(action)) {
    return res.status(400).json({ error: "action must be approve or reject" });
  }
  const db = await getDb();
  const doc = await db.get("SELECT id FROM hq_documents WHERE id = ?", req.params.id);
  if (!doc) return res.status(404).json({ error: "Document not found" });
  const now = new Date().toISOString();
  const status = action === "approve" ? "approved" : "rejected";
  await db.run(
    `UPDATE hq_documents SET approval_status = ?, approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ?`,
    status,
    req.hqUser?.email ?? "",
    now,
    now,
    req.params.id
  );
  res.json({ document: await db.get("SELECT * FROM hq_documents WHERE id = ?", req.params.id) });
});

export default router;
