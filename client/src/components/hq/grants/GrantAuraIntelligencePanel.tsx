import React, { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Sparkles, Search, RefreshCw } from "lucide-react";
import { grantsApi } from "../../../api/grantsApi";
import { HqPanel } from "../HqPanel";
import { StatusBadge } from "../StatusBadge";
import { HqLoading } from "../HqLoading";

export const GrantAuraIntelligencePanel: React.FC = () => {
  const [question, setQuestion] = useState("");
  const [search, setSearch] = useState({ keywords: "", division: "", minAmount: "" });
  const [matchId, setMatchId] = useState("");
  const [writePrompt, setWritePrompt] = useState("");
  const [narrative, setNarrative] = useState<string | null>(null);
  const [matchResult, setMatchResult] = useState<Record<string, unknown> | null>(null);

  const aura = useQuery({
    queryKey: ["grant-funding-aura-v2-panel"],
    queryFn: () => grantsApi.v2FundingAura(),
    staleTime: 300_000,
  });

  const auraAsk = useMutation({
    mutationFn: (q: string) => grantsApi.v2FundingAura(q),
  });

  const aiFind = useMutation({
    mutationFn: () =>
      grantsApi.aiFind({
        keywords: search.keywords || undefined,
        minAmount: search.minAmount ? Number(search.minAmount) : undefined,
        division: search.division || undefined,
      }),
  });

  const aiMatch = useMutation({
    mutationFn: () => grantsApi.aiMatch(matchId),
    onSuccess: (data) => setMatchResult(data as Record<string, unknown>),
  });

  const aiWrite = useMutation({
    mutationFn: () => grantsApi.aiWrite({ prompt: writePrompt, section: "narrative" }),
    onSuccess: (data) => setNarrative(data.narrative),
  });

  const applications = useQuery({ queryKey: ["grants-applications"], queryFn: grantsApi.applications });

  return (
    <div className="hq-fade-in">
      <HqPanel title="AURA Funding Intelligence v2" subtitle="Priority grants, deadlines, compliance risks, and funding capacity">
        {aura.isLoading ? (
          <HqLoading />
        ) : (
          <>
            <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
              <input
                className="hq-aura-input"
                placeholder="Ask AURA about funding priorities, risks, or division gaps…"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                style={{ flex: "1 1 240px" }}
              />
              <button
                type="button"
                className="hq-btn hq-btn-primary hq-btn-sm"
                disabled={auraAsk.isPending}
                onClick={() => auraAsk.mutate(question || "Summarize IFCDC funding priorities for the next 30 days.")}
              >
                <Sparkles size={14} /> Ask AURA
              </button>
              <button type="button" className="hq-btn hq-btn-ghost hq-btn-sm" onClick={() => aura.refetch()}>
                <RefreshCw size={14} /> Refresh
              </button>
            </div>
            {(auraAsk.data?.offline ?? aura.data?.offline) && (
              <StatusBadge label="Offline briefing" variant="warning" />
            )}
            {auraAsk.data?.capacityEstimate != null && (
              <div style={{ fontSize: "0.82rem", color: "var(--hq-gold)", marginBottom: "0.5rem" }}>
                Estimated funding capacity: ${Number(auraAsk.data?.capacityEstimate ?? aura.data?.capacityEstimate ?? 0).toLocaleString()}
              </div>
            )}
            <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: "0.85rem", lineHeight: 1.65, color: "var(--hq-text-muted)", margin: "0.75rem 0 0" }}>
              {auraAsk.data?.insight ?? aura.data?.insight ?? "AURA briefing will generate on request."}
            </pre>
            {(auraAsk.data?.priorityGrants ?? aura.data?.priorityGrants ?? []).length > 0 && (
              <div style={{ marginTop: "1rem" }}>
                <h4 style={{ fontSize: "0.85rem", color: "var(--hq-gold)", marginBottom: "0.5rem" }}>Priority Grants</h4>
                <ul className="hq-activity-list" style={{ margin: 0, padding: 0, listStyle: "none" }}>
                  {(auraAsk.data?.priorityGrants ?? aura.data?.priorityGrants ?? []).slice(0, 5).map((g, i) => (
                    <li key={i} className="hq-activity-item">
                      <div className="hq-activity-content">
                        <div className="hq-activity-title">{String((g as Record<string, unknown>).title ?? "—")}</div>
                        <div className="hq-activity-detail">{String((g as Record<string, unknown>).funder ?? "")}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </HqPanel>

      <div className="hq-grid-2" style={{ marginTop: "1.25rem" }}>
        <HqPanel title="AI Grant Finder" subtitle="Search and score via the funding engine">
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.75rem" }}>
            <input
              className="hq-aura-input"
              placeholder="Keywords…"
              value={search.keywords}
              onChange={(e) => setSearch({ ...search, keywords: e.target.value })}
              style={{ flex: "1 1 160px" }}
            />
            <select className="hq-aura-input" value={search.division} onChange={(e) => setSearch({ ...search, division: e.target.value })}>
              <option value="">All divisions</option>
              <option value="housing">Housing</option>
              <option value="scholarships">Scholarships</option>
              <option value="tapis">TAPIS</option>
              <option value="community_programs">Community Programs</option>
            </select>
            <button type="button" className="hq-btn hq-btn-secondary hq-btn-sm" disabled={aiFind.isPending} onClick={() => aiFind.mutate()}>
              <Search size={14} /> Find & Score
            </button>
          </div>
          <table className="hq-table">
            <thead><tr><th>Opportunity</th><th>Score</th><th>Grade</th></tr></thead>
            <tbody>
              {(aiFind.data?.opportunities ?? []).map((o) => (
                <tr key={String(o.id)}>
                  <td><strong>{String(o.title)}</strong><div className="hq-muted-text">{String(o.funder ?? "")}</div></td>
                  <td><StatusBadge label={`${o.eligibilityScore ?? 0}%`} variant={(o.eligibilityScore as number) >= 70 ? "success" : "warning"} /></td>
                  <td>{String((o as { grade?: string }).grade ?? "—")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </HqPanel>

        <HqPanel title="Application Eligibility Match">
          <select className="hq-aura-input" value={matchId} onChange={(e) => setMatchId(e.target.value)} style={{ marginBottom: "0.5rem", width: "100%" }}>
            <option value="">Select application…</option>
            {(applications.data?.applications ?? []).map((a) => (
              <option key={a.id} value={a.id}>{a.title}</option>
            ))}
          </select>
          <button type="button" className="hq-btn hq-btn-secondary hq-btn-sm" disabled={!matchId || aiMatch.isPending} onClick={() => aiMatch.mutate()}>
            Score Match
          </button>
          {matchResult && (
            <div style={{ marginTop: "0.75rem", fontSize: "0.85rem" }}>
              <StatusBadge label={`${matchResult.score}% — ${String(matchResult.recommendation ?? "")}`} variant="gold" />
            </div>
          )}

          <div style={{ marginTop: "1.25rem" }}>
            <label style={{ fontSize: "0.78rem", color: "var(--hq-text-muted)" }}>Grant writing assistant</label>
            <textarea
              className="hq-aura-input"
              rows={3}
              value={writePrompt}
              onChange={(e) => setWritePrompt(e.target.value)}
              placeholder="Describe the narrative section you need…"
              style={{ marginTop: "0.35rem" }}
            />
            <button
              type="button"
              className="hq-btn hq-btn-primary hq-btn-sm"
              style={{ marginTop: "0.5rem" }}
              disabled={!writePrompt || aiWrite.isPending}
              onClick={() => aiWrite.mutate()}
            >
              Generate with AURA
            </button>
            {narrative && (
              <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: "0.82rem", marginTop: "0.75rem", color: "var(--hq-text-muted)" }}>
                {narrative}
              </pre>
            )}
          </div>
        </HqPanel>
      </div>
    </div>
  );
};
