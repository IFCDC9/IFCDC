import React, { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Sparkles, RefreshCw, MessageCircle } from "lucide-react";
import { grantsApi } from "../../../api/grantsApi";
import { HqPanel } from "../HqPanel";
import { StatusBadge } from "../StatusBadge";
import { HqLoading } from "../HqLoading";
import { formatCurrency } from "../../../utils/safeFormat";

const fmt = formatCurrency;

export const GrantV3AuraExecutivePanel: React.FC = () => {
  const [question, setQuestion] = useState("");

  const questions = useQuery({
    queryKey: ["grant-v3-aura-questions"],
    queryFn: grantsApi.v3AuraQuestions,
    staleTime: 300_000,
  });

  const briefing = useQuery({
    queryKey: ["grant-v3-aura-briefing"],
    queryFn: () => grantsApi.v3AuraExecutive(),
    staleTime: 120_000,
  });

  const ask = useMutation({
    mutationFn: (q: string) => grantsApi.v3AuraExecutive(q),
  });

  const data = ask.data ?? briefing.data;
  const suggested = questions.data?.questions ?? data?.suggestedQuestions ?? [];

  return (
    <div className="hq-fade-in">
      <HqPanel title="AURA Executive Intelligence" subtitle="Strategic funding advisor for IFCDC leadership">
        {briefing.isLoading ? (
          <HqLoading />
        ) : (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginBottom: "0.75rem" }}>
              {suggested.map((q) => (
                <button
                  key={q}
                  type="button"
                  className="hq-btn hq-btn-ghost hq-btn-sm"
                  style={{ fontSize: "0.78rem" }}
                  onClick={() => { setQuestion(q); ask.mutate(q); }}
                >
                  <MessageCircle size={12} /> {q}
                </button>
              ))}
            </div>

            <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
              <input
                className="hq-aura-input"
                placeholder="Ask AURA about grants, funding gaps, deadlines, staffing, or risks…"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                style={{ flex: "1 1 280px" }}
              />
              <button type="button" className="hq-btn hq-btn-primary hq-btn-sm" disabled={ask.isPending} onClick={() => ask.mutate(question || suggested[0] ?? "")}>
                <Sparkles size={14} /> Ask AURA
              </button>
              <button type="button" className="hq-btn hq-btn-ghost hq-btn-sm" onClick={() => briefing.refetch()}>
                <RefreshCw size={14} />
              </button>
            </div>

            {data?.offline && <StatusBadge label="Offline executive briefing" variant="warning" />}

            {data?.staffingAffordability && (
              <div style={{ fontSize: "0.82rem", color: "var(--hq-gold)", marginBottom: "0.5rem" }}>
                Annual pipeline: {fmt(data.staffingAffordability.estimatedAnnualPipeline)} · Capacity after pending: {fmt(data.staffingAffordability.capacityAfterPending)}
              </div>
            )}

            <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: "0.85rem", lineHeight: 1.65, color: "var(--hq-text-muted)", margin: "0.75rem 0" }}>
              {data?.insight ?? "Ask AURA an executive funding question to begin."}
            </pre>

            {(data?.topRecommendations ?? []).length > 0 && (
              <div style={{ marginTop: "1rem" }}>
                <h4 style={{ fontSize: "0.85rem", color: "var(--hq-gold)", marginBottom: "0.5rem" }}>Recommended Grants</h4>
                <ul className="hq-activity-list" style={{ margin: 0, padding: 0, listStyle: "none" }}>
                  {data!.topRecommendations.slice(0, 5).map((g) => (
                    <li key={String(g.id)} className="hq-activity-item">
                      <div className="hq-activity-content">
                        <div className="hq-activity-title">{String(g.title)}</div>
                        <div className="hq-activity-detail">{String(g.funder)} · Priority {String(g.priorityScore)}%</div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {data?.fundingRisks && (data.fundingRisks.complianceDue > 0 || data.fundingRisks.spendingAlerts > 0) && (
              <div style={{ marginTop: "1rem", fontSize: "0.82rem", color: "var(--hq-warning)" }}>
                Risks: {data.fundingRisks.complianceDue} compliance due · {data.fundingRisks.spendingAlerts} budget alerts
                {data.fundingRisks.overduePrograms?.length ? ` · Overdue: ${data.fundingRisks.overduePrograms.join(", ")}` : ""}
              </div>
            )}
          </>
        )}
      </HqPanel>
    </div>
  );
};
