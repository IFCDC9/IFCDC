/**
 * AURA Command Layer — the native command dispatcher for IFCDC HQ.
 *
 * Accepts a free-form command from anywhere in HQ and routes it to a real
 * action via a hybrid strategy:
 *   1. Deterministic keyword fast-paths (navigation + Founder executive ops).
 *   2. LLM function-calling over the AURA action registry for everything else.
 *
 * Founder Mode unlocks execute actions (email, SMS, calls, calendar, documents).
 * High-impact irreversible actions (grant submit, payments, production delete)
 * still stage for Founder confirmation.
 */

import { buildAuraExecutiveContext } from "./auraExecutiveContext";
import { parseNavigationIntent } from "./auraNlNavigation";
import {
  AURA_ACTIONS,
  auraToolDefinitions,
  getAuraAction,
  detectBlockedIntent,
  type AuraActionContext,
  type AuraActionResult,
} from "./auraActionRegistry";
import { buildAuraMemoryContext, recordAuraTurn } from "./auraMemory";
import { withOpenAiCredentialFallback, formatOpenAiAuthError, resolveOpenAiCredentials } from "../lib/openaiConfig";
import {
  buildAuraIdentitySystemBlock,
  identityAllowsModule,
  logAuraIdentityAction,
  redactConfidentialForIdentity,
  resolveIdentityFromHqUser,
  type AuraTrustedIdentity,
} from "./auraFounderTrustEngine";

export interface AuraCommandInput {
  command: string;
  module?: string;
  contextRef?: Record<string, unknown>;
  actorEmail: string;
  /** Optional pre-resolved identity; otherwise derived from actor fields. */
  identity?: AuraTrustedIdentity;
  actorUser?: {
    id?: string;
    email?: string;
    role?: string;
    name?: string;
    mfaVerified?: boolean;
  };
}

export interface AuraExecutedAction {
  id: string;
  label: string;
  status: AuraActionResult["status"];
  summary: string;
  data?: unknown;
  navigation?: { path: string; label: string };
  approval?: { path: string; label: string };
}

export interface AuraCommandResponse {
  reply: string;
  actions: AuraExecutedAction[];
  navigation?: { path: string; label: string };
  approvalsCreated: Array<{ path: string; label: string }>;
  poweredBy: string;
  /** Present when a long-running enterprise grant job was started. */
  enterpriseJobId?: string;
  identity?: ReturnType<typeof import("./auraFounderTrustEngine").publicIdentitySummary>;
}

const AURA_COMMAND_SYSTEM = `You are AURA, the executive operating system for IFCDC Headquarters.
You help authenticated users run the organization by turning commands into real actions.

RULES:
- Prefer EXECUTING a tool over describing what you would do. If a tool fits, call it.
- Founder Mode may use execute tools: send_email, send_sms, place_call, create_calendar_event, create_document, send_notification, generate_executive_report, enterprise_diagnostics, etc.
- Software engineering (diagnose bugs, prepare fixes, run tests, prepare PRs, compare GitHub vs Render) must use se_* tools. Never invent test results. Never push/deploy without Founder approval.
- For high-impact irreversible work (submit grant, payments, production delete/deploy, org-wide blast), stage with prepare_for_approval or queue_grant_submission — do not claim it was submitted.
- For "find the best live grant / prepare complete application", call run_live_grant_workflow. After Founder approval and portal submit, call confirm_grant_portal_submission with the confirmation ID. Use monitor_grant_application to track status.
- Casual Founder requests like "email service@ifcdc.org", "text my phone", "call me", "schedule a meeting" MUST call the matching execute tool immediately.
- Be concise and executive. Never invent data.
- When Founder Mode is active, recognize Fahreal Allah as Founder / Super Admin without re-asking identity.`;

const MODEL = process.env.AURA_MODEL || "gpt-4o-mini";

function toExecuted(id: string, label: string, r: AuraActionResult): AuraExecutedAction {
  return {
    id,
    label,
    status: r.status,
    summary: r.summary,
    data: r.data,
    navigation: r.navigation,
    approval: r.approval,
  };
}

function resolveCommandIdentity(input: AuraCommandInput): AuraTrustedIdentity {
  if (input.identity) return input.identity;
  return resolveIdentityFromHqUser({
    user: input.actorUser ?? {
      email: input.actorEmail,
      role: /service@ifcdc\.org/i.test(input.actorEmail) ? "owner" : "employee",
      name: undefined,
    },
    channel: "hq_web",
    sessionKey: input.actorEmail || "anonymous",
  });
}

/** Directly run a single registered action (used by contextual UI buttons). */
export async function runAuraAction(
  actionId: string,
  args: Record<string, unknown>,
  ctx: AuraActionContext
): Promise<AuraCommandResponse> {
  const { publicIdentitySummary } = await import("./auraFounderTrustEngine");
  const identity = ctx.identity ?? resolveIdentityFromHqUser({
    user: { email: ctx.actorEmail, role: /service@ifcdc\.org/i.test(ctx.actorEmail) ? "owner" : "employee" },
    channel: "hq_web",
    sessionKey: ctx.actorEmail,
  });
  const enrichedCtx: AuraActionContext = { ...ctx, identity, actorEmail: identity.email || ctx.actorEmail };

  const action = getAuraAction(actionId);
  if (!action) {
    return {
      reply: `Unknown action: ${actionId}`,
      actions: [],
      approvalsCreated: [],
      poweredBy: "AURA",
      identity: publicIdentitySummary(identity),
    };
  }

  if (!identity.founderMode && action.module !== "global" && !identityAllowsModule(identity, action.module)) {
    const denied = `Your role (${identity.enterpriseRoleLabel}) is not authorized for ${action.module}. Founder Mode or an authorized executive session is required.`;
    await logAuraIdentityAction({
      identity,
      action: "aura_action_denied",
      detail: denied,
      metadata: { actionId },
    });
    return {
      reply: denied,
      actions: [],
      approvalsCreated: [],
      poweredBy: "AURA Trust Layer",
      identity: publicIdentitySummary(identity),
    };
  }

  if (action.kind === "execute" && !identity.founderMode && !identity.isFounder) {
    const denied = `Execute action "${action.label}" requires Founder Mode.`;
    return {
      reply: denied,
      actions: [],
      approvalsCreated: [],
      poweredBy: "AURA Trust Layer",
      identity: publicIdentitySummary(identity),
    };
  }

  let result: AuraActionResult;
  try {
    result = await action.run(args, enrichedCtx);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Action failed";
    result = { status: "error", summary: message };
  }

  const executed = toExecuted(action.id, action.label, {
    ...result,
    summary: redactConfidentialForIdentity(identity, result.summary),
  });
  const approvalsCreated = executed.approval ? [executed.approval] : [];

  await recordAuraTurn({ actorEmail: enrichedCtx.actorEmail, module: ctx.module ?? action.module, role: "user", content: `[button] ${action.label}` });
  await recordAuraTurn({ actorEmail: enrichedCtx.actorEmail, module: ctx.module ?? action.module, role: "assistant", content: executed.summary, action: executed });
  await logAuraIdentityAction({
    identity,
    action: `aura_action_${actionId}`,
    detail: executed.summary.slice(0, 400),
    metadata: { status: executed.status, kind: action.kind },
  });

  return {
    reply: executed.summary,
    actions: [executed],
    navigation: executed.navigation,
    approvalsCreated,
    poweredBy: identity.founderMode ? "AURA Founder Mode" : "AURA Command Layer",
    enterpriseJobId:
      actionId === "enterprise_funding_scan" && result.data && typeof result.data === "object" && "jobId" in (result.data as object)
        ? String((result.data as { jobId: string }).jobId)
        : undefined,
    identity: publicIdentitySummary(identity),
  };
}

/** Run a free-form command through the hybrid dispatcher. */
export async function runAuraCommand(input: AuraCommandInput): Promise<AuraCommandResponse> {
  const { publicIdentitySummary } = await import("./auraFounderTrustEngine");
  const identity = resolveCommandIdentity(input);
  const command = input.command.trim();
  const ctx: AuraActionContext = {
    actorEmail: identity.email || input.actorEmail,
    module: input.module,
    contextRef: input.contextRef,
    identity,
  };

  if (!command) {
    return {
      reply: "What would you like me to do?",
      actions: [],
      approvalsCreated: [],
      poweredBy: "AURA",
      identity: publicIdentitySummary(identity),
    };
  }

  // Founder Executive Operations — execute email/SMS/call/calendar/docs immediately.
  {
    const { tryRunExecutiveCommand } = await import("./auraExecutiveOperations");
    const exec = await tryRunExecutiveCommand(command, ctx);
    if (exec.handled) {
      const executed = toExecuted(exec.op, exec.op.replace(/_/g, " "), {
        ...exec.result,
        summary: redactConfidentialForIdentity(identity, exec.result.summary),
      });
      const approvalsCreated = executed.approval ? [executed.approval] : [];
      await recordAuraTurn({ actorEmail: ctx.actorEmail, module: ctx.module, role: "user", content: command });
      await recordAuraTurn({
        actorEmail: ctx.actorEmail,
        module: ctx.module,
        role: "assistant",
        content: executed.summary,
        action: executed,
      });
      await logAuraIdentityAction({
        identity,
        action: `aura_exec_${exec.op}`,
        detail: executed.summary.slice(0, 400),
        metadata: { status: executed.status },
      });
      return {
        reply: executed.summary,
        actions: [executed],
        navigation: executed.navigation,
        approvalsCreated,
        poweredBy: "AURA Executive Operations",
        identity: publicIdentitySummary(identity),
      };
    }
  }

  // AURA Software Engineering Engine — diagnose/fix/test/PR (short-circuit before LLM).
  {
    const { wantsSoftwareEngineeringCommand, handleSoftwareEngineeringCommand } = await import(
      "./auraSoftwareEngineeringEngine"
    );
    if (wantsSoftwareEngineeringCommand(command)) {
      const se = await handleSoftwareEngineeringCommand({
        command,
        actorEmail: identity.email || input.actorEmail,
        founderMode: Boolean(identity.founderMode || identity.isFounder),
        isFounder: Boolean(identity.isFounder || identity.founderMode),
      });
      await logAuraIdentityAction({
        identity,
        action: "aura_software_engineering",
        detail: se.reply.slice(0, 240),
        metadata: { action: se.action, approvalRequired: se.approvalRequired },
      });
      return {
        reply: se.reply,
        actions: [
          {
            id: se.action,
            label: "Software Engineering",
            status: se.action === "blocked" || se.action === "denied" ? "error" : se.approvalRequired ? "pending_approval" : "done",
            summary: se.reply,
            data: se.data,
            navigation: { path: "/hq/software-engineering", label: "Open Software Engineering" },
            approval: se.approvalRequired
              ? { path: "/hq/software-engineering", label: "Founder approval required" }
              : undefined,
          },
        ],
        approvalsCreated: se.approvalRequired
          ? [{ path: "/hq/software-engineering", label: "Founder approval required" }]
          : [],
        poweredBy: "AURA Software Engineering",
        identity: publicIdentitySummary(identity),
      };
    }
  }

  // Founder Technical Command Mode — live ops intelligence (short-circuit before LLM).
  {
    const { wantsTechnicalCommand, handleTechnicalCommand } = await import("./auraTechnicalCommandEngine");
    if (wantsTechnicalCommand(command)) {
      const tech = await handleTechnicalCommand({
        command,
        channel: "hq_web",
        actorEmail: identity.email || input.actorEmail,
        founderMode: Boolean(identity.founderMode || identity.isFounder),
        founderApproved: Boolean(input.contextRef?.founderApproved),
      });
      await logAuraIdentityAction({
        identity,
        action: "aura_technical_command",
        detail: tech.reply.slice(0, 240),
        metadata: { action: tech.action, ticketId: tech.ticketId, blocked: tech.blocked },
      });
      return {
        reply: tech.reply,
        actions: [
          {
            id: tech.action,
            label: "Technical Command",
            status: tech.blocked ? "error" : tech.ticketId ? "prepared" : "done",
            summary: tech.reply,
            data: { briefing: tech.briefing, ticketId: tech.ticketId, findings: tech.findings },
          },
        ],
        approvalsCreated: tech.requiresFounderApproval
          ? [{ path: "/hq/aura", label: "Founder approval required" }]
          : [],
        poweredBy: "AURA Technical Command",
        identity: publicIdentitySummary(identity),
      };
    }
  }

  // AURA Enterprise Brain 2.0 — unified Founder operating intelligence (delegates to specialists).
  {
    const { wantsEnterpriseBrain, runEnterpriseBrain } = await import("./auraEnterpriseBrain");
    const { wantsMultiAgentOrchestration } = await import("./auraExecutiveAgentOrchestrator");
    if (wantsEnterpriseBrain(command) || wantsMultiAgentOrchestration(command)) {
      const brain = await runEnterpriseBrain({
        request: command,
        channel: "hq_web",
        actorEmail: identity.email || input.actorEmail,
        founderMode: Boolean(identity.founderMode || identity.isFounder),
      });
      await logAuraIdentityAction({
        identity,
        action: "aura_enterprise_brain",
        detail: brain.speechSummary.slice(0, 240),
        metadata: {
          intent: brain.intent,
          orchestrationId: brain.orchestrationId,
          agentsDelegated: brain.agentsDelegated,
        },
      });
      return {
        reply: brain.unifiedBriefing,
        actions: [
          {
            id: "enterprise_brain",
            label: "Enterprise Brain 2.0",
            status: "done",
            summary: brain.speechSummary,
            data: brain,
          },
        ],
        approvalsCreated: brain.founderApprovalRequired
          ? [{ path: "/hq/workflows", label: "Founder approval required for execution" }]
          : [],
        poweredBy: "AURA Enterprise Brain 2.0",
        identity: publicIdentitySummary(identity),
      };
    }
  }

  // Founder Decision Support / Organizational Memory — live cross-module intelligence.
  if (identity.founderMode || identity.isFounder) {
    const { wantsDecisionSupport, answerDecisionSupportQuestion } = await import("./auraDecisionSupport");
    if (wantsDecisionSupport(command)) {
      const decision = await answerDecisionSupportQuestion(command);
      await logAuraIdentityAction({
        identity,
        action: "aura_decision_support",
        detail: decision.recommendedAction.slice(0, 240),
      });
      return {
        reply: decision.speechSummary,
        actions: [
          {
            id: "decision_support_ask",
            label: "Decision Support",
            status: "done",
            summary: decision.speechSummary,
            data: decision,
          },
        ],
        approvalsCreated: decision.founderApprovalRequired
          ? [{ path: "/hq/workflows", label: "Founder approval required" }]
          : [],
        poweredBy: "AURA Decision Support",
        identity: publicIdentitySummary(identity),
      };
    }
    if (/\b(organizational memory|knowledge base|what do we know|mission and vision)\b/i.test(command)) {
      const { retrieveOrganizationalMemory } = await import("./auraOrganizationalMemory");
      const memory = await retrieveOrganizationalMemory(command);
      return {
        reply: memory.speechSummary,
        actions: [
          {
            id: "org_memory_lookup",
            label: "Organizational Memory",
            status: "done",
            summary: memory.speechSummary,
            data: memory,
          },
        ],
        approvalsCreated: [],
        poweredBy: "AURA Organizational Memory",
        identity: publicIdentitySummary(identity),
      };
    }
  }

  // Role gate: enterprise grant director & confidential workflows require Founder Mode or grants module.
  const isEnterpriseIntent =
    /enterprise mode|executive funding|scan all program|founder approval|populate.*pipeline|whole ifcdc.*grant/i.test(command);

  if (isEnterpriseIntent && !identity.founderMode && !identityAllowsModule(identity, "grants")) {
    const denied =
      "Enterprise funding commands require Founder Mode or Grant Manager access. Sign in with an authorized HQ account.";
    await logAuraIdentityAction({ identity, action: "aura_command_denied", detail: denied });
    return {
      reply: denied,
      actions: [],
      approvalsCreated: [],
      poweredBy: "AURA Trust Layer",
      identity: publicIdentitySummary(identity),
    };
  }

  // Enterprise grants mode — acknowledge immediately and run as background job (no request timeout).
  try {
    const { isEnterpriseFundingQuery, startEnterpriseFundingScanJob, formatEnterpriseJobAck } = await import(
      "./grantEnterpriseDirectorEngine"
    );
    const q = command.toLowerCase();
    const enterpriseHits =
      isEnterpriseFundingQuery(command)
      || (/whole ifcdc|entire organization|all program|every program|org.?wide/.test(q)
        && /grant|funding|report|scan|evaluate|pipeline|draft/.test(q))
      || /draft.*grant|prepare.*application|populate.*pipeline/.test(q);

    if (enterpriseHits && (identity.founderMode || identityAllowsModule(identity, "grants"))) {
      const prepareDrafts =
        /draft|proposal|prepare|populate|enterprise|director|complete/.test(q);
      const started = await startEnterpriseFundingScanJob({
        actorEmail: ctx.actorEmail,
        syncFeeds: true,
        populatePipeline: true,
        prepareDrafts,
      });
      const reply = formatEnterpriseJobAck(started.jobId, prepareDrafts);
      const executed: AuraExecutedAction = {
        id: "enterprise_funding_scan",
        label: "Enterprise Funding Scan",
        status: "prepared",
        summary: reply,
        data: { jobId: started.jobId, status: started.status, prepareDrafts },
        navigation: {
          path: `/hq/grants?tab=pipeline&enterpriseJob=${started.jobId}`,
          label: "Track Enterprise Scan",
        },
        approval: { path: "/hq/workflows", label: "Review in Workflow Automation" },
      };
      await recordAuraTurn({ actorEmail: ctx.actorEmail, module: ctx.module, role: "user", content: command });
      await recordAuraTurn({
        actorEmail: ctx.actorEmail,
        module: ctx.module,
        role: "assistant",
        content: reply,
        action: executed,
      });
      await logAuraIdentityAction({
        identity,
        action: "aura_enterprise_scan_started",
        detail: `job ${started.jobId}`,
        metadata: { prepareDrafts },
      });
      return {
        reply,
        actions: [executed],
        navigation: executed.navigation,
        approvalsCreated: executed.approval ? [executed.approval] : [],
        poweredBy: identity.founderMode ? "AURA Founder Mode" : "AURA Enterprise Grants Director",
        enterpriseJobId: started.jobId,
        identity: publicIdentitySummary(identity),
      };
    }
  } catch (err) {
    console.warn("[aura] enterprise fast-path failed:", err instanceof Error ? err.message : err);
  }

  // 1. Deterministic navigation fast-path (only explicit "open/go to X").
  const nav = parseNavigationIntent(command);
  if (nav && nav.confidence === "high") {
    const executed: AuraExecutedAction = {
      id: "navigate",
      label: "Navigate",
      status: "done",
      summary: `Opening ${nav.label}.`,
      navigation: { path: nav.path, label: nav.label },
    };
    await recordAuraTurn({ actorEmail: ctx.actorEmail, module: ctx.module, role: "user", content: command });
    await recordAuraTurn({ actorEmail: ctx.actorEmail, module: ctx.module, role: "assistant", content: executed.summary, action: executed });
    await logAuraIdentityAction({ identity, action: "aura_navigate", detail: nav.path });
    return {
      reply: executed.summary,
      actions: [executed],
      navigation: executed.navigation,
      approvalsCreated: [],
      poweredBy: identity.founderMode ? "AURA Founder Mode" : "AURA Command Layer",
      identity: publicIdentitySummary(identity),
    };
  }

  // 2. LLM function-calling over the action registry.
  const [orgContext, memoryContext] = await Promise.all([
    buildAuraExecutiveContext(),
    buildAuraMemoryContext(ctx.actorEmail),
  ]);

  const blockedVerb = detectBlockedIntent(command);
  const guidance = blockedVerb
    ? `\nNOTE: The command may ask to ${blockedVerb}. That is high-impact. Use prepare_for_approval or queue_grant_submission to stage it — do not claim it was finalized.`
    : identity.founderMode || identity.isFounder
      ? `\nFounder Mode is ACTIVE. Execute matching tools immediately for email, SMS, calls, calendar, documents, notifications, and diagnostics.`
      : "";
  const moduleHint = ctx.module
    ? `\nThe user is currently in the "${ctx.module}" module.`
    : "";
  const contextRefHint = ctx.contextRef && Object.keys(ctx.contextRef).length
    ? `\nContext references available: ${JSON.stringify(ctx.contextRef)}`
    : "";

  const tools = auraToolDefinitions().filter((t) => {
    const action = getAuraAction(t.function.name);
    if (!action) return false;
    if (action.kind === "execute" && !identity.founderMode && !identity.isFounder) return false;
    return true;
  });

  const systemContent = [
    AURA_COMMAND_SYSTEM,
    buildAuraIdentitySystemBlock(identity),
    guidance,
    moduleHint,
    contextRefHint,
    memoryContext ? `\n${memoryContext}` : "",
    `\n\nLive IFCDC context:\n${orgContext}`,
  ].join("");

  await recordAuraTurn({ actorEmail: ctx.actorEmail, module: ctx.module, role: "user", content: command });

  try {
    const { result } = await withOpenAiCredentialFallback(async (_creds, client) => {
      return client.chat.completions.create({
        model: MODEL,
        temperature: 0.4,
        max_tokens: 1500,
        messages: [
          { role: "system", content: systemContent },
          { role: "user", content: command },
        ],
        tools,
        tool_choice: "auto",
      });
    });

    const message = result.choices[0]?.message;
    const toolCalls = message?.tool_calls ?? [];
    const executed: AuraExecutedAction[] = [];
    const approvalsCreated: Array<{ path: string; label: string }> = [];
    let navigation: { path: string; label: string } | undefined;

    for (const call of toolCalls) {
      if (call.type !== "function") continue;
      const action = getAuraAction(call.function.name);
      if (!action) continue;
      if (!identity.founderMode && action.module !== "global" && !identityAllowsModule(identity, action.module)) {
        executed.push({
          id: action.id,
          label: action.label,
          status: "error",
          summary: `Denied: ${identity.enterpriseRoleLabel} cannot run ${action.label}.`,
        });
        continue;
      }
      if (action.kind === "execute" && !identity.founderMode && !identity.isFounder) {
        executed.push({
          id: action.id,
          label: action.label,
          status: "error",
          summary: `Denied: ${action.label} requires Founder Mode.`,
        });
        continue;
      }
      let args: Record<string, unknown> = {};
      try {
        args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        args = {};
      }
      let r: AuraActionResult;
      try {
        r = await action.run(args, ctx);
      } catch (err) {
        r = { status: "error", summary: err instanceof Error ? err.message : "Action failed" };
      }
      const ex = toExecuted(action.id, action.label, {
        ...r,
        summary: redactConfidentialForIdentity(identity, r.summary),
      });
      executed.push(ex);
      if (ex.navigation && !navigation) navigation = ex.navigation;
      if (ex.approval) approvalsCreated.push(ex.approval);
    }

    let reply = message?.content?.trim() ?? "";
    if (!reply) {
      reply = executed.length
        ? executed.map((e) => e.summary).join("\n\n")
        : "I could not determine an action for that. Try rephrasing, or use a specific AURA button.";
    }
    reply = redactConfidentialForIdentity(identity, reply);

    await recordAuraTurn({
      actorEmail: ctx.actorEmail,
      module: ctx.module,
      role: "assistant",
      content: reply,
      action: executed.length ? executed : undefined,
    });
    await logAuraIdentityAction({
      identity,
      action: "aura_command",
      detail: command.slice(0, 240),
      metadata: { actions: executed.map((e) => e.id), founderMode: identity.founderMode },
    });

    return {
      reply,
      actions: executed,
      navigation,
      approvalsCreated,
      poweredBy: identity.founderMode ? "AURA Founder Mode" : "AURA Command Layer",
      identity: publicIdentitySummary(identity),
    };
  } catch (err) {
    const message = formatOpenAiAuthError(err, resolveOpenAiCredentials());
    console.error("[aura-command] failed:", message);
    throw new Error(message);
  }
}

/** Catalog of registered actions (for UI + diagnostics). */
export function listAuraActions() {
  return AURA_ACTIONS.map(({ id, label, module, kind, description }) => ({ id, label, module, kind, description }));
}
