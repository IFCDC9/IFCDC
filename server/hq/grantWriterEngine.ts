/**
 * Grant Writer Studio — production AURA pipeline with live org data, Grants.gov context,
 * version history, and async full-proposal generation (avoids client timeouts).
 */
import { getDb } from "../db";
import { grantId, logGrantActivity } from "./grantsSchema";
import { auraExecutiveChat } from "../lib/ifcdc";
import { resolveOpenAiCredentials, formatOpenAiAuthError, type ResolvedOpenAiCredentials } from "../lib/openaiConfig";
import { buildAuraExecutiveContext } from "./auraExecutiveContext";
import { IFCDC_FUNDING_DIVISIONS } from "./grantFundingEngine";
import { logHqAudit } from "./hqAuditLog";

const WRITER_SECTION_KEYS = [
  "executive_summary",
  "need_statement",
  "project_description",
  "goals_objectives",
  "methods",
  "evaluation",
  "sustainability",
  "organizational_capacity",
  "budget_narrative",
  "attachments_checklist",
] as const;

const WRITER_SECTION_LABELS: Record<string, string> = {
  executive_summary: "Executive Summary",
  need_statement: "Statement of Need",
  project_description: "Project Description",
  goals_objectives: "Goals & Objectives",
  methods: "Methods & Activities",
  evaluation: "Evaluation Plan",
  sustainability: "Sustainability",
  organizational_capacity: "Organizational Capacity",
  budget_narrative: "Budget Narrative",
  attachments_checklist: "Attachments Checklist",
};

function searchHeaders(): Record<string, string> {
  return { "Content-Type": "application/json", Accept: "application/json" };
}

export const GRANT_AI_TIMEOUT_MS = 90_000;

export const IFCDC_ORG_PROFILE = {
  legalName: "Imperial Foundation Community Development Corporation (IFCDC)",
  ein: process.env.IFCDC_EIN ?? "501(c)(3) nonprofit",
  location: "Asbury Park / Monmouth County, New Jersey",
  mission:
    "Advance community development, economic empowerment, mentorship, workforce training, housing stability, and inclusive services across IFCDC programs and the Software Division.",
  vision:
    "A self-sustaining community development ecosystem where residents access housing, education, employment, health, and technology through coordinated IFCDC programs.",
  samUei: process.env.SAM_GOV_UEI ?? process.env.IFCDC_SAM_UEI ?? null,
  divisions: IFCDC_FUNDING_DIVISIONS.map((d) => `${d.label} (${d.slug})`),
};

export const SECTION_INSTRUCTIONS: Record<string, string> = {
  executive_summary:
    "Write a compelling executive summary (250–400 words) that states the problem, IFCDC's solution, requested funding amount, and expected community impact. Align with the funder's priorities.",
  need_statement:
    "Document the community need with local data references, target population demographics, gaps in existing services, and urgency. Tie need to IFCDC's service area in New Jersey.",
  project_description:
    "Describe the proposed project in detail: activities, timeline, partners, and how it addresses the stated need. Reference the matched IFCDC program division.",
  goals_objectives:
    "List 3–5 SMART goals and measurable objectives. Each objective must have a metric, baseline, and target.",
  methods:
    "Outline methods and activities by phase or quarter. Include staffing roles, delivery model, and risk mitigation.",
  evaluation:
    "Define evaluation design, data collection methods, performance indicators, reporting cadence, and continuous improvement.",
  sustainability:
    "Explain how the program continues after grant funding: diversified revenue, partnerships, capacity building, and replication.",
  organizational_capacity:
    "Demonstrate IFCDC's qualifications: leadership, past performance, fiscal management, SAM.gov registration, 501(c)(3) status, and relevant program track record.",
  budget_narrative:
    "Narrate the budget justification: personnel, fringe, supplies, contracts, indirect costs. Align line items with activities and show cost-effectiveness.",
  attachments_checklist:
    "Produce a checklist of required attachments for this specific funding opportunity (IRS determination letter, board list, audited financials, letters of support, logic model, etc.). Mark each as Required / Recommended / IFCDC has on file.",
};

const FULL_DRAFT_SECTIONS = [...WRITER_SECTION_KEYS];

async function safeQuery<T>(sql: string, ...params: unknown[]): Promise<T[]> {
  const db = await getDb();
  try {
    return (await db.all(sql, ...params)) as T[];
  } catch {
    return [];
  }
}

export async function ensureGrantWriterTables(): Promise<void> {
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS grant_writer_section_versions (
      id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL,
      section_key TEXT NOT NULL,
      content TEXT NOT NULL,
      word_count INTEGER DEFAULT 0,
      source TEXT DEFAULT 'manual',
      created_by TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (application_id) REFERENCES grant_applications(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_writer_versions_app ON grant_writer_section_versions(application_id, section_key);

    CREATE TABLE IF NOT EXISTS grant_writer_draft_jobs (
      id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      sections_json TEXT,
      completed INTEGER DEFAULT 0,
      total INTEGER DEFAULT 0,
      error TEXT,
      actor_email TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (application_id) REFERENCES grant_applications(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_writer_jobs_app ON grant_writer_draft_jobs(application_id);
  `);
}

/** Fetch full Grants.gov opportunity detail for narrative tailoring. */
export async function fetchGrantsGovOpportunityDetail(externalId: string): Promise<Record<string, unknown> | null> {
  if (!externalId?.trim()) return null;
  try {
    const res = await fetch("https://api.grants.gov/v1/api/fetchOpportunity", {
      method: "POST",
      headers: searchHeaders(),
      body: JSON.stringify({ opportunityId: externalId }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.warn(`[grant-writer] Grants.gov fetchOpportunity ${res.status} for ${externalId}`);
      return null;
    }
    const data = (await res.json()) as Record<string, unknown>;
    return (data.data ?? data.opportunity ?? data) as Record<string, unknown>;
  } catch (err) {
    console.warn("[grant-writer] Grants.gov fetch failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

async function loadSamGovStatus(): Promise<string> {
  const db = await getDb();
  const row = await db.get<{ last_status: string; last_sync_at: string; error_message: string | null }>(
    "SELECT last_status, last_sync_at, error_message FROM grant_feed_sync WHERE provider = 'sam_gov' LIMIT 1"
  ).catch(() => null);
  if (!row) return IFCDC_ORG_PROFILE.samUei ? `UEI on file: ${IFCDC_ORG_PROFILE.samUei} (sync status unknown)` : "SAM.gov UEI not configured";
  return `SAM.gov status: ${row.last_status}${row.error_message ? ` (${row.error_message})` : ""} · last sync ${row.last_sync_at}`;
}

async function loadPriorNarratives(matchedSlug?: string): Promise<string> {
  const db = await getDb();
  const rows = await safeQuery<{ section_key: string; content: string; title: string }>(
    `SELECT ws.section_key, ws.content, a.title
     FROM grant_writer_sections ws
     JOIN grant_applications a ON a.id = ws.application_id
     WHERE a.founder_approval_status = 'approved'
       AND LENGTH(ws.content) > 200
       AND (? = '' OR a.matched_program_slug = ?)
     ORDER BY ws.updated_at DESC LIMIT 6`,
    matchedSlug ?? "",
    matchedSlug ?? ""
  );
  if (!rows.length) return "No prior founder-approved narratives on file.";
  return rows.map((r) => `--- ${r.title} / ${r.section_key} ---\n${r.content.slice(0, 600)}…`).join("\n\n");
}

async function loadGrantLibraryExcerpts(): Promise<string> {
  const rows = await safeQuery<{ title: string; description: string; category: string }>(
    "SELECT title, description, category FROM grant_templates WHERE is_active = 1 ORDER BY usage_count DESC LIMIT 4"
  );
  if (!rows.length) return "";
  return rows.map((t) => `- ${t.title} (${t.category}): ${t.description}`).join("\n");
}

/** Build rich AURA context for grant writing from live HQ data. */
export async function buildGrantWriterContext(opts: {
  applicationId: string;
  opportunityId?: string;
  sectionKey?: string;
}): Promise<{ context: string; opportunity: Record<string, unknown> | null; application: Record<string, unknown> | null }> {
  const db = await getDb();
  const app = await db.get<Record<string, unknown>>("SELECT * FROM grant_applications WHERE id = ?", opts.applicationId);
  if (!app) return { context: "", opportunity: null, application: null };

  const oppId = opts.opportunityId || String(app.opportunity_id ?? "");
  const opp = oppId
    ? await db.get<Record<string, unknown>>("SELECT * FROM grant_opportunities WHERE id = ?", oppId)
    : null;

  const matchedSlug = String(app.matched_program_slug ?? "");
  const division = IFCDC_FUNDING_DIVISIONS.find((d) => d.slug === matchedSlug);

  let grantsGovDetail: Record<string, unknown> | null = null;
  if (opp?.external_id && String(opp.source_type) === "grants_gov") {
    grantsGovDetail = await fetchGrantsGovOpportunityDetail(String(opp.external_id));
  }

  const [executiveContext, samStatus, priorNarratives, library, budget] = await Promise.all([
    buildAuraExecutiveContext(),
    loadSamGovStatus(),
    loadPriorNarratives(matchedSlug),
    loadGrantLibraryExcerpts(),
    db.get("SELECT * FROM grant_proposal_budgets WHERE application_id = ?", opts.applicationId).catch(() => null),
  ]);

  const intelligence = opp
    ? await db.get("SELECT * FROM grant_opportunity_scores WHERE opportunity_id = ? ORDER BY created_at DESC LIMIT 1", opp.id).catch(() => null)
    : null;

  // Retrieve grounded IFCDC facts from the organizational knowledge base BEFORE
  // writing — keeps every section consistent with real budgets, programs,
  // registration data, and prior approved narratives.
  let knowledgeGrounding = "";
  try {
    const { buildGrantGroundingContext } = await import("./knowledgeBaseEngine");
    knowledgeGrounding = await buildGrantGroundingContext({
      sectionKey: opts.sectionKey,
      application: app,
      opportunity: opp ?? null,
    });
  } catch (err) {
    console.warn("[grant-writer] knowledge grounding unavailable:", err instanceof Error ? err.message : err);
  }

  const context = [
    executiveContext,
    "",
    knowledgeGrounding,
    "",
    "=== IFCDC ORGANIZATIONAL PROFILE (USE FOR ALL NARRATIVES) ===",
    `Legal name: ${IFCDC_ORG_PROFILE.legalName}`,
    `Status: ${IFCDC_ORG_PROFILE.ein}`,
    `Location: ${IFCDC_ORG_PROFILE.location}`,
    `Mission: ${IFCDC_ORG_PROFILE.mission}`,
    `Vision: ${IFCDC_ORG_PROFILE.vision}`,
    samStatus,
    `Programs & divisions: ${IFCDC_ORG_PROFILE.divisions.slice(0, 12).join("; ")}`,
    division ? `Matched program for this application: ${division.label}` : "",
    library ? `\nGrant library templates:\n${library}` : "",
    priorNarratives ? `\nPrior approved narrative excerpts:\n${priorNarratives}` : "",
    "",
    "=== APPLICATION ===",
    JSON.stringify(app, null, 2),
    opp ? `\n=== FUNDING OPPORTUNITY ===\n${JSON.stringify(opp, null, 2)}` : "",
    grantsGovDetail ? `\n=== GRANTS.GOV LIVE OPPORTUNITY DETAIL ===\n${JSON.stringify(grantsGovDetail, null, 2)}` : "",
    intelligence ? `\n=== FIT INTELLIGENCE ===\n${JSON.stringify(intelligence, null, 2)}` : "",
    budget ? `\n=== PROPOSAL BUDGET DRAFT ===\n${JSON.stringify(budget, null, 2)}` : "",
    opts.sectionKey && SECTION_INSTRUCTIONS[opts.sectionKey]
      ? `\n=== SECTION INSTRUCTIONS (${opts.sectionKey}) ===\n${SECTION_INSTRUCTIONS[opts.sectionKey]}`
      : "",
    "\nRULES: Use only real IFCDC data above. Do not invent statistics. If data is missing, note what verification is needed. Never submit — drafts require founder approval.",
    "=== END GRANT WRITER CONTEXT ===",
  ].filter(Boolean).join("\n");

  return { context, opportunity: opp ?? null, application: app };
}

function assertAuraConfigured(): ResolvedOpenAiCredentials {
  const creds = resolveOpenAiCredentials();
  if (!creds) {
    throw new Error(
      "AURA is not configured. Set AURA_OPENAI_API_KEY on Render (Environment Variables). " +
        "Remove placeholder or stale AI_INTEGRATIONS_OPENAI_API_KEY if it overrides production."
    );
  }
  return creds;
}

/** Production grant writing assist — throws on failure, logs timing. */
export async function grantWritingAssistProduction(opts: {
  prompt: string;
  applicationId: string;
  sectionKey: string;
  actorEmail?: string;
  preservePrior?: string;
}): Promise<{ content: string; durationMs: number }> {
  const creds = assertAuraConfigured();
  const started = Date.now();
  const label = WRITER_SECTION_LABELS[opts.sectionKey] ?? opts.sectionKey;
  const sectionGuide = SECTION_INSTRUCTIONS[opts.sectionKey] ?? `Draft the ${label} section.`;

  const { context } = await buildGrantWriterContext({
    applicationId: opts.applicationId,
    sectionKey: opts.sectionKey,
  });

  const userPrompt = [
    `Grant section: ${label} (${opts.sectionKey})`,
    sectionGuide,
    opts.preservePrior ? `\nExisting draft to improve (preserve facts, enhance prose):\n${opts.preservePrior.slice(0, 3000)}` : "",
    opts.prompt,
    "\nWrite in professional grant narrative style. Output only the section content — no preamble.",
  ].filter(Boolean).join("\n\n");

  let content: string;
  try {
    content = await auraExecutiveChat(userPrompt, context);
  } catch (err) {
    const message = formatOpenAiAuthError(err, creds);
    console.error(`[grant-writer] AURA error section=${opts.sectionKey} app=${opts.applicationId} source=${creds.source}:`, message);
    throw new Error(`AURA draft failed for ${label}: ${message}`);
  }

  if (!content?.trim()) {
    throw new Error(`AURA returned empty content for ${label}. Verify AURA_OPENAI_API_KEY on Render (${creds.source}, prefix ${creds.keyPrefix}).`);
  }

  const durationMs = Date.now() - started;
  console.log(`[grant-writer] section=${opts.sectionKey} app=${opts.applicationId} duration=${durationMs}ms words=${content.split(/\s+/).length}`);

  await logGrantActivity("grant_application", opts.applicationId, "ai_assist", `${opts.sectionKey} (${durationMs}ms)`, opts.actorEmail);
  await logHqAudit({
    action: "grant_writer_ai_draft",
    entityType: "grant_application",
    entityId: opts.applicationId,
    detail: `${opts.sectionKey} · ${durationMs}ms`,
    actorEmail: opts.actorEmail,
  });

  return { content: content.trim(), durationMs };
}

export async function saveWriterSectionVersion(
  applicationId: string,
  sectionKey: string,
  content: string,
  source: "manual" | "ai" | "regenerate",
  actorEmail?: string
): Promise<void> {
  await ensureGrantWriterTables();
  if (!content.trim()) return;
  const db = await getDb();
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO grant_writer_section_versions (id, application_id, section_key, content, word_count, source, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    grantId(),
    applicationId,
    sectionKey,
    content,
    content.trim().split(/\s+/).filter(Boolean).length,
    source,
    actorEmail ?? null,
    now
  );
}

export async function listWriterSectionVersions(applicationId: string, sectionKey: string) {
  await ensureGrantWriterTables();
  const db = await getDb();
  return db.all(
    `SELECT id, section_key, word_count, source, created_by, created_at
     FROM grant_writer_section_versions
     WHERE application_id = ? AND section_key = ?
     ORDER BY created_at DESC LIMIT 20`,
    applicationId,
    sectionKey
  );
}

export async function getWriterSectionVersion(versionId: string) {
  await ensureGrantWriterTables();
  const db = await getDb();
  return db.get("SELECT * FROM grant_writer_section_versions WHERE id = ?", versionId);
}

/** Run sections in parallel batches to stay within rate limits. */
async function runSectionsParallel(
  applicationId: string,
  sectionKeys: string[],
  actorEmail?: string,
  onProgress?: (section: string, ok: boolean) => void
): Promise<{ section: string; ok: boolean; wordCount?: number; error?: string }[]> {
  const { updateWriterSection } = await import("./grantCenterEngine");
  const concurrency = 3;
  const results: { section: string; ok: boolean; wordCount?: number; error?: string }[] = [];

  for (let i = 0; i < sectionKeys.length; i += concurrency) {
    const batch = sectionKeys.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (key) => {
        try {
          const db = await getDb();
          const existing = await db.get<{ content: string }>(
            "SELECT content FROM grant_writer_sections WHERE application_id = ? AND section_key = ?",
            applicationId,
            key
          );
          if (existing?.content?.trim()) {
            await saveWriterSectionVersion(applicationId, key, existing.content, "manual", actorEmail);
          }
          const { content } = await grantWritingAssistProduction({
            prompt: `Draft the complete ${WRITER_SECTION_LABELS[key] ?? key} for this grant application.`,
            applicationId,
            sectionKey: key,
            actorEmail,
            preservePrior: existing?.content,
          });
          await updateWriterSection(applicationId, key, content, { email: actorEmail });
          const wc = content.split(/\s+/).length;
          onProgress?.(key, true);
          return { section: key, ok: true, wordCount: wc };
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          onProgress?.(key, false);
          return { section: key, ok: false, error: message };
        }
      })
    );
    results.push(...batchResults);
  }
  return results;
}

export async function startFullProposalDraftJob(
  applicationId: string,
  opts?: { actorEmail?: string; sections?: string[] }
): Promise<{ jobId: string; status: string; total: number }> {
  await ensureGrantWriterTables();
  const db = await getDb();
  const app = await db.get("SELECT id FROM grant_applications WHERE id = ?", applicationId);
  if (!app) throw new Error("Application not found");

  const sectionKeys = opts?.sections?.length ? opts.sections : [...FULL_DRAFT_SECTIONS];
  const now = new Date().toISOString();
  const jobId = grantId();

  await db.run(
    `INSERT INTO grant_writer_draft_jobs (id, application_id, status, sections_json, completed, total, actor_email, created_at, updated_at)
     VALUES (?, ?, 'running', ?, 0, ?, ?, ?, ?)`,
    jobId,
    applicationId,
    JSON.stringify(sectionKeys.map((s) => ({ section: s, status: "pending" }))),
    sectionKeys.length,
    opts?.actorEmail ?? null,
    now,
    now
  );

  // Reset founder approval — new AI draft requires re-review
  await db.run(
    `UPDATE grant_applications SET founder_approval_status = 'pending', ready_to_submit = 0, updated_at = ? WHERE id = ?`,
    now,
    applicationId
  );

  // Fire-and-forget async generation
  void runFullProposalDraftJob(jobId, applicationId, sectionKeys, opts?.actorEmail);

  return { jobId, status: "running", total: sectionKeys.length };
}

async function runFullProposalDraftJob(
  jobId: string,
  applicationId: string,
  sectionKeys: string[],
  actorEmail?: string
): Promise<void> {
  const db = await getDb();
  const progress: { section: string; status: string; error?: string }[] = sectionKeys.map((s) => ({ section: s, status: "pending" }));

  const updateJob = async (completed: number, status: string, error?: string) => {
    await db.run(
      `UPDATE grant_writer_draft_jobs SET sections_json = ?, completed = ?, status = ?, error = ?, updated_at = ? WHERE id = ?`,
      JSON.stringify(progress),
      completed,
      status,
      error ?? null,
      new Date().toISOString(),
      jobId
    );
  };

  try {
    const results = await runSectionsParallel(applicationId, sectionKeys, actorEmail, (section, ok) => {
      const idx = progress.findIndex((p) => p.section === section);
      if (idx >= 0) progress[idx].status = ok ? "completed" : "failed";
    });

    for (const r of results) {
      const idx = progress.findIndex((p) => p.section === r.section);
      if (idx >= 0) {
        progress[idx].status = r.ok ? "completed" : "failed";
        if (r.error) progress[idx].error = r.error;
      }
    }

    const completed = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok);
    const status = completed === 0 ? "failed" : failed.length ? "completed_with_errors" : "completed";

    await updateJob(completed, status, failed.length ? failed.map((f) => `${f.section}: ${f.error}`).join("; ") : undefined);

    await logHqAudit({
      action: "grant_full_proposal_draft",
      entityType: "grant_application",
      entityId: applicationId,
      detail: `job ${jobId} · ${completed}/${sectionKeys.length} sections`,
      actorEmail,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Job failed";
    console.error(`[grant-writer] job ${jobId} failed:`, message);
    await updateJob(0, "failed", message);
  }
}

export async function getFullProposalDraftJob(jobId: string) {
  await ensureGrantWriterTables();
  const db = await getDb();
  const job = await db.get<Record<string, unknown>>("SELECT * FROM grant_writer_draft_jobs WHERE id = ?", jobId);
  if (!job) return null;
  let sections: { section: string; status: string; error?: string }[] = [];
  try {
    sections = JSON.parse(String(job.sections_json ?? "[]"));
  } catch { /* */ }
  return {
    ...job,
    sections,
    progressPct: Number(job.total) > 0 ? Math.round((Number(job.completed) / Number(job.total)) * 100) : 0,
  };
}

export async function getActiveDraftJobForApplication(applicationId: string) {
  await ensureGrantWriterTables();
  const db = await getDb();
  const job = await db.get<Record<string, unknown>>(
    `SELECT * FROM grant_writer_draft_jobs WHERE application_id = ? AND status = 'running' ORDER BY created_at DESC LIMIT 1`,
    applicationId
  );
  if (!job) return null;
  return getFullProposalDraftJob(String(job.id));
}

/** Synchronous single-section assist (for AURA Draft button). */
export async function assistWriterSectionProduction(
  applicationId: string,
  sectionKey: string,
  prompt?: string,
  actorEmail?: string
) {
  const db = await getDb();
  const existing = await db.get<{ content: string }>(
    "SELECT content FROM grant_writer_sections WHERE application_id = ? AND section_key = ?",
    applicationId,
    sectionKey
  );
  if (existing?.content?.trim()) {
    await saveWriterSectionVersion(applicationId, sectionKey, existing.content, "manual", actorEmail);
  }

  const { content, durationMs } = await grantWritingAssistProduction({
    prompt: prompt ?? `Draft the ${WRITER_SECTION_LABELS[sectionKey] ?? sectionKey} section.`,
    applicationId,
    sectionKey,
    actorEmail,
    preservePrior: existing?.content,
  });

  const { updateWriterSection } = await import("./grantCenterEngine");
  await updateWriterSection(applicationId, sectionKey, content, { email: actorEmail });

  // Reset founder approval on new AI content
  await db.run(
    `UPDATE grant_applications SET founder_approval_status = 'pending', ready_to_submit = 0, updated_at = ? WHERE id = ?`,
    new Date().toISOString(),
    applicationId
  );

  return {
    section: sectionKey,
    content,
    durationMs,
    humanReviewRequired: true,
    founderApprovalRequired: true,
    generatedAt: new Date().toISOString(),
  };
}

export function computeProposalCompleteness(sections: { section_key: string; content: string }[]): {
  completionPct: number;
  confidence: "low" | "medium" | "high";
  missingSections: string[];
} {
  const required = FULL_DRAFT_SECTIONS.filter((k) => k !== "attachments_checklist");
  const filled = required.filter((key) => {
    const s = sections.find((r) => r.section_key === key);
    return s && (s.content ?? "").trim().length > 80;
  });
  const completionPct = Math.round((filled.length / required.length) * 100);
  const missingSections = required.filter((k) => !filled.includes(k)).map(
    (k) => WRITER_SECTION_LABELS[k] ?? k
  );
  const confidence: "low" | "medium" | "high" =
    completionPct >= 85 ? "high" : completionPct >= 50 ? "medium" : "low";
  return { completionPct, confidence, missingSections };
}
