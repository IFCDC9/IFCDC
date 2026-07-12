import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Award,
  Briefcase,
  ClipboardCheck,
  GraduationCap,
  HandHeart,
  HeartPulse,
  LineChart,
  UserPlus,
  Users,
} from "lucide-react";
import { peopleApi } from "../../../api/peopleApi";
import { KpiCard } from "../KpiCard";
import { HqPanel } from "../HqPanel";
import { HqLoading } from "../HqLoading";
import { StatusBadge } from "../StatusBadge";

type WfTab = "dashboard" | "recruitment" | "onboarding" | "volunteers" | "performance" | "training" | "analytics";

const WF_TABS: { id: WfTab; label: string }[] = [
  { id: "dashboard", label: "Workforce Dashboard" },
  { id: "recruitment", label: "Recruitment" },
  { id: "onboarding", label: "Onboarding" },
  { id: "volunteers", label: "Volunteers" },
  { id: "performance", label: "Performance" },
  { id: "training", label: "Training" },
  { id: "analytics", label: "Analytics" },
];

function capacityVariant(score: number): "success" | "warning" | "danger" | "gold" {
  if (score >= 80) return "success";
  if (score >= 65) return "gold";
  if (score >= 45) return "warning";
  return "danger";
}

interface Props {
  onNavigatePeopleTab?: (tab: string) => void;
}

export const WorkforceFoundation: React.FC<Props> = ({ onNavigatePeopleTab }) => {
  const [params, setParams] = useSearchParams();
  const wfParam = params.get("wf") as WfTab | null;
  const [tab, setTab] = useState<WfTab>(wfParam && WF_TABS.some((t) => t.id === wfParam) ? wfParam : "dashboard");
  const [reqTitle, setReqTitle] = useState("");
  const [goalForm, setGoalForm] = useState({ person_id: "", title: "", objective: "" });
  const [hoursForm, setHoursForm] = useState({ person_id: "", hours: "2", service_date: new Date().toISOString().slice(0, 10), program_name: "" });
  const qc = useQueryClient();

  useEffect(() => {
    if (wfParam && WF_TABS.some((t) => t.id === wfParam)) setTab(wfParam);
  }, [wfParam]);

  function selectTab(next: WfTab) {
    setTab(next);
    const nextParams = new URLSearchParams(params);
    nextParams.set("tab", "workforce");
    nextParams.set("wf", next);
    setParams(nextParams, { replace: true });
  }

  const dashboard = useQuery({
    queryKey: ["workforce-foundation-dashboard"],
    queryFn: peopleApi.foundationDashboard,
    staleTime: 45_000,
  });

  const recruitment = useQuery({
    queryKey: ["workforce-foundation-recruitment"],
    queryFn: peopleApi.foundationRecruitment,
    enabled: tab === "recruitment",
  });

  const onboarding = useQuery({
    queryKey: ["workforce-foundation-onboarding"],
    queryFn: peopleApi.foundationOnboarding,
    enabled: tab === "onboarding",
  });

  const volunteers = useQuery({
    queryKey: ["workforce-foundation-volunteers"],
    queryFn: peopleApi.foundationVolunteers,
    enabled: tab === "volunteers",
  });

  const performance = useQuery({
    queryKey: ["workforce-foundation-performance"],
    queryFn: peopleApi.foundationPerformance,
    enabled: tab === "performance",
  });

  const training = useQuery({
    queryKey: ["workforce-foundation-training"],
    queryFn: peopleApi.foundationTraining,
    enabled: tab === "training",
  });

  const analytics = useQuery({
    queryKey: ["workforce-foundation-analytics"],
    queryFn: peopleApi.foundationAnalytics,
    enabled: tab === "analytics",
  });

  const createReq = useMutation({
    mutationFn: () => peopleApi.createRequisition({ title: reqTitle, employment_type: "employee" }),
    onSuccess: () => {
      setReqTitle("");
      void qc.invalidateQueries({ queryKey: ["workforce-foundation-recruitment"] });
      void qc.invalidateQueries({ queryKey: ["workforce-foundation-dashboard"] });
    },
  });

  const createGoal = useMutation({
    mutationFn: () => peopleApi.createGoal(goalForm),
    onSuccess: () => {
      setGoalForm({ person_id: "", title: "", objective: "" });
      void qc.invalidateQueries({ queryKey: ["workforce-foundation-performance"] });
    },
  });

  const logHours = useMutation({
    mutationFn: () =>
      peopleApi.logVolunteerHours({
        person_id: hoursForm.person_id,
        hours: Number(hoursForm.hours),
        service_date: hoursForm.service_date,
        program_name: hoursForm.program_name || undefined,
      }),
    onSuccess: () => {
      setHoursForm((f) => ({ ...f, hours: "2", program_name: "" }));
      void qc.invalidateQueries({ queryKey: ["workforce-foundation-volunteers"] });
      void qc.invalidateQueries({ queryKey: ["workforce-foundation-dashboard"] });
    },
  });

  const kpis = dashboard.data?.kpis ?? {};
  const capacity = dashboard.data?.capacity;
  const links = dashboard.data?.deepLinks ?? {};

  return (
    <div className="hq-fade-in">
      <HqPanel
        title="Enterprise Workforce Management"
        subtitle="Build 62 — employees, volunteers, recruitment, onboarding, performance, training, and analytics"
        action={{ label: "People directory", to: "/hq/people?tab=directory" }}
      >
        <StatusBadge label="BUILD 62" variant="gold" />
        <div className="hq-tabs" role="tablist" style={{ marginTop: "0.75rem" }}>
          {WF_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              className={`hq-tab${tab === t.id ? " active" : ""}`}
              onClick={() => selectTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </HqPanel>

      {tab === "dashboard" && (
        <div style={{ marginTop: "1rem" }}>
          {dashboard.isLoading && <HqLoading message="Loading workforce dashboard…" />}
          {dashboard.data && (
            <>
              <div className="hq-kpi-grid" style={{ marginBottom: "1rem" }}>
                <KpiCard label="Employees" value={kpis.totalEmployees ?? 0} icon={Users} variant="gold" />
                <KpiCard label="Volunteers" value={kpis.volunteers ?? 0} icon={HandHeart} />
                <KpiCard label="Contractors" value={kpis.contractors ?? 0} icon={Briefcase} />
                <KpiCard label="Interns" value={kpis.interns ?? 0} icon={GraduationCap} />
                <KpiCard label="Open Positions" value={kpis.openPositions ?? 0} icon={UserPlus} variant={(kpis.openPositions ?? 0) > 0 ? "warning" : "muted"} />
                <KpiCard label="Active Recruitments" value={kpis.activeRecruitments ?? 0} icon={UserPlus} />
                <KpiCard label="New Hires (90d)" value={kpis.newHires ?? 0} icon={Users} />
                <KpiCard label="Training completion" value={`${kpis.trainingCompletionPct ?? 0}%`} icon={Award} variant={capacityVariant(kpis.trainingCompletionPct ?? 0)} />
                <KpiCard label="Performance reviews" value={kpis.performanceReviews ?? 0} icon={LineChart} />
                <KpiCard label="Clocked in" value={kpis.attendanceClockedIn ?? 0} icon={ClipboardCheck} />
                <KpiCard label="Time-off pending" value={kpis.timeOffRequests ?? 0} icon={ClipboardCheck} variant={(kpis.timeOffRequests ?? 0) > 0 ? "warning" : "muted"} />
                <KpiCard label="Certs expiring" value={kpis.certificationsExpiring ?? 0} icon={Award} variant={(kpis.certificationsExpiring ?? 0) > 0 ? "danger" : "success"} />
                <KpiCard
                  label="Organizational Capacity"
                  value={`${kpis.organizationalCapacity ?? 0}/100`}
                  icon={HeartPulse}
                  variant={capacityVariant(kpis.organizationalCapacity ?? 0)}
                  meta={capacity?.note}
                />
              </div>

              <div className="hq-grid-2">
                <HqPanel title="Integrated HQ surfaces" subtitle="Workforce connected across Headquarters">
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                    {Object.entries(links).map(([key, path]) => (
                      <Link key={key} to={path} className="hq-btn hq-btn-ghost hq-btn-sm">{key}</Link>
                    ))}
                  </div>
                </HqPanel>
                <HqPanel title="Quick actions" subtitle="Jump into People workflows">
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                    <button type="button" className="hq-btn hq-btn-secondary hq-btn-sm" onClick={() => selectTab("recruitment")}>Recruitment Center</button>
                    <button type="button" className="hq-btn hq-btn-secondary hq-btn-sm" onClick={() => selectTab("onboarding")}>Onboarding</button>
                    <button type="button" className="hq-btn hq-btn-secondary hq-btn-sm" onClick={() => onNavigatePeopleTab?.("employees")}>Employee profiles</button>
                    <button type="button" className="hq-btn hq-btn-secondary hq-btn-sm" onClick={() => onNavigatePeopleTab?.("applicants")}>Applicants</button>
                    <button type="button" className="hq-btn hq-btn-secondary hq-btn-sm" onClick={() => selectTab("analytics")}>Workforce analytics</button>
                  </div>
                </HqPanel>
              </div>
            </>
          )}
        </div>
      )}

      {tab === "recruitment" && (
        <div style={{ marginTop: "1rem" }}>
          {recruitment.isLoading && <HqLoading message="Loading recruitment center…" />}
          {recruitment.data && (
            <>
              <div className="hq-kpi-grid" style={{ marginBottom: "1rem" }}>
                {((recruitment.data.pipeline as Array<{ stage: string; label: string; count: number }>) ?? []).map((p) => (
                  <KpiCard key={p.stage} label={p.label} value={p.count} icon={UserPlus} />
                ))}
              </div>
              <HqPanel title="Create job requisition" subtitle="Position openings for hiring workflow">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (reqTitle.trim()) createReq.mutate();
                  }}
                  style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}
                >
                  <input className="hq-input" placeholder="Position title" value={reqTitle} onChange={(e) => setReqTitle(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
                  <button type="submit" className="hq-btn hq-btn-primary" disabled={createReq.isPending || !reqTitle.trim()}>
                    {createReq.isPending ? "Saving…" : "Create requisition"}
                  </button>
                </form>
              </HqPanel>
              <div className="hq-grid-2" style={{ marginTop: "1rem" }}>
                <HqPanel title="Open requisitions" subtitle="Job openings & approvals">
                  <ul className="hq-activity-list" style={{ margin: 0, padding: 0, listStyle: "none" }}>
                    {((recruitment.data.requisitions as Array<Record<string, unknown>>) ?? []).slice(0, 12).map((r) => (
                      <li key={String(r.id)} className="hq-activity-item">
                        <div className="hq-activity-content">
                          <div className="hq-activity-title">{String(r.title)}</div>
                          <div className="hq-activity-detail">{String(r.department_name ?? "—")} · {String(r.employment_type)}</div>
                        </div>
                        <StatusBadge label={String(r.status)} variant={r.status === "open" ? "warning" : "muted"} />
                      </li>
                    ))}
                  </ul>
                </HqPanel>
                <HqPanel title="Candidate pipeline" subtitle="Interview, offers, background, hire" action={{ label: "Applicants tab", to: "/hq/people?tab=applicants" }}>
                  <ul className="hq-activity-list" style={{ margin: 0, padding: 0, listStyle: "none" }}>
                    {((recruitment.data.applicants as Array<Record<string, unknown>>) ?? []).slice(0, 12).map((a) => (
                      <li key={String(a.id)} className="hq-activity-item">
                        <div className="hq-activity-content">
                          <div className="hq-activity-title">{String(a.first_name)} {String(a.last_name)}</div>
                          <div className="hq-activity-detail">{String(a.position_applied ?? "—")} · offer {String(a.offer_status ?? "—")}</div>
                        </div>
                        <StatusBadge label={String(a.status)} variant="gold" />
                      </li>
                    ))}
                  </ul>
                </HqPanel>
              </div>
            </>
          )}
        </div>
      )}

      {tab === "onboarding" && (
        <div style={{ marginTop: "1rem" }}>
          {onboarding.isLoading && <HqLoading message="Loading onboarding center…" />}
          {onboarding.data && (
            <>
              <div className="hq-kpi-grid" style={{ marginBottom: "1rem" }}>
                <KpiCard label="In progress" value={Number((onboarding.data.summary as { inProgress?: number })?.inProgress ?? 0)} icon={ClipboardCheck} variant="warning" />
                <KpiCard label="Complete" value={Number((onboarding.data.summary as { complete?: number })?.complete ?? 0)} icon={ClipboardCheck} variant="success" />
                <KpiCard label="Avg progress" value={`${Number((onboarding.data.summary as { avgProgress?: number })?.avgProgress ?? 0)}%`} icon={HeartPulse} />
              </div>
              <HqPanel title="Onboarding stages" subtitle="Structured welcome → manager approval">
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginBottom: "1rem" }}>
                  {((onboarding.data.stages as string[]) ?? []).map((s) => (
                    <StatusBadge key={s} label={s} variant="muted" />
                  ))}
                </div>
                <ul className="hq-activity-list" style={{ margin: 0, padding: 0, listStyle: "none" }}>
                  {((onboarding.data.people as Array<Record<string, unknown>>) ?? []).slice(0, 20).map((p) => (
                    <li key={String(p.personId)} className="hq-activity-item">
                      <div className="hq-activity-content">
                        <div className="hq-activity-title">{String(p.firstName)} {String(p.lastName)}</div>
                        <div className="hq-activity-detail">
                          {String(p.department ?? "—")} · {Number(p.completedCount)}/{Number(p.totalCount)} tasks
                          {Array.isArray(p.incompleteTasks) && (p.incompleteTasks as string[]).length > 0
                            ? ` · Next: ${(p.incompleteTasks as string[])[0]}`
                            : ""}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                        <StatusBadge label={`${Number(p.progressPct)}%`} variant={capacityVariant(Number(p.progressPct))} />
                        <Link to={`/hq/people?id=${String(p.personId)}`} className="hq-entity-link">Profile →</Link>
                      </div>
                    </li>
                  ))}
                </ul>
              </HqPanel>
            </>
          )}
        </div>
      )}

      {tab === "volunteers" && (
        <div style={{ marginTop: "1rem" }}>
          {volunteers.isLoading && <HqLoading message="Loading volunteer management…" />}
          {volunteers.data && (
            <>
              <div className="hq-kpi-grid" style={{ marginBottom: "1rem" }}>
                <KpiCard label="Active volunteers" value={Number((volunteers.data.summary as { activeVolunteers?: number })?.activeVolunteers ?? 0)} icon={HandHeart} variant="gold" />
                <KpiCard label="Hours logged" value={Number((volunteers.data.summary as { totalHoursLogged?: number })?.totalHoursLogged ?? 0)} icon={ClipboardCheck} />
                <KpiCard label="Recognition awards" value={Number((volunteers.data.summary as { recognitionAwards?: number })?.recognitionAwards ?? 0)} icon={Award} />
              </div>
              <HqPanel title="Log volunteer hours" subtitle="Program service hours">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (hoursForm.person_id && Number(hoursForm.hours) > 0) logHours.mutate();
                  }}
                  style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.5rem" }}
                >
                  <input className="hq-input" placeholder="Volunteer person ID" value={hoursForm.person_id} onChange={(e) => setHoursForm({ ...hoursForm, person_id: e.target.value })} />
                  <input className="hq-input" type="number" step="0.5" placeholder="Hours" value={hoursForm.hours} onChange={(e) => setHoursForm({ ...hoursForm, hours: e.target.value })} />
                  <input className="hq-input" type="date" value={hoursForm.service_date} onChange={(e) => setHoursForm({ ...hoursForm, service_date: e.target.value })} />
                  <input className="hq-input" placeholder="Program" value={hoursForm.program_name} onChange={(e) => setHoursForm({ ...hoursForm, program_name: e.target.value })} />
                  <button type="submit" className="hq-btn hq-btn-primary" disabled={logHours.isPending}>Log hours</button>
                </form>
              </HqPanel>
              <HqPanel title="Volunteer profiles" subtitle="Skills, background, hours, programs, recognition">
                <ul className="hq-activity-list" style={{ margin: 0, padding: 0, listStyle: "none" }}>
                  {((volunteers.data.profiles as Array<Record<string, unknown>>) ?? []).slice(0, 20).map((v) => (
                    <li key={String(v.id)} className="hq-activity-item">
                      <div className="hq-activity-content">
                        <div className="hq-activity-title">{String(v.name)}</div>
                        <div className="hq-activity-detail">
                          {Number(v.hoursYtd)} hrs YTD · {(v.assignedPrograms as unknown[] | undefined)?.length ?? 0} programs · {(v.backgroundChecks as unknown[] | undefined)?.length ?? 0} background checks
                        </div>
                      </div>
                      <Link to={`/hq/people?id=${String(v.id)}`} className="hq-entity-link">Open →</Link>
                    </li>
                  ))}
                </ul>
              </HqPanel>
            </>
          )}
        </div>
      )}

      {tab === "performance" && (
        <div style={{ marginTop: "1rem" }}>
          {performance.isLoading && <HqLoading message="Loading performance management…" />}
          {performance.data && (
            <>
              <div className="hq-kpi-grid" style={{ marginBottom: "1rem" }}>
                <KpiCard label="Reviews (12mo)" value={Number((performance.data.summary as { reviewsLastYear?: number })?.reviewsLastYear ?? 0)} icon={LineChart} />
                <KpiCard label="Active goals" value={Number((performance.data.summary as { activeGoals?: number })?.activeGoals ?? 0)} icon={ClipboardCheck} variant="gold" />
                <KpiCard label="Recognition signals" value={Number((performance.data.summary as { recognitionNotes?: number })?.recognitionNotes ?? 0)} icon={Award} />
              </div>
              <HqPanel title="Add goal / objective">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (goalForm.person_id && goalForm.title) createGoal.mutate();
                  }}
                  style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "0.5rem" }}
                >
                  <input className="hq-input" placeholder="Person ID" value={goalForm.person_id} onChange={(e) => setGoalForm({ ...goalForm, person_id: e.target.value })} />
                  <input className="hq-input" placeholder="Goal title" value={goalForm.title} onChange={(e) => setGoalForm({ ...goalForm, title: e.target.value })} />
                  <input className="hq-input" placeholder="Objective" value={goalForm.objective} onChange={(e) => setGoalForm({ ...goalForm, objective: e.target.value })} />
                  <button type="submit" className="hq-btn hq-btn-primary" disabled={createGoal.isPending}>Add goal</button>
                </form>
              </HqPanel>
              <div className="hq-grid-2" style={{ marginTop: "1rem" }}>
                <HqPanel title="Goals & objectives">
                  <ul className="hq-activity-list" style={{ margin: 0, padding: 0, listStyle: "none" }}>
                    {((performance.data.goals as Array<Record<string, unknown>>) ?? []).slice(0, 15).map((g) => (
                      <li key={String(g.id)} className="hq-activity-item">
                        <div className="hq-activity-content">
                          <div className="hq-activity-title">{String(g.title)}</div>
                          <div className="hq-activity-detail">{String(g.first_name)} {String(g.last_name)} · {Number(g.progress_pct)}%</div>
                        </div>
                        <StatusBadge label={String(g.status)} variant={g.status === "active" ? "gold" : "muted"} />
                      </li>
                    ))}
                  </ul>
                </HqPanel>
                <HqPanel title="Recent reviews" action={{ label: "Performance tab", to: "/hq/people?tab=performance" }}>
                  <ul className="hq-activity-list" style={{ margin: 0, padding: 0, listStyle: "none" }}>
                    {((performance.data.reviews as Array<Record<string, unknown>>) ?? []).slice(0, 15).map((r) => (
                      <li key={String(r.id)} className="hq-activity-item">
                        <div className="hq-activity-content">
                          <div className="hq-activity-title">{String(r.first_name)} {String(r.last_name)}</div>
                          <div className="hq-activity-detail">{String(r.rating)} · {String(r.review_date)}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </HqPanel>
              </div>
            </>
          )}
        </div>
      )}

      {tab === "training" && (
        <div style={{ marginTop: "1rem" }}>
          {training.isLoading && <HqLoading message="Loading training center…" />}
          {training.data && (
            <>
              <div className="hq-kpi-grid" style={{ marginBottom: "1rem" }}>
                <KpiCard label="Required open" value={Number((training.data.summary as { requiredOpen?: number })?.requiredOpen ?? 0)} icon={GraduationCap} variant="warning" />
                <KpiCard label="Certifications" value={Number((training.data.summary as { certifications?: number })?.certifications ?? 0)} icon={Award} />
                <KpiCard label="Expiring soon" value={Number((training.data.summary as { expiringSoon?: number })?.expiringSoon ?? 0)} icon={Award} variant="danger" />
                <KpiCard label="Completed" value={Number((training.data.summary as { completedTotal?: number })?.completedTotal ?? 0)} icon={ClipboardCheck} variant="success" />
              </div>
              <HqPanel title="Catalog focus" subtitle="Compliance, safety, AI & cybersecurity awareness">
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginBottom: "1rem" }}>
                  {((training.data.catalogHints as string[]) ?? []).map((h) => (
                    <StatusBadge key={h} label={h} variant="muted" />
                  ))}
                </div>
                <ul className="hq-activity-list" style={{ margin: 0, padding: 0, listStyle: "none" }}>
                  {((training.data.requiredTraining as Array<Record<string, unknown>>) ?? []).slice(0, 15).map((t) => (
                    <li key={String(t.id)} className="hq-activity-item">
                      <div className="hq-activity-content">
                        <div className="hq-activity-title">{String(t.title)}</div>
                        <div className="hq-activity-detail">{String(t.first_name)} {String(t.last_name)} · {String(t.status)}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              </HqPanel>
            </>
          )}
        </div>
      )}

      {tab === "analytics" && (
        <div style={{ marginTop: "1rem" }}>
          {analytics.isLoading && <HqLoading message="Loading workforce analytics…" />}
          {analytics.data && (
            <div className="hq-grid-2">
              <HqPanel title="Executive workforce analytics" subtitle="Staffing, vacancy, retention, capacity">
                <pre className="hq-code-block" style={{ maxHeight: 420, overflow: "auto" }}>
                  {JSON.stringify(
                    {
                      staffingLevels: analytics.data.staffingLevels,
                      vacancyRates: analytics.data.vacancyRates,
                      retention: analytics.data.retention,
                      turnover: analytics.data.turnover,
                      volunteerEngagement: analytics.data.volunteerEngagement,
                      trainingCompletion: analytics.data.trainingCompletion,
                      organizationalCapacity: analytics.data.organizationalCapacity,
                    },
                    null,
                    2
                  )}
                </pre>
              </HqPanel>
              <HqPanel title="Hiring & capacity" subtitle="Pipeline and org capacity">
                <pre className="hq-code-block" style={{ maxHeight: 420, overflow: "auto" }}>
                  {JSON.stringify(
                    {
                      hiringPipeline: analytics.data.hiringPipeline,
                      organizationalCapacity: analytics.data.organizationalCapacity,
                      policyReviewsDue: analytics.data.policyReviewsDue,
                    },
                    null,
                    2
                  )}
                </pre>
              </HqPanel>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
