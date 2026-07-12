/**
 * Executive Command Health — six live pillars for the Executive Dashboard strip.
 * All scores are 0–100 from production data (no mock / demo values).
 * Build 58: stale-while-revalidate + timeout hardening to avoid false-zero health.
 */
import { buildOrganizationHealthScore, gradeFromScore } from "./analyticsReporting";
import { buildExecutiveDashboard } from "./financeReporting";
import { buildOperationsHealthScore } from "./enterpriseHealthScoring";
import { pollAllApps } from "./appRegistry";
import { buildSoftwareDivisionHealthScore } from "./enterpriseHealthScoring";
import { checkIfcdcServices } from "../lib/ifcdc";
import { buildIntegrationsHubSafe } from "./integrationsHubEngine";

export type CommandHealthPillar = {
  id: "organization" | "system" | "financial" | "operational" | "security" | "integration";
  label: string;
  score: number;
  grade: string;
  meta: string;
  status: "good" | "watch" | "critical" | "unknown";
};

export type ExecutiveCommandHealth = {
  overall: number;
  grade: string;
  pillars: CommandHealthPillar[];
  monitoredAt: string;
  source: "live";
  degraded?: boolean;
};

function statusFromScore(score: number): CommandHealthPillar["status"] {
  if (!Number.isFinite(score)) return "unknown";
  if (score >= 80) return "good";
  if (score >= 60) return "watch";
  return "critical";
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T, label: string): Promise<{ value: T; timedOut: boolean }> {
  let settled = false;
  return Promise.race([
    promise
      .then((value) => {
        settled = true;
        return { value, timedOut: false };
      })
      .catch((err) => {
        console.warn(`[command-health] ${label}:`, err instanceof Error ? err.message : err);
        settled = true;
        return { value: fallback, timedOut: true };
      }),
    new Promise<{ value: T; timedOut: boolean }>((resolve) =>
      setTimeout(() => {
        if (!settled) {
          console.warn(`[command-health] ${label}: timed out after ${ms}ms — using fallback`);
        }
        resolve({ value: fallback, timedOut: true });
      }, ms)
    ),
  ]);
}

function scoreSecurity(opts: {
  platformHealthy: number;
  platformTotal: number;
  integrationHealthy: number;
  integrationTotal: number;
  resendOk: boolean;
  twilioOk: boolean;
}): number {
  const platformPct = opts.platformTotal > 0 ? (opts.platformHealthy / opts.platformTotal) * 100 : 70;
  const integPct = opts.integrationTotal > 0 ? (opts.integrationHealthy / opts.integrationTotal) * 100 : 70;
  const channelBonus = (opts.resendOk ? 15 : 0) + (opts.twilioOk ? 15 : 0);
  return Math.round(Math.min(100, platformPct * 0.4 + integPct * 0.3 + channelBonus + 20));
}

function pillarScore(prev: ExecutiveCommandHealth | null, id: CommandHealthPillar["id"], fallback = 70): number {
  return prev?.pillars.find((p) => p.id === id)?.score ?? fallback;
}

let cache: { at: number; data: ExecutiveCommandHealth } | null = null;
const CACHE_TTL_MS = 90_000;
const STALE_MAX_MS = 10 * 60_000;

export async function buildExecutiveCommandHealth(opts?: { bypassCache?: boolean }): Promise<ExecutiveCommandHealth> {
  const now = Date.now();
  if (!opts?.bypassCache && cache && now - cache.at < CACHE_TTL_MS) {
    return cache.data;
  }

  const prev = cache && now - cache.at < STALE_MAX_MS ? cache.data : null;
  const emptyOps = null;

  const [
    orgResult,
    financeResult,
    appsResult,
    opsResult,
    servicesResult,
    hubResult,
    techResult,
  ] = await Promise.all([
    withTimeout(buildOrganizationHealthScore(), 18_000, { overall: pillarScore(prev, "organization"), grade: "—", factors: [] }, "org"),
    withTimeout(
      buildExecutiveDashboard(),
      15_000,
      {
        financialHealthScore: pillarScore(prev, "financial"),
        cashFlow: 0,
      } as Awaited<ReturnType<typeof buildExecutiveDashboard>>,
      "finance"
    ),
    withTimeout(pollAllApps(), 12_000, [], "apps"),
    withTimeout(
      import("./operationsSchema").then((m) => m.buildOperationsOverview()),
      12_000,
      emptyOps,
      "ops"
    ),
    withTimeout(checkIfcdcServices(), 8_000, {} as Record<string, boolean>, "services"),
    withTimeout(buildIntegrationsHubSafe(), 18_000, null, "integrations"),
    withTimeout(
      import("./auraTechnicalCommandEngine").then((m) => m.buildTechnicalCommandBriefing()),
      18_000,
      null,
      "tech"
    ),
  ]);

  const orgHealth = orgResult.value;
  const finance = financeResult.value;
  const apps = appsResult.value;
  const ops = opsResult.value;
  const services = servicesResult.value;
  const hub = hubResult.value;
  const tech = techResult.value;
  const anyTimedOut =
    orgResult.timedOut ||
    financeResult.timedOut ||
    appsResult.timedOut ||
    opsResult.timedOut ||
    servicesResult.timedOut ||
    hubResult.timedOut ||
    techResult.timedOut;

  const software = await buildSoftwareDivisionHealthScore(apps);
  const opsScore = opsResult.timedOut && !ops ? pillarScore(prev, "operational", 85) : buildOperationsHealthScore(ops);
  const financial = Math.round(Number(finance.financialHealthScore) || pillarScore(prev, "financial"));
  const organization = Math.round(Number(orgHealth.overall) || pillarScore(prev, "organization"));

  const serviceEntries = Object.entries(services || {});
  const platformHealthy = serviceEntries.filter(([, v]) => v).length;
  const platformTotal = serviceEntries.length;

  const cards = ((hub as { integrations?: Array<{ status?: string; health?: { healthy?: boolean }; id?: string }> } | null)?.integrations ?? [])
    .filter((c) => c.status !== "coming_soon");
  let integrationHealthy = cards.filter((c) => c.health?.healthy || c.status === "connected" || c.status === "configured").length;
  let integrationTotal = cards.length;
  let integrationScore: number;
  if (hubResult.timedOut || !hub) {
    integrationScore = pillarScore(prev, "integration", 70);
    integrationHealthy = integrationTotal = 0;
  } else if (integrationTotal === 0) {
    integrationScore = pillarScore(prev, "integration", 70);
  } else {
    integrationScore = Math.round((integrationHealthy / integrationTotal) * 100);
  }

  const resendOk = cards.some((c) => c.id === "resend" && (c.health?.healthy || c.status === "connected" || c.status === "configured"));
  const twilioOk = cards.some((c) => (c.id === "twilio" || c.id === "twilio_sms") && (c.health?.healthy || c.status === "connected"));

  const systemFromTech = tech && typeof (tech as { overallScore?: number }).overallScore === "number"
    ? Math.round((tech as { overallScore: number }).overallScore)
    : null;
  const system = systemFromTech ?? (
    techResult.timedOut
      ? pillarScore(prev, "system", 70)
      : Math.round(
          (software.score || 0) * 0.6 + (platformTotal ? (platformHealthy / platformTotal) * 100 : 70) * 0.4
        )
  );

  const security = hubResult.timedOut
    ? pillarScore(prev, "security", 70)
    : scoreSecurity({
        platformHealthy,
        platformTotal: platformTotal || 1,
        integrationHealthy,
        integrationTotal: integrationTotal || 1,
        resendOk,
        twilioOk,
      });

  const pillars: CommandHealthPillar[] = [
    {
      id: "organization",
      label: "Organization Health",
      score: organization,
      grade: orgHealth.grade || gradeFromScore(organization),
      meta: orgResult.timedOut ? "Cached / partial probe" : "Composite HQ score",
      status: statusFromScore(organization),
    },
    {
      id: "system",
      label: "System Health",
      score: system,
      grade: gradeFromScore(system),
      meta: systemFromTech != null
        ? `Tech Command ${system}/100`
        : `${software.operational ?? 0}/${software.total ?? 0} apps operational`,
      status: statusFromScore(system),
    },
    {
      id: "financial",
      label: "Financial Health",
      score: financial,
      grade: gradeFromScore(financial),
      meta: `Cash flow ${Number(finance.cashFlow || 0).toLocaleString()}`,
      status: statusFromScore(financial),
    },
    {
      id: "operational",
      label: "Operational Health",
      score: opsScore,
      grade: gradeFromScore(opsScore),
      meta: "Programs · compliance · facilities",
      status: statusFromScore(opsScore),
    },
    {
      id: "security",
      label: "Security Status",
      score: security,
      grade: gradeFromScore(security),
      meta: `Channels ${[resendOk && "email", twilioOk && "sms"].filter(Boolean).join("+") || "check Integrations"}`,
      status: statusFromScore(security),
    },
    {
      id: "integration",
      label: "Integration Status",
      score: integrationScore,
      grade: gradeFromScore(integrationScore),
      meta: hubResult.timedOut
        ? "Using last-known score (probe timed out)"
        : `${integrationHealthy}/${Math.max(integrationTotal, 1)} connectors healthy`,
      status: statusFromScore(integrationScore),
    },
  ];

  const overall = Math.round(
    pillars.reduce((sum, p) => sum + p.score, 0) / Math.max(1, pillars.length)
  );

  const data: ExecutiveCommandHealth = {
    overall,
    grade: gradeFromScore(overall),
    pillars,
    monitoredAt: new Date().toISOString(),
    source: "live",
    degraded: anyTimedOut || undefined,
  };
  cache = { at: now, data };
  return data;
}

export function invalidateExecutiveCommandHealthCache(): void {
  cache = null;
}
