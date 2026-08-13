/**
 * AURA Module Tools — Phase 4 read/prepare helpers for HR, finance, projects, donations.
 * Wraps existing HQ engines; no Stripe/PayPal mutate; no payroll execute here.
 */
import { getDb } from "../db";
import { listPeopleByType, listJobApplicants } from "./peopleOperationsEngine";
import {
  buildPeopleAnalytics,
  buildFinanceAnalytics,
  buildDonationAnalytics,
} from "./analyticsReporting";
import { listOpsProjects, createOpsProject } from "./executiveOperationsFoundation";
import { createWorkflowInstance } from "./workflowEngine";

function money(cents: number | null | undefined): string {
  return `$${((cents ?? 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function dollars(n: number | null | undefined): string {
  return `$${(n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export async function hrWorkforceSummary() {
  const analytics = await buildPeopleAnalytics();
  const byType = analytics.byType.map((r) => `${r.person_type}: ${r.count}`).join(", ") || "none";
  return {
    summary: `Workforce: ${byType}. Volunteers active=${analytics.volunteerCount}, hours this month=${analytics.volunteerHours}.`,
    data: analytics,
    navigation: { path: "/hq/people", label: "Open People" },
  };
}

export async function hrListPeople(opts: { personType?: string; limit?: number }) {
  const type = opts.personType || "employee";
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  const people = await listPeopleByType(type, limit);
  const names = people
    .slice(0, 8)
    .map((p) => {
      const row = p as { fullName?: string; firstName?: string; lastName?: string };
      return row.fullName || `${row.firstName || ""} ${row.lastName || ""}`.trim();
    })
    .filter(Boolean);
  return {
    summary: `Found ${people.length} ${type.replace(/_/g, " ")}${people.length === 1 ? "" : "s"}${
      names.length ? `: ${names.join(", ")}${people.length > names.length ? "…" : ""}` : ""
    }.`,
    data: { personType: type, count: people.length, people },
    navigation: { path: "/hq/people", label: "Open People" },
  };
}

export async function hrListApplicants(opts: { status?: string; limit?: number }) {
  const rows = await listJobApplicants(opts.status);
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  const sliced = rows.slice(0, limit) as Array<Record<string, unknown>>;
  return {
    summary: `Found ${sliced.length} job applicant${sliced.length === 1 ? "" : "s"}${
      opts.status ? ` with status=${opts.status}` : ""
    }.`,
    data: { count: sliced.length, applicants: sliced },
    navigation: { path: "/hq/people?tab=applicants", label: "Open Applicants" },
  };
}

export async function hrPrepareApplicantReview(opts: {
  applicantId?: string;
  note?: string;
  actorEmail: string;
}) {
  const db = await getDb();
  let applicant: Record<string, unknown> | null = null;
  if (opts.applicantId) {
    applicant = (await db.get("SELECT * FROM job_applicants WHERE id = ?", opts.applicantId)) as
      | Record<string, unknown>
      | null;
  } else {
    applicant = (await db.get(
      `SELECT * FROM job_applicants WHERE status IN ('new','reviewing','interview') ORDER BY applied_at DESC LIMIT 1`
    )) as Record<string, unknown> | null;
  }
  if (!applicant) {
    return {
      status: "error" as const,
      summary: "No applicant found to prepare a review for.",
    };
  }
  const title = `Applicant review: ${applicant.first_name || ""} ${applicant.last_name || ""} — ${
    applicant.position_applied || "position TBD"
  }`.trim();
  const wf = await createWorkflowInstance({
    workflowKey: "employee_onboarding",
    entityType: "job_applicant",
    entityId: String(applicant.id),
    title,
    priority: "normal",
    payload: {
      note: opts.note || "Prepared by AURA for Founder/HR review.",
      applicantStatus: applicant.status,
      email: applicant.email || null,
      preparedBy: opts.actorEmail,
    },
  }).catch(() => null);
  return {
    status: "prepared" as const,
    summary: `Prepared applicant review for ${applicant.first_name || ""} ${applicant.last_name || ""} (${
      applicant.status
    }).${wf ? " Staged in Workflow Automation." : " Open Applicants to continue."}`
      .replace(/\s+/g, " ")
      .trim(),
    data: { applicant, workflow: wf },
    navigation: { path: "/hq/people?tab=applicants", label: "Open Applicants" },
    approval: wf ? { path: "/hq/workflows", label: "Review in Workflow Automation" } : undefined,
  };
}

export async function financeOverview() {
  const analytics = await buildFinanceAnalytics();
  return {
    summary: `Finance overview: donations received=${dollars(analytics.donationsReceived)}, monthly expenses=${dollars(
      analytics.monthlyExpenses
    )}, cash=${dollars(analytics.cashBalance)}, health=${analytics.financialHealthScore}, projected next-month cash flow≈$${
      analytics.projectedNextMonth ?? 0
    }.`,
    data: analytics,
    navigation: { path: "/hq/finance", label: "Open Finance" },
  };
}

export async function financeListPendingExpenses(limit = 25) {
  const db = await getDb();
  const rows = (await db.all(
    `SELECT id, description, amount_cents, expense_date, approval_status, vendor, program_slug, created_at
     FROM finance_expenses
     WHERE lower(COALESCE(approval_status, '')) IN ('pending', 'submitted', 'requested', 'awaiting_approval')
     ORDER BY created_at DESC LIMIT ?`,
    Math.min(Math.max(limit, 1), 100)
  )) as Array<Record<string, unknown>>;
  const total = rows.reduce((s, r) => s + Number(r.amount_cents || 0), 0);
  return {
    summary: `Found ${rows.length} pending expense${rows.length === 1 ? "" : "s"} totaling ${money(total)}.`,
    data: { count: rows.length, totalCents: total, expenses: rows },
    navigation: { path: "/hq/finance", label: "Open Finance" },
  };
}

export async function financePrepareBrief(opts: { actorEmail: string; focus?: string }) {
  const overview = await financeOverview();
  const pending = await financeListPendingExpenses(10);
  const title = `AURA finance brief${opts.focus ? `: ${opts.focus}` : ""}`;
  const wf = await createWorkflowInstance({
    workflowKey: "expense_approval",
    entityType: "finance_brief",
    entityId: `brief-${Date.now()}`,
    title,
    priority: "normal",
    payload: {
      focus: opts.focus || null,
      overviewSummary: overview.summary,
      pendingSummary: pending.summary,
      preparedBy: opts.actorEmail,
      note: "Prepared by AURA — no payments issued.",
    },
  }).catch(() => null);
  return {
    status: "prepared" as const,
    summary: `Prepared finance brief. ${overview.summary} ${pending.summary}${
      wf ? " Staged for workflow review." : ""
    }`,
    data: { overview: overview.data, pending: pending.data, workflow: wf },
    navigation: { path: "/hq/finance", label: "Open Finance" },
    approval: wf ? { path: "/hq/workflows", label: "Review in Workflow Automation" } : undefined,
  };
}

export async function donationSummary() {
  const analytics = await buildDonationAnalytics();
  return {
    summary: `Donations: lifetime≈$${analytics.total.toLocaleString("en-US")}, projected monthly≈$${
      analytics.projectedMonthly
    }. Sources: ${
      analytics.bySource
        .slice(0, 4)
        .map((s) => `${s.source_key}=$${s.total}`)
        .join(", ") || "none"
    }.`,
    data: analytics,
    navigation: { path: "/hq/donations", label: "Open Donations" },
  };
}

export async function listRecentDonations(limit = 25) {
  const db = await getDb();
  const rows = (await db.all(
    `SELECT id, source_key, amount_cents, currency, external_id, created_at, metadata
     FROM funding_events
     WHERE intent = 'donation'
     ORDER BY created_at DESC LIMIT ?`,
    Math.min(Math.max(limit, 1), 100)
  )) as Array<Record<string, unknown>>;
  const total = rows.reduce((s, r) => s + Number(r.amount_cents || 0), 0);
  return {
    summary: `Latest ${rows.length} donation${rows.length === 1 ? "" : "s"} totaling ${money(total)}.`,
    data: { count: rows.length, totalCents: total, donations: rows },
    navigation: { path: "/hq/donations", label: "Open Donations" },
  };
}

export async function projectsList(opts: { status?: string; limit?: number }) {
  const rows = (await listOpsProjects(opts.status)) as Array<Record<string, unknown>>;
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  const sliced = rows.slice(0, limit);
  const active = sliced.filter((p) => ["planning", "active"].includes(String(p.status || ""))).length;
  return {
    summary: `Found ${sliced.length} ops project${sliced.length === 1 ? "" : "s"}${
      opts.status ? ` (status=${opts.status})` : ` (${active} planning/active)`
    }.`,
    data: { count: sliced.length, projects: sliced },
    navigation: { path: "/hq/operations", label: "Open Operations" },
  };
}

export async function projectsPrepareDraft(opts: {
  title: string;
  description?: string;
  priority?: string;
  dueDate?: string;
  actorEmail: string;
}) {
  const title = opts.title.trim();
  if (title.length < 3) {
    return { status: "error" as const, summary: "Need a project title (at least 3 characters) to prepare a draft." };
  }
  const project = await createOpsProject(
    {
      title,
      description: opts.description || "Draft prepared by AURA — awaiting Founder/ops review.",
      status: "planning",
      priority: opts.priority || "normal",
      due_date: opts.dueDate || null,
      progress_pct: 0,
      executive_summary: "AURA prepare_ops_project draft (no production activation).",
    },
    { email: opts.actorEmail }
  );
  return {
    status: "prepared" as const,
    summary: `Prepared ops project draft "${title}" in planning status. Review before activating.`,
    data: { project },
    navigation: { path: "/hq/operations", label: "Open Operations" },
  };
}
