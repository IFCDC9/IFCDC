/**
 * Founder approval gate states for IFCDC Productions (Phase 5).
 * DISTRIBUTION / publish stay blocked without an explicit Founder approval flag.
 */

export const GATE_STATES = [
  "IDEA",
  "PLAN",
  "GENERATE",
  "BUILD",
  "DRAFT",
  "HQ_PREVIEW",
  "FOUNDER_REVISION",
  "FOUNDER_APPROVAL",
  "MASTER",
  "DISTRIBUTION_AUTHORIZATION",
];

/** Legacy aliases kept for older Mac heartbeat payloads */
export const GATE_ALIASES = {
  APPROVAL: "FOUNDER_APPROVAL",
  DISTRIBUTION: "DISTRIBUTION_AUTHORIZATION",
};

export function normalizeGate(state) {
  const raw = String(state || "IDEA");
  if (GATE_STATES.includes(raw)) return raw;
  if (GATE_ALIASES[raw]) return GATE_ALIASES[raw];
  if (raw === "APPROVAL") return "FOUNDER_APPROVAL";
  if (raw === "DISTRIBUTION") return "DISTRIBUTION_AUTHORIZATION";
  return "IDEA";
}

export function nextGate(current, event) {
  const cur = normalizeGate(current);
  const map = {
    planned: "PLAN",
    generate: "GENERATE",
    building: "BUILD",
    drafted: "DRAFT",
    previewed: "HQ_PREVIEW",
    revised: "FOUNDER_REVISION",
    approved: "FOUNDER_APPROVAL",
    mastered: "MASTER",
    distribute: "DISTRIBUTION_AUTHORIZATION",
  };
  if (event === "distribute" || event === "publish") {
    return { gate: cur, allowed: false, reason: "DISTRIBUTION_AUTHORIZATION requires explicit Founder approval flag", publish: false };
  }
  if (event === "approved") {
    return { gate: "FOUNDER_APPROVAL", allowed: true, publish: false };
  }
  const next = map[event] || cur;
  return { gate: next, allowed: true, publish: false };
}

export function canPublish({ founderApprovalFlag } = {}) {
  return founderApprovalFlag === true
    ? {
        ok: false,
        publish: false,
        reason:
          "Founder flag noted; DISTRIBUTION_AUTHORIZATION still requires an explicit release command — Aura may NOT publish",
      }
    : { ok: false, publish: false, reason: "publish stays false without Founder approval" };
}

export function gatePayload(state, extras = {}) {
  return {
    gate: normalizeGate(state),
    states: GATE_STATES,
    publish: false,
    founderApprovalRequired: true,
    distributionBlocked: true,
    auraMayNotPublish: true,
    ...extras,
  };
}
