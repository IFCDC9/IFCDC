import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, Upload, CheckCircle } from "lucide-react";
import { grantsApi } from "../../../api/grantsApi";
import { HqPanel } from "../HqPanel";
import { StatusBadge } from "../StatusBadge";
import { HqLoading } from "../HqLoading";

const CATEGORY_LABELS: Record<string, string> = {
  required: "Required Attachments",
  narrative: "Narratives & Proposals",
  budget: "Budget Documents",
  attachment: "Supporting Attachments",
  supporting: "Additional Supporting Files",
  board_approval: "Board Approvals",
};

export const GrantDocumentManagementPanel: React.FC<{
  applications: { id: string; title: string }[];
  onUpload: (payload: { name: string; application_id?: string; doc_category: string; file?: File }) => void;
  uploadPending?: boolean;
  readOnly?: boolean;
}> = ({ applications, onUpload, uploadPending, readOnly }) => {
  const [selectedApp, setSelectedApp] = useState("");
  const [uploadForm, setUploadForm] = useState({ name: "", category: "attachment" as string, file: null as File | null });

  const checklist = useQuery({
    queryKey: ["grant-doc-checklist", selectedApp],
    queryFn: () => grantsApi.documentChecklist(selectedApp || undefined),
    staleTime: 30_000,
  });

  return (
    <div className="hq-fade-in">
      <HqPanel title="Grant Document Management" subtitle="Required attachments, budgets, narratives, and supporting files">
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginBottom: "1rem", alignItems: "end" }}>
          <div>
            <label style={{ fontSize: "0.72rem", color: "var(--hq-text-muted)" }}>Application</label>
            <select className="hq-aura-input" value={selectedApp} onChange={(e) => setSelectedApp(e.target.value)}>
              <option value="">All documents</option>
              {applications.map((a) => (
                <option key={a.id} value={a.id}>{a.title}</option>
              ))}
            </select>
          </div>
          {!readOnly && (
          <>
          <div>
            <label style={{ fontSize: "0.72rem", color: "var(--hq-text-muted)" }}>Document name</label>
            <input className="hq-aura-input" value={uploadForm.name} onChange={(e) => setUploadForm({ ...uploadForm, name: e.target.value })} placeholder="Budget narrative Q1" />
          </div>
          <div>
            <label style={{ fontSize: "0.72rem", color: "var(--hq-text-muted)" }}>Category</label>
            <select className="hq-aura-input" value={uploadForm.category} onChange={(e) => setUploadForm({ ...uploadForm, category: e.target.value })}>
              <option value="required">Required attachment</option>
              <option value="narrative">Narrative / proposal</option>
              <option value="budget">Budget document</option>
              <option value="attachment">Supporting attachment</option>
              <option value="supporting">Additional supporting</option>
              <option value="board_approval">Board approval</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: "0.72rem", color: "var(--hq-text-muted)" }}>File</label>
            <input type="file" className="hq-aura-input" onChange={(e) => setUploadForm({ ...uploadForm, file: e.target.files?.[0] ?? null })} />
          </div>
          <button
            type="button"
            className="hq-btn hq-btn-primary hq-btn-sm"
            disabled={!uploadForm.name || !uploadForm.file || uploadPending}
            onClick={() => {
              if (!uploadForm.file) return;
              onUpload({
                name: uploadForm.name,
                application_id: selectedApp || undefined,
                doc_category: uploadForm.category,
                file: uploadForm.file,
              });
              setUploadForm({ name: "", category: "attachment", file: null });
            }}
          >
            <Upload size={14} /> Upload
          </button>
          </>
          )}
        </div>

        {checklist.isLoading ? (
          <HqLoading />
        ) : (
          <>
            <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem", flexWrap: "wrap", fontSize: "0.85rem" }}>
              <span><FileText size={14} style={{ display: "inline", verticalAlign: "middle" }} /> {checklist.data?.totalDocuments ?? 0} total</span>
              <span><CheckCircle size={14} style={{ display: "inline", verticalAlign: "middle", color: "var(--hq-success)" }} /> {checklist.data?.approvedCount ?? 0} approved</span>
              <span className="hq-muted-text">{checklist.data?.pendingCount ?? 0} pending upload/review</span>
            </div>
            {(checklist.data?.byCategory ?? []).map((cat) => (
              <div key={cat.category} style={{ marginBottom: "1rem" }}>
                <h4 style={{ fontSize: "0.85rem", color: "var(--hq-gold)", marginBottom: "0.5rem" }}>
                  {CATEGORY_LABELS[cat.category] ?? cat.category}
                  <span className="hq-muted-text" style={{ fontWeight: 400, marginLeft: "0.5rem" }}>
                    ({cat.uploaded}/{cat.total} uploaded)
                  </span>
                </h4>
                {cat.documents.length ? (
                  <table className="hq-table">
                    <thead><tr><th>Name</th><th>Status</th><th>Uploaded</th></tr></thead>
                    <tbody>
                      {cat.documents.map((d) => (
                        <tr key={String(d.id)}>
                          <td><strong>{String(d.name)}</strong></td>
                          <td><StatusBadge label={String(d.status ?? "pending")} variant={d.status === "approved" ? "success" : "warning"} /></td>
                          <td>{d.uploaded_at ? new Date(String(d.uploaded_at)).toLocaleDateString() : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="hq-muted-text" style={{ fontSize: "0.82rem" }}>No documents in this category yet.</p>
                )}
              </div>
            ))}
          </>
        )}
      </HqPanel>
    </div>
  );
};
