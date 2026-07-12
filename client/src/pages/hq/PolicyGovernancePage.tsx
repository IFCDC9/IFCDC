import React, { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, BookOpen, CheckCircle, ClipboardList, FileText, FolderOpen,
  Plus, Search, Shield, Signature,
} from "lucide-react";
import HQLayout from "../../layouts/HQLayout";
import { policiesApi, type PolicyListItem } from "../../api/policiesApi";
import { KpiCard } from "../../components/hq/KpiCard";
import { HqPanel } from "../../components/hq/HqPanel";
import { HqLoading } from "../../components/hq/HqLoading";
import { StatusBadge } from "../../components/hq/StatusBadge";

type TabId = "library" | "detail" | "categories" | "acknowledgments" | "reviews" | "audit" | "report";

const TABS: { id: TabId; label: string }[] = [
  { id: "library", label: "Policy Library" },
  { id: "categories", label: "Categories" },
  { id: "acknowledgments", label: "Acknowledgments" },
  { id: "reviews", label: "Review Reminders" },
  { id: "audit", label: "Audit Log" },
  { id: "report", label: "Compliance Report" },
];

function statusVariant(s: string): "success" | "warning" | "danger" | "gold" | "muted" {
  if (s === "published" || s === "approved") return "success";
  if (s === "pending_approval") return "warning";
  if (s === "archived") return "muted";
  if (s === "draft") return "gold";
  return "muted";
}

const EMPTY_FORM = {
  title: "",
  policy_number: "",
  department: "",
  category: "sops",
  purpose: "",
  why_exists: "",
  scope: "",
  responsibilities: "",
  procedures: "",
  related_documents: "",
  forms: "",
  compliance_requirements: "",
  legal_references: "",
  what_this_means_why: "",
  what_this_means_expectations: "",
  what_this_means_consequences: "",
  what_this_means_departments: "",
  what_this_means_mission: "",
  effective_date: "",
  next_review_date: "",
};

const PolicyGovernancePage: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const tabParam = (params.get("tab") as TabId | null) ?? "library";
  const selectedId = params.get("id");
  const tab: TabId = selectedId ? "detail" : (TABS.some((t) => t.id === tabParam) ? tabParam : "library");
  const qc = useQueryClient();

  const [q, setQ] = useState(params.get("q") ?? "");
  const [category, setCategory] = useState(params.get("category") ?? "");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [ackForm, setAckForm] = useState({ person_name: "", signature_text: "", person_role: "employee" });
  const [approveForm, setApproveForm] = useState({ approved_by: "", signature_text: "" });

  const dashboard = useQuery({ queryKey: ["policy-dashboard"], queryFn: policiesApi.dashboard, staleTime: 30_000 });
  const categories = useQuery({ queryKey: ["policy-categories"], queryFn: policiesApi.categories, staleTime: 60_000 });
  const search = useQuery({
    queryKey: ["policy-search", q, category],
    queryFn: () => policiesApi.search({ q: q || undefined, category: category || undefined }),
    staleTime: 20_000,
  });
  const detail = useQuery({
    queryKey: ["policy-detail", selectedId],
    queryFn: () => policiesApi.get(selectedId!),
    enabled: !!selectedId,
  });
  const acks = useQuery({
    queryKey: ["policy-acks"],
    queryFn: () => policiesApi.acknowledgments(),
    enabled: tab === "acknowledgments",
  });
  const reviews = useQuery({
    queryKey: ["policy-reviews"],
    queryFn: policiesApi.reviews,
    enabled: tab === "reviews",
  });
  const activity = useQuery({
    queryKey: ["policy-activity"],
    queryFn: policiesApi.activity,
    enabled: tab === "audit",
  });
  const report = useQuery({
    queryKey: ["policy-report"],
    queryFn: policiesApi.report,
    enabled: tab === "report",
  });

  const setTab = (id: TabId) => {
    const next = new URLSearchParams(params);
    next.delete("id");
    if (id === "library") next.delete("tab");
    else next.set("tab", id);
    setParams(next, { replace: true });
  };

  const openPolicy = (id: string) => {
    const next = new URLSearchParams(params);
    next.set("id", id);
    next.delete("tab");
    setParams(next, { replace: true });
  };

  const invalidateAll = () => {
    void qc.invalidateQueries({ queryKey: ["policy-dashboard"] });
    void qc.invalidateQueries({ queryKey: ["policy-search"] });
    void qc.invalidateQueries({ queryKey: ["policy-detail"] });
    void qc.invalidateQueries({ queryKey: ["policy-categories"] });
    void qc.invalidateQueries({ queryKey: ["policy-acks"] });
    void qc.invalidateQueries({ queryKey: ["policy-reviews"] });
    void qc.invalidateQueries({ queryKey: ["policy-activity"] });
    void qc.invalidateQueries({ queryKey: ["policy-report"] });
  };

  const createMut = useMutation({
    mutationFn: () => policiesApi.create(form),
    onSuccess: (data) => {
      setShowCreate(false);
      setForm(EMPTY_FORM);
      invalidateAll();
      const id = String((data as { policy?: { id?: string } }).policy?.id ?? "");
      if (id) openPolicy(id);
    },
  });

  const submitMut = useMutation({ mutationFn: (id: string) => policiesApi.submit(id), onSuccess: invalidateAll });
  const approveMut = useMutation({
    mutationFn: (id: string) => policiesApi.approve(id, approveForm),
    onSuccess: () => { setApproveForm({ approved_by: "", signature_text: "" }); invalidateAll(); },
  });
  const publishMut = useMutation({ mutationFn: (id: string) => policiesApi.publish(id), onSuccess: invalidateAll });
  const ackMut = useMutation({
    mutationFn: (id: string) => policiesApi.acknowledge(id, ackForm),
    onSuccess: () => { setAckForm({ person_name: "", signature_text: "", person_role: "employee" }); invalidateAll(); },
  });

  const policy = (detail.data?.policy ?? null) as Record<string, unknown> | null;
  const categoryOptions = useMemo(() => categories.data?.categories ?? [], [categories.data]);

  return (
    <HQLayout
      title="Policy & Governance Center"
      subtitle="Official source for IFCDC policies, procedures, SOPs, and governance documents"
    >
      {dashboard.isLoading && !dashboard.data ? (
        <HqLoading message="Loading Policy & Governance Center…" />
      ) : (
        <>
          <div className="hq-kpi-grid hq-fade-in" style={{ marginBottom: "1rem" }}>
            <KpiCard label="Active Policies" value={dashboard.data?.total ?? 0} icon={BookOpen} variant="gold" />
            <KpiCard label="Published" value={dashboard.data?.published ?? 0} icon={CheckCircle} variant="success" />
            <KpiCard label="Pending Approval" value={dashboard.data?.pending ?? 0} icon={ClipboardList} variant="warning" />
            <KpiCard label="Reviews Due" value={dashboard.data?.reviewsDueSoon ?? 0} icon={AlertTriangle} variant={(dashboard.data?.reviewsOverdue ?? 0) > 0 ? "danger" : "warning"} meta={`${dashboard.data?.reviewsOverdue ?? 0} overdue`} />
            <KpiCard label="Acknowledgments" value={dashboard.data?.acknowledgments ?? 0} icon={Signature} />
            <KpiCard label="Categories" value={dashboard.data?.categories ?? 0} icon={FileText} />
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginBottom: "1rem" }}>
            {TABS.map((t) => (
              <button key={t.id} type="button" className={`hq-btn hq-btn-sm ${tab === t.id || (tab === "detail" && t.id === "library") ? "hq-btn-primary" : "hq-btn-ghost"}`} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
            <Link to="/hq/documents?category=policies" className="hq-btn hq-btn-sm hq-btn-ghost"><FolderOpen size={12} /> Document Vault</Link>
            <Link to="/hq/compliance" className="hq-btn hq-btn-sm hq-btn-ghost"><Shield size={12} /> Compliance</Link>
            <Link to="/hq/operations?tab=compliance" className="hq-btn hq-btn-sm hq-btn-ghost">Ops Filings</Link>
          </div>

          {tab === "library" && (
            <div className="hq-fade-in" style={{ display: "grid", gap: "1rem" }}>
              <HqPanel
                title="Policy Library"
                subtitle="Search across name, number, purpose, What This Means, and procedures"
                headerExtra={
                  <button type="button" className="hq-btn hq-btn-sm hq-btn-primary" onClick={() => setShowCreate((v) => !v)}>
                    <Plus size={12} /> New Policy
                  </button>
                }
              >
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.75rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", flex: 1, minWidth: "220px" }}>
                    <Search size={14} />
                    <input className="hq-input" style={{ flex: 1 }} placeholder="Search policies…" value={q} onChange={(e) => setQ(e.target.value)} />
                  </div>
                  <select className="hq-input" value={category} onChange={(e) => setCategory(e.target.value)}>
                    <option value="">All categories</option>
                    {categoryOptions.map((c) => (
                      <option key={c.id} value={c.id}>{c.label} ({c.count})</option>
                    ))}
                  </select>
                </div>

                {showCreate && (
                  <div className="hq-panel" style={{ padding: "1rem", marginBottom: "1rem" }}>
                    <h4 style={{ marginTop: 0 }}>Create Policy</h4>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.5rem" }}>
                      {(
                        [
                          ["title", "Policy Name"],
                          ["policy_number", "Policy Number"],
                          ["department", "Department"],
                          ["purpose", "Purpose"],
                          ["why_exists", "Why This Policy Exists"],
                          ["scope", "Scope (Who It Applies To)"],
                          ["responsibilities", "Responsibilities"],
                          ["procedures", "Procedures"],
                          ["related_documents", "Related Documents"],
                          ["forms", "Forms"],
                          ["compliance_requirements", "Compliance Requirements"],
                          ["legal_references", "Legal/Regulatory References"],
                          ["what_this_means_why", "What This Means — Why"],
                          ["what_this_means_expectations", "What This Means — Expectations"],
                          ["what_this_means_consequences", "What This Means — If Not Followed"],
                          ["what_this_means_departments", "What This Means — Departments Affected"],
                          ["what_this_means_mission", "What This Means — Mission & Compliance"],
                          ["effective_date", "Effective Date (YYYY-MM-DD)"],
                          ["next_review_date", "Next Review Date (YYYY-MM-DD)"],
                        ] as const
                      ).map(([key, label]) => (
                        <label key={key} style={{ display: "grid", gap: "0.25rem", fontSize: "0.75rem" }}>
                          {label}
                          <textarea
                            className="hq-input"
                            rows={key.includes("what_this") || key === "procedures" || key === "responsibilities" ? 3 : 1}
                            value={String(form[key])}
                            onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                          />
                        </label>
                      ))}
                      <label style={{ display: "grid", gap: "0.25rem", fontSize: "0.75rem" }}>
                        Category
                        <select className="hq-input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                          {categoryOptions.map((c) => (
                            <option key={c.id} value={c.id}>{c.label}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem" }}>
                      <button type="button" className="hq-btn hq-btn-primary" disabled={!form.title || createMut.isPending} onClick={() => createMut.mutate()}>
                        Save Draft
                      </button>
                      <button type="button" className="hq-btn hq-btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
                    </div>
                  </div>
                )}

                {search.isLoading ? <HqLoading message="Searching policies…" /> : (
                  <table className="hq-table">
                    <thead>
                      <tr><th>Number</th><th>Name</th><th>Department</th><th>Category</th><th>Version</th><th>Status</th><th>Next Review</th></tr>
                    </thead>
                    <tbody>
                      {(search.data?.policies ?? []).map((p: PolicyListItem) => (
                        <tr key={p.id} style={{ cursor: "pointer" }} onClick={() => openPolicy(p.id)}>
                          <td>{p.policy_number}</td>
                          <td>
                            <div>{p.title}</div>
                            <div className="hq-muted-text" style={{ fontSize: "0.72rem" }}>{p.means_preview || p.purpose_preview}</div>
                          </td>
                          <td>{p.department}</td>
                          <td>{p.categoryLabel}</td>
                          <td>{p.version_number}</td>
                          <td><StatusBadge label={p.approval_status} variant={statusVariant(p.approval_status)} /></td>
                          <td>{p.next_review_date ?? "—"}</td>
                        </tr>
                      ))}
                      {(search.data?.policies ?? []).length === 0 && (
                        <tr><td colSpan={7} className="hq-muted-text">No policies match this search.</td></tr>
                      )}
                    </tbody>
                  </table>
                )}
              </HqPanel>
            </div>
          )}

          {tab === "detail" && selectedId && (
            <div className="hq-fade-in">
              {detail.isLoading ? <HqLoading message="Loading policy…" /> : !policy ? (
                <HqPanel title="Policy not found"><button type="button" className="hq-btn hq-btn-ghost" onClick={() => setTab("library")}>Back to library</button></HqPanel>
              ) : (
                <div style={{ display: "grid", gap: "1rem" }}>
                  <HqPanel
                    title={String(policy.title)}
                    subtitle={`${policy.policy_number} · ${policy.department} · v${policy.version_number}`}
                    headerExtra={
                      <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                        <StatusBadge label={String(policy.approval_status)} variant={statusVariant(String(policy.approval_status))} />
                        <button type="button" className="hq-btn hq-btn-sm hq-btn-ghost" onClick={() => setTab("library")}>Library</button>
                        {policy.approval_status === "draft" && (
                          <button type="button" className="hq-btn hq-btn-sm hq-btn-primary" onClick={() => submitMut.mutate(selectedId)}>Submit for Approval</button>
                        )}
                        {(policy.approval_status === "approved" || policy.approval_status === "pending_approval") && (
                          <button type="button" className="hq-btn hq-btn-sm hq-btn-primary" onClick={() => publishMut.mutate(selectedId)}>Publish</button>
                        )}
                      </div>
                    }
                  >
                    <div className="hq-grid-2" style={{ marginBottom: "1rem" }}>
                      <div>
                        <h4>Purpose</h4>
                        <p>{String(policy.purpose || "—")}</p>
                        <h4>Why This Policy Exists</h4>
                        <p>{String(policy.why_exists || "—")}</p>
                        <h4>Scope</h4>
                        <p>{String(policy.scope || "—")}</p>
                        <h4>Responsibilities</h4>
                        <p style={{ whiteSpace: "pre-wrap" }}>{String(policy.responsibilities || "—")}</p>
                        <h4>Procedures</h4>
                        <p style={{ whiteSpace: "pre-wrap" }}>{String(policy.procedures || "—")}</p>
                      </div>
                      <div>
                        <h4>Compliance Requirements</h4>
                        <p>{String(policy.compliance_requirements || "—")}</p>
                        <h4>Legal / Regulatory References</h4>
                        <p>{String(policy.legal_references || "—")}</p>
                        <h4>Related Documents</h4>
                        <p>{String(policy.related_documents || "—")}</p>
                        <h4>Forms</h4>
                        <p>{String(policy.forms || "—")}</p>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", marginTop: "0.75rem" }}>
                          <div><div className="hq-muted-text" style={{ fontSize: "0.72rem" }}>Effective</div><div>{String(policy.effective_date || "—")}</div></div>
                          <div><div className="hq-muted-text" style={{ fontSize: "0.72rem" }}>Last Review</div><div>{String(policy.last_review_date || "—")}</div></div>
                          <div><div className="hq-muted-text" style={{ fontSize: "0.72rem" }}>Next Review</div><div>{String(policy.next_review_date || "—")}</div></div>
                          <div><div className="hq-muted-text" style={{ fontSize: "0.72rem" }}>Approved By</div><div>{String(policy.approved_by || "—")}</div></div>
                        </div>
                      </div>
                    </div>

                    <HqPanel title="What This Means" subtitle="Plain-language guidance for employees, volunteers, board members, and contractors">
                      <div className="hq-grid-2">
                        <div>
                          <h4>Why it exists</h4>
                          <p>{String(policy.what_this_means_why || "—")}</p>
                          <h4>What you are expected to do</h4>
                          <p>{String(policy.what_this_means_expectations || "—")}</p>
                          <h4>If the policy is not followed</h4>
                          <p>{String(policy.what_this_means_consequences || "—")}</p>
                        </div>
                        <div>
                          <h4>Departments affected</h4>
                          <p>{String(policy.what_this_means_departments || "—")}</p>
                          <h4>How it supports mission & legal compliance</h4>
                          <p>{String(policy.what_this_means_mission || "—")}</p>
                        </div>
                      </div>
                    </HqPanel>
                  </HqPanel>

                  <div className="hq-grid-2">
                    <HqPanel title="Electronic Approval Signature">
                      <div style={{ display: "grid", gap: "0.5rem" }}>
                        <input className="hq-input" placeholder="Approved by (name)" value={approveForm.approved_by} onChange={(e) => setApproveForm({ ...approveForm, approved_by: e.target.value })} />
                        <input className="hq-input" placeholder="Type full name as signature" value={approveForm.signature_text} onChange={(e) => setApproveForm({ ...approveForm, signature_text: e.target.value })} />
                        <button type="button" className="hq-btn hq-btn-primary" disabled={!approveForm.approved_by || !approveForm.signature_text || approveMut.isPending} onClick={() => approveMut.mutate(selectedId)}>
                          Record Approval Signature
                        </button>
                        <ul className="hq-activity-list">
                          {((detail.data?.signatures as Record<string, unknown>[]) ?? []).map((s) => (
                            <li key={String(s.id)} className="hq-activity-item">
                              <div className="hq-activity-content">
                                <div className="hq-activity-title">{String(s.signer_name)}</div>
                                <div className="hq-activity-detail">{String(s.purpose)} · {String(s.signature_text)}</div>
                              </div>
                              <div className="hq-activity-time">{String(s.signed_at)}</div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </HqPanel>

                    <HqPanel title="Employee / Volunteer Acknowledgment">
                      <div style={{ display: "grid", gap: "0.5rem" }}>
                        <input className="hq-input" placeholder="Full name" value={ackForm.person_name} onChange={(e) => setAckForm({ ...ackForm, person_name: e.target.value })} />
                        <select className="hq-input" value={ackForm.person_role} onChange={(e) => setAckForm({ ...ackForm, person_role: e.target.value })}>
                          <option value="employee">Employee</option>
                          <option value="volunteer">Volunteer</option>
                          <option value="board_member">Board Member</option>
                          <option value="contractor">Contractor</option>
                        </select>
                        <input className="hq-input" placeholder="Type full name as acknowledgment signature" value={ackForm.signature_text} onChange={(e) => setAckForm({ ...ackForm, signature_text: e.target.value })} />
                        <button type="button" className="hq-btn hq-btn-primary" disabled={!ackForm.person_name || !ackForm.signature_text || ackMut.isPending} onClick={() => ackMut.mutate(selectedId)}>
                          Acknowledge Policy
                        </button>
                        <ul className="hq-activity-list">
                          {((detail.data?.acknowledgments as Record<string, unknown>[]) ?? []).slice(0, 8).map((a) => (
                            <li key={String(a.id)} className="hq-activity-item">
                              <div className="hq-activity-content">
                                <div className="hq-activity-title">{String(a.person_name)}</div>
                                <div className="hq-activity-detail">{String(a.person_role)} · v{String(a.version_number)}</div>
                              </div>
                              <div className="hq-activity-time">{String(a.acknowledged_at)}</div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </HqPanel>
                  </div>

                  <HqPanel title="Version History">
                    <table className="hq-table">
                      <thead><tr><th>Version</th><th>Summary</th><th>By</th><th>When</th></tr></thead>
                      <tbody>
                        {((detail.data?.versions as Record<string, unknown>[]) ?? []).map((v) => (
                          <tr key={String(v.id)}>
                            <td>{String(v.version_number)}</td>
                            <td>{String(v.change_summary ?? "—")}</td>
                            <td>{String(v.created_by_email ?? "—")}</td>
                            <td>{String(v.created_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </HqPanel>
                </div>
              )}
            </div>
          )}

          {tab === "categories" && (
            <HqPanel title="Built-in Policy Categories" subtitle="30 enterprise categories spanning governance, programs, IT, and SOPs">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "0.6rem" }}>
                {categoryOptions.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="hq-panel"
                    style={{ textAlign: "left", padding: "0.85rem", cursor: "pointer" }}
                    onClick={() => { setCategory(c.id); setTab("library"); }}
                  >
                    <div style={{ fontWeight: 600, fontSize: "0.85rem" }}>{c.label}</div>
                    <div className="hq-muted-text" style={{ fontSize: "0.75rem" }}>{c.count} policies</div>
                  </button>
                ))}
              </div>
            </HqPanel>
          )}

          {tab === "acknowledgments" && (
            <HqPanel title="Organization-wide Acknowledgments" subtitle="Employee and volunteer acknowledgment tracking">
              {acks.isLoading ? <HqLoading message="Loading acknowledgments…" /> : (
                <table className="hq-table">
                  <thead><tr><th>Policy</th><th>Person</th><th>Role</th><th>Version</th><th>When</th></tr></thead>
                  <tbody>
                    {(acks.data?.acknowledgments ?? []).map((a) => (
                      <tr key={String(a.id)}>
                        <td>{String(a.policy_number)} — {String(a.policy_title)}</td>
                        <td>{String(a.person_name)}</td>
                        <td>{String(a.person_role ?? "—")}</td>
                        <td>{String(a.version_number)}</td>
                        <td>{String(a.acknowledged_at)}</td>
                      </tr>
                    ))}
                    {(acks.data?.acknowledgments ?? []).length === 0 && (
                      <tr><td colSpan={5} className="hq-muted-text">No acknowledgments recorded yet.</td></tr>
                    )}
                  </tbody>
                </table>
              )}
            </HqPanel>
          )}

          {tab === "reviews" && (
            <HqPanel title="Review Reminders" subtitle="Policies due for review within 90 days">
              {reviews.isLoading ? <HqLoading message="Loading review calendar…" /> : (
                <table className="hq-table">
                  <thead><tr><th>Number</th><th>Title</th><th>Department</th><th>Next Review</th><th>Status</th></tr></thead>
                  <tbody>
                    {(reviews.data?.reviews ?? []).map((r) => (
                      <tr key={String(r.id)} style={{ cursor: "pointer" }} onClick={() => openPolicy(String(r.id))}>
                        <td>{String(r.policy_number)}</td>
                        <td>{String(r.title)}</td>
                        <td>{String(r.department)}</td>
                        <td>{String(r.next_review_date)}</td>
                        <td><StatusBadge label={String(r.approval_status)} variant={statusVariant(String(r.approval_status))} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </HqPanel>
          )}

          {tab === "audit" && (
            <HqPanel title="Policy Audit Log" subtitle="Creates, updates, approvals, publishes, and acknowledgments">
              {activity.isLoading ? <HqLoading message="Loading audit log…" /> : (
                <ul className="hq-activity-list">
                  {(activity.data?.activity ?? []).map((a) => (
                    <li key={String(a.id)} className="hq-activity-item">
                      <div className="hq-activity-content">
                        <div className="hq-activity-title">{String(a.action)} · {String(a.policy_number ?? a.policy_title ?? "system")}</div>
                        <div className="hq-activity-detail">{String(a.detail)} · {String(a.actor_email ?? "—")}</div>
                      </div>
                      <div className="hq-activity-time">{String(a.created_at)}</div>
                    </li>
                  ))}
                </ul>
              )}
            </HqPanel>
          )}

          {tab === "report" && (
            <HqPanel title="Policy Compliance Report" subtitle="Organization-wide governance compliance metrics">
              {report.isLoading ? <HqLoading message="Generating report…" /> : (
                <div className="hq-kpi-grid">
                  <KpiCard label="Published" value={Number((report.data?.publishedCount as number) ?? 0)} />
                  <KpiCard label="Pending Approvals" value={((report.data?.pendingApprovals as unknown[]) ?? []).length} />
                  <KpiCard label="Reviews Due" value={((report.data?.reviewsDue as unknown[]) ?? []).length} />
                  <KpiCard label="Total Acknowledgments" value={Number((report.data?.acknowledgmentTotals as number) ?? 0)} />
                </div>
              )}
            </HqPanel>
          )}
        </>
      )}
    </HQLayout>
  );
};

export default PolicyGovernancePage;
