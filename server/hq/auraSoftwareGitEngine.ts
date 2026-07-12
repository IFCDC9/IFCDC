/**
 * AURA Software Engineering — git adapter (workspace-gated).
 * Branch/diff/commit prep allowed locally. Push/merge/force-push require Founder approval.
 */
import { spawn } from "child_process";
import path from "path";
import { getDb } from "../db";
import { ensureAuraSoftwareEngineeringTables } from "./auraSoftwareEngineeringSchema";
import {
  getSeWorkspaceRoot,
  isSeProductionControlPlane,
  isSeWorkspaceConfigured,
} from "./auraSoftwareEngineeringPolicy";

function runGit(args: string[], cwd: string, timeoutMs = 60_000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("git", args, { cwd, env: { ...process.env } });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout?.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr?.on("data", (d) => {
      stderr += String(d);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout: stdout.trim(), stderr: stderr.trim() });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout: "", stderr: err.message });
    });
  });
}

function resolveRepoCwd(relativeCwd?: string): { ok: true; cwd: string; root: string } | { ok: false; error: string } {
  if (!isSeWorkspaceConfigured()) {
    const hint = isSeProductionControlPlane()
      ? "This host is the production control plane (Render). Git writes stay on the Founder workstation — set AURA_SE_WORKSPACE_ROOT there, or run HQ from the IFCDC monorepo."
      : "AURA_SE_WORKSPACE_ROOT is not configured and no IFCDC monorepo was auto-detected. Set AURA_SE_WORKSPACE_ROOT to your IFCDC root.";
    return { ok: false, error: hint };
  }
  const root = getSeWorkspaceRoot()!;
  const cwd = path.resolve(root, relativeCwd || "Apps/IMPERIAL-FOUNDATION-CDC");
  if (!cwd.startsWith(path.resolve(root))) {
    return { ok: false, error: "Refused: path escapes workspace root." };
  }
  return { ok: true, cwd, root };
}

export async function createSeFeatureBranch(opts: {
  branchName: string;
  relativeCwd?: string;
  baseBranch?: string;
}): Promise<{ ok: boolean; branch?: string; message: string; stdout?: string }> {
  const loc = resolveRepoCwd(opts.relativeCwd);
  if (!loc.ok) return { ok: false, message: loc.error };
  const base = opts.baseBranch || "main";
  const branch = opts.branchName.startsWith("aura/se-")
    ? opts.branchName
    : `aura/se-${opts.branchName.replace(/[^a-zA-Z0-9._/-]/g, "-").slice(0, 60)}`;

  await runGit(["fetch", "origin", base], loc.cwd).catch(() => undefined);
  const checkoutBase = await runGit(["checkout", base], loc.cwd);
  if (checkoutBase.code !== 0) {
    // try create from current HEAD
  }
  const create = await runGit(["checkout", "-B", branch], loc.cwd);
  if (create.code !== 0) {
    return { ok: false, message: create.stderr || "Failed to create branch", stdout: create.stdout };
  }
  return { ok: true, branch, message: `Branch ${branch} ready in workspace.`, stdout: create.stdout };
}

export async function summarizeWorkingDiff(opts?: {
  relativeCwd?: string;
}): Promise<{ ok: boolean; summary: string; stat: string; message: string }> {
  const loc = resolveRepoCwd(opts?.relativeCwd);
  if (!loc.ok) {
    return {
      ok: false,
      summary: "",
      stat: "",
      message: loc.error + " Use GitHub compare API / Founder workstation for diffs.",
    };
  }
  const stat = await runGit(["diff", "--stat"], loc.cwd);
  const nameOnly = await runGit(["diff", "--name-only"], loc.cwd);
  const staged = await runGit(["diff", "--cached", "--stat"], loc.cwd);
  const summary = [
    stat.stdout && `Unstaged:\n${stat.stdout}`,
    staged.stdout && `Staged:\n${staged.stdout}`,
    nameOnly.stdout && `Files:\n${nameOnly.stdout}`,
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 12_000);
  return {
    ok: true,
    summary: summary || "No local diff.",
    stat: stat.stdout || staged.stdout || "",
    message: summary ? "Diff captured from workspace." : "Working tree clean.",
  };
}

export async function prepareCommit(opts: {
  message: string;
  paths?: string[];
  relativeCwd?: string;
  dryRun?: boolean;
}): Promise<{ ok: boolean; message: string; staged?: string[] }> {
  const loc = resolveRepoCwd(opts.relativeCwd);
  if (!loc.ok) return { ok: false, message: loc.error };
  if (opts.dryRun !== false && opts.dryRun !== true) {
    /* default allow commit in workspace but caller should gate push */
  }
  if (opts.paths?.length) {
    for (const p of opts.paths) {
      const add = await runGit(["add", "--", p], loc.cwd);
      if (add.code !== 0) return { ok: false, message: `git add failed for ${p}: ${add.stderr}` };
    }
  } else {
    const add = await runGit(["add", "-A"], loc.cwd);
    if (add.code !== 0) return { ok: false, message: add.stderr || "git add failed" };
  }
  const status = await runGit(["status", "--porcelain"], loc.cwd);
  const staged = status.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (!staged.length) return { ok: false, message: "Nothing to commit." };

  if (opts.dryRun) {
    return { ok: true, message: "Dry run — files staged locally, commit not created.", staged };
  }

  const commit = await runGit(["commit", "-m", opts.message], loc.cwd);
  if (commit.code !== 0) return { ok: false, message: commit.stderr || "commit failed", staged };
  return { ok: true, message: "Commit created on local branch (not pushed).", staged };
}

/**
 * Push requires an approved aura_se_approvals row for action=push.
 * Never force-pushes.
 */
export async function pushSeBranch(opts: {
  approvalId: string;
  relativeCwd?: string;
  actorEmail?: string;
}): Promise<{ ok: boolean; message: string; remote?: string }> {
  await ensureAuraSoftwareEngineeringTables();
  const db = await getDb();
  const approval = (await db.get(
    `SELECT * FROM aura_se_approvals WHERE id = ?`,
    opts.approvalId
  )) as Record<string, unknown> | undefined;

  if (!approval) return { ok: false, message: "Approval record not found." };
  if (String(approval.status) !== "approved") {
    return { ok: false, message: "Founder approval required before push." };
  }
  if (String(approval.action) !== "push" && String(approval.action) !== "push_and_pr") {
    return { ok: false, message: `Approval action is '${approval.action}', not push.` };
  }

  const loc = resolveRepoCwd(opts.relativeCwd);
  if (!loc.ok) return { ok: false, message: loc.error };

  const branch = String(approval.branch);
  // Explicitly refuse force
  const push = await runGit(["push", "-u", "origin", branch], loc.cwd);
  if (push.code !== 0) {
    return { ok: false, message: push.stderr || "git push failed" };
  }

  const sha = await runGit(["rev-parse", "HEAD"], loc.cwd);
  await db.run(
    `UPDATE aura_se_approvals SET commit_sha = COALESCE(?, commit_sha), updated_at = ? WHERE id = ?`,
    sha.stdout || null,
    new Date().toISOString(),
    opts.approvalId
  );

  if (approval.change_package_id) {
    await db.run(
      `UPDATE aura_se_change_packages SET status = 'pushed', commit_sha = ?, updated_at = ? WHERE id = ?`,
      sha.stdout || null,
      new Date().toISOString(),
      approval.change_package_id
    );
  }

  return {
    ok: true,
    message: `Pushed ${branch} to origin (no force). Manual Deploy still requires Founder on Render if autoDeploy is false.`,
    remote: `origin/${branch}`,
  };
}

export async function buildPrInstructions(opts: {
  branch: string;
  title: string;
  body: string;
  base?: string;
}): Promise<{ ok: true; instructions: string; ghCommand: string }> {
  const base = opts.base || "main";
  const ghCommand = `gh pr create --base ${base} --head ${opts.branch} --title ${JSON.stringify(opts.title)} --body ${JSON.stringify(opts.body)}`;
  return {
    ok: true,
    ghCommand,
    instructions: [
      "1. Ensure Founder approved push (and push completed if workspace available).",
      `2. Create PR: ${ghCommand}`,
      "3. Do not merge to main without a second Founder approval for action=merge_main.",
      "4. After merge, Manual Deploy on Render if autoDeploy is false.",
      "5. Verify RENDER_GIT_COMMIT matches the released SHA.",
    ].join("\n"),
  };
}

export async function getLocalGitStatus(relativeCwd?: string): Promise<Record<string, unknown>> {
  const loc = resolveRepoCwd(relativeCwd);
  if (!loc.ok) {
    return { workspaceConfigured: false, message: loc.error };
  }
  const branch = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], loc.cwd);
  const sha = await runGit(["rev-parse", "HEAD"], loc.cwd);
  const status = await runGit(["status", "--porcelain"], loc.cwd);
  return {
    workspaceConfigured: true,
    cwd: loc.cwd,
    branch: branch.stdout,
    commit: sha.stdout,
    dirty: Boolean(status.stdout),
    status: status.stdout,
  };
}
