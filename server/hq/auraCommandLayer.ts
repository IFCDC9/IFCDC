/**
 * AURA Command Layer — the native command dispatcher for IFCDC HQ.
 *
 * Accepts a free-form command from anywhere in HQ and routes it to a real
 * action via a hybrid strategy:
 *   1. Deterministic keyword fast-paths (navigation) for latency.
 *   2. LLM function-calling over the AURA action registry for everything else.
 *
 * Approval protection is structural: the registry exposes only read/prepare
 * actions, so AURA can never submit, send, delete, approve, or spend. When a
 * command implies a finalizing action, AURA stages it in the founder approval
 * queue and says so.
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

export interface AuraCommandInput {
  command: string;
  module?: string;
  contextRef?: Record<string, unknown>;
  actorEmail: string;
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
}

const AURA_COMMAND_SYSTEM = `You are AURA, the native operating intelligence for IFCDC Headquarters.
You help the founder run the organization by turning commands into actions.

RULES:
- Use the provided tools to perform real work with live IFCDC data.
- You may READ, DRAFT, PREPARE, and RECOMMEND freely.
- You must NEVER submit, send, delete, approve, or spend. There are no tools for those. If the user asks to finalize such an action, call prepare_for_approval to stage it and tell them it awaits their approval.
- Prefer taking a concrete action over just describing one. If a tool fits, call it.
- Be concise and executive in tone. Never invent data.`;

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

/** Directly run a single registered action (used by contextual UI buttons). */
export async function runAuraAction(
  actionId: string,
  args: Record<string, unknown>,
  ctx: AuraActionContext
): Promise<AuraCommandResponse> {
  const action = getAuraAction(actionId);
  if (!action) {
    return { reply: `Unknown action: ${actionId}`, actions: [], approvalsCreated: [], poweredBy: "AURA" };
  }

  let result: AuraActionResult;
  try {
    result = await action.run(args, ctx);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Action failed";
    result = { status: "error", summary: message };
  }

  const executed = toExecuted(action.id, action.label, result);
  const approvalsCreated = executed.approval ? [executed.approval] : [];

  await recordAuraTurn({ actorEmail: ctx.actorEmail, module: ctx.module ?? action.module, role: "user", content: `[button] ${action.label}` });
  await recordAuraTurn({ actorEmail: ctx.actorEmail, module: ctx.module ?? action.module, role: "assistant", content: result.summary, action: executed });

  return {
    reply: result.summary,
    actions: [executed],
    navigation: executed.navigation,
    approvalsCreated,
    poweredBy: "AURA Command Layer",
    enterpriseJobId:
      actionId === "enterprise_funding_scan" && result.data && typeof result.data === "object" && "jobId" in (result.data as object)
        ? String((result.data as { jobId: string }).jobId)
        : undefined,
  };
}

/** Run a free-form command through the hybrid dispatcher. */
export async function runAuraCommand(input: AuraCommandInput): Promise<AuraCommandResponse> {
  const command = input.command.trim();
  const ctx: AuraActionContext = {
    actorEmail: input.actorEmail,
    module: input.module,
    contextRef: input.contextRef,
  };

  if (!command) {
    return { reply: "What would you like me to do?", actions: [], approvalsCreated: [], poweredBy: "AURA" };
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

    if (enterpriseHits) {
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
      return {
        reply,
        actions: [executed],
        navigation: executed.navigation,
        approvalsCreated: executed.approval ? [executed.approval] : [],
        poweredBy: "AURA Enterprise Grants Director",
        enterpriseJobId: started.jobId,
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
    return {
      reply: executed.summary,
      actions: [executed],
      navigation: executed.navigation,
      approvalsCreated: [],
      poweredBy: "AURA Command Layer",
    };
  }

  // 2. LLM function-calling over the action registry.
  const [orgContext, memoryContext] = await Promise.all([
    buildAuraExecutiveContext(),
    buildAuraMemoryContext(ctx.actorEmail),
  ]);

  const blockedVerb = detectBlockedIntent(command);
  const guidance = blockedVerb
    ? `\nNOTE: The command may ask to ${blockedVerb} something. You cannot do that. Use prepare_for_approval to stage it for the founder and explain that it awaits their approval.`
    : "";
  const moduleHint = ctx.module ? `\nThe founder is currently in the "${ctx.module}" module.` : "";
  const contextRefHint = ctx.contextRef && Object.keys(ctx.contextRef).length
    ? `\nContext references available: ${JSON.stringify(ctx.contextRef)}`
    : "";

  const systemContent = [
    AURA_COMMAND_SYSTEM,
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
        tools: auraToolDefinitions(),
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
      const ex = toExecuted(action.id, action.label, r);
      executed.push(ex);
      if (ex.navigation && !navigation) navigation = ex.navigation;
      if (ex.approval) approvalsCreated.push(ex.approval);
    }

    // Reply text: model's message, or a synthesis of executed actions.
    let reply = message?.content?.trim() ?? "";
    if (!reply) {
      reply = executed.length
        ? executed.map((e) => e.summary).join("\n\n")
        : "I could not determine an action for that. Try rephrasing, or use a specific AURA button.";
    }

    await recordAuraTurn({
      actorEmail: ctx.actorEmail,
      module: ctx.module,
      role: "assistant",
      content: reply,
      action: executed.length ? executed : undefined,
    });

    return { reply, actions: executed, navigation, approvalsCreated, poweredBy: "AURA Command Layer" };
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
