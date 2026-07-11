import React, { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Activity, AlertTriangle, Brain, Lightbulb, Target, TrendingUp, Wallet, Shield,
} from "lucide-react";
import HQLayout from "../../layouts/HQLayout";
import { hqApi } from "../../api/hqApi";
import { KpiCard } from "../../components/hq/KpiCard";
import { StatusBadge } from "../../components/hq/StatusBadge";
import { HqApiError } from "../../api/hqApiFetch";
import { formatCurrency } from "../../utils/safeFormat";

function errorMessage(err: unknown): string {
  if (err instanceof HqApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Request failed.";
}

const QUICK_DECISIONS = [
  "Should we hire more staff?",
  "Can we afford this project?",
  "Should we expand this program?",
  "What happens if we receive a $2 million grant?",
  "What happens if we hire five employees?",
  "What happens if we lose a major funding source?",
  "Prepare weekly executive review",
  "Show strategic goals",
];

const EnterpriseBrainDashboardPage: React.FC = () => {
  const [decisionQ, setDecisionQ] = useState("Should we hire more staff?");
  const [decisionOut, setDecisionOut] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dashboard = useQuery({
    queryKey: ["aura-edi-dashboard"],
    queryFn: hqApi.auraEdiDashboard,
    staleTime: 60_000,
  });

  const decideMutation = useMutation({
    mutationFn: (request: string) => hqApi.auraEdiDecide(request),
    onSuccess: (data) => {
      setError(null);
      setDecisionOut(String(data.unifiedBriefing || data.speechSummary || JSON.stringify(data)));
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const d = dashboard.data;
  const goals = d?.strategicGoals ?? [];
  const risks = d?.activeRisks ?? [];
  const opportunities = d?.opportunities ?? [];
  const dimensions = d?.scorecard?.dimensions ?? [];

  return (
    <HQLayout
      title="Enterprise Brain"
      subtitle="Executive Decision Intelligence — evidence-based recommendations with Founder approval gates"
      auraModule="aura"
    >
      {error && <p style={{ color: "var(--hq-danger)", marginBottom: "0.75rem" }}>{error}</p>}
      {dashboard.isError && (
        <p style={{ color: "var(--hq-danger)", marginBottom: "0.75rem" }}>
          {errorMessage(dashboard.error)}. Founder Mode may be required.
        </p>
      )}

      <div className="hq-kpi-grid" style={{ marginBottom: "1rem" }}>
        <KpiCard
          label="Enterprise Health"
          value={d?.enterpriseHealthScore != null ? `${d.enterpriseHealthScore}` : "—"}
          meta={d?.enterpriseGrade || undefined}
          icon={Activity}
          variant="gold"
        />
        <KpiCard
          label="Org Health"
          value={d?.organizationHealth != null ? `${d.organizationHealth}%` : "—"}
          meta={d?.healthGrade || undefined}
          icon={TrendingUp}
        />
        <KpiCard
          label="Pipeline"
          value={d?.fundingPipeline?.pipelineValue != null ? formatCurrency(d.fundingPipeline.pipelineValue) : "—"}
          icon={Wallet}
        />
        <KpiCard
          label="Goals Progress"
          value={d?.goalsSummary?.avgProgress != null ? `${d.goalsSummary.avgProgress}%` : "—"}
          meta={d?.goalsSummary ? `${d.goalsSummary.blocked} blocked` : undefined}
          icon={Target}
          variant={(d?.goalsSummary?.blocked ?? 0) > 0 ? "warning" : "success"}
        />
        <KpiCard
          label="Active Risks"
          value={risks.length}
          icon={AlertTriangle}
          variant={risks.length ? "warning" : "success"}
        />
        <KpiCard
          label="Tech Score"
          value={d?.orgModel?.technology?.healthScore ?? "—"}
          icon={Shield}
        />
      </div>

      <div className="hq-grid-2" style={{ marginBottom: "1rem" }}>
        <div className="hq-panel">
          <div className="hq-panel-body">
            <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.75rem" }}>Founder Priorities</h4>
            <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.9rem", lineHeight: 1.6 }}>
              {(d?.founderPriorities ?? ["Loading…"]).map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            <h4 style={{ color: "var(--hq-gold)", margin: "1rem 0 0.75rem" }}>AURA Recommendations</h4>
            <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.85rem", lineHeight: 1.6 }}>
              {(d?.auraRecommendations ?? []).slice(0, 6).map((r) => (
                <li key={r}>{r}</li>
              ))}
              {!d?.auraRecommendations?.length && <li className="hq-muted-text">No recommendations yet.</li>}
            </ul>
          </div>
        </div>

        <div className="hq-panel">
          <div className="hq-panel-body">
            <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.75rem" }}>Financial Position</h4>
            <p style={{ fontSize: "0.9rem", marginBottom: "0.35rem" }}>
              Cash flow: {d?.financialPosition?.cashFlow != null ? formatCurrency(d.financialPosition.cashFlow) : "—"}
            </p>
            <p style={{ fontSize: "0.9rem", marginBottom: "0.35rem" }}>
              Financial health: {d?.financialPosition?.financialHealthScore ?? "—"}
            </p>
            <p style={{ fontSize: "0.9rem", marginBottom: "0.75rem" }}>
              Budget remaining: {d?.financialPosition?.budgetRemaining != null ? formatCurrency(d.financialPosition.budgetRemaining) : "—"}
            </p>
            <p style={{ fontSize: "0.9rem" }}>
              Active awards: {d?.fundingPipeline?.activeAwards ?? "—"}
            </p>
          </div>
        </div>
      </div>

      <div className="hq-panel" style={{ marginBottom: "1rem" }}>
        <div className="hq-panel-body">
          <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.75rem" }}>Organization Performance Scorecard</h4>
          <div className="hq-kpi-grid">
            {dimensions.map((dim) => (
              <KpiCard
                key={dim.id}
                label={dim.label}
                value={dim.score ?? "—"}
                meta={dim.grade}
                variant={dim.score != null && dim.score < 70 ? "warning" : "success"}
              />
            ))}
            {!dimensions.length && <p className="hq-muted-text">Scorecard loading…</p>}
          </div>
        </div>
      </div>

      <div className="hq-grid-2" style={{ marginBottom: "1rem" }}>
        <div className="hq-panel">
          <div className="hq-panel-body">
            <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.75rem" }}>Strategic Goals Center</h4>
            {goals.map((g) => (
              <div
                key={g.id}
                style={{
                  padding: "0.65rem 0",
                  borderBottom: "1px solid var(--hq-border-subtle)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", alignItems: "center" }}>
                  <strong style={{ fontSize: "0.88rem" }}>{g.title}</strong>
                  <StatusBadge
                    label={g.status.replace(/_/g, " ")}
                    variant={
                      g.status === "blocked" || g.status === "at_risk"
                        ? "warning"
                        : g.status === "achieved"
                          ? "success"
                          : "muted"
                    }
                  />
                </div>
                <div style={{ fontSize: "0.8rem", opacity: 0.85, marginTop: "0.25rem" }}>
                  {g.category} · {g.progressPercent}% · {g.owner}
                </div>
                {g.blockers[0] && (
                  <div style={{ fontSize: "0.78rem", color: "var(--hq-warning, #b45309)", marginTop: "0.25rem" }}>
                    Blocker: {g.blockers[0]}
                  </div>
                )}
                {g.recommendedActions[0] && (
                  <div style={{ fontSize: "0.78rem", marginTop: "0.2rem" }}>Next: {g.recommendedActions[0]}</div>
                )}
              </div>
            ))}
            {!goals.length && <p className="hq-muted-text">Goals loading…</p>}
          </div>
        </div>

        <div className="hq-panel">
          <div className="hq-panel-body">
            <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.75rem" }}>Active Risks & Opportunities</h4>
            <h5 style={{ margin: "0 0 0.5rem", fontSize: "0.8rem", opacity: 0.8 }}>Risks</h5>
            {risks.slice(0, 4).map((r) => (
              <div key={r.id} style={{ marginBottom: "0.65rem", fontSize: "0.85rem" }}>
                <strong>{r.title}</strong>
                <div style={{ opacity: 0.85 }}>{r.whyItMatters}</div>
                <div style={{ fontSize: "0.78rem" }}>
                  Confidence: {r.confidence} · {r.recommendedAction}
                </div>
              </div>
            ))}
            {!risks.length && <p className="hq-muted-text">No predictive risks flagged.</p>}
            <h5 style={{ margin: "1rem 0 0.5rem", fontSize: "0.8rem", opacity: 0.8 }}>Opportunities</h5>
            {opportunities.slice(0, 4).map((o) => (
              <div key={o.id} style={{ marginBottom: "0.65rem", fontSize: "0.85rem" }}>
                <strong>{o.title}</strong>
                <div style={{ opacity: 0.85 }}>{o.whyItMatters}</div>
                <div style={{ fontSize: "0.78rem" }}>{o.recommendedNextStep}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="hq-panel">
        <div className="hq-panel-body">
          <h4 style={{ color: "var(--hq-gold)", marginBottom: "0.75rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <Brain size={18} /> Executive Decision Engine
          </h4>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginBottom: "0.75rem" }}>
            {QUICK_DECISIONS.map((q) => (
              <button
                key={q}
                type="button"
                className="hq-btn hq-btn-ghost hq-btn-sm"
                onClick={() => {
                  setDecisionQ(q);
                  decideMutation.mutate(q);
                }}
              >
                {q.length > 42 ? `${q.slice(0, 40)}…` : q}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
            <input
              className="hq-input"
              style={{ flex: 1, minWidth: "220px" }}
              value={decisionQ}
              onChange={(e) => setDecisionQ(e.target.value)}
              placeholder="Ask a Founder decision question…"
            />
            <button
              type="button"
              className="hq-btn hq-btn-primary"
              disabled={decideMutation.isPending || decisionQ.trim().length < 3}
              onClick={() => decideMutation.mutate(decisionQ.trim())}
            >
              <Lightbulb size={16} /> Analyze
            </button>
            <button
              type="button"
              className="hq-btn hq-btn-secondary"
              onClick={() => dashboard.refetch()}
            >
              Refresh Dashboard
            </button>
          </div>
          {decideMutation.isPending && <p className="hq-muted-text">Running Executive Decision Intelligence…</p>}
          {decisionOut && (
            <pre
              style={{
                whiteSpace: "pre-wrap",
                fontFamily: "inherit",
                fontSize: "0.82rem",
                lineHeight: 1.6,
                maxHeight: "min(55dvh, 520px)",
                overflow: "auto",
                marginTop: "0.5rem",
              }}
            >
              {decisionOut}
            </pre>
          )}
          <p style={{ fontSize: "0.75rem", opacity: 0.7, marginTop: "0.75rem" }}>
            Assumptions are labeled separately from facts. Major actions require Founder approval before execution.
          </p>
        </div>
      </div>
    </HQLayout>
  );
};

export default EnterpriseBrainDashboardPage;
