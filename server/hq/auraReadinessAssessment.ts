import { REQUIRED_ACCEPTANCE_TESTS } from "./readOnlyReadinessProbes";

/** Report questions must win over incidental "inspect module / re-run diagnosis" keywords. */
export function isReadinessAssessmentQuestion(command: string): boolean {
  const c = command.trim();
  if (/^(?:aura[,!]?\s*)?(?:run|start|execute|certify)\b/i.test(c)) return false;
  const revision = /\b(?:revise|review|correct|explain)\s+(?:your|the|that|this)\s+assessment\b/i.test(c);
  const scope = /\b(?:hq|headquarters|enterprise)\b/i.test(c);
  const report = /\b(?:assess(?:ment)?|readiness|fully operational|completion|what.*(?:missing|unfinished|fixed|fix|remaining))\b|100\s*%/i.test(c);
  const changeRequest = /^(?:aura[,!]?\s*)?(?:fix|repair|deploy|implement|connect|change)\b/i.test(c);
  return revision || (scope && report && !changeRequest);
}

type EvidenceRun = { completedAt: string; checks: Array<{ id: string; label: string; status: string }> };
export function explainReadinessAssessment(run: EvidenceRun | null): string {
  const lines = [
    "HQ readiness assessment — report only. No new probes, repairs, sends, or deployments were run.",
    run ? `Evidence source: last saved readiness checklist, completed ${run.completedAt}. This is stored evidence, not a fresh verification.`
      : "Evidence source: no saved readiness run. Current operational status is UNVERIFIED; no completion percentage is available.",
  ];
  const failed = run?.checks.filter((c) => c.status === "fail") ?? [];
  if (failed.length) lines.push(`Failures reported in that run: ${failed.map((c) => c.label).join(", ")}. Recheck before treating these as current failures.`);
  for (const area of REQUIRED_ACCEPTANCE_TESTS) {
    const evidence = run?.checks.find((c) => c.id === `acceptance-${area.id}`);
    lines.push(`${area.label}: ${evidence?.status === "pass" ? "Acceptance check reported PASS in the saved run; freshness must be verified" : "UNVERIFIED — no passing acceptance evidence in this checklist"}. Next test: ${area.test}`);
  }
  lines.push("Connection/configuration checks do not establish functional completion. Missing evidence is not a pass. Review detailed integration checks in Enterprise Readiness; unknown providers need scoped read-only verification.");
  lines.push("Next: open Enterprise Readiness and use Run Read-only Assessment to collect supported checks. Transactions, notification tests, isolated restores and production changes require their own scoped authorization.");
  return lines.join("\n\n");
}
