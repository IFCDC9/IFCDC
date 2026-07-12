/**
 * Executive Command Health — six live pillars for the Executive Dashboard strip.
 * All scores are 0–100 from production data (no mock / demo values).
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
};

function statusFromScore(score: number): CommandHealthPillar["status"] {
  if (!Number.isFinite(score)) return "unknown";
  if (score >= 80) return "good";
  if (score >= 60) return "watch";
  return "critical";
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T, label: string): Promise<T> {
  return Promise.race([
    promise.catch((err) => {
      console.warn(`[command-health] ${label}:`, err instanceof Error ? err.message : err);
      return fallback;
    }),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
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
  const platformPct = opts.platformTotal > 0 ? (opts.platformHealthy / opts.platformTotal) * 100 : 50;
  const integPct = opts.integrationTotal > 0 ? (opts.integrationHealthy / opts.integrationTotal) * 100 : 50;
  const channelBonus = (opts.resendOk ? 15 : 0) + (opts.twilioOk ? 15 : 0);
  return Math.round(Math.min(100, platformPct * 0.4 + integPct * 0.3 + channelBonus + 20));
}

let cache: { at: number; data: ExecutiveCommandHealth } | null = null;
const CACHE_TTL_MS = 45_000;

export async function buildExecutiveCommandHealth(opts?: { bypassCache?: boolean }): Promise<ExecutiveCommandHealth> {
  const now = Date.now();
  if (!opts?.bypassCache && cache && now - cache.at < CACHE_TTL_MS) {
    return cache.data;
  }

  const emptyOps = null;
  const [
    orgHealth,
    finance,
    apps,
    ops,
    services,
    hub,
    tech,
  ] = await Promise.all([
    withTimeout(buildOrganizationHealthScore(), 12_000, { overall: 0, grade: "—", factors: [] }, "org"),
    withTimeout(buildExecutiveDashboard(), 10_000, { financialHealthScore: 0, cashFlow: 0 } as Awaited<ReturnType<typeof buildExecutiveDashboard>>, "finance"),
    withTimeout(pollAllApps(), 8_000, [], "apps"),
    withTimeout(
      import("./operationsSchema").then((m) => m.buildOperationsOverview()),
      8_000,
      emptyOps,
      "ops"
    ),
    withTimeout(checkIfcdcServices(), 6_000, {} as Record<string, boolean>, "services"),
    withTimeout(buildIntegrationsHubSafe(), 10_000, null, "integrations"),
    withTimeout(
      import("./auraTechnicalCommandEngine").then((m) => m.buildTechnicalCommandBriefing()),
      12_000,
      null,
      "tech"
    ),
  ]);

  const software = await buildSoftwareDivisionHealthScore(apps);
  const opsScore = buildOperationsHealthScore(ops);
  const financial = Math.round(Number(finance.financialHealthScore) || 0);
  const organization = Math.round(Number(orgHealth.overall) || 0);

  const serviceEntries = Object.entries(services || {});
  const platformHealthy = serviceEntries.filter(([, v]) => v).length;
  const platformTotal = serviceEntries.length;

  const cards = (hub as { cards?: Array<{ status?: string; health?: { healthy?: boolean }; id?: string }> } | null)?.cards ?? [];
  const integrationHealthy = cards.filter((c) => c.health?.healthy || c.status === "connected" || c.status === "configured").length;
  const integrationTotal = cards.length || 1;
  const integrationScore = Math.round((integrationHealthy / integrationTotal) * 100);

  const resendOk = cards.some((c) => c.id === "resend" && (c.health?.healthy || c.status === "connected" || c.status === "configured"));
  const twilioOk = cards.some((c) => (c.id === "twilio" || c.id === "twilio_sms") && (c.health?.healthy || c.status === "connected"));

  const systemFromTech = tech && typeof (tech as { overallScore?: number }).overallScore === "number"
    ? Math.round((tech as { overallScore: number }).overallScore)
    : null;
  const system = systemFromTech ?? Math.round(
    (software.score || 0) * 0.6 + (platformTotal ? (platformHealthy / platformTotal) * 100 : 50) * 0.4
  );

  const security = scoreSecurity({
    platformHealthy,
    platformTotal: platformTotal || 1,
    integrationHealthy,
    integrationTotal,
    resendOk,
    twilioOk,
  });

  const pillars: CommandHealthPillar[] = [
    {
      id: "organization",
      label: "Organization Health",
      score: organization,
      grade: orgHealth.grade || gradeFromScore(organization),
      meta: "Composite HQ score",
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
      meta: `${integrationHealthy}/${integrationTotal} connectors healthy`,
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
  };
  cache = { at: now, data };
  return data;
}

export function invalidateExecutiveCommandHealthCache(): void {
  cache = null;
}
