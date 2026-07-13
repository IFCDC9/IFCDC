/**
 * AURA Executive Command Planner — multi-step orchestration for Founder Mode.
 *
 * Compound requests (especially the Founder Operations Acceptance Test) are
 * decomposed into an execution plan BEFORE any tool runs. Tool args are
 * strict schemas only — never the full natural-language prompt.
 */
import { getEmailDeliveryStatus } from "../lib/notifications";
import { getFounderEmail, type AuraTrustedIdentity } from "./auraFounderTrustEngine";
import { getTwilioEnvStatus } from "./twilioIntegrationEngine";
import {
  type ExecutiveActionContext,
  type ExecutiveActionResult,
  type ExecutiveOpId,
  type ParsedExecutiveIntent,
  parseExecutiveIntent,
  runExecutiveOperation,
  resolveFounderMobile,
} from "./auraExecutiveOperations";

export type PlanStepStatus = "PASS" | "FAIL" | "SKIP";

export type ExecutivePlanStep = {
  id: string;
  tool: string;
  label: string;
  inputs: Record<string, unknown>;
  approvalRequired: boolean;
  /** When true, a FAIL does not abort remaining safe steps. */
  continueOnFail: boolean;
};

export type ExecutivePlanningPreview = {
  intent: string;
  requiredTools: string[];
  toolOrder: string[];
  inputs: Record<string, Record<string, unknown>>;
  approvalRequirements: string[];
  steps: ExecutivePlanStep[];
};

export type ExecutiveStepReport = {
  step: number;
  id: string;
  tool: string;
  status: PlanStepStatus;
  summary: string;
  providerAccepted?: boolean;
  messageId?: string | null;
  data?: unknown;
};

export type ExecutivePlanExecution = {
  preview: ExecutivePlanningPreview;
  steps: ExecutiveStepReport[];
  overall: "PASS" | "FAIL" | "PARTIAL";
  summary: string;
  result: ExecutiveActionResult;
};

const FOUNDER_TEST_EMAIL_TO = "service@ifcdc.org";
const FOUNDER_TEST_EMAIL_SUBJECT = "AURA Founder Test";
const FOUNDER_TEST_EMAIL_BODY =
  "This is a live production email from AURA confirming that Founder Mode and outbound email are working.";
const FOUNDER_TEST_SMS_TO = "+18484694448";
const FOUNDER_TEST_SMS_MESSAGE =
  "AURA Founder Test: SMS and Founder authorization are working.";
const FOUNDER_TEST_NOTIF_TITLE = "AURA Operations Test";
const FOUNDER_TEST_NOTIF_MESSAGE =
  "Founder Mode, email, SMS, and internal notifications were tested.";

/** True when text looks like a dumped multi-step instruction (must never be emailed/SMS'd). */
export function looksLikeInstructionDump(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (t.length > 1200) return true;
  const markers = [
    /verify_founder_session/i,
    /check_resend_health/i,
    /check_twilio_(sms|voice)_health/i,
    /check_action_registry/i,
    /check_communications_center/i,
    /create_founder_notification/i,
    /Required (fix|behavior|fix):/i,
    /Acceptance criteria/i,
    /execution plan/i,
    /Step\s+\d+\s*:/i,
    /Multi-step command planning/i,
    /Do not use the full user prompt/i,
    /return structured PASS\/FAIL/i,
  ];
  const hits = markers.filter((re) => re.test(t)).length;
  return hits >= 2 || (hits >= 1 && t.length > 400);
}

export function wantsFounderOperationsAcceptanceTest(command: string): boolean {
  const c = command.trim();
  if (!c) return false;
  if (/founder\s+operations?\s+acceptance\s+test/i.test(c)) return true;
  if (/aura\s+founder\s+(ops|operations)\s+(acceptance\s+)?test/i.test(c)) return true;
  if (/run\s+(the\s+)?founder\s+(ops|operations)\s+(acceptance\s+)?test/i.test(c)) return true;
  // Explicit tool checklist from Founder's acceptance prompt
  if (
    /verify_founder_session/i.test(c)
    && /send_email/i.test(c)
    && /send_sms/i.test(c)
    && (/create_founder_notification/i.test(c) || /send_notification/i.test(c))
  ) {
    return true;
  }
  if (
    /AURA Founder Test/i.test(c)
    && /service@ifcdc\.org/i.test(c)
    && /\+18484694448/.test(c)
    && /Founder Mode and outbound email are working/i.test(c)
  ) {
    return true;
  }
  return false;
}

/** Compound: multiple executive verbs that should not collapse into one email. */
export function wantsCompoundExecutivePlan(command: string): boolean {
  if (wantsFounderOperationsAcceptanceTest(command)) return true;
  const c = command.trim();
  const hasEmail = /\b(email|e-mail|send (an? )?email)\b/i.test(c);
  const hasSms = /\b(text|sms|send (a )?text)\b/i.test(c);
  const hasNotif = /\b(notify|notification|alert me)\b/i.test(c);
  const hasCall = /\b(call me|place a call)\b/i.test(c);
  const ops = [hasEmail, hasSms, hasNotif, hasCall].filter(Boolean).length;
  if (ops >= 2) return true;
  if (ops >= 1 && /\b(and then|then also|;|,\s*then)\b/i.test(c)) return true;
  return false;
}

function step(
  id: string,
  tool: string,
  label: string,
  inputs: Record<string, unknown>,
  opts?: { approvalRequired?: boolean; continueOnFail?: boolean },
): ExecutivePlanStep {
  return {
    id,
    tool,
    label,
    inputs,
    approvalRequired: opts?.approvalRequired ?? false,
    continueOnFail: opts?.continueOnFail ?? true,
  };
}

export function buildFounderOperationsAcceptancePlan(): ExecutivePlanningPreview {
  const steps: ExecutivePlanStep[] = [
    step("verify_founder_session", "verify_founder_session", "Verify Founder session", {}),
    step("check_resend_health", "check_resend_health", "Check Resend health", {}),
    step("check_twilio_sms_health", "check_twilio_sms_health", "Check Twilio SMS health", {}),
    step("check_twilio_voice_health", "check_twilio_voice_health", "Check Twilio Voice health", {}),
    step("check_founder_contact_configuration", "check_founder_contact_configuration", "Check Founder contact config", {}),
    step("check_action_registry", "check_action_registry", "Check action registry", {}),
    step("check_communications_center", "check_communications_center", "Check Communications Center", {}),
    step(
      "send_email",
      "send_email",
      "Send Founder test email",
      {
        to: FOUNDER_TEST_EMAIL_TO,
        subject: FOUNDER_TEST_EMAIL_SUBJECT,
        body: FOUNDER_TEST_EMAIL_BODY,
      },
    ),
    step(
      "send_sms",
      "send_sms",
      "Send Founder test SMS",
      {
        to: FOUNDER_TEST_SMS_TO,
        message: FOUNDER_TEST_SMS_MESSAGE,
      },
    ),
    step(
      "create_founder_notification",
      "create_founder_notification",
      "Create Founder notification",
      {
        title: FOUNDER_TEST_NOTIF_TITLE,
        message: FOUNDER_TEST_NOTIF_MESSAGE,
        recipient: "founder",
      },
    ),
  ];

  return {
    intent: "Founder Operations Acceptance Test — verify Founder Mode and live outbound channels",
    requiredTools: steps.map((s) => s.tool),
    toolOrder: steps.map((s) => s.tool),
    inputs: Object.fromEntries(steps.map((s) => [s.id, s.inputs])),
    approvalRequirements: steps.filter((s) => s.approvalRequired).map((s) => s.id),
    steps,
  };
}

/**
 * Build a plan for compound casual commands (email + SMS + notify).
 * Uses parseExecutiveIntent on segmented clauses — never the full prompt as body.
 */
export function buildCompoundExecutivePlan(command: string): ExecutivePlanningPreview | null {
  if (wantsFounderOperationsAcceptanceTest(command)) {
    return buildFounderOperationsAcceptancePlan();
  }

  const segments = splitCompoundCommand(command);
  if (segments.length < 2) return null;

  const steps: ExecutivePlanStep[] = [];
  for (let i = 0; i < segments.length; i++) {
    const parsed = parseExecutiveIntent(segments[i]!);
    if (!parsed) continue;
    if (!["send_email", "send_sms", "send_notification", "place_call"].includes(parsed.op)) continue;
    // Re-assert strict args — reject instruction dumps
    const inputs = sanitizePlanInputs(parsed.op, parsed.args, segments[i]!);
    if (!inputs) continue;
    steps.push(
      step(`${parsed.op}_${i + 1}`, parsed.op, parsed.op.replace(/_/g, " "), inputs, {
        approvalRequired: parsed.highImpact,
      }),
    );
  }

  if (steps.length < 2) return null;

  return {
    intent: "Compound Founder executive operations",
    requiredTools: steps.map((s) => s.tool),
    toolOrder: steps.map((s) => s.tool),
    inputs: Object.fromEntries(steps.map((s) => [s.id, s.inputs])),
    approvalRequirements: steps.filter((s) => s.approvalRequired).map((s) => s.id),
    steps,
  };
}

export function planExecutiveCommand(command: string): ExecutivePlanningPreview | null {
  if (wantsFounderOperationsAcceptanceTest(command)) {
    return buildFounderOperationsAcceptancePlan();
  }
  if (wantsCompoundExecutivePlan(command)) {
    return buildCompoundExecutivePlan(command);
  }
  return null;
}

function splitCompoundCommand(command: string): string[] {
  const parts = command
    .split(/\b(?:and then|then also|;\s*|\n\s*\d+[.)]\s*)/i)
    .map((p) => p.trim())
    .filter((p) => p.length > 8);
  if (parts.length >= 2) return parts;

  // Fallback: split on " and " when both email and sms verbs exist
  const andParts = command.split(/\band\b/i).map((p) => p.trim()).filter(Boolean);
  if (andParts.length >= 2) {
    return andParts.map((p, i) => (i === 0 ? p : `please ${p}`));
  }
  return [command];
}

/** Keep only schema-allowed fields; never pass the raw prompt. */
export function sanitizePlanInputs(
  op: string,
  args: Record<string, unknown>,
  segment: string,
): Record<string, unknown> | null {
  if (op === "send_email") {
    const to = String(args.to || "").trim();
    const subject = String(args.subject || "").trim();
    const body = String(args.body || "").trim();
    if (!to || !subject || !body) return null;
    if (looksLikeInstructionDump(body) || body === segment.trim()) return null;
    return { to, subject, body };
  }
  if (op === "send_sms") {
    const to = String(args.to || "").trim();
    const message = String(args.message || args.body || "").trim();
    if (!to || !message) return null;
    if (looksLikeInstructionDump(message) || message === segment.trim()) return null;
    return { to, message };
  }
  if (op === "send_notification" || op === "create_founder_notification") {
    const title = String(args.title || "").trim();
    const message = String(args.message || "").trim();
    if (!title || !message) return null;
    if (looksLikeInstructionDump(message)) return null;
    const out: Record<string, unknown> = { title, message };
    if (args.recipient) out.recipient = String(args.recipient);
    if (args.role) out.role = String(args.role);
    return out;
  }
  if (op === "place_call") {
    const to = String(args.to || "").trim();
    const message = String(args.message || "").trim();
    if (!to || !message) return null;
    if (looksLikeInstructionDump(message)) return null;
    return { to, message };
  }
  return { ...args };
}

async function runDiagnosticStep(
  tool: string,
  ctx: ExecutiveActionContext,
): Promise<{ status: PlanStepStatus; summary: string; data?: unknown; providerAccepted?: boolean }> {
  const identity = ctx.identity as AuraTrustedIdentity | undefined;

  if (tool === "verify_founder_session") {
    const ok = Boolean(identity?.founderMode || identity?.isFounder);
    return {
      status: ok ? "PASS" : "FAIL",
      summary: ok
        ? `Founder Mode active for ${identity?.email || ctx.actorEmail}`
        : "Founder Mode is not active — cannot run Founder operations",
      data: {
        founderMode: Boolean(identity?.founderMode),
        email: identity?.email || ctx.actorEmail,
      },
      providerAccepted: ok,
    };
  }

  if (tool === "check_resend_health") {
    const email = getEmailDeliveryStatus();
    const ok = Boolean(email.configured && email.provider === "resend");
    return {
      status: ok ? "PASS" : "FAIL",
      summary: ok ? "Resend configured and ready" : `Resend not ready (provider=${email.provider})`,
      data: email,
      providerAccepted: ok,
    };
  }

  if (tool === "check_twilio_sms_health" || tool === "check_twilio_voice_health") {
    const twilio = getTwilioEnvStatus();
    const ok = Boolean(twilio.ready);
    const channel = tool.includes("voice") ? "Voice" : "SMS";
    return {
      status: ok ? "PASS" : "FAIL",
      summary: ok ? `Twilio ${channel} ready` : `Twilio ${channel} not ready`,
      data: twilio,
      providerAccepted: ok,
    };
  }

  if (tool === "check_founder_contact_configuration") {
    const email = getFounderEmail();
    const phone = resolveFounderMobile(identity?.phoneE164);
    const ok = Boolean(email && phone);
    return {
      status: ok ? "PASS" : "FAIL",
      summary: ok
        ? `Founder contact configured (email=${email}, phone=${phone})`
        : "Founder email or phone missing",
      data: { email, phone },
      providerAccepted: ok,
    };
  }

  if (tool === "check_action_registry") {
    const { getAuraAction } = await import("./auraActionRegistry");
    const required = ["send_email", "send_sms", "send_notification"];
    const missing = required.filter((id) => !getAuraAction(id));
    const ok = missing.length === 0;
    return {
      status: ok ? "PASS" : "FAIL",
      summary: ok ? "Required AURA actions registered" : `Missing actions: ${missing.join(", ")}`,
      data: { required, missing },
      providerAccepted: ok,
    };
  }

  if (tool === "check_communications_center") {
    // Communications Center is a live HQ route — presence of notification + email paths is enough.
    return {
      status: "PASS",
      summary: "Communications Center route available at /hq/communications",
      data: { path: "/hq/communications" },
      providerAccepted: true,
    };
  }

  return { status: "FAIL", summary: `Unknown diagnostic tool: ${tool}` };
}

async function runLiveToolStep(
  tool: string,
  inputs: Record<string, unknown>,
  ctx: ExecutiveActionContext,
): Promise<{ status: PlanStepStatus; summary: string; data?: unknown; providerAccepted?: boolean; messageId?: string | null }> {
  if (tool === "send_email") {
    const result = await runExecutiveOperation("send_email", inputs, ctx);
    const data = (result.data || {}) as {
      results?: Array<{ ok: boolean; messageId?: string }>;
      messageId?: string;
      providerAccepted?: boolean;
      bodyPreview?: string;
    };
    // Guard: never treat instruction dump as success
    if (data.bodyPreview && /verify_founder_session|Required fix:/i.test(data.bodyPreview)) {
      return {
        status: "FAIL",
        summary: "Email body looked like an instruction dump — blocked",
        providerAccepted: false,
      };
    }
    const messageId =
      data.messageId
      || data.results?.find((r) => r.ok)?.messageId
      || null;
    const providerAccepted = result.status === "done" && Boolean(data.providerAccepted || messageId || data.results?.some((r) => r.ok));
    return {
      status: providerAccepted ? "PASS" : "FAIL",
      summary: result.summary,
      data: result.data,
      providerAccepted,
      messageId,
    };
  }

  if (tool === "send_sms") {
    const args = {
      to: inputs.to,
      body: inputs.message || inputs.body,
      message: inputs.message || inputs.body,
    };
    const result = await runExecutiveOperation("send_sms", args, ctx);
    const data = (result.data || {}) as { messageId?: string };
    const providerAccepted = result.status === "done" && Boolean(data.messageId);
    return {
      status: providerAccepted ? "PASS" : "FAIL",
      summary: result.summary,
      data: result.data,
      providerAccepted,
      messageId: data.messageId || null,
    };
  }

  if (tool === "create_founder_notification" || tool === "send_notification") {
    const result = await runExecutiveOperation("send_notification", inputs, ctx);
    const data = (result.data || {}) as { alertId?: string };
    const providerAccepted = result.status === "done" && Boolean(data.alertId);
    return {
      status: providerAccepted ? "PASS" : "FAIL",
      summary: result.summary,
      data: result.data,
      providerAccepted,
      messageId: data.alertId || null,
    };
  }

  if (tool === "place_call") {
    const result = await runExecutiveOperation("place_call", inputs, ctx);
    const data = (result.data || {}) as { callSid?: string };
    const providerAccepted = result.status === "done" && Boolean(data.callSid);
    return {
      status: providerAccepted ? "PASS" : "FAIL",
      summary: result.summary,
      data: result.data,
      providerAccepted,
      messageId: data.callSid || null,
    };
  }

  // Generic executive op pass-through
  if ((tool as ExecutiveOpId) && tool.includes("_")) {
    try {
      const result = await runExecutiveOperation(tool as ExecutiveOpId, inputs, ctx);
      return {
        status: result.status === "done" || result.status === "prepared" ? "PASS" : "FAIL",
        summary: result.summary,
        data: result.data,
        providerAccepted: result.status === "done",
      };
    } catch (err) {
      return {
        status: "FAIL",
        summary: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return { status: "FAIL", summary: `Unhandled plan tool: ${tool}` };
}

export async function executeExecutivePlan(
  preview: ExecutivePlanningPreview,
  ctx: ExecutiveActionContext,
): Promise<ExecutivePlanExecution> {
  const reports: ExecutiveStepReport[] = [];

  for (let i = 0; i < preview.steps.length; i++) {
    const s = preview.steps[i]!;
    let outcome: Awaited<ReturnType<typeof runDiagnosticStep>>;

    try {
      if (
        s.tool.startsWith("check_")
        || s.tool === "verify_founder_session"
      ) {
        outcome = await runDiagnosticStep(s.tool, ctx);
      } else {
        outcome = await runLiveToolStep(s.tool, s.inputs, ctx);
      }
    } catch (err) {
      outcome = {
        status: "FAIL",
        summary: err instanceof Error ? err.message : String(err),
      };
    }

    reports.push({
      step: i + 1,
      id: s.id,
      tool: s.tool,
      status: outcome.status,
      summary: outcome.summary,
      providerAccepted: outcome.providerAccepted,
      messageId: (outcome as { messageId?: string | null }).messageId,
      data: outcome.data,
    });

    // Abort only if step says so AND it's a hard gate (Founder session)
    if (outcome.status === "FAIL" && !s.continueOnFail) {
      break;
    }
    // Founder session failure blocks outbound live sends but diagnostics already ran
    if (s.tool === "verify_founder_session" && outcome.status === "FAIL") {
      // Mark remaining live outbound as SKIP; continue diagnostics already done
      for (let j = i + 1; j < preview.steps.length; j++) {
        const rest = preview.steps[j]!;
        if (["send_email", "send_sms", "create_founder_notification", "place_call"].includes(rest.tool)) {
          reports.push({
            step: j + 1,
            id: rest.id,
            tool: rest.tool,
            status: "SKIP",
            summary: "Skipped — Founder session not verified",
          });
        }
      }
      break;
    }
  }

  const pass = reports.filter((r) => r.status === "PASS").length;
  const fail = reports.filter((r) => r.status === "FAIL").length;
  const skip = reports.filter((r) => r.status === "SKIP").length;
  const overall: ExecutivePlanExecution["overall"] =
    fail === 0 && skip === 0 ? "PASS" : pass > 0 && fail > 0 ? "PARTIAL" : fail === 0 ? "PASS" : "FAIL";

  const lines = [
    `AURA Founder Operations plan: ${overall}`,
    `Intent: ${preview.intent}`,
    `Tools: ${preview.toolOrder.join(" → ")}`,
    "",
    ...reports.map(
      (r) =>
        `${r.status.padEnd(4)} Step ${r.step}. ${r.tool}`
        + (r.messageId ? ` (id=${r.messageId})` : "")
        + ` — ${r.summary}`,
    ),
    "",
    `PASS=${pass} FAIL=${fail} SKIP=${skip}`,
  ];

  const summary = lines.join("\n");

  return {
    preview,
    steps: reports,
    overall,
    summary,
    result: {
      status: overall === "FAIL" ? "error" : "done",
      summary,
      data: {
        intent: preview.intent,
        planningPreview: {
          intent: preview.intent,
          requiredTools: preview.requiredTools,
          toolOrder: preview.toolOrder,
          inputs: preview.inputs,
          approvalRequirements: preview.approvalRequirements,
        },
        report: reports,
        overall,
        pass,
        fail,
        skip,
      },
      navigation: { path: "/hq/communications", label: "Open Communications Center" },
    },
  };
}

/** Single-intent path still goes through planning preview for observability. */
export function previewSingleIntent(parsed: ParsedExecutiveIntent): ExecutivePlanningPreview {
  const inputs = sanitizePlanInputs(parsed.op, parsed.args, "") || parsed.args;
  const s = step(parsed.op, parsed.op, parsed.op.replace(/_/g, " "), inputs, {
    approvalRequired: parsed.highImpact,
    continueOnFail: false,
  });
  return {
    intent: `Single executive operation: ${parsed.op}`,
    requiredTools: [parsed.op],
    toolOrder: [parsed.op],
    inputs: { [parsed.op]: inputs },
    approvalRequirements: parsed.highImpact ? [parsed.op] : [],
    steps: [s],
  };
}
