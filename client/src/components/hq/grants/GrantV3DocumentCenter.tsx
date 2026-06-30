import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, Link2, CheckCircle } from "lucide-react";
import { grantsApi } from "../../../api/grantsApi";
import { HqPanel } from "../HqPanel";
import { StatusBadge } from "../StatusBadge";
import { HqLoading } from "../HqLoading";

const CATEGORY_ICONS: Record<string, string> = {
  narrative: "Narratives & Proposals",
  budget: "Budget Documents",
  required: "Required Attachments",
  attachment: "Supporting Attachments",
  supporting: "Additional Supporting",
  board_approval: "Board Approvals",
};

export const GrantV3DocumentCenter: React.FC<{
  applications: { id: string; title: string }[];
  children?: React.ReactNode;
}> = ({ applications, children }) => {
  const [selectedGrant, setSelectedGrant] = useState("");

  const selectedApp = applications.find((a) => a.id === selectedGrant);

  const center = useQuery({
    queryKey: ["grant-v3-document-center", selectedGrant],
    queryFn: () => grantsApi.v5DocumentCenter({ applicationId: selectedGrant || undefined }),
    staleTime: 30_000,
  });

  return (
    <div className="hq-fade-in">
      <HqPanel title="Grant Document Center" subtitle="Narratives, budgets, attachments, board approvals, and supporting documentation linked to each grant">
        <div className="hq-kpi-grid" style={{ marginBottom: "1rem" }}>
          <div><div className="hq-muted-text" style={{ fontSize: "0.72rem" }}>Total Documents</div><strong>{center.data?.totalDocuments ?? 0}</strong></div>
          <div><div className="hq-muted-text" style={{ fontSize: "0.72rem" }}>Narratives</div><strong>{center.data?.narratives ?? 0}</strong></div>
          <div><div className="hq-muted-text" style={{ fontSize: "0.72rem" }}>Budgets</div><strong>{center.data?.budgets ?? 0}</strong></div>
          <div><div className="hq-muted-text" style={{ fontSize: "0.72rem" }}>Board Approvals</div><strong>{center.data?.boardApprovals ?? 0}</strong></div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginBottom: "1rem" }}>
          <select className="hq-aura-input" value={selectedGrant} onChange={(e) => setSelectedGrant(e.target.value)}>
            <option value="">All linked grants</option>
            {applications.map((a) => (
              <option key={a.id} value={a.id}>{a.title}</option>
            ))}
          </select>
        </div>

        {children}

        {center.isLoading ? (
          <HqLoading />
        ) : (
          <>
            <h4 style={{ fontSize: "0.85rem", color: "var(--hq-gold)", margin: "1rem 0 0.5rem" }}>
              <Link2 size={14} style={{ verticalAlign: "middle", marginRight: "0.35rem" }} />
              Linked Grants
            </h4>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "1.25rem" }}>
              {(center.data?.linkedGrants ?? []).slice(0, 8).map((g) => (
                <div key={String(g.grantKey)} className="hq-panel" style={{ padding: "0.65rem 0.85rem", display: "flex", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{g.title}</div>
                    <div className="hq-muted-text" style={{ fontSize: "0.82rem" }}>{g.funder}</div>
                  </div>
                  <StatusBadge label={`${g.documentCount} docs`} variant={g.documentCount > 0 ? "success" : "muted"} />
                </div>
              ))}
            </div>

            {(center.data?.byCategory ?? []).map((cat) => (
              <div key={cat.category} style={{ marginBottom: "1rem" }}>
                <h4 style={{ fontSize: "0.85rem", color: "var(--hq-gold)", marginBottom: "0.5rem" }}>
                  <FileText size={14} style={{ verticalAlign: "middle", marginRight: "0.35rem" }} />
                  {CATEGORY_ICONS[cat.category] ?? cat.label}
                  <StatusBadge label={String(cat.documents.length)} variant="muted" />
                </h4>
                {cat.documents.length === 0 ? (
                  <p className="hq-muted-text" style={{ fontSize: "0.82rem" }}>No documents in this category{selectedApp ? ` for ${selectedApp.title}` : ""}.</p>
                ) : (
                  <ul className="hq-activity-list" style={{ margin: 0, padding: 0, listStyle: "none" }}>
                    {cat.documents.slice(0, 6).map((d) => (
                      <li key={String(d.id)} className="hq-activity-item">
                        <div className="hq-activity-content">
                          <div className="hq-activity-title">{String(d.name ?? "Document")}</div>
                          <div className="hq-activity-detail">{String(d.application_title ?? d.opportunity_title ?? "")}</div>
                        </div>
                        {d.file_url ? <CheckCircle size={14} style={{ color: "var(--hq-success)" }} /> : <StatusBadge label="Pending" variant="warning" />}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </>
        )}
      </HqPanel>
    </div>
  );
};
