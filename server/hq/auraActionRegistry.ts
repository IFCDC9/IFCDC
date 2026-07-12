/**
 * AURA Action Registry — the catalog of real actions AURA can perform across HQ.
 *
 * Every action wraps an existing production engine (no duplicated logic) and is
 * classified by `kind`:
 *   - "read":     safe, non-mutating (queries, summaries, navigation)
 *   - "prepare":  creates drafts / staged items for review
 *   - "execute":  Founder Mode (or authorized role) runs real HQ operations
 *                 (email, SMS, calendar, documents, diagnostics). High-impact
 *                 irreversible ops still stage for Founder confirmation.
 */

import {
  buildOrgWideGrantMatches,
  matchOpportunitiesForProgram,
  runGrantIntelligenceSync,
  startGrantApplicationWorkflow,
  generateFullProposalDraft,
  resolveProgramSlugFromQuery,
} from "./grantIntelligenceEngine";
import {
  startEnterpriseFundingScanJob,
  formatEnterpriseJobAck,
} from "./grantEnterpriseDirectorEngine";
import { assistWriterSectionProduction } from "./grantWriterEngine";
import { executeCopilotAutomation } from "./auraExecutiveCopilot";
import { parseNavigationIntent } from "./auraNlNavigation";
import { createWorkflowInstance } from "./workflowEngine";
import { buildAuraExecutiveContext } from "./auraExecutiveContext";
import { auraExecutiveChat } from "../lib/ifcdc";
import {
  detectHighImpactBlockedIntent,
  executeSendEmail,
  executeSendSms,
  executePlaceCall,
  executeSendNotification,
  executeBroadcastAnnouncement,
  executeScheduleReminder,
  executeCreateCalendarEvent,
  executeCancelCalendarEvent,
  executeSaveReport,
  executeGenerateExecutiveReport,
  executeEnterpriseDiagnostics,
  executePreparePayrollSummary,
  executeComplianceReport,
  executeQueueGrantSubmission,
  executeNotifyWhenFinished,
} from "./auraExecutiveOperations";

export type AuraActionKind = "read" | "prepare" | "execute";

export type AuraModule =
  | "grants"
  | "finance"
  | "hr"
  | "communications"
  | "documents"
  | "executive"
  | "workflow"
  | "software"
  | "integrations"
  | "global";

import type { AuraTrustedIdentity } from "./auraFounderTrustEngine";

export interface AuraActionContext {
  actorEmail: string;
  module?: string;
  /** Page-supplied entity references, e.g. { applicationId, workflowInstanceId, reportType, programSlug }. */
  contextRef?: Record<string, unknown>;
  /** Resolved Founder Identity & Trust session for this turn. */
  identity?: AuraTrustedIdentity;
}

export interface AuraActionResult {
  status: "done" | "prepared" | "pending_approval" | "error";
  summary: string;
  data?: unknown;
  navigation?: { path: string; label: string };
  /** When an item was staged for the founder, a link to the approval queue. */
  approval?: { path: string; label: string };
}

export interface AuraAction {
  id: string;
  label: string;
  module: AuraModule;
  kind: AuraActionKind;
  description: string;
  /** JSON-schema "properties" object for LLM function-calling. */
  parameters: Record<string, unknown>;
  run(args: Record<string, unknown>, ctx: AuraActionContext): Promise<AuraActionResult>;
}

const FOUNDER_EMAIL = process.env.MASTER_OWNER_EMAIL || "service@ifcdc.org";
const APPROVAL_LINK = { path: "/hq/workflows", label: "Review in Workflow Automation" };

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function ctxRef(ctx: AuraActionContext, key: string): string | undefined {
  return str(ctx.contextRef?.[key]);
}

/** High-impact irreversible verbs — stage for Founder confirmation (not casual email/SMS). */
export function detectBlockedIntent(command: string): string | null {
  return detectHighImpactBlockedIntent(command);
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

const findGrants: AuraAction = {
  id: "find_grants",
  label: "Find Funding",
  module: "grants",
  kind: "read",
  description:
    "Find and rank live grant opportunities from Grants.gov/SAM.gov for IFCDC. Optionally filter by program and sort by fit, funding size, or deadline.",
  parameters: {
    program: { type: "string", description: "Program slug or name (e.g. housing, youth, mental_health). Optional." },
    sort: { type: "string", enum: ["fit", "funding", "deadline"], description: "Ranking order. Default fit." },
    query: { type: "string", description: "Free-text focus for the search. Optional." },
    limit: { type: "number", description: "Max results (default 50 for org-wide, 25 for program)." },
  },
  async run(args, ctx) {
    const program =
      str(args.program) ?? ctxRef(ctx, "programSlug") ?? (str(args.query) ? resolveProgramSlugFromQuery(String(args.query)) : undefined);
    const sort = (str(args.sort) as "fit" | "funding" | "deadline") ?? "fit";
    const defaultLimit = program ? 25 : 50;
    const limit = typeof args.limit === "number" ? args.limit : defaultLimit;
    const result = (await buildOrgWideGrantMatches({
      programSlug: program,
      sort,
      limit,
      q: str(args.query),
      actorEmail: ctx.actorEmail,
    })) as { matches?: unknown[] };
    const matches = Array.isArray(result.matches) ? result.matches : [];
    return {
      status: "done",
      summary: `Found ${matches.length} live opportunit${matches.length === 1 ? "y" : "ies"}${program ? ` for ${program}` : " across IFCDC programs"}, ranked by ${sort}.`,
      data: { matches: matches.slice(0, limit) },
      navigation: { path: "/hq/grants", label: "Open Grant Center" },
    };
  },
};

const matchProgram: AuraAction = {
  id: "match_grants_to_program",
  label: "Match Grants to Program",
  module: "grants",
  kind: "read",
  description: "Match live grant opportunities to a specific IFCDC program or division.",
  parameters: {
    program: { type: "string", description: "Program slug or name (required)." },
    limit: { type: "number", description: "Max results (default 15)." },
  },
  async run(args, ctx) {
    const program = str(args.program) ?? ctxRef(ctx, "programSlug");
    if (!program) return { status: "error", summary: "Which program should I match grants to?" };
    const slug = resolveProgramSlugFromQuery(program) ?? program;
    const limit = typeof args.limit === "number" ? args.limit : 15;
    const result = (await matchOpportunitiesForProgram(slug, limit)) as { matches?: unknown[] };
    const matches = Array.isArray(result.matches) ? result.matches : [];
    return {
      status: "done",
      summary: `Matched ${matches.length} opportunit${matches.length === 1 ? "y" : "ies"} to ${slug}.`,
      data: { matches },
      navigation: { path: "/hq/grants", label: "Open Grant Center" },
    };
  },
};

const syncGrants: AuraAction = {
  id: "sync_grants",
  label: "Sync Grant Feeds",
  module: "grants",
  kind: "prepare",
  description: "Refresh live grant intelligence from Grants.gov and SAM.gov and enrich opportunities.",
  parameters: {},
  async run(_args, ctx) {
    const sync = (await runGrantIntelligenceSync({ actorEmail: ctx.actorEmail })) as {
      enriched?: number;
      deadlinesFilled?: number;
    };
    return {
      status: "done",
      summary: `Synced live grant feeds — enriched ${sync.enriched ?? 0} opportunities and filled ${sync.deadlinesFilled ?? 0} missing deadlines.`,
      data: sync,
      navigation: { path: "/hq/grants", label: "Open Grant Center" },
    };
  },
};

const enterpriseFundingScan: AuraAction = {
  id: "enterprise_funding_scan",
  label: "Enterprise Funding Scan",
  module: "grants",
  kind: "prepare",
  description:
    "Run IFCDC Enterprise Grants Mode: scan every program, department, and initiative; return a complete Executive Funding Report; populate the Enterprise Funding Pipeline; and prepare draft proposals for all qualified opportunities (founder approval required before submission).",
  parameters: {
    syncFeeds: { type: "boolean", description: "Refresh Grants.gov/SAM.gov feeds before scanning. Default true." },
    prepareDrafts: { type: "boolean", description: "Queue full proposal drafts for qualified matches (composite >= 60). Default true." },
    minScore: { type: "number", description: "Minimum match score to include (default 40)." },
  },
  async run(args, ctx) {
    const syncFeeds = args.syncFeeds !== false;
    const prepareDrafts = args.prepareDrafts !== false;
    const minScore = typeof args.minScore === "number" ? args.minScore : undefined;
    const started = await startEnterpriseFundingScanJob({
      actorEmail: ctx.actorEmail,
      syncFeeds,
      populatePipeline: true,
      prepareDrafts,
      minScore,
    });
    return {
      status: "prepared",
      summary: formatEnterpriseJobAck(started.jobId, prepareDrafts),
      data: {
        jobId: started.jobId,
        status: started.status,
        prepareDrafts,
        narrative: formatEnterpriseJobAck(started.jobId, prepareDrafts),
      },
      navigation: { path: `/hq/grants?tab=pipeline&enterpriseJob=${started.jobId}`, label: "Track Enterprise Scan" },
      approval: APPROVAL_LINK,
    };
  },
};

const startApplication: AuraAction = {
  id: "start_application",
  label: "Start Application Workspace",
  module: "grants",
  kind: "prepare",
  description:
    "Create a grant application workspace for an opportunity (seeds writer sections and deadlines). The draft lands in the founder approval queue; nothing is submitted.",
  parameters: {
    opportunityId: { type: "string", description: "Grant opportunity id (required)." },
  },
  async run(args, ctx) {
    const opportunityId = str(args.opportunityId) ?? ctxRef(ctx, "opportunityId");
    if (!opportunityId) return { status: "error", summary: "Which opportunity should I open a workspace for?" };
    const result = (await startGrantApplicationWorkflow(opportunityId, {
      actorEmail: ctx.actorEmail,
      generateDrafts: false,
    })) as { ok?: boolean; applicationId?: string; error?: string };
    if (!result.ok) return { status: "error", summary: result.error ?? "Could not start application." };
    return {
      status: "prepared",
      summary: "Application workspace created. It is staged for your review — human approval is required before any federal submission.",
      data: result,
      navigation: { path: `/hq/grants?application=${result.applicationId}`, label: "Open workspace" },
      approval: APPROVAL_LINK,
    };
  },
};

const draftProposal: AuraAction = {
  id: "draft_proposal",
  label: "Draft Full Proposal",
  module: "grants",
  kind: "prepare",
  description:
    "Generate a full grant proposal draft (all sections) for an application using live IFCDC data. Runs as a background job and resets founder approval to pending.",
  parameters: {
    applicationId: { type: "string", description: "Grant application id (required)." },
  },
  async run(args, ctx) {
    const applicationId = str(args.applicationId) ?? ctxRef(ctx, "applicationId");
    if (!applicationId) return { status: "error", summary: "Which application should I draft?" };
    const job = (await generateFullProposalDraft(applicationId, { actorEmail: ctx.actorEmail })) as {
      jobId?: string;
    };
    return {
      status: "prepared",
      summary: "AURA is drafting the full proposal from live IFCDC data. When it finishes it will be staged for your approval — it will not be submitted automatically.",
      data: job,
      navigation: { path: `/hq/grants?application=${applicationId}`, label: "Open Grant Writer Studio" },
      approval: APPROVAL_LINK,
    };
  },
};

const draftSection: AuraAction = {
  id: "draft_section",
  label: "Draft Section with AURA",
  module: "grants",
  kind: "prepare",
  description: "Draft or regenerate a single proposal section for an application using live IFCDC data.",
  parameters: {
    applicationId: { type: "string", description: "Grant application id (required)." },
    sectionKey: { type: "string", description: "Section key, e.g. executive_summary, need_statement, budget_narrative (required)." },
    instruction: { type: "string", description: "Optional extra guidance for the section." },
  },
  async run(args, ctx) {
    const applicationId = str(args.applicationId) ?? ctxRef(ctx, "applicationId");
    const sectionKey = str(args.sectionKey) ?? ctxRef(ctx, "sectionKey");
    if (!applicationId || !sectionKey) {
      return { status: "error", summary: "I need both an application and a section to draft." };
    }
    const result = await assistWriterSectionProduction(
      applicationId,
      sectionKey,
      str(args.instruction),
      ctx.actorEmail
    );
    return {
      status: "prepared",
      summary: `Drafted the ${sectionKey.replace(/_/g, " ")} section. Review and edit before it goes to your approval queue.`,
      data: result,
      navigation: { path: `/hq/grants?application=${applicationId}`, label: "Open Grant Writer Studio" },
      approval: APPROVAL_LINK,
    };
  },
};

const summarize: AuraAction = {
  id: "summarize",
  label: "Summarize with AURA",
  module: "global",
  kind: "read",
  description: "Summarize a report, module, or the current context into an executive brief with key findings and recommended actions.",
  parameters: {
    topic: { type: "string", description: "What to summarize (e.g. 'the board report', 'this month's finances')." },
  },
  async run(args, ctx) {
    const context = await buildAuraExecutiveContext();
    const topic = str(args.topic) ?? ctxRef(ctx, "topic") ?? (ctx.module ? `the ${ctx.module} module` : "the organization");
    const reply = await auraExecutiveChat(
      `Summarize ${topic} as a concise executive brief with key findings and 3 recommended actions.`,
      context
    );
    return { status: "done", summary: reply };
  },
};

const generateReport: AuraAction = {
  id: "generate_report",
  label: "Generate Report",
  module: "executive",
  kind: "read",
  description: "Generate an executive report (financial, grants, operations, or a full organization report).",
  parameters: {
    reportType: { type: "string", enum: ["financial", "grants", "operations", "full"], description: "Report type. Default full." },
  },
  async run(args, ctx) {
    const context = await buildAuraExecutiveContext();
    const reportType = str(args.reportType) ?? ctxRef(ctx, "reportType") ?? "full";
    const prompts: Record<string, string> = {
      financial: "Generate an executive financial report covering revenue, cash flow, donations, expenses, and budget health.",
      grants: "Generate an executive grant portfolio report covering active awards, pipeline, compliance, and win rate.",
      operations: "Generate an executive operations report covering programs, facilities, compliance risks, and calendar.",
      full: "Generate a comprehensive executive organization report covering all IFCDC Headquarters modules.",
    };
    const reply = await auraExecutiveChat(prompts[reportType] ?? prompts.full, context);
    return { status: "done", summary: reply, data: { reportType } };
  },
};

const navigate: AuraAction = {
  id: "navigate",
  label: "Navigate",
  module: "global",
  kind: "read",
  description: "Navigate to an HQ module or page.",
  parameters: {
    destination: { type: "string", description: "Where to go, e.g. 'finance', 'grant center', 'workflow automation'." },
  },
  async run(args) {
    const destination = str(args.destination);
    if (!destination) return { status: "error", summary: "Where would you like to go?" };
    const nav = parseNavigationIntent(destination);
    if (!nav) return { status: "error", summary: `I could not find a module matching "${destination}".` };
    return { status: "done", summary: `Opening ${nav.label}.`, navigation: { path: nav.path, label: nav.label } };
  },
};

const createTask: AuraAction = {
  id: "create_task",
  label: "Create Task",
  module: "workflow",
  kind: "prepare",
  description: "Create an executive task assigned to a team member. Appears in Workflow Automation.",
  parameters: {
    title: { type: "string", description: "Task title (required)." },
    assignedTo: { type: "string", description: "Assignee email. Optional (defaults to founder)." },
  },
  async run(args, ctx) {
    const title = str(args.title);
    if (!title) return { status: "error", summary: "What should the task be?" };
    const result = await executeCopilotAutomation("task_assignment", {
      title,
      assignedTo: str(args.assignedTo) ?? ctx.actorEmail,
    });
    return {
      status: "prepared",
      summary: `Created task "${title}".`,
      data: result,
      navigation: APPROVAL_LINK,
    };
  },
};

const explain: AuraAction = {
  id: "explain",
  label: "Explain This",
  module: "global",
  kind: "read",
  description: "Explain the current page, metric, record, or workflow in plain language using live HQ context.",
  parameters: {
    subject: { type: "string", description: "What to explain." },
  },
  async run(args, ctx) {
    const context = await buildAuraExecutiveContext();
    const subject = str(args.subject) ?? ctxRef(ctx, "subject") ?? (ctx.module ? `the ${ctx.module} module` : "this page");
    const reply = await auraExecutiveChat(
      `Explain ${subject} to the founder in plain language: what it shows, why it matters, and what to watch. Be concise.`,
      context
    );
    return { status: "done", summary: reply };
  },
};

const prepareForApproval: AuraAction = {
  id: "prepare_for_approval",
  label: "Prepare for Approval",
  module: "workflow",
  kind: "prepare",
  description:
    "Stage an item for founder review in the approval queue. Used to route grant drafts, documents, or reports to the founder. Never approves or submits — only stages.",
  parameters: {
    title: { type: "string", description: "What is being sent for approval." },
    applicationId: { type: "string", description: "Grant application id, if applicable. Optional." },
  },
  async run(args, ctx) {
    const applicationId = str(args.applicationId) ?? ctxRef(ctx, "applicationId");
    const title = str(args.title) ?? (applicationId ? "Grant draft for founder review" : `${ctx.module ?? "Item"} for founder review`);
    const instance = await createWorkflowInstance({
      workflowKey: "board_approval",
      title,
      entityType: applicationId ? "grant_founder_approval" : "aura_review",
      entityId: applicationId,
      assignedTo: FOUNDER_EMAIL,
      priority: "high",
      payload: { stagedBy: "aura", module: ctx.module ?? "global", requestedBy: ctx.actorEmail },
    });
    return {
      status: "pending_approval",
      summary: `"${title}" is staged for your approval. Nothing will be submitted, sent, or finalized until you approve it.`,
      data: instance,
      approval: APPROVAL_LINK,
    };
  },
};

const knowledgeLookup: AuraAction = {
  id: "knowledge_lookup",
  label: "Look Up IFCDC Data",
  module: "global",
  kind: "read",
  description:
    "Retrieve verified IFCDC institutional data (budgets, program descriptions, financials, registration, mission/vision, prior approved narratives) from the organizational knowledge base and answer grounded in those sources.",
  parameters: {
    query: { type: "string", description: "What IFCDC information to retrieve (required)." },
  },
  async run(args, _ctx) {
    const query = str(args.query);
    if (!query) return { status: "error", summary: "What IFCDC information should I look up?" };
    const { retrieveKnowledge } = await import("./knowledgeBaseEngine");
    const results = await retrieveKnowledge(query, { topK: 6 });
    if (!results.length) {
      return {
        status: "done",
        summary:
          "The knowledge base has no indexed IFCDC records for that yet. Open the AURA Knowledge Base and run Reindex from HQ, or upload the source document.",
        navigation: { path: "/hq/knowledge", label: "Open AURA Knowledge Base" },
      };
    }
    const grounding = results
      .map((r, i) => `[Source ${i + 1}] ${r.title} (${r.sourceType})\n${r.content.slice(0, 1200)}`)
      .join("\n\n");
    const reply = await auraExecutiveChat(
      `Answer this using ONLY the IFCDC knowledge base sources below. Cite figures exactly; do not invent data.\n\nQuestion: ${query}\n\n${grounding}`,
      "You are AURA, IFCDC's institutional grant writer. Ground every answer in the provided IFCDC sources."
    );
    return {
      status: "done",
      summary: reply,
      data: { sources: results.map((r) => ({ title: r.title, sourceType: r.sourceType, score: r.score })) },
      navigation: { path: "/hq/knowledge", label: "Open AURA Knowledge Base" },
    };
  },
};

const fixWorkflow: AuraAction = {
  id: "fix_workflow",
  label: "Fix This Workflow",
  module: "workflow",
  kind: "prepare",
  description: "Analyze a workflow or scheduled job and recommend corrective steps. Recommends only — does not change or run anything without approval.",
  parameters: {
    workflowInstanceId: { type: "string", description: "Workflow instance or job id. Optional." },
    problem: { type: "string", description: "What seems wrong. Optional." },
  },
  async run(args, ctx) {
    const context = await buildAuraExecutiveContext();
    const ref = str(args.workflowInstanceId) ?? ctxRef(ctx, "workflowInstanceId") ?? "the selected workflow";
    const problem = str(args.problem) ?? ctxRef(ctx, "problem") ?? "review its status and recent failures";
    const reply = await auraExecutiveChat(
      `A workflow (${ref}) needs attention: ${problem}. Diagnose the likely cause and give the founder a short, numbered corrective plan. Recommend only — do not take action.`,
      context
    );
    return {
      status: "done",
      summary: reply,
      navigation: { path: "/hq/workflows", label: "Open Workflow Automation" },
    };
  },
};

const techBriefing: AuraAction = {
  id: "tech_system_briefing",
  label: "Technical System Briefing",
  module: "executive",
  kind: "read",
  description:
    "Founder-only live Technical Command briefing: health score, critical failures, degraded integrations, GitHub vs Render alignment, and fix-first priorities.",
  parameters: {
    focus: {
      type: "string",
      enum: ["full", "deploy", "integrations", "apis"],
      description: "Optional focus area.",
    },
  },
  async run(args, ctx) {
    if (!ctx.identity?.founderMode) {
      return { status: "error", summary: "Technical Command Mode requires Founder Mode." };
    }
    const { handleTechnicalCommand } = await import("./auraTechnicalCommandEngine");
    const focus = str(args.focus);
    const command =
      focus === "deploy"
        ? "Compare GitHub main to Render live"
        : focus === "integrations"
          ? "Check all integrations"
          : focus === "apis"
            ? "Show me failed APIs and run a safe smoke check"
            : "Check the entire system and give me a technical briefing";
    const result = await handleTechnicalCommand({
      command,
      channel: "hq_web",
      actorEmail: ctx.actorEmail,
      founderMode: true,
    });
    return {
      status: result.ok ? "done" : "error",
      summary: result.reply,
      data: result.briefing,
      navigation: { path: "/hq/aura", label: "Open AURA Command" },
    };
  },
};

const techOpenTicket: AuraAction = {
  id: "tech_open_repair_ticket",
  label: "Open Technical Repair Ticket",
  module: "executive",
  kind: "prepare",
  description:
    "Founder-only: open a repair ticket for Tessa from the live Technical Command diagnosis. Does not deploy or change production.",
  parameters: {
    title: { type: "string", description: "Optional ticket title." },
    notes: { type: "string", description: "Optional Founder notes." },
  },
  async run(args, ctx) {
    if (!ctx.identity?.founderMode) {
      return { status: "error", summary: "Technical Command Mode requires Founder Mode." };
    }
    const { handleTechnicalCommand } = await import("./auraTechnicalCommandEngine");
    const notes = str(args.notes) || str(args.title) || "Create a repair task for Tessa";
    const result = await handleTechnicalCommand({
      command: `Create a repair task for Tessa. ${notes}`,
      channel: "hq_web",
      actorEmail: ctx.actorEmail,
      founderMode: true,
    });
    return {
      status: result.ticketId ? "prepared" : result.ok ? "done" : "error",
      summary: result.reply,
      data: { ticketId: result.ticketId, briefing: result.briefing },
      approval: { path: "/hq/aura", label: "Review Technical Command tickets" },
    };
  },
};

const orgMemoryLookup: AuraAction = {
  id: "org_memory_lookup",
  label: "Organizational Memory Lookup",
  module: "executive",
  kind: "read",
  description:
    "Retrieve verified IFCDC organizational facts from the approved Knowledge Base. Separates facts from recommendations and lists gaps.",
  parameters: {
    query: { type: "string", description: "What organizational fact to retrieve." },
  },
  async run(args, ctx) {
    if (!ctx.identity?.founderMode && !ctx.identity?.isFounder) {
      return { status: "error", summary: "Organizational Memory requires Founder Mode for confidential domains." };
    }
    const { retrieveOrganizationalMemory } = await import("./auraOrganizationalMemory");
    const memory = await retrieveOrganizationalMemory(str(args.query) || "IFCDC mission and programs", { topK: 8 });
    return {
      status: "done",
      summary: memory.speechSummary,
      data: memory,
      navigation: { path: "/hq/knowledge", label: "Open Knowledge Base" },
    };
  },
};

const decisionSupportAsk: AuraAction = {
  id: "decision_support_ask",
  label: "Cross-Module Decision Support",
  module: "executive",
  kind: "read",
  description:
    "Cross-module Founder decision support with live facts, options, risks, citations, and whether Founder approval is required. Use for hire/affordability and multi-module tradeoffs.",
  parameters: {
    question: { type: "string", description: "Decision question." },
  },
  async run(args, ctx) {
    if (!ctx.identity?.founderMode && !ctx.identity?.isFounder) {
      return { status: "error", summary: "Decision Support requires Founder Mode." };
    }
    const { answerDecisionSupportQuestion } = await import("./auraDecisionSupport");
    const result = await answerDecisionSupportQuestion(str(args.question) || "What needs Founder attention?");
    return {
      status: "done",
      summary: result.speechSummary,
      data: result,
      navigation: { path: "/hq/aura", label: "Open AURA Command" },
      approval: result.founderApprovalRequired
        ? { path: "/hq/workflows", label: "Founder approval may be required" }
        : undefined,
    };
  },
};

const intelligenceMetrics: AuraAction = {
  id: "intelligence_metrics",
  label: "AURA Intelligence Metrics",
  module: "executive",
  kind: "read",
  description: "Show AURA Intelligence Dashboard metrics: commands, tool success, knowledge quality, gaps, and upgrade recommendations.",
  parameters: {},
  async run(_args, ctx) {
    if (!ctx.identity?.founderMode && !ctx.identity?.isFounder) {
      return { status: "error", summary: "Intelligence metrics require Founder access." };
    }
    const { buildAuraIntelligenceMetrics } = await import("./auraIntelligenceMetrics");
    const metrics = await buildAuraIntelligenceMetrics();
    return {
      status: "done",
      summary: `AURA Intelligence: ${metrics.commands.total24h} HQ intelligence events in 24h; tech score ${metrics.technical.healthScore ?? "n/a"}; ${metrics.outstandingGaps.length} outstanding gaps.`,
      data: metrics,
      navigation: { path: "/hq/aura", label: "Open AURA Intelligence" },
    };
  },
};

const executiveAgentTeam: AuraAction = {
  id: "executive_agent_team",
  label: "Executive Agent Team",
  module: "executive",
  kind: "read",
  description:
    "Founder-only multi-agent orchestration. AURA delegates to CFO, Grants, CTO, HR, Operations, Compliance, Communications, Knowledge, and Analyst specialists, then returns one unified executive briefing. Use for board meeting prep or capital/funding strategy.",
  parameters: {
    request: { type: "string", description: "Executive request, e.g. prepare board meeting or raise $10 million strategy." },
  },
  async run(args, ctx) {
    if (!ctx.identity?.founderMode && !ctx.identity?.isFounder) {
      return { status: "error", summary: "Executive Agent Team requires Founder Mode." };
    }
    const { runEnterpriseBrain } = await import("./auraEnterpriseBrain");
    const result = await runEnterpriseBrain({
      request: str(args.request) || "Prepare an executive multi-agent briefing",
      channel: "hq_web",
      actorEmail: ctx.actorEmail,
      founderMode: true,
    });
    return {
      status: "done",
      summary: result.speechSummary,
      data: result,
      navigation: { path: "/hq/aura", label: "Open AURA Command" },
      approval: result.founderApprovalRequired
        ? { path: "/hq/workflows", label: "Founder approval required for execution" }
        : undefined,
    };
  },
};

const enterpriseBrain: AuraAction = {
  id: "enterprise_brain",
  label: "Enterprise Brain 2.0",
  module: "executive",
  kind: "read",
  description:
    "AURA Enterprise Brain 2.0 — daily briefing, digital org model, predictive risks, strategic goals proximity, and Founder focus list. Uses live HQ data only.",
  parameters: {
    request: {
      type: "string",
      description: "e.g. daily briefing, what should I work on today, biggest risks, strategic goals",
    },
  },
  async run(args, ctx) {
    if (!ctx.identity?.founderMode && !ctx.identity?.isFounder) {
      return { status: "error", summary: "Enterprise Brain requires Founder Mode." };
    }
    const { runEnterpriseBrain } = await import("./auraEnterpriseBrain");
    const result = await runEnterpriseBrain({
      request: str(args.request) || "What should I work on today?",
      channel: "hq_web",
      actorEmail: ctx.actorEmail,
      founderMode: true,
    });
    return {
      status: "done",
      summary: result.speechSummary,
      data: result,
      navigation: { path: "/hq/aura", label: "Open AURA Command" },
      approval: result.founderApprovalRequired
        ? { path: "/hq/workflows", label: "Founder approval required for execution" }
        : undefined,
    };
  },
};

const executiveDecisionIntelligence: AuraAction = {
  id: "executive_decision_intelligence",
  label: "Executive Decision Intelligence",
  module: "executive",
  kind: "read",
  description:
    "AURA Enterprise Brain 3.0 — Executive Decision Intelligence: apply/hire/expand/afford, multi-scenario what-if, scorecard, strategic goals, opportunities, weekly review. Live HQ evidence; Founder approval for major actions.",
  parameters: {
    request: {
      type: "string",
      description: "e.g. Should we hire five employees? What happens if we receive a $2 million grant?",
    },
  },
  async run(args, ctx) {
    if (!ctx.identity?.founderMode && !ctx.identity?.isFounder) {
      return { status: "error", summary: "Executive Decision Intelligence requires Founder Mode." };
    }
    const { runExecutiveDecisionIntelligence } = await import("./auraExecutiveDecisionIntelligence");
    const result = await runExecutiveDecisionIntelligence({
      request: str(args.request) || "Show the Enterprise Brain 3.0 Dashboard",
      channel: "hq_web",
      founderMode: true,
    });
    return {
      status: "done",
      summary: result.speechSummary,
      data: result,
      navigation: { path: "/hq/executive-brain", label: "Open Enterprise Brain Dashboard" },
      approval: result.founderApprovalRequired
        ? { path: "/hq/workflows", label: "Founder approval required for execution" }
        : undefined,
    };
  },
};

const enterpriseOs: AuraAction = {
  id: "enterprise_os",
  label: "Enterprise OS 4.0",
  module: "executive",
  kind: "read",
  description:
    "AURA Enterprise OS 4.0 — Mission Control, autonomous workflows, task orchestration, knowledge graph, enterprise search, scenario planning, executive automation. Founder approval for high-impact actions.",
  parameters: {
    request: {
      type: "string",
      description: "e.g. Show Mission Control, orchestrate grant opportunity, knowledge graph, monthly board packet",
    },
  },
  async run(args, ctx) {
    if (!ctx.identity?.founderMode && !ctx.identity?.isFounder) {
      return { status: "error", summary: "Enterprise OS requires Founder Mode." };
    }
    const { runEnterpriseOs } = await import("./auraEnterpriseOs4");
    const result = await runEnterpriseOs({
      request: str(args.request) || "Show Mission Control",
      channel: "hq_web",
      founderMode: true,
      actorEmail: ctx.actorEmail,
    });
    return {
      status: "done",
      summary: result.speechSummary,
      data: result,
      navigation: { path: "/hq/enterprise-os", label: "Open Enterprise OS Mission Control" },
      approval: result.founderApprovalRequired
        ? { path: "/hq/workflows", label: "Founder approval required for execution" }
        : undefined,
    };
  },
};

// ---------------------------------------------------------------------------
// Executive Operations (Founder Mode execute)
// ---------------------------------------------------------------------------

const sendEmail: AuraAction = {
  id: "send_email",
  label: "Send Email",
  module: "communications",
  kind: "execute",
  description:
    "Founder Mode: actually send an email via Resend. Use for 'email service@…', 'email the Board', or reply-style messages. Requires to, subject, body.",
  parameters: {
    to: { type: "string", description: "Recipient email, comma-separated list, or 'board'." },
    subject: { type: "string", description: "Email subject." },
    body: { type: "string", description: "Email body (plain text)." },
  },
  async run(args, ctx) {
    return executeSendEmail(args, ctx);
  },
};

const sendSms: AuraAction = {
  id: "send_sms",
  label: "Send SMS",
  module: "communications",
  kind: "execute",
  description: "Founder Mode: send SMS via Twilio. Use to='founder' or E.164 number.",
  parameters: {
    to: { type: "string", description: "Phone E.164 or 'founder'." },
    body: { type: "string", description: "SMS body (max ~320 chars)." },
  },
  async run(args, ctx) {
    return executeSendSms(args, ctx);
  },
};

const placeCall: AuraAction = {
  id: "place_call",
  label: "Place Phone Call",
  module: "communications",
  kind: "execute",
  description: "Founder Mode: place an outbound Twilio call (e.g. 'Call me').",
  parameters: {
    to: { type: "string", description: "Phone E.164 or 'founder'." },
    message: { type: "string", description: "Spoken message." },
  },
  async run(args, ctx) {
    return executePlaceCall(args, ctx);
  },
};

const sendNotification: AuraAction = {
  id: "send_notification",
  label: "Send HQ Notification",
  module: "communications",
  kind: "execute",
  description: "Founder Mode: post a Headquarters leadership notification and email the Founder.",
  parameters: {
    title: { type: "string" },
    message: { type: "string" },
  },
  async run(args, ctx) {
    return executeSendNotification(args, ctx);
  },
};

const broadcastAnnouncement: AuraAction = {
  id: "broadcast_announcement",
  label: "Broadcast Announcement",
  module: "communications",
  kind: "execute",
  description:
    "Founder Mode: publish an org announcement. High-impact — stages for confirmation unless confirmed=true.",
  parameters: {
    title: { type: "string" },
    body: { type: "string" },
    priority: { type: "string", enum: ["normal", "high"] },
    confirmed: { type: "boolean", description: "Set true only after Founder confirms publish." },
  },
  async run(args, ctx) {
    return executeBroadcastAnnouncement(args, ctx);
  },
};

const scheduleReminder: AuraAction = {
  id: "schedule_reminder",
  label: "Schedule Reminder",
  module: "workflow",
  kind: "execute",
  description: "Founder Mode: schedule a follow-up reminder in Workflows + HQ alert.",
  parameters: {
    title: { type: "string" },
    message: { type: "string" },
  },
  async run(args, ctx) {
    return executeScheduleReminder(args, ctx);
  },
};

const createCalendarEvent: AuraAction = {
  id: "create_calendar_event",
  label: "Create Calendar Event",
  module: "executive",
  kind: "execute",
  description: "Founder Mode: create a real HQ calendar meeting/event.",
  parameters: {
    title: { type: "string" },
    description: { type: "string" },
    startAt: { type: "string", description: "ISO start time. Optional — defaults to +1 hour." },
    endAt: { type: "string" },
    location: { type: "string" },
  },
  async run(args, ctx) {
    return executeCreateCalendarEvent(args, ctx);
  },
};

const cancelCalendarEvent: AuraAction = {
  id: "cancel_calendar_event",
  label: "Cancel Calendar Event",
  module: "executive",
  kind: "execute",
  description: "Founder Mode: cancel a matching HQ calendar event.",
  parameters: {
    query: { type: "string", description: "Title/keywords to match." },
    title: { type: "string" },
  },
  async run(args, ctx) {
    return executeCancelCalendarEvent(args, ctx);
  },
};

const createDocument: AuraAction = {
  id: "create_document",
  label: "Create / Save Document",
  module: "documents",
  kind: "execute",
  description: "Founder Mode: save a report/document into Document Center.",
  parameters: {
    title: { type: "string" },
    body: { type: "string" },
  },
  async run(args, ctx) {
    return executeSaveReport(args, ctx);
  },
};

const generateExecutiveReport: AuraAction = {
  id: "generate_executive_report",
  label: "Generate Executive Report",
  module: "executive",
  kind: "execute",
  description: "Founder Mode: generate today's executive report from live HQ data and save it.",
  parameters: {
    request: { type: "string" },
  },
  async run(args, ctx) {
    return executeGenerateExecutiveReport(args, ctx);
  },
};

const enterpriseDiagnostics: AuraAction = {
  id: "enterprise_diagnostics",
  label: "Enterprise Diagnostics",
  module: "executive",
  kind: "execute",
  description: "Founder Mode: run live Technical Command / enterprise diagnostics across HQ modules.",
  parameters: {
    request: { type: "string" },
  },
  async run(args, ctx) {
    return executeEnterpriseDiagnostics(args, ctx);
  },
};

const preparePayroll: AuraAction = {
  id: "prepare_payroll_summary",
  label: "Prepare Payroll",
  module: "hr",
  kind: "execute",
  description:
    "Founder Mode: prepare a payroll summary from live data. Does NOT run payroll or issue payments — stages for approval.",
  parameters: {},
  async run(args, ctx) {
    return executePreparePayrollSummary(args, ctx);
  },
};

const complianceReport: AuraAction = {
  id: "generate_compliance_report",
  label: "Generate Compliance Report",
  module: "executive",
  kind: "execute",
  description: "Founder Mode: generate and save a compliance report from Mission Control.",
  parameters: {},
  async run(args, ctx) {
    return executeComplianceReport(args, ctx);
  },
};

const queueGrantSubmission: AuraAction = {
  id: "queue_grant_submission",
  label: "Queue Grant Submission",
  module: "grants",
  kind: "execute",
  description:
    "Founder Mode: queue a grant application for submission. NEVER submits externally — always waits for Founder approval.",
  parameters: {
    applicationId: { type: "string" },
    note: { type: "string" },
  },
  async run(args, ctx) {
    return executeQueueGrantSubmission(args, ctx);
  },
};

const notifyWhenFinished: AuraAction = {
  id: "notify_when_finished",
  label: "Notify When Finished",
  module: "communications",
  kind: "execute",
  description: "Founder Mode: register a completion notification (HQ + SMS).",
  parameters: {
    message: { type: "string" },
  },
  async run(args, ctx) {
    return executeNotifyWhenFinished(args, ctx);
  },
};

export const AURA_ACTIONS: AuraAction[] = [
  findGrants,
  enterpriseFundingScan,
  matchProgram,
  syncGrants,
  startApplication,
  draftProposal,
  draftSection,
  summarize,
  generateReport,
  navigate,
  createTask,
  explain,
  prepareForApproval,
  fixWorkflow,
  knowledgeLookup,
  techBriefing,
  techOpenTicket,
  orgMemoryLookup,
  decisionSupportAsk,
  intelligenceMetrics,
  executiveAgentTeam,
  enterpriseBrain,
  executiveDecisionIntelligence,
  enterpriseOs,
  sendEmail,
  sendSms,
  placeCall,
  sendNotification,
  broadcastAnnouncement,
  scheduleReminder,
  createCalendarEvent,
  cancelCalendarEvent,
  createDocument,
  generateExecutiveReport,
  enterpriseDiagnostics,
  preparePayroll,
  complianceReport,
  queueGrantSubmission,
  notifyWhenFinished,
];

const ACTION_MAP = new Map(AURA_ACTIONS.map((a) => [a.id, a]));

export function getAuraAction(id: string): AuraAction | undefined {
  return ACTION_MAP.get(id);
}

/** OpenAI function-calling tool definitions derived from the registry. */
export function auraToolDefinitions(): Array<{
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}> {
  return AURA_ACTIONS.map((a) => ({
    type: "function" as const,
    function: {
      name: a.id,
      description: `[${a.kind}] ${a.description}`,
      parameters: {
        type: "object",
        properties: a.parameters,
        required: [],
        additionalProperties: false,
      },
    },
  }));
}

/** Lightweight catalog for rendering AURA buttons in the UI. */
export function auraActionCatalog(): Array<{ id: string; label: string; module: AuraModule; kind: AuraActionKind; description: string }> {
  return AURA_ACTIONS.map(({ id, label, module, kind, description }) => ({ id, label, module, kind, description }));
}
