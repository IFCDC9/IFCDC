import React, { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { FileText, Sparkles, DollarSign } from "lucide-react";
import { grantsApi } from "../../../api/grantsApi";
import { HqPanel } from "../HqPanel";
import { StatusBadge } from "../StatusBadge";
import { HqLoading } from "../HqLoading";
import { formatCurrency } from "../../../utils/safeFormat";
import { useGrantManage } from "../../../hooks/useGrantManage";

const fmt = formatCurrency;

export const GrantV5ApplicationWorkspace: React.FC<{
  applications: { id: string; title: string }[];
}> = ({ applications }) => {
  const { canManage } = useGrantManage();
  const [selectedId, setSelectedId] = useState(applications[0]?.id ?? "");
  const [aiSection, setAiSection] = useState("narrative");
  const [aiResult, setAiResult] = useState<string | null>(null);

  const workspace = useQuery({
    queryKey: ["grant-v5-workspace", selectedId],
    queryFn: () => grantsApi.v5ApplicationWorkspace(selectedId),
    enabled: !!selectedId,
    staleTime: 30_000,
  });

  const aiAssist = useMutation({
    mutationFn: () => grantsApi.v5AiAssist(selectedId, aiSection, `Draft the ${aiSection} for this grant application.`),
    onSuccess: (data) => setAiResult(data.content),
  });

  if (!applications.length) {
    return <p className="hq-muted-text">Create an application to open the AI-assisted grant workspace.</p>;
  }

  return (
    <HqPanel title="AI-Assisted Grant Application Workspace" subtitle="Document checklist, proposal budget, and AURA writing assistance">
      <select className="hq-aura-input" value={selectedId} onChange={(e) => { setSelectedId(e.target.value); setAiResult(null); }} style={{ marginBottom: "1rem" }}>
        {applications.map((a) => (
          <option key={a.id} value={a.id}>{a.title}</option>
        ))}
      </select>

      {workspace.isLoading ? (
        <HqLoading />
      ) : workspace.data ? (
        <>
          <div className="hq-kpi-grid" style={{ marginBottom: "1rem" }}>
            <div><div className="hq-muted-text" style={{ fontSize: "0.72rem" }}>Completion</div><strong>{workspace.data.completionPct}%</strong></div>
            <div><div className="hq-muted-text" style={{ fontSize: "0.72rem" }}>Documents</div><strong>{workspace.data.documentChecklist.totalDocuments}</strong></div>
            <div><div className="hq-muted-text" style={{ fontSize: "0.72rem" }}>Budget Total</div><strong>{fmt(Number((workspace.data.proposalBudget as Record<string, unknown>)?.total_requested ?? 0))}</strong></div>
          </div>

          <h4 style={{ fontSize: "0.85rem", color: "var(--hq-gold)", marginBottom: "0.5rem" }}>
            <FileText size={14} style={{ verticalAlign: "middle", marginRight: "0.35rem" }} />
            Required Document Checklist
          </h4>
          {(workspace.data.documentChecklist.byCategory ?? []).map((cat: { category: string; documents: unknown[]; uploaded?: number; total?: number }) => (
            <div key={cat.category} style={{ marginBottom: "0.5rem", fontSize: "0.82rem" }}>
              <StatusBadge label={cat.category} variant="muted" /> {cat.documents?.length ?? 0} items
            </div>
          ))}

          <h4 style={{ fontSize: "0.85rem", color: "var(--hq-gold)", margin: "1rem 0 0.5rem" }}>
            <DollarSign size={14} style={{ verticalAlign: "middle", marginRight: "0.35rem" }} />
            Proposal Budget
          </h4>
          <div className="hq-muted-text" style={{ fontSize: "0.82rem", marginBottom: "1rem" }}>
            Budget builder auto-generates line items — edit via Finance integration for awarded grants.
          </div>

          {canManage && (
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
            <select className="hq-aura-input" value={aiSection} onChange={(e) => setAiSection(e.target.value)}>
              <option value="narrative">Narrative</option>
              <option value="needs_statement">Needs Statement</option>
              <option value="methodology">Methodology</option>
              <option value="budget_justification">Budget Justification</option>
              <option value="evaluation">Evaluation Plan</option>
            </select>
            <button type="button" className="hq-btn hq-btn-primary hq-btn-sm" disabled={aiAssist.isPending} onClick={() => aiAssist.mutate()}>
              <Sparkles size={14} /> AI Assist
            </button>
          </div>
          )}

          {aiResult && (
            <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: "0.85rem", lineHeight: 1.65, color: "var(--hq-text-muted)", padding: "0.75rem", background: "var(--hq-bg-subtle)", borderRadius: 6 }}>
              {aiResult}
            </pre>
          )}
        </>
      ) : null}
    </HqPanel>
  );
};
