import React, { useState } from "react";
import { Link, useParams, Navigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Users, UserCircle, Wallet, Calendar, FileText, BarChart3, Plus, ArrowRight, Check, Shield, Download,
} from "lucide-react";
import HQLayout from "../../layouts/HQLayout";
import { programsHqApi } from "../../api/programsHqApi";
import { peopleApi } from "../../api/peopleApi";
import { getProgramDef } from "../../config/programModules";
import { KpiCard } from "../../components/hq/KpiCard";
import { HqPanel } from "../../components/hq/HqPanel";
import { StatusBadge } from "../../components/hq/StatusBadge";
import { HqLoading } from "../../components/hq/HqLoading";
import { formatCurrency } from "../../utils/safeFormat";

type Tab = "overview" | "participants" | "staff" | "budget" | "calendar" | "documents" | "reporting" | "compliance";

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "overview", label: "Overview", icon: BarChart3 },
  { id: "participants", label: "Participants", icon: Users },
  { id: "staff", label: "Staff", icon: UserCircle },
  { id: "budget", label: "Budget", icon: Wallet },
  { id: "calendar", label: "Calendar", icon: Calendar },
  { id: "documents", label: "Documents", icon: FileText },
  { id: "reporting", label: "Outcomes", icon: BarChart3 },
  { id: "compliance", label: "Compliance", icon: Shield },
];

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const fmtMoney = formatCurrency;

const ProgramModulePage: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const def = slug ? getProgramDef(slug) : undefined;
  const [tab, setTab] = useState<Tab>("overview");
  const [partForm, setPartForm] = useState({ person_id: "", participant_name: "", outcome_notes: "" });
  const [staffForm, setStaffForm] = useState({ person_id: "", role: "coordinator" });
  const [eventForm, setEventForm] = useState({ title: "", start_at: "", location: "", event_type: "session" });
  const [docForm, setDocForm] = useState({ title: "", category: "general", file_url: "" });
  const [budgetForm, setBudgetForm] = useState({ budget_allocated: "", budget_spent: "" });
  const [complianceForm, setComplianceForm] = useState({ requirement: "", category: "regulatory", due_date: "", notes: "" });
  const [perfReport, setPerfReport] = useState<Record<string, unknown> | null>(null);
  const qc = useQueryClient();

  if (!slug || !def) return <Navigate to="/hq/programs" replace />;

  const summary = useQuery({ queryKey: ["program-module", slug], queryFn: () => programsHqApi.get(slug) });
  const participants = useQuery({ queryKey: ["program-participants", slug], queryFn: () => programsHqApi.participants(slug), enabled: tab === "participants" || tab === "overview" });
  const staff = useQuery({ queryKey: ["program-staff", slug], queryFn: () => programsHqApi.staff(slug), enabled: tab === "staff" || tab === "overview" });
  const events = useQuery({ queryKey: ["program-events", slug], queryFn: () => programsHqApi.events(slug), enabled: tab === "calendar" || tab === "overview" });
  const documents = useQuery({ queryKey: ["program-documents", slug], queryFn: () => programsHqApi.documents(slug), enabled: tab === "documents" });
  const metrics = useQuery({ queryKey: ["program-metrics", slug], queryFn: () => programsHqApi.metrics(slug), enabled: tab === "reporting" || tab === "overview" });
  const finance = useQuery({ queryKey: ["program-finance", slug], queryFn: () => programsHqApi.financeSummary(slug), enabled: tab === "budget" || tab === "overview" });
  const compliance = useQuery({ queryKey: ["program-compliance", slug], queryFn: () => programsHqApi.compliance(slug), enabled: tab === "compliance" || tab === "overview" });
  const people = useQuery({ queryKey: ["people-list-program"], queryFn: () => peopleApi.list(), enabled: tab === "participants" || tab === "staff" });

  const addParticipant = useMutation({
    mutationFn: () => programsHqApi.addParticipant(slug, {
      person_id: partForm.person_id || undefined,
      participant_name: partForm.participant_name || undefined,
      outcome_notes: partForm.outcome_notes || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["program-participants", slug] });
      qc.invalidateQueries({ queryKey: ["program-module", slug] });
      setPartForm({ person_id: "", participant_name: "", outcome_notes: "" });
    },
  });

  const addStaff = useMutation({
    mutationFn: () => programsHqApi.addStaff(slug, staffForm),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["program-staff", slug] });
      qc.invalidateQueries({ queryKey: ["program-module", slug] });
      setStaffForm({ person_id: "", role: "coordinator" });
    },
  });

  const addEvent = useMutation({
    mutationFn: () => programsHqApi.addEvent(slug, eventForm),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["program-events", slug] });
      qc.invalidateQueries({ queryKey: ["program-module", slug] });
      setEventForm({ title: "", start_at: "", location: "", event_type: "session" });
    },
  });

  const addDocument = useMutation({
    mutationFn: () => programsHqApi.addDocument(slug, docForm),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["program-documents", slug] });
      qc.invalidateQueries({ queryKey: ["program-module", slug] });
      setDocForm({ title: "", category: "general", file_url: "" });
    },
  });

  const updateBudget = useMutation({
    mutationFn: () => programsHqApi.updateBudget(slug, {
      budget_allocated: budgetForm.budget_allocated ? Number(budgetForm.budget_allocated) : undefined,
      budget_spent: budgetForm.budget_spent ? Number(budgetForm.budget_spent) : undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["program-module", slug] });
      qc.invalidateQueries({ queryKey: ["program-finance", slug] });
    },
  });

  const updateMetric = useMutation({
    mutationFn: ({ id, value }: { id: string; value: number }) => programsHqApi.updateMetric(slug, id, { metric_value: value }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["program-metrics", slug] }),
  });

  const program = summary.data?.program as { budget_allocated?: number; budget_spent?: number; description?: string } | undefined;
  const counts = summary.data?.counts;
  const Icon = def.icon;

  return (
    <HQLayout title={def.title} subtitle={def.description}>
      {def.opsPath && (
        <div className="hq-founder-command-strip hq-fade-in" style={{ marginBottom: "1rem" }}>
          <Link to={def.opsPath} className="primary"><Icon size={14} /> Operations Module <ArrowRight size={12} /></Link>
          {def.relatedPaths.map((r) => (
            <Link key={r.path} to={r.path}>{r.label}</Link>
          ))}
          <Link to="/hq/programs">← All Programs</Link>
        </div>
      )}

      {summary.isLoading ? <HqLoading /> : counts && (
        <div className="hq-kpi-grid hq-fade-in" style={{ marginBottom: "1.25rem" }}>
          <KpiCard label="Active Participants" value={counts.participants} icon={Users} variant="gold" />
          <KpiCard label="Program Staff" value={counts.staff} icon={UserCircle} />
          <KpiCard label="Upcoming Events" value={counts.upcomingEvents} icon={Calendar} />
          <KpiCard label="Documents" value={counts.documents} icon={FileText} />
          <KpiCard label="Budget Allocated" value={fmtMoney(program?.budget_allocated ?? 0)} icon={Wallet} />
          <KpiCard label="Budget Spent" value={fmtMoney(program?.budget_spent ?? 0)} icon={Wallet} variant="warning" />
        </div>
      )}

      <nav className="hq-tabs">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={`hq-tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
            <t.icon size={16} /> {t.label}
          </button>
        ))}
      </nav>

      <div className="hq-tab-content hq-fade-in">
        {tab === "overview" && summary.data && (
          <div className="hq-grid-2">
            <HqPanel title="Program Impact Metrics">
              <ul className="hq-activity-list">
                {(metrics.data?.metrics ?? summary.data.metrics ?? []).map((m) => (
                  <li key={m.id} className="hq-activity-item">
                    <div className="hq-activity-content">
                      <div className="hq-activity-title">{m.metric_label}</div>
                      <div className="hq-activity-detail">Target: {m.target_value ?? "—"}</div>
                    </div>
                    <div className="hq-activity-time" style={{ color: "var(--hq-gold)", fontWeight: 700 }}>{m.metric_value}</div>
                  </li>
                ))}
              </ul>
            </HqPanel>
            <HqPanel title="Recent Activity">
              <ul className="hq-activity-list">
                {(events.data?.events ?? []).slice(0, 5).map((e) => (
                  <li key={e.id as string} className="hq-activity-item">
                    <div className="hq-activity-content">
                      <div className="hq-activity-title">{e.title as string}</div>
                      <div className="hq-activity-detail">{e.event_type as string}</div>
                    </div>
                    <div className="hq-activity-time">{fmtDate(e.start_at as string)}</div>
                  </li>
                ))}
                {!events.data?.events?.length && <li className="hq-muted-text">Schedule events in the Calendar tab</li>}
              </ul>
            </HqPanel>
          </div>
        )}

        {tab === "participants" && (
          <>
            <div className="hq-panel" style={{ marginBottom: "1rem", padding: "1.25rem" }}>
              <h4 style={{ fontSize: "0.85rem", marginBottom: "0.75rem", color: "var(--hq-gold)" }}>Enroll Participant</h4>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "0.75rem", alignItems: "end" }}>
                <div>
                  <label style={{ fontSize: "0.72rem", color: "var(--hq-text-muted)" }}>From People Directory</label>
                  <select className="hq-aura-input" value={partForm.person_id} onChange={(e) => setPartForm({ ...partForm, person_id: e.target.value })}>
                    <option value="">— Select person —</option>
                    {(people.data?.people ?? []).map((p) => (
                      <option key={p.id} value={p.id}>{p.fullName}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: "0.72rem", color: "var(--hq-text-muted)" }}>Or Name</label>
                  <input className="hq-aura-input" value={partForm.participant_name} onChange={(e) => setPartForm({ ...partForm, participant_name: e.target.value })} placeholder="Participant name" />
                </div>
                <button type="button" className="hq-btn hq-btn-primary" disabled={addParticipant.isPending || (!partForm.person_id && !partForm.participant_name)}
                  onClick={() => addParticipant.mutate()}>
                  <Plus size={14} /> Enroll
                </button>
              </div>
            </div>
            <HqPanel title="Program Participants">
              {participants.isLoading ? <HqLoading /> : (
                <table className="hq-table">
                  <thead><tr><th>Name</th><th>Status</th><th>Enrolled</th><th>Outcome</th></tr></thead>
                  <tbody>
                    {(participants.data?.participants ?? []).map((p) => (
                      <tr key={p.id as string}>
                        <td>{p.first_name ? `${p.first_name} ${p.last_name}` : (p.participant_name as string)}</td>
                        <td><StatusBadge label={p.status as string} variant={p.status === "active" ? "success" : "muted"} /></td>
                        <td>{fmtDate(p.enrolled_at as string)}</td>
                        <td>{(p.outcome_status as string) ?? "—"}</td>
                      </tr>
                    ))}
                    {!participants.data?.participants?.length && (
                      <tr><td colSpan={4} className="hq-empty-cell">No participants enrolled yet</td></tr>
                    )}
                  </tbody>
                </table>
              )}
            </HqPanel>
          </>
        )}

        {tab === "staff" && (
          <>
            <div className="hq-panel" style={{ marginBottom: "1rem", padding: "1.25rem" }}>
              <h4 style={{ fontSize: "0.85rem", marginBottom: "0.75rem", color: "var(--hq-gold)" }}>Assign Staff</h4>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "0.75rem", alignItems: "end" }}>
                <div>
                  <label style={{ fontSize: "0.72rem", color: "var(--hq-text-muted)" }}>Person</label>
                  <select className="hq-aura-input" value={staffForm.person_id} onChange={(e) => setStaffForm({ ...staffForm, person_id: e.target.value })}>
                    <option value="">— Select —</option>
                    {(people.data?.people ?? []).filter((p) => ["employee", "volunteer", "contractor", "mentor"].includes(p.personType)).map((p) => (
                      <option key={p.id} value={p.id}>{p.fullName}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: "0.72rem", color: "var(--hq-text-muted)" }}>Role</label>
                  <select className="hq-aura-input" value={staffForm.role} onChange={(e) => setStaffForm({ ...staffForm, role: e.target.value })}>
                    <option value="coordinator">Coordinator</option>
                    <option value="case_manager">Case Manager</option>
                    <option value="director">Director</option>
                    <option value="volunteer_lead">Volunteer Lead</option>
                  </select>
                </div>
                <button type="button" className="hq-btn hq-btn-primary" disabled={!staffForm.person_id || addStaff.isPending} onClick={() => addStaff.mutate()}>
                  <Plus size={14} /> Assign
                </button>
              </div>
            </div>
            <HqPanel title="Program Staff">
              {staff.isLoading ? <HqLoading /> : (
                <table className="hq-table">
                  <thead><tr><th>Name</th><th>Role</th><th>Assigned</th><th>Email</th></tr></thead>
                  <tbody>
                    {(staff.data?.staff ?? []).map((s) => (
                      <tr key={s.id as string}>
                        <td>{s.first_name as string} {s.last_name as string}</td>
                        <td><StatusBadge label={(s.role as string).replace(/_/g, " ")} variant="gold" /></td>
                        <td>{fmtDate(s.assigned_at as string)}</td>
                        <td>{s.email as string}</td>
                      </tr>
                    ))}
                    {!staff.data?.staff?.length && (
                      <tr><td colSpan={4} className="hq-empty-cell">No staff assigned — add coordinators from People Center</td></tr>
                    )}
                  </tbody>
                </table>
              )}
            </HqPanel>
          </>
        )}

        {tab === "budget" && program && (
          <HqPanel title="Program Budget" subtitle="Linked to Financial Center General Ledger — allocations, expenditures, and audit trail">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "1rem", marginBottom: "1.25rem" }}>
              <div className="hq-panel" style={{ padding: "1rem" }}>
                <div style={{ fontSize: "0.75rem", color: "var(--hq-text-muted)" }}>Allocated</div>
                <div style={{ fontSize: "1.75rem", fontWeight: 800, color: "var(--hq-gold)" }}>{fmtMoney(program.budget_allocated ?? 0)}</div>
              </div>
              <div className="hq-panel" style={{ padding: "1rem" }}>
                <div style={{ fontSize: "0.75rem", color: "var(--hq-text-muted)" }}>Spent (GL)</div>
                <div style={{ fontSize: "1.75rem", fontWeight: 800, color: "var(--hq-warning)" }}>{fmtMoney(finance.data?.totalExpenses ?? program.budget_spent ?? 0)}</div>
              </div>
              <div className="hq-panel" style={{ padding: "1rem" }}>
                <div style={{ fontSize: "0.75rem", color: "var(--hq-text-muted)" }}>Balance</div>
                <div style={{ fontSize: "1.75rem", fontWeight: 800 }}>{fmtMoney(finance.data?.balanceRemaining ?? ((program.budget_allocated ?? 0) - (program.budget_spent ?? 0)))}</div>
              </div>
            </div>
            {finance.data?.glBudget && (
              <p className="hq-muted-text" style={{ marginBottom: "1rem" }}>
                GL Budget: <strong>{finance.data.glBudget.name}</strong> · Synced with General Ledger
              </p>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.75rem", alignItems: "end" }}>
              <div>
                <label style={{ fontSize: "0.72rem" }}>Update Allocated</label>
                <input className="hq-aura-input" type="number" value={budgetForm.budget_allocated} onChange={(e) => setBudgetForm({ ...budgetForm, budget_allocated: e.target.value })} placeholder={String(program.budget_allocated ?? "")} />
              </div>
              <button type="button" className="hq-btn hq-btn-primary" disabled={updateBudget.isPending} onClick={() => updateBudget.mutate()}>
                <Check size={14} /> Save & Sync to GL
              </button>
            </div>
            {finance.isLoading ? <HqLoading /> : (
              <>
                <div style={{ marginTop: "1.25rem" }}>
                  <div className="hq-panel-title" style={{ marginBottom: "0.75rem" }}>Recent Expenses</div>
                  <table className="hq-table">
                    <thead><tr><th>Description</th><th>Amount</th><th>Date</th><th>Status</th></tr></thead>
                    <tbody>
                      {(finance.data?.expenses ?? []).map((e) => (
                        <tr key={e.id as string}>
                          <td>{e.description as string}</td>
                          <td>{fmtMoney((e.amount_cents as number) / 100)}</td>
                          <td>{fmtDate(e.expense_date as string)}</td>
                          <td><StatusBadge label={e.approval_status as string} variant="gold" /></td>
                        </tr>
                      ))}
                      {!finance.data?.expenses?.length && (
                        <tr><td colSpan={4} className="hq-empty-cell">No linked expenses yet — approve expenses in Financial Center with this program</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {(finance.data?.auditTrail ?? []).length > 0 && (
                  <div style={{ marginTop: "1rem" }}>
                    <div className="hq-panel-title" style={{ marginBottom: "0.75rem" }}>Audit Trail</div>
                    <table className="hq-table">
                      <thead><tr><th>Action</th><th>Detail</th><th>When</th></tr></thead>
                      <tbody>
                        {finance.data!.auditTrail.map((a, i) => (
                          <tr key={i}>
                            <td>{a.action as string}</td>
                            <td>{a.detail as string}</td>
                            <td>{fmtDate(a.created_at as string)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
            <p className="hq-muted-text" style={{ marginTop: "1rem" }}>Full reporting in <Link to="/hq/finance">Financial Center</Link></p>
          </HqPanel>
        )}

        {tab === "calendar" && (
          <>
            <div className="hq-panel" style={{ marginBottom: "1rem", padding: "1.25rem" }}>
              <h4 style={{ fontSize: "0.85rem", marginBottom: "0.75rem", color: "var(--hq-gold)" }}>Schedule Event</h4>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.75rem", alignItems: "end" }}>
                <div><label style={{ fontSize: "0.72rem" }}>Title</label><input className="hq-aura-input" value={eventForm.title} onChange={(e) => setEventForm({ ...eventForm, title: e.target.value })} /></div>
                <div><label style={{ fontSize: "0.72rem" }}>Start</label><input className="hq-aura-input" type="datetime-local" value={eventForm.start_at} onChange={(e) => setEventForm({ ...eventForm, start_at: e.target.value })} /></div>
                <div><label style={{ fontSize: "0.72rem" }}>Location</label><input className="hq-aura-input" value={eventForm.location} onChange={(e) => setEventForm({ ...eventForm, location: e.target.value })} /></div>
                <button type="button" className="hq-btn hq-btn-primary" disabled={!eventForm.title || !eventForm.start_at || addEvent.isPending} onClick={() => addEvent.mutate()}>
                  <Plus size={14} /> Add Event
                </button>
              </div>
            </div>
            <HqPanel title="Program Calendar">
              {events.isLoading ? <HqLoading /> : (
                <table className="hq-table">
                  <thead><tr><th>Event</th><th>Type</th><th>Start</th><th>Location</th><th>Status</th></tr></thead>
                  <tbody>
                    {(events.data?.events ?? []).map((e) => (
                      <tr key={e.id as string}>
                        <td>{e.title as string}</td>
                        <td>{e.event_type as string}</td>
                        <td>{fmtDate(e.start_at as string)}</td>
                        <td>{(e.location as string) ?? "—"}</td>
                        <td><StatusBadge label={e.status as string} variant="gold" /></td>
                      </tr>
                    ))}
                    {!events.data?.events?.length && <tr><td colSpan={5} className="hq-empty-cell">No events scheduled</td></tr>}
                  </tbody>
                </table>
              )}
            </HqPanel>
          </>
        )}

        {tab === "documents" && (
          <>
            <div className="hq-panel" style={{ marginBottom: "1rem", padding: "1.25rem" }}>
              <h4 style={{ fontSize: "0.85rem", marginBottom: "0.75rem", color: "var(--hq-gold)" }}>Add Program Document</h4>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.75rem", alignItems: "end" }}>
                <div><label style={{ fontSize: "0.72rem" }}>Title</label><input className="hq-aura-input" value={docForm.title} onChange={(e) => setDocForm({ ...docForm, title: e.target.value })} /></div>
                <div><label style={{ fontSize: "0.72rem" }}>File URL</label><input className="hq-aura-input" value={docForm.file_url} onChange={(e) => setDocForm({ ...docForm, file_url: e.target.value })} /></div>
                <button type="button" className="hq-btn hq-btn-primary" disabled={!docForm.title || addDocument.isPending} onClick={() => addDocument.mutate()}>
                  <Plus size={14} /> Add
                </button>
              </div>
            </div>
            <HqPanel title="Program Documents">
              {documents.isLoading ? <HqLoading /> : (
                <table className="hq-table">
                  <thead><tr><th>Title</th><th>Category</th><th>Added</th></tr></thead>
                  <tbody>
                    {(documents.data?.documents ?? []).map((d) => (
                      <tr key={d.id as string}>
                        <td>{d.file_url ? <a href={d.file_url as string} target="_blank" rel="noopener noreferrer">{d.title as string}</a> : (d.title as string)}</td>
                        <td>{d.category as string}</td>
                        <td>{fmtDate(d.created_at as string)}</td>
                      </tr>
                    ))}
                    {!documents.data?.documents?.length && <tr><td colSpan={3} className="hq-empty-cell">No documents — also use <Link to="/hq/documents">Document Center</Link></td></tr>}
                  </tbody>
                </table>
              )}
            </HqPanel>
          </>
        )}

        {tab === "reporting" && (
          <>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "1rem" }}>
              <button type="button" className="hq-btn hq-btn-primary hq-btn-sm" onClick={async () => {
                const data = await programsHqApi.performanceReport(slug);
                setPerfReport(data);
              }}>
                <Download size={14} /> Generate Performance Report
              </button>
            </div>
            {perfReport && (
              <div style={{ marginBottom: "1rem" }}>
              <HqPanel title={String(perfReport.title)} subtitle="Program performance snapshot">
                <p style={{ fontSize: "0.85rem", lineHeight: 1.6 }}>{String(perfReport.narrative)}</p>
              </HqPanel>
              </div>
            )}
            <HqPanel title="Outcome Metrics & Impact Reporting" subtitle="Track program outcomes against targets">
              {metrics.isLoading ? <HqLoading /> : (
                <table className="hq-table">
                  <thead><tr><th>Metric</th><th>Current</th><th>Target</th><th>Progress</th><th>Update</th></tr></thead>
                  <tbody>
                    {(metrics.data?.metrics ?? []).map((m) => {
                      const pct = m.target_value ? Math.min(100, Math.round((m.metric_value / m.target_value) * 100)) : 0;
                      return (
                        <tr key={m.id}>
                          <td>{m.metric_label}</td>
                          <td style={{ fontWeight: 700, color: "var(--hq-gold)" }}>{m.metric_value}</td>
                          <td>{m.target_value ?? "—"}</td>
                          <td><StatusBadge label={`${pct}%`} variant={pct >= 80 ? "success" : pct >= 50 ? "warning" : "muted"} /></td>
                          <td>
                            <input type="number" className="hq-aura-input" style={{ width: 80 }} defaultValue={m.metric_value}
                              onBlur={(e) => {
                                const v = Number(e.target.value);
                                if (!Number.isNaN(v) && v !== m.metric_value) updateMetric.mutate({ id: m.id, value: v });
                              }} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </HqPanel>
          </>
        )}

        {tab === "compliance" && (
          <>
            <HqPanel title="Add Compliance Requirement">
              <div className="hq-form-grid">
                <label>Requirement<input className="hq-input" value={complianceForm.requirement} onChange={(e) => setComplianceForm({ ...complianceForm, requirement: e.target.value })} /></label>
                <label>Category<input className="hq-input" value={complianceForm.category} onChange={(e) => setComplianceForm({ ...complianceForm, category: e.target.value })} /></label>
                <label>Due Date<input className="hq-input" type="date" value={complianceForm.due_date} onChange={(e) => setComplianceForm({ ...complianceForm, due_date: e.target.value })} /></label>
                <label style={{ gridColumn: "1 / -1" }}>Notes<textarea className="hq-input" rows={2} value={complianceForm.notes} onChange={(e) => setComplianceForm({ ...complianceForm, notes: e.target.value })} /></label>
              </div>
              <button type="button" className="hq-btn hq-btn-primary" style={{ marginTop: "0.75rem" }}
                disabled={!complianceForm.requirement}
                onClick={() => programsHqApi.addCompliance(slug, complianceForm).then(() => {
                  qc.invalidateQueries({ queryKey: ["program-compliance", slug] });
                  setComplianceForm({ requirement: "", category: "regulatory", due_date: "", notes: "" });
                })}>
                Add Requirement
              </button>
            </HqPanel>
            <div style={{ marginTop: "1rem" }}>
            <HqPanel title="Program Compliance Monitoring">
              {compliance.isLoading ? <HqLoading /> : (
                <table className="hq-table">
                  <thead><tr><th>Requirement</th><th>Category</th><th>Due</th><th>Status</th><th></th></tr></thead>
                  <tbody>
                    {(compliance.data?.compliance ?? []).map((c) => (
                      <tr key={c.id as string}>
                        <td>{c.requirement as string}</td>
                        <td>{c.category as string}</td>
                        <td>{fmtDate(c.due_date as string)}</td>
                        <td><StatusBadge label={c.status as string} variant={c.status === "completed" ? "success" : "warning"} /></td>
                        <td>{c.status !== "completed" && (
                          <button type="button" className="hq-btn hq-btn-sm" onClick={() => programsHqApi.updateCompliance(slug, c.id as string, { status: "completed" }).then(() => qc.invalidateQueries({ queryKey: ["program-compliance", slug] }))}>Complete</button>
                        )}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </HqPanel>
            </div>
          </>
        )}
      </div>
    </HQLayout>
  );
};

export default ProgramModulePage;
