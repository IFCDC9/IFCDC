/**
 * Grant Production Lifecycle — end-to-end readiness, Founder review, and stage reports.
 * Composes Writer Studio, KB grounding, Founder gates, and submission package prep.
 * HQ never auto-submits to Grants.gov; portal confirmation remains human-executed.
 */
import { getDb } from "../db";
import { computeProposalCompleteness } from "./grantWriterEngine";
import { seedWriterSectionsForApplication } from "./grantCenterEngine";
import {
  assertFounderApprovedForSubmit,
  buildFullApplicationWorkspace,
  startGrantApplicationWorkflow,
} from "./grantIntelligenceEngine";
import { buildGrantSubmissionPackage } from "./executiveGrantWorkflowEngine";
import { getKnowledgeBaseStatus, buildGrantGroundingContext } from "./knowledgeBaseEngine";
import { resolveOpenAiCredentials } from "../lib/openaiConfig";
import { logHqAudit } from "./hqAuditLog";

export const GRANT_LIFECYCLE_VERSION = "1.0" as const;

export type LifecycleStageResult = {
  id: string;
  label: string;
  status: "PASS" | "FAIL" | "BLOCKED" | "WARN" | "SKIP";
  detail: string;
  applicationId?: string;
};

export type GrantReadinessItem = {
  id: string;
  label: string;
  ok: boolean;
  severity: "critical" | "high" | "medium" | "low";
  detail: string;
};

export type GrantReadinessReport = {
  applicationId: string;
  readinessScore: number;
  readyForFounderReview: boolean;
  readyForSubmissionPrep: boolean;
  completenessPct: number;
  confidence: "low" | "medium" | "high";
  missingSections: string[];
  items: GrantReadinessItem[];
  knowledgeBase: { total: number; embedded: number; embeddingsConfigured: boolean };
  openAiConfigured: boolean;
  founderApprovalStatus: string | null;
  generatedAt: string;
};

const SECTION_LABELS: Record<string, string> = {
  executive_summary: "Executive Summary",
  need_statement: "Statement of Need",
  project_description: "Project Description",
  goals_objectives: "Goals & Objectives",
  methods: "Methods & Activities",
  evaluation: "Evaluation Plan",
  sustainability: "Sustainability Plan",
  organizational_capacity: "Organizational Capacity",
  budget_narrative: "Budget Narrative",
  attachments_checklist: "Attachments Checklist",
};

export async function computeGrantReadinessReport(applicationId: string): Promise<GrantReadinessReport | null> {
  const db = await getDb();
  const app = (await db.get(
    `SELECT a.*, o.title as opportunity_title, o.deadline, o.amount_max, o.funder, o.url
     FROM grant_applications a
     LEFT JOIN grant_opportunities o ON o.id = a.opportunity_id
     WHERE a.id = ?`,
    applicationId
  )) as Record<string, unknown> | undefined;
  if (!app) return null;

  const seeded = await seedWriterSectionsForApplication(applicationId);
  const sectionRows = (seeded.sections ?? []) as { section_key: string; content: string }[];
  const completeness = computeProposalCompleteness(sectionRows);

  const attachments = sectionRows.find((s) => s.section_key === "attachments_checklist");
  const attachmentsOk = Boolean(attachments && (attachments.content ?? "").trim().length > 20);

  const budgetSection = sectionRows.find((s) => s.section_key === "budget_narrative");
  const budgetOk = Boolean(budgetSection && (budgetSection.content ?? "").trim().length > 80);
  const amountRequested = app.amount_requested != null ? Number(app.amount_requested) : null;
  const amountMax = app.amount_max != null ? Number(app.amount_max) : null;
  const budgetMatchOk =
    amountRequested == null || amountMax == null || amountRequested <= amountMax * 1.05;

  const [kbStatus, groundingText] = await Promise.all([
    getKnowledgeBaseStatus().catch(() => ({
      total: 0,
      embedded: 0,
      embeddingsConfigured: false,
      chunks: 0,
    })),
    buildGrantGroundingContext({
      sectionKey: "executive_summary",
      application: app,
      opportunity: {
        title: app.opportunity_title,
        funder: app.funder,
        agency: app.funder,
      },
    }).catch(() => ""),
  ]);

  const kbGrounded = Boolean(groundingText && groundingText.trim().length > 80);
  const kbChunkHint = Number(kbStatus.chunks ?? 0);

  const openAiConfigured = Boolean(resolveOpenAiCredentials());
  const founderStatus = String(app.founder_approval_status || "pending");
  const hasOpportunity = Boolean(app.opportunity_id);
  const hasDeadline = Boolean(app.deadline);

  const items: GrantReadinessItem[] = [
    {
      id: "narratives",
      label: "Required narratives",
      ok: completeness.completionPct >= 80,
      severity: "critical",
      detail:
        completeness.completionPct >= 80
          ? `${completeness.completionPct}% complete`
          : `Missing: ${completeness.missingSections.join(", ") || "sections"}`,
    },
    {
      id: "attachments",
      label: "Attachments checklist",
      ok: attachmentsOk,
      severity: "high",
      detail: attachmentsOk ? "Checklist present" : "Attachments checklist empty",
    },
    {
      id: "budget",
      label: "Budget narrative",
      ok: budgetOk,
      severity: "critical",
      detail: budgetOk ? "Budget narrative present" : "Budget narrative missing or too short",
    },
    {
      id: "budget_match",
      label: "Budget vs opportunity amount",
      ok: budgetMatchOk,
      severity: "medium",
      detail: budgetMatchOk
        ? "Requested amount within opportunity range (or not constrained)"
        : `Requested ${amountRequested} exceeds opportunity max ${amountMax}`,
    },
    {
      id: "opportunity",
      label: "Linked opportunity",
      ok: hasOpportunity,
      severity: "critical",
      detail: hasOpportunity ? String(app.opportunity_title || app.opportunity_id) : "No opportunity linked",
    },
    {
      id: "deadline",
      label: "Deadline recorded",
      ok: hasDeadline,
      severity: "high",
      detail: hasDeadline ? String(app.deadline) : "No deadline on opportunity",
    },
    {
      id: "knowledge_base",
      label: "Knowledge Base grounding",
      ok: kbStatus.total > 0 && kbGrounded,
      severity: "high",
      detail:
        kbStatus.total > 0
          ? `${kbStatus.total} approved docs · ${kbChunkHint} chunks · grounding ${kbGrounded ? "available" : "thin for this section"}`
          : "Knowledge Base empty — sync IFCDC organizational data",
    },
    {
      id: "aura_drafting",
      label: "AURA drafting capability",
      ok: openAiConfigured,
      severity: "high",
      detail: openAiConfigured ? "OpenAI configured" : "OpenAI API key missing — AURA drafting blocked",
    },
    {
      id: "founder_gate",
      label: "Founder approval status",
      ok: founderStatus === "approved" || founderStatus === "pending" || founderStatus === "changes_requested",
      severity: "medium",
      detail: `Status: ${founderStatus}`,
    },
  ];

  const weights: Record<string, number> = {
    narratives: 30,
    attachments: 10,
    budget: 15,
    budget_match: 5,
    opportunity: 10,
    deadline: 5,
    knowledge_base: 15,
    aura_drafting: 5,
    founder_gate: 5,
  };
  let score = 0;
  let weightTotal = 0;
  for (const item of items) {
    const w = weights[item.id] ?? 5;
    weightTotal += w;
    if (item.ok) score += w;
  }
  const readinessScore = Math.round((score / Math.max(weightTotal, 1)) * 100);

  const criticalFail = items.some((i) => !i.ok && i.severity === "critical");
  const readyForFounderReview = !criticalFail && completeness.completionPct >= 70;
  const readyForSubmissionPrep = founderStatus === "approved" && readinessScore >= 80;

  return {
    applicationId,
    readinessScore,
    readyForFounderReview,
    readyForSubmissionPrep,
    completenessPct: completeness.completionPct,
    confidence: completeness.confidence,
    missingSections: completeness.missingSections,
    items,
    knowledgeBase: {
      total: kbStatus.total,
      embedded: kbStatus.embedded,
      embeddingsConfigured: kbStatus.embeddingsConfigured,
    },
    openAiConfigured,
    founderApprovalStatus: founderStatus,
    generatedAt: new Date().toISOString(),
  };
}

export async function buildFounderGrantReviewPackage(applicationId: string) {
  const readiness = await computeGrantReadinessReport(applicationId);
  if (!readiness) return null;

  const db = await getDb();
  const app = (await db.get(
    `SELECT a.*, o.title as opportunity_title, o.deadline, o.amount_max, o.amount_min, o.funder, o.url, o.description, o.requirements
     FROM grant_applications a
     LEFT JOIN grant_opportunities o ON o.id = a.opportunity_id
     WHERE a.id = ?`,
    applicationId
  )) as Record<string, unknown> | undefined;
  if (!app) return null;

  const seeded = await seedWriterSectionsForApplication(applicationId);
  const sections = ((seeded.sections ?? []) as { section_key: string; content: string; title?: string }[]).map((s) => ({
    key: s.section_key,
    label: SECTION_LABELS[s.section_key] || s.section_key,
    contentPreview: (s.content || "").slice(0, 400),
    length: (s.content || "").trim().length,
  }));

  const exec = sections.find((s) => s.key === "executive_summary");

  return {
    applicationId,
    title: String(app.title || ""),
    opportunity: {
      title: String(app.opportunity_title || ""),
      funder: app.funder ? String(app.funder) : null,
      url: app.url ? String(app.url) : null,
      deadline: app.deadline ? String(app.deadline) : null,
      amountMin: app.amount_min != null ? Number(app.amount_min) : null,
      amountMax: app.amount_max != null ? Number(app.amount_max) : null,
      description: app.description ? String(app.description).slice(0, 800) : null,
      requirements: app.requirements ? String(app.requirements).slice(0, 800) : null,
    },
    fundingAmount: app.amount_requested != null ? Number(app.amount_requested) : app.amount_max != null ? Number(app.amount_max) : null,
    matchRequirements: "Review opportunity requirements for cost-share / match (if any).",
    executiveSummary: exec?.contentPreview || "No executive summary drafted yet.",
    budget: sections.find((s) => s.key === "budget_narrative")?.contentPreview || "No budget narrative yet.",
    requiredDocuments: sections.find((s) => s.key === "attachments_checklist")?.contentPreview || "No attachments checklist yet.",
    sections,
    readiness,
    riskAssessment: readiness.items.filter((i) => !i.ok).map((i) => ({
      risk: i.label,
      severity: i.severity,
      detail: i.detail,
    })),
    complianceStatus: {
      founderApproval: readiness.founderApprovalStatus,
      readyToSubmit: Number(app.ready_to_submit) === 1,
      portalConfirmationId: app.portal_confirmation_id ?? null,
    },
    actions: ["approve", "request_changes", "reject", "save_draft"] as const,
    paths: {
      writerStudio: `/hq/grants?tab=writer&application=${applicationId}`,
      submissionPackage: `/api/hq/grants/applications/${applicationId}/submission-package`,
      founderApproval: `/api/hq/grants/applications/${applicationId}/founder-approval`,
    },
    generatedAt: new Date().toISOString(),
  };
}

/** Ensure a Grant Workspace exists for an opportunity (creates applicationId if needed). */
export async function ensureGrantWorkspaceForOpportunity(
  opportunityId: string,
  opts?: { actorEmail?: string; generateDrafts?: boolean }
) {
  return startGrantApplicationWorkflow(opportunityId, {
    actorEmail: opts?.actorEmail,
    generateDrafts: opts?.generateDrafts ?? false,
  });
}

export async function runGrantProductionLifecycle(opts: {
  opportunityId?: string;
  applicationId?: string;
  actorEmail?: string;
  founderMode?: boolean;
  autoDraft?: boolean;
  syncFeeds?: boolean;
}): Promise<{
  version: typeof GRANT_LIFECYCLE_VERSION;
  ok: boolean;
  applicationId: string | null;
  opportunityId: string | null;
  stages: LifecycleStageResult[];
  readiness: GrantReadinessReport | null;
  founderReview: Awaited<ReturnType<typeof buildFounderGrantReviewPackage>> | null;
  submissionPackage: Awaited<ReturnType<typeof buildGrantSubmissionPackage>> | null;
  speechSummary: string;
  generatedAt: string;
}> {
  const stages: LifecycleStageResult[] = [];
  let opportunityId = opts.opportunityId ?? null;
  let applicationId = opts.applicationId ?? null;

  // Stage 1 — Discover / resolve opportunity
  if (!opportunityId && !applicationId) {
    const db = await getDb();
    const opp = await db.get<{ id: string; title: string }>(
      `SELECT id, title FROM grant_opportunities
       WHERE status != 'closed' AND (deadline IS NULL OR deadline >= date('now'))
       ORDER BY deadline ASC LIMIT 1`
    );
    if (opp) {
      opportunityId = opp.id;
      stages.push({
        id: "discover",
        label: "Discover grant",
        status: "PASS",
        detail: `Selected live opportunity: ${opp.title}`,
      });
    } else {
      stages.push({
        id: "discover",
        label: "Discover grant",
        status: "FAIL",
        detail: "No open grant opportunities in production database",
      });
      return finishLifecycle(stages, null, null, null, null, null);
    }
  } else if (opportunityId) {
    stages.push({
      id: "discover",
      label: "Discover grant",
      status: "PASS",
      detail: `Using opportunity ${opportunityId}`,
    });
  } else {
    stages.push({
      id: "discover",
      label: "Discover grant",
      status: "SKIP",
      detail: "Resuming from existing applicationId",
      applicationId: applicationId!,
    });
  }

  // Stage 2 — Eligibility analysis (score if opportunity known)
  if (opportunityId) {
    try {
      const { scoreOpportunityIntelligence } = await import("./grantIntelligenceEngine");
      const intel = await scoreOpportunityIntelligence(opportunityId, { actorEmail: opts.actorEmail });
      const score = Number(intel?.composite ?? intel?.eligibility ?? 0);
      stages.push({
        id: "eligibility",
        label: "Analyze eligibility",
        status: score >= 40 || intel != null ? "PASS" : "WARN",
        detail: intel
          ? `Eligibility ${intel.eligibility}% · composite ${intel.composite}% · ${intel.eligibilityGrade}`
          : "Eligibility analysis returned limited data",
      });
    } catch (err) {
      stages.push({
        id: "eligibility",
        label: "Analyze eligibility",
        status: "WARN",
        detail: err instanceof Error ? err.message : "Eligibility analysis failed",
      });
    }
  }

  // Stage 3–4 — Create workspace + applicationId
  if (!applicationId && opportunityId) {
    const ws = await ensureGrantWorkspaceForOpportunity(opportunityId, {
      actorEmail: opts.actorEmail,
      generateDrafts: Boolean(opts.autoDraft),
    });
    if (ws.ok && ws.applicationId) {
      applicationId = ws.applicationId;
      stages.push({
        id: "workspace",
        label: "Create Grant Workspace",
        status: "PASS",
        detail: ws.existing ? `Resumed workspace ${applicationId}` : `Created workspace ${applicationId}`,
        applicationId,
      });
      stages.push({
        id: "application_id",
        label: "Generate applicationId",
        status: "PASS",
        detail: applicationId,
        applicationId,
      });
    } else {
      stages.push({
        id: "workspace",
        label: "Create Grant Workspace",
        status: "FAIL",
        detail: (ws as { error?: string }).error || "Workspace creation failed",
      });
      return finishLifecycle(stages, opportunityId, null, null, null, null);
    }
  } else if (applicationId) {
    stages.push({
      id: "workspace",
      label: "Create Grant Workspace",
      status: "PASS",
      detail: `Using existing application ${applicationId}`,
      applicationId,
    });
    stages.push({
      id: "application_id",
      label: "Generate applicationId",
      status: "PASS",
      detail: applicationId,
      applicationId,
    });
  }

  // Stage 5 — Draft sections (seed + optional AURA full draft job start)
  if (applicationId) {
    const seeded = await seedWriterSectionsForApplication(applicationId);
    const sectionCount = (seeded.sections ?? []).length;
    stages.push({
      id: "draft_sections",
      label: "Draft proposal sections",
      status: sectionCount >= 9 ? "PASS" : "WARN",
      detail: `${sectionCount} Writer Studio sections seeded${opts.autoDraft ? " · auto-draft requested" : ""}`,
      applicationId,
    });

    if (opts.autoDraft) {
      const openAi = Boolean(resolveOpenAiCredentials());
      if (openAi) {
        try {
          const { startFullProposalDraftJob } = await import("./grantWriterEngine");
          const job = await startFullProposalDraftJob(applicationId, { actorEmail: opts.actorEmail });
          stages.push({
            id: "aura_draft",
            label: "AURA full draft job",
            status: job?.jobId ? "PASS" : "WARN",
            detail: job?.jobId ? `Draft job ${job.jobId} started` : "Draft job did not return jobId",
            applicationId,
          });
        } catch (err) {
          stages.push({
            id: "aura_draft",
            label: "AURA full draft job",
            status: "WARN",
            detail: err instanceof Error ? err.message : "Draft job failed to start",
            applicationId,
          });
        }
      } else {
        stages.push({
          id: "aura_draft",
          label: "AURA full draft job",
          status: "BLOCKED",
          detail: "OpenAI not configured — cannot auto-draft narratives",
          applicationId,
        });
      }
    }
  }

  // Stage 6–7 — Validate + readiness report
  let readiness: GrantReadinessReport | null = null;
  if (applicationId) {
    readiness = await computeGrantReadinessReport(applicationId);
    stages.push({
      id: "validate",
      label: "Validate proposal",
      status: readiness && readiness.readinessScore >= 50 ? "PASS" : readiness ? "WARN" : "FAIL",
      detail: readiness
        ? `Readiness ${readiness.readinessScore}% · completeness ${readiness.completenessPct}%`
        : "Readiness report failed",
      applicationId,
    });
    stages.push({
      id: "readiness_report",
      label: "Generate Readiness Report",
      status: readiness ? "PASS" : "FAIL",
      detail: readiness
        ? `Score ${readiness.readinessScore} · founder review ${readiness.readyForFounderReview ? "ready" : "not ready"}`
        : "No report",
      applicationId,
    });
  }

  // Stage 8 — Founder review package (presentation, not auto-approve)
  let founderReview: Awaited<ReturnType<typeof buildFounderGrantReviewPackage>> | null = null;
  if (applicationId) {
    founderReview = await buildFounderGrantReviewPackage(applicationId);
    const canPresent = Boolean(opts.founderMode);
    stages.push({
      id: "founder_review",
      label: "Present for Founder approval",
      status: !canPresent ? "BLOCKED" : founderReview ? "PASS" : "FAIL",
      detail: !canPresent
        ? "Founder Mode required to approve — review package prepared for verified Founder"
        : founderReview
          ? `Review package ready · actions: approve / request_changes / reject / save_draft`
          : "Could not build Founder review package",
      applicationId,
    });
  }

  // Stage 9 — Submission package (only meaningful after approval; still prepare checklist)
  let submissionPackage: Awaited<ReturnType<typeof buildGrantSubmissionPackage>> | null = null;
  if (applicationId) {
    submissionPackage = await buildGrantSubmissionPackage(applicationId);
    const gateReady = Boolean(submissionPackage.founderGate?.ready);
    stages.push({
      id: "submission_package",
      label: "Prepare submission package",
      status: gateReady ? "PASS" : "WARN",
      detail: gateReady
        ? "Founder-approved package ready for Grants.gov portal upload"
        : "Package checklist prepared — awaiting Founder approval before portal submit",
      applicationId,
    });
  }

  await logHqAudit({
    action: "grant_production_lifecycle",
    entityType: "grant_application",
    entityId: applicationId ?? undefined,
    actorEmail: opts.actorEmail,
    detail: `stages=${stages.length} app=${applicationId}`,
    metadata: {
      opportunityId,
      applicationId,
      statuses: stages.map((s) => `${s.id}:${s.status}`),
    },
  }).catch(() => undefined);

  return finishLifecycle(stages, opportunityId, applicationId, readiness, founderReview, submissionPackage);
}

function finishLifecycle(
  stages: LifecycleStageResult[],
  opportunityId: string | null,
  applicationId: string | null,
  readiness: GrantReadinessReport | null,
  founderReview: Awaited<ReturnType<typeof buildFounderGrantReviewPackage>> | null,
  submissionPackage: Awaited<ReturnType<typeof buildGrantSubmissionPackage>> | null
) {
  const failed = stages.filter((s) => s.status === "FAIL").length;
  const blocked = stages.filter((s) => s.status === "BLOCKED").length;
  const ok = failed === 0;
  const speechSummary = ok
    ? `Grant production lifecycle complete${applicationId ? ` for ${applicationId}` : ""}. ${stages.filter((s) => s.status === "PASS").length} stages PASS${blocked ? `, ${blocked} BLOCKED (Founder)` : ""}.`
    : `Grant production lifecycle incomplete — ${failed} FAIL, ${blocked} BLOCKED.`;

  return {
    version: GRANT_LIFECYCLE_VERSION,
    ok,
    applicationId,
    opportunityId,
    stages,
    readiness,
    founderReview,
    submissionPackage,
    speechSummary,
    generatedAt: new Date().toISOString(),
  };
}
