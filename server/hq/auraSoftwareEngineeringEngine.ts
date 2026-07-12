/**
 * AURA Software Engineering Engine — Founder-gated AI software engineering for IFCDC HQ.
 * Diagnose → change package → tests → approval → push/PR/deploy instructions.
 * Production Render never silently edits or deploys.
 */
import crypto from "crypto";
import { getDb } from "../db";
import { ensureAuraSoftwareEngineeringTables } from "./auraSoftwareEngineeringSchema";
import { getIndexStats, refreshCodeIndex, searchCodeIndex } from "./auraCodeIndexEngine";
import { runSoftwareEngineeringTests } from "./auraSoftwareTestRunner";
import {
  buildPrInstructions,
  createSeFeatureBranch,
  getLocalGitStatus,
  pushSeBranch,
  summarizeWorkingDiff,
} from "./auraSoftwareGitEngine";
import {
  SE_MAX_FILES_PER_CHANGE,
  detectDestructiveSeCommand,
  getAllowedRepos,
  isSeWorkspaceConfigured,
  resolveAllowedRepo,
} from "./auraSoftwareEngineeringPolicy";
import { SOFTWARE_DIVISION_APPS, pollAllApps, getHqPublicBase } from "./appRegistry";
import { fetchGitHubIntegrationSnapshot } from "./githubIntegrationEngine";

export type SeSeverity = "critical" | "high" | "medium" | "low";

async function seAudit(opts: {
  action: string;
  entityType?: string;
  entityId?: string;
  detail?: string;
  riskLevel?: string;
  founderMode?: boolean;
  founderApproved?: boolean;
  actorEmail?: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    await ensureAuraSoftwareEngineeringTables();
    const db = await getDb();
    await db.run(
      `INSERT INTO aura_se_audit_log (
        id, action, entity_type, entity_id, detail, risk_level, founder_mode, founder_approved, metadata_json, actor_email, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      crypto.randomUUID(),
      opts.action,
      opts.entityType ?? null,
      opts.entityId ?? null,
      opts.detail ?? null,
      opts.riskLevel ?? "low",
      opts.founderMode ? 1 : 0,
      opts.founderApproved ? 1 : 0,
      opts.metadata ? JSON.stringify(opts.metadata) : null,
      opts.actorEmail ?? null,
      new Date().toISOString()
    );
  } catch {
    /* audit best-effort */
  }
}

export async function buildSoftwarePortfolioMap() {
  await ensureAuraSoftwareEngineeringTables();
  const [health, github, indexStats, openDiag, pendingApprovals] = await Promise.all([
    pollAllApps().catch(() => []),
    fetchGitHubIntegrationSnapshot().catch(() => null),
    getIndexStats(),
    listDiagnoses({ status: "open", limit: 20 }),
    listApprovals({ status: "pending", limit: 20 }),
  ]);

  const healthById = new Map(
    (health as Array<{ id: string; healthy: boolean; error?: string; latencyMs?: number }>).map((h) => [h.id, h])
  );

  const apps = SOFTWARE_DIVISION_APPS.map((app) => {
    const h = healthById.get(app.id);
    return {
      id: app.id,
      name: app.name,
      description: app.description,
      status: app.status,
      path: app.path,
      productionUrl: app.launchUrl || app.healthUrl,
      healthUrl: app.healthUrl,
      healthy: h?.healthy ?? null,
      healthError: h?.error ?? null,
      latencyMs: h?.latencyMs ?? null,
      sharedServices: ["@ifcdc/auth", "@ifcdc/aura-ai", "@ifcdc/notifications", "@ifcdc/payments", "@ifcdc/database"],
      githubCommit: github?.latestCommit ?? null,
      liveCommit: github?.liveCommit ?? null,
      deployAlignment: github?.deploymentStatus ?? "unknown",
    };
  });

  const unhealthy = apps.filter((a) => a.healthy === false);

  return {
    generatedAt: new Date().toISOString(),
    hqBase: getHqPublicBase(),
    github: github
      ? {
          repository: github.repository,
          branch: github.branch,
          latestCommit: github.latestCommit,
          liveCommit: github.liveCommit,
          deploymentStatus: github.deploymentStatus,
          repositoryHealth: github.repositoryHealth,
          message: github.message,
        }
      : null,
    index: indexStats,
    workspaceConfigured: isSeWorkspaceConfigured(),
    apps,
    openDiagnoses: openDiag,
    pendingApprovals,
    recommendedPriorities: [
      ...unhealthy.map((a) => ({
        priority: "high" as const,
        title: `${a.name} health check failing`,
        detail: a.healthError || "Health endpoint unhealthy",
        path: "/hq/software-engineering",
      })),
      ...(github?.deploymentStatus === "behind"
        ? [
            {
              priority: "high" as const,
              title: "GitHub main ahead of Render live commit",
              detail: `GitHub ${github.latestCommit} vs live ${github.liveCommit} — Manual Deploy may be required.`,
              path: "/hq/integrations",
            },
          ]
        : []),
      ...pendingApprovals.slice(0, 3).map((a) => ({
        priority: "medium" as const,
        title: `Founder approval waiting: ${a.action}`,
        detail: `${a.repository}@${a.branch}`,
        path: "/hq/software-engineering",
      })),
    ],
    allowlistedRepos: getAllowedRepos().map((r) => ({
      id: r.id,
      label: r.label,
      repository: `${r.owner}/${r.name}`,
      branch: r.defaultBranch,
      pathPrefixes: r.pathPrefixes,
    })),
  };
}

export async function buildSoftwareEngineeringDashboard() {
  const portfolio = await buildSoftwarePortfolioMap();
  const db = await getDb();
  const packages = (await db.all(
    `SELECT id, title, status, branch_name, risk_summary, updated_at FROM aura_se_change_packages
     ORDER BY updated_at DESC LIMIT 15`
  )) as Record<string, unknown>[];
  const recentTests = (await db.all(
    `SELECT id, overall_status, created_at, change_package_id FROM aura_se_test_runs
     ORDER BY created_at DESC LIMIT 10`
  )) as Record<string, unknown>[];
  const failedTests = recentTests.filter((t) => t.overall_status === "failed");

  return {
    ...portfolio,
    changePackages: packages,
    recentTestRuns: recentTests,
    failedBuildsOrTests: failedTests,
    securityWarnings: [
      !portfolio.index.githubConfigured
        ? "GITHUB_TOKEN not set — GitHub indexing and live commit compare limited."
        : null,
      !portfolio.workspaceConfigured
        ? "AURA_SE_WORKSPACE_ROOT not set — local branch/test/commit disabled on this host (expected on Render)."
        : null,
    ].filter(Boolean),
    technicalDebt: [],
    founderApprovalsWaiting: portfolio.pendingApprovals,
  };
}

export async function diagnoseIssue(opts: {
  symptom: string;
  repoId?: string;
  actorEmail?: string;
  founderMode?: boolean;
}): Promise<Record<string, unknown>> {
  await ensureAuraSoftwareEngineeringTables();
  const symptom = opts.symptom.trim();
  if (!symptom) throw new Error("symptom is required");

  const destructive = detectDestructiveSeCommand(symptom);
  const repo = resolveAllowedRepo(opts.repoId) || getAllowedRepos()[0];
  const hits = await searchCodeIndex({
    q: symptom.split(/\s+/).slice(0, 6).join(" "),
    repoId: repo?.id,
    limit: 15,
  });

  // Heuristic diagnosis grounded in index + portfolio — no fake certainty
  const severity: SeSeverity = /\b(crash|outage|down|500|production|security|auth)\b/i.test(symptom)
    ? "high"
    : /\b(bug|fail|error|broken)\b/i.test(symptom)
      ? "medium"
      : "low";

  const affected = hits.slice(0, 8).map((h) => String(h.path));
  const rootCause = hits.length
    ? `Index search found ${hits.length} related path(s). Likely area: ${affected[0] || "unknown"}. Review symbols/API routes before editing.`
    : "Code index had no strong match. Refresh the index (GITHUB_TOKEN or AURA_SE_WORKSPACE_ROOT) and re-run diagnosis with a file/module hint.";

  const requiredTests = ["npm run check", "npm run build"];
  if (/\b(api|route|server)\b/i.test(symptom)) requiredTests.push("API smoke against /api/health");
  if (/\b(ui|page|component|button)\b/i.test(symptom)) requiredTests.push("Manual UI regression on affected page");

  const founderApprovalRequired = severity !== "low" || Boolean(destructive);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const db = await getDb();
  const title = symptom.slice(0, 120);
  const recommendedFix = hits.length
    ? `Inspect ${affected.slice(0, 3).join(", ")}; implement a minimal non-destructive fix on an aura/se-* branch; run real checks before Founder approval.`
    : "Gather runtime logs (browser console, server, Render), refresh code index, then narrow to a single module.";

  await db.run(
    `INSERT INTO aura_se_diagnoses (
      id, repo_id, title, symptom, root_cause, affected_files_json, severity, recommended_fix, risk,
      required_tests_json, founder_approval_required, status, command, metadata_json, actor_email, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)`,
    id,
    repo?.id ?? null,
    title,
    symptom,
    rootCause,
    JSON.stringify(affected),
    severity,
    recommendedFix,
    destructive
      ? `Blocked destructive intent detected: ${destructive}. Diagnosis only — no execution.`
      : severity === "high"
        ? "High severity — Founder approval required before any production action."
        : "Low–medium risk if confined to an isolated branch with tests.",
    JSON.stringify(requiredTests),
    founderApprovalRequired ? 1 : 1, // always require Founder for SE change path
    symptom,
    JSON.stringify({ indexHits: hits.slice(0, 8), destructive }),
    opts.actorEmail ?? null,
    now,
    now
  );

  await seAudit({
    action: "diagnose",
    entityType: "diagnosis",
    entityId: id,
    detail: title,
    riskLevel: severity,
    founderMode: opts.founderMode,
    actorEmail: opts.actorEmail,
  });

  return {
    id,
    title,
    symptom,
    rootCause,
    affectedFiles: affected,
    severity,
    recommendedFix,
    risk: destructive ? `Destructive verb blocked: ${destructive}` : "Isolated branch + Founder gate",
    requiredTests,
    founderApprovalRequired: true,
    indexHits: hits.slice(0, 8),
    repository: repo ? `${repo.owner}/${repo.name}` : null,
    status: "open",
  };
}

export async function listDiagnoses(opts?: { status?: string; limit?: number }) {
  await ensureAuraSoftwareEngineeringTables();
  const db = await getDb();
  const limit = opts?.limit ?? 30;
  if (opts?.status) {
    return db.all(
      `SELECT * FROM aura_se_diagnoses WHERE status = ? ORDER BY created_at DESC LIMIT ?`,
      opts.status,
      limit
    );
  }
  return db.all(`SELECT * FROM aura_se_diagnoses ORDER BY created_at DESC LIMIT ?`, limit);
}

export async function prepareFixPackage(opts: {
  diagnosisId?: string;
  title: string;
  repoId?: string;
  proposedOps?: Array<{ path: string; action: string; note?: string }>;
  actorEmail?: string;
  founderMode?: boolean;
}): Promise<Record<string, unknown>> {
  await ensureAuraSoftwareEngineeringTables();
  const repo = resolveAllowedRepo(opts.repoId) || getAllowedRepos()[0];
  if (!repo) throw new Error("No allowlisted repository");

  const ops = (opts.proposedOps || []).slice(0, SE_MAX_FILES_PER_CHANGE);
  const branchSlug = opts.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  const branchName = `aura/se-${branchSlug || "fix"}-${Date.now().toString(36).slice(-4)}`;

  let branchResult: { ok: boolean; branch?: string; message: string } = {
    ok: false,
    message: "Workspace not configured — branch will be created when AURA_SE_WORKSPACE_ROOT is set.",
  };
  if (isSeWorkspaceConfigured()) {
    branchResult = await createSeFeatureBranch({ branchName, baseBranch: repo.defaultBranch });
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const testPlan = ["npm run check", "npm run build", "npm test"];
  const riskSummary =
    ops.length > 10
      ? "Larger change set — extra Founder review required."
      : "Low-risk isolated branch; no production deploy without separate Founder approval.";

  const db = await getDb();
  await db.run(
    `INSERT INTO aura_se_change_packages (
      id, diagnosis_id, repo_id, branch_name, base_branch, title, status, proposed_ops_json,
      test_plan_json, diff_summary, risk_summary, actor_email, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)`,
    id,
    opts.diagnosisId ?? null,
    repo.id,
    branchResult.branch || branchName,
    repo.defaultBranch,
    opts.title,
    JSON.stringify(ops),
    JSON.stringify(testPlan),
    branchResult.message,
    riskSummary,
    opts.actorEmail ?? null,
    now,
    now
  );

  await seAudit({
    action: "prepare_fix_package",
    entityType: "change_package",
    entityId: id,
    detail: opts.title,
    founderMode: opts.founderMode,
    actorEmail: opts.actorEmail,
    metadata: { branch: branchResult.branch || branchName, workspace: isSeWorkspaceConfigured() },
  });

  return {
    id,
    title: opts.title,
    status: "draft",
    repository: `${repo.owner}/${repo.name}`,
    branch: branchResult.branch || branchName,
    baseBranch: repo.defaultBranch,
    proposedOps: ops,
    testPlan,
    riskSummary,
    workspace: {
      configured: isSeWorkspaceConfigured(),
      branchCreated: branchResult.ok,
      message: branchResult.message,
    },
    nextSteps: [
      "Implement or apply the fix on the aura/se-* branch (workspace host).",
      "Run se_run_tests / POST .../tests with real npm commands.",
      "Request Founder approval with exact repo/branch/commit/service/action/risk.",
      "Only after approval: push / prepare PR / Manual Deploy instructions.",
    ],
  };
}

export async function requestFounderApproval(opts: {
  changePackageId?: string;
  repository: string;
  branch: string;
  commitSha?: string;
  service: string;
  action: "push" | "push_and_pr" | "merge_main" | "deploy_production" | "rollback_production" | "migrate_production";
  riskSummary: string;
  note?: string;
  actorEmail?: string;
}): Promise<Record<string, unknown>> {
  await ensureAuraSoftwareEngineeringTables();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const db = await getDb();
  await db.run(
    `INSERT INTO aura_se_approvals (
      id, change_package_id, repository, branch, commit_sha, service, action, risk_summary,
      status, note, actor_email, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
    id,
    opts.changePackageId ?? null,
    opts.repository,
    opts.branch,
    opts.commitSha ?? null,
    opts.service,
    opts.action,
    opts.riskSummary,
    opts.note ?? null,
    opts.actorEmail ?? null,
    now,
    now
  );

  if (opts.changePackageId) {
    await db.run(
      `UPDATE aura_se_change_packages SET status = 'awaiting_founder', updated_at = ? WHERE id = ?`,
      now,
      opts.changePackageId
    );
  }

  await seAudit({
    action: "request_founder_approval",
    entityType: "approval",
    entityId: id,
    detail: `${opts.action} ${opts.repository}@${opts.branch}`,
    riskLevel: "high",
    actorEmail: opts.actorEmail,
    metadata: opts,
  });

  return {
    id,
    status: "pending",
    repository: opts.repository,
    branch: opts.branch,
    commitSha: opts.commitSha ?? null,
    service: opts.service,
    action: opts.action,
    riskSummary: opts.riskSummary,
    message: "Staged for Founder approval. AURA will not push/deploy until you approve this exact action.",
  };
}

export async function decideFounderApproval(opts: {
  approvalId: string;
  decision: "approve" | "reject";
  actorEmail?: string;
  note?: string;
  founderMode?: boolean;
}): Promise<Record<string, unknown>> {
  await ensureAuraSoftwareEngineeringTables();
  if (!opts.founderMode) {
    return { ok: false, error: "Founder Mode required to approve software engineering actions." };
  }
  const db = await getDb();
  const row = (await db.get(`SELECT * FROM aura_se_approvals WHERE id = ?`, opts.approvalId)) as
    | Record<string, unknown>
    | undefined;
  if (!row) return { ok: false, error: "Approval not found" };

  const now = new Date().toISOString();
  const status = opts.decision === "approve" ? "approved" : "rejected";
  await db.run(
    `UPDATE aura_se_approvals SET status = ?, approved_by = ?, approved_at = ?, note = COALESCE(?, note), updated_at = ? WHERE id = ?`,
    status,
    opts.actorEmail ?? null,
    now,
    opts.note ?? null,
    now,
    opts.approvalId
  );

  if (row.change_package_id) {
    await db.run(
      `UPDATE aura_se_change_packages SET status = ?, updated_at = ? WHERE id = ?`,
      opts.decision === "approve" ? "approved" : "closed",
      now,
      row.change_package_id
    );
  }

  await seAudit({
    action: `founder_${opts.decision}`,
    entityType: "approval",
    entityId: opts.approvalId,
    detail: String(row.action),
    founderMode: true,
    founderApproved: opts.decision === "approve",
    actorEmail: opts.actorEmail,
    riskLevel: "high",
  });

  let followUp: Record<string, unknown> | null = null;
  if (opts.decision === "approve" && (row.action === "push" || row.action === "push_and_pr")) {
    if (isSeWorkspaceConfigured()) {
      followUp = await pushSeBranch({ approvalId: opts.approvalId, actorEmail: opts.actorEmail });
    } else {
      followUp = {
        ok: false,
        message:
          "Approved. Push must be run on the engineering host with AURA_SE_WORKSPACE_ROOT, or push manually then record the commit SHA.",
      };
    }
    if (row.action === "push_and_pr") {
      const pr = await buildPrInstructions({
        branch: String(row.branch),
        title: `AURA SE: ${row.branch}`,
        body: `Founder-approved change.\n\nRisk: ${row.risk_summary}\nApproval: ${opts.approvalId}`,
      });
      followUp = { ...(followUp || {}), pr };
    }
  }

  if (opts.decision === "approve" && (row.action === "deploy_production" || row.action === "rollback_production")) {
    followUp = {
      ok: true,
      message: "Approved for production action — AURA will NOT auto-deploy.",
      instructions: [
        `Service: ${row.service}`,
        `Repository: ${row.repository}`,
        `Branch/Commit: ${row.branch} / ${row.commit_sha || "(set commit)"}`,
        "Open Render dashboard → Manual Deploy (autoDeploy is false for HQ).",
        "After deploy, verify /api/health and compare RENDER_GIT_COMMIT to GitHub.",
        "Record smoke results in SE audit.",
      ],
    };
  }

  return { ok: true, status, approval: { ...row, status }, followUp };
}

export async function listApprovals(opts?: { status?: string; limit?: number }) {
  await ensureAuraSoftwareEngineeringTables();
  const db = await getDb();
  const limit = opts?.limit ?? 30;
  if (opts?.status) {
    return db.all(
      `SELECT * FROM aura_se_approvals WHERE status = ? ORDER BY created_at DESC LIMIT ?`,
      opts.status,
      limit
    );
  }
  return db.all(`SELECT * FROM aura_se_approvals ORDER BY created_at DESC LIMIT ?`, limit);
}

export async function compareDeployAlignment() {
  const snap = await fetchGitHubIntegrationSnapshot();
  return {
    repository: snap.repository,
    branch: snap.branch,
    githubCommit: snap.latestCommit,
    githubCommitFull: snap.latestCommitFull,
    liveCommit: snap.liveCommit,
    deploymentStatus: snap.deploymentStatus,
    message: snap.message,
    recommendation:
      snap.deploymentStatus === "aligned"
        ? "GitHub and live commit appear aligned."
        : snap.deploymentStatus === "behind"
          ? "Production may be behind GitHub main — Manual Deploy on Render after Founder approval."
          : "Unable to fully compare — verify GITHUB_TOKEN and RENDER_GIT_COMMIT.",
    founderApprovalRequiredForDeploy: true,
  };
}

export function wantsSoftwareEngineeringCommand(command: string): boolean {
  const c = command.trim();
  if (!c) return false;
  return (
    /\b(software engineering|code index|pull request|prepare a pr|run (the )?(tests|test suite)|typecheck|broken imports)\b/i.test(c)
    || /\b(check|inspect|diagnose|fix|refactor|debug)\b.*\b(module|component|page|api|bug|crash|import)\b/i.test(c)
    || /\b(compare|align)\b.*\b(github|render|deploy|commit)\b/i.test(c)
    || /\b(roll ?back)\b.*\b(release|deploy|production)\b/i.test(c)
    || /\b(check all ifcdc|software (division )?portfolio|failed builds?)\b/i.test(c)
    || /\b(create|prepare)\b.*\b(branch|commit|pr|pull request)\b/i.test(c)
  );
}

export async function handleSoftwareEngineeringCommand(opts: {
  command: string;
  actorEmail?: string;
  founderMode?: boolean;
  isFounder?: boolean;
}): Promise<{
  reply: string;
  action: string;
  data?: unknown;
  approvalRequired?: boolean;
}> {
  await ensureAuraSoftwareEngineeringTables();
  const command = opts.command.trim();
  const founderOk = Boolean(opts.founderMode || opts.isFounder);

  const destructive = detectDestructiveSeCommand(command);
  if (destructive && !founderOk) {
    await seAudit({
      action: "blocked_destructive",
      detail: destructive,
      actorEmail: opts.actorEmail,
      riskLevel: "critical",
    });
    return {
      reply: `Blocked: ${destructive} requires Founder Mode and an explicit approval record (repo, branch, commit, service, action, risk).`,
      action: "blocked",
      approvalRequired: true,
    };
  }

  if (/\b(portfolio|software division|all ifcdc app|application health|failed builds?)\b/i.test(command)) {
    const dash = await buildSoftwareEngineeringDashboard();
    return {
      reply: `Software portfolio: ${dash.apps.length} apps, ${dash.apps.filter((a) => a.healthy === false).length} unhealthy, deploy ${dash.github?.deploymentStatus ?? "unknown"}, ${dash.pendingApprovals.length} Founder approvals waiting.`,
      action: "portfolio",
      data: dash,
    };
  }

  if (/\b(compare|align|deployment|render).*(github|commit|live)|github.*(render|live)\b/i.test(command)) {
    const cmp = await compareDeployAlignment();
    return { reply: cmp.recommendation, action: "compare_deploy", data: cmp, approvalRequired: true };
  }

  if (/\b(refresh|rebuild|update)\b.*\b(index|code index)\b/i.test(command)) {
    if (!founderOk) {
      return { reply: "Founder Mode required to refresh the code index.", action: "denied" };
    }
    const result = await refreshCodeIndex({ actorEmail: opts.actorEmail });
    return { reply: result.message, action: "index_refresh", data: result };
  }

  if (/\b(run|execute)\b.*\b(test|check|build|lint)\b/i.test(command)) {
    if (!founderOk) {
      return { reply: "Founder Mode required to run engineering tests.", action: "denied" };
    }
    const result = await runSoftwareEngineeringTests({ actorEmail: opts.actorEmail });
    return { reply: result.message, action: "run_tests", data: result };
  }

  if (/\b(prepare|create)\b.*\b(pr|pull request)\b/i.test(command)) {
    const status = await getLocalGitStatus();
    const branch = typeof status.branch === "string" ? status.branch : "aura/se-fix";
    const pr = await buildPrInstructions({
      branch,
      title: "AURA Software Engineering change",
      body: command,
    });
    return {
      reply: "PR instructions prepared. Push still requires Founder approval.",
      action: "prepare_pr",
      data: { ...pr, gitStatus: status },
      approvalRequired: true,
    };
  }

  if (/\b(diff|what changed|explain (the )?change)\b/i.test(command)) {
    const diff = await summarizeWorkingDiff();
    return { reply: diff.message, action: "explain_diff", data: diff };
  }

  // Default: diagnose
  if (!founderOk && /\b(fix|implement|refactor|commit|push|deploy)\b/i.test(command)) {
    return {
      reply: "Founder Mode required for software change preparation. I can still inspect portfolio health in read-only mode.",
      action: "denied",
    };
  }

  const diagnosis = await diagnoseIssue({
    symptom: command,
    actorEmail: opts.actorEmail,
    founderMode: founderOk,
  });

  let changePackage: Record<string, unknown> | null = null;
  if (founderOk && /\b(fix|prepare|build|implement)\b/i.test(command)) {
    changePackage = await prepareFixPackage({
      diagnosisId: String(diagnosis.id),
      title: String(diagnosis.title),
      actorEmail: opts.actorEmail,
      founderMode: founderOk,
      proposedOps: (diagnosis.affectedFiles as string[]).slice(0, 5).map((p) => ({
        path: p,
        action: "review_and_patch",
        note: "Staged from diagnosis index hits",
      })),
    });
  }

  return {
    reply: [
      `Diagnosis ${diagnosis.id}: ${diagnosis.rootCause}`,
      `Severity: ${diagnosis.severity}. Founder approval required before production actions.`,
      changePackage ? `Change package ${changePackage.id} drafted on branch ${changePackage.branch}.` : "Say “prepare a fix” in Founder Mode to open a change package.",
    ].join(" "),
    action: changePackage ? "diagnose_and_prepare" : "diagnose",
    data: { diagnosis, changePackage },
    approvalRequired: true,
  };
}
