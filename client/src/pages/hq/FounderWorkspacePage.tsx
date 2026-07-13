import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity, AlertTriangle, Briefcase, CheckCircle2, Lightbulb, RefreshCw, Target, Wallet,
} from "lucide-react";
import HQLayout from "../../layouts/HQLayout";
import {
  EMPTY_FOUNDER_WORKSPACE,
  autonomousOpsApi,
} from "../../api/autonomousOpsApi";
import { KpiCard } from "../../components/hq/KpiCard";
import { StatusBadge } from "../../components/hq/StatusBadge";
import { HqLoading } from "../../components/hq/HqLoading";
import { HqApiError } from "../../api/hqApiFetch";
import { formatCurrency } from "../../utils/safeFormat";

function errorMessage(err: unknown): string {
  if (err instanceof HqApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Request failed.";
}

const FounderWorkspacePage: React.FC = () => {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [notify, setNotify] = useState(false);
  const [cycleNote, setCycleNote] = useState<string | null>(null);

  const ws = useQuery({
    queryKey: ["founder-workspace"],
    queryFn: async () => {
      try {
        return await autonomousOpsApi.workspace();
      } catch (err) {
        console.warn("[founder-workspace] load failed:", err);
        return EMPTY_FOUNDER_WORKSPACE;
      }
    },
    placeholderData: EMPTY_FOUNDER_WORKSPACE,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const cycleMutation = useMutation({
    mutationFn: () => autonomousOpsApi.runCycle({ notifyFounderChannels: notify }),
    onSuccess: (data) => {
      setError(null);
      setCycleNote(data.speechSummary);
      qc.invalidateQueries({ queryKey: ["founder-workspace"] });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const d = ws.data ?? EMPTY_FOUNDER_WORKSPACE;
  const briefingText =
    d.dailyBriefing && typeof d.dailyBriefing === "object"
      ? String(
          (d.dailyBriefing as { speechSummary?: string; summary?: string; content?: string }).speechSummary
            || (d.dailyBriefing as { summary?: string }).summary
            || (d.dailyBriefing as { content?: string }).content
            || ""
        ).slice(0, 1200)
      : "";

  return (
    <HQLayout
      title="Founder Workspace"
      subtitle="AURA Autonomous Operations — Chief of Staff prep, alerts, and priorities · high-impact stays Founder-gated"
      auraModule="aura"
    >
      {error && <p style={{ color: "var(--hq-danger)", marginBottom: "0.75rem" }}>{error}</p>}

      <div className="hq-panel" style={{ marginBottom: "1rem" }}>
        <div className="hq-panel-body" style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
          <button
            type="button"
            className="hq-btn hq-btn-primary"
            disabled={cycleMutation.isPending}
            onClick={() => cycleMutation.mutate()}
          >
            <RefreshCw size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
            {cycleMutation.isPending ? "Running autonomous cycle…" : "Run Autonomous Cycle"}
          </button>
          <label style={{ fontSize: "0.82rem", display: "flex", gap: "0.4rem", alignItems: "center" }}>
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            Notify Founder channels on high alerts
          </label>
          <span style={{ fontSize: "0.8rem", color: "var(--hq-muted-text)" }}>
            Prep only · no silent external sends · hourly scheduler job enabled
          </span>
        </div>
        {cycleNote && (
          <p style={{ fontSize: "0.85rem", padding: "0 1rem 1rem", margin: 0, lineHeight: 1.45 }}>{cycleNote}</p>
        )}
      </div>

      {cycleMutation.isPending && <HqLoading label="AURA is scanning HQ and preparing packages…" />}

      <div className="hq-kpi-grid" style={{ marginBottom: "1rem" }}>
        <KpiCard
          label="Org Health"
          value={d.organizationHealth != null ? `${d.organizationHealth}%` : "—"}
          icon={Activity}
          variant="gold"
        />
        <KpiCard
          label="Enterprise Health"
          value={d.enterpriseHealth != null ? `${d.enterpriseHealth}` : "—"}
          icon={Target}
        />
        <KpiCard
          label="Pipeline"
          value={d.activeGrants.pipelineValue != null ? formatCurrency(d.activeGrants.pipelineValue) : "—"}
          icon={Wallet}
        />
        <KpiCard
          label="Approvals"
          value={d.pendingApprovals}
          icon={CheckCircle2}
          variant={d.pendingApprovals >= 3 ? "warning" : "success"}
        />
        <KpiCard
          label="Critical Alerts"
          value={d.criticalAlerts.length}
          icon={AlertTriangle}
          variant={d.criticalAlerts.length ? "warning" : "success"}
        />
        <KpiCard label="Active Projects" value={d.activeProjects.count} icon={Briefcase} />
      </div>

      <div className="hq-grid-2" style={{ marginBottom: "1rem" }}>
        <div className="hq-panel">
          <div className="hq-panel-body">
            <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.5rem" }}>Today's Priorities</h4>
            {d.todayPriorities.length === 0 ? (
              <p style={{ fontSize: "0.85rem", color: "var(--hq-muted-text)" }}>Run a cycle to refresh priorities.</p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.88rem", lineHeight: 1.55 }}>
                {d.todayPriorities.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
            <h4 style={{ color: "var(--hq-gold)", margin: "0.85rem 0 0.4rem" }}>Personal Reminders</h4>
            <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.82rem", color: "var(--hq-muted-text)" }}>
              {d.personalReminders.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        </div>
        <div className="hq-panel">
          <div className="hq-panel-body">
            <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.5rem" }}>Daily Briefing</h4>
            {briefingText ? (
              <p style={{ fontSize: "0.85rem", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{briefingText}</p>
            ) : (
              <p style={{ fontSize: "0.85rem", color: "var(--hq-muted-text)" }}>Briefing will appear after generation.</p>
            )}
            {d.memorySummary && (
              <>
                <h4 style={{ color: "var(--hq-gold)", margin: "0.85rem 0 0.4rem" }}>Executive Memory</h4>
                <p style={{ fontSize: "0.8rem", color: "var(--hq-muted-text)", lineHeight: 1.45 }}>{d.memorySummary}</p>
              </>
            )}
            {d.latestCycle && (
              <p style={{ fontSize: "0.75rem", color: "var(--hq-muted-text)", marginTop: "0.75rem" }}>
                Last cycle {new Date(d.latestCycle.createdAt).toLocaleString()}
                {d.latestCycle.monitoringScore != null ? ` · monitoring ${d.latestCycle.monitoringScore}` : ""}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="hq-grid-2" style={{ marginBottom: "1rem" }}>
        <div className="hq-panel">
          <div className="hq-panel-body">
            <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.5rem" }}>
              <Lightbulb size={16} style={{ verticalAlign: "middle", marginRight: 6 }} />
              Executive Recommendations
            </h4>
            {d.executiveRecommendations.length === 0 ? (
              <p style={{ fontSize: "0.85rem", color: "var(--hq-muted-text)" }}>No recommendations yet.</p>
            ) : (
              d.executiveRecommendations.map((r) => (
                <div key={r.id} style={{ marginBottom: "0.85rem", paddingBottom: "0.65rem", borderBottom: "1px solid var(--hq-border)" }}>
                  <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", flexWrap: "wrap" }}>
                    <StatusBadge status={r.confidence} />
                    <strong style={{ fontSize: "0.88rem" }}>{r.title}</strong>
                    {r.founderApprovalRequired && <StatusBadge status="awaiting_founder" />}
                  </div>
                  <p style={{ fontSize: "0.8rem", margin: "0.3rem 0" }}>{r.evidence}</p>
                  <p style={{ fontSize: "0.78rem", color: "var(--hq-muted-text)", margin: 0 }}>
                    Sources: {r.sourceSystems.join(", ")} · Action: {r.recommendedAction}
                  </p>
                  <p style={{ fontSize: "0.75rem", color: "var(--hq-muted-text)" }}>
                    Risks: {r.risks.join("; ") || "—"} · Benefits: {r.benefits.join("; ") || "—"}
                  </p>
                  <Link to={r.path} style={{ fontSize: "0.78rem" }}>{r.path}</Link>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="hq-panel">
          <div className="hq-panel-body">
            <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.5rem" }}>Prepared for Review</h4>
            {d.preparedPackages.length === 0 ? (
              <p style={{ fontSize: "0.85rem", color: "var(--hq-muted-text)" }}>
                Autonomous prep packages appear after a cycle (OS4 actions / Ops5 cadences).
              </p>
            ) : (
              d.preparedPackages.map((p) => (
                <div key={p.id} style={{ marginBottom: "0.7rem" }}>
                  <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                    <StatusBadge status={p.status} />
                    <strong style={{ fontSize: "0.85rem" }}>{p.title}</strong>
                  </div>
                  <p style={{ fontSize: "0.78rem", color: "var(--hq-muted-text)", margin: "0.25rem 0" }}>{p.summary}</p>
                  <Link to={p.path} style={{ fontSize: "0.75rem" }}>{p.path}</Link>
                </div>
              ))
            )}

            <h4 style={{ color: "var(--hq-gold)", margin: "1rem 0 0.4rem" }}>Critical Alerts</h4>
            {d.criticalAlerts.length === 0 ? (
              <p style={{ fontSize: "0.85rem", color: "var(--hq-muted-text)" }}>No high-priority leadership alerts.</p>
            ) : (
              d.criticalAlerts.map((a) => (
                <div key={a.id} style={{ marginBottom: "0.55rem", fontSize: "0.82rem" }}>
                  <strong>{a.title}</strong>
                  <div style={{ color: "var(--hq-muted-text)" }}>{a.message}</div>
                  <Link to={a.path}>{a.path}</Link>
                </div>
              ))
            )}

            <h4 style={{ color: "var(--hq-gold)", margin: "1rem 0 0.4rem" }}>Strategic Goals</h4>
            {d.strategicGoals.length === 0 ? (
              <p style={{ fontSize: "0.85rem", color: "var(--hq-muted-text)" }}>No goals loaded.</p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.82rem" }}>
                {d.strategicGoals.map((g) => (
                  <li key={g.title}>{g.title} — {g.progressPercent}% ({g.status || "—"})</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {d.deepLinks.length > 0 && (
        <div className="hq-panel">
          <div className="hq-panel-body">
            <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.5rem" }}>Command Surfaces</h4>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
              {d.deepLinks.map((link) => (
                <Link key={link.path} to={link.path} className="hq-btn hq-btn-ghost" style={{ fontSize: "0.78rem" }}>
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </HQLayout>
  );
};

export default FounderWorkspacePage;
