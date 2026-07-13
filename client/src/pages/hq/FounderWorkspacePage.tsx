import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity, AlertTriangle, Briefcase, Calendar, CheckCircle2, FileText, FolderOpen,
  Landmark, Lightbulb, Megaphone, Monitor, RefreshCw, Shield, Target, Users, Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import HQLayout from "../../layouts/HQLayout";
import {
  EMPTY_FOUNDER_WORKSPACE,
  autonomousOpsApi,
  type FounderCommandCard,
} from "../../api/autonomousOpsApi";
import { KpiCard } from "../../components/hq/KpiCard";
import { StatusBadge } from "../../components/hq/StatusBadge";
import { HqLoading } from "../../components/hq/HqLoading";
import { HqApiError } from "../../api/hqApiFetch";

function errorMessage(err: unknown): string {
  if (err instanceof HqApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Request failed.";
}

const CARD_ICONS: Record<string, LucideIcon> = {
  "executive-briefing": FileText,
  "pending-approvals": CheckCircle2,
  "organization-health": Activity,
  "enterprise-health": Target,
  "active-grants": FileText,
  "funding-pipeline": Wallet,
  "financial-summary": Landmark,
  "hr-summary": Users,
  communications: Megaphone,
  "system-health": Shield,
  alerts: AlertTriangle,
  projects: Briefcase,
  calendar: Calendar,
  documents: FolderOpen,
  "software-division": Monitor,
};

const FounderWorkspacePage: React.FC = () => {
  const qc = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [notify, setNotify] = useState(false);
  const [cycleNote, setCycleNote] = useState<string | null>(null);

  const ws = useQuery({
    queryKey: ["founder-workspace"],
    queryFn: () => autonomousOpsApi.workspace(),
    staleTime: 25_000,
    refetchInterval: 60_000,
    retry: 1,
    placeholderData: (prev) => prev ?? EMPTY_FOUNDER_WORKSPACE,
  });

  const refreshMutation = useMutation({
    mutationFn: () => autonomousOpsApi.workspace({ refresh: true }),
    onSuccess: (data) => {
      setActionError(null);
      qc.setQueryData(["founder-workspace"], data);
    },
    onError: (err) => setActionError(errorMessage(err)),
  });

  const cycleMutation = useMutation({
    mutationFn: () => autonomousOpsApi.runCycle({ notifyFounderChannels: notify }),
    onSuccess: (data) => {
      setActionError(null);
      setCycleNote(data.speechSummary);
      void qc.invalidateQueries({ queryKey: ["founder-workspace"] });
    },
    onError: (err) => setActionError(errorMessage(err)),
  });

  const d = ws.data ?? EMPTY_FOUNDER_WORKSPACE;
  const hasServerPayload = Boolean(ws.data?.performance || (ws.data?.commandCards && ws.data.commandCards.length > 0));
  const isInitialLoad = !hasServerPayload && (ws.isPending || ws.isFetching);
  const isRefreshing = (ws.isFetching || refreshMutation.isPending) && hasServerPayload;
  const perf = d.performance;
  const cards: FounderCommandCard[] = d.commandCards?.length
    ? d.commandCards
    : [
        {
          id: "organization-health",
          label: "Organization Health",
          value: d.organizationHealth != null ? `${d.organizationHealth}%` : "—",
          meta: "Enterprise OS",
          path: "/hq/enterprise-os",
          status: d.organizationHealth != null ? "live" : "empty",
        },
        {
          id: "pending-approvals",
          label: "Pending Approvals",
          value: String(d.pendingApprovals),
          meta: "Workflows",
          path: "/hq/workflows",
          status: "live",
          variant: d.pendingApprovals >= 3 ? "warning" : "success",
        },
        {
          id: "funding-pipeline",
          label: "Funding Pipeline",
          value: d.activeGrants.pipelineValue != null ? String(d.activeGrants.pipelineValue) : "—",
          meta: "Grant Center",
          path: "/hq/grants",
          status: d.activeGrants.pipelineValue != null ? "live" : "empty",
        },
        {
          id: "alerts",
          label: "Critical Alerts",
          value: String(d.criticalAlerts.length),
          meta: "Notifications",
          path: "/hq/notifications",
          status: "live",
        },
        {
          id: "projects",
          label: "Active Projects",
          value: String(d.activeProjects.count),
          meta: "Operations",
          path: "/hq/operations",
          status: "live",
        },
        {
          id: "system-health",
          label: "System Health",
          value: d.monitoring ? String(d.monitoring.score) : "—",
          meta: "Monitoring",
          path: "/hq/monitoring",
          status: d.monitoring ? "live" : "empty",
        },
      ];

  const briefing = d.dailyBriefing;
  const briefingText =
    briefing && typeof briefing === "object"
      ? String(briefing.content || briefing.summary || briefing.speechSummary || "").slice(0, 1600)
      : "";
  const briefingTitle = briefing && typeof briefing === "object" ? String(briefing.title || "Today's Executive Briefing") : "Executive Briefing";
  const briefingPath = (briefing && typeof briefing === "object" && briefing.path ? String(briefing.path) : null) || "/hq/founder";

  const priorities = d.todayPriorityItems?.length
    ? d.todayPriorityItems
    : d.todayPriorities.map((title, i) => ({ id: `p-${i}`, title, path: "/hq/workflows" }));

  const reminders = d.personalReminderItems?.length
    ? d.personalReminderItems
    : d.personalReminders.map((title, i) => ({ id: `r-${i}`, title, path: "/hq/workflows" }));

  return (
    <HQLayout
      title="Founder Workspace"
      subtitle="Executive home — every card opens live HQ · auto-refresh · high-impact stays Founder-gated"
      auraModule="aura"
    >
      {actionError && <p style={{ color: "var(--hq-danger)", marginBottom: "0.75rem" }}>{actionError}</p>}
      {ws.isError && (
        <div className="hq-anomaly-alert hq-sev-medium" style={{ marginBottom: "1rem" }} role="alert">
          <AlertTriangle size={16} />
          <div>
            <strong>Workspace failed to load</strong>
            <span> {errorMessage(ws.error)}. Live HQ data is unavailable until this recovers.</span>
            <button type="button" className="hq-btn hq-btn-sm hq-btn-ghost" style={{ marginLeft: "0.5rem" }} onClick={() => void ws.refetch()}>
              Retry
            </button>
          </div>
        </div>
      )}

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
          <button
            type="button"
            className="hq-btn hq-btn-ghost"
            disabled={isRefreshing}
            onClick={() => refreshMutation.mutate()}
          >
            {refreshMutation.isPending ? "Refreshing…" : "Refresh workspace"}
          </button>
          <label style={{ fontSize: "0.82rem", display: "flex", gap: "0.4rem", alignItems: "center" }}>
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            Notify Founder channels on high alerts
          </label>
          <span style={{ fontSize: "0.8rem", color: "var(--hq-muted-text)", marginLeft: "auto" }}>
            {isInitialLoad
              ? "Loading…"
              : isRefreshing
                ? "Refreshing…"
                : `Last updated ${new Date(d.generatedAt).toLocaleTimeString()}${
                    d.cache?.hit ? " · cached" : ""
                  }${perf ? ` · ${perf.totalMs}ms · health ${perf.workspaceHealthScore}%` : ""}`}
          </span>
        </div>
        {cycleNote && (
          <p style={{ fontSize: "0.85rem", padding: "0 1rem 1rem", margin: 0, lineHeight: 1.45 }}>{cycleNote}</p>
        )}
      </div>

      {isInitialLoad && (
        <HqLoading label="Loading live Founder Workspace…" />
      )}
      {cycleMutation.isPending && !isInitialLoad && (
        <p style={{ fontSize: "0.85rem", color: "var(--hq-muted-text)", marginBottom: "0.75rem" }}>
          AURA is running an autonomous cycle in the background…
        </p>
      )}

      {!isInitialLoad && (
        <>
      <div className="hq-kpi-grid" style={{ marginBottom: "1rem" }}>
        {cards.map((card) => (
          <KpiCard
            key={card.id}
            label={card.label}
            value={card.value}
            meta={card.meta}
            icon={CARD_ICONS[card.id]}
            variant={card.variant || (card.status === "empty" || card.status === "degraded" ? "muted" : "gold")}
            to={card.path}
          />
        ))}
      </div>

      <div className="hq-grid-2" style={{ marginBottom: "1rem" }}>
        <div className="hq-panel">
          <div className="hq-panel-header">
            <div>
              <div className="hq-panel-title">Today's Priorities</div>
              <div className="hq-panel-subtitle">Live recommendations with open actions</div>
            </div>
            <Link to="/hq/workflows" className="hq-btn hq-btn-ghost hq-btn-sm">Approvals</Link>
          </div>
          <div className="hq-panel-body">
            {priorities.length === 0 ? (
              <p style={{ fontSize: "0.85rem", color: "var(--hq-muted-text)" }}>
                No priorities yet. Run an autonomous cycle to generate live actions.
              </p>
            ) : (
              <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                {priorities.map((p) => (
                  <li key={p.id} style={{ marginBottom: "0.55rem" }}>
                    <Link to={p.path} style={{ fontSize: "0.88rem", display: "block" }}>
                      {p.title}
                      <span style={{ display: "block", fontSize: "0.72rem", color: "var(--hq-muted-text)" }}>{p.path}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <h4 style={{ color: "var(--hq-gold)", margin: "0.85rem 0 0.4rem" }}>Reminders</h4>
            {reminders.length === 0 ? (
              <p style={{ fontSize: "0.82rem", color: "var(--hq-muted-text)" }}>No reminders.</p>
            ) : (
              <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                {reminders.map((r) => (
                  <li key={r.id} style={{ marginBottom: "0.4rem" }}>
                    <Link to={r.path} style={{ fontSize: "0.82rem" }}>{r.title}</Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="hq-panel">
          <div className="hq-panel-header">
            <div>
              <div className="hq-panel-title">{briefingTitle}</div>
              <div className="hq-panel-subtitle">Live executive briefing</div>
            </div>
            <Link to={briefingPath} className="hq-btn hq-btn-primary hq-btn-sm">Open briefing</Link>
          </div>
          <div className="hq-panel-body">
            {briefingText ? (
              <p style={{ fontSize: "0.85rem", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{briefingText}</p>
            ) : (
              <p style={{ fontSize: "0.85rem", color: "var(--hq-muted-text)" }}>
                No data available for today's briefing. Run Autonomous Cycle or open Founder Command Center.
              </p>
            )}
            {d.memorySummary && (
              <>
                <h4 style={{ color: "var(--hq-gold)", margin: "0.85rem 0 0.4rem" }}>Executive Memory</h4>
                <p style={{ fontSize: "0.8rem", color: "var(--hq-muted-text)", lineHeight: 1.45 }}>{d.memorySummary}</p>
                <Link to={d.memoryPath || "/hq/knowledge"} className="hq-btn hq-btn-ghost hq-btn-sm" style={{ marginTop: "0.5rem" }}>
                  Open Knowledge Base
                </Link>
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
          <div className="hq-panel-header">
            <div className="hq-panel-title">
              <Lightbulb size={16} style={{ verticalAlign: "middle", marginRight: 6 }} />
              Executive Recommendations
            </div>
          </div>
          <div className="hq-panel-body">
            {d.executiveRecommendations.length === 0 ? (
              <p style={{ fontSize: "0.85rem", color: "var(--hq-muted-text)" }}>
                No recommendations yet. Run an autonomous cycle for live evidence-based actions.
              </p>
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
                    {r.recommendedAction}
                  </p>
                  <Link to={r.path} className="hq-btn hq-btn-ghost hq-btn-sm" style={{ marginTop: "0.4rem" }}>
                    Open {r.path}
                  </Link>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="hq-panel">
          <div className="hq-panel-header">
            <div className="hq-panel-title">Prepared for Review</div>
            <Link to="/hq/enterprise-ops" className="hq-btn hq-btn-ghost hq-btn-sm">Ops 5.0</Link>
          </div>
          <div className="hq-panel-body">
            {d.preparedPackages.length === 0 ? (
              <p style={{ fontSize: "0.85rem", color: "var(--hq-muted-text)" }}>
                No prepared packages. Run Autonomous Cycle to draft OS4/Ops5 review items.
              </p>
            ) : (
              d.preparedPackages.map((p) => (
                <div key={p.id} style={{ marginBottom: "0.7rem" }}>
                  <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                    <StatusBadge status={p.status} />
                    <strong style={{ fontSize: "0.85rem" }}>{p.title}</strong>
                  </div>
                  <p style={{ fontSize: "0.78rem", color: "var(--hq-muted-text)", margin: "0.25rem 0" }}>{p.summary}</p>
                  <Link to={p.path} className="hq-btn hq-btn-ghost hq-btn-sm">Open package</Link>
                </div>
              ))
            )}

            <div className="hq-panel-header" style={{ padding: "0.75rem 0 0.4rem", border: "none" }}>
              <div className="hq-panel-title">Critical Alerts</div>
              <Link to="/hq/notifications" className="hq-btn hq-btn-ghost hq-btn-sm">All alerts</Link>
            </div>
            {d.criticalAlerts.length === 0 ? (
              <p style={{ fontSize: "0.85rem", color: "var(--hq-muted-text)" }}>No high-priority leadership alerts.</p>
            ) : (
              d.criticalAlerts.map((a) => (
                <div key={a.id} style={{ marginBottom: "0.55rem", fontSize: "0.82rem" }}>
                  <Link to={a.path}>
                    <strong>{a.title}</strong>
                  </Link>
                  <div style={{ color: "var(--hq-muted-text)" }}>{a.message}</div>
                </div>
              ))
            )}

            <div className="hq-panel-header" style={{ padding: "0.75rem 0 0.4rem", border: "none" }}>
              <div className="hq-panel-title">Strategic Goals</div>
              <Link to="/hq/enterprise-ops" className="hq-btn hq-btn-ghost hq-btn-sm">Goals</Link>
            </div>
            {d.strategicGoals.length === 0 ? (
              <p style={{ fontSize: "0.85rem", color: "var(--hq-muted-text)" }}>No goals loaded.</p>
            ) : (
              <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                {d.strategicGoals.map((g) => (
                  <li key={g.title} style={{ marginBottom: "0.35rem" }}>
                    <Link to={g.path || "/hq/enterprise-ops"} style={{ fontSize: "0.82rem" }}>
                      {g.title} — {g.progressPercent}% ({g.status || "—"})
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div className="hq-panel">
        <div className="hq-panel-header">
          <div className="hq-panel-title">Command Surfaces</div>
          <div className="hq-panel-subtitle">Direct links to live HQ modules</div>
        </div>
        <div className="hq-panel-body" style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          {(d.deepLinks.length ? d.deepLinks : [
            { label: "Grant Center", path: "/hq/grants" },
            { label: "Financial Center", path: "/hq/finance" },
            { label: "People / HR", path: "/hq/people" },
            { label: "Workflows", path: "/hq/workflows" },
            { label: "Monitoring", path: "/hq/monitoring" },
          ]).map((link) => (
            <Link key={link.path + link.label} to={link.path} className="hq-btn hq-btn-ghost" style={{ fontSize: "0.78rem" }}>
              {link.label}
            </Link>
          ))}
        </div>
      </div>

      {perf && (
        <div className="hq-panel" style={{ marginTop: "1rem" }}>
          <div className="hq-panel-body" style={{ fontSize: "0.8rem", color: "var(--hq-muted-text)" }}>
            Workspace health {perf.workspaceHealthScore}% · load {perf.totalMs}ms
            {perf.slowestEndpoint ? ` · slowest ${perf.slowestEndpoint.id} ${perf.slowestEndpoint.ms}ms` : ""}
            {" · "}live {perf.liveCards} · degraded {perf.degradedCards} · empty {perf.emptyCards}
            {perf.timedOutCount ? ` · timeouts ${perf.timedOutCount}` : ""}
          </div>
        </div>
      )}
        </>
      )}
    </HQLayout>
  );
};

export default FounderWorkspacePage;
