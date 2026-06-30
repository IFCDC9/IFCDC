import React, { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Sparkles, MessageCircle } from "lucide-react";
import { grantsApi } from "../../../api/grantsApi";
import { HqPanel } from "../HqPanel";
import { HqLoading } from "../HqLoading";
import { formatCurrency } from "../../../utils/safeFormat";

const fmt = formatCurrency;

const SUGGESTED_QUESTIONS = [
  "Which grants should IFCDC prioritize this quarter?",
  "What is our funding gap by program division?",
  "Which deadlines require immediate action?",
  "How strong is our grant compliance posture?",
];

export const GrantV5AuraAdvisorPanel: React.FC = () => {
  const [question, setQuestion] = useState("");

  const briefing = useQuery({
    queryKey: ["grant-v5-aura-briefing"],
    queryFn: () => grantsApi.v5AuraAdvisor(),
    staleTime: 120_000,
  });

  const ask = useMutation({
    mutationFn: (q: string) => grantsApi.v5AuraAdvisor(q),
  });

  const data = ask.data ?? briefing.data;
  const intelligence = data?.executiveIntelligence as Record<string, unknown> | undefined;

  return (
    <div className="hq-fade-in">
      <HqPanel title="AURA Funding Intelligence" subtitle="Canonical V5 advisor for grant strategy, pipeline, and compliance">
        {briefing.isLoading ? (
          <HqLoading />
        ) : (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginBottom: "0.75rem" }}>
              {SUGGESTED_QUESTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  className="hq-btn hq-btn-ghost hq-btn-sm"
                  style={{ fontSize: "0.78rem" }}
                  onClick={() => {
                    setQuestion(q);
                    ask.mutate(q);
                  }}
                >
                  <MessageCircle size={12} /> {q}
                </button>
              ))}
            </div>

            <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
              <input
                className="hq-input"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask AURA about funding strategy…"
                onKeyDown={(e) => e.key === "Enter" && question.trim() && ask.mutate(question.trim())}
              />
              <button
                type="button"
                className="hq-btn hq-btn-primary"
                disabled={!question.trim() || ask.isPending}
                onClick={() => ask.mutate(question.trim())}
              >
                <Sparkles size={14} /> Ask
              </button>
            </div>

            {data?.insight && (
              <div className="hq-aura-response" style={{ whiteSpace: "pre-wrap", marginBottom: "1rem" }}>
                {data.insight}
                {data.offline ? " (offline summary)" : ""}
              </div>
            )}

            {intelligence && (
              <div className="hq-kpi-grid">
                {typeof intelligence.awardProbabilityScore === "number" && (
                  <div className="hq-kpi-card">
                    <span className="hq-kpi-label">Award Probability</span>
                    <span className="hq-kpi-value">{Math.round(Number(intelligence.awardProbabilityScore))}%</span>
                  </div>
                )}
                {typeof intelligence.organizationSustainabilityIndex === "number" && (
                  <div className="hq-kpi-card">
                    <span className="hq-kpi-label">Sustainability Index</span>
                    <span className="hq-kpi-value">{Math.round(Number(intelligence.organizationSustainabilityIndex))}</span>
                  </div>
                )}
                {intelligence.complianceSummary && typeof (intelligence.complianceSummary as { healthScore?: number }).healthScore === "number" && (
                  <div className="hq-kpi-card">
                    <span className="hq-kpi-label">Compliance Health</span>
                    <span className="hq-kpi-value">
                      {Math.round((intelligence.complianceSummary as { healthScore: number }).healthScore)}%
                    </span>
                  </div>
                )}
                {Array.isArray(intelligence.fundingGapAnalysis) && (intelligence.fundingGapAnalysis as { gap?: number }[])[0]?.gap != null && (
                  <div className="hq-kpi-card">
                    <span className="hq-kpi-label">Top Funding Gap</span>
                    <span className="hq-kpi-value">
                      {fmt(Number((intelligence.fundingGapAnalysis as { gap: number }[])[0].gap))}
                    </span>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </HqPanel>
    </div>
  );
};
