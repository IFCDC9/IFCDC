/**
 * AURA engineering workflow — Founder gate, attribution, workspace containment, scoped terminal.
 * Uses a temporary git repository and a temporary SQLite directory. Does not open a GitHub pull request.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, existsSync, rmSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const exec = promisify(execFile);
const dataDir = mkdtempSync(path.join(tmpdir(), "ifcdc-aura-se-data-"));
const repoRoot = mkdtempSync(path.join(tmpdir(), "ifcdc-aura-se-repo-"));
const worktreeParent = mkdtempSync(path.join(tmpdir(), "ifcdc-aura-se-worktrees-"));

process.env.NODE_ENV = "test";
process.env.IFCDC_DATA_DIR = dataDir;
process.env.DATABASE_URL = "";
process.env.MASTER_OWNER_EMAIL = "service@ifcdc.org";
process.env.AURA_SE_APPROVED_REPO_ROOT = repoRoot;
process.env.AURA_SE_WORKTREE_PARENT = worktreeParent;
process.env.AURA_SE_RETAIN_WORKSPACE = "1";
delete process.env.RENDER;
delete process.env.RENDER_SERVICE_ID;
delete process.env.AURA_SE_HOST_MODE;

async function git(args: string[], cwd: string) {
  await exec("git", ["-c", "user.email=test@example.com", "-c", "user.name=test", ...args], { cwd });
}

await git(["init"], repoRoot);
await git(["commit", "--allow-empty", "-m", "init"], repoRoot);
await git(["remote", "add", "origin", "https://github.com/IFCDC9/IFCDC.git"], repoRoot);

const { AURA_OPERATOR } = await import("../server/hq/auraActorIdentity.ts");
const { queryHqAudit } = await import("../server/hq/hqAuditLog.ts");
const {
  classifyTerminalCommand,
  containedWorkspacePath,
  engineeringApprovalAllowed,
  engineeringTestEnvironment,
  isApprovedEngineeringRemote,
  runEngineeringTask,
  worktreeBelongsToApprovedRepo,
  workspaceStaysWithApprovedRepo,
} = await import("../server/hq/auraEngineeringWorkflow.ts");
const { default: softwareEngineeringRouter } = await import("../server/routes/softwareEngineering.routes.ts");
const { JWT_SECRET } = await import("../server/config/auth.ts");
const jwt = (await import("jsonwebtoken")).default;
const express = (await import("express")).default;

const operatorBefore = JSON.parse(JSON.stringify(AURA_OPERATOR));
const founder = { id: "founder-test", email: "service@ifcdc.org", role: "owner" };
const INSTRUCTION = "Record that AURA completed an isolated Headquarters engineering task for the Founder. This note is not a funding record.";

function tokenFor(user: { id: string; email: string; role: string }) {
  return jwt.sign(user, JWT_SECRET, { expiresIn: "5m" });
}

function findNotes(): string[] {
  if (!existsSync(worktreeParent)) return [];
  const notes: string[] = [];
  for (const dir of readdirSync(worktreeParent)) {
    const note = path.join(worktreeParent, dir, "Documents/products/AURA-ENGINEERING-WORKFLOW-NOTE.md");
    if (existsSync(note)) notes.push(note);
  }
  return notes;
}

let server: Server;
let baseUrl = "";

test.describe("AURA engineering workflow", { concurrency: 1 }, () => {
  test.before(async () => {
    const app = express();
    app.use(express.json());
    app.use("/api/hq/aura/software-engineering", softwareEngineeringRouter);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  test.after(async () => {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    await exec("git", ["worktree", "prune"], { cwd: repoRoot }).catch(() => undefined);
    rmSync(worktreeParent, { recursive: true, force: true });
    rmSync(repoRoot, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("Founder is allowed and exec@ifcdc.org is denied for engineering approval", () => {
    assert.equal(engineeringApprovalAllowed(founder), true);
    assert.equal(engineeringApprovalAllowed({
      id: "exec-1",
      email: "exec@ifcdc.org",
      role: "founder",
      isFounder: true,
      founderMode: true,
    }), false);
    assert.equal(engineeringApprovalAllowed({
      id: "exec-2",
      email: "exec@ifcdc.org",
      role: "EXEC",
      isFounder: true,
    }), false);
    assert.equal(engineeringApprovalAllowed({
      id: "exec-3",
      email: "someone@example.com",
      role: "executive",
      isFounder: true,
    }), false);
    assert.equal(engineeringApprovalAllowed({
      id: "staff-1",
      email: "staff.local@example.test",
      role: "employee",
    }), false);
    assert.equal(engineeringApprovalAllowed({
      id: "aura",
      email: "service@ifcdc.org",
      role: "owner",
      isFounder: true,
    }), false);
  });

  test("terminal scope rejects deploy and force-push", () => {
    assert.equal(classifyTerminalCommand("git push --force origin main").allowed, false);
    assert.equal(classifyTerminalCommand("git push -f origin HEAD:main").allowed, false);
    assert.equal(classifyTerminalCommand("git commit --no-verify -m x").allowed, false);
    assert.equal(classifyTerminalCommand("npm run deploy").allowed, false);
    assert.equal(classifyTerminalCommand("render deploy production").allowed, false);
    assert.equal(classifyTerminalCommand("printenv").allowed, false);
    assert.equal(classifyTerminalCommand("node --test script/hq-aura-engineering-workflow-note.test.mjs").allowed, true);
  });

  test("only the approved GitHub origin is accepted", async () => {
    assert.equal(isApprovedEngineeringRemote("git@github.com:IFCDC9/IFCDC.git"), true);
    assert.equal(isApprovedEngineeringRemote("https://github.com/IFCDC9/IFCDC.git"), true);
    assert.equal(isApprovedEngineeringRemote("https://github.com/IFCDC9/OTHER.git"), false);
    assert.equal(isApprovedEngineeringRemote("https://github.com.evil.test/IFCDC9/IFCDC.git"), false);
    await git(["remote", "set-url", "--push", "origin", "https://github.com/IFCDC9/OTHER.git"], repoRoot);
    try {
      const before = readdirSync(worktreeParent).length;
      const result = await runEngineeringTask({ requester: founder, instruction: INSTRUCTION });
      assert.equal(result.status, "failure");
      assert.match(result.message, /destinations/);
      assert.equal(readdirSync(worktreeParent).length, before);
    } finally {
      await git(["config", "--unset-all", "remote.origin.pushurl"], repoRoot);
    }
  });

  test("test subprocesses do not inherit HQ credentials or Node injection settings", async () => {
    process.env.AURA_TEST_SECRET = "must-not-reach-child";
    try {
      const environment = engineeringTestEnvironment(repoRoot);
      assert.equal(environment.AURA_TEST_SECRET, undefined);
      assert.equal(environment.NODE_OPTIONS, undefined);
      assert.equal(environment.NODE_TEST_CONTEXT, undefined);
      const result = await runEngineeringTask({
        requester: founder,
        instruction: "Verify the test process environment.",
        edits: [{
          path: "script/environment.test.mjs",
          content: 'import assert from "node:assert/strict"; import test from "node:test"; test("no host secret", () => { assert.equal(process.env.AURA_TEST_SECRET, undefined); assert.equal(process.env.NODE_ENV, "test"); });',
        }],
        testCommand: "node --test script/environment.test.mjs",
      });
      assert.equal(result.status, "success", result.message);
    } finally {
      delete process.env.AURA_TEST_SECRET;
    }
  });

  test("linked files and directories cannot redirect edits outside the worktree", async () => {
    const outside = mkdtempSync(path.join(tmpdir(), "aura-outside-"));
    mkdirSync(path.join(repoRoot, "script"), { recursive: true });
    symlinkSync(outside, path.join(repoRoot, "script", "linked"), "dir");
    await git(["add", "script/linked"], repoRoot);
    await git(["commit", "-m", "linked path fixture"], repoRoot);
    try {
      const result = await runEngineeringTask({
        requester: founder,
        instruction: "Check a linked destination.",
        edits: [{ path: "script/linked/escape.test.mjs", content: "throw new Error('must not execute');" }],
        testCommand: "node --test script/linked/escape.test.mjs",
      });
      assert.equal(result.status, "failure");
      assert.equal(existsSync(path.join(outside, "escape.test.mjs")), false);
    } finally {
      await git(["rm", "script/linked"], repoRoot);
      await git(["commit", "-m", "remove linked fixture"], repoRoot);
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("isolated workspace path cannot escape the approved repo", async () => {
    assert.equal(containedWorkspacePath(repoRoot, "../../etc/passwd"), null);
    assert.equal(containedWorkspacePath(repoRoot, "/etc/passwd"), null);
    assert.equal(workspaceStaysWithApprovedRepo({
      approvedRepoRoot: repoRoot,
      worktreeParent,
      workspace: path.join(worktreeParent, "..", "outside"),
    }), false);
    const other = mkdtempSync(path.join(tmpdir(), "ifcdc-aura-se-other-"));
    try {
      await git(["init"], other);
      await git(["commit", "--allow-empty", "-m", "other"], other);
      assert.equal(await worktreeBelongsToApprovedRepo(other, repoRoot), false);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
    const escaped = await runEngineeringTask({
      requester: founder,
      instruction: INSTRUCTION,
      edits: [{ path: "../../outside.txt", content: "nope\n" }],
      testCommand: "node --test script/hq-aura-engineering-workflow-note.test.mjs",
    });
    assert.equal(escaped.status, "failure");
    assert.equal(existsSync(path.join(worktreeParent, "..", "outside.txt")), false);
    assert.equal(existsSync(path.join(repoRoot, "outside.txt")), false);
  });

  test("non-founder is denied through the HQ route and stays the requester", async () => {
    const response = await fetch(`${baseUrl}/api/hq/aura/software-engineering/tasks`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenFor({ id: "staff-1", email: "staff.local@example.test", role: "employee" })}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ instruction: INSTRUCTION, openPullRequest: false }),
    });
    const body = await response.json() as { status: string; requester: { email: string }; operator: { id: string; isFounder: boolean } };
    assert.equal(response.status, 403);
    assert.equal(body.status, "missing_access");
    assert.equal(body.requester.email, "staff.local@example.test");
    assert.notEqual(body.requester.email, "service@ifcdc.org");
    assert.equal(body.operator.id, "aura");
    assert.equal(body.operator.isFounder, false);
    const rows = await queryHqAudit({ action: "aura_engineering_task_missing_access", limit: 10 }) as Array<{
      actor_id: string | null;
      metadata_json: string | null;
    }>;
    const row = rows.find((item) => item.metadata_json?.includes("staff.local@example.test"));
    assert.ok(row);
    assert.equal(row?.actor_id, "aura");
    const metadata = JSON.parse(row?.metadata_json || "{}") as { requesterEmail?: string; kind?: string; isFounder?: boolean };
    assert.equal(metadata.requesterEmail, "staff.local@example.test");
    assert.equal(metadata.kind, "ai_operator");
    assert.equal(metadata.isFounder, false);
  });

  test("exec@ifcdc.org is denied by the HQ route even with role founder", async () => {
    const response = await fetch(`${baseUrl}/api/hq/aura/software-engineering/tasks`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenFor({ id: "exec-1", email: "exec@ifcdc.org", role: "founder" })}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ instruction: "deploy production", openPullRequest: true }),
    });
    const body = await response.json() as { status: string; requester: { email: string }; productionExecuted: boolean };
    assert.equal(response.status, 403);
    assert.equal(body.status, "missing_access");
    assert.equal(body.requester.email, "exec@ifcdc.org");
    assert.equal(body.productionExecuted, false);
  });

  test("missing token is 401", async () => {
    const response = await fetch(`${baseUrl}/api/hq/aura/software-engineering/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instruction: INSTRUCTION }),
    });
    const body = await response.json() as { error?: string };
    assert.equal(response.status, 401);
    assert.equal(body.error, "Authentication required");
  });

  test("a failing test is recorded and does not open a pull request", async () => {
    delete process.env.AURA_SE_RETAIN_WORKSPACE;
    const result = await runEngineeringTask({
      requester: founder,
      instruction: "Record a failing engineering check.",
      edits: [{
        path: "script/hq-aura-engineering-workflow-fail.test.mjs",
        content: "import assert from \"node:assert/strict\";\nimport test from \"node:test\";\ntest(\"expected failure\", () => { assert.equal(1, 2); });\n",
      }],
      testCommand: "node --test script/hq-aura-engineering-workflow-fail.test.mjs",
      openPullRequest: false,
    });
    assert.equal(result.status, "failure");
    assert.equal(result.prUrl, null);
    assert.equal(result.tests?.passed, false);
    assert.ok(result.workspace && existsSync(result.workspace), "failed work is retained by default");
    process.env.AURA_SE_RETAIN_WORKSPACE = "1";
    assert.equal(result.productionExecuted, false);
    assert.equal(result.requester.email, "service@ifcdc.org");
    assert.equal(result.operator.id, "aura");
    assert.equal(result.operator.role, "aura");
    assert.equal(result.operator.isFounder, false);
    const rows = await queryHqAudit({ action: "aura_engineering_task_failure", limit: 10 }) as Array<{ actor_id: string | null }>;
    assert.equal(rows.some((row) => row.actor_id === "aura"), true);
  });

  test("the HQ route handler produces the demonstration change for the Founder", async () => {
    const before = findNotes().length;
    const response = await fetch(`${baseUrl}/api/hq/aura/software-engineering/tasks`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenFor(founder)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ instruction: INSTRUCTION, openPullRequest: false }),
    });
    const body = await response.json() as {
      status: string;
      message: string;
      requester: { email: string; role: string };
      operator: { id: string; kind: string; role: string; isFounder: boolean; email: null };
      files: string[];
      prUrl: string | null;
      tests: { passed: boolean; exitCode: number | null };
      productionExecuted: boolean;
      branch: string;
    };
    assert.equal(response.status, 201, body.message);
    assert.equal(body.status, "success");
    assert.equal(body.requester.email, founder.email);
    assert.equal(body.requester.role, "owner");
    assert.equal(body.operator.id, "aura");
    assert.equal(body.operator.kind, "ai_operator");
    assert.equal(body.operator.role, "aura");
    assert.equal(body.operator.isFounder, false);
    assert.equal(body.operator.email, null);
    assert.equal(body.prUrl, null);
    assert.equal(body.productionExecuted, false);
    assert.equal(body.tests.passed, true);
    assert.equal(body.tests.exitCode, 0);
    assert.equal(body.files.includes("Documents/products/AURA-ENGINEERING-WORKFLOW-NOTE.md"), true);
    const notes = findNotes();
    assert.equal(notes.length, before + 1);
    const text = readFileSync(notes[notes.length - 1], "utf8");
    assert.match(text, /isolated worktree of IFCDC9\/IFCDC/);
    assert.match(text, new RegExp(INSTRUCTION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(text, /AURA is not the Founder account/);
    const workspace = path.dirname(path.dirname(path.dirname(notes[notes.length - 1])));
    assert.equal(await worktreeBelongsToApprovedRepo(workspace, repoRoot), true);
    const rows = await queryHqAudit({ action: "aura_engineering_task_success", limit: 5 }) as Array<{
      actor_id: string | null;
      metadata_json: string | null;
    }>;
    assert.equal(rows[0]?.actor_id, "aura");
    const metadata = JSON.parse(rows[0]?.metadata_json || "{}") as { requesterEmail?: string };
    assert.equal(metadata.requesterEmail, "service@ifcdc.org");
    assert.deepEqual(AURA_OPERATOR, operatorBefore);
  });

  test("deploy and force-push requests do not execute", async () => {
    const deploy = await runEngineeringTask({
      requester: founder,
      instruction: "deploy production now",
      openPullRequest: true,
    });
    assert.equal(deploy.status, "failure");
    assert.equal(deploy.productionExecuted, false);
    assert.equal(deploy.prUrl, null);
    const forced = await runEngineeringTask({
      requester: founder,
      instruction: INSTRUCTION,
      testCommand: "git push --force origin main",
      openPullRequest: true,
    });
    assert.equal(forced.status, "failure");
    assert.equal(forced.prUrl, null);
    assert.match(forced.message, /force-push|scoped terminal|Direct git push/i);
  });
});
