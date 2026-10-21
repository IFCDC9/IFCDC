/** Local review/staging only. No network dispatch, test execution, commit, push or deploy. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { inspectRepository } from "./aura-mac-runner.mjs";

const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
import { validateChangePackage, reviewChangePackage } from "../shared/auraChangePackage.mjs";
export { validateChangePackage, reviewChangePackage };

function git(root, ...args) {
  return execFileSync("git", ["-c", "core.hooksPath=" + os.devNull, "-c", "core.fsmonitor=false",
    "-C", root, ...args], { encoding: "utf8", timeout: 30_000, maxBuffer: 2 * 1024 * 1024,
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, LANG: "C.UTF-8",
      GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: os.devNull }, stdio: ["ignore", "pipe", "pipe"] });
}

export async function stageChangePackage({ repoRoot, changePackage, reviewedSha256 }) {
  const value = validateChangePackage(changePackage);
  const review = reviewChangePackage(value);
  if (!/^[a-f0-9]{64}$/.test(reviewedSha256 || "") || reviewedSha256 !== review.packageSha256) {
    throw new Error("The package does not match the reviewed SHA-256.");
  }
  const inspection = await inspectRepository(repoRoot);
  if (inspection.status !== "succeeded" || inspection.commit !== value.baseCommit ||
      inspection.changedFiles !== 0 || inspection.untrackedFiles !== 0) {
    throw new Error("The approved repository must be clean and at the exact package base commit.");
  }
  // A private independent clone avoids changing the active checkout, branches or index.
  // This is filesystem isolation, NOT a sandbox for executing untrusted code.
  const container = fs.mkdtempSync(path.join(os.tmpdir(), "aura-review-"));
  fs.chmodSync(container, 0o700);
  const workspace = path.join(container, "workspace");
  try {
    git(container, "clone", "--local", "--no-hardlinks", "--no-checkout", "--", fs.realpathSync(repoRoot), workspace);
    git(workspace, "checkout", "--detach", value.baseCommit);
    // Validate every target before writing any file. Refuse symlink ancestors and non-regular targets.
    for (const file of value.files) {
      let current = workspace;
      const parts = file.path.split("/");
      for (let i = 0; i < parts.length; i++) {
        current = path.join(current, parts[i]);
        let stat;
        try { stat = fs.lstatSync(current); } catch (error) { if (error.code !== "ENOENT") throw error; }
        if (stat && (stat.isSymbolicLink() || (i < parts.length - 1 ? !stat.isDirectory() : !stat.isFile()))) {
          throw new Error("Package target must be a regular file without symlink ancestors.");
        }
      }
      const target = path.join(workspace, file.path);
      const exists = fs.existsSync(target);
      if (file.beforeSha256 === null ? exists : !exists || hash(fs.readFileSync(target)) !== file.beforeSha256) {
        throw new Error("Package target does not match its expected original content.");
      }
    }
    for (const file of value.files) {
      const target = path.join(workspace, file.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, file.content, { encoding: "utf8", mode: 0o600 });
    }
    git(workspace, "add", "--", ...value.files.map((file) => file.path));
    const patch = git(workspace, "diff", "--cached", "--no-ext-diff", "--no-textconv", "--binary");
    const patchPath = path.join(container, "review.patch");
    fs.writeFileSync(patchPath, patch, { mode: 0o600 });
    const result = { ...review, workspace, patchPath, status: "staged_for_review" };
    fs.writeFileSync(path.join(container, "review.json"), JSON.stringify(result, null, 2), { mode: 0o600 });
    return result;
  } catch (error) {
    fs.rmSync(container, { recursive: true, force: true });
    throw error;
  }
}

async function main() {
  const [operation, packagePath, repoRoot, reviewedSha256] = process.argv.slice(2);
  if (!packagePath || !["review", "stage"].includes(operation) ||
      (operation === "review" ? process.argv.length !== 4 : process.argv.length !== 6)) {
    throw new Error("Usage: node script/aura-change-package.mjs review PACKAGE.json | stage PACKAGE.json REPO_ROOT REVIEWED_SHA256");
  }
  if (fs.statSync(packagePath).size > 250_000) throw new Error("Package exceeds size limit.");
  const changePackage = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  console.log(JSON.stringify(operation === "review" ? reviewChangePackage(changePackage) :
    await stageChangePackage({ repoRoot, changePackage, reviewedSha256 }), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => { console.error("Package refused. Check its format, reviewed digest, approved repository and base commit. No tests, commits, pushes or deployments were run."); process.exitCode = 1; });
}
