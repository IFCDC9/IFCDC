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

const AURA_COMMAND_SYSTEM = `You are AURA, the native operating intelligence for IFCDC Headquarters.
You help authenticated IFCDC users run the organization by turning commands into actions.

RULES:
- Use the provided tools to perform real work with live IFCDC data within the caller's authorized role.
- You may READ, DRAFT, PREPARE, and RECOMMEND freely when authorized.
- You must NEVER submit, send, delete, approve, or spend. There are no tools for those. If the user asks to finalize such an action, call prepare_for_approval to stage it and explain that it awaits Founder approval.
- Prefer taking a concrete action over just describing one. If a tool fits, call it.
- Be concise and executive in tone. Never invent data.
- When Founder Mode is active, persistently recognize Fahreal Allah as Founder / Super Admin without re-asking identity.`;

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
    ? `\nNOTE: The command may ask to ${blockedVerb} something. You cannot do that. Use prepare_for_approval to stage it for the founder and explain that it awaits their approval.`
    : "";
  const moduleHint = ctx.module
    ? `\nThe user is currently in the "${ctx.module}" module.`
    : "";
  const contextRefHint = ctx.contextRef && Object.keys(ctx.contextRef).length
    ? `\nContext references available: ${JSON.stringify(ctx.contextRef)}`
    : "";

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
      if (!identity.founderMode && action.module !== "global" && !identityAllowsModule(identity, action.module)) {
        executed.push({
          id: action.id,
          label: action.label,
          status: "error",
          summary: `Denied: ${identity.enterpriseRoleLabel} cannot run ${action.label}.`,
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
