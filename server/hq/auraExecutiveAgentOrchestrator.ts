/**
 * AURA Multi-Agent Executive Architecture
 *
 * The Founder only speaks with "AURA." Behind the scenes, AURA (Chief of Staff)
 * delegates to specialized executive agents that call LIVE HQ engines, then
 * synthesizes one unified executive response.
 *
 * No demo agents. No placeholder intelligence. High-impact actions require
 * Founder approval before execution.
 */
import crypto from "crypto";
import { getDb } from "../db";
import { logHqAudit } from "./hqAuditLog";
import { getFounderEmail } from "./auraFounderTrustEngine";
import { createLeadershipAlert } from "./criticalAlerts";

export type ExecutiveAgentId =
  | "chief_of_staff"
  | "grants_director"
  | "cfo"
  | "cto"
  | "hr_director"
  | "operations_director"
  | "communications_director"
  | "compliance_officer"
  | "knowledge_librarian"
  | "intelligence_analyst";

export type AgentContribution = {
  agentId: ExecutiveAgentId;
  title: string;
  summary: string;
  facts: string[];
  recommendations: string[];
  citations: Array<{ system: string; detail: string }>;
  founderApprovalRequired: boolean;
  ok: boolean;
  error?: string;
  durationMs: number;
};

export type MultiAgentOrchestrationResult = {
  orchestrationId: string;
  generatedAt: string;
  request: string;
  intent: "board_briefing" | "capital_strategy" | "general_executive" | "unknown";
  agentsInvoked: ExecutiveAgentId[];
  contributions: AgentContribution[];
  unifiedBriefing: string;
  speechSummary: string;
  smsSummary: string;
  founderApprovalRequired: boolean;
  approvalsNeeded: string[];
  nextActions: string[];
};

const AGENT_META: Record<ExecutiveAgentId, { title: string; role: string }> = {
  chief_of_staff: { title: "Executive Chief of Staff", role: "Coordinates priorities, briefings, approvals, Founder context" },
  grants_director: { title: "Director of Grants & Funding", role: "Live funding pipeline, matches, drafts, deadlines" },
  cfo: { title: "Chief Financial Officer", role: "Budgets, cash flow, donations, financial risk" },
  cto: { title: "Chief Technology Officer", role: "Deployments, integrations, production health" },
  hr_director: { title: "HR Director", role: "Staffing, hiring capacity, workforce planning" },
  operations_director: { title: "Operations Director", role: "Programs, workflows, cross-department status" },
  communications_director: { title: "Communications Director", role: "Board packets, Founder updates, outreach drafts" },
  compliance_officer: { title: "Compliance & Risk Officer", role: "Filings, deadlines, security posture" },
  knowledge_librarian: { title: "Knowledge Librarian", role: "Approved Knowledge Base facts and document grounding" },
  intelligence_analyst: { title: "Executive Intelligence Analyst", role: "Trends, risks, opportunities, strategic synthesis" },
};

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

function truncate(s: string, n = 420): string {
  const t = (s || "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

async function runAgent(
  agentId: ExecutiveAgentId,
  fn: () => Promise<Omit<AgentContribution, "agentId" | "title" | "durationMs">>
): Promise<AgentContribution> {
  const started = Date.now();
  try {
    const result = await withTimeout(
      fn(),
      12_000,
      {
        summary: `${AGENT_META[agentId].title} timed out — live probe incomplete.`,
        facts: [],
        recommendations: ["Retry this specialist or open the related HQ module."],
        citations: [{ system: agentId, detail: "timeout" }],
        founderApprovalRequired: false,
        ok: false,
        error: "timeout",
      }
    );
    return {
      agentId,
      title: AGENT_META[agentId].title,
      durationMs: Date.now() - started,
      ...result,
    };
  } catch (err) {
    return {
      agentId,
      title: AGENT_META[agentId].title,
      summary: `${AGENT_META[agentId].title} failed: ${err instanceof Error ? err.message : "error"}`,
      facts: [],
      recommendations: [],
      citations: [{ system: agentId, detail: "exception" }],
      founderApprovalRequired: false,
      ok: false,
      error: err instanceof Error ? err.message : "error",
      durationMs: Date.now() - started,
    };
  }
}

export function listExecutiveAgents(): Array<{ id: ExecutiveAgentId; title: string; role: string }> {
  return (Object.keys(AGENT_META) as ExecutiveAgentId[]).map((id) => ({
    id,
    title: AGENT_META[id].title,
    role: AGENT_META[id].role,
  }));
}

export function wantsMultiAgentOrchestration(message: string): boolean {
  const m = message.trim();
  if (!m) return false;
  return (
    /\b(board meeting|board packet|prepare .+ board|executive team|multi[- ]?agent|orchestrat)\b/i.test(m)
    || /\braise\s+\$?\d+(\.\d+)?\s*(million|m|k)?\b/i.test(m)
    || /\b\$\s?10\s*million\b/i.test(m)
    || /\bfunding strategy\b|\bcapital (campaign|plan|strategy)\b|\bfive[- ]year (plan|strategy)\b/i.test(m)
    || /\bexecutive (agent|specialist|leadership) team\b/i.test(m)
    || /\bprepare ifcdc for\b/i.test(m)
    || /\bunified (briefing|plan|strategy)\b/i.test(m)
  );
}

export function classifyExecutiveIntent(
  message: string
): MultiAgentOrchestrationResult["intent"] {
  if (/\bboard (meeting|packet|briefing)\b|\bprepare .+ board\b/i.test(message)) return "board_briefing";
  if (/\braise\s+\$?\d+|\$\s?10\s*million|funding strategy|capital (campaign|plan)|five[- ]year/i.test(message)) {
    return "capital_strategy";
  }
  if (wantsMultiAgentOrchestration(message)) return "general_executive";
  return "unknown";
}

function selectAgents(intent: MultiAgentOrchestrationResult["intent"]): ExecutiveAgentId[] {
  if (intent === "board_briefing") {
    return [
      "knowledge_librarian",
      "cfo",
      "grants_director",
      "operations_director",
      "hr_director",
      "cto",
      "compliance_officer",
      "communications_director",
      "intelligence_analyst",
      "chief_of_staff",
    ];
  }
  if (intent === "capital_strategy") {
    return [
      "knowledge_librarian",
      "grants_director",
      "cfo",
      "operations_director",
      "hr_director",
      "intelligence_analyst",
      "compliance_officer",
      "communications_director",
      "cto",
      "chief_of_staff",
    ];
  }
  return [
    "knowledge_librarian",
    "intelligence_analyst",
    "grants_director",
    "cfo",
    "cto",
    "chief_of_staff",
  ];
}

async function agentKnowledgeLibrarian(request: string): Promise<Omit<AgentContribution, "agentId" | "title" | "durationMs">> {
  const { retrieveOrganizationalMemory } = await import("./auraOrganizationalMemory");
  const memory = await retrieveOrganizationalMemory(request, { topK: 6, includeTechHealth: false });
  return {
    ok: memory.facts.length > 0,
    summary: memory.speechSummary,
    facts: memory.facts.slice(0, 5).map((f) => truncate(f.statement, 260)),
    recommendations: memory.recommendations.slice(0, 3).map((r) => r.statement),
    citations: memory.citations.slice(0, 5).map((c) => ({
      system: "knowledge_base",
      detail: `${c.title}${c.sourceType ? ` (${c.sourceType})` : ""}`,
    })),
    founderApprovalRequired: false,
  };
}

async function agentCfo(): Promise<Omit<AgentContribution, "agentId" | "title" | "durationMs">> {
  const [{ buildFinanceExecutiveBriefing }, { buildExecutiveDashboard }] = await Promise.all([
    import("./financePhase4Engine"),
    import("./financeReporting"),
  ]);
  const [briefing, dash] = await Promise.all([
    buildFinanceExecutiveBriefing().catch(() => null),
    buildExecutiveDashboard().catch(() => null),
  ]);
  const facts: string[] = [];
  if (dash) {
    if (typeof dash.cashFlow === "number") facts.push(`Cash flow signal: ${dash.cashFlow}`);
  }
  if (briefing && typeof briefing === "object") {
    const b = briefing as { summary?: string; narrative?: string; risks?: string[]; highlights?: string[] };
    if (b.summary) facts.push(truncate(String(b.summary)));
    if (b.narrative) facts.push(truncate(String(b.narrative)));
    if (Array.isArray(b.highlights)) facts.push(...b.highlights.slice(0, 2).map((h) => truncate(String(h))));
    if (Array.isArray(b.risks)) facts.push(...b.risks.slice(0, 2).map((r) => `Risk: ${truncate(String(r))}`));
  }
  if (!facts.length) facts.push("Finance briefing modules returned limited live fields — open Financial Center for detail.");
  return {
    ok: facts.length > 0,
    summary: truncate(facts[0] || "CFO live financial snapshot complete."),
    facts,
    recommendations: [
      "Confirm any spending or hiring against approved budget lines before Founder authorization.",
    ],
    citations: [
      { system: "finance", detail: "financePhase4Engine / financeReporting live dashboard" },
    ],
    founderApprovalRequired: true,
  };
}

async function agentGrants(): Promise<Omit<AgentContribution, "agentId" | "title" | "durationMs">> {
  const { buildOrgWideGrantMatches, buildGrantIntelligenceDashboard } = await import("./grantIntelligenceEngine");
  const [matchesPayload, dashboard] = await Promise.all([
    buildOrgWideGrantMatches({ sort: "deadline", limit: 8, actorEmail: getFounderEmail() }).catch(() => ({ matches: [] })),
    buildGrantIntelligenceDashboard().catch(() => null),
  ]);
  const matches = Array.isArray((matchesPayload as { matches?: unknown[] }).matches)
    ? (matchesPayload as { matches: Array<{ title?: string; deadlineLabel?: string; daysUntilDeadline?: number | null }> }).matches
    : [];
  const facts = matches.slice(0, 5).map((m) =>
    truncate(`${m.title || "Opportunity"} — ${m.deadlineLabel || "deadline n/a"}`)
  );
  if (dashboard && typeof dashboard === "object") {
    const d = dashboard as unknown as {
      summary?: { openOpportunities?: number; totalPipelineValue?: number; upcomingDeadlines?: number };
      openOpportunities?: number;
    };
    if (typeof d.summary?.openOpportunities === "number") {
      facts.push(`Open opportunities tracked: ${d.summary.openOpportunities}`);
    } else if (typeof d.openOpportunities === "number") {
      facts.push(`Open opportunities tracked: ${d.openOpportunities}`);
    }
    if (typeof d.summary?.totalPipelineValue === "number") {
      facts.push(`Pipeline value signal: ${d.summary.totalPipelineValue}`);
    }
    if (typeof d.summary?.upcomingDeadlines === "number") {
      facts.push(`Upcoming deadlines: ${d.summary.upcomingDeadlines}`);
    }
  }
  if (!facts.length) facts.push("No live grant matches returned in this window — sync Grants.gov feeds.");
  return {
    ok: true,
    summary: `Grants Director: ${matches.length} live-ranked opportunities in this pull.`,
    facts,
    recommendations: [
      "Route any proposal draft to Founder Review — never submit without explicit Founder approval.",
    ],
    citations: [{ system: "grants", detail: "grantIntelligenceEngine live matches/dashboard" }],
    founderApprovalRequired: true,
  };
}

async function agentCto(): Promise<Omit<AgentContribution, "agentId" | "title" | "durationMs">> {
  const { buildTechnicalCommandBriefing } = await import("./auraTechnicalCommandEngine");
  const briefing = await buildTechnicalCommandBriefing();
  return {
    ok: briefing.overallLabel !== "critical",
    summary: `CTO: production health ${briefing.overallScore}/100 (${briefing.overallLabel}). Live ${briefing.liveCommit || "?"} · GitHub ${briefing.githubCommit || "?"}.`,
    facts: [
      `Deploy aligned: ${briefing.deployAligned === true ? "yes" : briefing.deployAligned === false ? "no" : "unknown"}`,
      ...briefing.critical.slice(0, 3).map((f) => `CRITICAL: ${f.title} — ${truncate(f.detail, 160)}`),
      ...briefing.warnings.slice(0, 2).map((f) => `WARN: ${f.title}`),
    ],
    recommendations: briefing.priorities.slice(0, 3),
    citations: [{ system: "technical_command", detail: "auraTechnicalCommandEngine live briefing" }],
    founderApprovalRequired: briefing.approvalsNeeded.length > 0,
  };
}

async function agentHr(): Promise<Omit<AgentContribution, "agentId" | "title" | "durationMs">> {
  try {
    const { buildWorkforceExecutiveIntelligence, buildStaffingForecast } = await import("./peopleOperationsEngine");
    const [workforce, staffing] = await Promise.all([
      buildWorkforceExecutiveIntelligence().catch(() => null),
      buildStaffingForecast().catch(() => null),
    ]);
    const facts: string[] = [];
    if (workforce && typeof workforce === "object") {
      const w = workforce as { headcount?: number; summary?: string; openRoles?: number; narrative?: string };
      if (typeof w.headcount === "number") facts.push(`Headcount signal: ${w.headcount}`);
      if (typeof w.openRoles === "number") facts.push(`Open roles signal: ${w.openRoles}`);
      if (w.summary) facts.push(truncate(String(w.summary)));
      if (w.narrative) facts.push(truncate(String(w.narrative)));
    }
    if (staffing && typeof staffing === "object") {
      const s = staffing as { summary?: string; projectedHeadcount?: number };
      if (typeof s.projectedHeadcount === "number") facts.push(`Projected headcount: ${s.projectedHeadcount}`);
      if (s.summary) facts.push(truncate(String(s.summary)));
    }
    if (!facts.length) facts.push("HR live intelligence returned limited fields — open People / HR Command Center.");
    return {
      ok: true,
      summary: truncate(facts[0] || "HR Director staffing snapshot ready."),
      facts,
      recommendations: ["Any hiring plan requires Founder approval and funded budget lines."],
      citations: [{ system: "people", detail: "peopleOperationsEngine live workforce/staffing" }],
      founderApprovalRequired: true,
    };
  } catch (err) {
    return {
      ok: false,
      summary: "HR Director could not load workforce intelligence.",
      facts: [],
      recommendations: ["Open People module manually."],
      citations: [{ system: "people", detail: err instanceof Error ? err.message : "unavailable" }],
      founderApprovalRequired: false,
      error: err instanceof Error ? err.message : "unavailable",
    };
  }
}

async function agentOperations(): Promise<Omit<AgentContribution, "agentId" | "title" | "durationMs">> {
  const facts: string[] = [];
  try {
    const { buildOperationsCommandCenter } = await import("./operationsCommandEngine");
    const center = await buildOperationsCommandCenter().catch(() => null);
    if (center && typeof center === "object") {
      const c = center as { summary?: string; activePrograms?: number; openTasks?: number; narrative?: string };
      if (c.summary) facts.push(truncate(String(c.summary)));
      if (c.narrative) facts.push(truncate(String(c.narrative)));
      if (typeof c.activePrograms === "number") facts.push(`Active programs: ${c.activePrograms}`);
      if (typeof c.openTasks === "number") facts.push(`Open operational tasks: ${c.openTasks}`);
    }
  } catch {
    /* optional */
  }
  try {
    const { buildMissionControlCommandCenter } = await import("./missionControlEngine");
    const mc = await buildMissionControlCommandCenter("owner").catch(() => null);
    if (mc && typeof mc === "object") {
      const m = mc as { summary?: string; activeMissions?: number };
      if (m.summary) facts.push(truncate(String(m.summary)));
      if (typeof m.activeMissions === "number") facts.push(`Active missions: ${m.activeMissions}`);
    }
  } catch {
    /* optional */
  }
  if (!facts.length) facts.push("Operations live command centers returned limited fields — open Operations / Mission Control.");
  return {
    ok: true,
    summary: truncate(facts[0] || "Operations Director status captured."),
    facts,
    recommendations: ["Align program expansion with funded opportunities before committing capacity."],
    citations: [{ system: "operations", detail: "operationsCommandEngine / missionControlEngine" }],
    founderApprovalRequired: false,
  };
}

async function agentCompliance(): Promise<Omit<AgentContribution, "agentId" | "title" | "durationMs">> {
  const { trackComplianceDeadlines } = await import("./auraExecutiveOps");
  const compliance = await trackComplianceDeadlines().catch(() => ({
    overdue: 0,
    dueNext14Days: 0,
    deadlines: [] as unknown[],
  }));
  const overdue = (compliance as { overdue?: number }).overdue ?? 0;
  const dueSoon = (compliance as { dueNext14Days?: number }).dueNext14Days ?? 0;
  return {
    ok: overdue === 0,
    summary: `Compliance: ${overdue} overdue · ${dueSoon} due within 14 days.`,
    facts: [
      `Overdue compliance items: ${overdue}`,
      `Due in next 14 days: ${dueSoon}`,
    ],
    recommendations:
      overdue > 0
        ? ["Clear overdue compliance items before board packet finalization."]
        : ["Maintain weekly compliance sweep before filings slip."],
    citations: [{ system: "compliance", detail: "auraExecutiveOps.trackComplianceDeadlines" }],
    founderApprovalRequired: overdue > 0,
  };
}

async function agentCommunications(intent: MultiAgentOrchestrationResult["intent"]): Promise<Omit<AgentContribution, "agentId" | "title" | "durationMs">> {
  const draft =
    intent === "board_briefing"
      ? "Communications draft outline: Board packet sections — financials, grants, programs, staffing, systems, compliance, Founder decisions required."
      : intent === "capital_strategy"
        ? "Communications draft outline: Capital campaign narrative — vision, five-year funding mix, program expansion story, donor/funder ask, Founder approval gate."
        : "Communications draft outline: Founder executive update with priorities and asks.";
  return {
    ok: true,
    summary: draft,
    facts: [draft],
    recommendations: [
      "Generate the formal board/capital document only after Founder approves the unified plan.",
      "Use executiveDocumentDelivery for PDF/email once content is approved.",
    ],
    citations: [{ system: "communications", detail: "Draft framing only — no outbound send executed" }],
    founderApprovalRequired: true,
  };
}

async function agentAnalyst(request: string): Promise<Omit<AgentContribution, "agentId" | "title" | "durationMs">> {
  const facts: string[] = [];
  try {
    const { generateStrategicRecommendations, buildGrantFundingProjections } = await import("./executiveIntelligenceEngine");
    const [recs, proj] = await Promise.all([
      generateStrategicRecommendations().catch(() => null),
      buildGrantFundingProjections().catch(() => null),
    ]);
    if (Array.isArray(recs)) {
      facts.push(...recs.slice(0, 3).map((r) => truncate(typeof r === "string" ? r : JSON.stringify(r), 220)));
    } else if (recs && typeof recs === "object" && Array.isArray((recs as { recommendations?: unknown[] }).recommendations)) {
      facts.push(
        ...((recs as { recommendations: unknown[] }).recommendations)
          .slice(0, 3)
          .map((r) => truncate(typeof r === "string" ? r : JSON.stringify(r), 220))
      );
    }
    if (proj && typeof proj === "object") {
      const p = proj as { summary?: string; projectedFunding?: number };
      if (p.summary) facts.push(truncate(String(p.summary)));
      if (typeof p.projectedFunding === "number") facts.push(`Projected funding signal: ${p.projectedFunding}`);
    }
  } catch {
    /* optional */
  }
  try {
    const { buildAuraIntelligenceMetrics } = await import("./auraIntelligenceMetrics");
    const metrics = await buildAuraIntelligenceMetrics();
    facts.push(`AURA intelligence tech score: ${metrics.technical.healthScore ?? "n/a"}`);
    facts.push(...metrics.outstandingGaps.slice(0, 2));
  } catch {
    /* optional */
  }
  if (!facts.length) facts.push(`Analyst note: limited strategic package for “${truncate(request, 80)}”.`);
  return {
    ok: true,
    summary: truncate(facts[0] || "Executive Intelligence Analyst synthesis ready."),
    facts,
    recommendations: ["Treat projections as scenarios — require Founder approval before committing capital or hiring."],
    citations: [{ system: "intelligence", detail: "executiveIntelligenceEngine / auraIntelligenceMetrics" }],
    founderApprovalRequired: true,
  };
}

async function agentChiefOfStaff(
  request: string,
  intent: MultiAgentOrchestrationResult["intent"],
  peerNotes: string[]
): Promise<Omit<AgentContribution, "agentId" | "title" | "durationMs">> {
  const { getOrGenerateDailyBriefing } = await import("./executiveBriefings");
  const briefing = await getOrGenerateDailyBriefing().catch(() => null);
  const facts: string[] = peerNotes.slice(0, 6);
  if (briefing && typeof briefing === "object") {
    const b = briefing as { title?: string; priorities?: string[]; summary?: string; content?: string };
    if (b.summary) facts.unshift(truncate(String(b.summary)));
    if (b.content) facts.unshift(truncate(String(b.content)));
    if (Array.isArray(b.priorities)) facts.push(...b.priorities.slice(0, 3).map((p) => truncate(String(p), 160)));
  }
  return {
    ok: true,
    summary: `Chief of Staff coordinating ${intent.replace(/_/g, " ")} for: ${truncate(request, 120)}`,
    facts,
    recommendations: [
      "Present one unified briefing to the Founder.",
      "Stage high-impact execution items for Founder approval — do not auto-execute.",
    ],
    citations: [{ system: "executive", detail: "executiveBriefings + multi-agent synthesis" }],
    founderApprovalRequired: true,
  };
}

function synthesizeUnifiedBriefing(opts: {
  request: string;
  intent: MultiAgentOrchestrationResult["intent"];
  contributions: AgentContribution[];
}): { unifiedBriefing: string; speechSummary: string; smsSummary: string; nextActions: string[]; approvalsNeeded: string[] } {
  const { request, intent, contributions } = opts;
  const okAgents = contributions.filter((c) => c.ok || c.facts.length);
  const approvalsNeeded = contributions
    .filter((c) => c.founderApprovalRequired)
    .map((c) => `${c.title}: approval required before execution`);
  const nextActions = contributions
    .flatMap((c) => c.recommendations)
    .filter(Boolean)
    .slice(0, 8);

  const sections = okAgents.map((c) => {
    const factLines = c.facts.slice(0, 4).map((f) => `  • ${f}`).join("\n");
    const cite = c.citations[0] ? ` [source: ${c.citations[0].system}]` : "";
    return `${c.title}${cite}\n${factLines || `  • ${c.summary}`}`;
  });

  const intentLabel =
    intent === "board_briefing"
      ? "Board Meeting Preparation"
      : intent === "capital_strategy"
        ? "Multi-Year Capital / Funding Strategy"
        : "Executive Multi-Agent Briefing";

  const unifiedBriefing = [
    `AURA EXECUTIVE BRIEFING — ${intentLabel}`,
    `Request: ${request}`,
    `Generated: ${new Date().toISOString()}`,
    "",
    "Specialist contributions (live HQ data):",
    ...sections,
    "",
    "Chief of Staff synthesis:",
    intent === "board_briefing"
      ? "Board packet draft inputs are ready from Finance, Grants, Operations, HR, Technology, Compliance, and Communications. Finalize only after Founder review."
      : intent === "capital_strategy"
        ? "A five-year funding path must combine live grant pipeline capacity, financial runway, staffing, and program expansion — presented here as a plan for Founder approval, not an executed campaign."
        : "Specialists have reported. Prioritize critical risks first, then funding and capacity.",
    "",
    approvalsNeeded.length ? `Founder approvals needed:\n${approvalsNeeded.map((a) => `  • ${a}`).join("\n")}` : "No immediate irreversible actions staged.",
    "",
    nextActions.length ? `Recommended next actions:\n${nextActions.map((a, i) => `  ${i + 1}. ${a}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const speechSummary = [
    `I convened the executive agent team for ${intentLabel.toLowerCase()}.`,
    `${okAgents.length} specialists reported from live HQ systems.`,
    contributions.find((c) => c.agentId === "cto")?.summary || "",
    contributions.find((c) => c.agentId === "grants_director")?.summary || "",
    contributions.find((c) => c.agentId === "cfo")?.summary || "",
    approvalsNeeded.length
      ? "High-impact items require your Founder approval before execution."
      : "No irreversible actions were taken.",
    "I can email a detailed follow-up report if you want the full packet.",
  ]
    .filter(Boolean)
    .join(" ");

  const smsSummary = [
    `AURA team (${intent}): ${okAgents.length} agents`,
    truncate(contributions.find((c) => c.agentId === "cto")?.summary || "", 100),
    truncate(contributions.find((c) => c.agentId === "grants_director")?.summary || "", 100),
    approvalsNeeded.length ? "APPROVAL REQUIRED" : "No irreversible actions",
  ].join("\n");

  return { unifiedBriefing, speechSummary, smsSummary, nextActions, approvalsNeeded };
}

let auditTableReady = false;
async function ensureOrchestrationAuditTable(): Promise<void> {
  if (auditTableReady) return;
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS aura_multi_agent_runs (
      id TEXT PRIMARY KEY,
      request TEXT NOT NULL,
      intent TEXT NOT NULL,
      agents_json TEXT,
      founder_approval_required INTEGER DEFAULT 0,
      actor_email TEXT,
      channel TEXT,
      created_at TEXT NOT NULL
    );
  `);
  auditTableReady = true;
}

/** Orchestrate specialist agents and return one unified AURA executive response. */
export async function orchestrateExecutiveAgentTeam(opts: {
  request: string;
  channel: "voice" | "sms" | "hq_web";
  actorEmail?: string | null;
  founderMode: boolean;
}): Promise<MultiAgentOrchestrationResult> {
  if (!opts.founderMode) {
    return {
      orchestrationId: crypto.randomUUID(),
      generatedAt: new Date().toISOString(),
      request: opts.request,
      intent: "unknown",
      agentsInvoked: [],
      contributions: [],
      unifiedBriefing: "Multi-agent executive orchestration requires Founder Mode.",
      speechSummary: "Please verify founder first, then ask me to prepare the board packet or capital plan.",
      smsSummary: "Founder Mode required for executive agent team.",
      founderApprovalRequired: true,
      approvalsNeeded: ["Founder Mode verification"],
      nextActions: ['Say "verify founder" and enter your code.'],
    };
  }

  const intent = classifyExecutiveIntent(opts.request);
  const agents = selectAgents(intent === "unknown" ? "general_executive" : intent);
  const effectiveIntent = intent === "unknown" ? "general_executive" : intent;

  // Knowledge first (grounds others), then parallel specialists, Chief of Staff last.
  const knowledge = await runAgent("knowledge_librarian", () => agentKnowledgeLibrarian(opts.request));

  const parallelIds = agents.filter((id) => id !== "knowledge_librarian" && id !== "chief_of_staff");
  const parallel = await Promise.all(
    parallelIds.map((id) => {
      switch (id) {
        case "cfo":
          return runAgent(id, () => agentCfo());
        case "grants_director":
          return runAgent(id, () => agentGrants());
        case "cto":
          return runAgent(id, () => agentCto());
        case "hr_director":
          return runAgent(id, () => agentHr());
        case "operations_director":
          return runAgent(id, () => agentOperations());
        case "compliance_officer":
          return runAgent(id, () => agentCompliance());
        case "communications_director":
          return runAgent(id, () => agentCommunications(effectiveIntent));
        case "intelligence_analyst":
          return runAgent(id, () => agentAnalyst(opts.request));
        default:
          return runAgent(id, async () => ({
            ok: false,
            summary: "Agent not wired",
            facts: [],
            recommendations: [],
            citations: [],
            founderApprovalRequired: false,
          }));
      }
    })
  );

  const peerNotes = [knowledge, ...parallel].flatMap((c) => c.facts.slice(0, 2));
  const chief = await runAgent("chief_of_staff", () =>
    agentChiefOfStaff(opts.request, effectiveIntent, peerNotes)
  );

  const contributions = [knowledge, ...parallel, chief];
  const synthesized = synthesizeUnifiedBriefing({
    request: opts.request,
    intent: effectiveIntent,
    contributions,
  });

  const founderApprovalRequired =
    contributions.some((c) => c.founderApprovalRequired) || effectiveIntent === "capital_strategy";

  const orchestrationId = crypto.randomUUID();
  await ensureOrchestrationAuditTable();
  const db = await getDb();
  await db.run(
    `INSERT INTO aura_multi_agent_runs (id, request, intent, agents_json, founder_approval_required, actor_email, channel, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    orchestrationId,
    opts.request.slice(0, 1000),
    effectiveIntent,
    JSON.stringify(agents),
    founderApprovalRequired ? 1 : 0,
    opts.actorEmail || getFounderEmail(),
    opts.channel,
    new Date().toISOString()
  );

  await logHqAudit({
    action: "aura_multi_agent_orchestrate",
    entityType: "aura_executive_agents",
    entityId: orchestrationId,
    detail: `${effectiveIntent}: ${agents.length} agents`,
    actorEmail: opts.actorEmail || getFounderEmail(),
    metadata: {
      intent: effectiveIntent,
      agents,
      founderApprovalRequired,
      channel: opts.channel,
    },
  });

  if (effectiveIntent === "board_briefing" || effectiveIntent === "capital_strategy") {
    await createLeadershipAlert({
      alertType: "aura_executive_orchestration",
      title:
        effectiveIntent === "board_briefing"
          ? "Board briefing prepared by AURA executive agents"
          : "Capital strategy draft prepared by AURA executive agents",
      message: synthesized.speechSummary.slice(0, 400),
      priority: "high",
      sourceModule: "aura_multi_agent",
      sourceId: orchestrationId,
      path: "/hq/aura",
    }).catch(() => undefined);
  }

  return {
    orchestrationId,
    generatedAt: new Date().toISOString(),
    request: opts.request,
    intent: effectiveIntent,
    agentsInvoked: agents,
    contributions,
    unifiedBriefing: synthesized.unifiedBriefing,
    speechSummary: synthesized.speechSummary,
    smsSummary: synthesized.smsSummary,
    founderApprovalRequired,
    approvalsNeeded: synthesized.approvalsNeeded,
    nextActions: synthesized.nextActions,
  };
}
