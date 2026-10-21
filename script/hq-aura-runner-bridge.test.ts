import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, chmodSync } from "node:fs";
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
const { reviewChangePackage } = await import("../shared/auraChangePackage.mjs");
await exec("git", ["init", repo]);
const git = (...args: string[]) => exec("git", ["-C", repo, "-c", "user.name=Test", "-c", "user.email=test@example.test", ...args]);
await git("commit", "--allow-empty", "-m", "init");
await git("remote", "add", "origin", "https://github.com/IFCDC9/IFCDC.git");
const app = express();
app.use(express.json({ limit: "300kb" }));
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

async function stagingFixture(label: string) {
  rmSync(path.join(repo, "local.txt"), { force: true });
  const device = await bridge.enrollRunner(label, "founder");
  const changePackage = { version: 1, repository: "IFCDC9/IFCDC", baseCommit: (await git("rev-parse", "HEAD")).stdout.trim(),
    summary: "Record the reviewed staging milestone", files: [{ path: "Documents/products/staging-check.md",
      beforeSha256: null, content: "Reviewed staging — no test execution.\n" }] };
  const reviewedSha256 = reviewChangePackage(changePackage).packageSha256;
  return { device, changePackage, reviewedSha256, config: { hqUrl, repoRoot: repo, runnerToken: device.token } };
}

test("Founder review and explicit approval dispatch immutable content; locally enabled worker stages and reports a receipt", async () => {
  const { device, changePackage, reviewedSha256, config } = await stagingFixture("Staging Mac");
  const reviewResponse = await request("/runner-change-review", founder, { changePackage });
  assert.equal(reviewResponse.status, 200);
  assert.equal((await reviewResponse.json()).packageSha256, reviewedSha256);
  const queued = await request("/runner-change-jobs", founder, { runnerId: device.id, changePackage, reviewedSha256, approved: true });
  assert.equal(queued.status, 201);
  const job = await queued.json();
  // Capability opt-in is local and absent by default; old workers do not consume staging jobs.
  assert.equal((await runRunnerOnce(config)).status, "idle");
  assert.equal((await (await getDb()).get("SELECT status FROM aura_runner_jobs WHERE id = ?", job.id)).status, "queued");
  const originalContent = changePackage.files[0].content;
  changePackage.files[0].content = "Changed after approval";
  const result = await runRunnerOnce({ ...config, allowPackageStaging: true });
  assert.equal(result.status, "succeeded");
  try {
    assert.equal(readFileSync(path.join(result.workspace, "Documents/products/staging-check.md"), "utf8"), originalContent);
    assert.match(readFileSync(result.patchPath, "utf8"), /Reviewed staging/);
    assert.equal((await git("status", "--porcelain")).stdout.trim(), "");
    const listing = await (await request("/runners", founder)).json();
    const saved = listing.jobs.find((item: { id: string }) => item.id === job.id);
    assert.equal(saved.result.packageSha256, reviewedSha256);
    assert.equal(saved.result.fileCount, 1);
    assert.equal(saved.result.testsRun, false);
    assert.equal(saved.result.productionExecuted, false);
    assert.equal(JSON.stringify(listing).includes(result.workspace), false);
    assert.equal(JSON.stringify(listing).includes(originalContent), false);
    assert.equal(JSON.stringify(listing).includes(device.token), false);
  } finally { if (result.workspace) rmSync(path.dirname(result.workspace), { recursive: true, force: true }); }
});

test("staging routes require Founder authority, explicit approval and the exact review digest", async () => {
  const { device, changePackage, reviewedSha256 } = await stagingFixture("Approval Mac");
  for (const token of [undefined, device.token, staff]) {
    const expected = token === staff ? 403 : 401;
    assert.equal((await request("/runner-change-review", token, { changePackage })).status, expected);
    assert.equal((await request("/runner-change-jobs", token, { runnerId: device.id, changePackage, reviewedSha256, approved: true })).status, expected);
  }
  assert.equal((await request("/runner-change-jobs", founder, { runnerId: device.id, changePackage, reviewedSha256 })).status, 400);
  assert.equal((await request("/runner-change-jobs", founder, { runnerId: device.id, changePackage, reviewedSha256: "0".repeat(64), approved: true })).status, 400);
  assert.equal((await request("/runner-change-review", founder, { changePackage: { ...changePackage, command: "npm run deploy" } })).status, 400);
  assert.throws(() => validateRunnerConfig({ hqUrl, repoRoot: repo, runnerToken: device.token, allowPackageStaging: "true" }));
});

test("staging receipts are bound to their job and lease; replay, revocation and claimed test execution are rejected", async () => {
  const { device, changePackage, reviewedSha256 } = await stagingFixture("Receipt Mac");
  const other = await bridge.enrollRunner("Other staging Mac", "founder");
  await bridge.queueRunnerChangePackage(device.id, changePackage, reviewedSha256, true, "founder");
  const job = (await bridge.claimRunnerJob(device.id, ["stage_change_package_v1"]))!;
  const good = { status: "succeeded", packageSha256: reviewedSha256, baseCommit: changePackage.baseCommit,
    reviewId: "aura-review-test", fileCount: 1, testsRun: false, productionExecuted: false, workspace: "/private/local-path" };
  await assert.rejects(bridge.completeRunnerJob(other.id, job.id, job.lease, good), /not assigned/);
  await assert.rejects(bridge.completeRunnerJob(device.id, job.id, job.lease, { ...good, testsRun: true }), /approved package/);
  await assert.rejects(bridge.completeRunnerJob(device.id, job.id, job.lease, { ...good, packageSha256: "0".repeat(64) }), /approved package/);
  await assert.rejects(bridge.completeRunnerJob(device.id, job.id, job.lease, { ...good, fileCount: 2 }), /Invalid staging/);
  const saved = await bridge.completeRunnerJob(device.id, job.id, job.lease, good);
  assert.equal(JSON.stringify(saved).includes("/private/local-path"), false);
  await assert.rejects(bridge.completeRunnerJob(device.id, job.id, job.lease, good), /completed/);
  await bridge.queueRunnerChangePackage(device.id, changePackage, reviewedSha256, true, "founder");
  const second = (await bridge.claimRunnerJob(device.id, ["stage_change_package_v1"]))!;
  await bridge.revokeRunner(device.id, "founder");
  await assert.rejects(bridge.completeRunnerJob(device.id, second.id, second.lease, good), /not assigned/);
});

test("stale-base staging fails without changes; expired queued packages never run", async () => {
  const { device, changePackage, config } = await stagingFixture("Stale Mac");
  changePackage.baseCommit = "0".repeat(40);
  const digest = reviewChangePackage(changePackage).packageSha256;
  const queued = await bridge.queueRunnerChangePackage(device.id, changePackage, digest, true, "founder");
  assert.equal((await runRunnerOnce({ ...config, allowPackageStaging: true })).status, "failed");
  assert.equal((await git("status", "--porcelain")).stdout.trim(), "");
  const listing = await bridge.listRunnersAndJobs();
  assert.equal(listing.jobs.find((item) => item.id === queued.id)?.result.error, "package_staging_failed");
  const next = await bridge.queueRunnerChangePackage(device.id, changePackage, digest, true, "founder");
  const db = await getDb();
  await db.run("UPDATE aura_runner_jobs SET created_at = ? WHERE id = ?", Date.now() - 31 * 60_000, next.id);
  assert.equal(await bridge.claimRunnerJob(device.id, ["stage_change_package_v1"]), null);
  assert.equal((await db.get("SELECT status FROM aura_runner_jobs WHERE id = ?", next.id)).status, "expired");
});

async function queuedTestFixture(label: string) {
  const f = await stagingFixture(label);
  const staged = await bridge.queueRunnerChangePackage(f.device.id, f.changePackage, f.reviewedSha256, true, "founder");
  const result = await runRunnerOnce({ ...f.config, allowPackageStaging: true });
  if (result.workspace) rmSync(path.dirname(result.workspace), { recursive: true, force: true });
  const input = { stagingJobId: staged.id, reviewedSha256: f.reviewedSha256, testProfile: "package-validator-v1", approved: true };
  return { ...f, staged, input };
}

test("test dispatch requires successful staging, Founder approval, exact digest and fixed profile", async () => {
  const f = await queuedTestFixture("Test approval Mac");
  for (const token of [undefined, f.device.token, staff]) {
    assert.equal((await request("/runner-test-jobs", token, f.input)).status, token === staff ? 403 : 401);
  }
  for (const invalid of [{ ...f.input, approved: false }, { ...f.input, testProfile: "run_shell" },
    { ...f.input, command: "anything" }]) assert.equal((await request("/runner-test-jobs", founder, invalid)).status, 400);
  assert.equal((await request("/runner-test-jobs", founder, { ...f.input, reviewedSha256: "0".repeat(64) })).status, 409);
  assert.equal((await request("/runner-test-jobs", founder, { ...f.input, stagingJobId: "missing" })).status, 409);
  assert.throws(() => validateRunnerConfig({ ...f.config, allowPackageTests: "true" }));
  assert.throws(() => validateRunnerConfig({ ...f.config, packageTestImage: "node:latest" }));
  const queued = await request("/runner-test-jobs", founder, f.input);
  assert.equal(queued.status, 201);
  assert.equal((await runRunnerOnce({ ...f.config, allowPackageStaging: true })).status, "idle");
  // Missing local image configuration fails closed, never falls back to host execution.
  const outcome = await runRunnerOnce({ ...f.config, allowPackageTests: true });
  assert.equal(outcome.status, "failed");
  const listing = await bridge.listRunnersAndJobs();
  const receipt = listing.jobs.find((j) => j.id === outcome.jobId)!.result;
  assert.equal(receipt.error, "test_sandbox_unavailable");
  assert.equal(receipt.testsRun, false);
});

test("test receipts bind staging, digest, profile, computer and lease; reject contradictory pass claims", async () => {
  const f = await queuedTestFixture("Test receipt Mac");
  const queued = await bridge.queueRunnerPackageTests(f.input, "founder");
  const claimed = (await bridge.claimRunnerJob(f.device.id, ["test_change_package_v1"]))!;
  assert.equal(claimed.id, queued.id);
  const good = { status: "succeeded", outcome: "passed", testsRun: true, exitCode: 0, durationMs: 10,
    packageSha256: f.reviewedSha256, baseCommit: f.changePackage.baseCommit, testProfile: "package-validator-v1",
    stagingJobId: f.staged.id, productionExecuted: false, stdout: "secret must not leave worker" };
  for (const bad of [{ ...good, exitCode: 1 }, { ...good, testsRun: false }, { ...good, productionExecuted: true },
    { ...good, stagingJobId: "other" }, { ...good, packageSha256: "0".repeat(64) }, { ...good, durationMs: -1 }]) {
    await assert.rejects(bridge.completeRunnerJob(f.device.id, claimed.id, claimed.lease, bad));
  }
  const other = await bridge.enrollRunner("Other test Mac", "founder");
  await assert.rejects(bridge.completeRunnerJob(other.id, claimed.id, claimed.lease, good), /not assigned/);
  const saved = await bridge.completeRunnerJob(f.device.id, claimed.id, claimed.lease, good);
  assert.equal(saved.testsRun, true);
  assert.equal(JSON.stringify(saved).includes("secret must not leave worker"), false);
  await assert.rejects(bridge.completeRunnerJob(f.device.id, claimed.id, claimed.lease, good), /completed/);
});

test("plain worker executes the fixed harness through a Docker CLI stand-in and reports pass/fail, without changing the active checkout", async () => {
  // This verifies the process protocol, NOT real container isolation. Live Docker validation is separate.
  if (process.platform === "win32") return;
  mkdirSync(path.join(repo, "shared"), { recursive: true });
  writeFileSync(path.join(repo, "shared/auraChangePackage.mjs"), readFileSync(new URL("../shared/auraChangePackage.mjs", import.meta.url)));
  await git("add", "shared/auraChangePackage.mjs"); await git("commit", "-m", "test validator fixture");
  const bin = mkdtempSync(path.join(tmpdir(), "aura-docker-standin-"));
  const originalPath = process.env.PATH;
  const docker = path.join(bin, "docker");
  writeFileSync(docker, `#!/usr/bin/env node
const fs = require('node:fs');
const cp = require('node:child_process');
const args = process.argv.slice(2);
const marker = require('node:path').join(require('node:path').dirname(process.argv[1]), 'mode');
if (args[0] === 'image') process.exit(0);
if (args[0] === 'rm') { fs.writeFileSync(marker + '.cleaned', 'yes'); process.exit(0); }
if (fs.existsSync(marker)) { process.stdout.write('x'.repeat(100000)); setInterval(() => {}, 1000); return; }
if (!args.includes('--network=none') || !args.includes('--pull=never') || !args.includes('--read-only')) process.exit(125);
if (process.env.AURA_SECRET_TEST) process.exit(125);
const mount = args[args.indexOf('--mount') + 1];
const root = mount.split(',').find(x => x.startsWith('source=')).slice(7);
if (fs.existsSync(root + '/.git') || fs.existsSync(root + '/.env')) process.exit(125);
const run = cp.spawnSync(process.execPath, ['--test', 'script/aura-package-validator-suite.mjs'], {cwd: root, env: {PATH: process.env.PATH}, stdio: 'pipe'});
process.stdout.write(run.stdout || '');
process.exit(run.status ?? 1);
`);
  chmodSync(docker, 0o755);
  process.env.PATH = bin + path.delimiter + originalPath;
  process.env.AURA_SECRET_TEST = "not-for-tests";
  try {
    const f = await queuedTestFixture("Sandbox protocol Mac");
    await bridge.queueRunnerPackageTests(f.input, "founder");
    const result = await runRunnerOnce({ ...f.config, allowPackageTests: true, packageTestImage: "sha256:" + "a".repeat(64) });
    assert.equal(result.status, "succeeded");
    assert.equal((await git("status", "--porcelain")).stdout, "");
    const listed = await bridge.listRunnersAndJobs();
    assert.equal(listed.jobs.find((j) => j.id === result.jobId)!.result.outcome, "passed");
    writeFileSync(path.join(bin, "mode"), "overflow");
    rmSync(path.join(bin, "mode.cleaned"), { force: true });
    await bridge.queueRunnerPackageTests(f.input, "founder");
    const limited = await runRunnerOnce({ ...f.config, allowPackageTests: true, packageTestImage: "sha256:" + "a".repeat(64) });
    assert.equal(limited.error, "test_limit_exceeded");
    assert.equal(readFileSync(path.join(bin, "mode.cleaned"), "utf8"), "yes");
    const uncertain = (await bridge.listRunnersAndJobs()).jobs.find((j) => j.id === limited.jobId)!.result;
    assert.equal(uncertain.testsRun, null);
    rmSync(path.join(bin, "mode"));
    // Break the baseline module after successful staging. Tests refuse the now-stale base before execution.
    writeFileSync(path.join(repo, "shared/auraChangePackage.mjs"), "export const broken = true;\n");
    await bridge.queueRunnerPackageTests(f.input, "founder");
    const failed = await runRunnerOnce({ ...f.config, allowPackageTests: true, packageTestImage: "sha256:" + "a".repeat(64) });
    assert.equal(failed.error, "test_staging_failed");
    await git("restore", "shared/auraChangePackage.mjs");
    // A broken, committed validator is reported as a failing test run, never a pass.
    writeFileSync(path.join(repo, "shared/auraChangePackage.mjs"), "export const broken = true;\n");
    await git("add", "shared/auraChangePackage.mjs"); await git("commit", "-m", "broken validator fixture");
    const broken = await queuedTestFixture("Failing unit tests Mac");
    await bridge.queueRunnerPackageTests(broken.input, "founder");
    const failing = await runRunnerOnce({ ...broken.config, allowPackageTests: true, packageTestImage: "sha256:" + "a".repeat(64) });
    assert.equal(failing.status, "failed");
    const receipt = (await bridge.listRunnersAndJobs()).jobs.find((j) => j.id === failing.jobId)!.result;
    assert.equal(receipt.testsRun, true); assert.equal(receipt.outcome, "failed"); assert.ok(receipt.exitCode > 0);
  } finally {
    process.env.PATH = originalPath; delete process.env.AURA_SECRET_TEST;
    rmSync(bin, { recursive: true, force: true });
  }
});
