import { detectOperationalAnomalies } from "./auraExecutiveOps";
import { buildKpiMonitoring } from "./analyticsReporting";
import { buildSafeAnalyticsOverview } from "./analyticsReporting";

export interface KpiAnomalyAlert {
  id: string;
  module: string;
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  metric?: string;
  value?: number;
  threshold?: number;
  timestamp: string;
}

type AnomalyBroadcast = (alerts: KpiAnomalyAlert[]) => void;

let broadcastHandler: AnomalyBroadcast | null = null;
let lastAlertHash = "";
let monitorTimer: ReturnType<typeof setInterval> | null = null;

export function registerAnomalyBroadcast(handler: AnomalyBroadcast) {
  broadcastHandler = handler;
}

export async function scanKpiAnomalies(): Promise<KpiAnomalyAlert[]> {
  const [anomalies, kpis, overview] = await Promise.all([
    detectOperationalAnomalies().catch(() => ({ anomalies: [] })),
    buildKpiMonitoring().catch(() => ({ kpis: [] })),
    buildSafeAnalyticsOverview(),
  ]);

  const alerts: KpiAnomalyAlert[] = [];
  const now = new Date().toISOString();

  for (const a of anomalies.anomalies) {
    alerts.push({
      id: `anomaly-${a.module}-${a.title}`.replace(/\s+/g, "-").toLowerCase(),
      module: a.module,
      severity: a.severity,
      title: a.title,
      detail: a.detail,
      metric: a.metric,
      value: a.value,
      timestamp: now,
    });
  }

  for (const k of kpis.kpis) {
    if (k.status === "critical" || k.status === "watch") {
      alerts.push({
        id: `kpi-${k.id}`,
        module: k.id?.split("-")[0] ?? "analytics",
        severity: k.status === "critical" ? "high" : "medium",
        title: `KPI threshold: ${k.label}`,
        detail: `${k.label} is ${k.value}${k.unit} (target: ${k.target}${k.unit})`,
        metric: k.id,
        value: typeof k.value === "number" ? k.value : undefined,
        threshold: typeof k.target === "number" ? k.target : undefined,
        timestamp: now,
      });
    }
  }

  if (overview.organizationHealth.overall < 80) {
    alerts.push({
      id: "org-health-critical",
      module: "organization",
      severity: overview.organizationHealth.overall < 60 ? "high" : "medium",
      title: "Organization health below threshold",
      detail: `Health score ${overview.organizationHealth.overall}% is below 80% target`,
      metric: "organization_health",
      value: overview.organizationHealth.overall,
      threshold: 80,
      timestamp: now,
    });
  }

  if (overview.finance.cashFlow < 0) {
    alerts.push({
      id: "cash-flow-negative",
      module: "finance",
      severity: "high",
      title: "Negative cash flow",
      detail: `Cash flow is $${overview.finance.cashFlow.toLocaleString()}`,
      metric: "cash_flow",
      value: overview.finance.cashFlow,
      threshold: 0,
      timestamp: now,
    });
  }

  return alerts;
}

export async function runAnomalyMonitorAndPush(): Promise<KpiAnomalyAlert[]> {
  const alerts = await scanKpiAnomalies();
  const hash = alerts.map((a) => a.id).sort().join("|");

  if (hash !== lastAlertHash && alerts.length > 0 && broadcastHandler) {
    lastAlertHash = hash;
    broadcastHandler(alerts);
  }

  return alerts;
}

export function startAnomalyMonitor(intervalMs = 3 * 60 * 1000): void {
  if (monitorTimer) return;

  setTimeout(() => {
    runAnomalyMonitorAndPush().catch((err) => console.error("[Anomaly Monitor]", err));
  }, 45_000);

  monitorTimer = setInterval(() => {
    runAnomalyMonitorAndPush().catch((err) => console.error("[Anomaly Monitor]", err));
  }, intervalMs);

  if (typeof monitorTimer.unref === "function") monitorTimer.unref();
}
