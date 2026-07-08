/**
 * IFCDC Organizational Knowledge Base — AURA's institutional memory.
 *
 * A secure, embedded knowledge base that indexes IFCDC's real organizational
 * documents (budgets, financial reports, program descriptions, org profile,
 * registration data, prior approved narratives, policies) so AURA retrieves
 * grounded IFCDC facts BEFORE generating any grant content. Uses OpenAI
 * embeddings stored in SQLite (JSON vectors + in-process cosine similarity),
 * with a keyword fallback when embeddings are unavailable — no new services.
 *
 * Documents are versioned: ingesting a newer approved version of the same
 * source supersedes the prior one, so AURA always uses the latest approved data.
 */
import crypto from "crypto";
import { getDb } from "../db";
import { auraEmbed, auraEmbeddingsConfigured } from "../lib/ifcdc";
import { IFCDC_ORG_PROFILE } from "./grantWriterEngine";
import { logHqAudit } from "./hqAuditLog";

export function kbId(): string {
  return crypto.randomUUID();
}

/** High-level source classification for every knowledge item. */
export type KnowledgeSourceType =
  | "org_profile"
  | "program_description"
  | "operating_budget"
  | "program_budget"
  | "hr_budget"
  | "financial_report"
  | "registration"
  | "prior_narrative"
  | "grant_template"
  | "policy"
  | "annual_report"
  | "strategic_plan"
  | "board_resolution"
  | "grant_document"
  | "document";

/** Retrieval categories used to scope searches per grant section. */
export type KnowledgeCategory =
  | "organization"
  | "programs"
  | "financial"
  | "registration"
  | "narratives"
  | "compliance"
  | "policies";

const SOURCE_CATEGORY: Record<KnowledgeSourceType, KnowledgeCategory> = {
  org_profile: "organization",
  program_description: "programs",
  operating_budget: "financial",
  program_budget: "financial",
  hr_budget: "financial",
  financial_report: "financial",
  registration: "registration",
  prior_narrative: "narratives",
  grant_template: "narratives",
  policy: "policies",
  annual_report: "financial",
  strategic_plan: "organization",
  board_resolution: "compliance",
  grant_document: "narratives",
  document: "organization",
};

/** Which knowledge categories ground each grant writer section. */
const SECTION_CATEGORIES: Record<string, KnowledgeCategory[]> = {
  executive_summary: ["organization", "programs", "financial", "narratives"],
  need_statement: ["programs", "organization", "narratives"],
  project_description: ["programs", "narratives"],
  goals_objectives: ["programs", "narratives"],
  methods: ["programs", "narratives"],
  evaluation: ["programs", "narratives"],
  sustainability: ["financial", "organization", "narratives"],
  organizational_capacity: ["organization", "registration", "financial", "narratives"],
  budget_narrative: ["financial", "narratives"],
  attachments_checklist: ["registration", "compliance", "organization"],
};

const DEFAULT_CATEGORIES: KnowledgeCategory[] = ["organization", "programs", "financial", "narratives"];

const CHUNK_CHARS = 1200;
const CHUNK_OVERLAP = 150;
const EMBED_MODEL_DIMS_HINT = 1536; // text-embedding-3-small

async function safeAll<T>(sql: string, ...params: unknown[]): Promise<T[]> {
  try {
    const db = await getDb();
    return (await db.all(sql, ...params)) as T[];
  } catch {
    return [];
  }
}

export async function ensureKnowledgeBaseTables(): Promise<void> {
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS hq_knowledge_documents (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      source_key TEXT NOT NULL,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      content TEXT NOT NULL,
      summary TEXT,
      version INTEGER DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'approved',
      effective_date TEXT,
      origin TEXT DEFAULT 'import',
      source_ref TEXT,
      checksum TEXT,
      token_estimate INTEGER DEFAULT 0,
      chunk_count INTEGER DEFAULT 0,
      embedded INTEGER DEFAULT 0,
      created_by TEXT,
      approved_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_kb_docs_key ON hq_knowledge_documents(source_key, status);
    CREATE INDEX IF NOT EXISTS idx_kb_docs_type ON hq_knowledge_documents(source_type, status);
    CREATE INDEX IF NOT EXISTS idx_kb_docs_cat ON hq_knowledge_documents(category, status);

    CREATE TABLE IF NOT EXISTS hq_knowledge_chunks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      embedding TEXT,
      token_estimate INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (document_id) REFERENCES hq_knowledge_documents(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_kb_chunks_doc ON hq_knowledge_chunks(document_id);

    CREATE TABLE IF NOT EXISTS hq_knowledge_sync_log (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      ingested INTEGER DEFAULT 0,
      skipped INTEGER DEFAULT 0,
      embedded_chunks INTEGER DEFAULT 0,
      detail TEXT,
      actor_email TEXT
    );
  `);
}

function checksumOf(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Split text into overlapping chunks along paragraph/sentence boundaries. */
export function chunkText(text: string, maxChars = CHUNK_CHARS, overlap = CHUNK_OVERLAP): string[] {
  const clean = (text ?? "").replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const paragraphs = clean.split(/\n{2,}/);
  const chunks: string[] = [];
  let buffer = "";

  const flush = () => {
    if (buffer.trim()) chunks.push(buffer.trim());
    buffer = "";
  };

  for (const para of paragraphs) {
    if (para.length > maxChars) {
      flush();
      // Hard-split oversized paragraphs.
      for (let i = 0; i < para.length; i += maxChars - overlap) {
        chunks.push(para.slice(i, i + maxChars).trim());
      }
      continue;
    }
    if ((buffer + "\n\n" + para).length > maxChars) {
      flush();
      buffer = para;
    } else {
      buffer = buffer ? `${buffer}\n\n${para}` : para;
    }
  }
  flush();
  return chunks.filter(Boolean);
}

function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  if (!len) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

export interface IngestKnowledgeInput {
  sourceType: KnowledgeSourceType;
  /** Stable identity for versioning. Defaults to `${sourceType}:${title}`. */
  sourceKey?: string;
  title: string;
  content: string;
  summary?: string;
  effectiveDate?: string;
  origin?: "import" | "upload" | "manual";
  sourceRef?: string;
  status?: "approved" | "draft";
  createdBy?: string;
  /** Generate embeddings now (default: true when configured). */
  embed?: boolean;
}

export interface IngestResult {
  id: string | null;
  status: "ingested" | "skipped_unchanged" | "empty";
  version: number;
  chunks: number;
  embedded: boolean;
}

/**
 * Ingest (or version) a knowledge document. If the content matches the latest
 * approved version for the same source key, it is skipped. Otherwise a new
 * version is stored and the prior approved version is superseded.
 */
export async function ingestKnowledgeDocument(input: IngestKnowledgeInput): Promise<IngestResult> {
  await ensureKnowledgeBaseTables();
  const db = await getDb();

  const content = (input.content ?? "").trim();
  if (!content) return { id: null, status: "empty", version: 0, chunks: 0, embedded: false };

  const sourceKey = input.sourceKey?.trim() || `${input.sourceType}:${input.title.trim()}`;
  const checksum = checksumOf(content);
  const status = input.status ?? "approved";

  const latest = await db.get<{ id: string; version: number; checksum: string; embedded: number }>(
    `SELECT id, version, checksum, embedded FROM hq_knowledge_documents
     WHERE source_key = ? AND status IN ('approved','draft')
     ORDER BY version DESC LIMIT 1`,
    sourceKey
  );

  if (latest && latest.checksum === checksum) {
    return { id: latest.id, status: "skipped_unchanged", version: latest.version, chunks: 0, embedded: latest.embedded === 1 };
  }

  const now = new Date().toISOString();
  const version = (latest?.version ?? 0) + 1;
  const id = kbId();
  const category = SOURCE_CATEGORY[input.sourceType] ?? "organization";
  const chunks = chunkText(content);

  // Supersede prior approved version so retrieval only sees the newest.
  if (latest) {
    await db.run(
      `UPDATE hq_knowledge_documents SET status = 'superseded', updated_at = ? WHERE source_key = ? AND status IN ('approved','draft')`,
      now,
      sourceKey
    );
  }

  await db.run(
    `INSERT INTO hq_knowledge_documents
      (id, source_type, source_key, title, category, content, summary, version, status, effective_date, origin, source_ref, checksum, token_estimate, chunk_count, embedded, created_by, approved_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    id,
    input.sourceType,
    sourceKey,
    input.title.trim(),
    category,
    content,
    input.summary ?? null,
    version,
    status,
    input.effectiveDate ?? null,
    input.origin ?? "import",
    input.sourceRef ?? null,
    checksum,
    estimateTokens(content),
    chunks.length,
    input.createdBy ?? null,
    status === "approved" ? input.createdBy ?? "system" : null,
    now,
    now
  );

  let embeddedCount = 0;
  const wantEmbed = input.embed ?? true;
  const canEmbed = wantEmbed && auraEmbeddingsConfigured();

  for (let i = 0; i < chunks.length; i++) {
    const chunkIdText = kbId();
    let embeddingJson: string | null = null;
    if (canEmbed) {
      try {
        const vector = await auraEmbed(chunks[i]);
        if (vector.length) {
          embeddingJson = JSON.stringify(vector);
          embeddedCount++;
        }
      } catch (err) {
        // Best-effort: fall back to keyword retrieval for this chunk.
        console.warn(`[knowledge] embed failed for ${sourceKey} chunk ${i}:`, err instanceof Error ? err.message : err);
      }
    }
    await db.run(
      `INSERT INTO hq_knowledge_chunks (id, document_id, chunk_index, content, embedding, token_estimate, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      chunkIdText,
      id,
      i,
      chunks[i],
      embeddingJson,
      estimateTokens(chunks[i]),
      now
    );
  }

  const embedded = embeddedCount > 0 && embeddedCount === chunks.length;
  await db.run(`UPDATE hq_knowledge_documents SET embedded = ? WHERE id = ?`, embedded ? 1 : 0, id);

  return { id, status: "ingested", version, chunks: chunks.length, embedded };
}

export interface RetrievedChunk {
  documentId: string;
  title: string;
  sourceType: string;
  category: string;
  version: number;
  effectiveDate: string | null;
  content: string;
  score: number;
  matchType: "semantic" | "keyword";
}

interface ChunkRow {
  id: string;
  document_id: string;
  content: string;
  embedding: string | null;
  title: string;
  source_type: string;
  category: string;
  version: number;
  effective_date: string | null;
}

/** Retrieve the most relevant approved knowledge chunks for a query. */
export async function retrieveKnowledge(
  query: string,
  opts?: { categories?: KnowledgeCategory[]; topK?: number; minScore?: number }
): Promise<RetrievedChunk[]> {
  await ensureKnowledgeBaseTables();
  const q = (query ?? "").trim();
  if (!q) return [];
  const topK = opts?.topK ?? 6;
  const categories = opts?.categories;

  const catFilter = categories?.length
    ? ` AND d.category IN (${categories.map(() => "?").join(",")})`
    : "";
  const baseSql = `
    SELECT c.id, c.document_id, c.content, c.embedding,
           d.title, d.source_type, d.category, d.version, d.effective_date
    FROM hq_knowledge_chunks c
    JOIN hq_knowledge_documents d ON d.id = c.document_id
    WHERE d.status = 'approved'`;

  // Attempt semantic retrieval first.
  let queryVector: number[] = [];
  if (auraEmbeddingsConfigured()) {
    try {
      queryVector = await auraEmbed(q);
    } catch {
      queryVector = [];
    }
  }

  if (queryVector.length) {
    const rows = await safeAll<ChunkRow>(`${baseSql}${catFilter} AND c.embedding IS NOT NULL`, ...(categories ?? []));
    if (rows.length) {
      const scored = rows
        .map((r) => {
          let vec: number[] = [];
          try {
            vec = JSON.parse(r.embedding as string) as number[];
          } catch {
            vec = [];
          }
          return { r, score: cosineSimilarity(queryVector, vec) };
        })
        .filter((s) => s.score >= (opts?.minScore ?? 0.15))
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
      if (scored.length) {
        return scored.map(({ r, score }) => ({
          documentId: r.document_id,
          title: r.title,
          sourceType: r.source_type,
          category: r.category,
          version: r.version,
          effectiveDate: r.effective_date,
          content: r.content,
          score,
          matchType: "semantic" as const,
        }));
      }
    }
  }

  // Keyword fallback (also covers not-yet-embedded chunks).
  const terms = q
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 3)
    .slice(0, 8);
  const rows = await safeAll<ChunkRow>(`${baseSql}${catFilter} ORDER BY d.updated_at DESC LIMIT 400`, ...(categories ?? []));
  const scored = rows
    .map((r) => {
      const lower = r.content.toLowerCase();
      const score = terms.reduce((acc, t) => acc + (lower.includes(t) ? 1 : 0), 0) / (terms.length || 1);
      return { r, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return scored.map(({ r, score }) => ({
    documentId: r.document_id,
    title: r.title,
    sourceType: r.source_type,
    category: r.category,
    version: r.version,
    effectiveDate: r.effective_date,
    content: r.content,
    score,
    matchType: "keyword" as const,
  }));
}

/**
 * Build the grounding block AURA reads before writing a grant section.
 * Retrieves the correct IFCDC organizational data for the section and formats
 * it with source citations so narratives stay consistent across proposals.
 */
export async function buildGrantGroundingContext(opts: {
  sectionKey?: string;
  application?: Record<string, unknown> | null;
  opportunity?: Record<string, unknown> | null;
}): Promise<string> {
  try {
    await ensureKnowledgeBaseTables();
    const categories = opts.sectionKey ? SECTION_CATEGORIES[opts.sectionKey] ?? DEFAULT_CATEGORIES : DEFAULT_CATEGORIES;

    const queryParts = [
      opts.sectionKey ? opts.sectionKey.replace(/_/g, " ") : "grant proposal",
      String(opts.application?.title ?? ""),
      String(opts.application?.matched_program_slug ?? ""),
      String(opts.opportunity?.title ?? ""),
      String(opts.opportunity?.agency ?? opts.opportunity?.funder ?? ""),
    ].filter(Boolean);
    const query = queryParts.join(" — ") || "IFCDC organizational profile and programs";

    const results = await retrieveKnowledge(query, { categories, topK: 6 });
    if (!results.length) return "";

    const lines = [
      "=== IFCDC KNOWLEDGE BASE (RETRIEVED SOURCES — GROUND ALL FACTS IN THESE) ===",
      "Use these verified IFCDC organizational records as the source of truth. Cite figures and program facts from here; do not invent numbers.",
      "",
    ];
    results.forEach((r, idx) => {
      const label = `${r.title} (${r.sourceType}${r.effectiveDate ? `, ${r.effectiveDate}` : ""}, v${r.version})`;
      lines.push(`[Source ${idx + 1}] ${label}`);
      lines.push(r.content.slice(0, 1400).trim());
      lines.push("");
    });
    lines.push("=== END KNOWLEDGE BASE SOURCES ===");
    return lines.join("\n");
  } catch (err) {
    console.warn("[knowledge] grounding context failed:", err instanceof Error ? err.message : err);
    return "";
  }
}

// ---------------------------------------------------------------------------
// Ingestion from live HQ data sources
// ---------------------------------------------------------------------------

function orgProfileText(): string {
  const p = IFCDC_ORG_PROFILE;
  return [
    `Legal name: ${p.legalName}`,
    `Status / EIN: ${p.ein}`,
    `Location / service area: ${p.location}`,
    `Mission: ${p.mission}`,
    `Vision: ${p.vision}`,
    p.samUei ? `SAM.gov UEI: ${p.samUei}` : "SAM.gov UEI: not configured",
    `Programs & divisions: ${p.divisions.join("; ")}`,
  ].join("\n");
}

/** Sync all live HQ data sources into the knowledge base. Idempotent. */
export async function syncKnowledgeBaseFromHq(opts?: { embed?: boolean; actorEmail?: string }): Promise<{
  ingested: number;
  skipped: number;
  bySource: Record<string, number>;
  logId: string;
}> {
  await ensureKnowledgeBaseTables();
  const db = await getDb();
  const embed = opts?.embed ?? true;
  const logId = kbId();
  const startedAt = new Date().toISOString();
  await db.run(
    `INSERT INTO hq_knowledge_sync_log (id, started_at, status, actor_email) VALUES (?, ?, 'running', ?)`,
    logId,
    startedAt,
    opts?.actorEmail ?? "system"
  );

  let ingested = 0;
  let skipped = 0;
  let embeddedChunks = 0;
  const bySource: Record<string, number> = {};

  const record = async (input: IngestKnowledgeInput) => {
    try {
      const res = await ingestKnowledgeDocument({ ...input, embed });
      if (res.status === "ingested") {
        ingested++;
        bySource[input.sourceType] = (bySource[input.sourceType] ?? 0) + 1;
        if (res.embedded) embeddedChunks += res.chunks;
      } else if (res.status === "skipped_unchanged") {
        skipped++;
      }
    } catch (err) {
      console.warn(`[knowledge] sync ${input.sourceType} failed:`, err instanceof Error ? err.message : err);
    }
  };

  // 1. Organizational profile (mission, vision, history, divisions).
  await record({
    sourceType: "org_profile",
    sourceKey: "org_profile:ifcdc",
    title: "IFCDC Organizational Profile",
    content: orgProfileText(),
    origin: "import",
  });

  // 2. Registration data (SAM.gov / Grants.gov / 501(c)(3)).
  try {
    const feed = await db
      .get<{ last_status: string; last_sync_at: string; error_message: string | null }>(
        "SELECT last_status, last_sync_at, error_message FROM grant_feed_sync WHERE provider = 'sam_gov' LIMIT 1"
      )
      .catch(() => null);
    const regText = [
      `Legal entity: ${IFCDC_ORG_PROFILE.legalName}`,
      `Tax status: ${IFCDC_ORG_PROFILE.ein}`,
      IFCDC_ORG_PROFILE.samUei ? `SAM.gov UEI: ${IFCDC_ORG_PROFILE.samUei}` : "SAM.gov UEI: not configured",
      feed ? `SAM.gov registration status: ${feed.last_status}${feed.error_message ? ` (${feed.error_message})` : ""}, last checked ${feed.last_sync_at}` : "SAM.gov sync status: unknown",
      "Grants.gov: organization eligible to apply for federal opportunities via Grants.gov.",
    ].join("\n");
    await record({
      sourceType: "registration",
      sourceKey: "registration:ifcdc",
      title: "IFCDC Registration & Nonprofit Status (SAM.gov / Grants.gov / 501(c)(3))",
      content: regText,
      origin: "import",
    });
  } catch { /* optional */ }

  // 3. Program descriptions.
  const programs = await safeAll<{ slug: string; name: string; description: string; status: string; budget_allocated: number; budget_spent: number }>(
    "SELECT slug, name, description, status, budget_allocated, budget_spent FROM hq_program_registry ORDER BY name"
  );
  for (const prog of programs) {
    const text = [
      `Program: ${prog.name} (${prog.slug})`,
      `Status: ${prog.status}`,
      prog.description ? `Description: ${prog.description}` : "",
      prog.budget_allocated ? `Allocated budget: $${Number(prog.budget_allocated).toLocaleString()}; spent to date: $${Number(prog.budget_spent ?? 0).toLocaleString()}.` : "",
    ]
      .filter(Boolean)
      .join("\n");
    await record({
      sourceType: "program_description",
      sourceKey: `program:${prog.slug}`,
      title: `IFCDC Program — ${prog.name}`,
      content: text,
      origin: "import",
    });
  }

  // 4. Operating & program budgets + HR/staffing budget.
  const budgets = await safeAll<{ name: string; category: string; fiscal_year: string; allocated: number; spent: number; notes: string | null }>(
    "SELECT name, category, fiscal_year, allocated, spent, notes FROM finance_budgets ORDER BY fiscal_year DESC, allocated DESC"
  );
  if (budgets.length) {
    const line = (b: (typeof budgets)[number]) =>
      `- ${b.name} [${b.category}] FY${b.fiscal_year}: allocated $${Number(b.allocated).toLocaleString()}, spent $${Number(b.spent ?? 0).toLocaleString()}${b.notes ? ` — ${b.notes}` : ""}`;
    await record({
      sourceType: "operating_budget",
      sourceKey: "operating_budget:master",
      title: "IFCDC Master Operating Budget (all budget lines)",
      content: ["IFCDC operating budget — all budget lines across fiscal years:", ...budgets.map(line)].join("\n"),
      origin: "import",
    });

    const hrCategories = ["payroll", "personnel", "salaries", "salary", "staffing", "hr", "wages", "fringe", "benefits"];
    const hrBudgets = budgets.filter((b) => hrCategories.some((c) => (b.category ?? "").toLowerCase().includes(c) || (b.name ?? "").toLowerCase().includes(c)));
    if (hrBudgets.length) {
      await record({
        sourceType: "hr_budget",
        sourceKey: "hr_budget:master",
        title: "IFCDC HR & Staffing Budget",
        content: ["IFCDC HR / staffing / personnel budget lines:", ...hrBudgets.map(line)].join("\n"),
        origin: "import",
      });
    }
  }

  // 5. Financial reports / statements.
  const reports = await safeAll<{ period: string; report_type: string; total_revenue_cents: number; total_expense_cents: number; deductible_cents: number; status: string; filed_at: string | null }>(
    "SELECT period, report_type, total_revenue_cents, total_expense_cents, deductible_cents, status, filed_at FROM finance_tax_reports ORDER BY period DESC LIMIT 24"
  );
  if (reports.length) {
    const line = (r: (typeof reports)[number]) =>
      `- ${r.period} ${r.report_type} [${r.status}${r.filed_at ? `, filed ${r.filed_at}` : ""}]: revenue $${(r.total_revenue_cents / 100).toLocaleString()}, expenses $${(r.total_expense_cents / 100).toLocaleString()}, deductible $${(r.deductible_cents / 100).toLocaleString()}`;
    await record({
      sourceType: "financial_report",
      sourceKey: "financial_report:summary",
      title: "IFCDC Organizational Financial Reports",
      content: ["IFCDC financial reports and statements:", ...reports.map(line)].join("\n"),
      origin: "import",
    });
  }

  // 6. Prior founder-approved grant narratives (executive summaries, needs, capacity, etc.).
  const narratives = await safeAll<{ application_id: string; section_key: string; section_label: string; content: string; app_title: string; slug: string | null }>(
    `SELECT ws.application_id, ws.section_key, ws.section_label, ws.content, a.title AS app_title, a.matched_program_slug AS slug
     FROM grant_writer_sections ws
     JOIN grant_applications a ON a.id = ws.application_id
     WHERE a.founder_approval_status = 'approved' AND LENGTH(ws.content) > 200
     ORDER BY ws.updated_at DESC LIMIT 60`
  );
  const NARRATIVE_TYPE: Record<string, KnowledgeSourceType> = {
    executive_summary: "prior_narrative",
    need_statement: "prior_narrative",
    organizational_capacity: "prior_narrative",
    evaluation: "prior_narrative",
    sustainability: "prior_narrative",
    budget_narrative: "prior_narrative",
    attachments_checklist: "prior_narrative",
  };
  for (const n of narratives) {
    await record({
      sourceType: NARRATIVE_TYPE[n.section_key] ?? "prior_narrative",
      sourceKey: `narrative:${n.application_id}:${n.section_key}`,
      title: `Approved narrative — ${n.section_label} (${n.app_title})`,
      content: `Section: ${n.section_label}\nProgram: ${n.slug ?? "n/a"}\n\n${n.content}`,
      origin: "import",
      sourceRef: n.application_id,
    });
  }

  // 7. Grant library templates.
  const templates = await safeAll<{ slug: string; title: string; category: string; description: string | null; content: string | null }>(
    "SELECT slug, title, category, description, content FROM grant_templates WHERE is_active = 1 ORDER BY usage_count DESC LIMIT 30"
  );
  for (const t of templates) {
    const body = [t.description ? `Description: ${t.description}` : "", t.content ?? ""].filter(Boolean).join("\n\n");
    if (!body.trim()) continue;
    await record({
      sourceType: "grant_template",
      sourceKey: `template:${t.slug}`,
      title: `Grant library — ${t.title} (${t.category})`,
      content: body,
      origin: "import",
    });
  }

  // 8. Document vault (approved documents with extracted/OCR text): policies,
  //    annual reports, strategic plans, board resolutions, 501(c)(3) docs, etc.
  const docs = await safeAll<{ id: string; title: string; category: string; ocr_text: string | null; updated_at: string }>(
    `SELECT id, title, category, ocr_text, updated_at FROM hq_documents
     WHERE COALESCE(lifecycle_status,'active') != 'archived'
       AND COALESCE(approval_status,'approved') = 'approved'
       AND ocr_text IS NOT NULL AND LENGTH(ocr_text) > 40
     ORDER BY updated_at DESC LIMIT 100`
  );
  for (const d of docs) {
    await record({
      sourceType: documentSourceType(d.category, d.title),
      sourceKey: `document:${d.id}`,
      title: d.title,
      content: `${d.title} (${d.category})\n\n${d.ocr_text}`,
      origin: "upload",
      sourceRef: d.id,
      effectiveDate: d.updated_at?.slice(0, 10),
    });
  }

  const finishedAt = new Date().toISOString();
  await db.run(
    `UPDATE hq_knowledge_sync_log SET finished_at = ?, status = 'completed', ingested = ?, skipped = ?, embedded_chunks = ?, detail = ? WHERE id = ?`,
    finishedAt,
    ingested,
    skipped,
    embeddedChunks,
    JSON.stringify(bySource),
    logId
  );

  await logHqAudit({
    action: "knowledge_base_sync",
    entityType: "knowledge_base",
    entityId: logId,
    detail: `ingested ${ingested}, skipped ${skipped}, embedded chunks ${embeddedChunks}`,
    actorEmail: opts?.actorEmail,
  }).catch(() => undefined);

  return { ingested, skipped, bySource, logId };
}

/** Map a document vault category/title to a knowledge source type. */
function documentSourceType(category: string, title: string): KnowledgeSourceType {
  const c = `${category ?? ""} ${title ?? ""}`.toLowerCase();
  if (/(annual report)/.test(c)) return "annual_report";
  if (/(strategic plan)/.test(c)) return "strategic_plan";
  if (/(board resolution|board minutes|resolution)/.test(c)) return "board_resolution";
  if (/(budget)/.test(c)) return "operating_budget";
  if (/(financial|statement|audit|990|tax)/.test(c)) return "financial_report";
  if (/(501|determination|irs|nonprofit|sam\.gov|registration)/.test(c)) return "registration";
  if (/(policy|policies|procedure|handbook)/.test(c)) return "policy";
  if (/(grant|narrative|proposal|program)/.test(c)) return "grant_document";
  return "document";
}

/** Index a single uploaded document into the knowledge base (auto-learn). */
export async function indexUploadedDocument(documentId: string, actorEmail?: string): Promise<IngestResult | null> {
  try {
    await ensureKnowledgeBaseTables();
    const db = await getDb();
    const doc = await db.get<{ id: string; title: string; category: string; ocr_text: string | null; approval_status: string | null; lifecycle_status: string | null; updated_at: string }>(
      "SELECT id, title, category, ocr_text, approval_status, lifecycle_status, updated_at FROM hq_documents WHERE id = ?",
      documentId
    );
    if (!doc) return null;
    if ((doc.lifecycle_status ?? "active") === "archived") return null;

    // Prefer extracted text; fall back to title/category so the doc is discoverable.
    const body = doc.ocr_text && doc.ocr_text.trim().length > 40 ? doc.ocr_text : `${doc.title} (${doc.category})`;
    const res = await ingestKnowledgeDocument({
      sourceType: documentSourceType(doc.category, doc.title),
      sourceKey: `document:${doc.id}`,
      title: doc.title,
      content: `${doc.title} (${doc.category})\n\n${body}`,
      origin: "upload",
      sourceRef: doc.id,
      effectiveDate: doc.updated_at?.slice(0, 10),
      status: (doc.approval_status ?? "approved") === "approved" ? "approved" : "draft",
      createdBy: actorEmail,
    });
    await logHqAudit({
      action: "knowledge_base_index_upload",
      entityType: "knowledge_document",
      entityId: doc.id,
      detail: `${doc.title} → ${res.status} (v${res.version})`,
      actorEmail,
    }).catch(() => undefined);
    return res;
  } catch (err) {
    console.warn("[knowledge] indexUploadedDocument failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Read / management APIs
// ---------------------------------------------------------------------------

export async function getKnowledgeBaseStatus() {
  await ensureKnowledgeBaseTables();
  const db = await getDb();
  const totals = await db
    .get<{ total: number; embedded: number; chunks: number }>(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN embedded = 1 THEN 1 ELSE 0 END) AS embedded,
              COALESCE(SUM(chunk_count),0) AS chunks
       FROM hq_knowledge_documents WHERE status = 'approved'`
    )
    .catch(() => ({ total: 0, embedded: 0, chunks: 0 }));
  const bySource = await safeAll<{ source_type: string; count: number }>(
    "SELECT source_type, COUNT(*) AS count FROM hq_knowledge_documents WHERE status = 'approved' GROUP BY source_type ORDER BY count DESC"
  );
  const byCategory = await safeAll<{ category: string; count: number }>(
    "SELECT category, COUNT(*) AS count FROM hq_knowledge_documents WHERE status = 'approved' GROUP BY category ORDER BY count DESC"
  );
  const lastSync = await db
    .get<{ finished_at: string; status: string; ingested: number; skipped: number; embedded_chunks: number }>(
      "SELECT finished_at, status, ingested, skipped, embedded_chunks FROM hq_knowledge_sync_log ORDER BY started_at DESC LIMIT 1"
    )
    .catch(() => null);
  return {
    total: totals?.total ?? 0,
    embedded: totals?.embedded ?? 0,
    chunks: totals?.chunks ?? 0,
    embeddingsConfigured: auraEmbeddingsConfigured(),
    bySource,
    byCategory,
    lastSync,
  };
}

export async function listKnowledgeDocuments(filter?: { sourceType?: string; q?: string; status?: string }) {
  await ensureKnowledgeBaseTables();
  const params: unknown[] = [];
  let sql =
    "SELECT id, source_type, source_key, title, category, summary, version, status, effective_date, origin, source_ref, token_estimate, chunk_count, embedded, updated_at FROM hq_knowledge_documents WHERE 1=1";
  const status = filter?.status ?? "approved";
  if (status !== "all") {
    sql += " AND status = ?";
    params.push(status);
  }
  if (filter?.sourceType) {
    sql += " AND source_type = ?";
    params.push(filter.sourceType);
  }
  if (filter?.q) {
    sql += " AND (title LIKE ? OR content LIKE ?)";
    params.push(`%${filter.q}%`, `%${filter.q}%`);
  }
  sql += " ORDER BY updated_at DESC LIMIT 200";
  return safeAll(sql, ...params);
}

export async function getKnowledgeDocument(id: string) {
  await ensureKnowledgeBaseTables();
  const db = await getDb();
  return db.get("SELECT * FROM hq_knowledge_documents WHERE id = ?", id);
}

export async function approveKnowledgeDocument(id: string, actorEmail?: string) {
  await ensureKnowledgeBaseTables();
  const db = await getDb();
  const doc = await db.get<{ source_key: string }>("SELECT source_key FROM hq_knowledge_documents WHERE id = ?", id);
  if (!doc) return null;
  const now = new Date().toISOString();
  // Supersede any other approved versions of the same source before promoting.
  await db.run(
    `UPDATE hq_knowledge_documents SET status = 'superseded', updated_at = ? WHERE source_key = ? AND status = 'approved' AND id != ?`,
    now,
    doc.source_key,
    id
  );
  await db.run(
    `UPDATE hq_knowledge_documents SET status = 'approved', approved_by = ?, updated_at = ? WHERE id = ?`,
    actorEmail ?? "founder",
    now,
    id
  );
  await logHqAudit({ action: "knowledge_document_approved", entityType: "knowledge_document", entityId: id, actorEmail }).catch(() => undefined);
  return db.get("SELECT * FROM hq_knowledge_documents WHERE id = ?", id);
}

export async function supersedeKnowledgeDocument(id: string, actorEmail?: string) {
  await ensureKnowledgeBaseTables();
  const db = await getDb();
  const now = new Date().toISOString();
  await db.run(`UPDATE hq_knowledge_documents SET status = 'superseded', updated_at = ? WHERE id = ?`, now, id);
  await logHqAudit({ action: "knowledge_document_superseded", entityType: "knowledge_document", entityId: id, actorEmail }).catch(() => undefined);
  return db.get("SELECT * FROM hq_knowledge_documents WHERE id = ?", id);
}

export { EMBED_MODEL_DIMS_HINT };
