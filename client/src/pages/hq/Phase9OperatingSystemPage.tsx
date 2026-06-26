import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Sparkles, TrendingUp, GitBranch, FileBarChart, Bell, Search,
  Activity, Shield, Building2, ChevronRight, Download, AlertTriangle,
} from "lucide-react";
import HQLayout from "../../layouts/HQLayout";
import { phase9Api } from "../../api/phase9Api";
import { KpiCard } from "../../components/hq/KpiCard";
import { HqPanel } from "../../components/hq/HqPanel";
import { HqLoading } from "../../components/hq/HqLoading";
import { StatusBadge } from "../../components/hq/StatusBadge";
import { formatCurrency, formatLocaleNumber, formatPercent } from "../../utils/safeFormat";
import { HqWidgetErrorBoundary } from "../../components/hq/HqErrorBoundary";

const Phase9OperatingSystemPage: React.FC = () => {
  const qc = useQueryClient();
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<{ type: string; title: string; subtitle: string; path: string }[]>([]);

  const os = useQuery({ queryKey: ["phase9-package"], queryFn: phase9Api.package, staleTime: 60_000 });
  const predictive = useQuery({ queryKey: ["phase9-predictive"], queryFn: phase9Api.predictive, staleTime: 120_000 });

  const deliverReport = useMutation({
    mutationFn: (type: "briefing" | "board-report") => phase9Api.deliverReport(type, { sendEmail: false }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["phase9-package"] }),
  });

  const data = os.data as {
    commandCenter?: {
      organizationHealth?: { overall: number; grade: string };
      briefing?: { greeting: string; highlights: string[]; priorities: string[] };
      recommendations?: { action: string; priority: string; module: string }[];
      riskAlerts?: { title: string; detail: string; severity: string }[];
    };
    divisions?: { counts?: { total: number; healthy: number; productionLocked: number }; dataLayer?: { divisions: { name: string; status: string; healthy: boolean; dataSource: string }[] } };
    workflows?: { pending: number; overdue: number; escalations: { title: string }[] };
    notifications?: { unreadCount: number; highPriority: number };
    reporting?: { oneClickReports: { id: string; label: string; path?: string }[] };
  } | undefined;

  const health = data?.commandCenter?.organizationHealth;
  const models = (predictive.data as { models?: { id: string; label: string; current: number; projected30d: number; trend: string; unit: string }[] })?.models ?? [];

  async function runSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!searchQ.trim()) return;
    const res = await phase9Api.search(searchQ);
    setSearchResults(res.results ?? []);
  }

  return (
    <HQLayout title="Intelligent Operating System" subtitle="Phase 9 — Enterprise Intelligence & Automation">
      {os.isLoading ? <HqLoading message="Loading operating system…" /> : (
        <>
          <div className="hq-founder-hero hq-fade-in" style={{ marginBottom: "1.25rem" }}>
            <div>
              <p className="hq-founder-hero-eyebrow">Phase 9 · IFCDC Headquarters</p>
              <h2>{data?.commandCenter?.briefing?.greeting ?? "Executive Command"}</h2>
              <p className="hq-founder-hero-tagline">Unified intelligence, automation, and cross-division operations</p>
            </div>
            <div className="hq-founder-hero-meta">
              <StatusBadge label={`Health ${health?.overall ?? "—"}%`} variant="success" />
              <StatusBadge label={health?.grade ?? "—"} variant="gold" />
            </div>
          </div>

          <div className="hq-kpi-grid hq-fade-in" style={{ marginBottom: "1.25rem" }}>
            <KpiCard label="Organization Health" value={formatPercent(health?.overall)} icon={Activity} variant="success" />
            <KpiCard label="Pending Workflows" value={data?.workflows?.pending ?? 0} icon={GitBranch} variant="gold" />
            <KpiCard label="High-Priority Alerts" value={data?.notifications?.highPriority ?? 0} icon={Bell} variant="warning" />
            <KpiCard label="Divisions Connected" value={`${data?.divisions?.counts?.healthy ?? 0}/${data?.divisions?.counts?.total ?? 0}`} icon={Building2} variant="success" />
          </div>

          <HqWidgetErrorBoundary label="Universal search">
            <HqPanel title="Universal Search" subtitle="People, grants, finances, documents, and modules">
              <form onSubmit={runSearch} style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem" }}>
                <input className="hq-input" placeholder="Search Headquarters…" value={searchQ} onChange={(e) => setSearchQ(e.target.value)} style={{ flex: 1 }} />
                <button type="submit" className="hq-btn hq-btn-primary"><Search size={14} /> Search</button>
              </form>
              {searchResults.length > 0 && (
                <ul className="hq-activity-list">
                  {searchResults.map((r) => (
                    <li key={`${r.type}-${r.title}`} className="hq-activity-item">
                      <Link to={r.path} className="hq-entity-link" style={{ flex: 1 }}>
                        <div className="hq-activity-title">{r.title}</div>
                        <div className="hq-activity-detail">{r.subtitle}</div>
                      </Link>
                      <StatusBadge label={r.type} variant="muted" />
                    </li>
                  ))}
                </ul>
              )}
            </HqPanel>
          </HqWidgetErrorBoundary>

          <div className="hq-grid-2 hq-fade-in" style={{ marginTop: "1.25rem" }}>
            <HqPanel title="Executive Briefing" subtitle="Daily intelligence on login" action={{ label: "AURA", to: "/hq/aura" }}>
              <ul style={{ margin: "0 0 0.75rem", paddingLeft: "1.1rem", fontSize: "0.85rem", color: "var(--hq-text-muted)" }}>
                {(data?.commandCenter?.briefing?.highlights ?? []).slice(0, 5).map((h) => <li key={h}>{h}</li>)}
              </ul>
              <div style={{ fontSize: "0.8rem" }}>
                <strong style={{ color: "var(--hq-gold)" }}>Priorities:</strong>
                <ul style={{ margin: "0.35rem 0 0", paddingLeft: "1.1rem" }}>
                  {(data?.commandCenter?.briefing?.priorities ?? []).slice(0, 4).map((p) => <li key={p}>{p}</li>)}
                </ul>
              </div>
            </HqPanel>

            <HqPanel title="AI Recommendations" subtitle="Strategic actions from intelligence engine">
              {(data?.commandCenter?.recommendations ?? []).slice(0, 5).map((r, i) => (
                <div key={i} style={{ marginBottom: "0.5rem", fontSize: "0.82rem" }}>
                  <StatusBadge label={r.priority} variant={r.priority === "high" ? "danger" : "warning"} />
                  <span style={{ marginLeft: "0.5rem" }}>{r.action}</span>
                </div>
              ))}
            </HqPanel>
          </div>

          <HqPanel title="Predictive Analytics" subtitle="Cash flow, grants, staffing, and KPI forecasts" action={{ label: "Full Intelligence", to: "/hq/intelligence" }} style={{ marginTop: "1.25rem" }}>
            {predictive.isLoading ? <HqLoading /> : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "0.75rem" }}>
                {models.slice(0, 7).map((m) => (
                  <div key={m.id} className="hq-panel" style={{ padding: "0.75rem" }}>
                    <div style={{ fontSize: "0.72rem", color: "var(--hq-text-muted)" }}>{m.label}</div>
                    <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--hq-gold)" }}>
                      {m.unit === "$" ? formatCurrency(m.current) : `${formatLocaleNumber(m.current)}${m.unit === "%" ? "%" : m.unit !== "score" ? ` ${m.unit}` : ""}`}
                    </div>
                    <div style={{ fontSize: "0.75rem" }}>30d: {formatLocaleNumber(m.projected30d)} · <StatusBadge label={m.trend} variant={m.trend === "up" ? "success" : m.trend === "down" ? "danger" : "muted"} /></div>
                  </div>
                ))}
              </div>
            )}
          </HqPanel>

          <div className="hq-grid-2 hq-fade-in" style={{ marginTop: "1.25rem" }}>
            <HqPanel title="Cross-Division Intelligence" subtitle="Read-only unified data layer">
              <ul className="hq-activity-list">
                {(data?.divisions?.dataLayer?.divisions ?? []).map((d) => (
                  <li key={d.name} className="hq-activity-item">
                    <div className="hq-activity-content">
                      <div className="hq-activity-title">{d.name}</div>
                      <div className="hq-activity-detail">{d.dataSource.replace(/_/g, " ")}</div>
                    </div>
                    <StatusBadge label={d.status} variant={d.healthy ? "success" : "warning"} />
                  </li>
                ))}
              </ul>
              <p className="hq-muted-text" style={{ fontSize: "0.75rem", marginTop: "0.5rem" }}>
                <Shield size={12} style={{ display: "inline" }} /> Barbers App production-locked — health poll only
              </p>
            </HqPanel>

            <HqPanel title="Risk & Compliance Alerts" subtitle="Real-time executive monitoring">
              {(data?.commandCenter?.riskAlerts ?? []).slice(0, 5).map((a, i) => (
                <div key={i} className="hq-anomaly-alert hq-sev-medium" style={{ marginBottom: "0.5rem" }}>
                  <AlertTriangle size={14} />
                  <div><strong>{a.title}</strong><span>{a.detail}</span></div>
                </div>
              ))}
              {(data?.workflows?.escalations ?? []).map((e, i) => (
                <div key={i} className="hq-muted-text" style={{ fontSize: "0.8rem" }}>Escalation: {e.title}</div>
              ))}
              <Link to="/hq/workflows" className="hq-entity-link" style={{ display: "block", marginTop: "0.5rem" }}>Workflow Automation <ChevronRight size={12} /></Link>
            </HqPanel>
          </div>

          <HqPanel title="Executive Reporting" subtitle="One-click board reports and PDF exports" className="hq-mt-lg">
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
              <button type="button" className="hq-btn hq-btn-primary hq-btn-sm" disabled={deliverReport.isPending} onClick={() => deliverReport.mutate("briefing")}>
                <Download size={14} /> Executive Briefing PDF
              </button>
              <button type="button" className="hq-btn hq-btn-secondary hq-btn-sm" disabled={deliverReport.isPending} onClick={() => deliverReport.mutate("board-report")}>
                <FileBarChart size={14} /> Board Report PDF
              </button>
              <Link to="/hq/reports" className="hq-btn hq-btn-ghost hq-btn-sm"><TrendingUp size={14} /> All Reports</Link>
            </div>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              {(data?.reporting?.oneClickReports ?? []).map((r) => (
                r.path ? <Link key={r.id} to={r.path} className="hq-btn hq-btn-ghost hq-btn-sm">{r.label}</Link> : null
              ))}
            </div>
          </HqPanel>
        </>
      )}
    </HQLayout>
  );
};

export default Phase9OperatingSystemPage;
