/**
 * Integrations Hub — enterprise connector registry with env readiness and health probes.
 */
import { getDb } from "../db";
import { pollAllApps } from "./appRegistry";
import { getGrantFeedIntegrationStatus } from "./grantFeedConnectors";
import { ensureIntegrationTables, INTEGRATION_CATALOG } from "./integrationConnectors";

export type IntegrationHubStatus =
  | "connected"
  | "configured"
  | "not_configured"
  | "degraded"
  | "coming_soon";

export type IntegrationHubAction = {
  id: string;
  label: string;
  kind: "primary" | "secondary" | "disabled";
  action?: "test" | "configure" | "oauth" | "link" | "sync";
  href?: string;
  reason?: string;
};

export type IntegrationHubDetail = {
  label: string;
  value: string;
  status?: "success" | "warning" | "muted" | "danger";
};

export type IntegrationHubCard = {
  id: string;
  name: string;
  category: string;
  description: string;
  status: IntegrationHubStatus;
  lastChecked: string;
  environmentReadiness: {
    ready: boolean;
    missing: string[];
    configured: string[];
  };
  requiredCredentials: { key: string; label: string; configured: boolean }[];
  health: { healthy: boolean; latencyMs?: number; message: string };
  details?: IntegrationHubDetail[];
  actions: IntegrationHubAction[];
};

const HUB_PROBE_TIMEOUT_MS = 2_500;
const HUB_AGGREGATE_TIMEOUT_MS = 4_000;

function envSet(key: string): boolean {
  return Boolean((process.env[key] || "").trim());
}

function credential(key: string, label: string) {
  return { key, label, configured: envSet(key) };
}

/** Deep link to Render env vars when running on Render (RENDER_SERVICE_ID is auto-injected). */
function renderEnvDashboardUrl(): string {
  const serviceId = process.env.RENDER_SERVICE_ID?.trim();
  return serviceId ? `https://dashboard.render.com/web/${serviceId}/env` : "https://dashboard.render.com";
}

async function probe<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  const started = Date.now();
  try {
    const result = await Promise.race([
      fn(),
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), HUB_PROBE_TIMEOUT_MS)),
    ]);
    console.info(`[integrations-hub] ${label} ok (${Date.now() - started}ms)`);
    return result;
  } catch (err) {
    console.warn(`[integrations-hub] ${label} failed:`, err instanceof Error ? err.message : err);
    return fallback;
  }
}

function statusFromEnv(required: string[], optional: string[] = []): IntegrationHubStatus {
  const missingRequired = required.filter((k) => !envSet(k));
  if (missingRequired.length === 0) return optional.some((k) => envSet(k)) || required.length > 0 ? "connected" : "not_configured";
  if (required.some((k) => envSet(k))) return "degraded";
  return "not_configured";
}

/** Enterprise hub states: Connected · Degraded · Not Configured */
function normalizeHubStatus(status: IntegrationHubStatus, healthy: boolean): IntegrationHubStatus {
  if (status === "coming_soon") return "not_configured";
  if (status === "configured") return healthy ? "connected" : "degraded";
  return status;
}

async function buildGrantsGovCard(feed: Awaited<ReturnType<typeof getGrantFeedIntegrationStatus>>): Promise<IntegrationHubCard> {
  const {
    probeGrantsGovApi,
    buildGrantsGovDetails,
    resolveGrantsGovHubStatus,
  } = await import("./grantsGovIntegrationEngine");

  const feedStatus = feed.grantsGov;
  const now = new Date().toISOString();

  const ggProbe = await probe("grants_gov", () => probeGrantsGovApi(), {
    healthy: false,
    apiReachable: false,
    recordCount: 0,
    latencyMs: 0,
    message: "Grants.gov probe timed out",
    source: "none" as const,
  });

  const rawStatus = resolveGrantsGovHubStatus(ggProbe, feedStatus?.status === "connected");
  const status = normalizeHubStatus(rawStatus, ggProbe.healthy);
  const details = await buildGrantsGovDetails(ggProbe, feedStatus);

  return {
    id: "grants_gov",
    name: "Grants.gov",
    category: "Federal Grants",
    description: "Live federal opportunities via public Applicant API (search2) — no API key required",
    status,
    lastChecked: feedStatus?.lastSync ?? now,
    environmentReadiness: {
      ready: ggProbe.apiReachable,
      missing: [],
      configured: ggProbe.apiReachable ? ["Public Search2 API"] : [],
    },
    requiredCredentials: [
      {
        key: "PUBLIC_SEARCH2",
        label: "Public Applicant API (no key required)",
        configured: true,
      },
    ],
    health: {
      healthy: status === "connected",
      latencyMs: ggProbe.latencyMs,
      message: ggProbe.message,
    },
    details,
    actions: [
      { id: "open-grants", label: "Open Grant Center", kind: "primary", action: "link", href: "/hq/grants" },
      { id: "test", label: "Test Connection", kind: "secondary", action: "test" },
      {
        id: "docs",
        label: "API Guide",
        kind: "secondary",
        action: "link",
        href: "https://grants.gov/api/api-guide",
      },
      {
        id: "sync",
        label: "Sync Feed",
        kind: "secondary",
        action: "link",
        href: "/hq/grants",
        reason: "Grant Center → Overview → Sync feeds",
      },
    ],
  };
}

async function buildSamGovCard(feed: Awaited<ReturnType<typeof getGrantFeedIntegrationStatus>>): Promise<IntegrationHubCard> {
  const required = ["SAM_GOV_API_KEY", "SAM_GOV_UEI"];
  const feedStatus = feed.samGov;
  const now = new Date().toISOString();
  const health = await probe("sam_gov", async () => {
    const missing = required.filter((k) => !envSet(k));
    if (missing.length) return { healthy: false, message: `Missing: ${missing.join(", ")}` };
    return {
      healthy: feedStatus?.status === "connected",
      message: feedStatus?.note ?? "SAM credentials present",
    };
  }, { healthy: false, message: "Health probe timed out" });

  return {
    id: "sam_gov",
    name: "SAM.gov",
    category: "Federal Grants",
    description: "System for Award Management entity verification and federal compliance",
    status: feedStatus?.status === "connected" ? "connected" : statusFromEnv(required),
    lastChecked: feedStatus?.lastSync ?? now,
    environmentReadiness: {
      ready: required.every((k) => envSet(k)),
      missing: required.filter((k) => !envSet(k)),
      configured: required.filter((k) => envSet(k)),
    },
    requiredCredentials: required.map((k) => credential(k, k.replace(/_/g, " "))),
    health,
    actions: [
      { id: "open-grants", label: "Open Grant Center", kind: "primary", action: "link", href: "/hq/grants" },
      { id: "test", label: "Test Connection", kind: "secondary", action: "test" },
      {
        id: "configure",
        label: required.every((k) => envSet(k)) ? "Configured on Render" : "Not configured",
        kind: required.every((k) => envSet(k)) ? "secondary" : "disabled",
        action: "configure",
        reason: "Set SAM_GOV_API_KEY and SAM_GOV_UEI on Render",
      },
    ],
  };
}

async function buildPayPalCard(): Promise<IntegrationHubCard> {
  const {
    probePayPalApi,
    buildPayPalDetails,
    resolvePayPalHubStatus,
    getPayPalEnvStatus,
    countPayPalFundingEvents,
  } = await import("./paypalIntegrationEngine");

  const envStatus = getPayPalEnvStatus();
  const now = new Date().toISOString();

  const ppProbe = await probe("paypal", () => probePayPalApi(), {
    healthy: false,
    authenticated: false,
    orderCreationOk: false,
    latencyMs: 0,
    message: "PayPal probe timed out",
    environment: "sandbox" as const,
    webhookEndpoint: "",
  });

  const paypalEvents = await countPayPalFundingEvents().catch(() => 0);
  const rawStatus = resolvePayPalHubStatus(ppProbe, envStatus.ready);
  const status = normalizeHubStatus(rawStatus, ppProbe.healthy);
  const details = buildPayPalDetails(ppProbe, envStatus, paypalEvents);

  return {
    id: "paypal",
    name: "PayPal",
    category: "Payments",
    description: "Donations and payment processing via PayPal REST API",
    status,
    lastChecked: now,
    environmentReadiness: {
      ready: envStatus.ready,
      missing: [
        !envStatus.clientIdConfigured ? "PAYPAL_CLIENT_ID" : null,
        !envStatus.clientSecretConfigured ? "PAYPAL_CLIENT_SECRET" : null,
      ].filter(Boolean) as string[],
      configured: [
        ...(envStatus.clientIdConfigured ? ["PAYPAL_CLIENT_ID"] : []),
        ...(envStatus.clientSecretConfigured ? ["PAYPAL_CLIENT_SECRET"] : []),
        ...(envStatus.envConfigured ? ["PAYPAL_ENV"] : []),
      ],
    },
    requiredCredentials: [
      credential("PAYPAL_CLIENT_ID", "PayPal Client ID"),
      credential("PAYPAL_CLIENT_SECRET", "PayPal Client Secret"),
      {
        key: "PAYPAL_ENV",
        label: `PAYPAL_ENV (${envStatus.environment})`,
        configured: envStatus.envConfigured,
      },
    ],
    health: {
      healthy: status === "connected",
      latencyMs: ppProbe.latencyMs,
      message: ppProbe.message,
    },
    details,
    actions: [
      { id: "test", label: "Test Connection", kind: "primary", action: "test" },
      {
        id: "payments",
        label: "Payments dashboard",
        kind: "secondary",
        action: "link",
        href: "/hq/finance?tab=payments",
      },
      {
        id: "configure",
        label: envStatus.ready ? "Configured" : "Configure",
        kind: "secondary",
        action: "configure",
        reason: envStatus.ready ? "PayPal credentials detected on Render" : "Set PayPal credentials on Render",
      },
      {
        id: "render-env",
        label: "Open Render Environment",
        kind: "secondary",
        action: "link",
        href: renderEnvDashboardUrl(),
      },
    ],
  };
}

async function buildResendCard(): Promise<IntegrationHubCard> {
  const required = ["RESEND_API_KEY"];
  const optional = ["RESEND_FROM_EMAIL"];
  const now = new Date().toISOString();
  const health = await probe("resend", async () => {
    if (!envSet("RESEND_API_KEY")) return { healthy: false, message: "RESEND_API_KEY not set" };
    return {
      healthy: true,
      message: envSet("RESEND_FROM_EMAIL")
        ? `Sender ${process.env.RESEND_FROM_EMAIL} configured`
        : "API key present — set RESEND_FROM_EMAIL for outbound mail",
    };
  }, { healthy: false, message: "Health probe timed out" });

  return {
    id: "resend",
    name: "Email (Resend)",
    category: "Communications",
    description: "Transactional email for Communications Center and HQ notifications",
    status: health.healthy ? "configured" : statusFromEnv(required, optional),
    lastChecked: now,
    environmentReadiness: {
      ready: envSet("RESEND_API_KEY"),
      missing: [...required, ...optional].filter((k) => !envSet(k)),
      configured: [...required, ...optional].filter((k) => envSet(k)),
    },
    requiredCredentials: [
      credential("RESEND_API_KEY", "Resend API key"),
      credential("RESEND_FROM_EMAIL", "From email address"),
    ],
    health,
    actions: [
      { id: "comms", label: "Open Communications", kind: "primary", action: "link", href: "/hq/communications" },
      { id: "test", label: "Test Connection", kind: "secondary", action: "test" },
      {
        id: "configure",
        label: envSet("RESEND_API_KEY") ? "Configured on Render" : "Not configured",
        kind: envSet("RESEND_API_KEY") ? "secondary" : "disabled",
        action: "configure",
        reason: "Set RESEND_API_KEY on Render",
      },
    ],
  };
}

async function buildOpenAiCard(): Promise<IntegrationHubCard> {
  const keys = ["OPENAI_API_KEY", "AI_INTEGRATIONS_OPENAI_API_KEY"];
  const configured = keys.filter((k) => envSet(k));
  const now = new Date().toISOString();
  const health = await probe("openai_aura", async () => {
    if (!configured.length) return { healthy: false, message: "No OpenAI API key configured" };
    return { healthy: true, message: "AURA AI service credentials present (@ifcdc/aura-ai)" };
  }, { healthy: false, message: "Health probe timed out" });

  return {
    id: "openai_aura",
    name: "OpenAI / AURA",
    category: "AI Intelligence",
    description: "Executive AURA copilot and intelligence via centralized @ifcdc/aura-ai",
    status: health.healthy ? "configured" : "not_configured",
    lastChecked: now,
    environmentReadiness: {
      ready: configured.length > 0,
      missing: configured.length ? [] : keys,
      configured,
    },
    requiredCredentials: keys.map((k) => credential(k, k.replace(/_/g, " "))),
    health,
    actions: [
      { id: "aura", label: "Open AURA", kind: "primary", action: "link", href: "/hq/aura" },
      { id: "test", label: "Test Connection", kind: "secondary", action: "test" },
      {
        id: "configure",
        label: configured.length ? "Configured on Render" : "Not configured",
        kind: configured.length ? "secondary" : "disabled",
        action: "configure",
        reason: "Set OPENAI_API_KEY on Render",
      },
    ],
  };
}

async function buildRenderCard(): Promise<IntegrationHubCard> {
  const keys = ["RENDER_GIT_COMMIT", "PUBLIC_BASE_URL"];
  const onRender = Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID);
  const commit = process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? null;
  const now = new Date().toISOString();
  const health = await probe("render", async () => {
    if (onRender && commit) {
      return { healthy: true, message: `Deployed on Render · commit ${commit}` };
    }
    if (envSet("PUBLIC_BASE_URL")) {
      return { healthy: true, message: `Public URL ${process.env.PUBLIC_BASE_URL}` };
    }
    return { healthy: false, message: "Render deployment metadata not detected" };
  }, { healthy: false, message: "Health probe timed out" });

  return {
    id: "render",
    name: "Render",
    category: "Infrastructure",
    description: "IFCDC HQ production hosting and deploy pipeline",
    status: health.healthy ? "connected" : onRender ? "degraded" : "not_configured",
    lastChecked: now,
    environmentReadiness: {
      ready: onRender || envSet("PUBLIC_BASE_URL"),
      missing: onRender ? [] : keys.filter((k) => !envSet(k)),
      configured: [...keys.filter((k) => envSet(k)), ...(onRender ? ["RENDER"] : [])],
    },
    requiredCredentials: [
      { key: "RENDER", label: "Render runtime", configured: onRender },
      { key: "RENDER_GIT_COMMIT", label: "Deploy commit", configured: Boolean(commit) },
      credential("PUBLIC_BASE_URL", "Public base URL"),
    ],
    health,
    actions: [
      {
        id: "health",
        label: "View /api/health",
        kind: "primary",
        action: "link",
        href: "/api/health",
      },
      { id: "test", label: "Test Connection", kind: "secondary", action: "test" },
      {
        id: "deploy",
        label: "Deploy via GitHub",
        kind: "secondary",
        action: "link",
        href: "https://dashboard.render.com",
      },
    ],
  };
}

async function buildGitHubCard(): Promise<IntegrationHubCard> {
  const {
    fetchGitHubIntegrationSnapshot,
    buildGitHubDetails,
    resolveGitHubHubStatus,
  } = await import("./githubIntegrationEngine");

  const required = ["GITHUB_TOKEN"];
  const now = new Date().toISOString();
  const tokenConfigured = envSet("GITHUB_TOKEN");

  const snapshot = await probe(
    "github",
    () => fetchGitHubIntegrationSnapshot(),
    {
      repository: "IFCDC9/IFCDC",
      branch: "main",
      latestCommit: null,
      latestCommitFull: null,
      latestCommitAt: null,
      lastPushAt: null,
      repositoryHealth: "unavailable" as const,
      deploymentStatus: "unknown" as const,
      liveCommit: process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? null,
      defaultBranch: null,
      archived: false,
      apiReachable: false,
      message: "GitHub probe timed out",
    }
  );

  const status = resolveGitHubHubStatus(snapshot, tokenConfigured);
  const healthy =
    status === "connected" &&
    snapshot.repositoryHealth === "healthy" &&
    snapshot.apiReachable;

  return {
    id: "github",
    name: "GitHub",
    category: "Infrastructure",
    description: "Source control and CI/CD for IFCDC Headquarters (IFCDC9/IFCDC)",
    status,
    lastChecked: now,
    environmentReadiness: {
      ready: tokenConfigured,
      missing: required.filter((k) => !envSet(k)),
      configured: required.filter((k) => envSet(k)),
    },
    requiredCredentials: required.map((k) => credential(k, "GitHub personal access token")),
    health: {
      healthy,
      latencyMs: snapshot.latencyMs,
      message: snapshot.message,
    },
    details: buildGitHubDetails(snapshot),
    actions: [
      {
        id: "repo",
        label: "Open Repository",
        kind: "primary",
        action: "link",
        href: `https://github.com/${snapshot.repository}`,
      },
      { id: "test", label: "Test Connection", kind: "secondary", action: "test" },
      {
        id: "verify",
        label: "Verify Deploy",
        kind: "secondary",
        action: "link",
        href: "/api/health",
        reason: "Compare live Render commit with GitHub main",
      },
      {
        id: "configure",
        label: tokenConfigured ? "Configured" : "Configure",
        kind: tokenConfigured ? "secondary" : "secondary",
        action: "configure",
        reason: tokenConfigured ? "GITHUB_TOKEN detected on Render" : "Add GITHUB_TOKEN in Render → Environment",
      },
      {
        id: "render-env",
        label: "Open Render Environment",
        kind: "secondary",
        action: "link",
        href: renderEnvDashboardUrl(),
      },
    ],
  };
}

async function buildPostgresCard(): Promise<IntegrationHubCard> {
  const keys = ["DATABASE_URL"];
  const now = new Date().toISOString();
  const health = await probe("postgres", async () => {
    if (!envSet("DATABASE_URL")) {
      return { healthy: false, message: "DATABASE_URL not set — HQ using SQLite fallback" };
    }
    const started = Date.now();
    const db = await getDb();
    await db.get("SELECT 1 as ok");
    const url = process.env.DATABASE_URL ?? "";
    const isSupabase = /supabase/i.test(url);
    return {
      healthy: true,
      latencyMs: Date.now() - started,
      message: isSupabase ? "Supabase/Postgres connected" : "Postgres DATABASE_URL connected",
    };
  }, { healthy: false, message: "Database probe timed out" });

  return {
    id: "postgres",
    name: "Supabase / Postgres",
    category: "Database",
    description: "Primary relational store (Postgres/Supabase) with SQLite runtime fallback",
    status: health.healthy ? "connected" : envSet("DATABASE_URL") ? "degraded" : "not_configured",
    lastChecked: now,
    environmentReadiness: {
      ready: health.healthy,
      missing: keys.filter((k) => !envSet(k)),
      configured: keys.filter((k) => envSet(k)),
    },
    requiredCredentials: [credential("DATABASE_URL", "Postgres connection string")],
    health,
    actions: [
      { id: "test", label: "Test Connection", kind: "primary", action: "test" },
      {
        id: "configure",
        label: envSet("DATABASE_URL") ? "Configured on Render" : "SQLite fallback active",
        kind: "secondary",
        action: "configure",
        reason: envSet("DATABASE_URL") ? undefined : "Set DATABASE_URL for Postgres/Supabase",
      },
    ],
  };
}

async function buildTwilioCard(): Promise<IntegrationHubCard> {
  const {
    probeTwilioApi,
    buildTwilioDetails,
    resolveTwilioHubStatus,
    getTwilioEnvStatus,
    countTwilioCommunicationEvents,
    getLastTwilioEventAt,
    getLastTwilioSuccessfulTestAt,
    IFCDC_HQ_PHONE_E164,
  } = await import("./twilioIntegrationEngine");

  const envStatus = getTwilioEnvStatus();
  const now = new Date().toISOString();

  const twProbe = await probe("twilio", () => probeTwilioApi(), {
    healthy: false,
    accountStatus: null,
    accountFriendlyName: null,
    phone: {
      found: false,
      phoneNumber: IFCDC_HQ_PHONE_E164,
      friendlyName: null,
      voiceCapable: false,
      smsCapable: false,
      status: null,
      voiceWebhook: null,
      smsWebhook: null,
    },
    auraReady: envStatus.auraConfigured,
    latencyMs: 0,
    message: "Twilio probe timed out",
    webhookUrls: { incomingVoice: "", voiceRespond: "", voiceStatus: "", incomingSms: "", smsStatus: "", legacyVoice: "", legacySms: "", reminderVoice: "", reminderStatus: "" },
  });

  const eventCount = await countTwilioCommunicationEvents().catch(() => 0);
  const lastEventAt = await getLastTwilioEventAt().catch(() => null);
  const lastTestAt = getLastTwilioSuccessfulTestAt();
  const rawStatus = resolveTwilioHubStatus(twProbe, envStatus.ready);
  const status = normalizeHubStatus(rawStatus, twProbe.healthy);
  const details = buildTwilioDetails(twProbe, envStatus, eventCount, lastEventAt, lastTestAt);

  const requiredKeys = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "OPENAI_API_KEY"];
  const optionalKeys = [
    "TWILIO_PHONE_NUMBER",
    "TWILIO_SMS_FROM",
    "TWILIO_VOICE_FROM",
    "TWILIO_FROM_NUMBER",
    "TWILIO_MESSAGING_SERVICE_SID",
    "PUBLIC_IFCDC_PHONE",
  ];

  return {
    id: "twilio",
    name: "Twilio (AURA Voice + SMS)",
    category: "Communications",
    description: "IFCDC HQ phone line +1 (331) 316-8167 — AURA voice assistant and SMS",
    status,
    lastChecked: now,
    environmentReadiness: {
      ready: envStatus.ready,
      missing: [
        !envStatus.accountSidConfigured ? "TWILIO_ACCOUNT_SID" : null,
        !envStatus.authTokenConfigured ? "TWILIO_AUTH_TOKEN" : null,
        !envStatus.phoneNumberConfigured ? "TWILIO_PHONE_NUMBER" : null,
        !envStatus.auraConfigured ? "OPENAI_API_KEY" : null,
      ].filter(Boolean) as string[],
      configured: [
        ...(envStatus.accountSidConfigured ? ["TWILIO_ACCOUNT_SID"] : []),
        ...(envStatus.authTokenConfigured ? ["TWILIO_AUTH_TOKEN"] : []),
        ...(envStatus.phoneNumberConfigured ? ["TWILIO_PHONE_NUMBER"] : []),
        ...(envStatus.messagingServiceConfigured ? ["TWILIO_MESSAGING_SERVICE_SID"] : []),
        ...(envStatus.auraConfigured ? ["OPENAI_API_KEY"] : []),
      ],
    },
    requiredCredentials: [
      credential("TWILIO_ACCOUNT_SID", "Twilio Account SID"),
      credential("TWILIO_AUTH_TOKEN", "Twilio Auth Token"),
      {
        key: "TWILIO_PHONE_NUMBER",
        label: `HQ line (${envStatus.phoneNumber ?? IFCDC_HQ_PHONE_E164})`,
        configured: envStatus.phoneNumberConfigured,
      },
      {
        key: "OPENAI_API_KEY",
        label: "OpenAI (AURA voice AI)",
        configured: envStatus.auraConfigured,
      },
      credential("TWILIO_MESSAGING_SERVICE_SID", "Messaging Service SID (optional)"),
    ],
    health: {
      healthy: status === "connected",
      latencyMs: twProbe.latencyMs,
      message: twProbe.message,
    },
    details,
    actions: [
      { id: "test", label: "Test Connection", kind: "primary", action: "test" },
      {
        id: "aura",
        label: "Open AURA",
        kind: "secondary",
        action: "link",
        href: "/hq/aura",
      },
      {
        id: "outreach",
        label: "Outreach tasks",
        kind: "secondary",
        action: "link",
        href: "/api/outreach-tasks?status=OPEN",
      },
      {
        id: "configure",
        label: envStatus.ready ? "Configured" : "Configure",
        kind: "secondary",
        action: "configure",
        reason: envStatus.ready
          ? "Twilio + AURA credentials detected on Render"
          : "Set Twilio credentials and OPENAI_API_KEY on Render",
      },
      {
        id: "render-env",
        label: "Open Render Environment",
        kind: "secondary",
        action: "link",
        href: renderEnvDashboardUrl(),
      },
    ],
  };
}

async function buildWebsiteAppsCard(): Promise<IntegrationHubCard> {
  const now = new Date().toISOString();
  const health = await probe("website_apps", async () => {
    const started = Date.now();
    const apps = await pollAllApps();
    const healthy = apps.filter((a) => a.healthy).length;
    const total = apps.length;
    return {
      healthy: healthy > 0,
      latencyMs: Date.now() - started,
      message: `${healthy}/${total} division apps responding to health polls`,
    };
  }, { healthy: false, latencyMs: 0, message: "App health poll timed out" });

  const appEnvKeys = [
    "HQ_BARBERS_HEALTH_URL",
    "HQ_MUSIC_HEALTH_URL",
    "HQ_TAPIS_HEALTH_URL",
    "HQ_INCLUSIVE_HEALTH_URL",
  ];

  return {
    id: "website_apps",
    name: "Website & App Services",
    category: "Software Division",
    description: "Production health monitoring for IFCDC division apps",
    status: health.healthy ? "connected" : "degraded",
    lastChecked: now,
    environmentReadiness: {
      ready: appEnvKeys.some((k) => envSet(k)),
      missing: appEnvKeys.filter((k) => !envSet(k)),
      configured: appEnvKeys.filter((k) => envSet(k)),
    },
    requiredCredentials: appEnvKeys.map((k) => credential(k, k.replace(/^HQ_/, "").replace(/_/g, " "))),
    health,
    actions: [
      { id: "software", label: "Open Software Division", kind: "primary", action: "link", href: "/hq/software" },
      { id: "test", label: "Test Connection", kind: "secondary", action: "test" },
      {
        id: "configure",
        label: "Configure health URLs",
        kind: "secondary",
        action: "configure",
        reason: "Set HQ_*_HEALTH_URL variables on Render for each deployed app",
      },
    ],
  };
}

async function buildQuickBooksCard(): Promise<IntegrationHubCard> {
  const { getQuickBooksSyncSummary, isQuickBooksConfigured } = await import("./quickbooksOAuth");
  const summary = await getQuickBooksSyncSummary().catch(() => ({
    connection: { connected: false, lastSyncAt: null as string | null },
  }));
  const now = new Date().toISOString();
  const oauthReady = isQuickBooksConfigured();
  const connected = summary.connection.connected;

  return {
    id: "quickbooks",
    name: "QuickBooks",
    category: "Accounting",
    description: "OAuth sync for expenses, invoices, and Financial Center",
    status: connected ? "connected" : oauthReady ? "configured" : "not_configured",
    lastChecked: summary.connection.lastSyncAt ?? now,
    environmentReadiness: {
      ready: oauthReady,
      missing: ["QUICKBOOKS_CLIENT_ID", "QUICKBOOKS_CLIENT_SECRET"].filter((k) => !envSet(k)),
      configured: ["QUICKBOOKS_CLIENT_ID", "QUICKBOOKS_CLIENT_SECRET"].filter((k) => envSet(k)),
    },
    requiredCredentials: [
      credential("QUICKBOOKS_CLIENT_ID", "QuickBooks Client ID"),
      credential("QUICKBOOKS_CLIENT_SECRET", "QuickBooks Client Secret"),
    ],
    health: {
      healthy: connected,
      message: connected
        ? "QuickBooks company connected"
        : oauthReady
          ? "OAuth ready — connect your company"
          : "Set QuickBooks OAuth credentials on Render",
    },
    actions: [
      { id: "oauth", label: connected ? "Reconnect OAuth" : "Connect OAuth", kind: "primary", action: "oauth" },
      { id: "test", label: "Test Connection", kind: "secondary", action: "test" },
      { id: "finance", label: "Financial Center", kind: "secondary", action: "link", href: "/hq/finance?tab=quickbooks" },
    ],
  };
}

function hubTimeout<T>(promise: Promise<T>, fallback: T): Promise<T> {
  return Promise.race([
    promise.catch((err) => {
      console.error("[integrations-hub] aggregate error:", err);
      return fallback;
    }),
    new Promise<T>((resolve) => setTimeout(() => {
      console.warn(`[integrations-hub] aggregate timed out after ${HUB_AGGREGATE_TIMEOUT_MS}ms`);
      resolve(fallback);
    }, HUB_AGGREGATE_TIMEOUT_MS)),
  ]);
}

export function emptyIntegrationsHub() {
  return {
    integrations: [] as IntegrationHubCard[],
    catalog: INTEGRATION_CATALOG,
    connections: [] as unknown[],
    connectedCount: 0,
    summary: { total: 0, connected: 0, configured: 0, notConfigured: 0, categories: 0 },
    degraded: true,
    warning: "Integrations Hub returned safe defaults — live probes were slow or unavailable.",
    timestamp: new Date().toISOString(),
  };
}

async function buildIntegrationsHubUncached() {
  console.info("[integrations-hub] build start");
  await ensureIntegrationTables();
  const db = await getDb();
  const connections = await db.all("SELECT * FROM hq_integration_connections ORDER BY name");
  const feed = await getGrantFeedIntegrationStatus().catch(() => ({
    grantsGov: { status: "pending", label: "Grants.gov", note: "" },
    samGov: { status: "pending", label: "SAM.gov", note: "" },
    foundationDirectory: { status: "pending", label: "", note: "" },
    corporateGrants: { status: "pending", label: "", note: "" },
  }));

  const integrations = await Promise.all([
    buildGrantsGovCard(feed),
    buildSamGovCard(feed),
    buildPayPalCard(),
    buildResendCard(),
    buildOpenAiCard(),
    buildRenderCard(),
    buildGitHubCard(),
    buildPostgresCard(),
    buildTwilioCard(),
    buildWebsiteAppsCard(),
    buildQuickBooksCard(),
  ]);

  const connectedCount = integrations.filter((i) => i.status === "connected").length;
  const configuredCount = integrations.filter((i) => i.status === "connected" || i.status === "degraded").length;

  const payload = {
    integrations,
    catalog: INTEGRATION_CATALOG,
    connections,
    connectedCount,
    summary: {
      total: integrations.length,
      connected: connectedCount,
      configured: configuredCount,
      notConfigured: integrations.filter((i) => i.status === "not_configured").length,
      categories: new Set(integrations.map((i) => i.category)).size,
    },
    degraded: false,
    warning: null as string | null,
    timestamp: new Date().toISOString(),
  };
  console.info(`[integrations-hub] build finished (${integrations.length} integrations, ${connectedCount} connected)`);
  return payload;
}

let hubCache: { at: number; data: Awaited<ReturnType<typeof buildIntegrationsHubUncached>> } | null = null;
const HUB_CACHE_TTL = 30_000;

export async function buildIntegrationsHubSafe() {
  const now = Date.now();
  if (hubCache && now - hubCache.at < HUB_CACHE_TTL) return hubCache.data;
  type HubPayload = Awaited<ReturnType<typeof buildIntegrationsHubUncached>>;
  const data = await hubTimeout(buildIntegrationsHubUncached(), emptyIntegrationsHub() as unknown as HubPayload);
  hubCache = { at: now, data };
  return data;
}

export function invalidateIntegrationsHubCache(): void {
  hubCache = null;
}

export async function testIntegrationHubProvider(provider: string) {
  if (provider === "github") {
    const { testGitHubIntegrationLive } = await import("./githubIntegrationEngine");
    return testGitHubIntegrationLive();
  }
  if (provider === "grants_gov") {
    const { testGrantsGovIntegrationLive } = await import("./grantsGovIntegrationEngine");
    return testGrantsGovIntegrationLive();
  }
  if (provider === "paypal") {
    const { testPayPalIntegrationLive } = await import("./paypalIntegrationEngine");
    return testPayPalIntegrationLive();
  }
  if (provider === "twilio") {
    const { testTwilioIntegrationLive } = await import("./twilioIntegrationEngine");
    return testTwilioIntegrationLive();
  }
  const hub = await buildIntegrationsHubSafe();
  const card = hub.integrations.find((i) => i.id === provider);
  if (!card) return { success: false, message: "Unknown integration", provider, testedAt: new Date().toISOString() };
  return {
    success: card.health.healthy || card.status === "configured" || card.status === "connected",
    message: card.health.message,
    provider,
    status: card.status,
    testedAt: new Date().toISOString(),
    details: card.details,
  };
}
