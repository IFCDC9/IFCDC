/**
 * AURA Enterprise Brain v1 — Modules 1–2 shell (Command Center + Org Health).
 * Founder-only, read-only.
 */
import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Activity, AlertTriangle, Brain, CheckCircle2, Clock, FileText, Mail, Monitor,
  RefreshCw, Shield, Target,
} from "lucide-react";
import HQLayout from "../../layouts/HQLayout";
import { hqApi } from "../../api/hqApi";
import { KpiCard } from "../../components/hq/KpiCard";
import { StatusBadge } from "../../components/hq/StatusBadge";
import { HqLoading } from "../../components/hq/HqLoading";
import { HqApiError } from "../../api/hqApiFetch";

type BrainTab = "command" | "health" | "briefing" | "projects" | "systems" | "queue";

function errorMessage(err: unknown): string {
  if (err instanceof HqApiError) {
    if (err.status === 403) return "Founder access required for AURA Enterprise Brain v1.";
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return "Request failed.";
}

function severityVariant(severity: string): "danger" | "warning" | "muted" | "success" {
  if (severity === "critical" || severity === "high") return "danger";
  if (severity === "watch" || severity === "action_required") return "warning";
  if (severity === "info") return "muted";
  if (severity === "healthy" || severity === "good") return "success";
  return "muted";
}

const AuraEnterpriseBrainV1Page: React.FC = () => {
  const [tab, setTab] = useState<BrainTab>("command");

  const cc = useQuery({
    queryKey: ["aura-brain-v1-command-center"],
    queryFn: hqApi.auraBrainV1CommandCenter,
    staleTime: 30_000,
    refetchInterval: tab === "command" ? 90_000 : false,
    retry: 1,
    enabled: tab === "command",
  });

  const health = useQuery({
    queryKey: ["aura-brain-v1-org-health"],
    queryFn: hqApi.auraBrainV1OrgHealth,
    staleTime: 30_000,
    refetchInterval: tab === "health" ? 90_000 : false,
    retry: 1,
    enabled: tab === "health",
  });

  const briefing = useQuery({
    queryKey: ["aura-brain-v1-daily-briefing"],
    queryFn: hqApi.auraBrainV1DailyBriefing,
    staleTime: 60_000,
    refetchInterval: tab === "briefing" ? 120_000 : false,
    retry: 1,
    enabled: tab === "briefing",
  });

  const projects = useQuery({
    queryKey: ["aura-brain-v1-projects"],
    queryFn: hqApi.auraBrainV1Projects,
    staleTime: 30_000,
    refetchInterval: tab === "projects" ? 90_000 : false,
    retry: 1,
    enabled: tab === "projects",
  });

  const systems = useQuery({
    queryKey: ["aura-brain-v1-system-health"],
    queryFn: hqApi.auraBrainV1SystemHealth,
    staleTime: 30_000,
    refetchInterval: tab === "systems" ? 90_000 : false,
    retry: 1,
    enabled: tab === "systems",
  });

  const queue = useQuery({
    queryKey: ["aura-brain-v1-priority-queue"],
    queryFn: hqApi.auraBrainV1PriorityQueue,
    staleTime: 30_000,
    refetchInterval: tab === "queue" ? 90_000 : false,
    retry: 1,
    enabled: tab === "queue",
  });

  const d = cc.data;
  const h = health.data;
  const b = briefing.data;
  const p = projects.data;
  const s = systems.data;
  const q = queue.data;
  const roadmap = d?.moduleRoadmap ?? h?.moduleRoadmap ?? b?.moduleRoadmap ?? p?.moduleRoadmap ?? s?.moduleRoadmap ?? q?.moduleRoadmap ?? [];

  const refetchActive = () => {
    if (tab === "command") return cc.refetch();
    if (tab === "health") return health.refetch();
    if (tab === "briefing") return briefing.refetch();
    if (tab === "projects") return projects.refetch();
    if (tab === "systems") return systems.refetch();
    return queue.refetch();
  };
  const fetching =
    tab === "command" ? cc.isFetching
      : tab === "health" ? health.isFetching
        : tab === "briefing" ? briefing.isFetching
          : tab === "projects" ? projects.isFetching
            : tab === "systems" ? systems.isFetching
              : queue.isFetching;

  return (
    <HQLayout
      title="AURA Enterprise Brain v1"
      subtitle="Founder read-only — Command Center, Health, Briefing, Projects"
      auraModule="aura"
    >
      <div className="hq-analytics-toolbar" style={{ marginBottom: "1rem", flexWrap: "wrap" }}>
        <button
          type="button"
          className={`hq-btn hq-btn-sm ${tab === "command" ? "hq-btn-primary" : "hq-btn-secondary"}`}
          onClick={() => setTab("command")}
        >
          1. Command Center
        </button>
        <button
          type="button"
          className={`hq-btn hq-btn-sm ${tab === "health" ? "hq-btn-primary" : "hq-btn-secondary"}`}
          onClick={() => setTab("health")}
        >
          2. Organization Health
        </button>
        <button
          type="button"
          className={`hq-btn hq-btn-sm ${tab === "briefing" ? "hq-btn-primary" : "hq-btn-secondary"}`}
          onClick={() => setTab("briefing")}
        >
          3. Daily Briefing
        </button>
        <button
          type="button"
          className={`hq-btn hq-btn-sm ${tab === "projects" ? "hq-btn-primary" : "hq-btn-secondary"}`}
          onClick={() => setTab("projects")}
        >
          4. Projects
        </button>
        <button
          type="button"
          className={`hq-btn hq-btn-sm ${tab === "systems" ? "hq-btn-primary" : "hq-btn-secondary"}`}
          onClick={() => setTab("systems")}
        >
          5. Systems
        </button>
        <button
          type="button"
          className={`hq-btn hq-btn-sm ${tab === "queue" ? "hq-btn-primary" : "hq-btn-secondary"}`}
          onClick={() => setTab("queue")}
        >
          6. Priority Queue
        </button>
        <StatusBadge label="Read-only" variant="muted" />
        <button
          type="button"
          className="hq-btn hq-btn-secondary hq-btn-sm"
          onClick={() => void refetchActive()}
          disabled={fetching}
        >
          <RefreshCw size={14} /> Refresh
        </button>
        <Link to="/hq/email-readiness" className="hq-btn hq-btn-ghost hq-btn-sm">Email Readiness</Link>
        <Link to="/hq/monitoring" className="hq-btn hq-btn-ghost hq-btn-sm">Monitoring</Link>
        <Link to="/hq/analytics" className="hq-btn hq-btn-ghost hq-btn-sm">Analytics</Link>
      </div>

      {tab === "command" && (
        <>
          {cc.isPending && !d && <HqLoading message="Loading Executive Command Center…" />}
          {cc.isError && (
            <div className="hq-anomaly-alert hq-sev-medium" style={{ marginBottom: "1rem" }} role="status">
              <AlertTriangle size={16} />
              <div>
                <strong>Command Center unavailable</strong>
                <span> {errorMessage(cc.error)}</span>
              </div>
            </div>
          )}
          {d?.warning && (
            <p style={{ color: "var(--hq-warning)", marginBottom: "0.75rem", fontSize: "0.85rem" }}>{d.warning}</p>
          )}
          {d && (
            <>
              <div className="hq-analytics-toolbar" style={{ marginBottom: "1rem" }}>
                <span className="hq-muted-text" style={{ fontSize: "0.8rem" }}>
                  Last login: {d.lastLoginAt ? new Date(d.lastLoginAt).toLocaleString() : "—"}
                </span>
                <span className="hq-muted-text" style={{ fontSize: "0.8rem" }}>
                  Generated: {new Date(d.generatedAt).toLocaleString()}
                </span>
              </div>

              <div className="hq-kpi-grid" style={{ marginBottom: "1.25rem" }}>
                <KpiCard label="Needs Attention" value={d.summary.attentionCount} icon={AlertTriangle} variant={d.summary.attentionCount > 0 ? "warning" : "success"} />
                <KpiCard label="Changed Since Login" value={d.summary.changeCount} icon={Clock} />
                <KpiCard label="Systems Healthy" value={d.summary.healthySystemCount} icon={Shield} variant="success" />
                <KpiCard label="Action Required" value={d.summary.actionSystemCount} icon={Activity} variant={d.summary.actionSystemCount > 0 ? "danger" : "success"} />
                <KpiCard label="Active Projects" value={d.summary.activeProjectCount} icon={Target} />
                <KpiCard label="Pending Deploys" value={d.summary.pendingDeployCount} icon={Monitor} variant={d.summary.pendingDeployCount > 0 ? "warning" : "muted"} />
                <KpiCard label="Email Issues" value={d.summary.failedEmailCount} icon={Mail} variant={d.summary.failedEmailCount > 0 ? "danger" : "success"} />
                <KpiCard label="Command Health" value={d.summary.commandHealthOverall != null ? `${d.summary.commandHealthOverall}` : "—"} icon={Brain} variant="gold" />
              </div>

              <div className="hq-panel" style={{ marginBottom: "1rem" }}>
                <div className="hq-panel-body">
                  <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.5rem" }}>What should I do next?</h4>
                  <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.9rem", lineHeight: 1.6 }}>
                    {d.answers.doNext.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ul>
                  <p className="hq-muted-text" style={{ marginTop: "0.75rem", fontSize: "0.78rem" }}>
                    Email: {d.summary.emailConfigured ? `configured · ${d.summary.emailFrom || "from set"}` : "not configured"} — no secrets shown.
                  </p>
                </div>
              </div>

              <div className="hq-grid-2" style={{ marginBottom: "1rem" }}>
                <div className="hq-panel">
                  <div className="hq-panel-body">
                    <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.75rem" }}>What needs my attention?</h4>
                    {d.answers.needsAttention.slice(0, 10).map((item) => (
                      <div key={item.id} style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", padding: "0.45rem 0", borderBottom: "1px solid var(--hq-border-subtle)", fontSize: "0.85rem" }}>
                        <div>
                          <strong>{item.title}</strong>
                          <div style={{ opacity: 0.85 }}>{item.detail}</div>
                          {item.path && <Link to={item.path} style={{ fontSize: "0.75rem" }}>{item.path}</Link>}
                        </div>
                        <StatusBadge label={item.severity} variant={severityVariant(item.severity)} />
                      </div>
                    ))}
                    {!d.answers.needsAttention.length && (
                      <p className="hq-muted-text"><CheckCircle2 size={14} style={{ verticalAlign: "middle" }} /> Nothing urgent.</p>
                    )}
                  </div>
                </div>

                <div className="hq-panel">
                  <div className="hq-panel-body">
                    <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.75rem" }}>What changed since last login?</h4>
                    {d.answers.changedSinceLastLogin.slice(0, 10).map((item) => (
                      <div key={item.id} style={{ padding: "0.45rem 0", borderBottom: "1px solid var(--hq-border-subtle)", fontSize: "0.85rem" }}>
                        <strong>{item.title}</strong>
                        <div style={{ opacity: 0.85 }}>{item.detail}</div>
                      </div>
                    ))}
                    {!d.answers.changedSinceLastLogin.length && (
                      <p className="hq-muted-text">No recorded changes since last login (or login history unavailable).</p>
                    )}
                  </div>
                </div>

                <div className="hq-panel">
                  <div className="hq-panel-body">
                    <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.75rem" }}>Systems requiring action</h4>
                    {d.answers.systemsRequireAction.slice(0, 12).map((row) => (
                      <div key={row.id} style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", padding: "0.35rem 0", fontSize: "0.85rem", borderBottom: "1px solid var(--hq-border-subtle)" }}>
                        <div>
                          <strong>{row.label}</strong>
                          <div style={{ opacity: 0.85 }}>{row.detail}</div>
                        </div>
                        <StatusBadge label="action" variant="danger" />
                      </div>
                    ))}
                    {!d.answers.systemsRequireAction.length && (
                      <p className="hq-muted-text">All monitored systems healthy or watch-only.</p>
                    )}
                    <h4 style={{ color: "var(--hq-gold)", margin: "1rem 0 0.5rem" }}>Healthy systems ({d.summary.healthySystemCount})</h4>
                    <p className="hq-muted-text" style={{ fontSize: "0.8rem" }}>
                      {d.answers.systemsHealthy.slice(0, 8).map((s) => s.label).join(" · ") || "—"}
                      {d.answers.systemsHealthy.length > 8 ? " · …" : ""}
                    </p>
                  </div>
                </div>

                <div className="hq-panel">
                  <div className="hq-panel-body">
                    <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.75rem" }}>Active projects & pending deployments</h4>
                    {d.answers.activeProjects.map((p) => (
                      <div key={p.id} style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", padding: "0.35rem 0", fontSize: "0.85rem", borderBottom: "1px solid var(--hq-border-subtle)" }}>
                        <div>
                          <strong>{p.name}</strong>
                          <div style={{ opacity: 0.85 }}>{p.detail}</div>
                        </div>
                        <StatusBadge
                          label={p.status}
                          variant={p.healthy === false ? "danger" : p.status === "production" || p.status === "locked" ? "success" : "warning"}
                        />
                      </div>
                    ))}
                    {d.answers.deploymentsPending.length > 0 && (
                      <p className="hq-muted-text" style={{ marginTop: "0.75rem", fontSize: "0.8rem" }}>
                        Pending production: {d.answers.deploymentsPending.map((p) => p.name).join(", ")}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {d.answers.emailsFailed.length > 0 && (
                <div className="hq-panel" style={{ marginBottom: "1rem" }}>
                  <div className="hq-panel-body">
                    <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.75rem" }}>What emails failed?</h4>
                    {d.answers.emailsFailed.map((item) => (
                      <div key={item.id} style={{ padding: "0.4rem 0", borderBottom: "1px solid var(--hq-border-subtle)", fontSize: "0.85rem" }}>
                        <strong>{item.title}</strong>
                        <div style={{ opacity: 0.85 }}>{item.detail}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {tab === "health" && (
        <>
          {health.isPending && !h && <HqLoading message="Loading Organization Health…" />}
          {health.isError && (
            <div className="hq-anomaly-alert hq-sev-medium" style={{ marginBottom: "1rem" }} role="status">
              <AlertTriangle size={16} />
              <div>
                <strong>Organization Health unavailable</strong>
                <span> {errorMessage(health.error)}</span>
              </div>
            </div>
          )}
          {h?.warning && (
            <p style={{ color: "var(--hq-warning)", marginBottom: "0.75rem", fontSize: "0.85rem" }}>{h.warning}</p>
          )}
          {h && (
            <>
              <div className="hq-kpi-grid" style={{ marginBottom: "1.25rem" }}>
                <KpiCard label="Overall Health" value={h.overall != null ? `${h.overall}` : "—"} meta={h.grade} icon={Activity} variant="gold" />
                <KpiCard
                  label="Factors Healthy"
                  value={h.factors.filter((f) => f.status === "healthy").length}
                  icon={CheckCircle2}
                  variant="success"
                />
                <KpiCard
                  label="Watch / Action"
                  value={h.factors.filter((f) => f.status !== "healthy").length}
                  icon={AlertTriangle}
                  variant={h.watchItems.length ? "warning" : "success"}
                />
                <KpiCard label="Command Pillars" value={h.commandPillars.length} icon={Shield} />
              </div>

              <div className="hq-grid-2" style={{ marginBottom: "1rem" }}>
                <div className="hq-panel">
                  <div className="hq-panel-body">
                    <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.75rem" }}>Health factors</h4>
                    {h.factors.map((f) => (
                      <div key={f.label} style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", padding: "0.45rem 0", borderBottom: "1px solid var(--hq-border-subtle)", fontSize: "0.85rem" }}>
                        <div>
                          <strong>{f.label}</strong>
                          <div style={{ opacity: 0.85 }}>{f.score}/{f.max} · weight {f.weight}</div>
                        </div>
                        <StatusBadge label={f.status} variant={severityVariant(f.status)} />
                      </div>
                    ))}
                    {!h.factors.length && <p className="hq-muted-text">No factors available.</p>}
                  </div>
                </div>

                <div className="hq-panel">
                  <div className="hq-panel-body">
                    <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.75rem" }}>Command health pillars</h4>
                    {h.commandPillars.map((p) => (
                      <div key={p.id} style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", padding: "0.45rem 0", borderBottom: "1px solid var(--hq-border-subtle)", fontSize: "0.85rem" }}>
                        <div>
                          <strong>{p.label}</strong>
                          <div style={{ opacity: 0.85 }}>{p.meta}</div>
                        </div>
                        <StatusBadge label={`${p.score} · ${p.status}`} variant={severityVariant(p.status)} />
                      </div>
                    ))}
                    {!h.commandPillars.length && <p className="hq-muted-text">No pillars available.</p>}
                  </div>
                </div>
              </div>

              <div className="hq-grid-2" style={{ marginBottom: "1rem" }}>
                <div className="hq-panel">
                  <div className="hq-panel-body">
                    <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.5rem" }}>Highlights</h4>
                    <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.85rem", lineHeight: 1.55 }}>
                      {h.highlights.map((line) => <li key={line}>{line}</li>)}
                    </ul>
                  </div>
                </div>
                <div className="hq-panel">
                  <div className="hq-panel-body">
                    <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.5rem" }}>Watch / action items</h4>
                    <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.85rem", lineHeight: 1.55 }}>
                      {h.watchItems.length ? h.watchItems.map((line) => <li key={line}>{line}</li>) : <li className="hq-muted-text">None</li>}
                    </ul>
                  </div>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {tab === "briefing" && (
        <>
          {briefing.isPending && !b && <HqLoading message="Loading Executive Daily Briefing…" />}
          {briefing.isError && (
            <div className="hq-anomaly-alert hq-sev-medium" style={{ marginBottom: "1rem" }} role="status">
              <AlertTriangle size={16} />
              <div>
                <strong>Daily Briefing unavailable</strong>
                <span> {errorMessage(briefing.error)}</span>
              </div>
            </div>
          )}
          {b?.warning && (
            <p style={{ color: "var(--hq-warning)", marginBottom: "0.75rem", fontSize: "0.85rem" }}>{b.warning}</p>
          )}
          {b && (
            <>
              <div className="hq-kpi-grid" style={{ marginBottom: "1.25rem" }}>
                <KpiCard label="Briefing" value={b.cached ? "Cached" : "Live"} meta={b.date || undefined} icon={FileText} variant="gold" />
                <KpiCard label="Highlights" value={b.highlights.length} icon={Brain} />
                <KpiCard label="Source" value={b.source.replace(/-/g, " ").slice(0, 18)} icon={Activity} />
                <KpiCard label="Brain signals" value={b.brainHighlights.length} icon={Target} />
              </div>

              <div className="hq-panel" style={{ marginBottom: "1rem" }}>
                <div className="hq-panel-body">
                  <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.5rem" }}>{b.title}</h4>
                  <p className="hq-muted-text" style={{ fontSize: "0.78rem", marginBottom: "0.75rem" }}>
                    Generated {new Date(b.generatedAt).toLocaleString()} · mode {b.mode}
                  </p>
                  <h5 style={{ margin: "0 0 0.5rem", fontSize: "0.85rem" }}>Highlights</h5>
                  <ul style={{ margin: "0 0 1rem", paddingLeft: "1.1rem", fontSize: "0.85rem", lineHeight: 1.55 }}>
                    {b.highlights.length ? b.highlights.map((line) => <li key={line}>{line}</li>) : <li className="hq-muted-text">No highlights</li>}
                  </ul>
                  <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: "0.8rem", lineHeight: 1.55, maxHeight: 420, overflow: "auto", margin: 0, color: "var(--hq-text-muted)" }}>
                    {b.content}
                  </pre>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {tab === "projects" && (
        <>
          {projects.isPending && !p && <HqLoading message="Loading Project Status Monitor…" />}
          {projects.isError && (
            <div className="hq-anomaly-alert hq-sev-medium" style={{ marginBottom: "1rem" }} role="status">
              <AlertTriangle size={16} />
              <div>
                <strong>Project Status unavailable</strong>
                <span> {errorMessage(projects.error)}</span>
              </div>
            </div>
          )}
          {p && (
            <>
              <div className="hq-kpi-grid" style={{ marginBottom: "1.25rem" }}>
                <KpiCard label="Projects" value={p.summary.total} icon={Target} variant="gold" />
                <KpiCard label="Production-like" value={p.summary.productionLike} icon={CheckCircle2} variant="success" />
                <KpiCard label="Pending" value={p.summary.pending} icon={Monitor} variant={p.summary.pending ? "warning" : "muted"} />
                <KpiCard label="Unhealthy" value={p.summary.unhealthy} icon={AlertTriangle} variant={p.summary.unhealthy ? "danger" : "success"} />
              </div>
              <div className="hq-panel" style={{ marginBottom: "1rem" }}>
                <div className="hq-panel-body">
                  <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.75rem" }}>Software Division projects</h4>
                  {p.projects.map((row) => (
                    <div key={row.id} style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", padding: "0.45rem 0", borderBottom: "1px solid var(--hq-border-subtle)", fontSize: "0.85rem" }}>
                      <div>
                        <strong>{row.name}</strong>
                        <div style={{ opacity: 0.85 }}>{row.detail}</div>
                        <Link to={row.path} style={{ fontSize: "0.75rem" }}>{row.path}</Link>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <StatusBadge
                          label={row.status}
                          variant={row.healthy === false ? "danger" : row.status === "production" || row.status === "locked" ? "success" : "warning"}
                        />
                        <div className="hq-muted-text" style={{ fontSize: "0.75rem", marginTop: "0.25rem" }}>
                          {row.healthy == null ? "health unknown" : row.healthy ? `healthy · ${row.latencyMs ?? "—"}ms` : "unhealthy"}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </>
      )}

      {tab === "systems" && (
        <>
          {systems.isPending && !s && <HqLoading message="Loading System Health Monitor…" />}
          {systems.isError && (
            <div className="hq-anomaly-alert hq-sev-medium" style={{ marginBottom: "1rem" }} role="status">
              <AlertTriangle size={16} />
              <div>
                <strong>System Health unavailable</strong>
                <span> {errorMessage(systems.error)}</span>
              </div>
            </div>
          )}
          {s?.warning && (
            <p style={{ color: "var(--hq-warning)", marginBottom: "0.75rem", fontSize: "0.85rem" }}>{s.warning}</p>
          )}
          {s && (
            <>
              <div className="hq-kpi-grid" style={{ marginBottom: "1.25rem" }}>
                <KpiCard label="Overall Score" value={s.overallScore != null ? `${s.overallScore}` : "—"} meta={s.overallStatus} icon={Shield} variant="gold" />
                <KpiCard label="Components" value={s.components.length} icon={Monitor} />
                <KpiCard label="Healthy" value={s.components.filter((c) => c.status === "healthy").length} icon={CheckCircle2} variant="success" />
                <KpiCard label="Alerts" value={s.alerts.length} icon={AlertTriangle} variant={s.alerts.length ? "warning" : "success"} />
              </div>
              <div className="hq-grid-2" style={{ marginBottom: "1rem" }}>
                <div className="hq-panel">
                  <div className="hq-panel-body">
                    <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.75rem" }}>Components</h4>
                    {s.components.map((c) => (
                      <div key={c.id} style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", padding: "0.4rem 0", borderBottom: "1px solid var(--hq-border-subtle)", fontSize: "0.85rem" }}>
                        <div>
                          <strong>{c.label}</strong>
                          <div style={{ opacity: 0.85 }}>{c.detail}</div>
                        </div>
                        <StatusBadge label={`${c.score} · ${c.status}`} variant={severityVariant(c.status === "critical" ? "critical" : c.status === "degraded" ? "watch" : c.status)} />
                      </div>
                    ))}
                  </div>
                </div>
                <div className="hq-panel">
                  <div className="hq-panel-body">
                    <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.75rem" }}>Monitoring alerts</h4>
                    {s.alerts.length ? s.alerts.map((a) => (
                      <div key={a.id} style={{ padding: "0.4rem 0", borderBottom: "1px solid var(--hq-border-subtle)", fontSize: "0.85rem" }}>
                        <strong>{a.title}</strong>
                        <div style={{ opacity: 0.85 }}>{a.detail}</div>
                      </div>
                    )) : <p className="hq-muted-text">No monitoring alerts.</p>}
                  </div>
                </div>
              </div>
            </>
          )}
        </>
      )}

      <div className="hq-panel">
        <div className="hq-panel-body">
          <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.75rem" }}>Brain v1 module roadmap</h4>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            {roadmap.map((m) => (
              <StatusBadge
                key={m.id}
                label={`${m.id}. ${m.name}`}
                variant={m.status === "live" ? "success" : "muted"}
              />
            ))}
          </div>

      {tab === "queue" && (
        <>
          {queue.isPending && !q && <HqLoading message="Loading Priority Queue…" />}
          {queue.isError && (
            <div className="hq-anomaly-alert hq-sev-medium" style={{ marginBottom: "1rem" }} role="status">
              <AlertTriangle size={16} />
              <div>
                <strong>Priority Queue unavailable</strong>
                <span> {errorMessage(queue.error)}</span>
              </div>
            </div>
          )}
          {q && (
            <>
              <div className="hq-kpi-grid" style={{ marginBottom: "1.25rem" }}>
                <KpiCard label="Total" value={q.summary.total} icon={Target} variant="gold" />
                <KpiCard label="Critical" value={q.summary.critical} icon={AlertTriangle} variant={q.summary.critical ? "danger" : "success"} />
                <KpiCard label="High" value={q.summary.high} icon={Activity} variant={q.summary.high ? "warning" : "success"} />
                <KpiCard label="Watch" value={q.summary.watch} icon={Clock} />
              </div>
              <div className="hq-panel" style={{ marginBottom: "1rem" }}>
                <div className="hq-panel-body">
                  <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.75rem" }}>Ranked priorities</h4>
                  {q.items.map((item, idx) => (
                    <div key={item.id} style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", padding: "0.45rem 0", borderBottom: "1px solid var(--hq-border-subtle)", fontSize: "0.85rem" }}>
                      <div>
                        <strong>#{idx + 1} {item.title}</strong>
                        <div style={{ opacity: 0.85 }}>{item.detail}</div>
                        {item.path && <Link to={item.path} style={{ fontSize: "0.75rem" }}>{item.path}</Link>}
                      </div>
                      <StatusBadge label={item.severity} variant={severityVariant(item.severity)} />
                    </div>
                  ))}
                  {!q.items.length && <p className="hq-muted-text">Queue empty.</p>}
                </div>
              </div>
            </>
          )}
        </>
      )}

          <p className="hq-muted-text" style={{ marginTop: "0.75rem", fontSize: "0.78rem" }}>
            Modules 7–8 ship next in separate commits. Mutations require confirmation. Every Brain v1 read is logged.
          </p>
        </div>
      </div>
    </HQLayout>
  );
};

export default AuraEnterpriseBrainV1Page;
