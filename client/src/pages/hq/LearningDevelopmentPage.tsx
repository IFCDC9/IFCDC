import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Award,
  BookOpen,
  ClipboardCheck,
  GraduationCap,
  Link2,
  Wallet,
} from "lucide-react";
import HQLayout from "../../layouts/HQLayout";
import { learningApi } from "../../api/learningApi";
import { KpiCard } from "../../components/hq/KpiCard";
import { HqPanel } from "../../components/hq/HqPanel";
import { HqLoading } from "../../components/hq/HqLoading";
import { StatusBadge } from "../../components/hq/StatusBadge";

type TabId = "overview" | "courses" | "paths" | "enrollments" | "certificates" | "pd-costs";

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "courses", label: "Courses" },
  { id: "paths", label: "Role Paths" },
  { id: "enrollments", label: "Assignments" },
  { id: "certificates", label: "Certificates" },
  { id: "pd-costs", label: "Grant PD Costs" },
];

const LearningDevelopmentPage: React.FC = () => {
  const [tab, setTab] = useState<TabId>("overview");
  const [assignForm, setAssignForm] = useState({ course_id: "", person_name: "", person_role: "employee" });
  const [courseForm, setCourseForm] = useState({ title: "", description: "", source_type: "ifcdc", policy_category: "code_of_ethics" });
  const [pdForm, setPdForm] = useState({
    description: "",
    amount_cents: "5000",
    incurred_date: new Date().toISOString().slice(0, 10),
    grant_award_id: "",
    person_name: "",
  });
  const qc = useQueryClient();

  const dashboard = useQuery({ queryKey: ["learning-dashboard"], queryFn: learningApi.dashboard, staleTime: 30_000 });
  const courses = useQuery({ queryKey: ["learning-courses"], queryFn: learningApi.courses, enabled: tab === "courses" || tab === "enrollments" || tab === "overview" });
  const paths = useQuery({ queryKey: ["learning-paths"], queryFn: learningApi.paths, enabled: tab === "paths" || tab === "overview" });
  const enrollments = useQuery({ queryKey: ["learning-enrollments"], queryFn: () => learningApi.enrollments(), enabled: tab === "enrollments" });
  const certificates = useQuery({ queryKey: ["learning-certs"], queryFn: learningApi.certificates, enabled: tab === "certificates" });
  const pdCosts = useQuery({ queryKey: ["learning-pd"], queryFn: learningApi.pdCosts, enabled: tab === "pd-costs" });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["learning-dashboard"] });
    void qc.invalidateQueries({ queryKey: ["learning-courses"] });
    void qc.invalidateQueries({ queryKey: ["learning-paths"] });
    void qc.invalidateQueries({ queryKey: ["learning-enrollments"] });
    void qc.invalidateQueries({ queryKey: ["learning-certs"] });
    void qc.invalidateQueries({ queryKey: ["learning-pd"] });
  };

  const assignMut = useMutation({
    mutationFn: () => learningApi.assign(assignForm),
    onSuccess: () => {
      setAssignForm({ course_id: "", person_name: "", person_role: "employee" });
      invalidate();
    },
  });

  const createCourseMut = useMutation({
    mutationFn: () => learningApi.createCourse(courseForm),
    onSuccess: () => {
      setCourseForm({ title: "", description: "", source_type: "ifcdc", policy_category: "code_of_ethics" });
      invalidate();
    },
  });

  const completeMut = useMutation({
    mutationFn: (id: string) => learningApi.complete(id, { quiz_score: 100, acknowledge: true }),
    onSuccess: invalidate,
  });

  const pdMut = useMutation({
    mutationFn: () =>
      learningApi.logPdCost({
        ...pdForm,
        amount_cents: Number(pdForm.amount_cents),
        grant_eligible: true,
      }),
    onSuccess: () => {
      setPdForm((f) => ({ ...f, description: "", amount_cents: "5000", grant_award_id: "", person_name: "" }));
      invalidate();
    },
  });

  const dash = dashboard.data ?? {};

  return (
    <HQLayout
      title="Learning & Development Center"
      subtitle="Policy-linked training, role learning paths, quizzes, certificates, and grant-funded professional development"
    >
      {dashboard.isLoading && !dashboard.data ? (
        <HqLoading message="Loading Learning & Development…" />
      ) : (
        <>
          <div className="hq-kpi-grid" style={{ marginBottom: "1rem" }}>
            <KpiCard label="Courses" value={Number(dash.courses ?? 0)} icon={GraduationCap} variant="gold" />
            <KpiCard label="Role paths" value={Number(dash.learningPaths ?? 0)} icon={BookOpen} />
            <KpiCard label="Assignments" value={Number(dash.enrollments ?? 0)} icon={ClipboardCheck} />
            <KpiCard label="Completed" value={Number(dash.completed ?? 0)} icon={Award} variant="success" />
            <KpiCard label="Certificates" value={Number(dash.certificates ?? 0)} icon={Award} />
            <KpiCard
              label="Grant PD spend"
              value={`$${((Number(dash.grantEligiblePdSpendCents ?? 0)) / 100).toLocaleString()}`}
              icon={Wallet}
              meta="Trackable under grant-funded PD"
            />
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginBottom: "1rem" }}>
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`hq-btn hq-btn-sm ${tab === t.id ? "hq-btn-primary" : "hq-btn-ghost"}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
            <Link to="/hq/policies" className="hq-btn hq-btn-sm hq-btn-secondary"><Link2 size={12} /> Policy Center</Link>
            <Link to="/hq/people?tab=certifications" className="hq-btn hq-btn-sm hq-btn-ghost">People Training</Link>
            <Link to="/hq/grants" className="hq-btn hq-btn-sm hq-btn-ghost">Grant Center</Link>
          </div>

          {tab === "overview" && (
            <div className="hq-grid-2 hq-fade-in">
              <HqPanel title="How Learning supports Governance" subtitle="Every policy can link to training">
                <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
                  <li>IFCDC-produced videos and courses are preferred when available.</li>
                  <li>High-quality external training is supported via course source links.</li>
                  <li>Role paths assign required learning for employees, volunteers, board, managers, and grant staff.</li>
                  <li>Completion issues certificates and can mirror into People training records.</li>
                  <li>Grant-eligible PD costs are logged for professional development reporting.</li>
                </ul>
              </HqPanel>
              <HqPanel title="Active role paths" subtitle="Required learning by workforce role">
                <ul className="hq-activity-list" style={{ margin: 0, padding: 0, listStyle: "none" }}>
                  {((paths.data?.paths as Array<Record<string, unknown>>) ?? []).map((p) => (
                    <li key={String(p.id)} className="hq-activity-item">
                      <div className="hq-activity-content">
                        <div className="hq-activity-title">{String(p.title)}</div>
                        <div className="hq-activity-detail">
                          Role: {String(p.role_key)} · {(p.courses as unknown[] | undefined)?.length ?? 0} courses
                        </div>
                      </div>
                      <StatusBadge label={p.required ? "required" : "optional"} variant={p.required ? "gold" : "muted"} />
                    </li>
                  ))}
                </ul>
              </HqPanel>
            </div>
          )}

          {tab === "courses" && (
            <div className="hq-fade-in" style={{ display: "grid", gap: "1rem" }}>
              <HqPanel title="Add course" subtitle="Link to a policy category; attach IFCDC or external resources">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (courseForm.title.trim()) createCourseMut.mutate();
                  }}
                  style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "0.5rem" }}
                >
                  <input className="hq-input" placeholder="Course title" value={courseForm.title} onChange={(e) => setCourseForm({ ...courseForm, title: e.target.value })} />
                  <input className="hq-input" placeholder="Description" value={courseForm.description} onChange={(e) => setCourseForm({ ...courseForm, description: e.target.value })} />
                  <select className="hq-input" value={courseForm.source_type} onChange={(e) => setCourseForm({ ...courseForm, source_type: e.target.value })}>
                    <option value="ifcdc">IFCDC produced</option>
                    <option value="external">External</option>
                  </select>
                  <input className="hq-input" placeholder="Policy category id" value={courseForm.policy_category} onChange={(e) => setCourseForm({ ...courseForm, policy_category: e.target.value })} />
                  <button type="submit" className="hq-btn hq-btn-primary" disabled={createCourseMut.isPending}>Create course</button>
                </form>
              </HqPanel>
              <HqPanel title="Course catalog">
                {courses.isLoading && <HqLoading message="Loading courses…" />}
                <ul className="hq-activity-list" style={{ margin: 0, padding: 0, listStyle: "none" }}>
                  {((courses.data?.courses as Array<Record<string, unknown>>) ?? []).map((c) => (
                    <li key={String(c.id)} className="hq-activity-item">
                      <div className="hq-activity-content">
                        <div className="hq-activity-title">{String(c.title)}</div>
                        <div className="hq-activity-detail">
                          {String(c.source_type)} · {Number(c.duration_minutes)} min
                          {c.policy_title ? ` · Policy: ${String(c.policy_title)}` : c.policy_category ? ` · Category: ${String(c.policy_category)}` : ""}
                          {c.grant_eligible ? " · Grant PD eligible" : ""}
                        </div>
                      </div>
                      <StatusBadge label={String(c.status)} variant="success" />
                    </li>
                  ))}
                </ul>
              </HqPanel>
            </div>
          )}

          {tab === "paths" && (
            <div className="hq-fade-in">
              {paths.isLoading && <HqLoading message="Loading paths…" />}
              <div style={{ display: "grid", gap: "0.75rem" }}>
                {((paths.data?.paths as Array<Record<string, unknown>>) ?? []).map((p) => (
                  <HqPanel key={String(p.id)} title={String(p.title)} subtitle={`Role: ${String(p.role_key)}`}>
                    <ul className="hq-activity-list" style={{ margin: 0, padding: 0, listStyle: "none" }}>
                      {((p.courses as Array<Record<string, unknown>>) ?? []).map((c) => (
                        <li key={String(c.id)} className="hq-activity-item">
                          <div className="hq-activity-content">
                            <div className="hq-activity-title">{String(c.title)}</div>
                            <div className="hq-activity-detail">{Number(c.duration_minutes)} min · quiz pass {Number(c.passing_score)}%</div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </HqPanel>
                ))}
              </div>
            </div>
          )}

          {tab === "enrollments" && (
            <div className="hq-fade-in" style={{ display: "grid", gap: "1rem" }}>
              <HqPanel title="Assign course">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (assignForm.course_id && assignForm.person_name) assignMut.mutate();
                  }}
                  style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "0.5rem" }}
                >
                  <select
                    className="hq-input"
                    value={assignForm.course_id}
                    onChange={(e) => setAssignForm({ ...assignForm, course_id: e.target.value })}
                  >
                    <option value="">Select course…</option>
                    {((courses.data?.courses as Array<Record<string, unknown>>) ?? []).map((c) => (
                      <option key={String(c.id)} value={String(c.id)}>{String(c.title)}</option>
                    ))}
                  </select>
                  <input className="hq-input" placeholder="Person name" value={assignForm.person_name} onChange={(e) => setAssignForm({ ...assignForm, person_name: e.target.value })} />
                  <select className="hq-input" value={assignForm.person_role} onChange={(e) => setAssignForm({ ...assignForm, person_role: e.target.value })}>
                    <option value="employee">Employee</option>
                    <option value="volunteer">Volunteer</option>
                    <option value="board_member">Board member</option>
                    <option value="manager">Manager</option>
                    <option value="contractor">Contractor</option>
                  </select>
                  <button type="submit" className="hq-btn hq-btn-primary" disabled={assignMut.isPending}>Assign</button>
                </form>
              </HqPanel>
              <HqPanel title="Assignments & completion">
                <ul className="hq-activity-list" style={{ margin: 0, padding: 0, listStyle: "none" }}>
                  {((enrollments.data?.enrollments as Array<Record<string, unknown>>) ?? []).map((e) => (
                    <li key={String(e.id)} className="hq-activity-item">
                      <div className="hq-activity-content">
                        <div className="hq-activity-title">{String(e.person_name)} — {String(e.course_title)}</div>
                        <div className="hq-activity-detail">{String(e.person_role)} · {Number(e.progress_pct)}%</div>
                      </div>
                      <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                        <StatusBadge label={String(e.status)} variant={e.status === "completed" ? "success" : "warning"} />
                        {e.status !== "completed" && (
                          <button type="button" className="hq-btn hq-btn-sm hq-btn-secondary" onClick={() => completeMut.mutate(String(e.id))}>
                            Complete + certify
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </HqPanel>
            </div>
          )}

          {tab === "certificates" && (
            <div className="hq-fade-in">
              <HqPanel title="Issued certificates">
                <ul className="hq-activity-list" style={{ margin: 0, padding: 0, listStyle: "none" }}>
                  {((certificates.data?.certificates as Array<Record<string, unknown>>) ?? []).map((c) => (
                    <li key={String(c.id)} className="hq-activity-item">
                      <div className="hq-activity-content">
                        <div className="hq-activity-title">{String(c.person_name)}</div>
                        <div className="hq-activity-detail">{String(c.course_title)} · {String(c.certificate_code)} · {String(c.issued_at).slice(0, 10)}</div>
                      </div>
                      <StatusBadge label="issued" variant="success" />
                    </li>
                  ))}
                </ul>
              </HqPanel>
            </div>
          )}

          {tab === "pd-costs" && (
            <div className="hq-fade-in" style={{ display: "grid", gap: "1rem" }}>
              <HqPanel title="Log grant-funded professional development cost" subtitle="Where allowable under award terms">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (pdForm.description && Number(pdForm.amount_cents) > 0) pdMut.mutate();
                  }}
                  style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.5rem" }}
                >
                  <input className="hq-input" placeholder="Description" value={pdForm.description} onChange={(e) => setPdForm({ ...pdForm, description: e.target.value })} />
                  <input className="hq-input" type="number" placeholder="Amount (cents)" value={pdForm.amount_cents} onChange={(e) => setPdForm({ ...pdForm, amount_cents: e.target.value })} />
                  <input className="hq-input" type="date" value={pdForm.incurred_date} onChange={(e) => setPdForm({ ...pdForm, incurred_date: e.target.value })} />
                  <input className="hq-input" placeholder="Grant award ID (optional)" value={pdForm.grant_award_id} onChange={(e) => setPdForm({ ...pdForm, grant_award_id: e.target.value })} />
                  <input className="hq-input" placeholder="Person name" value={pdForm.person_name} onChange={(e) => setPdForm({ ...pdForm, person_name: e.target.value })} />
                  <button type="submit" className="hq-btn hq-btn-primary" disabled={pdMut.isPending}>Log cost</button>
                </form>
              </HqPanel>
              <HqPanel title="PD cost ledger">
                <ul className="hq-activity-list" style={{ margin: 0, padding: 0, listStyle: "none" }}>
                  {((pdCosts.data?.costs as Array<Record<string, unknown>>) ?? []).map((c) => (
                    <li key={String(c.id)} className="hq-activity-item">
                      <div className="hq-activity-content">
                        <div className="hq-activity-title">{String(c.description)}</div>
                        <div className="hq-activity-detail">
                          {String(c.person_name ?? "—")} · {String(c.incurred_date)}
                          {c.grant_award_id ? ` · Award ${String(c.grant_award_id)}` : ""}
                        </div>
                      </div>
                      <strong>${(Number(c.amount_cents) / 100).toFixed(2)}</strong>
                    </li>
                  ))}
                </ul>
              </HqPanel>
            </div>
          )}
        </>
      )}
    </HQLayout>
  );
};

export default LearningDevelopmentPage;
