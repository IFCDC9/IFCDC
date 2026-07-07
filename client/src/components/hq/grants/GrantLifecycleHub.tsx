import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Zap, ExternalLink } from "lucide-react";
import { grantsApi } from "../../../api/grantsApi";
import { HqPanel } from "../HqPanel";
import { StatusBadge } from "../StatusBadge";
import { HqLoading } from "../HqLoading";
import { GrantSubNav } from "./GrantSubNav";
import { fmtGrantDeadline, fmtGrantAmount, fmtGrantSyncDate } from "../../../utils/grantFormat";
import { useGrantManage } from "../../../hooks/useGrantManage";

export type EnrichedOpp = {
  id: string;
  title: string;
  funder: string;
  fundingAmount: { label: string };
  eligibility: string;
  matchScore: number;
  deadlineLabel: string;
  programFit: { labels: string[] };
  statusLabel: string;
  lastSynced: string | null;
  dataSourceLabel: string;
  url: string | null;
};

export const GrantOpportunityTable: React.FC<{
  opportunities: EnrichedOpp[];
  onStartApplication?: (applicationId: string) => void;
  showActions?: boolean;
}> = ({ opportunities, onStartApplication, showActions = true }) => {
  const qc = useQueryClient();
  const { canManage } = useGrantManage();
  const [scoringId, setScoringId] = useState<string | null>(null);

  const scoreOpp = useMutation({
    mutationFn: (id: string) => grantsApi.scoreOpportunityIntelligence(id),
    onSettled: () => setScoringId(null),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["grant-enriched-opportunities"] }),
  });

  const startApp = useMutation({
    mutationFn: (opportunityId: string) => grantsApi.startGrantApplication(opportunityId, true),
    onSuccess: (data) => {
      if (data.applicationId) onStartApplication?.(data.applicationId);
      qc.invalidateQueries({ queryKey: ["grant-enriched-applications"] });
      qc.invalidateQueries({ queryKey: ["grants-applications"] });
    },
  });

  return (
    <div className="hq-table-scroll">
      <table className="hq-table">
        <thead>
          <tr>
            <th>Opportunity</th>
            <th>Funder</th>
            <th>Amount</th>
            <th>Match</th>
            <th>Deadline</th>
            <th>Program Fit</th>
            <th>Status</th>
            <th>Source</th>
            <th>Last Synced</th>
            {showActions && canManage && <th>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {opportunities.map((o) => (
            <tr key={o.id}>
              <td>
                <strong>{o.title}</strong>
                {o.url && (
                  <a href={o.url} target="_blank" rel="noopener noreferrer" className="hq-muted-text" style={{ marginLeft: 6, fontSize: "0.72rem" }}>
                    <ExternalLink size={12} />
                  </a>
                )}
              </td>
              <td>{o.funder}</td>
              <td>{o.fundingAmount?.label ?? fmtGrantAmount()}</td>
              <td>
                <StatusBadge label={`${o.matchScore}%`} variant={o.matchScore >= 70 ? "success" : o.matchScore >= 55 ? "warning" : "muted"} />
              </td>
              <td>{o.deadlineLabel ?? fmtGrantDeadline(null)}</td>
              <td className="hq-muted-text" style={{ fontSize: "0.78rem" }}>
                {o.programFit?.labels?.slice(0, 2).join(", ") || "—"}
              </td>
              <td><StatusBadge label={o.statusLabel} variant="muted" /></td>
              <td className="hq-muted-text" style={{ fontSize: "0.75rem" }}>{o.dataSourceLabel}</td>
              <td className="hq-muted-text" style={{ fontSize: "0.75rem" }}>{fmtGrantSyncDate(o.lastSynced)}</td>
              {showActions && canManage && (
                <td>
                  <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                    <button type="button" className="hq-btn hq-btn-sm hq-btn-secondary" disabled={scoringId === o.id} onClick={() => { setScoringId(o.id); scoreOpp.mutate(o.id); }}>
                      <Zap size={12} /> {scoringId === o.id ? "…" : "Score"}
                    </button>
                    <button type="button" className="hq-btn hq-btn-sm hq-btn-primary" disabled={startApp.isPending} onClick={() => startApp.mutate(o.id)}>
                      Start Application
                    </button>
                  </div>
                </td>
              )}
            </tr>
          ))}
          {opportunities.length === 0 && (
            <tr><td colSpan={showActions && canManage ? 10 : 9} className="hq-muted-text">No opportunities match this view. Sync Grants.gov to refresh live data.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

export const GrantDiscoverHub: React.FC<{ onStartApplication?: (id: string) => void }> = ({ onStartApplication }) => {
  const [view, setView] = useState<"opportunities" | "matched" | "program-matches">("opportunities");
  const [programSlug, setProgramSlug] = useState("housing");
  const [q, setQ] = useState("");

  const filter = view === "matched" ? "matched" : view === "program-matches" ? "program" : "all";
  const opps = useQuery({
    queryKey: ["grant-enriched-opportunities", filter, programSlug, q],
    queryFn: () => grantsApi.enrichedOpportunities({ filter, programSlug: view === "program-matches" ? programSlug : undefined, q: q || undefined }),
    staleTime: 30_000,
  });

  const programs = useQuery({
    queryKey: ["grant-intelligence-programs"],
    queryFn: () => grantsApi.intelligenceDashboard().then((d) => d.programs),
    staleTime: 120_000,
  });

  return (
    <HqPanel title="Grant Discovery" subtitle="Live Grants.gov and SAM.gov opportunities matched to IFCDC programs">
      <GrantSubNav
        items={[
          { id: "opportunities", label: "Opportunities" },
          { id: "matched", label: "Matched Grants" },
          { id: "program-matches", label: "Program Matches" },
        ]}
        active={view}
        onChange={(id) => setView(id as typeof view)}
      />
      <div className="hq-founder-command-strip" style={{ margin: "1rem 0", flexWrap: "wrap" }}>
        <input className="hq-input" placeholder="Search opportunities…" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 200, flex: "1 1 160px" }} />
        {view === "program-matches" && (
          <select className="hq-input" value={programSlug} onChange={(e) => setProgramSlug(e.target.value)}>
            {(programs.data ?? []).map((p) => (
              <option key={p.slug} value={p.slug}>{p.label}</option>
            ))}
          </select>
        )}
      </div>
      {opps.isLoading ? <HqLoading /> : opps.isError ? (
        <p className="hq-muted-text">Could not load opportunities. Try syncing feeds from the dashboard above.</p>
      ) : (
        <GrantOpportunityTable opportunities={(opps.data?.opportunities ?? []) as EnrichedOpp[]} onStartApplication={onStartApplication} />
      )}
    </HqPanel>
  );
};

export const GrantApplicationsHub: React.FC<{
  onOpenApplication: (applicationId: string) => void;
}> = ({ onOpenApplication }) => {
  const [view, setView] = useState<"drafts" | "all" | "submitted" | "awards" | "rejected">("all");

  const statusMap: Record<string, string | undefined> = {
    drafts: "drafts",
    submitted: "submitted",
    awards: "awards",
    rejected: "rejected",
    all: undefined,
  };

  const apps = useQuery({
    queryKey: ["grant-enriched-applications", view],
    queryFn: () => grantsApi.enrichedApplications(statusMap[view]),
    staleTime: 20_000,
  });

  return (
    <HqPanel title="Grant Applications" subtitle="Tracked applications from discovery through award — founder approval required before submit">
      <GrantSubNav
        items={[
          { id: "all", label: "Applications" },
          { id: "drafts", label: "Drafts" },
          { id: "submitted", label: "Submitted" },
          { id: "awards", label: "Awards" },
          { id: "rejected", label: "Rejections" },
        ]}
        active={view}
        onChange={(id) => setView(id as typeof view)}
      />
      {apps.isLoading ? <HqLoading /> : (
        <div className="hq-table-scroll" style={{ marginTop: "1rem" }}>
          <table className="hq-table">
            <thead>
              <tr><th>Application</th><th>Funder</th><th>Status</th><th>Workflow</th><th>Requested</th><th>Deadline</th><th></th></tr>
            </thead>
            <tbody>
              {(apps.data?.applications ?? []).map((a: Record<string, unknown>) => {
                const wf = a.workflowStage as { label?: string } | undefined;
                return (
                  <tr key={String(a.id)} style={{ cursor: "pointer" }} onClick={() => onOpenApplication(String(a.id))}>
                    <td><strong>{String(a.title)}</strong></td>
                    <td>{String(a.funder ?? "—")}</td>
                    <td><StatusBadge label={String(a.status)} variant={a.status === "awarded" ? "gold" : a.status === "denied" ? "danger" : "warning"} /></td>
                    <td><StatusBadge label={wf?.label ?? "Drafting"} variant="muted" /></td>
                    <td>{a.amount_requested != null ? `$${Number(a.amount_requested).toLocaleString()}` : "—"}</td>
                    <td>{String(a.deadlineLabel ?? fmtGrantDeadline(null))}</td>
                    <td><span className="hq-muted-text" style={{ fontSize: "0.78rem" }}>Open workspace →</span></td>
                  </tr>
                );
              })}
              {!(apps.data?.applications ?? []).length && (
                <tr><td colSpan={7} className="hq-muted-text">No applications in this view. Start one from Discover → Opportunities.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </HqPanel>
  );
};
