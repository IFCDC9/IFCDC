/**
 * AURA Technical Command Mode — Founder-only live ops intelligence for IFCDC HQ.
 *
 * Safe by design:
 * - Diagnose, brief, open repair tickets, recommend fixes, run read-only health checks.
 * - NEVER delete data, change secrets, force-push, deploy unreviewed code,
 *   restart critical services, or make irreversible changes without Founder approval.
 */
import crypto from "crypto";
import { getDb } from "../db";
import { getBuildInfo } from "../buildInfo";
import { checkIfcdcServices } from "../lib/ifcdc";
import { getEmailDeliveryStatus, probeResendSender } from "../lib/notifications";
import { logHqAudit } from "./hqAuditLog";
import { createLeadershipAlert } from "./criticalAlerts";
import { fetchGitHubIntegrationSnapshot } from "./githubIntegrationEngine";
import { buildIntegrationsHubSafe } from "./integrationsHubEngine";
import { buildExecutiveHealthSummary } from "./auraExecutiveAssistant";
import { getTwilioEnvStatus } from "./twilioIntegrationEngine";
import { getFounderPhoneReadiness } from "./auraFounderTrustEngine";
import { getSuperAdminEmail } from "../config/credentials";

export type TechSeverity = "critical" | "high" | "medium" | "low";
export type TechRiskLevel = "none" | "low" | "medium" | "high" | "critical";
export type TechFindingStatus = "ok" | "warning" | "degraded" | "failed" | "unknown";

export type TechFinding = {
  id: string;
  module: string;
  title: string;
  status: TechFindingStatus;
  severity: TechSeverity;
  detail: string;
  recommendedFix?: string;
  needsFounderApproval?: boolean;
};

export type TechBriefing = {
  overallScore: number;
  overallLabel: "healthy" | "degraded" | "critical" | "unknown";
  generatedAt: string;
  liveCommit: string | null;
  githubCommit: string | null;
  deployAligned: boolean | null;
  findings: TechFinding[];
  critical: TechFinding[];
  warnings: TechFinding[];
  priorities: string[];
  approvalsNeeded: string[];
  recentUpdates: string[];
  speechSummary: string;
  smsSummary: string;
};

export type TechCommandResult = {
  ok: boolean;
  blocked?: boolean;
  requiresFounderApproval?: boolean;
  riskLevel: TechRiskLevel;
  action: string;
  module: string;
  reply: string;
  briefing?: TechBriefing;
  ticketId?: string;
  findings?: TechFinding[];
};

const DANGEROUS_TECH_PATTERNS: { re: RegExp; verb: string }[] = [
  { re: /\b(delete|purge|wipe|erase)\b.*\b(data|database|production|records?)\b/i, verb: "delete production data" },
  { re: /\b(change|rotate|reset|update)\b.*\b(secret|password|api.?key|token|credential)\b/i, verb: "change secrets" },
  { re: /\bforce[- ]?push\b/i, verb: "force-push Git history" },
  { re: /\b(deploy|ship|release)\b.*\b(unreviewed|without.?review|force)\b/i, verb: "deploy unreviewed code" },
  { re: /\b(restart|reboot|kill|stop)\b.*\b(service|server|render|production|database)\b/i, verb: "restart critical services" },
  { re: /\b(drop|truncate)\b.*\b(table|database|schema)\b/i, verb: "irreversible database change" },
];

let tablesReady = false;

export async function ensureTechCommandTables(): Promise<void> {
  if (tablesReady) return;
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS aura_tech_repair_tickets (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      severity TEXT NOT NULL DEFAULT 'medium',
      status TEXT NOT NULL DEFAULT 'open',
      category TEXT,
      source_command TEXT,
      diagnosis_json TEXT,
      proposed_actions_json TEXT,
      founder_approved INTEGER DEFAULT 0,
      founder_approved_at TEXT,
      founder_approved_by TEXT,
      resolved_at TEXT,
      resolution_notes TEXT,
      actor_email TEXT,
      channel TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_aura_tech_tickets_status ON aura_tech_repair_tickets(status);
    CREATE INDEX IF NOT EXISTS idx_aura_tech_tickets_created ON aura_tech_repair_tickets(created_at DESC);

    CREATE TABLE IF NOT EXISTS aura_tech_audit_log (
      id TEXT PRIMARY KEY,
      ticket_id TEXT,
      action TEXT NOT NULL,
      command TEXT,
      result_status TEXT,
      detail TEXT,
      module TEXT,
      risk_level TEXT,
      metadata_json TEXT,
      actor_email TEXT,
      channel TEXT,
      founder_mode INTEGER NOT NULL DEFAULT 1,
      founder_approved INTEGER DEFAULT 0,
      approval_status TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_aura_tech_audit_created ON aura_tech_audit_log(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_aura_tech_audit_action ON aura_tech_audit_log(action);
  `);
  tablesReady = true;
}

export async function logTechAudit(opts: {
  action: string;
  command?: string;
  resultStatus?: string;
  detail?: string;
  module?: string;
  riskLevel?: TechRiskLevel;
  ticketId?: string;
  actorEmail?: string | null;
  channel?: string;
  founderMode?: boolean;
  founderApproved?: boolean;
  approvalStatus?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await ensureTechCommandTables();
    const db = await getDb();
    await db.run(
      `INSERT INTO aura_tech_audit_log (
        id, ticket_id, action, command, result_status, detail, module, risk_level,
        metadata_json, actor_email, channel, founder_mode, founder_approved, approval_status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      crypto.randomUUID(),
      opts.ticketId ?? null,
      opts.action,
      opts.command ?? null,
      opts.resultStatus ?? null,
      opts.detail ?? null,
      opts.module ?? "technical",
      opts.riskLevel ?? "none",
      opts.metadata ? JSON.stringify(opts.metadata) : null,
      opts.actorEmail ?? null,
      opts.channel ?? null,
      opts.founderMode === false ? 0 : 1,
      opts.founderApproved ? 1 : 0,
      opts.approvalStatus ?? null,
      new Date().toISOString()
    );
    await logHqAudit({
      action: `aura_tech_${opts.action}`,
      entityType: "aura_tech_command",
      entityId: opts.ticketId,
      detail: opts.detail || opts.command || opts.action,
      actorEmail: opts.actorEmail || undefined,
      metadata: {
        module: opts.module,
        riskLevel: opts.riskLevel,
        resultStatus: opts.resultStatus,
        approvalStatus: opts.approvalStatus,
        ...(opts.metadata || {}),
      },
    });
  } catch (err) {
    console.error("[aura-tech] audit log error:", err);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

function scoreFromFindings(findings: TechFinding[]): { score: number; label: TechBriefing["overallLabel"] } {
  if (!findings.length) return { score: 50, label: "unknown" };
  let score = 100;
  for (const f of findings) {
    if (f.status === "failed" && f.severity === "critical") score -= 25;
    else if (f.status === "failed") score -= 15;
    else if (f.status === "degraded") score -= 10;
    else if (f.status === "warning") score -= 5;
  }
  score = Math.max(0, Math.min(100, score));
  if (score >= 85) return { score, label: "healthy" };
  if (score >= 60) return { score, label: "degraded" };
  if (score > 0) return { score, label: "critical" };
  return { score, label: "critical" };
}

function formatSpeechBriefing(b: Omit<TechBriefing, "speechSummary" | "smsSummary">): string {
  const topCritical = b.critical.slice(0, 3).map((f) => f.title).join("; ");
  const topWarn = b.warnings.slice(0, 3).map((f) => f.title).join("; ");
  const align =
    b.deployAligned === true
      ? `GitHub and Render are aligned on commit ${b.liveCommit || "unknown"}.`
      : b.deployAligned === false
        ? `Render is on ${b.liveCommit || "unknown"} while GitHub main is ${b.githubCommit || "unknown"}.`
        : "Deploy alignment is unknown.";
  const fixFirst = b.priorities.slice(0, 3).join("; ") || "No urgent fixes queued.";
  return [
    `Technical Command briefing. Overall health score ${b.overallScore} out of 100 — ${b.overallLabel}.`,
    align,
    topCritical ? `Critical: ${topCritical}.` : "No critical failures detected.",
    topWarn ? `Warnings: ${topWarn}.` : "No major warnings.",
    `Fix first: ${fixFirst}.`,
    b.approvalsNeeded.length
      ? `Founder approvals needed: ${b.approvalsNeeded.slice(0, 2).join("; ")}.`
      : "No Founder approvals pending from Technical Command.",
  ].join(" ");
}

function formatSmsBriefing(b: Omit<TechBriefing, "speechSummary" | "smsSummary">): string {
  const crit = b.critical.slice(0, 2).map((f) => `CRIT:${f.title}`).join(" | ");
  const warn = b.warnings.slice(0, 2).map((f) => `WARN:${f.title}`).join(" | ");
  return [
    `AURA Tech: score ${b.overallScore}/100 (${b.overallLabel})`,
    `Live ${b.liveCommit || "?"} · GH ${b.githubCommit || "?"} · ${b.deployAligned === true ? "aligned" : b.deployAligned === false ? "MISALIGNED" : "align?"}`,
    crit || "No critical",
    warn || "No warnings",
    `Next: ${b.priorities[0] || "monitor"}`,
  ].join("\n").slice(0, 1400);
}

/** Aggregate live HQ technical health for Founder briefing. */
export async function buildTechnicalCommandBriefing(): Promise<TechBriefing> {
  const findings: TechFinding[] = [];
  const recentUpdates: string[] = [];
  const build = getBuildInfo();
  const liveCommit = (process.env.RENDER_GIT_COMMIT || build.commit || "").slice(0, 7) || null;

  const [github, hub, services, executive, emailProbe, twilio, founderPhones] = await Promise.all([
    withTimeout(fetchGitHubIntegrationSnapshot(), 4_000, null),
    withTimeout(buildIntegrationsHubSafe(), 8_000, null),
    withTimeout(checkIfcdcServices(), 3_000, {} as Record<string, boolean>),
    withTimeout(buildExecutiveHealthSummary(), 4_000, null),
    withTimeout(probeResendSender(), 4_000, null),
    Promise.resolve(getTwilioEnvStatus()),
    withTimeout(getFounderPhoneReadiness(), 2_000, null),
  ]);

  const githubCommit = github?.latestCommit || null;
  const deployAligned =
    github?.deploymentStatus === "aligned"
      ? true
      : github?.deploymentStatus === "behind" || github?.deploymentStatus === "ahead"
        ? false
        : null;

  if (github) {
    recentUpdates.push(
      `GitHub ${github.repository}@${github.branch}: ${github.latestCommit || "unknown"} (${github.message})`
    );
    if (github.repositoryHealth === "unavailable") {
      findings.push({
        id: "github-unavailable",
        module: "github",
        title: "GitHub API unavailable",
        status: "failed",
        severity: "high",
        detail: github.message,
        recommendedFix: "Check GITHUB_TOKEN on Render and GitHub API status.",
      });
    } else if (github.deploymentStatus === "behind") {
      findings.push({
        id: "deploy-behind",
        module: "render",
        title: "Render behind GitHub main",
        status: "degraded",
        severity: "high",
        detail: `Live ${liveCommit} vs GitHub ${githubCommit}`,
        recommendedFix: "Manual Deploy on Render to latest main after review.",
        needsFounderApproval: true,
      });
    } else {
      findings.push({
        id: "github-ok",
        module: "github",
        title: "GitHub / deploy tracking",
        status: "ok",
        severity: "low",
        detail: github.message,
      });
    }
  } else {
    findings.push({
      id: "github-timeout",
      module: "github",
      title: "GitHub health check timed out",
      status: "warning",
      severity: "medium",
      detail: "Could not reach GitHub within timeout.",
    });
  }

  findings.push({
    id: "hq-live-commit",
    module: "render",
    title: "Production commit",
    status: liveCommit ? "ok" : "warning",
    severity: liveCommit ? "low" : "medium",
    detail: liveCommit
      ? `IFCDC HQ live commit ${liveCommit}${build.builtAt ? ` built ${build.builtAt}` : ""}`
      : "Live commit unknown",
  });
  if (liveCommit) recentUpdates.push(`Render live commit ${liveCommit}`);

  const emailStatus = getEmailDeliveryStatus();
  if (!emailStatus.configured) {
    findings.push({
      id: "resend-missing",
      module: "resend",
      title: "RESEND_API_KEY missing",
      status: "failed",
      severity: "critical",
      detail: "Founder OTP and HQ email cannot send.",
      recommendedFix: "Set RESEND_API_KEY on Render and redeploy.",
      needsFounderApproval: true,
    });
  } else if (emailProbe && !emailProbe.ok) {
    findings.push({
      id: "resend-domain",
      module: "resend",
      title: "Resend sender domain issue",
      status: "degraded",
      severity: "high",
      detail: emailProbe.error || `From ${emailProbe.from} may be unverified`,
      recommendedFix: "Verify ifcdc.org in Resend, or keep verified-domain fallback.",
    });
  } else {
    findings.push({
      id: "resend-ok",
      module: "resend",
      title: "Resend email ready",
      status: "ok",
      severity: "low",
      detail: `From ${emailStatus.from}`,
    });
  }

  if (!twilio.ready) {
    findings.push({
      id: "twilio-degraded",
      module: "twilio",
      title: "Twilio not ready",
      status: "failed",
      severity: "critical",
      detail: "HQ voice/SMS line may be down.",
      recommendedFix: "Verify TWILIO_ACCOUNT_SID, AUTH_TOKEN, and TWILIO_PHONE_NUMBER on Render.",
      needsFounderApproval: true,
    });
  } else {
    findings.push({
      id: "twilio-ok",
      module: "twilio",
      title: "Twilio HQ line ready",
      status: "ok",
      severity: "low",
      detail: `Phone ${twilio.phoneNumber || "configured"}`,
    });
  }

  if (founderPhones) {
    const unmatched = Object.entries(founderPhones.matchTests || {})
      .filter(([phone, ok]) => !ok && phone !== "+15555550100" && phone !== "+13313168167")
      .map(([phone]) => phone);
    if (unmatched.length) {
      findings.push({
        id: "founder-phones",
        module: "aura",
        title: "Founder trusted phones incomplete",
        status: "warning",
        severity: "medium",
        detail: `Not loaded: ${unmatched.join(", ")}`,
        recommendedFix: "Set FOUNDER_TRUSTED_PHONES on Render.",
      });
    }
  }

  if (hub && typeof hub === "object" && Array.isArray((hub as { integrations?: unknown }).integrations)) {
    const hubPayload = hub as unknown as {
      integrations: Array<{
        id: string;
        name?: string;
        status?: string;
        health?: { healthy?: boolean; message?: string };
      }>;
      summary?: { connected?: number; total?: number };
    };
    const integrations = hubPayload.integrations;
    const degradedList = integrations.filter(
      (i) => i.status === "degraded" || i.health?.healthy === false
    );
    const notConfigured = integrations.filter((i) => i.status === "not_configured");
    for (const item of degradedList.slice(0, 8)) {
      findings.push({
        id: `integration-${item.id}`,
        module: "integrations",
        title: `${item.name || item.id} degraded`,
        status: "degraded",
        severity: "high",
        detail: item.health?.message || `${item.id} reports degraded`,
        recommendedFix: `Open Integrations Hub and retest ${item.id}.`,
      });
    }
    if (!degradedList.length) {
      findings.push({
        id: "integrations-ok",
        module: "integrations",
        title: "Integrations Hub",
        status: "ok",
        severity: "low",
        detail: `${hubPayload.summary?.connected ?? 0}/${hubPayload.summary?.total ?? integrations.length} connected; ${notConfigured.length} not configured`,
      });
    }
  } else {
    findings.push({
      id: "integrations-timeout",
      module: "integrations",
      title: "Integrations Hub timed out",
      status: "warning",
      severity: "medium",
      detail: "Could not aggregate Integrations Hub within timeout.",
    });
  }

  const serviceEntries = Object.entries(services || {});
  const down = serviceEntries.filter(([, ok]) => !ok).map(([name]) => name);
  if (down.length) {
    findings.push({
      id: "microservices-down",
      module: "platform",
      title: "IFCDC microservices unreachable",
      status: "degraded",
      severity: "medium",
      detail: `Down/unreachable: ${down.join(", ")}`,
      recommendedFix: "HQ uses inline fallbacks in production for some services; verify ports 4100–4104 if required.",
    });
  } else if (serviceEntries.length) {
    findings.push({
      id: "microservices-ok",
      module: "platform",
      title: "Platform microservices",
      status: "ok",
      severity: "low",
      detail: `${serviceEntries.length} service probes completed`,
    });
  }

  if (executive && typeof executive === "object") {
    const ex = executive as {
      organizationHealth?: number;
      grade?: string;
      risks?: Array<{ level?: string; area?: string; detail?: string }>;
      pendingApprovals?: number;
      recommendations?: string[];
    };
    const highRisks = (ex.risks || []).filter((r) => r.level === "high");
    if (highRisks.length) {
      findings.push({
        id: "executive-health",
        module: "executive",
        title: "Executive health risks elevated",
        status: "degraded",
        severity: "high",
        detail: highRisks.map((r) => `${r.area}: ${r.detail}`).join("; "),
        recommendedFix: "Open AURA Executive Health / Mission Control in HQ.",
      });
    } else {
      findings.push({
        id: "executive-ok",
        module: "executive",
        title: "Executive / Mission health",
        status: "ok",
        severity: "low",
        detail: `Org health ${ex.organizationHealth ?? "n/a"} (${ex.grade ?? "n/a"}); ${ex.pendingApprovals ?? 0} pending approvals`,
      });
    }
    if (ex.recommendations?.length) {
      recentUpdates.push(...ex.recommendations.slice(0, 2));
    }
  }

  const critical = findings.filter((f) => f.status === "failed" || (f.status === "degraded" && f.severity === "critical") || f.severity === "critical");
  const warnings = findings.filter(
    (f) => !critical.includes(f) && (f.status === "warning" || f.status === "degraded" || f.severity === "high")
  );
  const priorities = [...critical, ...warnings]
    .map((f) => f.recommendedFix || f.title)
    .filter(Boolean)
    .slice(0, 6);
  const approvalsNeeded = findings
    .filter((f) => f.needsFounderApproval)
    .map((f) => f.title);

  const { score, label } = scoreFromFindings(findings);
  const base = {
    overallScore: score,
    overallLabel: label,
    generatedAt: new Date().toISOString(),
    liveCommit,
    githubCommit,
    deployAligned,
    findings,
    critical,
    warnings,
    priorities,
    approvalsNeeded,
    recentUpdates,
  };

  return {
    ...base,
    speechSummary: formatSpeechBriefing(base),
    smsSummary: formatSmsBriefing(base),
  };
}

export function detectDangerousTechCommand(command: string): string | null {
  for (const { re, verb } of DANGEROUS_TECH_PATTERNS) {
    if (re.test(command)) return verb;
  }
  return null;
}

export function wantsTechnicalCommand(message: string): boolean {
  const m = message.trim();
  if (!m) return false;
  return (
    /\b(technical command|tech command|system (report|health|status)|platform (health|status)|hq health|check (the )?(entire )?system|smoke test|failed (deploy|deployment|api|apis)|render deploy|compare github|integrations?\b.*\b(check|status)|broken button|what needs my attention|what should be fixed|incident report|repair task|tech briefing|is (ifcdc )?hq healthy|apis? timing out|pages? crashing|security warning)\b/i.test(m)
    || /\b(check|inspect|diagnose|audit)\b.*\b(render|github|twilio|openai|paypal|resend|grants\.gov|sam\.gov|mission control|grant center)\b/i.test(m)
    || /\bwhy\b.*\b(page|api|button|deploy|integration)\b.*\b(fail|broken|down|error)/i.test(m)
  );
}

function classifyTechIntent(command: string): {
  action: string;
  module: string;
  openTicket: boolean;
  focusIntegrations: boolean;
  focusDeploy: boolean;
  focusApis: boolean;
} {
  const openTicket = /\b(create|open|file|make)\b.*\b(repair|ticket|task|incident)\b/i.test(command)
    || /\brepair task\b/i.test(command)
    || /\bincident report\b/i.test(command);
  const focusIntegrations = /\bintegration/i.test(command)
    || /\b(twilio|openai|paypal|resend|grants\.gov|sam\.gov|github|render)\b/i.test(command);
  const focusDeploy = /\b(deploy|render|github|commit|aligned|alignment)\b/i.test(command);
  const focusApis = /\b(api|timeout|502|endpoint|smoke)\b/i.test(command);
  let action = "briefing";
  if (openTicket) action = "open_ticket";
  else if (focusDeploy) action = "deploy_status";
  else if (focusIntegrations) action = "integrations_status";
  else if (focusApis) action = "api_status";
  else if (/\bsmoke test\b/i.test(command)) action = "smoke_check";
  const module = focusDeploy
    ? "render"
    : focusIntegrations
      ? "integrations"
      : focusApis
        ? "api"
        : "technical";
  return { action, module, openTicket, focusIntegrations, focusDeploy, focusApis };
}

export async function createTechRepairTicket(opts: {
  title: string;
  description: string;
  severity?: TechSeverity;
  category?: string;
  sourceCommand?: string;
  diagnosis?: unknown;
  proposedActions?: string[];
  actorEmail?: string | null;
  channel?: string;
  notifyFounder?: boolean;
}): Promise<{ id: string; title: string }> {
  await ensureTechCommandTables();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const db = await getDb();
  await db.run(
    `INSERT INTO aura_tech_repair_tickets (
      id, title, description, severity, status, category, source_command,
      diagnosis_json, proposed_actions_json, actor_email, channel, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    opts.title,
    opts.description,
    opts.severity || "medium",
    opts.category || "platform",
    opts.sourceCommand || null,
    opts.diagnosis ? JSON.stringify(opts.diagnosis) : null,
    opts.proposedActions ? JSON.stringify(opts.proposedActions) : null,
    opts.actorEmail || null,
    opts.channel || null,
    now,
    now
  );

  await createLeadershipAlert({
    alertType: "technical",
    title: `Repair ticket: ${opts.title}`,
    message: opts.description.slice(0, 400),
    priority: opts.severity === "critical" || opts.severity === "high" ? "high" : "normal",
    sourceModule: "aura_technical",
    sourceId: id,
    path: "/hq/aura",
  });

  await logTechAudit({
    action: "open_ticket",
    ticketId: id,
    command: opts.sourceCommand,
    resultStatus: "ok",
    detail: opts.title,
    module: opts.category || "technical",
    riskLevel: "low",
    actorEmail: opts.actorEmail,
    channel: opts.channel,
    metadata: { severity: opts.severity },
  });

  return { id, title: opts.title };
}

export async function listOpenTechRepairTickets(limit = 10): Promise<unknown[]> {
  await ensureTechCommandTables();
  const db = await getDb();
  return db.all(
    `SELECT id, title, severity, status, category, created_at, updated_at
     FROM aura_tech_repair_tickets
     WHERE status NOT IN ('resolved', 'wont_fix')
     ORDER BY created_at DESC LIMIT ?`,
    limit
  );
}

/** Founder-only Technical Command handler for voice/SMS/HQ. */
export async function handleTechnicalCommand(opts: {
  command: string;
  channel: "voice" | "sms" | "hq_web";
  actorEmail?: string | null;
  founderMode: boolean;
  founderApproved?: boolean;
}): Promise<TechCommandResult> {
  const command = opts.command.trim();
  if (!opts.founderMode) {
    return {
      ok: false,
      blocked: true,
      riskLevel: "none",
      action: "denied",
      module: "technical",
      reply:
        "Technical Command Mode requires Founder Mode. Say verify founder and enter your six-digit code first.",
    };
  }

  const dangerous = detectDangerousTechCommand(command);
  if (dangerous && !opts.founderApproved) {
    await logTechAudit({
      action: "blocked_dangerous",
      command,
      resultStatus: "blocked",
      detail: `Blocked: ${dangerous}`,
      riskLevel: "critical",
      actorEmail: opts.actorEmail || getSuperAdminEmail(),
      channel: opts.channel,
      approvalStatus: "required",
      metadata: { verb: dangerous },
    });
    return {
      ok: false,
      blocked: true,
      requiresFounderApproval: true,
      riskLevel: "critical",
      action: "blocked_dangerous",
      module: "technical",
      reply: `I cannot ${dangerous} without your explicit Founder approval. I can diagnose, collect logs, open a repair ticket for Tessa, and recommend a safe fix instead. Say create a repair task if you want that.`,
    };
  }

  const intent = classifyTechIntent(command);
  const briefing = await buildTechnicalCommandBriefing();

  let reply: string;
  let ticketId: string | undefined;
  let findings = briefing.findings;

  if (intent.focusDeploy) {
    reply =
      opts.channel === "sms"
        ? [
            `Deploy: live ${briefing.liveCommit || "?"} · GitHub ${briefing.githubCommit || "?"} · ${briefing.deployAligned === true ? "ALIGNED" : briefing.deployAligned === false ? "NOT ALIGNED" : "UNKNOWN"}`,
            briefing.priorities[0] || "No deploy action required",
          ].join("\n")
        : `Deploy status: production is on commit ${briefing.liveCommit || "unknown"}. GitHub main is ${briefing.githubCommit || "unknown"}. ${
            briefing.deployAligned === true
              ? "They are aligned."
              : briefing.deployAligned === false
                ? "They are not aligned — Manual Deploy on Render may be needed after your review."
                : "Alignment could not be confirmed."
          }`;
  } else if (intent.focusIntegrations) {
    const degraded = briefing.findings.filter((f) => f.module === "integrations" && f.status !== "ok");
    findings = degraded.length ? degraded : briefing.findings.filter((f) => ["twilio", "resend", "github", "integrations"].includes(f.module));
    reply =
      opts.channel === "sms"
        ? `Integrations: ${findings.filter((f) => f.status !== "ok").map((f) => f.title).slice(0, 4).join(" | ") || "no degraded integrations"}`
        : findings.filter((f) => f.status !== "ok").length
          ? `Integration check: ${findings
              .filter((f) => f.status !== "ok")
              .slice(0, 5)
              .map((f) => `${f.title} — ${f.detail}`)
              .join(". ")}`
          : "Integration check: no degraded integrations detected in the live hub snapshot.";
  } else if (intent.focusApis || intent.action === "smoke_check") {
    reply =
      opts.channel === "sms"
        ? `API/smoke: score ${briefing.overallScore}/100 · ${briefing.critical[0]?.title || "no critical API failures in live probes"}`
        : `Safe live smoke/health probes score ${briefing.overallScore} out of 100. ${
            briefing.critical.length
              ? `Critical items: ${briefing.critical.map((f) => f.title).join("; ")}.`
              : "No critical API failures in the live probes I can run safely from production."
          } I do not auto-run destructive tests or unreviewed deploys.`;
  } else {
    reply = opts.channel === "sms" ? briefing.smsSummary : briefing.speechSummary;
  }

  if (intent.openTicket) {
    const top = briefing.critical[0] || briefing.warnings[0];
    const ticket = await createTechRepairTicket({
      title: top?.title || "Founder-requested technical repair",
      description:
        top?.detail
        || `Opened from Technical Command: ${command.slice(0, 240)}`,
      severity: top?.severity || (briefing.overallLabel === "critical" ? "critical" : "medium"),
      category: top?.module || intent.module,
      sourceCommand: command,
      diagnosis: {
        overallScore: briefing.overallScore,
        overallLabel: briefing.overallLabel,
        liveCommit: briefing.liveCommit,
        githubCommit: briefing.githubCommit,
        priorities: briefing.priorities,
      },
      proposedActions: briefing.priorities.slice(0, 5),
      actorEmail: opts.actorEmail || getSuperAdminEmail(),
      channel: opts.channel,
    });
    ticketId = ticket.id;
    reply +=
      opts.channel === "sms"
        ? `\nRepair ticket ${ticket.id.slice(0, 8)} opened for Tessa.`
        : ` I opened repair ticket ${ticket.id.slice(0, 8)} for Tessa with the top finding and recommended fixes. I will not deploy or restart anything without your approval.`;
  }

  await logTechAudit({
    action: intent.action,
    command,
    resultStatus: "ok",
    detail: reply.slice(0, 500),
    module: intent.module,
    riskLevel: intent.openTicket ? "low" : "none",
    ticketId,
    actorEmail: opts.actorEmail || getSuperAdminEmail(),
    channel: opts.channel,
    metadata: {
      overallScore: briefing.overallScore,
      overallLabel: briefing.overallLabel,
      liveCommit: briefing.liveCommit,
      githubCommit: briefing.githubCommit,
    },
  });

  return {
    ok: true,
    riskLevel: intent.openTicket ? "low" : "none",
    action: intent.action,
    module: intent.module,
    reply,
    briefing,
    ticketId,
    findings,
  };
}

/** Prompt block injected only when Founder Mode is active. */
export function buildTechnicalCommandSystemBlock(): string {
  return `
═══ TECHNICAL COMMAND MODE (FOUNDER ONLY) ═══
You are also IFCDC HQ's Technical Operations Wizard — eyes and ears inside the platform.

You can inspect live production health, explain failures in plain language, prioritize fixes,
open repair tickets for Tessa, and keep the Founder informed until resolved.

When the Founder asks about system health, deployments, integrations, APIs, crashes, or what needs attention:
- Prefer invoking the live Technical Command briefing (the runtime will short-circuit known tech phrases).
- Speak clearly: overall score, critical failures, warnings, recent updates, fix-first order, approvals needed.
- Never claim a deploy or restart happened unless Founder explicitly approved and the system recorded it.

HARD SAFETY RAILS — require explicit Founder approval (do not do these yourself):
- Delete production data
- Change secrets / API keys
- Force-push Git history
- Deploy unreviewed code
- Restart critical services
- Irreversible database or infrastructure changes

Allowed without extra approval: diagnose, collect logs, create repair tickets, recommend fixes,
run safe health checks, re-test after a Founder-approved deployment, notify when resolved.
═══ END TECHNICAL COMMAND ═══`;
}
