/**
 * Phase 5 Stage 1 — Aura as an auditable AI operator.
 * She is not a human login and cannot approve her own consequential actions.
 */
import { logHqAudit } from "./hqAuditLog";
import { mirrorAuraUnifiedAction } from "./auraUnifiedAudit";

export const AURA_OPERATOR_ID = "aura";
export const HUMAN_EXEC_EMAIL = "exec@ifcdc.org";

export const AURA_OPERATOR = {
  id: AURA_OPERATOR_ID,
  kind: "ai_operator" as const,
  displayName: "Aura",
  email: null,
  role: "aura" as const,
  isFounder: false as const,
  founderMode: false as const,
  isHumanLogin: false as const,
};

export const AURA_STAGE_ONE_PRIORITIES = [
  { id: "funding_opportunities", label: "Funding opportunities", module: "grants", readActionId: "find_grants" },
  { id: "recurring_revenue", label: "Recurring revenue", module: "finance", readActionId: "donation_summary" },
  { id: "organizational_growth", label: "Organizational growth", module: "operations", readActionId: "list_ops_projects" },
  { id: "engineering_development", label: "Engineering development", module: "software", readActionId: "se_portfolio_status" },
] as const;

const CONSEQUENTIAL_ACTION_IDS = new Set([
  "send_email",
  "send_sms",
  "place_call",
  "send_notification",
  "broadcast_announcement",
  "queue_grant_submission",
  "run_live_grant_workflow",
  "confirm_grant_portal_submission",
]);

export function isAuraConsequentialAction(actionId: string): boolean {
  return CONSEQUENTIAL_ACTION_IDS.has(actionId);
}

export function auraActorDistinctFrom(session: { id?: string | null; email?: string | null }): boolean {
  const email = (session.email || "").toLowerCase();
  return session.id !== AURA_OPERATOR.id
    && email !== HUMAN_EXEC_EMAIL
    && AURA_OPERATOR.email !== email;
}

export function founderApprovalAllowed(session: {
  id?: string | null;
  email?: string | null;
  role?: string | null;
  isFounder?: boolean;
}): boolean {
  const role = (session.role || "").toLowerCase();
  const email = (session.email || "").toLowerCase();
  if (session.id === AURA_OPERATOR.id) return false;
  if (email === HUMAN_EXEC_EMAIL || role === "exec" || role === "executive") return false;
  return session.isFounder === true && (role === "owner" || role === "founder");
}

export function isAuraStageOneRecommendation(command: string): boolean {
  return /^(aura recommendations|recommend priorities)\b/i.test(command.trim());
}

export function auraStageOneRecommendationText(): string {
  const lines = AURA_STAGE_ONE_PRIORITIES.map(
    (item, index) => `${index + 1}. ${item.label} — read-only ${item.readActionId}`,
  );
  return [
    "Aura recommendations. These are not executions.",
    ...lines,
    "Communications stay read-only. Aura cannot send mail, pay, submit grants, execute contracts, change permissions, or deploy.",
  ].join("\n");
}

async function mirrorAttribution(opts: {
  kind: "prepare" | "system";
  actionId: string;
  command: string;
  result: string;
  actorId: string;
  sessionEmail: string | null;
  metadata: Record<string, unknown>;
}): Promise<void> {
  await mirrorAuraUnifiedAction({
    source: "command_layer",
    channel: "hq_web",
    kind: opts.kind,
    actionId: opts.actionId,
    command: opts.command,
    result: opts.result,
    ok: true,
    userId: opts.actorId,
    userEmail: opts.sessionEmail,
    metadata: opts.metadata,
  });
}

export async function recordAuraRecommendation(opts: {
  sessionUserId: string | null;
  sessionEmail: string | null;
  summary: string;
  topic: string;
}): Promise<void> {
  const metadata = {
    auraActorId: AURA_OPERATOR.id,
    auraRole: AURA_OPERATOR.role,
    sessionUserId: opts.sessionUserId,
    sessionEmail: opts.sessionEmail,
    attribution: "aura",
    execution: false,
    topic: opts.topic,
  };
  await logHqAudit({
    action: "aura_recommendation",
    entityType: "aura_actor",
    entityId: AURA_OPERATOR.id,
    detail: opts.summary.slice(0, 400),
    actorId: AURA_OPERATOR.id,
    metadata,
  });
  await mirrorAttribution({
    kind: "prepare",
    actionId: "aura_recommendation",
    command: opts.topic,
    result: opts.summary,
    actorId: AURA_OPERATOR.id,
    sessionEmail: opts.sessionEmail,
    metadata,
  });
}

export async function recordFounderApproval(opts: {
  founderId: string;
  founderEmail: string;
  founderRole: string;
  summary: string;
}): Promise<void> {
  if (!founderApprovalAllowed({
    id: opts.founderId,
    email: opts.founderEmail,
    role: opts.founderRole,
    isFounder: true,
  })) {
    return;
  }
  const metadata = {
    approverId: opts.founderId,
    approverEmail: opts.founderEmail,
    approverRole: opts.founderRole,
    attribution: "founder",
    auraActorId: AURA_OPERATOR.id,
  };
  await logHqAudit({
    action: "aura_founder_approval",
    entityType: "aura_actor",
    entityId: AURA_OPERATOR.id,
    detail: opts.summary.slice(0, 400),
    actorId: opts.founderId,
    actorEmail: opts.founderEmail,
    metadata,
  });
  await mirrorAttribution({
    kind: "system",
    actionId: "aura_founder_approval",
    command: "founder approval",
    result: opts.summary,
    actorId: opts.founderId,
    sessionEmail: opts.founderEmail,
    metadata,
  });
}
