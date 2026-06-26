import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Activity, Sparkles, GitBranch, Search, ChevronRight,
  Building2, TrendingUp,
} from "lucide-react";
import HQLayout from "../../layouts/HQLayout";
import { phase10Api } from "../../api/phase10Api";
import { KpiCard } from "../../components/hq/KpiCard";
import { HqPanel } from "../../components/hq/HqPanel";
import { HqLoading } from "../../components/hq/HqLoading";
import { StatusBadge } from "../../components/hq/StatusBadge";
import { ActivityFeed } from "../../components/hq/ActivityFeed";
import { HqWidgetErrorBoundary } from "../../components/hq/HqErrorBoundary";
import { ScenarioWorkbench } from "../../components/hq/phase10/ScenarioWorkbench";
import { formatPercent } from "../../utils/safeFormat";
import { useAuth } from "../../auth/AuthContext";

const Phase10ExecutivePlatformPage: React.FC = () => {
  const { user } = useAuth();
  const [searchQ, setSearchQ] = useState("");
  const [auraQ, setAuraQ] = useState("");
  const [auraAnswer, setAuraAnswer] = useState("");

  const pkg = useQuery({ queryKey: ["phase10-package"], queryFn: phase10Api.package, staleTime: 60_000 });
  const tasks = useQuery({ queryKey: ["phase10-tasks"], queryFn: phase10Api.tasks, staleTime: 45_000 });

  const askAura = useMutation({
    mutationFn: phase10Api.ask,
    onSuccess: (res) => setAuraAnswer(String(res.answer ?? "No answer")),
  });

  const data = pkg.data as {
    missionControl?: {
      template?: { name: string; key: string; description: string };
      organizationHealth?: { overall: number; grade: string };
      kpiWall?: { label: string; value: number; status: string; weight: string }[];
      activityTimeline?: { id: string; type: string; title: string; detail: string; timestamp: string }[];
      quickActions?: { label: string; path: string }[];
    };
    enterpriseAI?: {
      briefing?: { greeting: string; highlights: string[]; priorities: string[] };
      recommendations?: { action: string; priority: string }[];
      budgetOptimizations?: { action: string; priority: string }[];
      grantMatches?: { title: string; probability: number; matchReason: string }[];
      riskAnalysis?: { level: string; score: number; factors: string[] };
    };
    operations?: {
      divisions?: { dataLayer?: { divisions: { name: string; status: string; healthy: boolean }[] } };
    };
    commandConsole?: {
      modules?: { label: string; path: string; section: string }[];
    };
  } | undefined;

  const health = data?.missionControl?.organizationHealth;
  const kpiWall = data?.missionControl?.kpiWall ?? [];

  async function runSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!searchQ.trim()) return;
    const res = await phase10Api.search(searchQ);
    window.location.href = res.results[0]?.path ?? `/hq/phase10`;
  }

  return (
    <HQLayout title="Mission Control" subtitle="Phase 10 — Enterprise Command & Intelligence Platform">
      {pkg.isLoading ? <HqLoading message="Loading mission control…" /> : (
        <>
          <div className="hq-founder-hero hq-fade-in" style={{ marginBottom: "1.25rem" }}>
            <div>
              <p className="hq-founder-hero-eyebrow">Phase 10 · {data?.missionControl?.template?.name ?? "Executive"}</p>
              <h2>{data?.enterpriseAI?.briefing?.greeting ?? `Welcome, ${user?.employee?.firstName ?? "Executive"}`}</h2>
              <p className="hq-founder-hero-tagline">{data?.missionControl?.template?.description ?? "Run the entire organization from one command center"}</p>
            </div>
            <div className="hq-founder-hero-meta">
              <StatusBadge label={`Health ${health?.overall ?? "—"}%`} variant="success" />
              <StatusBadge label={health?.grade ?? "—"} variant="gold" />
              <StatusBadge label={`${tasks.data?.counts?.highPriority ?? 0} urgent tasks`} variant="warning" />
            </div>
          </div>

          <div className="hq-kpi-grid hq-fade-in hq-mb-md">
            <KpiCard label="Organization Health" value={formatPercent(health?.overall)} icon={Activity} variant="success" />
            <KpiCard label="Open Tasks" value={tasks.data?.counts?.total ?? 0} icon={GitBranch} variant="gold" />
            <KpiCard label="Risk Level" value={data?.enterpriseAI?.riskAnalysis?.level ?? "—"} icon={TrendingUp} variant="warning" />
            <KpiCard label="Divisions" value={data?.operations?.divisions?.dataLayer?.divisions?.filter((d) => d.healthy).length ?? 0} icon={Building2} variant="success" />
          </div>

          <HqPanel title="Organization KPI Wall" subtitle="Real-time health factors — press ? for keyboard shortcuts">
            <div className="hq-executive-health-strip">
              {kpiWall.map((k) => (
                <div key={k.label} className="hq-health-factor-card">
                  <div className="hq-health-factor-label">{k.label}</div>
                  <div className="hq-health-factor-value">{k.value}%</div>
                  <StatusBadge label={k.status} variant={k.status === "healthy" ? "success" : k.status === "watch" ? "warning" : "danger"} />
                  <div className="hq-muted-text" style={{ fontSize: "0.7rem" }}>{k.weight}</div>
                </div>
              ))}
            </div>
          </HqPanel>

          <div className="hq-grid-2 hq-mt-lg">
            <HqPanel title="Daily Strategic Briefing" subtitle="AURA executive intelligence" action={{ label: "AURA", to: "/hq/aura" }}>
              <ul style={{ margin: "0 0 0.75rem", paddingLeft: "1.1rem", fontSize: "0.85rem", color: "var(--hq-text-muted)" }}>
                {(data?.enterpriseAI?.briefing?.highlights ?? []).slice(0, 5).map((h) => <li key={h}>{h}</li>)}
              </ul>
              <div style={{ fontSize: "0.8rem" }}>
                <strong style={{ color: "var(--hq-gold)" }}>Priorities:</strong>
                <ul style={{ margin: "0.35rem 0 0", paddingLeft: "1.1rem" }}>
                  {(data?.enterpriseAI?.briefing?.priorities ?? []).slice(0, 4).map((p) => <li key={p}>{p}</li>)}
                </ul>
              </div>
            </HqPanel>

            <HqPanel title="Executive Q&A" subtitle="Ask AURA using Headquarters data">
              <form onSubmit={(e) => { e.preventDefault(); if (auraQ.trim()) askAura.mutate(auraQ); }} style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
                <input className="hq-input" placeholder="What is our grant pipeline status?" value={auraQ} onChange={(e) => setAuraQ(e.target.value)} style={{ flex: 1 }} />
                <button type="submit" className="hq-btn hq-btn-primary hq-btn-sm" disabled={askAura.isPending}>
                  <Sparkles size={14} /> Ask
                </button>
              </form>
              {auraAnswer && <p className="hq-muted-text" style={{ fontSize: "0.82rem" }}>{auraAnswer}</p>}
            </HqPanel>
          </div>

          <div className="hq-grid-2 hq-mt-lg">
            <HqPanel title="AI Recommendations" subtitle="Strategic actions">
              {(data?.enterpriseAI?.recommendations ?? []).slice(0, 5).map((r, i) => (
                <div key={i} style={{ marginBottom: "0.5rem", fontSize: "0.82rem" }}>
                  <StatusBadge label={r.priority} variant={r.priority === "high" ? "danger" : "warning"} />
                  <span style={{ marginLeft: "0.5rem" }}>{r.action}</span>
                </div>
              ))}
            </HqPanel>

            <HqPanel title="Budget Optimization" subtitle="AI-generated savings opportunities">
              {(data?.enterpriseAI?.budgetOptimizations ?? []).map((b, i) => (
                <div key={i} style={{ marginBottom: "0.5rem", fontSize: "0.82rem" }}>
                  <StatusBadge label={b.priority} variant="muted" />
                  <span style={{ marginLeft: "0.5rem" }}>{b.action}</span>
                </div>
              ))}
            </HqPanel>
          </div>

          <HqPanel title="What-If Scenario Modeling" subtitle="Financial projections, staffing, and community impact" className="hq-mt-lg">
            <ScenarioWorkbench />
          </HqPanel>

          <div className="hq-grid-2 hq-mt-lg">
            <HqPanel title="Executive Task Board" subtitle="Approvals, workflows, and compliance" action={{ label: "Workflows", to: "/hq/workflows" }}>
              <ul className="hq-activity-list">
                {(tasks.data?.tasks ?? []).slice(0, 8).map((t) => {
                  const task = t as { id: string; title: string; source: string; priority: string; path: string | null };
                  return (
                    <li key={task.id} className="hq-activity-item">
                      <div className="hq-activity-content">
                        <div className="hq-activity-title">{task.title}</div>
                        <div className="hq-activity-detail">{task.source}</div>
                      </div>
                      <StatusBadge label={task.priority} variant={task.priority === "high" ? "danger" : "muted"} />
                      {task.path && <Link to={task.path} className="hq-entity-link"><ChevronRight size={12} /></Link>}
                    </li>
                  );
                })}
              </ul>
            </HqPanel>

            <HqPanel title="Grant Opportunity Matching" subtitle="Probability-scored pipeline" action={{ label: "Grants", to: "/hq/grants" }}>
              {(data?.enterpriseAI?.grantMatches ?? []).map((g) => (
                <div key={g.title} style={{ marginBottom: "0.5rem", fontSize: "0.82rem" }}>
                  <strong>{g.title}</strong>
                  <div className="hq-muted-text">{g.probability}% · {g.matchReason}</div>
                </div>
              ))}
            </HqPanel>
          </div>

          <HqPanel title="Cross-Division Operations" subtitle="Unified read-only division view" className="hq-mt-lg">
            <ul className="hq-activity-list">
              {(data?.operations?.divisions?.dataLayer?.divisions ?? []).map((d) => (
                <li key={d.name} className="hq-activity-item">
                  <div className="hq-activity-content">
                    <div className="hq-activity-title">{d.name}</div>
                  </div>
                  <StatusBadge label={d.status} variant={d.healthy ? "success" : "warning"} />
                </li>
              ))}
            </ul>
          </HqPanel>

          <HqWidgetErrorBoundary label="Personalized dashboard">
            <HqPanel title="Personalized Dashboard" subtitle="Drag-and-drop widgets by role" className="hq-mt-lg" action={{ label: "Customize", to: "/hq" }}>
              <p className="hq-muted-text" style={{ fontSize: "0.85rem", marginBottom: "0.75rem" }}>
                Your <strong>{data?.missionControl?.template?.name}</strong> template is active. Open the Executive Dashboard to drag, resize, and save widget layouts.
              </p>
              <Link to="/hq" className="hq-btn hq-btn-primary hq-btn-sm">Open Customizable Dashboard</Link>
            </HqPanel>
          </HqWidgetErrorBoundary>

          <HqPanel title="Organization Activity Timeline" subtitle="Cross-division events" className="hq-mt-lg" action={{ label: "Analytics", to: "/hq/analytics" }}>
            <ActivityFeed items={data?.missionControl?.activityTimeline ?? []} linkable />
          </HqPanel>

          <HqPanel title="Command Console" subtitle="One-click access to every Headquarters module" className="hq-mt-lg">
            <form onSubmit={runSearch} style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem" }}>
              <input className="hq-input" placeholder="Universal search… (⌘K)" value={searchQ} onChange={(e) => setSearchQ(e.target.value)} style={{ flex: 1 }} />
              <button type="submit" className="hq-btn hq-btn-primary"><Search size={14} /> Search</button>
            </form>
            <div className="hq-founder-command-strip">
              {(data?.missionControl?.quickActions ?? []).map((a) => (
                <Link key={a.path} to={a.path}>{a.label}</Link>
              ))}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginTop: "0.75rem" }}>
              {(data?.commandConsole?.modules ?? []).map((m) => (
                <Link key={m.path} to={m.path} className="hq-btn hq-btn-ghost hq-btn-sm">{m.label}</Link>
              ))}
            </div>
          </HqPanel>
        </>
      )}
    </HQLayout>
  );
};

export default Phase10ExecutivePlatformPage;
