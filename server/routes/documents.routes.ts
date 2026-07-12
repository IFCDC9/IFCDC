import { Router } from "express";
import type { Request, Response } from "express";
import { getDb } from "../db";
import { hqAuthRequired, requireHQModule, requireHQPermission } from "../middleware/hqAuth";
import { docId, ensureDocumentTables } from "../hq/documentsSchema";
import { saveHqFileBase64 } from "../hq/hqFileStorage";
import { grantId } from "../hq/grantsSchema";
import { indexUploadedDocument } from "../hq/knowledgeBaseEngine";
import { validateHqDocumentUpload } from "../hq/grantDocumentUpload";
import {
  buildDocumentLibraryOverview,
  buildModuleDocumentSnapshot,
  canManageDocument,
  canViewDocumentAccess,
  detectFileType,
  getDocumentActivity,
  logDocumentActivity,
  MODULE_DOCUMENT_LINKS,
  normalizeDocumentCategory,
  searchEnterpriseDocuments,
  upsertSearchIndex,
  type DocumentSearchFilters,
} from "../hq/documentEnterpriseEngine";

const router = Router();

router.use(hqAuthRequired, requireHQModule("documents"));

router.use(async (_req, _res, next) => {
  try {
    await ensureDocumentTables();
  } catch (err) {
    console.warn("[documents] ensureDocumentTables:", err);
  }
  next();
});

function parseTags(input: unknown): string[] {
  if (Array.isArray(input)) return input.map(String).map((t) => t.trim()).filter(Boolean).slice(0, 40);
  if (typeof input === "string") {
    return input
      .split(/[,;]/)
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 40);
  }
  return [];
}

function parseMetadata(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (typeof k === "string" && k.trim()) out[k.trim().slice(0, 64)] = String(v).slice(0, 500);
  }
  return out;
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

function filtersFromQuery(query: Request["query"]): DocumentSearchFilters {
  return {
    q: String(query.q ?? "").trim() || undefined,
    category: String(query.category ?? "").trim() || undefined,
    department_id: String(query.department_id ?? "").trim() || undefined,
    program_id: String(query.program_id ?? "").trim() || undefined,
    project_id: String(query.project_id ?? "").trim() || undefined,
    grant_id: String(query.grant_id ?? "").trim() || undefined,
    person_id: String(query.person_id ?? "").trim() || undefined,
    file_type: String(query.file_type ?? "").trim() || undefined,
    owner: String(query.owner ?? "").trim() || undefined,
    status: String(query.status ?? "").trim() || undefined,
    access_level: String(query.access_level ?? "").trim() || undefined,
    visibility: String(query.visibility ?? "").trim() || undefined,
    tag: String(query.tag ?? "").trim() || undefined,
    source_module: String(query.source_module ?? "").trim() || undefined,
    created_from: String(query.created_from ?? "").trim() || undefined,
    created_to: String(query.created_to ?? "").trim() || undefined,
    modified_from: String(query.modified_from ?? "").trim() || undefined,
    modified_to: String(query.modified_to ?? "").trim() || undefined,
    archived: String(query.archived ?? "") === "1",
    limit: query.limit ? Number(query.limit) : 200,
  };
}

router.get("/overview", async (req, res) => {
  try {
    const overview = await buildDocumentLibraryOverview(req.hqUser?.role ?? "", req.hqUser?.email);
    res.json(overview);
  } catch (err) {
    console.error("[documents] overview error:", err);
    res.json({
      total: 0,
      byCategory: [],
      pendingApprovals: 0,
      archived: 0,
      facets: {},
      moduleLinks: MODULE_DOCUMENT_LINKS,
      recentActivity: [],
      indexed: 0,
      degraded: true,
    });
  }
});

router.get("/library", async (req, res) => {
  try {
    const overview = await buildDocumentLibraryOverview(req.hqUser?.role ?? "", req.hqUser?.email);
    res.json(overview);
  } catch (err) {
    console.error("[documents] library error:", err);
    res.status(500).json({ error: "Failed to load document library" });
  }
});

router.get("/modules", (_req, res) => {
  res.json({ modules: MODULE_DOCUMENT_LINKS });
});

router.get("/modules/:moduleId", async (req, res) => {
  try {
    const snapshot = await buildModuleDocumentSnapshot(
      String(req.params.moduleId),
      req.hqUser?.role ?? "",
      req.hqUser?.email
    );
    res.json(snapshot);
  } catch (err) {
    console.error("[documents] module snapshot error:", err);
    res.json({ module: req.params.moduleId, documents: [], total: 0, degraded: true });
  }
});

router.get("/search", async (req, res) => {
  try {
    const result = await searchEnterpriseDocuments(
      filtersFromQuery(req.query),
      req.hqUser?.role ?? "",
      req.hqUser?.email
    );
    res.json(result);
  } catch (err) {
    console.error("[documents] search error:", err);
    res.json({ documents: [], total: 0, facets: {}, degraded: true });
  }
});

router.get("/", async (req, res) => {
  try {
    const result = await searchEnterpriseDocuments(
      filtersFromQuery(req.query),
      req.hqUser?.role ?? "",
      req.hqUser?.email
    );
    res.json({ documents: result.documents, total: result.total, facets: result.facets });
  } catch (err) {
    console.error("[documents] list error:", err);
    res.json({ documents: [], degraded: true });
  }
});

router.post("/reindex", requireHQPermission("hq.documents", "hq.settings", "hq.executive"), async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.all<{ id: string }>("SELECT id FROM hq_documents");
    for (const row of rows) {
      await upsertSearchIndex(row.id);
    }
    await logDocumentActivity({
      documentId: "library",
      action: "reindex",
      actorEmail: req.hqUser?.email,
      actorRole: req.hqUser?.role,
      detail: `Reindexed ${rows.length} documents`,
    });
    res.json({ ok: true, indexed: rows.length });
  } catch (err) {
    console.error("[documents] reindex error:", err);
    res.status(500).json({ error: "Reindex failed" });
  }
});

router.post("/upload", async (req: Request, res: Response) => {
  const {
    fileName,
    base64,
    mimeType,
    title,
    category,
    access_level,
    grant_id,
    person_id,
    department_id,
    program_id,
    project_id,
    requires_approval,
    tags,
    labels,
    custom_metadata,
    visibility,
    source_module,
  } = req.body ?? {};
  if (!fileName || !base64 || !title) {
    return res.status(400).json({ error: "fileName, base64, and title are required" });
  }
  const validated = validateHqDocumentUpload(String(fileName), String(base64), mimeType ? String(mimeType) : undefined);
  if (!validated.ok) {
    return res.status(400).json({ error: validated.error });
  }
  try {
    const saved = await saveHqFileBase64(
      String(fileName),
      String(base64),
      validated.mime,
      req.hqUser?.email ?? "",
      access_level ?? "internal"
    );
    const db = await getDb();
    const now = new Date().toISOString();
    const id = docId();
    const approvalStatus = requires_approval === false ? "approved" : "pending";
    const folder = normalizeDocumentCategory(category);
    const tagList = parseTags(tags);
    const labelList = parseTags(labels);
    const meta = parseMetadata(custom_metadata);
    const fileType = detectFileType(String(fileName), validated.mime);
    const ownerEmail = req.hqUser?.email ?? "";
    const vis = ["private", "shared", "department", "organization"].includes(String(visibility))
      ? String(visibility)
      : "shared";

    await db.run(
      `INSERT INTO hq_documents (
        id, title, category, file_url, version, person_id, grant_id, department_id,
        access_level, approval_status, submitted_by, created_at, updated_at,
        program_id, project_id, tags_json, labels_json, custom_metadata_json,
        mime_type, file_type, owner_email, visibility, source_module, file_name, file_size_bytes
      ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      title,
      folder,
      saved.url,
      person_id ?? null,
      grant_id ?? null,
      department_id ?? null,
      access_level ?? "internal",
      approvalStatus,
      ownerEmail,
      now,
      now,
      program_id ?? null,
      project_id ?? null,
      JSON.stringify(tagList),
      JSON.stringify(labelList),
      JSON.stringify(meta),
      validated.mime,
      fileType,
      ownerEmail,
      vis,
      source_module ?? null,
      String(fileName),
      validated.sizeBytes
    );
    await db.run(
      `INSERT INTO hq_document_versions (id, document_id, version, title, file_url, change_notes, uploaded_by, created_at)
       VALUES (?, ?, 1, ?, ?, 'Initial upload', ?, ?)`,
      docId(),
      id,
      title,
      saved.url,
      ownerEmail,
      now
    );
    if (grant_id) {
      await linkGrantDocument(db, String(grant_id), title, saved.url, ownerEmail);
    }
    await upsertSearchIndex(id);
    await logDocumentActivity({
      documentId: id,
      action: "upload",
      actorEmail: ownerEmail,
      actorRole: req.hqUser?.role,
      detail: `Uploaded ${fileName}`,
      metadata: { mime: validated.mime, sizeBytes: validated.sizeBytes, category: folder },
    });
    void indexUploadedDocument(id, req.hqUser?.email).catch(() => undefined);
    res.status(201).json({
      document: await db.get("SELECT * FROM hq_documents WHERE id = ?", id),
      file: saved,
    });
  } catch (error) {
    console.error("Document upload error:", error);
    res.status(500).json({ error: "Failed to upload document" });
  }
});

router.get("/:id/activity", async (req, res) => {
  try {
    const db = await getDb();
    const doc = await db.get<{ access_level?: string; visibility?: string; owner_email?: string; department_id?: string }>(
      "SELECT * FROM hq_documents WHERE id = ?",
      req.params.id
    );
    if (!doc) return res.status(404).json({ error: "Document not found" });
    if (
      !canViewDocumentAccess(
        req.hqUser?.role ?? "",
        doc.access_level ?? "internal",
        doc.visibility,
        doc.owner_email,
        req.hqUser?.email,
        doc.department_id
      )
    ) {
      return res.status(403).json({ error: "Access denied" });
    }
    const activity = await getDocumentActivity(String(req.params.id));
    res.json({ activity });
  } catch (err) {
    console.error("[documents] activity error:", err);
    res.json({ activity: [] });
  }
});

router.post("/:id/download", async (req, res) => {
  try {
    const db = await getDb();
    const doc = await db.get<{
      id: string;
      file_url: string | null;
      title: string;
      access_level?: string;
      visibility?: string;
      owner_email?: string;
      department_id?: string;
    }>("SELECT * FROM hq_documents WHERE id = ?", req.params.id);
    if (!doc) return res.status(404).json({ error: "Document not found" });
    if (
      !canViewDocumentAccess(
        req.hqUser?.role ?? "",
        doc.access_level ?? "internal",
        doc.visibility,
        doc.owner_email,
        req.hqUser?.email,
        doc.department_id
      )
    ) {
      return res.status(403).json({ error: "Access denied" });
    }
    if (!doc.file_url) return res.status(404).json({ error: "No file attached" });
    await logDocumentActivity({
      documentId: doc.id,
      action: "download",
      actorEmail: req.hqUser?.email,
      actorRole: req.hqUser?.role,
      detail: `Secure download: ${doc.title}`,
    });
    res.json({ url: doc.file_url, title: doc.title });
  } catch (err) {
    console.error("[documents] download error:", err);
    res.status(500).json({ error: "Download failed" });
  }
});

router.get("/:id", async (req, res) => {
  const db = await getDb();
  const doc = await db.get<{
    access_level?: string;
    visibility?: string;
    owner_email?: string;
    department_id?: string;
    tags_json?: string;
    labels_json?: string;
    custom_metadata_json?: string;
  }>("SELECT * FROM hq_documents WHERE id = ?", req.params.id);
  if (!doc) return res.status(404).json({ error: "Document not found" });
  if (
    !canViewDocumentAccess(
      req.hqUser?.role ?? "",
      doc.access_level ?? "internal",
      doc.visibility,
      doc.owner_email,
      req.hqUser?.email,
      doc.department_id
    )
  ) {
    return res.status(403).json({ error: "Access denied for this document" });
  }
  const versions = await db.all(
    "SELECT * FROM hq_document_versions WHERE document_id = ? ORDER BY version DESC",
    req.params.id
  );
  const activity = await getDocumentActivity(String(req.params.id), 30);
  let tags: string[] = [];
  let labels: string[] = [];
  let custom_metadata: Record<string, string> = {};
  try {
    tags = doc.tags_json ? JSON.parse(doc.tags_json) : [];
  } catch { /* ignore */ }
  try {
    labels = doc.labels_json ? JSON.parse(doc.labels_json) : [];
  } catch { /* ignore */ }
  try {
    custom_metadata = doc.custom_metadata_json ? JSON.parse(doc.custom_metadata_json) : {};
  } catch { /* ignore */ }

  await logDocumentActivity({
    documentId: String(req.params.id),
    action: "view",
    actorEmail: req.hqUser?.email,
    actorRole: req.hqUser?.role,
  });

  res.json({
    document: { ...doc, tags, labels, custom_metadata },
    versions,
    activity,
  });
});

router.post("/", async (req: Request, res: Response) => {
  const {
    title,
    category,
    file_url,
    access_level,
    person_id,
    grant_id,
    department_id,
    program_id,
    project_id,
    requires_approval,
    tags,
    labels,
    custom_metadata,
    visibility,
    source_module,
  } = req.body;
  if (!title) return res.status(400).json({ error: "title is required" });
  const db = await getDb();
  const now = new Date().toISOString();
  const id = docId();
  const approvalStatus = requires_approval === false ? "approved" : "pending";
  const tagList = parseTags(tags);
  const labelList = parseTags(labels);
  const meta = parseMetadata(custom_metadata);
  const ownerEmail = req.hqUser?.email ?? "";
  const vis = ["private", "shared", "department", "organization"].includes(String(visibility))
    ? String(visibility)
    : "shared";
  const folder = normalizeDocumentCategory(category);
  const fileType = file_url ? detectFileType(String(file_url)) : "other";

  await db.run(
    `INSERT INTO hq_documents (
      id, title, category, file_url, version, person_id, grant_id, department_id,
      access_level, approval_status, submitted_by, created_at, updated_at,
      program_id, project_id, tags_json, labels_json, custom_metadata_json,
      file_type, owner_email, visibility, source_module
    ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    title,
    folder,
    file_url ?? null,
    person_id ?? null,
    grant_id ?? null,
    department_id ?? null,
    access_level ?? "internal",
    approvalStatus,
    ownerEmail,
    now,
    now,
    program_id ?? null,
    project_id ?? null,
    JSON.stringify(tagList),
    JSON.stringify(labelList),
    JSON.stringify(meta),
    fileType,
    ownerEmail,
    vis,
    source_module ?? null
  );
  await db.run(
    `INSERT INTO hq_document_versions (id, document_id, version, title, file_url, change_notes, uploaded_by, created_at)
     VALUES (?, ?, 1, ?, ?, 'Initial upload', ?, ?)`,
    docId(),
    id,
    title,
    file_url ?? null,
    ownerEmail,
    now
  );
  if (grant_id && file_url) {
    await linkGrantDocument(db, String(grant_id), title, file_url, ownerEmail);
  }
  await upsertSearchIndex(id);
  await logDocumentActivity({
    documentId: id,
    action: "create",
    actorEmail: ownerEmail,
    actorRole: req.hqUser?.role,
    detail: "Metadata document created",
  });
  void indexUploadedDocument(id, req.hqUser?.email).catch(() => undefined);
  res.status(201).json({ document: await db.get("SELECT * FROM hq_documents WHERE id = ?", id) });
});

router.post("/:id/versions", async (req: Request, res: Response) => {
  const { title, file_url, change_notes, mimeType, fileName } = req.body;
  const db = await getDb();
  const doc = await db.get<{
    id: string;
    version: number;
    title: string;
    access_level?: string;
    visibility?: string;
    owner_email?: string;
    department_id?: string;
  }>("SELECT * FROM hq_documents WHERE id = ?", req.params.id);
  if (!doc) return res.status(404).json({ error: "Document not found" });
  if (
    !canViewDocumentAccess(
      req.hqUser?.role ?? "",
      doc.access_level ?? "internal",
      doc.visibility,
      doc.owner_email,
      req.hqUser?.email,
      doc.department_id
    )
  ) {
    return res.status(403).json({ error: "Access denied" });
  }
  const nextVersion = (doc.version ?? 1) + 1;
  const now = new Date().toISOString();
  const newTitle = title ?? doc.title;
  const fileType = file_url ? detectFileType(String(fileName || file_url), mimeType) : undefined;
  await db.run(
    `UPDATE hq_documents SET title = ?, file_url = ?, version = ?, updated_at = ?,
      mime_type = COALESCE(?, mime_type), file_type = COALESCE(?, file_type), file_name = COALESCE(?, file_name)
     WHERE id = ?`,
    newTitle,
    file_url ?? null,
    nextVersion,
    now,
    mimeType ?? null,
    fileType ?? null,
    fileName ?? null,
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
  await upsertSearchIndex(String(req.params.id));
  await logDocumentActivity({
    documentId: String(req.params.id),
    action: "version",
    actorEmail: req.hqUser?.email,
    actorRole: req.hqUser?.role,
    detail: change_notes ?? `Version ${nextVersion}`,
    metadata: { version: nextVersion },
  });
  void indexUploadedDocument(req.params.id, req.hqUser?.email).catch(() => undefined);
  res.status(201).json({
    document: await db.get("SELECT * FROM hq_documents WHERE id = ?", req.params.id),
    version: nextVersion,
  });
});

router.patch("/:id", async (req: Request, res: Response) => {
  const {
    title,
    category,
    access_level,
    department_id,
    program_id,
    project_id,
    tags,
    labels,
    custom_metadata,
    visibility,
    source_module,
    person_id,
    grant_id,
  } = req.body;
  const db = await getDb();
  const existing = await db.get<{
    access_level?: string;
    visibility?: string;
    owner_email?: string;
    department_id?: string;
  }>("SELECT * FROM hq_documents WHERE id = ?", req.params.id);
  if (!existing) return res.status(404).json({ error: "Document not found" });
  if (
    !canViewDocumentAccess(
      req.hqUser?.role ?? "",
      existing.access_level ?? "internal",
      existing.visibility,
      existing.owner_email,
      req.hqUser?.email,
      existing.department_id
    )
  ) {
    return res.status(403).json({ error: "Access denied" });
  }

  const sets: string[] = [];
  const vals: unknown[] = [];
  if (title) {
    sets.push("title = ?");
    vals.push(title);
  }
  if (category) {
    sets.push("category = ?");
    vals.push(normalizeDocumentCategory(category));
  }
  if (access_level) {
    sets.push("access_level = ?");
    vals.push(access_level);
  }
  if (department_id !== undefined) {
    sets.push("department_id = ?");
    vals.push(department_id || null);
  }
  if (program_id !== undefined) {
    sets.push("program_id = ?");
    vals.push(program_id || null);
  }
  if (project_id !== undefined) {
    sets.push("project_id = ?");
    vals.push(project_id || null);
  }
  if (person_id !== undefined) {
    sets.push("person_id = ?");
    vals.push(person_id || null);
  }
  if (grant_id !== undefined) {
    sets.push("grant_id = ?");
    vals.push(grant_id || null);
  }
  if (tags !== undefined) {
    sets.push("tags_json = ?");
    vals.push(JSON.stringify(parseTags(tags)));
  }
  if (labels !== undefined) {
    sets.push("labels_json = ?");
    vals.push(JSON.stringify(parseTags(labels)));
  }
  if (custom_metadata !== undefined) {
    sets.push("custom_metadata_json = ?");
    vals.push(JSON.stringify(parseMetadata(custom_metadata)));
  }
  if (visibility) {
    sets.push("visibility = ?");
    vals.push(visibility);
  }
  if (source_module !== undefined) {
    sets.push("source_module = ?");
    vals.push(source_module || null);
  }
  if (!sets.length) return res.status(400).json({ error: "No valid fields" });
  sets.push("updated_at = ?");
  vals.push(new Date().toISOString(), req.params.id);
  await db.run(`UPDATE hq_documents SET ${sets.join(", ")} WHERE id = ?`, ...vals);
  await upsertSearchIndex(String(req.params.id));
  await logDocumentActivity({
    documentId: String(req.params.id),
    action: "update",
    actorEmail: req.hqUser?.email,
    actorRole: req.hqUser?.role,
    detail: "Metadata updated",
  });
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
  await upsertSearchIndex(String(req.params.id));
  await logDocumentActivity({
    documentId: String(req.params.id),
    action: "ocr_index",
    actorEmail: req.hqUser?.email,
    actorRole: req.hqUser?.role,
  });
  void indexUploadedDocument(req.params.id, req.hqUser?.email).catch(() => undefined);
  res.json({ document: await db.get("SELECT id, title, ocr_text, updated_at FROM hq_documents WHERE id = ?", req.params.id) });
});

router.post("/:id/sign", async (req: Request, res: Response) => {
  const { signatureData, signerName } = req.body;
  if (!signatureData) return res.status(400).json({ error: "signatureData is required" });
  if (String(signatureData).startsWith("signed:")) {
    return res.status(501).json({
      error: "Enterprise e-signature is not enabled yet. Use approvals or attach a signed PDF as a new version.",
    });
  }
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
  await logDocumentActivity({
    documentId: String(req.params.id),
    action: "sign",
    actorEmail: req.hqUser?.email,
    actorRole: req.hqUser?.role,
    detail: `Signed by ${signer}`,
  });
  res.json({ document: await db.get("SELECT * FROM hq_documents WHERE id = ?", req.params.id) });
});

router.post("/:id/versions/:versionId/restore", async (req: Request, res: Response) => {
  const db = await getDb();
  const doc = await db.get<{
    id: string;
    version: number;
    title: string;
    access_level?: string;
    visibility?: string;
    owner_email?: string;
    department_id?: string;
  }>("SELECT * FROM hq_documents WHERE id = ?", req.params.id);
  if (!doc) return res.status(404).json({ error: "Document not found" });
  if (
    !canViewDocumentAccess(
      req.hqUser?.role ?? "",
      doc.access_level ?? "internal",
      doc.visibility,
      doc.owner_email,
      req.hqUser?.email,
      doc.department_id
    )
  ) {
    return res.status(403).json({ error: "Access denied" });
  }
  const prior = await db.get<{ id: string; version: number; title: string; file_url: string | null }>(
    "SELECT id, version, title, file_url FROM hq_document_versions WHERE id = ? AND document_id = ?",
    req.params.versionId,
    req.params.id
  );
  if (!prior) return res.status(404).json({ error: "Version not found" });
  if (!prior.file_url) return res.status(400).json({ error: "Version has no file to restore" });

  const nextVersion = (doc.version ?? 1) + 1;
  const now = new Date().toISOString();
  await db.run(
    `UPDATE hq_documents SET title = ?, file_url = ?, version = ?, updated_at = ? WHERE id = ?`,
    prior.title || doc.title,
    prior.file_url,
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
    prior.title || doc.title,
    prior.file_url,
    `Restored from v${prior.version}`,
    req.hqUser?.email ?? "",
    now
  );
  await upsertSearchIndex(String(req.params.id));
  await logDocumentActivity({
    documentId: String(req.params.id),
    action: "restore",
    actorEmail: req.hqUser?.email,
    actorRole: req.hqUser?.role,
    detail: `Restored from v${prior.version} → v${nextVersion}`,
  });
  void indexUploadedDocument(req.params.id, req.hqUser?.email).catch(() => undefined);
  res.status(201).json({
    document: await db.get("SELECT * FROM hq_documents WHERE id = ?", req.params.id),
    version: nextVersion,
  });
});

router.patch("/:id/approval", requireHQPermission("hq.documents", "hq.settings", "hq.executive"), async (req: Request, res: Response) => {
  const { action } = req.body;
  if (!["approve", "reject"].includes(action)) {
    return res.status(400).json({ error: "action must be approve or reject" });
  }
  if (!canManageDocument(req.hqUser?.role ?? "")) {
    return res.status(403).json({ error: "Insufficient permissions to approve documents" });
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
  await logDocumentActivity({
    documentId: String(req.params.id),
    action: status,
    actorEmail: req.hqUser?.email,
    actorRole: req.hqUser?.role,
  });
  if (status === "approved") {
    void indexUploadedDocument(req.params.id, req.hqUser?.email).catch(() => undefined);
  }
  res.json({ document: await db.get("SELECT * FROM hq_documents WHERE id = ?", req.params.id) });
});

router.patch("/:id/archive", requireHQPermission("hq.documents", "hq.settings", "hq.executive"), async (req: Request, res: Response) => {
  const { archived } = req.body ?? {};
  const db = await getDb();
  const doc = await db.get("SELECT id FROM hq_documents WHERE id = ?", req.params.id);
  if (!doc) return res.status(404).json({ error: "Document not found" });
  const now = new Date().toISOString();
  const lifecycle = archived === false ? "active" : "archived";
  await db.run(
    `UPDATE hq_documents SET lifecycle_status = ?, updated_at = ? WHERE id = ?`,
    lifecycle,
    now,
    req.params.id
  );
  await logDocumentActivity({
    documentId: String(req.params.id),
    action: lifecycle === "archived" ? "archive" : "unarchive",
    actorEmail: req.hqUser?.email,
    actorRole: req.hqUser?.role,
  });
  res.json({ document: await db.get("SELECT * FROM hq_documents WHERE id = ?", req.params.id) });
});

export default router;
