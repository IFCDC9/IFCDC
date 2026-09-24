/**
 * Founder approval gate states for IFCDC Productions.
 * DISTRIBUTION / publish stay blocked without an explicit Founder approval flag.
 */

export const GATE_STATES = [
  "IDEA",
  "PLAN",
  "BUILD",
  "DRAFT",
  "HQ_PREVIEW",
  "FOUNDER_REVISION",
  "APPROVAL",
  "MASTER",
  "DISTRIBUTION",
];

export function nextGate(current, event) {
  const cur = GATE_STATES.includes(current) ? current : "IDEA";
  const map = {
    planned: "PLAN",
    building: "BUILD",
    drafted: "DRAFT",
    previewed: "HQ_PREVIEW",
    revised: "FOUNDER_REVISION",
    approved: "APPROVAL",
    mastered: "MASTER",
    distribute: "DISTRIBUTION",
  };
  if (event === "distribute" || event === "publish") {
    return { gate: cur, allowed: false, reason: "DISTRIBUTION requires explicit Founder approval flag" };
  }
  if (event === "approved" && cur !== "APPROVAL" && cur !== "MASTER") {
    return { gate: "APPROVAL", allowed: true, publish: false };
  }
  const next = map[event] || cur;
  return { gate: next, allowed: true, publish: false };
}

export function canPublish({ founderApprovalFlag } = {}) {
  return founderApprovalFlag === true
    ? { ok: false, publish: false, reason: "Founder flag noted; DISTRIBUTION still requires an explicit release command not implemented in Phase 4" }
    : { ok: false, publish: false, reason: "publish stays false without Founder approval" };
}

export function gatePayload(state, extras = {}) {
  return {
    gate: state,
    states: GATE_STATES,
    publish: false,
    founderApprovalRequired: true,
    distributionBlocked: true,
    ...extras,
  };
}
