import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import type { AddressInfo } from "node:net";

const exec = promisify(execFile);
const data = mkdtempSync(path.join(tmpdir(), "aura-bridge-data-"));
const repo = mkdtempSync(path.join(tmpdir(), "aura-bridge-repo-"));
process.env.NODE_ENV = "test";
process.env.IFCDC_DATA_DIR = data;
process.env.DATABASE_URL = "";
process.env.MASTER_OWNER_EMAIL = "service@ifcdc.org";
const express = (await import("express")).default;
const jwt = (await import("jsonwebtoken")).default;
const { JWT_SECRET } = await import("../server/config/auth.ts");
const { default: router } = await import("../server/routes/auraRunner.routes.ts");
const bridge = await import("../server/hq/auraRunnerBridge.ts");
const { getDb } = await import("../server/db.ts");
// This worker is deliberately plain Node: the Mac needs no paid agent or tsx.
// @ts-ignore plain JS CLI exports
const { runRunnerOnce, inspectRepository, validateRunnerConfig } = await import("./aura-mac-runner.mjs");
await exec("git", ["init", repo]);
const git = (...args: string[]) => exec("git", ["-C", repo, "-c", "user.name=Test", "-c", "user.email=test@example.test", ...args]);
await git("commit", "--allow-empty", "-m", "init");
await git("remote", "add", "origin", "https://github.com/IFCDC9/IFCDC.git");
const app = express();
app.use(express.json({ limit: "16kb" }));
app.use("/api/hq/aura/software-engineering", router);
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const hqUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const founder = jwt.sign({ id: "founder", email: "service@ifcdc.org", role: "owner" }, JWT_SECRET);
const staff = jwt.sign({ id: "staff", email: "staff@example.test", role: "employee" }, JWT_SECRET);
const request = async (endpoint: string, token?: string, body?: unknown) => fetch(`${hqUrl}/api/hq/aura/software-engineering${endpoint}`, {
  method: body === undefined ? "GET" : "POST",
  headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body),
});
test.after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(repo, { recursive: true, force: true }); rmSync(data, { recursive: true, force: true });
});

test("Founder enrollment, queue, plain Node worker and result complete a real HTTP round trip", async () => {
  assert.equal((await request("/runners")).status, 401);
  assert.equal((await request("/runners", staff, { label: "Staff Mac" })).status, 403);
  const enrolled = await request("/runners", founder, { label: "Founder Mac" });
  assert.equal(enrolled.status, 201);
  assert.equal(enrolled.headers.get("cache-control"), "no-store");
  const device = await enrolled.json();
  const db = await getDb();
  const stored = await db.get("SELECT token_hash FROM aura_runner_devices WHERE id = ?", device.id);
  assert.ok(stored.token_hash && !stored.token_hash.includes(device.token));
  const queued = await request("/runner-jobs", founder, { runnerId: device.id, kind: "inspect_repository" });
  assert.equal(queued.status, 201);
  const result = await runRunnerOnce({ hqUrl, repoRoot: repo, runnerToken: device.token });
  assert.equal(result.status, "succeeded");
  const listed = await request("/runners", founder);
  const body = await listed.json();
  assert.equal(body.jobs[0].status, "succeeded");
  assert.equal(body.jobs[0].result.repository, "IFCDC9/IFCDC");
  assert.equal(body.jobs[0].result.commit, (await git("rev-parse", "HEAD")).stdout.trim());
  assert.equal(body.jobs[0].result.productionExecuted, false);
  assert.equal(JSON.stringify(body).includes(device.token), false);
  assert.equal(JSON.stringify(body).includes(stored.token_hash), false);
  assert.equal((await runRunnerOnce({ hqUrl, repoRoot: repo, runnerToken: device.token })).status, "idle");
});

test("runner credentials cannot use Founder routes and Founder sessions cannot claim worker jobs", async () => {
  const runner = await bridge.enrollRunner("Restricted Mac", "founder");
  assert.equal((await request("/runners", runner.token)).status, 401);
  assert.equal((await request("/runner/claim", founder, {})).status, 401);
  assert.equal((await request("/runner/claim", "invalid", {})).status, 401);
  assert.equal((await request("/runner-jobs", founder, { runnerId: runner.id, kind: "run_shell", command: "anything" })).status, 400);
  const execToken = jwt.sign({ id: "exec", email: "exec@ifcdc.org", role: "founder" }, JWT_SECRET);
  assert.equal((await request("/runners", execToken, { label: "Exec Mac" })).status, 403);
});

test("concurrent polls claim once; leases bind completions and reject replay or the wrong runner", async () => {
  const first = await bridge.enrollRunner("First Mac", "founder");
  const other = await bridge.enrollRunner("Other Mac", "founder");
  await bridge.queueRunnerInspection(first.id, "inspect_repository", "founder");
  await assert.rejects(bridge.queueRunnerInspection(first.id, "inspect_repository", "founder"), /pending/);
  const claims = await Promise.all([bridge.claimRunnerJob(first.id), bridge.claimRunnerJob(first.id)]);
  assert.equal(claims.filter(Boolean).length, 1);
  const job = claims.find(Boolean)!;
  const result = { status: "succeeded", commit: "a".repeat(40), branch: "main", changedFiles: 0, untrackedFiles: 0, secret: "discard-me" };
  await assert.rejects(bridge.completeRunnerJob(other.id, job.id, job.lease, result), /not assigned/);
  await assert.rejects(bridge.completeRunnerJob(first.id, job.id, "x".repeat(43), result), /not assigned/);
  const completed = await bridge.completeRunnerJob(first.id, job.id, job.lease, result);
  assert.equal(JSON.stringify(completed).includes("discard-me"), false);
  await assert.rejects(bridge.completeRunnerJob(first.id, job.id, job.lease, result), /completed/);
});

test("expired jobs are not retried and revoked runners cannot claim or finish", async () => {
  const runner = await bridge.enrollRunner("Expiring Mac", "founder");
  await bridge.queueRunnerInspection(runner.id, "inspect_repository", "founder");
  const job = (await bridge.claimRunnerJob(runner.id))!;
  const db = await getDb();
  await db.run("UPDATE aura_runner_jobs SET lease_until = ? WHERE id = ?", Date.now() - 1, job.id);
  assert.equal(await bridge.claimRunnerJob(runner.id), null);
  assert.equal((await db.get("SELECT status FROM aura_runner_jobs WHERE id = ?", job.id)).status, "expired");
  await assert.rejects(bridge.completeRunnerJob(runner.id, job.id, job.lease, { status: "failed", error: "inspection_failed" }), /expired/);
  await bridge.queueRunnerInspection(runner.id, "inspect_repository", "founder");
  const next = (await bridge.claimRunnerJob(runner.id))!;
  await bridge.revokeRunner(runner.id, "founder");
  assert.equal((await request("/runner/claim", runner.token, {})).status, 401);
  await assert.rejects(bridge.completeRunnerJob(runner.id, next.id, next.lease, { status: "failed", error: "inspection_failed" }), /not assigned/);
});

test("worker refuses another repository or a child folder, and accepts HTTPS origins only", async () => {
  const child = path.join(repo, "nested"); mkdirSync(child);
  assert.equal((await inspectRepository(child)).error, "wrong_repository");
  await git("remote", "set-url", "origin", "https://github.com/IFCDC9/OTHER.git");
  assert.equal((await inspectRepository(repo)).error, "wrong_repository");
  await git("remote", "set-url", "origin", "https://github.com/IFCDC9/IFCDC.git");
  writeFileSync(path.join(repo, "local.txt"), "no file contents leave the Mac");
  const result = await inspectRepository(repo);
  assert.equal(result.untrackedFiles, 1);
  assert.equal(JSON.stringify(result).includes("local.txt"), false);
  const runner = await bridge.enrollRunner("Config Mac", "founder");
  assert.throws(() => validateRunnerConfig({ hqUrl: "http://example.com", repoRoot: repo, runnerToken: runner.token }));
  assert.throws(() => validateRunnerConfig({ hqUrl: "https://example.com/path", repoRoot: repo, runnerToken: runner.token }));
});
