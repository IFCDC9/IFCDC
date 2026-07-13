import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FileText, Sparkles, DollarSign, CheckCircle, Clock, Shield } from "lucide-react";
import { grantsApi } from "../../../api/grantsApi";
import { HqPanel } from "../HqPanel";
import { StatusBadge } from "../StatusBadge";
import { HqLoading } from "../HqLoading";
import { fmtGrantDeadline, fmtGrantAmount } from "../../../utils/grantFormat";
import { formatCurrency } from "../../../utils/safeFormat";
import { useGrantManage } from "../../../hooks/useGrantManage";
import { GrantApplicationWorkflowPanel } from "./GrantApplicationWorkflowPanel";
import { openAura } from "../aura/auraBus";

const AI_SECTIONS = [
  { key: "executive_summary", label: "Executive Summary" },
  { key: "need_statement", label: "Statement of Need" },
  { key: "project_description", label: "Project Description" },
  { key: "goals_objectives", label: "Goals & Objectives" },
  { key: "methods", label: "Methods & Activities" },
  { key: "evaluation", label: "Evaluation Plan" },
  { key: "budget_narrative", label: "Budget Narrative" },
  { key: "sustainability", label: "Sustainability" },
  { key: "organizational_capacity", label: "Organizational Capacity" },
  { key: "attachments_checklist", label: "Attachments Checklist" },
];

export const GrantFullApplicationWorkspace: React.FC<{
  applicationId: string | null;
  onUpdated?: () => void;
}> = ({ applicationId, onUpdated }) => {
  const qc = useQueryClient();
  const { canManage } = useGrantManage();
  const [activeSection, setActiveSection] = useState("executive_summary");
  const [draftProgress, setDraftProgress] = useState<{ completed: number; total: number } | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [changeNote, setChangeNote] = useState("");
  const [showChangeForm, setShowChangeForm] = useState(false);

  const workspace = useQuery({
    queryKey: ["grant-full-workspace", applicationId],
    queryFn: () => grantsApi.fullApplicationWorkspace(String(applicationId)),
    enabled: !!applicationId,
    staleTime: 15_000,
    refetchInterval: draftProgress ? 3000 : false,
  });

  const readiness = useQuery({
    queryKey: ["grant-readiness", applicationId],
    queryFn: () => grantsApi.applicationReadiness(String(applicationId)),
    enabled: !!applicationId,
    staleTime: 20_000,
  });

  const founderReview = useQuery({
    queryKey: ["grant-founder-review", applicationId],
    queryFn: () => grantsApi.founderReviewPackage(String(applicationId)),
    enabled: !!applicationId,
    staleTime: 20_000,
  });

  const foundation = useQuery({
    queryKey: ["grant-foundation-workspace", applicationId],
    queryFn: () => grantsApi.foundationWorkspace(String(applicationId)),
    enabled: !!applicationId,
    staleTime: 20_000,
  });

  const invalidateWorkspace = () => {
    qc.invalidateQueries({ queryKey: ["grant-full-workspace", applicationId] });
    qc.invalidateQueries({ queryKey: ["grant-writer-studio", applicationId] });
    qc.invalidateQueries({ queryKey: ["grant-readiness", applicationId] });
    qc.invalidateQueries({ queryKey: ["grant-founder-review", applicationId] });
    qc.invalidateQueries({ queryKey: ["grant-enriched-applications"] });
    qc.invalidateQueries({ queryKey: ["grants-applications"] });
    qc.invalidateQueries({ queryKey: ["grant-enterprise-pipeline"] });
    onUpdated?.();
  };

  const generateFull = useMutation({
    mutationFn: () =>
      grantsApi.generateFullProposalDraft(String(applicationId), undefined, (job) => {
        setDraftProgress({ completed: Number(job.completed ?? 0), total: Number(job.total ?? 10) });
      }),
    onMutate: () => {
      setGenError(null);
      setActionError(null);
      setActionMessage("Starting full proposal generation…");
    },
    onSuccess: (result) => {
      setDraftProgress(null);
      setGenError(result.error ?? null);
      setActionMessage(
        result.error
          ? null
          : `Full proposal package ready (${result.completed}/${result.total} sections). Founder review still required before federal submit.`
      );
      invalidateWorkspace();
    },
    onError: (err: Error) => {
      setDraftProgress(null);
      setGenError(err.message);
      setActionMessage(null);
      setActionError(err.message);
    },
  });

  const aiSection = useMutation({
    mutationFn: (sectionKey: string) => grantsApi.writerAiAssist(String(applicationId), sectionKey),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["grant-full-workspace", applicationId] }),
    onError: (err: Error) => setActionError(err.message),
  });

  const founderAction = useMutation({
    mutationFn: (payload: {
      action: "approve" | "request_changes" | "mark_ready" | "reject" | "save_draft";
      note?: string;
    }) => grantsApi.founderApproval(String(applicationId), payload.action, payload.note),
    onMutate: () => {
      setActionError(null);
      setActionMessage(null);
    },
    onSuccess: (result, variables) => {
      if (result?.ok === false) {
        setActionError("Founder action was not saved.");
        return;
      }
      if (variables.action === "approve") {
        setActionMessage("Founder approval saved. Application is ready for submission packaging.");
        setShowChangeForm(false);
      } else if (variables.action === "request_changes") {
        setActionMessage("Change request recorded. Writers can revise sections and resubmit for approval.");
        setShowChangeForm(false);
        setChangeNote("");
      } else if (variables.action === "reject") {
        setActionMessage("Application rejected by Founder.");
        setShowChangeForm(false);
      } else if (variables.action === "save_draft") {
        setActionMessage("Draft saved — still pending Founder decision.");
      } else {
        setActionMessage("Marked ready to submit.");
      }
      if (result.workspace) {
        qc.setQueryData(["grant-full-workspace", applicationId], result.workspace);
      }
      invalidateWorkspace();
    },
    onError: (err: Error) => {
      setActionError(err.message || "Founder action failed");
    },
  });

  const openGrantAura = () => {
    openAura({
      module: "grants",
      contextRef: { applicationId },
      prefill: applicationId
        ? `Review application ${applicationId} — summarize readiness, risks, and next Founder actions.`
        : undefined,
    });
  };

  if (!applicationId) {
    return <p className="hq-muted-text">Select an application or click Start Application on an opportunity.</p>;
  }

  if (workspace.isLoading) return <HqLoading />;
  if (workspace.isError) {
    return (
      <p className="hq-muted-text" style={{ color: "var(--hq-danger)" }}>
        {(workspace.error as Error)?.message || "Workspace failed to load."}
      </p>
    );
  }
  if (!workspace.data) return <p className="hq-muted-text">Application workspace not found.</p>;

  const ws = workspace.data;
  const opp = ws.opportunity as Record<string, unknown>;
  const matched = ws.matchedProgram as { slug: string; label: string };
  const founder = ws.founderApproval as { status: string; readyToSubmit: boolean };
  const workflow = ws.currentWorkflowStage as { label: string };
  const sections = (ws.writerSections?.sections ?? []) as { section_key: string; section_label: string; content: string }[];
  const deadlines = (ws.deadlineTracker ?? []) as { title: string; due_date: string; completed: number }[];
  const budget = ws.budgetDraft as Record<string, unknown>;
  const checklist = ws.documentChecklist as { byCategory?: { category: string; documents: unknown[] }[]; totalDocuments?: number };
  const readinessReport = readiness.data;
  const reviewPack = founderReview.data as {
    executiveSummary?: string;
    fundingAmount?: number | null;
    matchRequirements?: string;
    riskAssessment?: { risk: string; severity: string; detail: string }[];
    canDecide?: boolean;
  } | undefined;
  const foundationWs = foundation.data as {
    pipeline?: { productLabel?: string };
    progress?: { percent?: number; checklistComplete?: number; checklistTotal?: number };
    documents?: { checklist?: { id: string; label: string; linked: boolean }[]; vaultPath?: string };
    activity?: { action: string; detail?: string; created_at: string }[];
  } | undefined;

  return (
    <div className="hq-grant-workspace" style={{ display: "grid", gap: "1.25rem" }}>
      <HqPanel title="Application Workspace" subtitle={`${String(ws.application?.title ?? "")} · ${foundationWs?.pipeline?.productLabel ?? workflow?.label ?? "Drafting"}`}>
        <div className="hq-kpi-grid" style={{ marginBottom: "1rem" }}>
          <div><div className="hq-muted-text" style={{ fontSize: "0.72rem" }}>Match Score</div><strong>{(ws.intelligence as { composite?: number })?.composite ?? "—"}%</strong></div>
          <div><div className="hq-muted-text" style={{ fontSize: "0.72rem" }}>Completion</div><strong>{ws.completionPct ?? readinessReport?.completenessPct ?? 0}%</strong></div>
          <div><div className="hq-muted-text" style={{ fontSize: "0.72rem" }}>Readiness Score</div><strong>{readinessReport?.readinessScore ?? "—"}%</strong></div>
          <div><div className="hq-muted-text" style={{ fontSize: "0.72rem" }}>Founder Approval</div><StatusBadge label={founder?.status ?? "pending"} variant={founder?.status === "approved" ? "success" : "warning"} /></div>
          <div><div className="hq-muted-text" style={{ fontSize: "0.72rem" }}>Ready to Submit</div><strong>{founder?.readyToSubmit ? "Yes" : "No"}</strong></div>
          <div><div className="hq-muted-text" style={{ fontSize: "0.72rem" }}>Required Docs</div><strong>{foundationWs?.progress?.checklistComplete ?? 0}/{foundationWs?.progress?.checklistTotal ?? 12}</strong></div>
        </div>

        {readinessReport && (
          <div style={{ marginBottom: "1rem" }}>
            <h4 style={{ fontSize: "0.85rem", color: "var(--hq-gold)", marginBottom: "0.5rem" }}>
              Validation · {readinessReport.readyForFounderReview ? "Ready for Founder review" : "Not ready for Founder review"}
            </h4>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
              {readinessReport.items.map((item) => (
                <StatusBadge
                  key={item.id}
                  label={`${item.label}: ${item.ok ? "OK" : "Gap"}`}
                  variant={item.ok ? "success" : item.severity === "critical" ? "danger" : "warning"}
                />
              ))}
            </div>
          </div>
        )}

        {reviewPack && (
          <div style={{ marginBottom: "1rem" }}>
            <h4 style={{ fontSize: "0.85rem", color: "var(--hq-gold)", marginBottom: "0.5rem" }}>Founder Review Package</h4>
            <ul className="hq-feature-list" style={{ fontSize: "0.82rem" }}>
              <li>Funding: {reviewPack.fundingAmount != null ? formatCurrency(Number(reviewPack.fundingAmount)) : "—"}</li>
              <li>Match: {reviewPack.matchRequirements ?? "—"}</li>
              <li>Summary: {(reviewPack.executiveSummary ?? "").slice(0, 220)}{(reviewPack.executiveSummary ?? "").length > 220 ? "…" : ""}</li>
            </ul>
            {!!reviewPack.riskAssessment?.length && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginTop: "0.5rem" }}>
                {reviewPack.riskAssessment.slice(0, 6).map((r) => (
                  <StatusBadge key={r.risk} label={`${r.risk} (${r.severity})`} variant="warning" />
                ))}
              </div>
            )}
          </div>
        )}

        {foundationWs?.documents?.checklist && (
          <div style={{ marginBottom: "1rem" }}>
            <h4 style={{ fontSize: "0.85rem", color: "var(--hq-gold)", marginBottom: "0.5rem" }}>Submission Checklist</h4>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
              {foundationWs.documents.checklist.map((item) => (
                <StatusBadge key={item.id} label={item.label} variant={item.linked ? "success" : "muted"} />
              ))}
            </div>
            {foundationWs.documents.vaultPath && (
              <a href={foundationWs.documents.vaultPath} className="hq-btn hq-btn-sm hq-btn-ghost" style={{ marginTop: "0.5rem" }}>
                Open Document Vault
              </a>
            )}
          </div>
        )}

        <div className="hq-grid-2" style={{ marginBottom: "1rem" }}>
          <div>
            <h4 style={{ fontSize: "0.85rem", color: "var(--hq-gold)", marginBottom: "0.5rem" }}>Opportunity Details</h4>
            <ul className="hq-feature-list" style={{ fontSize: "0.82rem" }}>
              <li><strong>{String(opp.title ?? "—")}</strong></li>
              <li>Funder: {String(opp.funder ?? "—")}</li>
              <li>Amount: {fmtGrantAmount(null, opp.amountMax as number | null)}</li>
              <li>Deadline: {String(opp.deadlineLabel ?? fmtGrantDeadline(null))}</li>
              <li>Eligibility: {(String(opp.eligibility ?? "")).slice(0, 120)}{(String(opp.eligibility ?? "")).length > 120 ? "…" : ""}</li>
            </ul>
          </div>
          <div>
            <h4 style={{ fontSize: "0.85rem", color: "var(--hq-gold)", marginBottom: "0.5rem" }}>Matched IFCDC Program</h4>
            <StatusBadge label={matched?.label ?? "—"} variant="gold" />
            <h4 style={{ fontSize: "0.85rem", color: "var(--hq-gold)", margin: "1rem 0 0.5rem" }}>
              <Clock size={14} style={{ verticalAlign: "middle", marginRight: 4 }} /> Deadline Tracker
            </h4>
            <ul className="hq-activity-list">
              {deadlines.slice(0, 4).map((d, i) => (
                <li key={i} className="hq-activity-item">
                  <div className="hq-activity-content"><div className="hq-activity-title">{d.title}</div></div>
                  <div className="hq-activity-time">{fmtGrantDeadline(d.due_date)}</div>
                </li>
              ))}
              {!deadlines.length && <li className="hq-muted-text">No deadline listed</li>}
            </ul>
          </div>
        </div>

        {canManage && (
          <div className="hq-founder-command-strip" style={{ marginBottom: "1rem", flexWrap: "wrap" }} role="toolbar" aria-label="Founder grant actions">
            <button
              type="button"
              className="hq-btn hq-btn-sm hq-btn-primary"
              disabled={founderAction.isPending}
              onClick={() => founderAction.mutate({ action: "approve" })}
            >
              <Shield size={14} /> {founderAction.isPending ? "Saving…" : "Founder Approve"}
            </button>
            <button
              type="button"
              className="hq-btn hq-btn-sm hq-btn-secondary"
              disabled={founderAction.isPending}
              onClick={() => {
                setShowChangeForm(true);
                setActionError(null);
                setActionMessage(null);
              }}
            >
              Request Changes
            </button>
            <button
              type="button"
              className="hq-btn hq-btn-sm hq-btn-ghost"
              disabled={founderAction.isPending}
              onClick={() => founderAction.mutate({ action: "save_draft" })}
            >
              Save Draft
            </button>
            <button
              type="button"
              className="hq-btn hq-btn-sm hq-btn-ghost"
              disabled={founderAction.isPending}
              onClick={() => founderAction.mutate({ action: "reject", note: "Rejected by Founder" })}
            >
              Reject
            </button>
            <button
              type="button"
              className="hq-btn hq-btn-sm hq-btn-secondary"
              disabled={generateFull.isPending || !!draftProgress}
              onClick={() => generateFull.mutate()}
            >
              <Sparkles size={14} />{" "}
              {generateFull.isPending || draftProgress
                ? `Generating ${draftProgress?.completed ?? 0}/${draftProgress?.total ?? 10}…`
                : "Generate Full Proposal"}
            </button>
            <button type="button" className="hq-btn hq-btn-sm hq-btn-ghost" onClick={openGrantAura}>
              <Sparkles size={14} /> Ask AURA
            </button>
          </div>
        )}

        {showChangeForm && canManage && (
          <div className="hq-panel" style={{ marginBottom: "1rem", padding: "0.85rem 1rem" }}>
            <label style={{ display: "block", fontSize: "0.78rem", color: "var(--hq-text-muted)", marginBottom: "0.35rem" }}>
              What needs to change before Founder approval?
            </label>
            <textarea
              className="hq-input"
              rows={3}
              style={{ width: "100%", marginBottom: "0.65rem" }}
              value={changeNote}
              onChange={(e) => setChangeNote(e.target.value)}
              placeholder="List required revisions, missing attachments, budget notes…"
            />
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button
                type="button"
                className="hq-btn hq-btn-sm hq-btn-primary"
                disabled={founderAction.isPending || !changeNote.trim()}
                onClick={() => founderAction.mutate({ action: "request_changes", note: changeNote.trim() })}
              >
                Submit Change Request
              </button>
              <button type="button" className="hq-btn hq-btn-sm hq-btn-ghost" onClick={() => setShowChangeForm(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {actionMessage && (
          <p style={{ color: "var(--hq-success)", fontSize: "0.8rem", marginBottom: "0.5rem" }} role="status">
            {actionMessage}
          </p>
        )}
        {(actionError || genError) && (
          <p className="hq-muted-text" style={{ color: "var(--hq-danger)", fontSize: "0.75rem" }} role="alert">
            {actionError || genError}
          </p>
        )}
        <p className="hq-muted-text" style={{ fontSize: "0.75rem" }}>Federal submission requires founder approval. AURA never submits automatically.</p>
      </HqPanel>

      <HqPanel title="Required Documents & Task Checklist">
        <div className="hq-grid-2">
          <div>
            <h4 style={{ fontSize: "0.85rem", color: "var(--hq-gold)", marginBottom: "0.5rem" }}>
              <FileText size={14} style={{ verticalAlign: "middle", marginRight: 4 }} /> Required Documents ({checklist?.totalDocuments ?? 0})
            </h4>
            {(checklist?.byCategory ?? []).map((cat) => (
              <div key={cat.category} style={{ marginBottom: "0.35rem", fontSize: "0.82rem" }}>
                <StatusBadge label={cat.category} variant="muted" /> {cat.documents?.length ?? 0} items
              </div>
            ))}
          </div>
          <div>
            <h4 style={{ fontSize: "0.85rem", color: "var(--hq-gold)", marginBottom: "0.5rem" }}>
              <CheckCircle size={14} style={{ verticalAlign: "middle", marginRight: 4 }} /> Workflow Tasks
            </h4>
            <ol style={{ margin: 0, paddingLeft: "1.2rem", fontSize: "0.82rem" }}>
              {((ws.taskChecklist ?? []) as { label: string; done: boolean }[]).map((t) => (
                <li key={t.label} style={{ marginBottom: 4 }}>
                  {t.label} {t.done ? "✓" : "○"}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </HqPanel>

      <HqPanel title="Narrative Draft & AI Grant Writer">
        <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
          {AI_SECTIONS.map((s) => (
            <button key={s.key} type="button" className={`hq-btn hq-btn-sm ${activeSection === s.key ? "hq-btn-primary" : "hq-btn-secondary"}`} onClick={() => setActiveSection(s.key)}>
              {s.label}
            </button>
          ))}
        </div>
        {canManage && (
          <button type="button" className="hq-btn hq-btn-sm hq-btn-secondary" style={{ marginBottom: "0.75rem" }} disabled={aiSection.isPending} onClick={() => aiSection.mutate(activeSection)}>
            <Sparkles size={14} /> AURA Draft This Section
          </button>
        )}
        <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: "0.85rem", lineHeight: 1.65, padding: "0.75rem", background: "var(--hq-bg-subtle)", borderRadius: 6, minHeight: 120 }}>
          {sections.find((s) => s.section_key === activeSection)?.content?.trim() || "No draft yet — click AURA Draft or Generate All Draft Sections."}
        </pre>
      </HqPanel>

      <HqPanel title="Budget Draft">
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
          <DollarSign size={16} />
          <strong>{formatCurrency(Number(budget?.total_requested ?? 0))}</strong>
          <span className="hq-muted-text" style={{ fontSize: "0.82rem" }}>total requested</span>
        </div>
        <p className="hq-muted-text" style={{ fontSize: "0.82rem" }}>Personnel: {formatCurrency(Number(budget?.personnel ?? 0))} · Direct: {formatCurrency(Number(budget?.direct_costs ?? 0))} · Indirect: {formatCurrency(Number(budget?.indirect_costs ?? 0))}</p>
      </HqPanel>

      <GrantApplicationWorkflowPanel applicationId={applicationId} onUpdated={onUpdated} />
    </div>
  );
};
