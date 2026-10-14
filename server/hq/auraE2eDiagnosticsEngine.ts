/**
 * AURA E2E Connection Diagnostics — Phase 1 (read-only).
 * Aggregates live probes for the connection matrix. Does NOT modify Twilio config.
 */
import { getDb } from "../db";
import { checkIfcdcServices } from "../lib/ifcdc";
import { getEmailDeliveryStatus, probeResendSender } from "../lib/notifications";
import { resolveOpenAiCredentials } from "../lib/openaiConfig";
import { listAuraActions } from "./auraCommandLayer";
import { getTwilioEnvStatus, getTwilioWebhookUrls, getPublicBaseUrl } from "./twilioIntegrationEngine";

export type ConnectionStatus =
  | "healthy"
  | "degraded"
  | "timed out"
  | "unreachable"
  | "not configured"
  | "not deployed"
  | "unknown"
  | "configured"
  | "connected"
  | "partial"
  | "missing"
  | "unsafe";

/** A credential or registry row is configured until a live call in this check succeeds. */
export function credentialOrRegistryDisposition(
  present: boolean,
  liveSucceeded: boolean | null
): "configured" | "healthy" | "degraded" | "not configured" {
  if (!present) return "not configured";
  if (liveSucceeded === true) return "healthy";
  if (liveSucceeded === false) return "degraded";
  return "configured";
}

/** Resend-style probe: a partial or failed live check stays degraded. A skipped probe does not. */
export function resendProbeDisposition(input: {
  configured: boolean;
  probeRan: boolean;
  probeOk: boolean | null;
}): "not configured" | "configured" | "healthy" | "degraded" {
  if (!input.configured) return "not configured";
  if (!input.probeRan || input.probeOk == null) return "configured";
  return input.probeOk ? "healthy" : "degraded";
}

export function isLocalSidecarUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

/**
 * development, mvp, and planned are software-registry statuses.
 * They are not a Render deploy queue.
 */
export function pendingRenderDeployCount(statuses: string[]): number {
  return statuses.filter((status) => status === "pending-render").length;
}

const UNAVAILABLE_PROBE_STATUSES = new Set([
  "timed out",
  "unreachable",
  "not configured",
  "not deployed",
  "missing",
  "unsafe",
]);

/** Separate counts so a renamed status does not collapse the Connected card to zero. */
export function summarizeProbeStatuses(statuses: string[]): {
  configured: number;
  healthy: number;
  degraded: number;
  unavailable: number;
  unknown: number;
  connected: number;
  partial: number;
  missing: number;
  unsafe: number;
  timedOut: number;
  unreachable: number;
  notConfigured: number;
  notDeployed: number;
} {
  const configured = statuses.filter((status) => status === "configured" || status === "connected").length;
  const healthy = statuses.filter((status) => status === "healthy").length;
  const degraded = statuses.filter((status) => status === "degraded" || status === "partial").length;
  const unknown = statuses.filter((status) => status === "unknown").length;
  const unavailable = statuses.filter((status) => UNAVAILABLE_PROBE_STATUSES.has(status)).length;
  return {
    configured,
    healthy,
    degraded,
    unavailable,
    unknown,
    connected: configured + healthy,
    partial: degraded,
    missing: statuses.filter((status) => status === "missing" || status === "not configured").length,
    unsafe: statuses.filter((status) => status === "unsafe").length,
    timedOut: statuses.filter((status) => status === "timed out").length,
    unreachable: statuses.filter((status) => status === "unreachable").length,
    notConfigured: statuses.filter((status) => status === "not configured").length,
    notDeployed: statuses.filter((status) => status === "not deployed").length,
  };
}

export function commandCenterHealthyValue(input: {
  healthyCount: number;
  probesIncomplete: boolean;
  realFailureCount?: number;
  sidecarMiss?: boolean;
}): number | "timed out" | "not deployed" {
  if (input.probesIncomplete && input.healthyCount === 0) return "timed out";
  if (input.healthyCount === 0 && (input.realFailureCount ?? 0) === 0 && input.sidecarMiss) {
    return "not deployed";
  }
  return input.healthyCount;
}

export type AuraE2eProbe = {
  id: string;
  area: string;
  label: string;
  status: ConnectionStatus;
  detail: string;
  route?: string;
  files?: string[];
  env?: string[];
  tables?: string[];
  risk?: "low" | "medium" | "high";
  touchesTwilioConfig?: boolean;
};

export type AuraE2eDiagnosticsReport = {
  generatedAt: string;
  mode: "read_only";
  twilioConfigUntouched: true;
  summary: {
    connected: number;
    partial: number;
    missing: number;
    unsafe: number;
    configured: number;
    healthy: number;
    degraded: number;
    unavailable: number;
    timedOut: number;
    unreachable: number;
    notConfigured: number;
    notDeployed: number;
    unknown: number;
    actionCatalog: { total: number; read: number; prepare: number; execute: number };
  };
  identity: {
    founderMode: boolean;
    isFounder: boolean;
    email: string | null;
    assurance: string | null;
  };
  probes: AuraE2eProbe[];
  webhookUrls: ReturnType<typeof getTwilioWebhookUrls>;
  publicBaseUrl: string;
  note: string;
};

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

async function tableExists(name: string): Promise<boolean> {
  try {
    const db = await getDb();
    const row = await db.get<{ c: number }>(
      `SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name = ?`,
      name
    );
    return (row?.c ?? 0) > 0;
  } catch {
    return false;
  }
}

async function recentTwilioEventCount(hours = 24): Promise<number | null> {
  try {
    const db = await getDb();
    const since = new Date(Date.now() - hours * 3600_000).toISOString();
    const row = await db.get<{ c: number }>(
      `SELECT COUNT(*) as c FROM twilio_communication_events WHERE created_at >= ?`,
      since
    );
    return row?.c ?? 0;
  } catch {
    return null;
  }
}

export async function buildAuraE2eDiagnostics(opts: {
  founderMode: boolean;
  isFounder: boolean;
  email?: string | null;
  assurance?: string | null;
}): Promise<AuraE2eDiagnosticsReport> {
  const generatedAt = new Date().toISOString();
  const actions = listAuraActions();
  const byKind = {
    read: actions.filter((a) => a.kind === "read").length,
    prepare: actions.filter((a) => a.kind === "prepare").length,
    execute: actions.filter((a) => a.kind === "execute").length,
  };

  const [services, resendProbe, twilioEvents24h, hasConvos, hasBrainLog, hasTwilioEvents] = await Promise.all([
    withTimeout(checkIfcdcServices(), 6_000, {} as Record<string, boolean>),
    withTimeout(probeResendSender().catch(() => null), 8_000, null),
    withTimeout(recentTwilioEventCount(24), 4_000, null),
    withTimeout(tableExists("hq_aura_conversations"), 3_000, false),
    withTimeout(tableExists("aura_enterprise_brain_v1_action_log"), 3_000, false),
    withTimeout(tableExists("twilio_communication_events"), 3_000, false),
  ]);

  const twilio = getTwilioEnvStatus();
  const email = getEmailDeliveryStatus();
  const openai = resolveOpenAiCredentials();
  const publicBase = getPublicBaseUrl();
  const webhooks = getTwilioWebhookUrls();

  const probes: AuraE2eProbe[] = [];

  probes.push({
    id: "core-command-layer",
    area: "AURA Core",
    label: "HQ command dispatcher + action registry",
    status: credentialOrRegistryDisposition(actions.length > 0, null),
    detail: `${actions.length} registered actions (${byKind.read} read · ${byKind.prepare} prepare · ${byKind.execute} execute). Registry only — no live call in this check.`,
    route: "POST /api/hq/aura/command",
    files: ["server/hq/auraCommandLayer.ts", "server/hq/auraActionRegistry.ts"],
  });

  const auraSvc = services.aura === true;
  const servicesTimedOut = Object.keys(services).length === 0;
  const { getLegacy4101Summary, shouldProbeLegacy4101 } = await import("./auraLegacy4101");
  const legacy = getLegacy4101Summary();
  probes.push({
    id: "core-port-4101",
    area: "AURA Core",
    label: "Legacy aura-ai microservice (:4101) — Phase 7 deprecated",
    status: servicesTimedOut
      ? "timed out"
      : shouldProbeLegacy4101()
        ? auraSvc
          ? "healthy"
          : "unreachable"
        : "not deployed",
    detail: servicesTimedOut
      ? `timed out at ${generatedAt}. Not scored as an outage. Not the Headquarters database, Founder session, or Postmark path.`
      : shouldProbeLegacy4101()
        ? auraSvc
          ? `Probe enabled — health OK at ${generatedAt}; HQ executive path still uses in-process OpenAI (not this service)`
          : `unreachable at ${generatedAt}. Probe enabled — not reachable (optional; not required for HQ production)`
        : `not deployed. Phase 7: probe skipped by default · production path=${legacy.productionPath} · rollback=${legacy.rollback}. Not the Headquarters database, Founder session, or Postmark path.`,
    route: "GET /api/hq/aura/diagnostics/legacy-4101",
    files: [
      "server/hq/auraLegacy4101.ts",
      "Shared/ifcdc-services.ts",
      "Backend/ifcdc-services/aura-ai-core",
    ],
    env: ["IFCDC_AURA_URL", "AURA_LEGACY_4101_PROBE", "AURA_LEGACY_4101_ENABLED"],
    risk: "low",
  });

  probes.push({
    id: "core-openai",
    area: "AURA Core",
    label: "In-process OpenAI credentials",
    status: credentialOrRegistryDisposition(Boolean(openai?.apiKey), null),
    detail: openai?.apiKey
      ? `Configured (${openai.source || "env"}). Credential present. No live model call in this check.`
      : "No OpenAI / AURA API key detected",
    env: ["AURA_OPENAI_API_KEY", "OPENAI_API_KEY", "AI_INTEGRATIONS_OPENAI_API_KEY"],
    risk: openai?.apiKey ? "low" : "high",
  });

  probes.push({
    id: "core-duplicate-brains",
    area: "AURA Core",
    label: "Single unified brain",
    status: "unknown",
    detail: "Brain v1, Brain 2.0, EDI, OS4/OS5, AO, and receptionist coexist — consolidate later",
    files: [
      "server/hq/auraEnterpriseBrainV1.ts",
      "server/hq/auraEnterpriseBrain.ts",
      "server/hq/auraReceptionistEngine.ts",
    ],
    risk: "medium",
  });

  probes.push({
    id: "auth-founder",
    area: "Authorization",
    label: "Founder / Admin recognition (this session)",
    status: opts.founderMode || opts.isFounder ? "healthy" : "degraded",
    detail: opts.founderMode || opts.isFounder
      ? `Founder access active · assurance=${opts.assurance || "n/a"}`
      : "Session is not Founder Mode — execute tools will be blocked",
    files: ["server/hq/auraFounderTrustEngine.ts", "server/hq/enterpriseRoles.ts"],
    env: ["MASTER_OWNER_EMAIL", "FOUNDER_EMAIL"],
  });

  probes.push({
    id: "auth-execute-gate",
    area: "Authorization",
    label: "Execute tools require Founder Mode",
    status: "configured",
    detail: "auraCommandLayer strips kind=execute unless founderMode/isFounder. Code path only — no live call in this check.",
    files: ["server/hq/auraCommandLayer.ts"],
  });

  const moduleProbes: Array<{ id: string; label: string; status: ConnectionStatus; detail: string; tables?: string[] }> = [
    {
      id: "db-grants",
      label: "Grants module tools",
      status: "configured",
      detail: "find/sync/draft/submit-queue tools via registry. No live call in this check.",
      tables: ["grant_opportunities", "grant_applications"],
    },
    {
      id: "db-communications",
      label: "Communications tools",
      status: "configured",
      detail: "send_sms, send_email, notifications, broadcast tools. Registry only — no message sent.",
      tables: ["twilio_communication_events", "hq_notification_queue"],
    },
    {
      id: "db-hr",
      label: "HR / People",
      status: "configured",
      detail: "Phase 4: hr_workforce_summary, list_people, list_job_applicants, prepare_applicant_review + payroll prepare. Registry only.",
      tables: ["people", "job_applicants"],
    },
    {
      id: "db-finance",
      label: "Finance",
      status: "configured",
      detail: "Phase 4: finance_overview, list_pending_expenses, prepare_finance_brief. Registry only.",
      tables: ["finance_expenses", "finance_accounts"],
    },
    {
      id: "db-donations",
      label: "Donations",
      status: "configured",
      detail: "Phase 4: donation_summary, list_recent_donations (Stripe/PayPal mutate still outside AURA). Registry only.",
      tables: ["funding_events"],
    },
    {
      id: "db-compliance",
      label: "Compliance",
      status: "configured",
      detail: "generate_compliance_report + trackers. Registry only — no live filing check.",
      tables: ["compliance_filings"],
    },
    {
      id: "db-projects",
      label: "Projects / ops",
      status: "configured",
      detail: "Phase 4: list_ops_projects, prepare_ops_project (planning drafts). Registry only.",
      tables: ["ops_projects"],
    },
    {
      id: "db-barbers",
      label: "Barbers / bookings",
      status: "configured",
      detail: "Receptionist booking path only — not action-registry tools. Registry only.",
      tables: ["clients", "appointments"],
    },
  ];
  for (const m of moduleProbes) {
    probes.push({
      id: m.id,
      area: "HQ Database",
      label: m.label,
      status: m.status,
      detail: m.detail,
      tables: m.tables,
      route: "POST /api/hq/aura/command",
      risk: "low",
    });
  }

  probes.push({
    id: "sms-send",
    area: "SMS",
    label: "AURA → Twilio SMS send",
    status: credentialOrRegistryDisposition(Boolean(twilio.ready), null),
    detail: twilio.ready
      ? `Twilio credentials present · from=${twilio.phoneNumber || "messaging-service"}. Configured only — no SMS sent and no live call in this check.`
      : "Twilio SID/token/from incomplete — not configured",
    route: "POST /api/hq/aura/action/send_sms",
    files: ["server/hq/auraExecutiveOperations.ts", "server/lib/notifications.ts"],
    env: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER", "TWILIO_MESSAGING_SERVICE_SID"],
    touchesTwilioConfig: false,
    risk: twilio.ready ? "low" : "high",
  });

  probes.push({
    id: "sms-inbound",
    area: "SMS",
    label: "Inbound SMS → AURA receptionist",
    status: credentialOrRegistryDisposition(Boolean(publicBase), null),
    detail: publicBase
      ? `Webhook URL mapped · ${webhooks.incomingSms}. Configured only — no inbound message was received in this check.`
      : "PUBLIC_BASE_URL / RENDER_EXTERNAL_URL missing — webhook URLs may be incomplete",
    route: "POST /api/twilio/aura/sms",
    files: ["server/routes/twilioAura.routes.ts"],
    touchesTwilioConfig: false,
  });

  probes.push({
    id: "sms-status",
    area: "SMS",
    label: "SMS delivery status capture",
    status: credentialOrRegistryDisposition(Boolean(publicBase && webhooks.smsStatus.startsWith("https://")), null),
    detail: publicBase && webhooks.smsStatus.startsWith("https://")
      ? `Phase 6: AURA outbound SMS attaches statusCallback=${webhooks.smsStatus} (per-message; Console untouched)${
          hasTwilioEvents ? ` · ${twilioEvents24h ?? 0} events/24h` : ""
        }`
      : "Public HTTPS base missing — statusCallback omitted until RENDER_EXTERNAL_URL/PUBLIC_APP_URL is set",
    route: "POST /api/twilio/aura/sms/status",
    tables: ["twilio_communication_events"],
    env: ["AURA_SMS_STATUS_CALLBACK"],
    touchesTwilioConfig: false,
    risk: "low",
  });

  probes.push({
    id: "voice-core",
    area: "Voice",
    label: "Voice/SMS Founder path → command layer",
    status: "configured",
    detail: "Phase 3 adapter: Founder voice/SMS uses runAuraCommand (same tools/memory as HQ text). Booking path stays on receptionist. Twilio URLs untouched. No live call in this check.",
    route: "POST /api/twilio/aura/voice · /sms",
    files: [
      "server/hq/auraReceptionistCommandAdapter.ts",
      "server/hq/auraReceptionistEngine.ts",
      "server/hq/auraCommandLayer.ts",
    ],
    touchesTwilioConfig: false,
    risk: "low",
  });

  probes.push({
    id: "events-realtime",
    area: "Events",
    label: "HQ realtime + AURA operational event bus",
    status: "configured",
    detail: "Phase 5: booking/payment/SMS-fail emit notifyHqDataChange + aura_operational_events (+ leadership alerts on fail). Registry only — no live event in this check.",
    route: "WS /api/hq/ws · GET /api/hq/aura/diagnostics/operational-events",
    files: [
      "server/hq/hqRealtimeEvents.ts",
      "server/hq/auraOperationalEvents.ts",
      "server/hq/hqRealtimeHub.ts",
    ],
    tables: ["aura_operational_events"],
    risk: "low",
  });

  probes.push({
    id: "memory-conversations",
    area: "Memory",
    label: "Per-user conversation memory",
    status: hasConvos ? "healthy" : "unknown",
    detail: hasConvos
      ? `hq_aura_conversations present. Live table check succeeded at ${generatedAt}.`
      : `Conversation table was not confirmed at ${generatedAt}. Not treated as an outage.`,
    tables: ["hq_aura_conversations"],
    route: "GET /api/hq/aura/memory",
  });

  probes.push({
    id: "audit-hq",
    area: "Audit",
    label: "HQ audit log",
    status: "configured",
    detail: "logHqAudit / identity actions available. Code path only — no live audit write in this check.",
    tables: ["hq_audit_log"],
    files: ["server/hq/hqAuditLog.ts"],
  });

  const hasUnified = await withTimeout(tableExists("aura_unified_action_log"), 3_000, false);
  probes.push({
    id: "audit-unified",
    area: "Audit",
    label: "Unified AURA action stream (Phase 2)",
    status: hasUnified ? "healthy" : "unknown",
    detail: hasUnified
      ? "aura_unified_action_log live — mirrors Brain v1, command prepare/execute, executive ops, receptionist"
      : "Table created on first mirror — stream ready after first prepare/execute",
    tables: ["aura_unified_action_log"],
    route: "GET /api/hq/aura/diagnostics/unified-audit",
    files: ["server/hq/auraUnifiedAudit.ts"],
    risk: "low",
  });

  probes.push({
    id: "audit-brain-v1",
    area: "Audit",
    label: "Brain v1 action log",
    status: hasBrainLog ? "healthy" : "unknown",
    detail: hasBrainLog
      ? "Dedicated Brain v1 log live and mirrored into unified stream"
      : "Brain v1 action log table not created yet",
    tables: ["aura_enterprise_brain_v1_action_log"],
    route: "GET /api/hq/aura/brain-v1/action-log",
    risk: "low",
  });

  const resendResult = resendProbe as { ok?: boolean; error?: string } | null;
  const resendStatus = resendProbeDisposition({
    configured: Boolean(email.configured),
    probeRan: Boolean(resendResult),
    probeOk: resendResult ? resendResult.ok === true : null,
  });
  probes.push({
    id: "email-resend",
    area: "Communications",
    label: "Resend email transport",
    status: resendStatus,
    detail: !email.configured
      ? "Resend not configured"
      : resendStatus === "degraded"
        ? `degraded at ${generatedAt}. ${resendResult?.error || "Live Resend check did not succeed."}`
        : resendStatus === "healthy"
          ? `Live Resend check succeeded at ${generatedAt}.`
          : `API key set · from=${email.from || "n/a"}. Configured only — live probe did not run in this check.`,
    env: ["RESEND_API_KEY", "RESEND_FROM_EMAIL"],
  });

  probes.push({
    id: "health-surfaces",
    area: "Diagnostics",
    label: "Existing health / monitoring surfaces",
    status: "configured",
    detail: "GET /api/health, /api/hq/aura/status, monitoring, enterprise-health, integrations. Listed only — not called by this check.",
    route: "GET /api/hq/monitoring/overview",
  });

  const summary = {
    ...summarizeProbeStatuses(probes.map((probe) => probe.status)),
    actionCatalog: { total: actions.length, ...byKind },
  };

  return {
    generatedAt,
    mode: "read_only",
    twilioConfigUntouched: true,
    summary,
    identity: {
      founderMode: Boolean(opts.founderMode),
      isFounder: Boolean(opts.isFounder),
      email: opts.email ?? null,
      assurance: opts.assurance ?? null,
    },
    probes,
    webhookUrls: webhooks,
    publicBaseUrl: publicBase || "",
    note:
      "Phases 1–7: Twilio credentials/webhooks untouched. Production AURA is HQ in-process OpenAI + /api/hq/aura/* — legacy :4101 is deprecated (probe off by default).",
  };
}
