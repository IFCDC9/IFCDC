/**
 * IFCDC HQ — Policy & Governance Center
 * Official source of truth for policies, procedures, governance docs, and SOPs.
 * Freeze-safe: server/hq only — complements Document Center + Compliance filings.
 */
import crypto from "crypto";
import { getDb } from "../db";
import { ensureWorkflowTables } from "./workflowEngineSchema";
import {
  POLICY_CATEGORIES,
  policyCategoryLabel,
} from "./policyGovernanceCategories";
import { buildFoundationalPolicyLibrary } from "./policyGovernanceLibrary";

export { POLICY_CATEGORIES, POLICY_APPROVAL_STATUSES, policyCategoryLabel } from "./policyGovernanceCategories";
export type { PolicyCategoryId, PolicyApprovalStatus } from "./policyGovernanceCategories";
export { libraryCoverageSummary } from "./policyGovernanceLibrary";

export function policyId() {
  return crypto.randomUUID();
}

const POLICY_FIELDS = [
  "title",
  "policy_number",
  "department",
  "category",
  "purpose",
  "why_exists",
  "scope",
  "responsibilities",
  "procedures",
  "related_documents",
  "forms",
  "compliance_requirements",
  "legal_references",
  "what_this_means_why",
  "what_this_means_expectations",
  "what_this_means_consequences",
  "what_this_means_departments",
  "what_this_means_mission",
  "effective_date",
  "last_review_date",
  "next_review_date",
  "version_number",
  "approval_status",
  "approved_by",
  "approved_at",
  "owner_person_id",
  "document_id",
  "requires_acknowledgment",
  "status",
] as const;

export async function ensurePolicyGovernanceTables(): Promise<void> {
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS hq_policies (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      policy_number TEXT UNIQUE,
      department TEXT,
      category TEXT NOT NULL DEFAULT 'sops',
      purpose TEXT,
      why_exists TEXT,
      scope TEXT,
      responsibilities TEXT,
      procedures TEXT,
      related_documents TEXT,
      forms TEXT,
      compliance_requirements TEXT,
      legal_references TEXT,
      what_this_means_why TEXT,
      what_this_means_expectations TEXT,
      what_this_means_consequences TEXT,
      what_this_means_departments TEXT,
      what_this_means_mission TEXT,
      effective_date TEXT,
      last_review_date TEXT,
      next_review_date TEXT,
      version_number TEXT DEFAULT '1.0',
      approval_status TEXT DEFAULT 'draft',
      approved_by TEXT,
      approved_at TEXT,
      owner_person_id TEXT,
      document_id TEXT,
      requires_acknowledgment INTEGER DEFAULT 1,
      status TEXT DEFAULT 'active',
      created_by_email TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_hq_policies_category ON hq_policies(category);
    CREATE INDEX IF NOT EXISTS idx_hq_policies_status ON hq_policies(approval_status);
    CREATE INDEX IF NOT EXISTS idx_hq_policies_review ON hq_policies(next_review_date);
    CREATE INDEX IF NOT EXISTS idx_hq_policies_number ON hq_policies(policy_number);

    CREATE TABLE IF NOT EXISTS hq_policy_versions (
      id TEXT PRIMARY KEY,
      policy_id TEXT NOT NULL,
      version_number TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      change_summary TEXT,
      created_by_email TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_hq_policy_versions_policy ON hq_policy_versions(policy_id);

    CREATE TABLE IF NOT EXISTS hq_policy_acknowledgments (
      id TEXT PRIMARY KEY,
      policy_id TEXT NOT NULL,
      version_number TEXT NOT NULL,
      person_id TEXT,
      person_email TEXT,
      person_name TEXT,
      person_role TEXT,
      signature_text TEXT,
      acknowledged_at TEXT NOT NULL,
      ip_hint TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_hq_policy_acks_policy ON hq_policy_acknowledgments(policy_id);
    CREATE INDEX IF NOT EXISTS idx_hq_policy_acks_person ON hq_policy_acknowledgments(person_id);

    CREATE TABLE IF NOT EXISTS hq_policy_signatures (
      id TEXT PRIMARY KEY,
      policy_id TEXT NOT NULL,
      version_number TEXT,
      signer_name TEXT NOT NULL,
      signer_email TEXT,
      signer_role TEXT,
      signature_text TEXT NOT NULL,
      signed_at TEXT NOT NULL,
      purpose TEXT DEFAULT 'approval',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_hq_policy_sigs_policy ON hq_policy_signatures(policy_id);

    CREATE TABLE IF NOT EXISTS hq_policy_activity (
      id TEXT PRIMARY KEY,
      policy_id TEXT,
      action TEXT NOT NULL,
      detail TEXT,
      actor_email TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_hq_policy_activity_policy ON hq_policy_activity(policy_id);
    CREATE INDEX IF NOT EXISTS idx_hq_policy_activity_created ON hq_policy_activity(created_at);
  `);

  await ensureWorkflowTables();
  await ensurePolicyAutomationJobs();
  await seedPolicyLibraryGapFill();
}

async function ensurePolicyAutomationJobs(): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  const jobs = [
    { key: "policy_review_reminders", name: "Policy Review Reminders", schedule: "daily", module: "policies" },
    { key: "policy_ack_digest", name: "Policy Acknowledgment Digest", schedule: "weekly", module: "policies" },
  ];
  for (const job of jobs) {
    const exists = await db.get("SELECT id FROM hq_scheduled_jobs WHERE job_key = ?", job.key);
    if (!exists) {
      await db.run(
        `INSERT INTO hq_scheduled_jobs (id, job_key, name, schedule_expr, source_module, enabled, created_at)
         VALUES (?, ?, ?, ?, ?, 1, ?)`,
        policyId(), job.key, job.name, job.schedule, job.module, now
      );
    }
  }
  const defs = [
    { key: "policy_approval", name: "Policy Approval", trigger: "event", description: "Route draft policies to executive/board approval before publish" },
    { key: "policy_review_reminder", name: "Policy Review Reminder", trigger: "scheduled", description: "Notify owners when next_review_date approaches" },
  ];
  for (const def of defs) {
    const exists = await db.get("SELECT id FROM hq_workflow_definitions WHERE workflow_key = ?", def.key);
    if (!exists) {
      await db.run(
        `INSERT INTO hq_workflow_definitions (id, workflow_key, name, trigger_type, description, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
        policyId(), def.key, def.name, def.trigger, def.description, now, now
      );
    }
  }
}

async function logActivity(policyIdValue: string | null, action: string, detail: string, actor?: string): Promise<void> {
  const db = await getDb();
  await db.run(
    `INSERT INTO hq_policy_activity (id, policy_id, action, detail, actor_email, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    policyId(), policyIdValue, action, detail, actor ?? null, new Date().toISOString()
  );
}

async function snapshotVersion(policyIdValue: string, version: string, summary: string, actor?: string): Promise<void> {
  const db = await getDb();
  const row = await db.get("SELECT * FROM hq_policies WHERE id = ?", policyIdValue);
  if (!row) return;
  await db.run(
    `INSERT INTO hq_policy_versions (id, policy_id, version_number, snapshot_json, change_summary, created_by_email, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    policyId(), policyIdValue, version, JSON.stringify(row), summary, actor ?? null, new Date().toISOString()
  );
}

async function seedPolicyLibraryGapFill(): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  const effective = "2026-01-01";
  const nextReview = "2027-01-01";
  const lastReview = "2026-01-01";
  const seeds = buildFoundationalPolicyLibrary();
  let inserted = 0;

  for (const s of seeds) {
    const existing = await db.get<{ id: string }>(
      "SELECT id FROM hq_policies WHERE policy_number = ? LIMIT 1",
      s.number
    );
    if (existing) continue;

    const id = policyId();
    await db.run(
      `INSERT INTO hq_policies (
        id, title, policy_number, department, category, purpose, why_exists, scope, responsibilities, procedures,
        related_documents, forms, compliance_requirements, legal_references,
        what_this_means_why, what_this_means_expectations, what_this_means_consequences,
        what_this_means_departments, what_this_means_mission,
        effective_date, last_review_date, next_review_date, version_number, approval_status,
        approved_by, approved_at, requires_acknowledgment, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '1.0', 'published', 'Founder / Executive Leadership', ?, 1, 'active', ?, ?)`,
      id, s.title, s.number, s.department, s.category, s.purpose, s.why, s.scope, s.responsibilities, s.procedures,
      s.related ?? "", s.forms ?? "", s.compliance, s.legal ?? "",
      s.meansWhy, s.meansExpect, s.meansConsequences, s.meansDepts, s.meansMission,
      effective, lastReview, nextReview, now, now, now
    );
    await snapshotVersion(id, "1.0", "Foundational library seed", "system");
    await logActivity(id, "seed", `Seeded foundational policy ${s.number}`, "system");
    inserted += 1;
  }

  if (inserted > 0) {
    console.info(`[policy-governance] gap-filled ${inserted} foundational policies`);
  }
}

export async function buildPolicyDashboard() {
  await ensurePolicyGovernanceTables();
  const db = await getDb();
  const total = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM hq_policies WHERE status = 'active'"))?.c ?? 0;
  const published = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM hq_policies WHERE approval_status = 'published' AND status = 'active'"))?.c ?? 0;
  const approved = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM hq_policies WHERE approval_status = 'approved' AND status = 'active'"))?.c ?? 0;
  const pending = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM hq_policies WHERE approval_status = 'pending_approval'"))?.c ?? 0;
  const drafts = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM hq_policies WHERE approval_status = 'draft'"))?.c ?? 0;
  const dueSoon = (await db.get<{ c: number }>(`SELECT COUNT(*) as c FROM hq_policies WHERE status = 'active' AND next_review_date IS NOT NULL AND next_review_date <= date('now', '+60 days') AND next_review_date >= date('now')`))?.c ?? 0;
  const overdue = (await db.get<{ c: number }>(`SELECT COUNT(*) as c FROM hq_policies WHERE status = 'active' AND next_review_date IS NOT NULL AND next_review_date < date('now')`))?.c ?? 0;
  const ackRequired = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM hq_policies WHERE requires_acknowledgment = 1 AND approval_status = 'published'"))?.c ?? 0;
  const acknowledgments = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM hq_policy_acknowledgments"))?.c ?? 0;
  const categoriesUsed = await db.all(`SELECT category, COUNT(*) as count FROM hq_policies WHERE status = 'active' GROUP BY category ORDER BY count DESC`);
  const countMap = new Map(categoriesUsed.map((r: { category: string; count: number }) => [r.category, r.count]));
  const categoryCoverage = POLICY_CATEGORIES.map((c) => ({
    id: c.id,
    label: c.label,
    count: countMap.get(c.id) ?? 0,
    complete: (countMap.get(c.id) ?? 0) >= 3,
  }));
  const categoriesWithPolicies = categoryCoverage.filter((c) => c.count > 0).length;
  const categoriesComplete = categoryCoverage.filter((c) => c.complete).length;
  const completedPolicies = published + approved;
  const awaitingReview = dueSoon + overdue;
  const awaitingApproval = pending;
  // Governance completion: category coverage (50%) + published ratio (50%)
  const categoryPct = POLICY_CATEGORIES.length ? Math.round((categoriesComplete / POLICY_CATEGORIES.length) * 100) : 0;
  const publishPct = total ? Math.round((published / total) * 100) : 0;
  const governanceCompletionPct = Math.round(categoryPct * 0.5 + publishPct * 0.5);

  return {
    version: "policy-governance-v2",
    generatedAt: new Date().toISOString(),
    total,
    published,
    approved,
    pending,
    drafts,
    completedPolicies,
    awaitingReview,
    awaitingApproval,
    reviewsDueSoon: dueSoon,
    reviewsOverdue: overdue,
    acknowledgmentRequired: ackRequired,
    acknowledgments,
    categories: POLICY_CATEGORIES.length,
    categoriesWithPolicies,
    categoriesComplete,
    governanceCompletionPct,
    progress: {
      totalCategories: POLICY_CATEGORIES.length,
      totalPolicies: total,
      completedPolicies,
      policiesAwaitingReview: awaitingReview,
      policiesAwaitingApproval: awaitingApproval,
      policiesDueForReview: dueSoon + overdue,
      overallGovernanceCompletionPct: governanceCompletionPct,
    },
    categoryCoverage,
    categoriesUsed: categoriesUsed.map((r: { category: string; count: number }) => ({
      id: r.category,
      label: policyCategoryLabel(r.category),
      count: r.count,
    })),
    vaultPath: "/hq/documents?category=policies",
    compliancePath: "/hq/compliance",
    operationsCompliancePath: "/hq/operations?tab=compliance",
    learningPath: "/hq/learning",
  };
}

export async function listPolicyCategories() {
  await ensurePolicyGovernanceTables();
  const db = await getDb();
  const counts = await db.all(`SELECT category, COUNT(*) as count FROM hq_policies WHERE status != 'deleted' GROUP BY category`);
  const map = new Map(counts.map((c: { category: string; count: number }) => [c.category, c.count]));
  return POLICY_CATEGORIES.map((c) => ({ ...c, count: map.get(c.id) ?? 0 }));
}

export async function searchPolicies(opts: {
  q?: string; category?: string; department?: string; approval_status?: string; status?: string;
}) {
  await ensurePolicyGovernanceTables();
  const db = await getDb();
  let sql = `SELECT id, title, policy_number, department, category, approval_status, version_number,
    effective_date, last_review_date, next_review_date, requires_acknowledgment, status, updated_at,
    substr(purpose, 1, 180) as purpose_preview,
    substr(what_this_means_why, 1, 180) as means_preview
    FROM hq_policies WHERE status != 'deleted'`;
  const params: string[] = [];
  if (opts.category) { sql += " AND category = ?"; params.push(opts.category); }
  if (opts.department) { sql += " AND department LIKE ?"; params.push(`%${opts.department}%`); }
  if (opts.approval_status) { sql += " AND approval_status = ?"; params.push(opts.approval_status); }
  if (opts.status) { sql += " AND status = ?"; params.push(opts.status); }
  if (opts.q) {
    sql += ` AND (
      title LIKE ? OR policy_number LIKE ? OR purpose LIKE ? OR why_exists LIKE ?
      OR what_this_means_why LIKE ? OR what_this_means_expectations LIKE ?
      OR department LIKE ? OR category LIKE ? OR procedures LIKE ?
    )`;
    const like = `%${opts.q}%`;
    params.push(like, like, like, like, like, like, like, like, like);
  }
  sql += " ORDER BY policy_number ASC, title ASC";
  const rows = await db.all(sql, ...params);
  return rows.map((r: Record<string, unknown>) => ({
    ...r,
    categoryLabel: policyCategoryLabel(String(r.category)),
  }));
}

export async function getPolicy(id: string) {
  await ensurePolicyGovernanceTables();
  const db = await getDb();
  const policy = await db.get("SELECT * FROM hq_policies WHERE id = ?", id);
  if (!policy) return null;
  const versions = await db.all(
    "SELECT id, version_number, change_summary, created_by_email, created_at FROM hq_policy_versions WHERE policy_id = ? ORDER BY created_at DESC", id
  );
  const acknowledgments = await db.all(
    "SELECT * FROM hq_policy_acknowledgments WHERE policy_id = ? ORDER BY acknowledged_at DESC LIMIT 100", id
  );
  const signatures = await db.all(
    "SELECT * FROM hq_policy_signatures WHERE policy_id = ? ORDER BY signed_at DESC", id
  );
  const activity = await db.all(
    "SELECT * FROM hq_policy_activity WHERE policy_id = ? ORDER BY created_at DESC LIMIT 50", id
  );
  return {
    policy: { ...policy, categoryLabel: policyCategoryLabel(String((policy as { category: string }).category)) },
    versions, acknowledgments, signatures, activity,
    ackCount: acknowledgments.length,
  };
}

export async function createPolicy(data: Record<string, unknown>, actor?: { email?: string }) {
  await ensurePolicyGovernanceTables();
  const db = await getDb();
  const now = new Date().toISOString();
  const id = policyId();
  const number = (data.policy_number as string) || `IFCDC-POL-${String(Math.floor(Math.random() * 9000) + 1000)}`;
  await db.run(
    `INSERT INTO hq_policies (
      id, title, policy_number, department, category, purpose, why_exists, scope, responsibilities, procedures,
      related_documents, forms, compliance_requirements, legal_references,
      what_this_means_why, what_this_means_expectations, what_this_means_consequences,
      what_this_means_departments, what_this_means_mission,
      effective_date, last_review_date, next_review_date, version_number, approval_status,
      owner_person_id, document_id, requires_acknowledgment, status, created_by_email, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
    id, data.title, number, data.department ?? "", data.category ?? "sops",
    data.purpose ?? "", data.why_exists ?? "", data.scope ?? "", data.responsibilities ?? "", data.procedures ?? "",
    data.related_documents ?? "", data.forms ?? "", data.compliance_requirements ?? "", data.legal_references ?? "",
    data.what_this_means_why ?? "", data.what_this_means_expectations ?? "", data.what_this_means_consequences ?? "",
    data.what_this_means_departments ?? "", data.what_this_means_mission ?? "",
    data.effective_date ?? null, data.last_review_date ?? null, data.next_review_date ?? null,
    data.version_number ?? "0.1", data.approval_status ?? "draft",
    data.owner_person_id ?? null, data.document_id ?? null,
    data.requires_acknowledgment === 0 || data.requires_acknowledgment === false ? 0 : 1,
    actor?.email ?? null, now, now
  );
  await snapshotVersion(id, String(data.version_number ?? "0.1"), "Initial draft", actor?.email);
  await logActivity(id, "created", `Created policy ${number}`, actor?.email);
  return getPolicy(id);
}

export async function updatePolicy(id: string, data: Record<string, unknown>, actor?: { email?: string }) {
  await ensurePolicyGovernanceTables();
  const db = await getDb();
  const now = new Date().toISOString();
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const f of POLICY_FIELDS) {
    if (data[f] !== undefined) {
      sets.push(`${f} = ?`);
      vals.push(f === "requires_acknowledgment" ? (data[f] ? 1 : 0) : data[f]);
    }
  }
  if (!sets.length) return getPolicy(id);
  sets.push("updated_at = ?");
  vals.push(now, id);
  await db.run(`UPDATE hq_policies SET ${sets.join(", ")} WHERE id = ?`, ...vals);
  if (data.version_number || data.create_version) {
    const row = await db.get<{ version_number: string }>("SELECT version_number FROM hq_policies WHERE id = ?", id);
    await snapshotVersion(id, String(data.version_number ?? row?.version_number ?? "1.0"), String(data.change_summary ?? "Policy updated"), actor?.email);
  }
  await logActivity(id, "updated", "Policy fields updated", actor?.email);
  return getPolicy(id);
}

export async function submitPolicyForApproval(id: string, actor?: { email?: string }) {
  const result = await updatePolicy(id, { approval_status: "pending_approval" }, actor);
  await logActivity(id, "submitted_for_approval", "Submitted for approval", actor?.email);
  try {
    const { createWorkflowInstance } = await import("./workflowEngine");
    await createWorkflowInstance({
      workflowKey: "policy_approval",
      title: `Policy approval: ${(result?.policy as { title?: string })?.title ?? id}`,
      entityType: "policy",
      entityId: id,
      priority: "high",
      assignedTo: "executive",
    });
  } catch { /* workflow optional */ }
  return result;
}

export async function approvePolicy(
  id: string,
  opts: { approved_by: string; signature_text: string; signer_email?: string; signer_role?: string },
  actor?: { email?: string }
) {
  await ensurePolicyGovernanceTables();
  const db = await getDb();
  const now = new Date().toISOString();
  const current = await db.get<{ version_number: string; title: string }>("SELECT version_number, title FROM hq_policies WHERE id = ?", id);
  if (!current) return null;
  await db.run(
    `UPDATE hq_policies SET approval_status = 'approved', approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ?`,
    opts.approved_by, now, now, id
  );
  await db.run(
    `INSERT INTO hq_policy_signatures (id, policy_id, version_number, signer_name, signer_email, signer_role, signature_text, signed_at, purpose, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approval', ?)`,
    policyId(), id, current.version_number, opts.approved_by, opts.signer_email ?? actor?.email ?? null,
    opts.signer_role ?? "approver", opts.signature_text, now, now
  );
  await snapshotVersion(id, current.version_number, "Approved", actor?.email);
  await logActivity(id, "approved", `Approved by ${opts.approved_by}`, actor?.email);
  return getPolicy(id);
}

export async function publishPolicy(id: string, actor?: { email?: string }) {
  const db = await getDb();
  const row = await db.get<{ version_number: string; approval_status: string }>(
    "SELECT version_number, approval_status FROM hq_policies WHERE id = ?", id
  );
  if (!row) return null;
  const parts = String(row.version_number || "1.0").split(".");
  const major = Number(parts[0]) || 1;
  const nextVersion = row.approval_status === "published" ? `${major + 1}.0` : `${major}.0`;
  await updatePolicy(id, {
    approval_status: "published",
    version_number: nextVersion,
    last_review_date: new Date().toISOString().slice(0, 10),
    create_version: true,
    change_summary: "Published",
  }, actor);
  await logActivity(id, "published", `Published as v${nextVersion}`, actor?.email);
  return getPolicy(id);
}

export async function acknowledgePolicy(
  id: string,
  data: { person_id?: string; person_email?: string; person_name: string; person_role?: string; signature_text: string }
) {
  await ensurePolicyGovernanceTables();
  const db = await getDb();
  const policy = await db.get<{ version_number: string }>("SELECT version_number FROM hq_policies WHERE id = ?", id);
  if (!policy) return null;
  const now = new Date().toISOString();
  const ackId = policyId();
  await db.run(
    `INSERT INTO hq_policy_acknowledgments (
      id, policy_id, version_number, person_id, person_email, person_name, person_role, signature_text, acknowledged_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ackId, id, policy.version_number, data.person_id ?? null, data.person_email ?? null,
    data.person_name, data.person_role ?? null, data.signature_text, now, now
  );
  await logActivity(id, "acknowledged", `${data.person_name} acknowledged v${policy.version_number}`, data.person_email);
  return db.get("SELECT * FROM hq_policy_acknowledgments WHERE id = ?", ackId);
}

export async function listAcknowledgments(policyIdFilter?: string) {
  await ensurePolicyGovernanceTables();
  const db = await getDb();
  if (policyIdFilter) {
    return db.all(
      `SELECT a.*, p.title as policy_title, p.policy_number
       FROM hq_policy_acknowledgments a JOIN hq_policies p ON p.id = a.policy_id
       WHERE a.policy_id = ? ORDER BY a.acknowledged_at DESC`, policyIdFilter
    );
  }
  return db.all(
    `SELECT a.*, p.title as policy_title, p.policy_number
     FROM hq_policy_acknowledgments a JOIN hq_policies p ON p.id = a.policy_id
     ORDER BY a.acknowledged_at DESC LIMIT 200`
  );
}

export async function listReviewReminders() {
  await ensurePolicyGovernanceTables();
  const db = await getDb();
  return db.all(
    `SELECT id, title, policy_number, department, category, next_review_date, approval_status, version_number
     FROM hq_policies
     WHERE status = 'active' AND next_review_date IS NOT NULL AND next_review_date <= date('now', '+90 days')
     ORDER BY next_review_date ASC`
  );
}

export async function listPolicyActivity(limit = 100) {
  await ensurePolicyGovernanceTables();
  const db = await getDb();
  return db.all(
    `SELECT a.*, p.title as policy_title, p.policy_number
     FROM hq_policy_activity a LEFT JOIN hq_policies p ON p.id = a.policy_id
     ORDER BY a.created_at DESC LIMIT ?`, limit
  );
}

export async function buildPolicyComplianceReport() {
  const dash = await buildPolicyDashboard();
  const reviews = await listReviewReminders();
  const acks = await listAcknowledgments();
  const categories = await listPolicyCategories();
  const pending = await searchPolicies({ approval_status: "pending_approval" });
  const published = await searchPolicies({ approval_status: "published" });
  const byPolicyAck = new Map<string, number>();
  for (const a of acks as { policy_id: string }[]) {
    byPolicyAck.set(a.policy_id, (byPolicyAck.get(a.policy_id) ?? 0) + 1);
  }
  return {
    generatedAt: new Date().toISOString(),
    title: "IFCDC Policy & Governance Compliance Report",
    summary: dash,
    categories,
    pendingApprovals: pending,
    publishedCount: published.length,
    reviewsDue: reviews,
    acknowledgmentTotals: acks.length,
    acknowledgmentsByPolicy: Array.from(byPolicyAck.entries()).map(([policy_id, count]) => ({ policy_id, count })),
    recentAcknowledgments: (acks as unknown[]).slice(0, 25),
  };
}
