/**
 * AURA Enterprise OS 4.0 — Enterprise Operating System for IFCDC Headquarters.
 *
 * Central coordination layer across departments, workflows, and processes.
 * AURA may: monitor, prepare, explain, route, coordinate, draft.
 * AURA may NOT without Founder approval: submit grants, payments, external comms,
 * hire/terminate, delete production data, deploy, modify security, irreversible changes.
 */
import crypto from "crypto";
import { getDb } from "../db";
import { logHqAudit } from "./hqAuditLog";
import { BRAIN_VERSION } from "./auraExecutiveDecisionIntelligence";

export const OS_VERSION = "4.0" as const;

export type OsPreparedAction = {
  id: string;
  title: string;
  explanation: string;
  monitorDomain:
    | "grants"
    | "production"
    | "compliance"
    | "budget"
    | "staffing"
    | "deployments"
    | "integrations"
    | "orchestration"
    | "other";
  severity: "critical" | "high" | "medium" | "info";
  preparedWork: string[];
  founderApprovalRequired: boolean;
  suggestedPath: string;
  evidence: string[];
};

export type KnowledgeGraphNode = {
  id: string;
  type:
    | "program"
    | "project"
    | "grant"
    | "department"
    | "budget"
    | "employee"
    | "document"
    | "partner"
    | "funding_source"
    | "policy"
    | "compliance"
    | "software";
  label: string;
  meta?: string;
};

export type KnowledgeGraphEdge = {
  id: string;
  from: string;
  to: string;
  relation: string;
  evidence: string;
};

export type KnowledgeGraph = {
  generatedAt: string;
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
  gaps: string[];
};

export type OrchestrationPlan = {
  id: string;
  trigger: string;
  generatedAt: string;
  steps: Array<{
    id: string;
    department: string;
    title: string;
    detail: string;
    status: "prepared" | "awaiting_founder" | "blocked";
    founderApprovalRequired: boolean;
  }>;
  executiveSummary: string;
  founderApprovalRequired: boolean;
};

export type ExecutiveAutomationPackage = {
  kind: "weekly_executive" | "monthly_board" | "compliance_calendar" | "grant_status" | "financial_summary" | "technology_report";
  title: string;
  content: string;
  speechSummary: string;
  externalDistributionRequiresFounderApproval: true;
  systemsUsed: string[];
  assumptions: string[];
  missingInformation: string[];
};

export type EnterpriseOsMissionControl = {
  osVersion: typeof OS_VERSION;
  brainVersion: typeof BRAIN_VERSION;
  generatedAt: string;
  organizationHealth: number | null;
  enterpriseHealthScore: number | null;
  enterpriseGrade: string | null;
  fundingPipeline: { pipelineValue: number | null; activeAwards: number | null };
  financialHealth: { cashFlow: number | null; financialHealthScore: number | null; budgetRemaining: number | null };
  grantStatus: string;
  hrStatus: string;
  operations: string;
  softwareHealth: { score: number | null; label: string | null; deployAligned: boolean | null };
  security: string;
  compliance: { overdue: number; dueNext14Days: number };
  activeRisks: Array<{ id: string; title: string; confidence: string }>;
  opportunities: Array<{ id: string; title: string }>;
  founderPriorities: string[];
  liveAlerts: OsPreparedAction[];
  preparedActions: OsPreparedAction[];
  pendingApprovals: number;
  gaps: string[];
};

export type EnterpriseSearchAnswer = {
  question: string;
  generatedAt: string;
  answer: string;
  results: Array<{ type: string; id: string; title: string; subtitle: string; path: string }>;
  graphHints: string[];
  systemsUsed: string[];
  missingInformation: string[];
  assumptions: string[];
  founderApprovalRequired: boolean;
};

const FOUNDER_MAY = [
  "Monitor",
  "Prepare",
  "Explain",
  "Route",
  "Coordinate",
  "Draft",
  "Simulate",
  "Organize",
] as const;

const FOUNDER_MUST_APPROVE = [
  "Submit grants",
  "Approve payments",
  "Send external communications",
  "Hire or terminate employees",
  "Delete production data",
  "Deploy production code",
  "Modify security settings",
  "Make irreversible changes",
] as const;

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

function truncate(s: string, n = 280): string {
  const t = (s || "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

export function wantsEnterpriseOs(message: string): boolean {
  const m = message.trim();
  if (!m) return false;
  return (
    /\benterprise os\b|\baura os\b|\boperating system\b|\bmission control\b/i.test(m)
    || /\b(autonomous workflow|orchestrat|knowledge graph|enterprise search)\b/i.test(m)
    || /\bshow every document related\b|\bwhich programs depend\b|\bwhich budgets support\b/i.test(m)
    || /\bwhat approvals are still outstanding\b/i.test(m)
    || /\b(monthly board packet|compliance calendar|grant status update|technology report)\b/i.test(m)
    || /\bexpand to another county\b/i.test(m)
  );
}

/** Continuous monitors → prepared work packages (never auto-execute high-impact). */
export async function runAutonomousWorkflowScan(): Promise<OsPreparedAction[]> {
  const actions: OsPreparedAction[] = [];
  const [
    org,
    predictions,
    compliance,
    tech,
    approvals,
    proactive,
  ] = await Promise.all([
    import("./auraEnterpriseBrain").then((m) => m.buildDigitalOrganizationModel()).catch(() => null),
    import("./auraEnterpriseBrain").then((m) => m.buildPredictiveIntelligenceSignals()).catch(() => []),
    import("./auraExecutiveOps").then((m) => m.trackComplianceDeadlines()).catch(() => ({ overdue: 0, dueNext14Days: 0 })),
    import("./auraTechnicalCommandEngine").then((m) => m.buildTechnicalCommandBriefing()).catch(() => null),
    import("./enterpriseApprovals").then((m) => m.buildApprovalQueue(20)).catch(() => ({ tasks: [], counts: {} })),
    import("./auraProactiveIntelligence")
      .then((m) => m.collectProactiveAlertCandidates())
      .catch(() => [] as unknown[]),
  ]);

  const overdue = (compliance as { overdue: number }).overdue;
  const due14 = (compliance as { dueNext14Days: number }).dueNext14Days;

  if (overdue > 0) {
    actions.push({
      id: "wf-compliance-overdue",
      title: "Compliance deadlines overdue",
      explanation: `${overdue} compliance item(s) are past due and can block funding and expansion.`,
      monitorDomain: "compliance",
      severity: "critical",
      preparedWork: [
        "Compile overdue compliance checklist",
        "Draft Founder briefing with owners and due dates",
        "Stage remediation tasks — do not file externally without approval",
      ],
      founderApprovalRequired: true,
      suggestedPath: "/hq/compliance",
      evidence: [`Overdue: ${overdue}`, `Due within 14 days: ${due14}`],
    });
  } else if (due14 > 0) {
    actions.push({
      id: "wf-compliance-soon",
      title: "Compliance deadlines within 14 days",
      explanation: "Clustered deadlines create operational bottleneck risk.",
      monitorDomain: "compliance",
      severity: "medium",
      preparedWork: ["Build 14-day compliance calendar", "Assign owners for each item (draft only)"],
      founderApprovalRequired: false,
      suggestedPath: "/hq/compliance",
      evidence: [`Due within 14 days: ${due14}`],
    });
  }

  if (tech?.deployAligned === false) {
    actions.push({
      id: "wf-deploy-drift",
      title: "Production deployment drift",
      explanation: "Render is not aligned with GitHub main — production may miss fixes.",
      monitorDomain: "deployments",
      severity: "high",
      preparedWork: [
        "Prepare Technical Command diff summary",
        "Open repair tickets if critical failures exist",
        "Stage Manual Deploy checklist — Founder approval required before deploy",
      ],
      founderApprovalRequired: true,
      suggestedPath: "/hq/aura",
      evidence: [`Live commit: ${tech.liveCommit || "unknown"}`, `Score: ${tech.overallScore}/100`],
    });
  }

  if (tech && tech.overallScore < 70) {
    actions.push({
      id: "wf-prod-health",
      title: "Production / integration health degraded",
      explanation: "Technical Command score is below executive standard.",
      monitorDomain: "production",
      severity: "high",
      preparedWork: ["Run Technical Command briefing", "Prioritize critical findings", "Prepare Founder repair queue"],
      founderApprovalRequired: false,
      suggestedPath: "/hq/software",
      evidence: [`Tech score ${tech.overallScore}/100 (${tech.overallLabel})`],
    });
  }

  if (org && org.financial.cashFlow != null && org.financial.cashFlow < 0) {
    actions.push({
      id: "wf-budget-pressure",
      title: "Budget / cash-flow pressure",
      explanation: "Negative cash-flow signal requires executive attention before expansion commitments.",
      monitorDomain: "budget",
      severity: "high",
      preparedWork: ["Prepare 90-day cash forecast request", "Flag non-essential spend for Founder review"],
      founderApprovalRequired: true,
      suggestedPath: "/hq/finance",
      evidence: [`Cash flow: ${org.financial.cashFlow}`, `Budget remaining: ${org.financial.budgetRemaining ?? "n/a"}`],
    });
  }

  if (org && (org.grants.pipelineValue ?? 0) === 0) {
    actions.push({
      id: "wf-grant-pipeline",
      title: "Thin or unavailable funding pipeline",
      explanation: "Grant pipeline monitoring indicates low or missing pipeline value.",
      monitorDomain: "grants",
      severity: "medium",
      preparedWork: ["Run enterprise funding scan", "Prepare opportunity shortlist for Founder", "Do not submit applications without approval"],
      founderApprovalRequired: true,
      suggestedPath: "/hq/grants",
      evidence: [`Pipeline value: ${org.grants.pipelineValue ?? "unavailable"}`],
    });
  }

  const pending = (approvals as { counts?: { total?: number }; tasks?: unknown[] }).counts?.total
    ?? (approvals as { tasks?: unknown[] }).tasks?.length
    ?? 0;
  if (pending >= 3) {
    actions.push({
      id: "wf-approvals",
      title: "Founder approval backlog",
      explanation: `${pending} approval task(s) are outstanding across workflows.`,
      monitorDomain: "other",
      severity: "medium",
      preparedWork: ["Sort queue by financial/compliance severity", "Prepare one-page Founder decision brief"],
      founderApprovalRequired: false,
      suggestedPath: "/hq/workflows",
      evidence: [`Pending approvals: ${pending}`],
    });
  }

  for (const p of (predictions || []).slice(0, 4)) {
    actions.push({
      id: `wf-pred-${p.id}`,
      title: p.title,
      explanation: p.whyItMatters,
      monitorDomain:
        p.category === "grants"
          ? "grants"
          : p.category === "budget"
            ? "budget"
            : p.category === "compliance"
              ? "compliance"
              : p.category === "staffing"
                ? "staffing"
                : p.category === "deployment"
                  ? "deployments"
                  : p.category === "infrastructure"
                    ? "integrations"
                    : "other",
      severity: p.confidence === "high" ? "high" : "medium",
      preparedWork: [p.recommendedAction, "Explain evidence to Founder", "Stage execution only after approval if required"],
      founderApprovalRequired: p.founderApprovalRequired,
      suggestedPath: "/hq/executive-brain",
      evidence: p.evidence.slice(0, 3),
    });
  }

  // Soft signal from proactive candidates
  if (Array.isArray(proactive) && proactive.length > 0) {
    actions.push({
      id: "wf-proactive",
      title: "Proactive intelligence candidates",
      explanation: `${proactive.length} meaningful alert candidate(s) detected for Founder attention.`,
      monitorDomain: "other",
      severity: "info",
      preparedWork: ["Review proactive alert candidates", "Emit only meaningful Founder notifications"],
      founderApprovalRequired: false,
      suggestedPath: "/hq/executive-brain",
      evidence: [`Candidates: ${proactive.length}`],
    });
  }

  return actions.slice(0, 16);
}

/** Grant opportunity → interconnected department work plan (prepared only). */
export async function orchestrateGrantOpportunityWorkflow(opts: {
  opportunityTitle?: string;
  request?: string;
}): Promise<OrchestrationPlan> {
  const title = opts.opportunityTitle || "Priority grant opportunity";
  const [org, goals] = await Promise.all([
    import("./auraEnterpriseBrain").then((m) => m.buildDigitalOrganizationModel()).catch(() => null),
    import("./strategicGoalsEngine").then((m) => m.listStrategicGoals()).catch(() => null),
  ]);

  const steps: OrchestrationPlan["steps"] = [
    {
      id: "budget-review",
      department: "Finance",
      title: "Budget review",
      detail: `Assess match requirements and cash impact. Current cash signal: ${org?.financial.cashFlow ?? "unavailable"}.`,
      status: "prepared",
      founderApprovalRequired: true,
    },
    {
      id: "staffing-review",
      department: "HR",
      title: "Staffing review",
      detail: `Check capacity for delivery. Employees: ${org?.people.employees ?? "unavailable"}.`,
      status: "prepared",
      founderApprovalRequired: true,
    },
    {
      id: "document-checklist",
      department: "Grants / Documents",
      title: "Document checklist",
      detail: "Assemble required attachments from Document Center and Knowledge Base (draft packet only).",
      status: "prepared",
      founderApprovalRequired: false,
    },
    {
      id: "executive-summary",
      department: "Executive",
      title: "Executive summary",
      detail: "Prepare Founder one-pager: fit, risks, alternatives, confidence.",
      status: "awaiting_founder",
      founderApprovalRequired: true,
    },
    {
      id: "calendar-deadlines",
      department: "Operations",
      title: "Calendar deadlines",
      detail: "Stage submission and compliance milestones on Organization Calendar (no external send).",
      status: "prepared",
      founderApprovalRequired: false,
    },
    {
      id: "approval-workflow",
      department: "Workflows",
      title: "Approval workflow",
      detail: "Open grant submission workflow instance and route to Founder approval gate before any submit.",
      status: "awaiting_founder",
      founderApprovalRequired: true,
    },
  ];

  const goalHint = goals?.goals.find((g) => g.category === "funding");
  return {
    id: crypto.randomUUID(),
    trigger: opts.request || `Grant opportunity: ${title}`,
    generatedAt: new Date().toISOString(),
    steps,
    executiveSummary: [
      `Enterprise OS 4.0 orchestrated a cross-department plan for "${title}".`,
      goalHint ? `Aligns to funding goal: ${goalHint.title} (${goalHint.progressPercent}%).` : "Funding goal alignment pending live goals refresh.",
      "No grant will be submitted without explicit Founder approval.",
    ].join(" "),
    founderApprovalRequired: true,
  };
}

/** Live knowledge graph from HQ entities (facts only; gaps labeled). */
export async function buildExecutiveKnowledgeGraph(): Promise<KnowledgeGraph> {
  const gaps: string[] = [];
  const nodes: KnowledgeGraphNode[] = [];
  const edges: KnowledgeGraphEdge[] = [];

  const [org, grants, overview, goals, tech] = await Promise.all([
    import("./auraEnterpriseBrain").then((m) => m.buildDigitalOrganizationModel()).catch(() => null),
    import("./grantReporting").then((m) => m.buildGrantExecutiveDashboard()).catch(() => null),
    import("./analyticsReporting").then((m) => m.buildSafeAnalyticsOverview()).catch(() => null),
    import("./strategicGoalsEngine").then((m) => m.listStrategicGoals()).catch(() => null),
    import("./auraTechnicalCommandEngine").then((m) => m.buildTechnicalCommandBriefing()).catch(() => null),
  ]);

  const add = (n: KnowledgeGraphNode) => {
    if (!nodes.find((x) => x.id === n.id)) nodes.push(n);
  };
  const link = (from: string, to: string, relation: string, evidence: string) => {
    edges.push({ id: crypto.randomUUID(), from, to, relation, evidence });
  };

  add({ id: "dept-grants", type: "department", label: "Grants" });
  add({ id: "dept-finance", type: "department", label: "Finance" });
  add({ id: "dept-hr", type: "department", label: "HR" });
  add({ id: "dept-ops", type: "department", label: "Operations" });
  add({ id: "dept-software", type: "department", label: "Software Division" });
  add({ id: "dept-compliance", type: "department", label: "Compliance" });

  if (overview?.programs?.programsRunning != null) {
    add({
      id: "programs-active",
      type: "program",
      label: `${overview.programs.programsRunning} active programs`,
      meta: `participants ${overview.programs.participants ?? "n/a"}`,
    });
    link("programs-active", "dept-ops", "operated_by", "Analytics overview programsRunning");
  } else gaps.push("Program inventory incomplete in analytics overview");

  if (grants) {
    add({
      id: "grants-pipeline",
      type: "grant",
      label: "Funding pipeline",
      meta: `value ${grants.pipelineValue ?? "n/a"}; awards ${grants.activeAwards ?? "n/a"}`,
    });
    add({
      id: "funding-sources",
      type: "funding_source",
      label: "Active awards / funders",
      meta: `activeAwards ${grants.activeAwards ?? "n/a"}`,
    });
    link("grants-pipeline", "dept-grants", "managed_by", "Grant executive dashboard");
    link("funding-sources", "grants-pipeline", "feeds", "Active awards contribute to pipeline health");
    link("grants-pipeline", "dept-finance", "impacts_budget", "Grant awards affect cash and budget lines");
  } else gaps.push("Grant dashboard unavailable");

  if (org) {
    add({
      id: "budget-org",
      type: "budget",
      label: "Organization budget position",
      meta: `remaining ${org.financial.budgetRemaining ?? "n/a"}; health ${org.financial.financialHealthScore ?? "n/a"}`,
    });
    link("budget-org", "dept-finance", "owned_by", "Finance dashboard");
    link("budget-org", "programs-active", "supports", "Budget capacity enables program delivery");
    if (org.people.employees != null) {
      add({ id: "employees", type: "employee", label: `${org.people.employees} employees`, meta: `volunteers ${org.people.volunteers ?? "n/a"}` });
      link("employees", "dept-hr", "managed_by", "People analytics");
      link("employees", "programs-active", "staffs", "Staffing capacity for programs");
    }
    if (org.compliance.overdue >= 0) {
      add({
        id: "compliance-items",
        type: "compliance",
        label: "Compliance obligations",
        meta: `overdue ${org.compliance.overdue}; due14 ${org.compliance.dueNext14Days}`,
      });
      link("compliance-items", "dept-compliance", "tracked_by", "Compliance deadline tracker");
      link("compliance-items", "grants-pipeline", "constrains", "Overdue compliance can block submissions");
    }
  }

  if (tech) {
    add({
      id: "software-hq",
      type: "software",
      label: "IFCDC HQ / Software Division",
      meta: `score ${tech.overallScore}/100; aligned ${tech.deployAligned}`,
    });
    link("software-hq", "dept-software", "operated_by", "Technical Command");
  } else gaps.push("Technical Command unavailable for software node");

  for (const g of (goals?.goals || []).slice(0, 8)) {
    const id = `goal-${g.id}`;
    add({
      id,
      type: g.category === "software_division" || g.category === "technology" ? "software" : "policy",
      label: g.title,
      meta: `${g.progressPercent}% · ${g.department}`,
    });
    const deptId =
      g.category === "funding" || g.category === "financial"
        ? g.category === "funding"
          ? "dept-grants"
          : "dept-finance"
        : g.category === "hr"
          ? "dept-hr"
          : g.category === "software_division" || g.category === "technology"
            ? "dept-software"
            : "dept-ops";
    link(id, deptId, "owned_by_goal", "Strategic Goals Center");
  }

  add({ id: "docs-vault", type: "document", label: "Document Center / Knowledge Base", meta: "approved institutional records" });
  link("docs-vault", "grants-pipeline", "evidences", "Grant packets and policies stored in documents/KB");
  link("docs-vault", "compliance-items", "supports", "Policies and filings referenced for compliance");

  return { generatedAt: new Date().toISOString(), nodes, edges, gaps };
}

/** Enterprise search answering Founder relationship questions from live data. */
export async function runEnterpriseOsSearch(question: string): Promise<EnterpriseSearchAnswer> {
  const systemsUsed = ["enterprise_global_search", "knowledge_base", "organizational_memory", "knowledge_graph", "approvals"];
  const missingInformation: string[] = [];
  const assumptions: string[] = [];
  const graphHints: string[] = [];

  const [search, memory, graph, approvals, kb] = await Promise.all([
    import("./enterpriseHub").then((m) => m.enterpriseGlobalSearch(question)).catch(() => []),
    import("./auraOrganizationalMemory").then((m) => m.retrieveOrganizationalMemory(question, { topK: 8 })).catch(() => null),
    buildExecutiveKnowledgeGraph(),
    import("./enterpriseApprovals").then((m) => m.buildApprovalQueue(30)).catch(() => ({ tasks: [], counts: {} })),
    import("./knowledgeBaseEngine")
      .then((m) => m.retrieveKnowledge(question, { topK: 6 }))
      .catch(() => [] as Array<{ documentId?: string; title?: string; content?: string; id?: string }>),
  ]);

  const results = [
    ...(search || []).slice(0, 12).map((r) => ({
      type: r.type,
      id: r.id,
      title: r.title,
      subtitle: r.subtitle,
      path: r.path,
    })),
  ];

  if (Array.isArray(kb)) {
    for (const r of kb.slice(0, 6)) {
      results.push({
        type: "document",
        id: (r as { documentId?: string; id?: string }).documentId || (r as { id?: string }).id || crypto.randomUUID(),
        title: (r as { title?: string }).title || "Knowledge document",
        subtitle: String((r as { content?: string }).content || "").slice(0, 120),
        path: "/hq/knowledge",
      });
    }
  }

  // Graph relationship hints
  const q = question.toLowerCase();
  if (/depend|funding|budget|program|grant|approval/i.test(q)) {
    for (const e of graph.edges.slice(0, 8)) {
      const from = graph.nodes.find((n) => n.id === e.from);
      const to = graph.nodes.find((n) => n.id === e.to);
      if (from && to) graphHints.push(`${from.label} —[${e.relation}]→ ${to.label} (${e.evidence})`);
    }
  }
  missingInformation.push(...(graph.gaps || []).slice(0, 3));
  if (memory?.gaps?.length) missingInformation.push(...memory.gaps.slice(0, 3));

  let answer = "";
  if (/\bapprovals? (are )?(still )?outstanding|outstanding approvals\b/i.test(question)) {
    const tasks = (approvals as { tasks: Array<{ title?: string; module?: string }> }).tasks || [];
    const count = (approvals as { counts?: { total?: number } }).counts?.total ?? tasks.length;
    answer = `There are ${count} outstanding approval task(s). Top items: ${
      tasks.slice(0, 5).map((t) => t.title || "approval").join("; ") || "none listed"
    }. Founder Mode can clear the queue in Workflows.`;
    systemsUsed.push("enterprise_approvals");
  } else if (/\bdocument.+grant|grant.+document\b/i.test(question)) {
    answer = `Found ${results.filter((r) => r.type === "document" || r.path.includes("grant")).length} related document/search hits for this grant context. Prefer approved Knowledge Base and Document Center records.`;
    assumptions.push("Exact grant ID may be ambiguous if not named — results are relevance-ranked.");
  } else if (/\bprograms? depend|depend .+funding\b/i.test(question)) {
    answer = graphHints[0]
      ? `From the live knowledge graph: ${graphHints.slice(0, 3).join(" · ")}`
      : "Program–funding dependencies are partially modeled; grant and program modules should be linked with explicit award IDs for precision.";
    if (!graphHints.length) missingInformation.push("Explicit program↔award edges not fully populated in HQ");
  } else if (/\bbudgets? support|support this project\b/i.test(question)) {
    answer = `Budget node linked to Finance and programs where available. ${
      graph.nodes.find((n) => n.type === "budget")?.meta || "Budget meta unavailable"
    }.`;
  } else {
    const facts = memory?.facts?.slice(0, 4).map((f) => f.statement) || [];
    answer = [
      facts.length ? `Verified memory: ${facts.join(" | ")}` : "No strong org-memory facts for this query.",
      results.length ? `Search returned ${results.length} live hits.` : "No global search hits.",
      graphHints[0] ? `Graph: ${graphHints[0]}` : "",
    ]
      .filter(Boolean)
      .join(" ");
  }

  return {
    question,
    generatedAt: new Date().toISOString(),
    answer,
    results: results.slice(0, 20),
    graphHints: graphHints.slice(0, 10),
    systemsUsed: Array.from(new Set(systemsUsed)),
    missingInformation: Array.from(new Set(missingInformation)).slice(0, 8),
    assumptions,
    founderApprovalRequired: false,
  };
}

export async function buildExecutiveAutomationPackage(
  kind: ExecutiveAutomationPackage["kind"]
): Promise<ExecutiveAutomationPackage> {
  const systemsUsed = ["enterprise_os", "enterprise_brain", "edi"];
  const assumptions: string[] = [];
  const missingInformation: string[] = [];

  if (kind === "weekly_executive") {
    const weekly = await import("./auraExecutiveDecisionIntelligence").then((m) => m.buildWeeklyExecutiveReview());
    return {
      kind,
      title: `Weekly Executive Report — ${weekly.periodLabel}`,
      content: weekly.content,
      speechSummary: weekly.speechSummary,
      externalDistributionRequiresFounderApproval: true,
      systemsUsed: [...systemsUsed, "weekly_review"],
      assumptions: ["Internal draft only until Founder approves external distribution"],
      missingInformation: [],
    };
  }

  if (kind === "monthly_board") {
    const [dash, weekly] = await Promise.all([
      import("./auraExecutiveDecisionIntelligence").then((m) => m.buildEnterpriseBrainDashboard()),
      import("./auraExecutiveDecisionIntelligence").then((m) => m.buildWeeklyExecutiveReview()),
    ]);
    const content = [
      `# Monthly Board Packet (DRAFT) — Enterprise OS 4.0`,
      `Generated: ${new Date().toISOString()}`,
      "",
      "## Enterprise Health",
      `Score: ${dash.enterpriseHealthScore ?? "n/a"} (${dash.enterpriseGrade})`,
      "",
      "## Financial Position",
      `Cash: ${dash.financialPosition.cashFlow ?? "n/a"}; Health: ${dash.financialPosition.financialHealthScore ?? "n/a"}`,
      "",
      "## Funding Pipeline",
      `Pipeline: ${dash.fundingPipeline.pipelineValue ?? "n/a"}; Awards: ${dash.fundingPipeline.activeAwards ?? "n/a"}`,
      "",
      "## Strategic Goals",
      ...dash.strategicGoals.slice(0, 10).map((g) => `- ${g.title}: ${g.progressPercent}% (${g.status})`),
      "",
      "## Risks & Opportunities",
      ...dash.activeRisks.slice(0, 5).map((r) => `- Risk: ${r.title}`),
      ...dash.opportunities.slice(0, 5).map((o) => `- Opportunity: ${o.title}`),
      "",
      "## Weekly Highlights",
      weekly.executiveSummary,
      "",
      "_DRAFT — Founder approval required before board distribution._",
    ].join("\n");
    assumptions.push("Board packet is a draft composed from live HQ modules; narrative polish may still be needed.");
    return {
      kind,
      title: "Monthly Board Packet (Draft)",
      content,
      speechSummary: "Monthly board packet draft prepared. Founder approval required before distribution.",
      externalDistributionRequiresFounderApproval: true,
      systemsUsed: [...systemsUsed, "board_packet"],
      assumptions,
      missingInformation,
    };
  }

  if (kind === "compliance_calendar") {
    const compliance = await import("./auraExecutiveOps").then((m) => m.trackComplianceDeadlines()).catch(() => ({
      overdue: 0,
      dueNext14Days: 0,
      deadlines: [] as Array<{ title?: string; dueDate?: string }>,
    }));
    const list = ((compliance as { deadlines?: Array<{ title?: string; dueDate?: string }> }).deadlines || [])
      .slice(0, 20)
      .map((d) => `- ${d.title || "Item"} — due ${d.dueDate || "n/a"}`);
    return {
      kind,
      title: "Compliance Calendar",
      content: [
        `# Compliance Calendar`,
        `Overdue: ${(compliance as { overdue: number }).overdue}; Due 14d: ${(compliance as { dueNext14Days: number }).dueNext14Days}`,
        "",
        ...(list.length ? list : ["- No deadline rows returned from tracker"]),
        "",
        "_Internal calendar — external filings require Founder approval._",
      ].join("\n"),
      speechSummary: `Compliance calendar prepared. Overdue ${(compliance as { overdue: number }).overdue}.`,
      externalDistributionRequiresFounderApproval: true,
      systemsUsed: [...systemsUsed, "compliance"],
      assumptions: [],
      missingInformation: list.length ? [] : ["Detailed deadline rows unavailable"],
    };
  }

  if (kind === "grant_status") {
    const grants = await import("./grantReporting").then((m) => m.buildGrantExecutiveDashboard()).catch(() => null);
    return {
      kind,
      title: "Grant Status Update",
      content: [
        `# Grant Status Update`,
        `Pipeline: ${grants?.pipelineValue ?? "n/a"}`,
        `Active awards: ${grants?.activeAwards ?? "n/a"}`,
        `Win rate: ${grants?.winRate ?? "n/a"}`,
        "",
        "_Draft update — Founder approval before external funder communication._",
      ].join("\n"),
      speechSummary: `Grant status draft. Pipeline ${grants?.pipelineValue ?? "n/a"}; awards ${grants?.activeAwards ?? "n/a"}.`,
      externalDistributionRequiresFounderApproval: true,
      systemsUsed: [...systemsUsed, "grants"],
      assumptions: [],
      missingInformation: grants ? [] : ["Grant dashboard unavailable"],
    };
  }

  if (kind === "financial_summary") {
    const dash = await import("./auraExecutiveDecisionIntelligence").then((m) => m.buildEnterpriseBrainDashboard());
    return {
      kind,
      title: "Financial Summary",
      content: [
        `# Financial Summary`,
        `Cash flow: ${dash.financialPosition.cashFlow ?? "n/a"}`,
        `Financial health: ${dash.financialPosition.financialHealthScore ?? "n/a"}`,
        `Budget remaining: ${dash.financialPosition.budgetRemaining ?? "n/a"}`,
        "",
        "_Internal summary — external distribution requires Founder approval._",
      ].join("\n"),
      speechSummary: "Financial summary draft prepared for Founder review.",
      externalDistributionRequiresFounderApproval: true,
      systemsUsed: [...systemsUsed, "finance"],
      assumptions: [],
      missingInformation: [],
    };
  }

  const tech = await import("./auraTechnicalCommandEngine").then((m) => m.buildTechnicalCommandBriefing()).catch(() => null);
  return {
    kind: "technology_report",
    title: "Technology Report",
    content: [
      `# Technology Report`,
      `Score: ${tech?.overallScore ?? "n/a"}/100 (${tech?.overallLabel ?? "—"})`,
      `Live commit: ${tech?.liveCommit ?? "unknown"}`,
      `Deploy aligned: ${tech?.deployAligned ?? "unknown"}`,
      `Critical findings: ${(tech?.critical || []).slice(0, 5).map((c) => c.title).join("; ") || "none"}`,
      "",
      "_Draft — production deploy still requires Founder approval._",
    ].join("\n"),
    speechSummary: `Technology report draft. Score ${tech?.overallScore ?? "n/a"}/100.`,
    externalDistributionRequiresFounderApproval: true,
    systemsUsed: [...systemsUsed, "technical_command"],
    assumptions: [],
    missingInformation: tech ? [] : ["Technical Command unavailable"],
  };
}

export async function buildEnterpriseOsMissionControl(): Promise<EnterpriseOsMissionControl> {
  const [dash, prepared, tech, approvals] = await Promise.all([
    import("./auraExecutiveDecisionIntelligence").then((m) => m.buildEnterpriseBrainDashboard()),
    runAutonomousWorkflowScan(),
    import("./auraTechnicalCommandEngine").then((m) => m.buildTechnicalCommandBriefing()).catch(() => null),
    import("./enterpriseApprovals").then((m) => m.buildApprovalQueue(20)).catch(() => ({ tasks: [], counts: {} })),
  ]);

  const pending =
    (approvals as { counts?: { total?: number }; tasks?: unknown[] }).counts?.total
    ?? (approvals as { tasks?: unknown[] }).tasks?.length
    ?? dash.orgModel.approvalsPending
    ?? 0;

  const liveAlerts = [
    ...(dash.executiveAlerts || []).map((a) => ({
      id: a.id,
      title: a.title,
      explanation: a.detail,
      monitorDomain: "other" as const,
      severity: (a.severity === "critical" || a.severity === "high" || a.severity === "medium" || a.severity === "info"
        ? a.severity
        : "info") as OsPreparedAction["severity"],
      preparedWork: ["Review alert in Enterprise OS Mission Control"],
      founderApprovalRequired: a.requiresFounderAttention,
      suggestedPath: "/hq/enterprise-os",
      evidence: [a.detail],
    })),
    ...prepared.filter((p) => p.severity === "critical" || p.severity === "high").slice(0, 6),
  ];

  return {
    osVersion: OS_VERSION,
    brainVersion: BRAIN_VERSION,
    generatedAt: new Date().toISOString(),
    organizationHealth: dash.organizationHealth,
    enterpriseHealthScore: dash.enterpriseHealthScore,
    enterpriseGrade: dash.enterpriseGrade,
    fundingPipeline: dash.fundingPipeline,
    financialHealth: dash.financialPosition,
    grantStatus: `Pipeline ${dash.fundingPipeline.pipelineValue ?? "n/a"} · Awards ${dash.fundingPipeline.activeAwards ?? "n/a"}`,
    hrStatus: `Employees ${dash.orgModel.people.employees ?? "n/a"} · Volunteers ${dash.orgModel.people.volunteers ?? "n/a"}`,
    operations: `Org health ${dash.organizationHealth ?? "n/a"} · Pending approvals ${pending}`,
    softwareHealth: {
      score: tech?.overallScore ?? dash.orgModel.technology.healthScore,
      label: tech?.overallLabel ?? dash.orgModel.technology.healthLabel,
      deployAligned: tech?.deployAligned ?? dash.orgModel.technology.deployAligned,
    },
    security: "Role-based access · Founder Mode · MFA where enrolled · Audit logging · Approval gates",
    compliance: dash.orgModel.compliance,
    activeRisks: dash.activeRisks.map((r) => ({ id: r.id, title: r.title, confidence: r.confidence })),
    opportunities: dash.opportunities.map((o) => ({ id: o.id, title: o.title })),
    founderPriorities: dash.founderPriorities,
    liveAlerts: liveAlerts.slice(0, 12),
    preparedActions: prepared,
    pendingApprovals: pending,
    gaps: [...dash.orgModel.gaps, ...dash.scorecard.gaps].slice(0, 8),
  };
}

export async function runEnterpriseOs(opts: {
  request: string;
  channel: "voice" | "sms" | "hq_web";
  founderMode: boolean;
  actorEmail?: string | null;
}): Promise<{
  osVersion: typeof OS_VERSION;
  kind: string;
  speechSummary: string;
  smsSummary: string;
  unifiedBriefing: string;
  founderApprovalRequired: boolean;
  founderMay: readonly string[];
  founderMustApprove: readonly string[];
  payload: unknown;
}> {
  if (!opts.founderMode) {
    return {
      osVersion: OS_VERSION,
      kind: "denied",
      speechSummary: "Enterprise OS 4.0 requires Founder Mode.",
      smsSummary: "Founder Mode required.",
      unifiedBriefing: "Verify founder first.",
      founderApprovalRequired: true,
      founderMay: FOUNDER_MAY,
      founderMustApprove: FOUNDER_MUST_APPROVE,
      payload: null,
    };
  }

  const q = opts.request.trim();

  if (/\bmission control|enterprise os dashboard|os 4\b/i.test(q) || /\bshow (me )?mission control\b/i.test(q)) {
    const mc = await buildEnterpriseOsMissionControl();
    return {
      osVersion: OS_VERSION,
      kind: "mission_control",
      speechSummary: `Enterprise OS 4.0 Mission Control. Enterprise health ${mc.enterpriseHealthScore ?? "n/a"}. ${mc.liveAlerts.length} live alerts. ${mc.preparedActions.length} prepared actions awaiting review.`,
      smsSummary: `OS4.0 health ${mc.enterpriseHealthScore ?? "?"} · alerts ${mc.liveAlerts.length}`,
      unifiedBriefing: [
        `# AURA Enterprise OS 4.0 — Mission Control`,
        `Enterprise Health: ${mc.enterpriseHealthScore ?? "n/a"} (${mc.enterpriseGrade ?? "—"})`,
        `Org Health: ${mc.organizationHealth ?? "n/a"}`,
        `Pipeline: ${mc.fundingPipeline.pipelineValue ?? "n/a"}`,
        `Software: ${mc.softwareHealth.score ?? "n/a"}/100`,
        `Compliance overdue: ${mc.compliance.overdue}`,
        `Priorities: ${mc.founderPriorities.join("; ")}`,
        `Prepared actions: ${mc.preparedActions.map((a) => a.title).join("; ")}`,
        "",
        `AURA may: ${FOUNDER_MAY.join(", ")}.`,
        `AURA may NOT without approval: ${FOUNDER_MUST_APPROVE.join(", ")}.`,
      ].join("\n"),
      founderApprovalRequired: false,
      founderMay: FOUNDER_MAY,
      founderMustApprove: FOUNDER_MUST_APPROVE,
      payload: mc,
    };
  }

  if (/\bautonomous|monitor (grant|compliance|budget|production|deployment)/i.test(q) || /\bprepared actions?\b/i.test(q)) {
    const actions = await runAutonomousWorkflowScan();
    return {
      osVersion: OS_VERSION,
      kind: "autonomous_workflows",
      speechSummary: `Autonomous workflow scan prepared ${actions.length} action packages. Critical/high items are routed for Founder approval before execution.`,
      smsSummary: `OS4 workflows: ${actions.length} prepared`,
      unifiedBriefing: actions
        .map(
          (a) =>
            `## ${a.title}\n${a.explanation}\nPrepared: ${a.preparedWork.join("; ")}\nApproval: ${a.founderApprovalRequired ? "REQUIRED" : "not required for prep"}\nPath: ${a.suggestedPath}`
        )
        .join("\n\n"),
      founderApprovalRequired: actions.some((a) => a.founderApprovalRequired),
      founderMay: FOUNDER_MAY,
      founderMustApprove: FOUNDER_MUST_APPROVE,
      payload: { actions },
    };
  }

  if (/\borchestrat|grant opportunity triggers|interconnect/i.test(q) || /\bapply for this grant\b/i.test(q)) {
    const plan = await orchestrateGrantOpportunityWorkflow({ request: q });
    return {
      osVersion: OS_VERSION,
      kind: "orchestration",
      speechSummary: plan.executiveSummary,
      smsSummary: `OS4 orchestration: ${plan.steps.length} steps · APPROVAL REQUIRED`,
      unifiedBriefing: [
        `# Enterprise Task Orchestration`,
        plan.executiveSummary,
        "",
        ...plan.steps.map(
          (s) => `- [${s.department}] ${s.title} (${s.status})${s.founderApprovalRequired ? " — Founder approval" : ""}\n  ${s.detail}`
        ),
      ].join("\n"),
      founderApprovalRequired: true,
      founderMay: FOUNDER_MAY,
      founderMustApprove: FOUNDER_MUST_APPROVE,
      payload: plan,
    };
  }

  if (/\bknowledge graph\b|\bhow (do|are) .+ relat/i.test(q)) {
    const graph = await buildExecutiveKnowledgeGraph();
    return {
      osVersion: OS_VERSION,
      kind: "knowledge_graph",
      speechSummary: `Knowledge graph built with ${graph.nodes.length} nodes and ${graph.edges.length} relationships. ${graph.gaps[0] || "Live edges available."}`,
      smsSummary: `Graph: ${graph.nodes.length} nodes · ${graph.edges.length} edges`,
      unifiedBriefing: [
        `# Executive Knowledge Graph`,
        ...graph.edges.slice(0, 20).map((e) => {
          const from = graph.nodes.find((n) => n.id === e.from)?.label || e.from;
          const to = graph.nodes.find((n) => n.id === e.to)?.label || e.to;
          return `- ${from} —[${e.relation}]→ ${to}`;
        }),
        "",
        "## Gaps",
        ...(graph.gaps.length ? graph.gaps.map((g) => `- ${g}`) : ["- None flagged"]),
      ].join("\n"),
      founderApprovalRequired: false,
      founderMay: FOUNDER_MAY,
      founderMustApprove: FOUNDER_MUST_APPROVE,
      payload: graph,
    };
  }

  if (
    /\bshow every document\b|\bwhich programs depend\b|\bwhich budgets support\b|\bwhat approvals are still outstanding\b/i.test(q)
    || /\benterprise search\b/i.test(q)
  ) {
    const search = await runEnterpriseOsSearch(q);
    return {
      osVersion: OS_VERSION,
      kind: "enterprise_search",
      speechSummary: search.answer,
      smsSummary: truncate(search.answer, 200),
      unifiedBriefing: [
        `# Enterprise Search`,
        search.answer,
        "",
        "## Results",
        ...search.results.slice(0, 12).map((r) => `- [${r.type}] ${r.title} — ${r.path}`),
        "",
        "## Graph hints",
        ...(search.graphHints.length ? search.graphHints.map((h) => `- ${h}`) : ["- None"]),
        "",
        "## Missing / assumptions",
        ...search.missingInformation.map((m) => `- Missing: ${m}`),
        ...search.assumptions.map((a) => `- Assumption: ${a}`),
      ].join("\n"),
      founderApprovalRequired: false,
      founderMay: FOUNDER_MAY,
      founderMustApprove: FOUNDER_MUST_APPROVE,
      payload: search,
    };
  }

  if (/\bexpand to another county\b|\bwhat happens if this grant is not awarded\b|\bstaffing is required\b/i.test(q) || /\bscenario planning\b/i.test(q)) {
    const edi = await import("./auraExecutiveDecisionIntelligence").then((m) =>
      m.runExecutiveDecisionEngine(
        /\bwhat happens if\b/i.test(q) ? q : `What happens if ${q}`
      )
    );
    return {
      osVersion: OS_VERSION,
      kind: "scenario_planning",
      speechSummary: edi.speechSummary,
      smsSummary: edi.smsSummary,
      unifiedBriefing: [
        `# Scenario Planning — Enterprise OS 4.0`,
        edi.executiveSummary,
        "",
        edi.scenarios?.length
          ? edi.scenarios
              .map(
                (s) =>
                  `## ${s.posture}\nCash Δ ${s.result.summary.cashFlowImpact}; risk ${s.result.summary.riskLevel}\n${s.result.summary.recommendation}`
              )
              .join("\n\n")
          : edi.recommendation,
        "",
        "## Assumptions (not facts)",
        ...edi.explainability.assumptions.map((a) => `- ${a}`),
      ].join("\n"),
      founderApprovalRequired: true,
      founderMay: FOUNDER_MAY,
      founderMustApprove: FOUNDER_MUST_APPROVE,
      payload: edi,
    };
  }

  if (/\b(monthly board packet|compliance calendar|grant status update|financial summary|technology report|weekly executive report)\b/i.test(q)) {
    const kind: ExecutiveAutomationPackage["kind"] = /\bboard packet\b/i.test(q)
      ? "monthly_board"
      : /\bcompliance calendar\b/i.test(q)
        ? "compliance_calendar"
        : /\bgrant status\b/i.test(q)
          ? "grant_status"
          : /\bfinancial summary\b/i.test(q)
            ? "financial_summary"
            : /\btechnology report\b/i.test(q)
              ? "technology_report"
              : "weekly_executive";
    const pack = await buildExecutiveAutomationPackage(kind);
    await logHqAudit({
      action: "aura_enterprise_os_automation",
      entityType: "aura_enterprise_os",
      detail: kind,
      actorEmail: opts.actorEmail || undefined,
    }).catch(() => undefined);
    return {
      osVersion: OS_VERSION,
      kind: "executive_automation",
      speechSummary: pack.speechSummary,
      smsSummary: truncate(pack.title, 120),
      unifiedBriefing: pack.content,
      founderApprovalRequired: true,
      founderMay: FOUNDER_MAY,
      founderMustApprove: FOUNDER_MUST_APPROVE,
      payload: pack,
    };
  }

  if (/\borganizational memory|approved policies|lessons learned|historical decisions\b/i.test(q)) {
    const memory = await import("./auraOrganizationalMemory").then((m) =>
      m.retrieveOrganizationalMemory(q, { topK: 10 })
    );
    return {
      osVersion: OS_VERSION,
      kind: "organizational_memory",
      speechSummary: `Organizational memory returned ${memory.facts.length} verified facts. ${memory.gaps[0] || "Prefer latest approved records."}`,
      smsSummary: `Memory: ${memory.facts.length} facts`,
      unifiedBriefing: [
        `# Organizational Memory`,
        ...memory.facts.map((f) => `- FACT: ${f.statement}`),
        "",
        "## Gaps / outdated risk",
        ...(memory.gaps.length ? memory.gaps.map((g) => `- ${g}`) : ["- None flagged"]),
        "",
        "_Always prefer latest approved information._",
      ].join("\n"),
      founderApprovalRequired: false,
      founderMay: FOUNDER_MAY,
      founderMustApprove: FOUNDER_MUST_APPROVE,
      payload: memory,
    };
  }

  // Default: Mission Control snapshot
  const mc = await buildEnterpriseOsMissionControl();
  return {
    osVersion: OS_VERSION,
    kind: "mission_control",
    speechSummary: `Enterprise OS 4.0 online. Health ${mc.enterpriseHealthScore ?? "n/a"}. Ask for Mission Control, orchestration, knowledge graph, enterprise search, or automation packages.`,
    smsSummary: `OS4.0 ready · health ${mc.enterpriseHealthScore ?? "?"}`,
    unifiedBriefing: `Enterprise OS 4.0 coordinating IFCDC Headquarters. ${mc.founderPriorities[0] || ""}`,
    founderApprovalRequired: false,
    founderMay: FOUNDER_MAY,
    founderMustApprove: FOUNDER_MUST_APPROVE,
    payload: mc,
  };
}

let osTablesReady = false;
export async function ensureEnterpriseOsTables(): Promise<void> {
  if (osTablesReady) return;
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS aura_enterprise_os_runs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      request TEXT,
      founder_approval_required INTEGER DEFAULT 1,
      actor_email TEXT,
      result_json TEXT,
      created_at TEXT NOT NULL
    );
  `);
  osTablesReady = true;
}
