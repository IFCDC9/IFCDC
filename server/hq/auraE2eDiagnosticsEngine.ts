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

export type ConnectionStatus = "connected" | "partial" | "missing" | "unsafe";

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
    status: "connected",
    detail: `${actions.length} registered actions (${byKind.read} read · ${byKind.prepare} prepare · ${byKind.execute} execute)`,
    route: "POST /api/hq/aura/command",
    files: ["server/hq/auraCommandLayer.ts", "server/hq/auraActionRegistry.ts"],
  });

  const auraSvc = services.aura === true;
  probes.push({
    id: "core-port-4101",
    area: "AURA Core",
    label: "Central aura-ai microservice (:4101)",
    status: auraSvc ? "partial" : "missing",
    detail: auraSvc
      ? "Health OK — HQ executive path still uses in-process OpenAI, not this service"
      : "Not reachable / not used by HQ command path (health-only dependency)",
    route: "GET /api/hq/aura/status",
    files: ["Shared/ifcdc-services.ts", "Backend/ifcdc-services/aura-ai-core"],
    env: ["IFCDC_AURA_URL"],
    risk: "low",
  });

  probes.push({
    id: "core-openai",
    area: "AURA Core",
    label: "In-process OpenAI credentials",
    status: openai?.apiKey ? "connected" : "missing",
    detail: openai?.apiKey
      ? `Configured (${openai.source || "env"}) — model path live for HQ AURA`
      : "No OpenAI / AURA API key detected",
    env: ["AURA_OPENAI_API_KEY", "OPENAI_API_KEY", "AI_INTEGRATIONS_OPENAI_API_KEY"],
    risk: openai?.apiKey ? "low" : "high",
  });

  probes.push({
    id: "core-duplicate-brains",
    area: "AURA Core",
    label: "Single unified brain",
    status: "partial",
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
    status: opts.founderMode || opts.isFounder ? "connected" : "partial",
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
    status: "connected",
    detail: "auraCommandLayer strips kind=execute unless founderMode/isFounder",
    files: ["server/hq/auraCommandLayer.ts"],
  });

  const moduleProbes: Array<{ id: string; label: string; status: ConnectionStatus; detail: string; tables?: string[] }> = [
    {
      id: "db-grants",
      label: "Grants module tools",
      status: "connected",
      detail: "find/sync/draft/submit-queue tools via registry",
      tables: ["grant_opportunities", "grant_applications"],
    },
    {
      id: "db-communications",
      label: "Communications tools",
      status: "connected",
      detail: "send_sms, send_email, notifications, broadcast tools",
      tables: ["twilio_communication_events", "hq_notification_queue"],
    },
    {
      id: "db-hr",
      label: "HR / People",
      status: "partial",
      detail: "Payroll prepare + metrics; no full HR CRUD tools",
      tables: ["people"],
    },
    {
      id: "db-finance",
      label: "Finance",
      status: "partial",
      detail: "Reports/analytics; limited finance mutate tools",
      tables: ["finance_expenses", "finance_accounts"],
    },
    {
      id: "db-donations",
      label: "Donations",
      status: "partial",
      detail: "Read funding_events; Stripe/PayPal outside AURA tools",
      tables: ["funding_events"],
    },
    {
      id: "db-compliance",
      label: "Compliance",
      status: "partial",
      detail: "generate_compliance_report + trackers",
      tables: ["compliance_filings"],
    },
    {
      id: "db-projects",
      label: "Projects / ops",
      status: "partial",
      detail: "Listed in AO/ops; no dedicated project CRUD tools",
      tables: ["ops_projects"],
    },
    {
      id: "db-barbers",
      label: "Barbers / bookings",
      status: "partial",
      detail: "Receptionist booking path only — not action-registry tools",
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
    status: twilio.ready ? "connected" : "partial",
    detail: twilio.ready
      ? `Twilio ready · from=${twilio.phoneNumber || "messaging-service"} · config NOT modified by diagnostics`
      : "Twilio SID/token/from incomplete — SMS send may fail",
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
    status: publicBase ? "connected" : "partial",
    detail: publicBase
      ? `Webhook mapped · ${webhooks.incomingSms}`
      : "PUBLIC_BASE_URL / RENDER_EXTERNAL_URL missing — webhook URLs may be incomplete",
    route: "POST /api/twilio/aura/sms",
    files: ["server/routes/twilioAura.routes.ts"],
    touchesTwilioConfig: false,
  });

  probes.push({
    id: "sms-status",
    area: "SMS",
    label: "SMS delivery status capture",
    status: hasTwilioEvents ? (twilioEvents24h != null && twilioEvents24h > 0 ? "connected" : "partial") : "missing",
    detail: hasTwilioEvents
      ? `Table live · ${twilioEvents24h ?? 0} events in last 24h · outbound AURA statusCallback optional (not changed)`
      : "twilio_communication_events table missing",
    route: "POST /api/twilio/aura/sms/status",
    tables: ["twilio_communication_events"],
    touchesTwilioConfig: false,
    risk: "low",
  });

  probes.push({
    id: "voice-core",
    area: "Voice",
    label: "Voice shares Founder trust + executive ops",
    status: "partial",
    detail: "Voice uses receptionist engine — not full runAuraCommand / action-registry / hq_aura_conversations",
    route: "POST /api/twilio/aura/voice",
    files: ["server/hq/auraReceptionistEngine.ts", "server/hq/auraCommandLayer.ts"],
    touchesTwilioConfig: false,
    risk: "medium",
  });

  probes.push({
    id: "events-realtime",
    area: "Events",
    label: "HQ realtime event bus",
    status: "partial",
    detail: "hqRealtimeEvents + WS /api/hq/ws — grants/finance strong; bookings/SMS-fail weaker",
    route: "WS /api/hq/ws",
    files: ["server/hq/hqRealtimeEvents.ts", "server/hq/hqRealtimeHub.ts"],
    risk: "medium",
  });

  probes.push({
    id: "memory-conversations",
    area: "Memory",
    label: "Per-user conversation memory",
    status: hasConvos ? "connected" : "missing",
    detail: hasConvos ? "hq_aura_conversations present" : "Conversation table missing",
    tables: ["hq_aura_conversations"],
    route: "GET /api/hq/aura/memory",
  });

  probes.push({
    id: "audit-hq",
    area: "Audit",
    label: "HQ audit log",
    status: "connected",
    detail: "logHqAudit / identity actions available",
    tables: ["hq_audit_log"],
    files: ["server/hq/hqAuditLog.ts"],
  });

  const hasUnified = await withTimeout(tableExists("aura_unified_action_log"), 3_000, false);
  probes.push({
    id: "audit-unified",
    area: "Audit",
    label: "Unified AURA action stream (Phase 2)",
    status: hasUnified ? "connected" : "partial",
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
    status: hasBrainLog ? "connected" : "partial",
    detail: hasBrainLog
      ? "Dedicated Brain v1 log live and mirrored into unified stream"
      : "Brain v1 action log table not created yet",
    tables: ["aura_enterprise_brain_v1_action_log"],
    route: "GET /api/hq/aura/brain-v1/action-log",
    risk: "low",
  });

  probes.push({
    id: "email-resend",
    area: "Communications",
    label: "Resend email transport",
    status: email.configured ? (resendProbe && (resendProbe as { ok?: boolean }).ok === false ? "partial" : "connected") : "missing",
    detail: email.configured
      ? `API key set · from=${email.from || "n/a"} · probe=${resendProbe ? "ran" : "skipped/unavailable"}`
      : "Resend not configured",
    env: ["RESEND_API_KEY", "RESEND_FROM_EMAIL"],
  });

  probes.push({
    id: "health-surfaces",
    area: "Diagnostics",
    label: "Existing health / monitoring surfaces",
    status: "connected",
    detail: "GET /api/health, /api/hq/aura/status, monitoring, enterprise-health, integrations",
    route: "GET /api/hq/monitoring/overview",
  });

  const summary = {
    connected: probes.filter((p) => p.status === "connected").length,
    partial: probes.filter((p) => p.status === "partial").length,
    missing: probes.filter((p) => p.status === "missing").length,
    unsafe: probes.filter((p) => p.status === "unsafe").length,
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
    note: "Phase 1 visibility only. Twilio credentials and webhook sync were not modified. Do not treat microservice :4101 as the executive brain until wired.",
  };
}
