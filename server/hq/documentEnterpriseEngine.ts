/**
 * Build 57 — Enterprise Document Management Suite
 * Central library helpers: taxonomy, search, activity audit, access, module links.
 */
import { getDb } from "../db";
import { docId, ensureDocumentTables } from "./documentsSchema";
import { toHQRole, type EnterpriseRole } from "./enterpriseRoles";

export type DocumentVisibility = "private" | "shared" | "department" | "organization";

export type DocumentSearchFilters = {
  q?: string;
  category?: string;
  department_id?: string;
  program_id?: string;
  project_id?: string;
  grant_id?: string;
  person_id?: string;
  file_type?: string;
  owner?: string;
  status?: string;
  access_level?: string;
  visibility?: string;
  tag?: string;
  source_module?: string;
  created_from?: string;
  created_to?: string;
  modified_from?: string;
  modified_to?: string;
  archived?: boolean;
  limit?: number;
};

export const MODULE_DOCUMENT_LINKS = [
  { id: "grants", label: "Grant Center", path: "/hq/grants", category: "grants" },
  { id: "executive", label: "Executive Dashboard", path: "/hq", category: "reports" },
  { id: "finance", label: "Finance", path: "/hq/finance", category: "financial" },
  { id: "hr", label: "HR / People", path: "/hq/people", category: "personnel" },
  { id: "programs", label: "Programs", path: "/hq/programs", category: "program_files" },
  { id: "compliance", label: "Compliance", path: "/hq/compliance", category: "policies" },
  { id: "board", label: "Board Portal", path: "/hq/board", category: "board_records" },
  { id: "contracts", label: "Contracts", path: "/hq/documents?category=contracts", category: "contracts" },
  { id: "reports", label: "Reports", path: "/hq/reports", category: "reports" },
] as const;

export function normalizeDocumentCategory(category: string | undefined | null): string {
  const raw = (category || "general").trim().toLowerCase();
  if (raw === "policy") return "policies";
  return raw || "general";
}

export function detectFileType(fileName: string, mimeType?: string | null): string {
  const mime = (mimeType || "").toLowerCase();
  const lower = fileName.toLowerCase();
  if (mime.includes("pdf") || lower.endsWith(".pdf")) return "pdf";
  if (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/.test(lower)) return "image";
  if (mime.startsWith("video/") || /\.(mp4|webm|mov|m4v)$/.test(lower)) return "video";
  if (mime.startsWith("audio/") || /\.(mp3|wav|ogg|m4a)$/.test(lower)) return "audio";
  if (mime.includes("spreadsheet") || mime.includes("excel") || /\.(xlsx?|csv)$/.test(lower)) return "spreadsheet";
  if (mime.includes("presentation") || mime.includes("powerpoint") || /\.(pptx?)$/.test(lower)) return "presentation";
  if (mime.includes("word") || /\.(docx?|rtf)$/.test(lower)) return "document";
  if (mime.includes("zip") || /\.(zip|rar|7z)$/.test(lower)) return "archive";
  if (mime.startsWith("text/") || lower.endsWith(".txt")) return "text";
  return "other";
}

export function canViewDocumentAccess(
  role: string,
  accessLevel: string,
  visibility: string | null | undefined,
  ownerEmail: string | null | undefined,
  userEmail: string | null | undefined,
  departmentId: string | null | undefined,
  userDepartmentId?: string | null
): boolean {
  const hqRole = toHQRole(role);
  const level = (accessLevel || "internal").toLowerCase();
  const vis = (visibility || "shared").toLowerCase();

  if (["founder", "executive", "administrator"].includes(hqRole)) return true;

  if (vis === "private") {
    return !!(ownerEmail && userEmail && ownerEmail.toLowerCase() === userEmail.toLowerCase());
  }

  if (vis === "department" && departmentId && userDepartmentId) {
    if (departmentId !== userDepartmentId && !["hr", "finance", "grant_manager"].includes(hqRole)) {
      return false;
    }
  }

  if (level === "internal") return true;
  if (level === "confidential" || level === "hr") {
    return ["hr", "finance", "grant_manager", "board_member", "program_director", "manager"].includes(hqRole);
  }
  if (level === "board") {
    return hqRole === "board_member";
  }
  return false;
}

export function canManageDocument(role: string): boolean {
  const hqRole = toHQRole(role);
  return ["founder", "executive", "administrator", "hr", "finance", "grant_manager", "program_director"].includes(hqRole);
}

export async function logDocumentActivity(input: {
  documentId: string;
  action: string;
  actorEmail?: string | null;
  actorRole?: string | null;
  detail?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    await ensureDocumentTables();
    const db = await getDb();
    const now = new Date().toISOString();
    await db.run(
      `INSERT INTO hq_document_activity (id, document_id, action, actor_email, actor_role, detail, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      docId(),
      input.documentId,
      input.action,
      input.actorEmail ?? null,
      input.actorRole ?? null,
      input.detail ?? null,
      input.metadata ? JSON.stringify(input.metadata).slice(0, 4000) : null,
      now
    );
  } catch (err) {
    console.warn("[documents] activity log failed:", err);
  }
}

export async function upsertSearchIndex(documentId: string): Promise<void> {
  try {
    await ensureDocumentTables();
    const db = await getDb();
    const doc = await db.get<{
      id: string;
      title: string;
      category: string;
      ocr_text: string | null;
      tags_json: string | null;
      labels_json: string | null;
      custom_metadata_json: string | null;
      file_type: string | null;
      program_id: string | null;
      project_id: string | null;
      owner_email: string | null;
      submitted_by: string | null;
    }>("SELECT * FROM hq_documents WHERE id = ?", documentId);
    if (!doc) return;

    let tags: string[] = [];
    let labels: string[] = [];
    try {
      tags = doc.tags_json ? (JSON.parse(doc.tags_json) as string[]) : [];
    } catch { /* ignore */ }
    try {
      labels = doc.labels_json ? (JSON.parse(doc.labels_json) as string[]) : [];
    } catch { /* ignore */ }

    const blob = [
      doc.title,
      doc.category,
      doc.file_type ?? "",
      doc.program_id ?? "",
      doc.project_id ?? "",
      doc.owner_email ?? "",
      doc.submitted_by ?? "",
      tags.join(" "),
      labels.join(" "),
      doc.ocr_text ?? "",
      doc.custom_metadata_json ?? "",
    ]
      .join(" ")
      .toLowerCase()
      .slice(0, 100_000);

    const now = new Date().toISOString();
    await db.run(`DELETE FROM hq_document_search_index WHERE document_id = ?`, documentId);
    await db.run(
      `INSERT INTO hq_document_search_index (document_id, search_blob, updated_at) VALUES (?, ?, ?)`,
      documentId,
      blob,
      now
    );
  } catch (err) {
    console.warn("[documents] search index upsert failed:", err);
  }
}

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export async function searchEnterpriseDocuments(
  filters: DocumentSearchFilters,
  role: string,
  userEmail?: string | null,
  userDepartmentId?: string | null
): Promise<{ documents: Record<string, unknown>[]; total: number; facets: Record<string, { value: string; count: number }[]> }> {
  await ensureDocumentTables();
  const db = await getDb();
  const q = (filters.q ?? "").trim().toLowerCase();
  const limit = Math.min(Math.max(filters.limit ?? 200, 1), 500);

  let sql = `
    SELECT d.*, dep.name as department_name,
      TRIM(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')) as owner_name,
      idx.search_blob
    FROM hq_documents d
    LEFT JOIN departments dep ON dep.id = d.department_id
    LEFT JOIN people p ON p.id = d.person_id
    LEFT JOIN hq_document_search_index idx ON idx.document_id = d.id
    WHERE 1=1`;
  const params: unknown[] = [];

  if (filters.archived) {
    sql += " AND d.lifecycle_status = 'archived'";
  } else {
    sql += " AND COALESCE(d.lifecycle_status, 'active') != 'archived'";
  }

  const category = filters.category ? normalizeDocumentCategory(filters.category) : "";
  if (category) {
    if (category === "policies") {
      sql += " AND (d.category = ? OR d.category = 'policy')";
      params.push(category);
    } else {
      sql += " AND d.category = ?";
      params.push(category);
    }
  }
  if (filters.department_id) {
    sql += " AND d.department_id = ?";
    params.push(filters.department_id);
  }
  if (filters.program_id) {
    sql += " AND d.program_id = ?";
    params.push(filters.program_id);
  }
  if (filters.project_id) {
    sql += " AND d.project_id = ?";
    params.push(filters.project_id);
  }
  if (filters.grant_id) {
    sql += " AND d.grant_id = ?";
    params.push(filters.grant_id);
  }
  if (filters.person_id) {
    sql += " AND d.person_id = ?";
    params.push(filters.person_id);
  }
  if (filters.file_type) {
    sql += " AND d.file_type = ?";
    params.push(filters.file_type);
  }
  if (filters.access_level) {
    sql += " AND d.access_level = ?";
    params.push(filters.access_level);
  }
  if (filters.visibility) {
    sql += " AND COALESCE(d.visibility, 'shared') = ?";
    params.push(filters.visibility);
  }
  if (filters.source_module) {
    sql += " AND d.source_module = ?";
    params.push(filters.source_module);
  }
  if (filters.status) {
    sql += " AND COALESCE(d.approval_status, 'approved') = ?";
    params.push(filters.status);
  }
  if (filters.owner) {
    sql += " AND (LOWER(COALESCE(d.owner_email, '')) LIKE ? OR LOWER(COALESCE(d.submitted_by, '')) LIKE ? OR LOWER(TRIM(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, ''))) LIKE ?)";
    const like = `%${filters.owner.toLowerCase()}%`;
    params.push(like, like, like);
  }
  if (filters.tag) {
    sql += " AND (d.tags_json LIKE ? OR d.labels_json LIKE ?)";
    const tagLike = `%"${filters.tag}"%`;
    params.push(tagLike, tagLike);
  }
  if (filters.created_from) {
    sql += " AND d.created_at >= ?";
    params.push(filters.created_from);
  }
  if (filters.created_to) {
    sql += " AND d.created_at <= ?";
    params.push(filters.created_to);
  }
  if (filters.modified_from) {
    sql += " AND d.updated_at >= ?";
    params.push(filters.modified_from);
  }
  if (filters.modified_to) {
    sql += " AND d.updated_at <= ?";
    params.push(filters.modified_to);
  }
  if (q) {
    sql += ` AND (
      LOWER(d.title) LIKE ? OR LOWER(d.category) LIKE ? OR LOWER(COALESCE(d.ocr_text, '')) LIKE ?
      OR LOWER(COALESCE(d.tags_json, '')) LIKE ? OR LOWER(COALESCE(d.labels_json, '')) LIKE ?
      OR LOWER(COALESCE(idx.search_blob, '')) LIKE ?
      OR LOWER(COALESCE(d.program_id, '')) LIKE ? OR LOWER(COALESCE(d.project_id, '')) LIKE ?
    )`;
    const like = `%${q}%`;
    params.push(like, like, like, like, like, like, like, like);
  }

  sql += " ORDER BY d.updated_at DESC LIMIT ?";
  params.push(limit);

  const rows = (await db.all(sql, ...params)) as Array<Record<string, unknown> & {
    access_level?: string;
    visibility?: string;
    owner_email?: string;
    department_id?: string;
    tags_json?: string;
    labels_json?: string;
  }>;

  const documents = rows
    .filter((d) =>
      canViewDocumentAccess(
        role,
        d.access_level ?? "internal",
        d.visibility,
        d.owner_email,
        userEmail,
        d.department_id,
        userDepartmentId
      )
    )
    .map((d) => {
      const { search_blob: _sb, ...rest } = d;
      return {
        ...rest,
        tags: parseJsonArray(d.tags_json),
        labels: parseJsonArray(d.labels_json),
      };
    });

  const facetCount = (key: string) => {
    const map = new Map<string, number>();
    for (const d of documents) {
      const raw = (d as Record<string, unknown>)[key];
      const value = String(raw ?? "—");
      map.set(value, (map.get(value) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);
  };

  const tagFacets = new Map<string, number>();
  for (const d of documents) {
    for (const t of (d.tags as string[]) ?? []) {
      tagFacets.set(t, (tagFacets.get(t) ?? 0) + 1);
    }
  }

  return {
    documents,
    total: documents.length,
    facets: {
      category: facetCount("category"),
      file_type: facetCount("file_type"),
      access_level: facetCount("access_level"),
      status: facetCount("approval_status"),
      department_id: facetCount("department_id"),
      tags: Array.from(tagFacets.entries())
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 30),
    },
  };
}

export async function buildDocumentLibraryOverview(role: string, userEmail?: string | null) {
  await ensureDocumentTables();
  const db = await getDb();
  const { documents, total, facets } = await searchEnterpriseDocuments({}, role, userEmail);
  const pending = documents.filter((d) => d.approval_status === "pending").length;
  const archived = (
    await db.get<{ c: number }>("SELECT COUNT(*) as c FROM hq_documents WHERE lifecycle_status = 'archived'")
  )?.c ?? 0;
  const byVisibility = await db.all(
    `SELECT COALESCE(visibility, 'shared') as visibility, COUNT(*) as count
     FROM hq_documents WHERE COALESCE(lifecycle_status, 'active') != 'archived'
     GROUP BY COALESCE(visibility, 'shared')`
  );
  const recentActivity = await db.all(
    `SELECT a.*, d.title as document_title
     FROM hq_document_activity a
     LEFT JOIN hq_documents d ON d.id = a.document_id
     ORDER BY a.created_at DESC LIMIT 25`
  );

  return {
    total,
    pendingApprovals: pending,
    archived,
    byCategory: facets.category.map((f) => ({ category: f.value, count: f.count })),
    facets,
    byVisibility,
    moduleLinks: MODULE_DOCUMENT_LINKS,
    recentActivity,
    indexed: (
      await db.get<{ c: number }>("SELECT COUNT(*) as c FROM hq_document_search_index")
    )?.c ?? 0,
  };
}

export async function getDocumentActivity(documentId: string, limit = 50) {
  await ensureDocumentTables();
  const db = await getDb();
  return db.all(
    `SELECT * FROM hq_document_activity WHERE document_id = ? ORDER BY created_at DESC LIMIT ?`,
    documentId,
    limit
  );
}

export async function buildModuleDocumentSnapshot(sourceModule: string, role: string, userEmail?: string | null) {
  const link = MODULE_DOCUMENT_LINKS.find((m) => m.id === sourceModule);
  const category = link?.category;
  const result = await searchEnterpriseDocuments(
    {
      category,
      source_module: sourceModule,
      limit: 50,
    },
    role,
    userEmail
  );
  // Also include category-matched docs even without source_module set
  const byCategory = category
    ? await searchEnterpriseDocuments({ category, limit: 50 }, role, userEmail)
    : { documents: [], total: 0 };
  const merged = new Map<string, Record<string, unknown>>();
  for (const d of [...result.documents, ...byCategory.documents]) {
    merged.set(String(d.id), d);
  }
  return {
    module: sourceModule,
    label: link?.label ?? sourceModule,
    path: link?.path ?? "/hq/documents",
    documents: Array.from(merged.values()).slice(0, 50),
    total: merged.size,
  };
}

/** Roles that may open the enterprise document module */
export const DOCUMENT_MODULE_ROLES: EnterpriseRole[] = [
  "founder",
  "executive",
  "administrator",
  "hr",
  "finance",
  "program_director",
  "manager",
  "board_member",
  "grant_manager",
  "employee",
];
