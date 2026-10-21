/** Outbound-only inspection and explicitly enabled isolated package staging. No tests, push or deploy. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const exec = promisify(execFile);
const remoteAllowed = (url) => /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)IFCDC9\/IFCDC(?:\.git)?$/i.test(url.trim());

export function validateRunnerConfig(config) {
  if (!config || typeof config !== "object" || typeof config.hqUrl !== "string" ||
      typeof config.repoRoot !== "string" || !path.isAbsolute(config.repoRoot) ||
      (config.allowPackageStaging !== undefined && typeof config.allowPackageStaging !== "boolean") ||
      !/^aura_runner_[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/.test(config.runnerToken || "")) {
    throw new Error("Invalid runner configuration.");
  }
  const url = new URL(config.hqUrl);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && local)) || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash) throw new Error("HQ must be an HTTPS origin (HTTP is allowed only on loopback).");
  return { ...config, hqUrl: url.origin };
}

export async function inspectRepository(repoRoot) {
  let root;
  try { root = fs.realpathSync(repoRoot); }
  catch { return { status: "failed", error: "repository_unavailable" }; }
  // Exclude GIT_DIR, GIT_WORK_TREE, credential/config injection and server secrets.
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, LANG: "C.UTF-8", GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" };
  const git = async (...args) => (await exec("git", ["-C", root, "-c", "core.fsmonitor=false", ...args], { env, timeout: 10_000, maxBuffer: 1024 * 1024 })).stdout;
  try {
    const top = (await git("rev-parse", "--show-toplevel")).trim();
    if (fs.realpathSync(top) !== root) return { status: "failed", error: "wrong_repository" };
    for (const mode of [[], ["--push"]]) {
      const urls = (await git("remote", "get-url", ...mode, "--all", "origin")).trim().split(/\r?\n/);
      if (urls.length !== 1 || !remoteAllowed(urls[0])) return { status: "failed", error: "wrong_repository" };
    }
    const commit = (await git("rev-parse", "HEAD")).trim();
    let branch = null;
    try { branch = (await git("symbolic-ref", "--short", "-q", "HEAD")).trim(); }
    catch { /* Detached HEAD is still inspectable. */ }
    const count = (text) => text.split("\0").filter(Boolean).length;
    const changedFiles = count(await git("diff", "--no-ext-diff", "--no-textconv", "--name-only", "-z", "HEAD", "--"));
    const untrackedFiles = count(await git("ls-files", "--others", "--exclude-standard", "-z"));
    return { status: "succeeded", repository: "IFCDC9/IFCDC", commit, branch, changedFiles, untrackedFiles };
  } catch { return { status: "failed", error: "inspection_failed" }; }
}

export async function runRunnerOnce(input) {
  const config = validateRunnerConfig(input);
  async function request(endpoint, body = {}) {
    const response = await fetch(`${config.hqUrl}/api/hq/aura/software-engineering${endpoint}`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${config.runnerToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw Object.assign(new Error(`HQ runner request failed (${response.status}).`), { status: response.status });
    return response.json();
  }
  const capabilities = ["inspect_repository", ...(config.allowPackageStaging === true ? ["stage_change_package_v1"] : [])];
  const { job } = await request("/runner/claim", { capabilities });
  if (!job) return { status: "idle" };
  if (!capabilities.includes(job.kind) || !/^[a-f0-9-]{36}$/.test(job.id) || !/^[A-Za-z0-9_-]{43}$/.test(job.lease) ||
      !Number.isSafeInteger(job.lease_until) || job.lease_until <= Date.now()) {
    throw new Error("HQ returned an unsupported job.");
  }
  let result;
  let localReview;
  if (job.kind === "stage_change_package_v1") {
    const { stageChangePackage, reviewChangePackage } = await import("./aura-change-package.mjs");
    const review = reviewChangePackage(job.changePackage);
    if (job.reviewedSha256 !== review.packageSha256) throw new Error("HQ returned a changed package.");
    try {
      localReview = await stageChangePackage({ repoRoot: config.repoRoot, changePackage: job.changePackage,
        reviewedSha256: job.reviewedSha256 });
      result = { status: "succeeded", packageSha256: review.packageSha256, baseCommit: review.baseCommit,
        fileCount: review.files.length, reviewId: path.basename(path.dirname(localReview.workspace)),
        testsRun: false, productionExecuted: false };
    } catch {
      result = { status: "failed", error: "package_staging_failed", packageSha256: review.packageSha256,
        testsRun: false, productionExecuted: false };
    }
  } else result = await inspectRepository(config.repoRoot);
  await request(`/runner/jobs/${job.id}/result`, { lease: job.lease, result });
  // Paths stay on the local terminal; HQ receives only a bounded receipt.
  return { jobId: job.id, status: result.status, ...(localReview ? { workspace: localReview.workspace, patchPath: localReview.patchPath } : {}) };
}

async function main() {
  const configPath = process.env.AURA_RUNNER_CONFIG || path.join(os.homedir(), ".config", "ifcdc", "aura-runner.json");
  const stat = fs.statSync(configPath);
  if (process.platform !== "win32" && (stat.mode & 0o077)) throw new Error("Runner config must be private: set its permissions to 600.");
  const config = validateRunnerConfig(JSON.parse(fs.readFileSync(configPath, "utf8")));
  const watch = process.argv.includes("--watch");
  let failures = 0;
  do {
    try {
      console.log(JSON.stringify(await runRunnerOnce(config)));
      failures = 0;
    } catch (error) {
      if (!watch || error.status === 401 || error.status === 403) throw error;
      failures++;
      console.error("Runner connection interrupted; retrying. An uncertain job will expire rather than run twice.");
    }
    if (watch) await new Promise((resolve) => setTimeout(resolve, Math.min(60_000, 15_000 * 2 ** Math.min(failures, 2))));
  } while (watch);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    // Never print config contents, tokens, git output or response bodies.
    console.error(error instanceof Error && /^HQ runner request failed \(\d+\)\.$/.test(error.message)
      ? error.message : "Runner stopped. Check its private configuration, repository and HQ connection.");
    process.exitCode = 1;
  });
}
