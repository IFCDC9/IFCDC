/**
 * Executive Grant Workflow Engine — production gate for AURA.
 * Live find → match → draft → Founder approval → portal checklist → confirm → monitor.
 * HQ never auto-submits to Grants.gov; Founder approval is mandatory before confirm.
 */
import { getDb } from "../db";
import {
  buildOrgWideGrantMatches,
  startGrantApplicationWorkflow,
  generateFullProposalDraft,
  buildFullApplicationWorkspace,
  setFounderApproval,
  confirmPortalSubmission,
  assertFounderApprovedForSubmit,
} from "./grantIntelligenceEngine";
import { runGrantIntelligenceSync } from "./grantIntelligenceEngine";
import { retrieveKnowledge } from "./knowledgeBaseEngine";
import { createLeadershipAlert } from "./criticalAlerts";

export type GrantWorkflowPhase =
  | "search"
  | "match"
  | "workspace"
  | "draft"
  | "gaps"
  | "awaiting_founder"
  | "ready_for_portal"
  | "submitted"
  | "monitoring";

export async function runLiveGrantExecutiveWorkflow(opts?: {
  actorEmail?: string;
  programSlug?: string;
  query?: string;
  syncFeeds?: boolean;
  autoDraft?: boolean;
  opportunityId?: string;
}) {
  const actorEmail = opts?.actorEmail ?? "aura@ifcdc.org";
  const steps: Array<{ phase: GrantWorkflowPhase; status: string; detail: string }> = [];

  if (opts?.syncFeeds !== false) {
    try {
      await runGrantIntelligenceSync({ actorEmail });
      steps.push({ phase: "search", status: "done", detail: "Synced live Grants.gov / SAM entity feeds" });
    } catch (err) {
      steps.push({
        phase: "search",
        status: "warning",
        detail: `Feed sync partial: ${err instanceof Error ? err.message : "unknown"}`,
      });
    }
  }

  const matches = await buildOrgWideGrantMatches({
    programSlug: opts?.programSlug,
    sort: "fit",
    limit: 15,
    q: opts?.query,
    actorEmail,
    syncFeeds: false,
  });

  steps.push({
    phase: "match",
    status: "done",
    detail: `Ranked ${matches.matches.length} live opportunities across IFCDC programs (demo/static excluded)`,
  });

  const top =
    (opts?.opportunityId
      ? matches.matches.find((m) => m.opportunityId === opts.opportunityId)
      : matches.matches[0]) ?? null;

  if (!top) {
    return {
      ok: false,
      phase: "match" as GrantWorkflowPhase,
      error: "No live grant opportunities matched IFCDC programs. Sync Grants.gov feeds and retry.",
      steps,
      matches: matches.matches,
    };
  }

  const started = await startGrantApplicationWorkflow(top.opportunityId, {
    actorEmail,
    generateDrafts: false,
  });

  if (!started?.ok || !started.applicationId) {
    return {
      ok: false,
      phase: "workspace" as GrantWorkflowPhase,
      error: (started as { error?: string })?.error ?? "Could not create application workspace",
      steps,
      topMatch: top,
    };
  }

  const applicationId = started.applicationId;
  steps.push({
    phase: "workspace",
    status: "done",
    detail: `Application workspace ${applicationId} created for ${top.title}`,
  });

  let draftJob: { jobId?: string } | null = null;
  if (opts?.autoDraft !== false) {
    try {
      draftJob = (await generateFullProposalDraft(applicationId, { actorEmail })) as { jobId?: string };
      steps.push({
        phase: "draft",
        status: "prepared",
        detail: `Full proposal draft job ${draftJob?.jobId ?? "queued"} using live org knowledge`,
      });
    } catch (err) {
      steps.push({
        phase: "draft",
        status: "warning",
        detail: `Draft generation deferred: ${err instanceof Error ? err.message : "error"}`,
      });
    }
  }

  const workspace = await buildFullApplicationWorkspace(applicationId, { actorEmail });
  const kbGaps = await identifyMissingOrganizationalInfo(top.title, top.bestProgram.label);

  steps.push({
    phase: "gaps",
    status: kbGaps.length ? "attention" : "done",
    detail: kbGaps.length
      ? `${kbGaps.length} organizational information gaps identified for Founder review`
      : "No critical knowledge gaps detected from Knowledge Base retrieval",
  });

  // Stage for Founder — do NOT auto-approve
  const db = await getDb();
  await db.run(
    `UPDATE grant_applications SET
      founder_approval_status = 'pending',
      ready_to_submit = 0,
      pipeline_stage = 'founder_approval',
      lifecycle_stage = 'internal_approval',
      updated_at = ?
     WHERE id = ?`,
    new Date().toISOString(),
    applicationId
  );

  steps.push({
    phase: "awaiting_founder",
    status: "pending_approval",
    detail: "Package staged for Founder Mode approval — AURA will not submit until you approve",
  });

  try {
    await createLeadershipAlert({
      alertType: "grant_ready_for_founder",
      title: `Founder review: ${top.title}`,
      message: `Best live match for ${top.bestProgram.label} (score ${top.matchScore}). Approve in Grant Center, then complete Grants.gov portal submission and confirm the ID in HQ.`,
      priority: "high",
      sourceModule: "grants",
      path: `/hq/grants?application=${applicationId}`,
    });
  } catch {
    /* optional */
  }

  return {
    ok: true,
    phase: "awaiting_founder" as GrantWorkflowPhase,
    topMatch: top,
    applicationId,
    draftJob,
    workspace,
    missingInformation: kbGaps,
    matches: matches.matches.slice(0, 8),
    steps,
    founderActions: {
      approve: `POST /api/hq/grants/applications/${applicationId}/founder-approval { "action": "approve" }`,
      confirmPortal: `POST /api/hq/grants/applications/${applicationId}/confirm-portal-submission { "portal_confirmation_id": "..." }`,
      openWorkspace: `/hq/grants?application=${applicationId}`,
    },
    policy: {
      autoSubmit: false,
      requiresFounderMode: true,
      portalSubmission: "manual_grants_gov",
      monitoring: "hq_notifications_after_confirm",
    },
    summary: [
      `Best live grant: ${top.title} (${top.funder}) — fit ${top.matchScore}/100 for ${top.bestProgram.label}.`,
      `Application ${applicationId} drafted and staged for your approval.`,
      kbGaps.length ? `Missing info: ${kbGaps.slice(0, 3).join("; ")}` : "Organizational grounding looks complete.",
      "After you approve, complete Grants.gov in the portal, then confirm the confirmation ID so AURA can monitor and notify you.",
    ].join(" "),
    generatedAt: new Date().toISOString(),
  };
}

async function identifyMissingOrganizationalInfo(opportunityTitle: string, programLabel: string): Promise<string[]> {
  const queries = [
    "IFCDC mission vision organizational history",
    `${programLabel} program description outcomes`,
    "IFCDC budget fringe benefits indirect cost",
    "board of directors governance",
    "UEI SAM registration DUNS",
  ];
  const gaps: string[] = [];
  for (const q of queries) {
    try {
      const chunks = await retrieveKnowledge(`${q} ${opportunityTitle}`, { topK: 2 });
      if (!chunks.length) gaps.push(`No Knowledge Base coverage for: ${q}`);
    } catch {
      gaps.push(`Could not verify Knowledge Base for: ${q}`);
    }
  }
  return gaps;
}

export async function buildGrantSubmissionPackage(applicationId: string) {
  const gate = await assertFounderApprovedForSubmit(applicationId);
  const workspace = await buildFullApplicationWorkspace(applicationId);
  const db = await getDb();
  const app = (await db.get(
    `SELECT a.*, o.title as opportunity_title, o.url as opportunity_url, o.funder, o.external_id
     FROM grant_applications a
     LEFT JOIN grant_opportunities o ON o.id = a.opportunity_id
     WHERE a.id = ?`,
    applicationId
  )) as Record<string, unknown> | undefined;

  return {
    applicationId,
    founderGate: gate.ok
      ? { ready: true }
      : { ready: false, error: "ok" in gate && !gate.ok ? gate.error : "Not ready", code: "ok" in gate && !gate.ok ? gate.code : "blocked" },
    checklist: [
      "Confirm Founder approval is recorded in HQ",
      "Open Grants.gov (or funder portal) using the opportunity URL",
      "Upload proposal sections and required attachments from Grant Writer Studio",
      "Complete portal forms with IFCDC organizational data (UEI, contacts, budget)",
      "Submit in the portal and copy the confirmation / tracking ID",
      "Confirm portal submission in HQ with the confirmation ID",
      "AURA monitors HQ status and notifies on aging / award / decline",
    ],
    opportunityUrl: app?.opportunity_url ?? null,
    opportunityTitle: app?.opportunity_title ?? app?.title,
    funder: app?.funder,
    workspace,
    confirmEndpoint: `/api/hq/grants/applications/${applicationId}/confirm-portal-submission`,
    generatedAt: new Date().toISOString(),
  };
}

export async function monitorGrantApplication(applicationId: string) {
  const db = await getDb();
  const app = (await db.get(
    `SELECT a.*, o.title as opportunity_title, o.deadline, o.funder
     FROM grant_applications a
     LEFT JOIN grant_opportunities o ON o.id = a.opportunity_id
     WHERE a.id = ?`,
    applicationId
  )) as Record<string, unknown> | undefined;
  if (!app) return { ok: false, error: "Application not found" };

  const notifications = await db.all(
    `SELECT * FROM grant_notifications WHERE grant_entity_id = ? ORDER BY created_at DESC LIMIT 20`,
    applicationId
  );

  const status = String(app.status ?? "draft");
  const daysSinceSubmit =
    app.submitted_at != null
      ? Math.floor((Date.now() - new Date(String(app.submitted_at)).getTime()) / 86_400_000)
      : null;

  return {
    ok: true,
    applicationId,
    title: app.title,
    opportunityTitle: app.opportunity_title,
    funder: app.funder,
    status,
    pipelineStage: app.pipeline_stage,
    founderApproval: app.founder_approval_status,
    readyToSubmit: Number(app.ready_to_submit) === 1,
    portalConfirmationId: app.portal_confirmation_id ?? null,
    submittedAt: app.submitted_at,
    daysSinceSubmit,
    deadline: app.deadline,
    notifications,
    nextAction:
      status === "draft" && app.founder_approval_status !== "approved"
        ? "Awaiting Founder approval"
        : status === "draft" && Number(app.ready_to_submit) === 1
          ? "Complete Grants.gov portal submission and confirm ID in HQ"
          : status === "submitted" || status === "under_review"
            ? "Monitoring — AURA will notify on aging, award, or decline updates"
            : status === "awarded"
              ? "Awarded — activate finance and compliance"
              : "Review application status in Grant Center",
    generatedAt: new Date().toISOString(),
  };
}

export { setFounderApproval, confirmPortalSubmission };
