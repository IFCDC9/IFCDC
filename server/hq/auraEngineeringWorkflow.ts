/**
 * AURA's first complete engineering workflow.
 * Founder assigns a bounded task; AURA operates an isolated worktree of the
 * approved HQ repository, edits files, runs a scoped test, and can open a PR.
 * AURA stays the operator. The authenticated session stays the requester.
 * Production deploy, force-push, and hook skips are refused.
 */
import crypto from "crypto";
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { getDb } from "../db";
import {
  AURA_OPERATOR,
  HUMAN_EXEC_EMAIL,
  founderApprovalAllowed,
  isExcludedExecIdentity,
} from "./auraActorIdentity";
import { logHqAudit } from "./hqAuditLog";
import { ensureAuraSoftwareEngineeringTables } from "./auraSoftwareEngineeringSchema";
import {
  classifyFileKind,
  detectDestructiveSeCommand,
  isPathDenied,
  isSeProductionControlPlane,
  redactSecrets,
} from "./auraSoftwareEngineeringPolicy";

export const APPROVED_ENGINEERING_REPO = { owner: "IFCDC9", name: "IFCDC" } as const;

const NOTE_PATH = "Documents/products/AURA-ENGINEERING-WORKFLOW-NOTE.md";
const NOTE_TEST_PATH = "script/hq-aura-engineering-workflow-note.test.mjs";

export type EngineeringRequester = {
  id: string;
  email: string;
  role: string;
  isFounder?: boolean;
  founderMode?: boolean;
};

export type EngineeringEdit = {
  path: string;
  content: string;
};

export type EngineeringTaskInput = {
  requester: EngineeringRequester;
  instruction: string;
  edits?: EngineeringEdit[];
  testCommand?: string;
  openPullRequest?: boolean;
  baseRef?: "HEAD" | "origin/main";
};

export type EngineeringTestRecord = {
  command: string;
  exitCode: number | null;
  passed: boolean;
  stdout: string;
  stderr: string;
};

export type EngineeringTaskResult = {
  ok: boolean;
  status: "success" | "failure" | "missing_access";
  message: string;
  requester: { id: string; email: string; role: string };
  operator: {
    id: "aura";
    kind: "ai_operator";
    role: "aura";
    isFounder: false;
    founderMode: false;
    email: null;
  };
  files: string[];
  branch: string | null;
  commitSha: string | null;
  prUrl: string | null;
  tests: EngineeringTestRecord | null;
  productionExecuted: false;
  workspace: string | null;
};

type CommandResult = { code: number; stdout: string; stderr: string };

export function engineeringApprovalAllowed(session: {
  id?: string | null;
  email?: string | null;
  role?: string | null;
  isFounder?: boolean;
  founderMode?: boolean;
}): boolean {
  if (session.id === AURA_OPERATOR.id) return false;
  if (isExcludedExecIdentity(session)) return false;
  const role = (session.role || "").toLowerCase();
  const email = (session.email || "").toLowerCase();
  const master = (process.env.MASTER_OWNER_EMAIL || "service@ifcdc.org").toLowerCase();
  if (master === HUMAN_EXEC_EMAIL) return false;
  const founderByRole = role === "owner" || role === "founder";
  const founderByEmail = Boolean(email) && email === master;
  if (!founderByRole && !founderByEmail) return false;
  return founderApprovalAllowed({
    id: session.id,
    email: session.email,
    role: founderByRole ? role : "owner",
    isFounder: true,
  });
}

export function resolveApprovedRepoRoot(): string {
  const explicit = (process.env.AURA_SE_APPROVED_REPO_ROOT || "").trim();
  if (explicit) return path.resolve(explicit);
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
}

export function resolveWorktreeParent(approvedRepoRoot: string): string {
  const explicit = (process.env.AURA_SE_WORKTREE_PARENT || "").trim();
  if (explicit) return path.resolve(explicit);
  return path.resolve(approvedRepoRoot, "..", ".aura-engineer-worktrees");
}

export function containedWorkspacePath(workspaceRoot: string, relativePath: string): string | null {
  if (!relativePath || path.isAbsolute(relativePath)) return null;
  const parts = relativePath.split(/[/\\]/);
  if (parts.some((part) => part === ".." || part === "")) return null;
  const root = path.resolve(workspaceRoot);
  const target = path.resolve(root, relativePath);
  const rel = path.relative(root, target);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  // Refuse links within the worktree before writing or testing.
  let current = target;
  while (true) {
    try {
      if (fs.lstatSync(current).isSymbolicLink()) return null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return null;
    }
    if (current === root) break;
    current = path.dirname(current);
  }
  return target;
}

export function workspaceStaysWithApprovedRepo(opts: {
  approvedRepoRoot: string;
  worktreeParent: string;
  workspace: string;
}): boolean {
  const parent = path.resolve(opts.worktreeParent);
  const workspace = path.resolve(opts.workspace);
  const repo = path.resolve(opts.approvedRepoRoot);
  const rel = path.relative(parent, workspace);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel) || rel.includes("..")) return false;
  if (workspace === repo) return false;
  const gitDir = path.resolve(repo, ".git");
  if (workspace === gitDir || workspace.startsWith(gitDir + path.sep)) return false;
  return true;
}

export function classifyTerminalCommand(command: string): { allowed: boolean; reason: string } {
  const trimmed = command.trim();
  if (!trimmed) return { allowed: false, reason: "Empty command" };
  if (/[;&|`$<>\n\r]/.test(trimmed)) {
    return { allowed: false, reason: "Shell operators are outside the scoped terminal" };
  }
  const destructive = detectDestructiveSeCommand(trimmed);
  if (destructive) return { allowed: false, reason: destructive };
  if (/--no-verify|--no-gpg-sign|force-with-lease|(^|\s)-f(\s|$)|--force\b/i.test(trimmed)) {
    return { allowed: false, reason: "Refused force-push or hook skip" };
  }
  if (/\b(printenv|\benv\b|cat\s+.*\.env|git\s+config)\b/i.test(trimmed)) {
    return { allowed: false, reason: "Refused secret printing or git config change" };
  }
  if (/\b(npm|pnpm|yarn)\s+(run\s+)?(deploy|release)\b/i.test(trimmed) || /\brender\s+deploy\b/i.test(trimmed)) {
    return { allowed: false, reason: "Production deploy is not executed" };
  }
  if (/\bgit\s+push\b/i.test(trimmed)) {
    return { allowed: false, reason: "Direct git push is outside the scoped terminal" };
  }
  const parts = trimmed.split(/\s+/);
  if (parts[0] === "node" && parts[1] === "--test" && parts.length === 3 && isScopedTestPath(parts[2])) {
    return { allowed: true, reason: "Scoped test" };
  }
  return { allowed: false, reason: "Command is outside the scoped terminal" };
}

function isScopedTestPath(relativePath: string): boolean {
  if (!/^[\w./-]+$/.test(relativePath) || relativePath.includes("..")) return false;
  return /^script\/[\w./-]+\.(test|spec)\.(mjs|cjs|js|ts)$/.test(relativePath);
}

function redactOutput(text: string): string {
  return redactSecrets(text)
    .replace(/gh[pousr]_[A-Za-z0-9_]+/g, "[REDACTED]")
    .replace(/github_pat_[A-Za-z0-9_]+/g, "[REDACTED]")
    .replace(/https:\/\/[^@\s]+@github\.com/g, "https://[REDACTED]@github.com");
}

function operatorView(): EngineeringTaskResult["operator"] {
  return {
    id: AURA_OPERATOR.id,
    kind: AURA_OPERATOR.kind,
    role: AURA_OPERATOR.role,
    isFounder: AURA_OPERATOR.isFounder,
    founderMode: AURA_OPERATOR.founderMode,
    email: AURA_OPERATOR.email,
  };
}

function requesterView(requester: EngineeringRequester): EngineeringTaskResult["requester"] {
  return { id: requester.id, email: requester.email, role: requester.role };
}

function emptyResult(
  requester: EngineeringRequester,
  status: EngineeringTaskResult["status"],
  message: string,
): EngineeringTaskResult {
  return {
    ok: status === "success",
    status,
    message,
    requester: requesterView(requester),
    operator: operatorView(),
    files: [],
    branch: null,
    commitSha: null,
    prUrl: null,
    tests: null,
    productionExecuted: false,
    workspace: null,
  };
}

async function recordTaskAudit(opts: {
  status: EngineeringTaskResult["status"];
  requester: EngineeringRequester;
  message: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const action = `aura_engineering_task_${opts.status}`;
  const metadata = {
    auraActorId: AURA_OPERATOR.id,
    auraRole: AURA_OPERATOR.role,
    kind: AURA_OPERATOR.kind,
    isFounder: false,
    operator: "aura",
    requesterId: opts.requester.id,
    requesterEmail: opts.requester.email,
    requesterRole: opts.requester.role,
    attribution: "requesting_user",
    productionExecuted: false,
    ...opts.metadata,
  };
  await logHqAudit({
    action,
    entityType: "aura_actor",
    entityId: AURA_OPERATOR.id,
    detail: redactOutput(opts.message).slice(0, 400),
    actorId: AURA_OPERATOR.id,
    metadata,
  });
  try {
    await ensureAuraSoftwareEngineeringTables();
    const db = await getDb();
    await db.run(
      `INSERT INTO aura_se_audit_log (
        id, action, entity_type, entity_id, detail, risk_level, founder_mode, founder_approved, metadata_json, actor_email, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      crypto.randomUUID(),
      action,
      "engineering_task",
      AURA_OPERATOR.id,
      redactOutput(opts.message).slice(0, 400),
      opts.status === "success" ? "low" : "high",
      engineeringApprovalAllowed(opts.requester) ? 1 : 0,
      0,
      JSON.stringify(metadata),
      null,
      new Date().toISOString(),
    );
  } catch {
    /* HQ audit already recorded the outcome. */
  }
}

export function engineeringTestEnvironment(workspace: string): NodeJS.ProcessEnv {
  // This reduces accidental credential exposure; it is not an OS sandbox.
  return {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    HOME: workspace,
    USERPROFILE: workspace,
    TMPDIR: workspace,
    TMP: workspace,
    TEMP: workspace,
    NODE_ENV: "test",
    LANG: "C.UTF-8",
  };
}

export function isApprovedEngineeringRemote(remote: string): boolean {
  return /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)IFCDC9\/IFCDC(?:\.git)?$/i.test(remote.trim());
}

async function approvedOrigin(repoRoot: string): Promise<boolean> {
  for (const mode of [[], ["--push"]]) {
    const remote = await runArgv(["git", "remote", "get-url", ...mode, "--all", "origin"], repoRoot);
    const urls = remote.stdout.split(/\r?\n/).filter(Boolean);
    if (remote.code !== 0 || urls.length !== 1 || !isApprovedEngineeringRemote(urls[0])) return false;
  }
  return true;
}

function runArgv(argv: string[], cwd: string): Promise<CommandResult> {
  const allowed = new Set(["git", "node", "gh"]);
  if (!allowed.has(argv[0] || "")) {
    return Promise.resolve({ code: 1, stdout: "", stderr: "Command is outside the scoped terminal" });
  }
  return new Promise((resolve) => {
    const childEnv: NodeJS.ProcessEnv = argv[0] === "node"
      ? engineeringTestEnvironment(cwd)
      : { ...process.env, GIT_TERMINAL_PROMPT: "0" };
    // Start an independent test runner, even when HQ is itself under node --test.
    delete childEnv.NODE_TEST_CONTEXT;
    const child = spawn(argv[0], argv.slice(1), {
      cwd,
      shell: false,
      env: childEnv,
    });
    let stdout = "";
    let stderr = "";
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 2_000);
    }, 120_000);
    child.stdout?.on("data", (chunk) => {
      stdout = (stdout + String(chunk)).slice(-65_536);
    });
    child.stderr?.on("data", (chunk) => {
      stderr = (stderr + String(chunk)).slice(-65_536);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      resolve({ code: code ?? 1, stdout: stdout.trim(), stderr: stderr.trim() });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      resolve({ code: 1, stdout: "", stderr: err.message });
    });
  });
}

async function gitCommonDir(cwd: string): Promise<string | null> {
  const result = await runArgv(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], cwd);
  if (result.code !== 0 || !result.stdout) return null;
  return path.resolve(result.stdout);
}

export async function worktreeBelongsToApprovedRepo(workspace: string, approvedRepoRoot: string): Promise<boolean> {
  const workspaceGit = await gitCommonDir(workspace);
  const repoGit = await gitCommonDir(approvedRepoRoot);
  if (!workspaceGit || !repoGit) return false;
  return workspaceGit === repoGit;
}

function safeBranchName(instruction: string): string | null {
  const slug = instruction
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  const branch = `aura/se-${slug || "task"}-${crypto.randomBytes(3).toString("hex")}`;
  if (!/^aura\/se-[a-z0-9][a-z0-9-]{0,70}$/.test(branch)) return null;
  if (branch.includes("..") || branch === "main" || branch === "master") return null;
  return branch;
}

function pushRefspec(branch: string): string | null {
  if (!/^aura\/se-[a-z0-9][a-z0-9-]{0,70}$/.test(branch)) return null;
  return `HEAD:refs/heads/${branch}`;
}

function editAllowed(relativePath: string): string | null {
  if (isPathDenied(relativePath)) return "Path is denied";
  if (classifyFileKind(relativePath) === "deployment") return "Deployment files are outside this workflow";
  if (relativePath.startsWith(".github/")) return "Workflow files are outside this workflow";
  return null;
}

function instructionBlocked(instruction: string): string | null {
  const destructive = detectDestructiveSeCommand(instruction);
  if (destructive) return destructive;
  if (/\$\s?\d/.test(instruction)) return "Refused text that states a dollar amount";
  if (/\b(force[- ]?push|--force|--no-verify)\b/i.test(instruction)) return "Refused force-push or hook skip";
  return null;
}

function buildDefaultEdits(instruction: string): EngineeringEdit[] {
  const note = [
    "# AURA engineering workflow note",
    "",
    "This file was written by the HQ engineering workflow in an isolated worktree of IFCDC9/IFCDC.",
    "",
    "Requested by the authenticated HQ session.",
    "Operator: AURA (kind ai_operator, role aura, isFounder false). AURA is not the Founder account.",
    "",
    "Instruction:",
    instruction.trim(),
    "",
    "No production deploy, grant submission, payment, mail, SMS, or voice change is part of this note.",
    "",
  ].join("\n");
  const test = [
    "import assert from \"node:assert/strict\";",
    "import { readFileSync } from \"node:fs\";",
    "import path from \"node:path\";",
    "import test from \"node:test\";",
    "import { fileURLToPath } from \"node:url\";",
    "",
    "const notePath = path.join(path.dirname(fileURLToPath(import.meta.url)), \"../Documents/products/AURA-ENGINEERING-WORKFLOW-NOTE.md\");",
    "",
    "test(\"workflow note is a demonstration and not a funding record\", () => {",
    "  const text = readFileSync(notePath, \"utf8\");",
    "  assert.match(text, /isolated worktree of IFCDC9\\/IFCDC/);",
    "  assert.match(text, /AURA is not the Founder account/);",
    "  assert.match(text, /Requested by the authenticated HQ session/);",
    "  assert.doesNotMatch(text, /\\$\\s?\\d/);",
    "});",
    "",
  ].join("\n");
  return [
    { path: NOTE_PATH, content: note },
    { path: NOTE_TEST_PATH, content: test },
  ];
}

async function removeWorkspace(repoRoot: string, workspace: string): Promise<void> {
  await runArgv(["git", "worktree", "remove", "--force", workspace], repoRoot);
  fs.rmSync(workspace, { recursive: true, force: true });
}

export async function runEngineeringTask(input: EngineeringTaskInput): Promise<EngineeringTaskResult> {
  const requester = input.requester;
  const instruction = input.instruction.trim();
  if (!engineeringApprovalAllowed(requester)) {
    const result = emptyResult(requester, "missing_access", "Founder authorization is required. exec@ifcdc.org cannot approve engineering or production changes.");
    await recordTaskAudit({ status: "missing_access", requester, message: result.message });
    return result;
  }
  if (!instruction) {
    const result = emptyResult(requester, "failure", "Instruction is required.");
    await recordTaskAudit({ status: "failure", requester, message: result.message });
    return result;
  }
  if (instruction.length > 2_000) {
    const result = emptyResult(requester, "failure", "Instruction is too long.");
    await recordTaskAudit({ status: "failure", requester, message: result.message });
    return result;
  }
  const blocked = instructionBlocked(instruction);
  if (blocked) {
    const result = emptyResult(requester, "failure", `Blocked: ${blocked}. AURA will not deploy, force-push, or skip hooks.`);
    await recordTaskAudit({ status: "failure", requester, message: result.message, metadata: { blocked } });
    return result;
  }
  if (isSeProductionControlPlane()) {
    const result = emptyResult(
      requester,
      "failure",
      "Production control plane does not create branches or open pull requests. Run Headquarters on the Founder workstation.",
    );
    await recordTaskAudit({ status: "failure", requester, message: result.message });
    return result;
  }

  const edits = input.edits?.length ? input.edits : buildDefaultEdits(instruction);
  if (edits.length > 5) {
    const result = emptyResult(requester, "failure", "Too many files for one task.");
    await recordTaskAudit({ status: "failure", requester, message: result.message });
    return result;
  }
  for (const edit of edits) {
    if (containedWorkspacePath(path.resolve("/approved"), edit.path) == null) {
      const result = emptyResult(requester, "failure", "Isolated workspace path cannot escape the approved repository.");
      await recordTaskAudit({ status: "failure", requester, message: result.message, metadata: { path: edit.path } });
      return result;
    }
    const denied = editAllowed(edit.path);
    if (denied) {
      const result = emptyResult(requester, "failure", denied);
      await recordTaskAudit({ status: "failure", requester, message: result.message, metadata: { path: edit.path } });
      return result;
    }
    if (edit.content.length > 100_000 || /\$\s?\d/.test(edit.content)) {
      const result = emptyResult(requester, "failure", "Edit content is outside the allowed note size or states a dollar amount.");
      await recordTaskAudit({ status: "failure", requester, message: result.message });
      return result;
    }
  }

  const testCommand = input.testCommand?.trim() || `node --test ${NOTE_TEST_PATH}`;
  const classified = classifyTerminalCommand(testCommand);
  if (!classified.allowed) {
    const result = emptyResult(requester, "failure", classified.reason);
    await recordTaskAudit({ status: "failure", requester, message: result.message, metadata: { testCommand } });
    return result;
  }

  const approvedRepoRoot = resolveApprovedRepoRoot();
  if (!(await approvedOrigin(approvedRepoRoot))) {
    const result = emptyResult(requester, "failure", "The origin fetch and push destinations must both be IFCDC9/IFCDC on GitHub.");
    await recordTaskAudit({ status: "failure", requester, message: result.message });
    return result;
  }
  const worktreeParent = resolveWorktreeParent(approvedRepoRoot);
  const branch = safeBranchName(instruction);
  const refspec = branch ? pushRefspec(branch) : null;
  if (!branch || !refspec) {
    const result = emptyResult(requester, "failure", "Could not name a safe task branch.");
    await recordTaskAudit({ status: "failure", requester, message: result.message });
    return result;
  }

  const baseRef = input.baseRef ?? (input.openPullRequest ? "origin/main" : "HEAD");
  if (baseRef !== "HEAD" && baseRef !== "origin/main") {
    const result = emptyResult(requester, "failure", "Base ref is outside the approved repository.");
    await recordTaskAudit({ status: "failure", requester, message: result.message });
    return result;
  }

  fs.mkdirSync(worktreeParent, { recursive: true });
  const workspace = path.join(worktreeParent, `se-${crypto.randomBytes(4).toString("hex")}`);
  if (!workspaceStaysWithApprovedRepo({ approvedRepoRoot, worktreeParent, workspace })) {
    const result = emptyResult(requester, "failure", "Isolated workspace path cannot escape the approved repository.");
    await recordTaskAudit({ status: "failure", requester, message: result.message });
    return result;
  }

  let created = false;
  let published = false;
  try {
    if (baseRef === "origin/main") {
      const fetch = await runArgv(["git", "fetch", "origin", "main"], approvedRepoRoot);
      if (fetch.code !== 0) {
        const result = emptyResult(requester, "failure", `Could not read origin/main. ${redactOutput(fetch.stderr || fetch.stdout)}`);
        await recordTaskAudit({ status: "failure", requester, message: result.message });
        return result;
      }
    }
    const add = await runArgv(["git", "worktree", "add", "-b", branch, workspace, baseRef], approvedRepoRoot);
    if (add.code !== 0) {
      const result = emptyResult(requester, "failure", `Could not create an isolated worktree. ${redactOutput(add.stderr || add.stdout)}`);
      await recordTaskAudit({ status: "failure", requester, message: result.message });
      return result;
    }
    created = true;
    if (!(await worktreeBelongsToApprovedRepo(workspace, approvedRepoRoot))) {
      const result = emptyResult(requester, "failure", "Isolated workspace is not the approved IFCDC9/IFCDC repository.");
      result.workspace = workspace;
      await recordTaskAudit({ status: "failure", requester, message: result.message });
      return result;
    }

    const written: string[] = [];
    for (const edit of edits) {
      const target = containedWorkspacePath(workspace, edit.path);
      if (!target) {
        const result = emptyResult(requester, "failure", "Isolated workspace path cannot escape the approved repository.");
        result.workspace = workspace;
        await recordTaskAudit({ status: "failure", requester, message: result.message });
        return result;
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, edit.content.endsWith("\n") ? edit.content : `${edit.content}\n`, "utf8");
      written.push(edit.path);
    }

    const testArgv = testCommand.split(/\s+/);
    const testPath = containedWorkspacePath(workspace, testArgv[2] || "");
    if (!testPath) {
      const result = emptyResult(requester, "failure", "Test path cannot escape the isolated workspace.");
      result.workspace = workspace;
      result.files = written;
      await recordTaskAudit({ status: "failure", requester, message: result.message });
      return result;
    }
    const testRun = await runArgv(testArgv, workspace);
    const tests: EngineeringTestRecord = {
      command: testCommand,
      exitCode: testRun.code,
      passed: testRun.code === 0,
      stdout: redactOutput(testRun.stdout).slice(0, 4_000),
      stderr: redactOutput(testRun.stderr).slice(0, 4_000),
    };
    await recordTestRun({ requester, tests, workspace });
    if (!tests.passed) {
      const result = emptyResult(requester, "failure", "Tests failed. No pull request was opened.");
      result.files = written;
      result.tests = tests;
      result.branch = branch;
      result.workspace = workspace;
      await recordTaskAudit({ status: "failure", requester, message: result.message, metadata: { branch, exitCode: tests.exitCode } });
      return result;
    }

    const commit = await commitWrittenFiles({ workspace, branch, requester, files: written, instruction });
    if (!commit.ok) {
      const result = emptyResult(requester, "failure", commit.message);
      result.files = written;
      result.tests = tests;
      result.branch = branch;
      result.workspace = workspace;
      await recordTaskAudit({ status: "failure", requester, message: result.message });
      return result;
    }

    let prUrl: string | null = null;
    if (input.openPullRequest) {
      if (!(await approvedOrigin(workspace))) {
        const result = emptyResult(requester, "failure", "Repository destination changed; the task was not pushed.");
        result.workspace = workspace;
        result.branch = branch;
        result.commitSha = commit.sha;
        await recordTaskAudit({ status: "failure", requester, message: result.message });
        return result;
      }
      const pushed = await runArgv(["git", "push", "origin", refspec], workspace);
      if (pushed.code !== 0) {
        const result = emptyResult(requester, "failure", `Push failed. ${redactOutput(pushed.stderr || pushed.stdout)}`);
        result.files = written;
        result.tests = tests;
        result.branch = branch;
        result.commitSha = commit.sha;
        result.workspace = workspace;
        await recordTaskAudit({ status: "failure", requester, message: result.message, metadata: { branch } });
        return result;
      }
      const opened = await openPullRequest({ workspace, branch, instruction, requester });
      if (!opened.ok || !opened.url) {
        const result = emptyResult(requester, "failure", opened.message);
        result.files = written;
        result.tests = tests;
        result.branch = branch;
        result.commitSha = commit.sha;
        result.workspace = workspace;
        await recordTaskAudit({ status: "failure", requester, message: result.message, metadata: { branch, commitSha: commit.sha } });
        return result;
      }
      prUrl = opened.url;
      published = true;
    }

    const result = emptyResult(
      requester,
      "success",
      prUrl
        ? `Test passed. Pull request opened: ${prUrl}`
        : "Test passed. The isolated workspace contains the task change.",
    );
    result.files = written;
    result.tests = tests;
    result.branch = branch;
    result.commitSha = commit.sha;
    result.prUrl = prUrl;
    result.workspace = workspace;
    await recordTaskAudit({
      status: "success",
      requester,
      message: result.message,
      metadata: { branch, commitSha: commit.sha, prUrl, files: written },
    });
    return result;
  } finally {
    // Keep failed and local-only work for diagnosis; only published work is disposable.
    if (created && published && process.env.AURA_SE_RETAIN_WORKSPACE !== "1") {
      try {
        await removeWorkspace(approvedRepoRoot, workspace);
      } catch {
        /* The task result is already recorded. */
      }
    }
  }
}

async function recordTestRun(opts: {
  requester: EngineeringRequester;
  tests: EngineeringTestRecord;
  workspace: string;
}): Promise<void> {
  try {
    await ensureAuraSoftwareEngineeringTables();
    const db = await getDb();
    await db.run(
      `INSERT INTO aura_se_test_runs (id, change_package_id, workspace_root, commands_json, results_json, overall_status, actor_email, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      crypto.randomUUID(),
      null,
      path.basename(opts.workspace),
      JSON.stringify([opts.tests.command]),
      JSON.stringify([{ ...opts.tests, stdout: opts.tests.stdout.slice(0, 500), stderr: opts.tests.stderr.slice(0, 500) }]),
      opts.tests.passed ? "passed" : "failed",
      opts.requester.email,
      new Date().toISOString(),
    );
  } catch {
    /* The task result still carries the test record. */
  }
}

async function commitWrittenFiles(opts: {
  workspace: string;
  branch: string;
  requester: EngineeringRequester;
  files: string[];
  instruction: string;
}): Promise<{ ok: true; sha: string } | { ok: false; message: string; sha?: undefined }> {
  if (!/^[^@\s]+@[^@\s]+$/.test(opts.requester.email)) {
    return { ok: false, message: "Requester email cannot be used as the commit attribution." };
  }
  for (const file of opts.files) {
    const added = await runArgv(["git", "add", "--", file], opts.workspace);
    if (added.code !== 0) {
      return { ok: false, message: `Could not stage ${file}. ${redactOutput(added.stderr)}` };
    }
  }
  const message = [
    "docs(hq): record an AURA engineering task requested from Headquarters",
    "",
    `Requested-By: ${opts.requester.email}`,
    "Operated-By: aura (ai_operator)",
    "",
    opts.instruction.slice(0, 200),
  ].join("\n");
  const commit = await runArgv(
    ["git", "-c", `user.email=${opts.requester.email}`, "-c", `user.name=${opts.requester.email}`, "commit", "-m", message],
    opts.workspace,
  );
  if (commit.code !== 0) {
    return { ok: false, message: `Commit failed. ${redactOutput(commit.stderr || commit.stdout)}` };
  }
  const sha = await runArgv(["git", "rev-parse", "HEAD"], opts.workspace);
  if (sha.code !== 0 || !/^[0-9a-f]{40}$/.test(sha.stdout)) {
    return { ok: false, message: "Commit succeeded but the revision could not be read." };
  }
  return { ok: true, sha: sha.stdout };
}

async function openPullRequest(opts: {
  workspace: string;
  branch: string;
  instruction: string;
  requester: EngineeringRequester;
}): Promise<{ ok: boolean; url?: string; message: string }> {
  const body = [
    "## Request",
    `Requested by: ${opts.requester.email} (${opts.requester.role}, id ${opts.requester.id})`,
    "Operator: AURA (kind ai_operator, role aura, isFounder false). AURA is not the Founder account.",
    "",
    "## Change",
    opts.instruction,
    "",
    "Tests were run in the isolated worktree before this pull request was opened.",
    "This pull request does not merge, deploy, send mail, submit a grant, or spend.",
    "",
  ].join("\n");
  const bodyFile = path.join(os.tmpdir(), `aura-se-pr-${crypto.randomBytes(4).toString("hex")}.md`);
  fs.writeFileSync(bodyFile, body, "utf8");
  try {
    const opened = await runArgv([
      "gh",
      "pr",
      "create",
      "--repo",
      `${APPROVED_ENGINEERING_REPO.owner}/${APPROVED_ENGINEERING_REPO.name}`,
      "--base",
      "main",
      "--head",
      opts.branch,
      "--title",
      "Record an AURA Headquarters engineering task",
      "--body-file",
      bodyFile,
    ], opts.workspace);
    const combined = `${opened.stdout}\n${opened.stderr}`;
    const url = combined.match(/https:\/\/github\.com\/IFCDC9\/IFCDC\/pull\/\d+/)?.[0];
    if (opened.code !== 0 || !url) {
      return { ok: false, message: `Pull request was not opened. ${redactOutput(opened.stderr || opened.stdout)}` };
    }
    return { ok: true, url, message: url };
  } finally {
    fs.rmSync(bodyFile, { force: true });
  }
}
