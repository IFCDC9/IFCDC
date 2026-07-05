#!/usr/bin/env node
/**
 * Push local main to GitHub when normal git push fails (no credential helper).
 *
 * Usage (pick one):
 *   GITHUB_TOKEN=ghp_xxx node script/push-to-github.mjs
 *   GH_TOKEN=ghp_xxx node script/push-to-github.mjs
 *
 * Token needs repo scope on IFCDC9/IFCDC.
 * Create at: https://github.com/settings/tokens
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function loadDotEnv() {
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

async function main() {
  loadDotEnv();

  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_PAT;
  if (!token) {
    console.error("\n✗ No GitHub token found.\n");
    console.error("Set one of: GITHUB_TOKEN, GH_TOKEN, GITHUB_PAT");
    console.error("\nExample:");
    console.error("  GITHUB_TOKEN=ghp_xxxx node script/push-to-github.mjs");
    console.error("\nOr add GITHUB_TOKEN=... to .env (gitignored)");
    console.error("Create token: https://github.com/settings/tokens (repo scope)\n");
    process.exit(1);
  }

  const local = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", cwd: root });
  const localSha = local.stdout.trim();
  console.log(`\nLocal HEAD: ${localSha.slice(0, 7)}`);

  const remoteBefore = spawnSync("git", ["ls-remote", "origin", "refs/heads/main"], { encoding: "utf8", cwd: root });
  const beforeSha = remoteBefore.stdout.split(/\s+/)[0] || "?";
  console.log(`GitHub main before: ${beforeSha.slice(0, 7)}`);

  const pushUrl = `https://x-access-token:${token}@github.com/IFCDC9/IFCDC.git`;
  console.log("\nPushing main → origin/main...\n");

  const push = spawnSync("git", ["push", pushUrl, "main:main"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });

  if (push.status !== 0) {
    console.error("\n✗ Push failed. Check token has repo write access to IFCDC9/IFCDC.\n");
    process.exit(push.status ?? 1);
  }

  const verify = await fetch("https://api.github.com/repos/IFCDC9/IFCDC/commits/main");
  const body = await verify.json();
  console.log(`\n✓ GitHub main now: ${(body.sha || "?").slice(0, 7)}`);
  console.log(`  ${(body.commit?.message || "").split("\n")[0]}`);
  console.log("\nNext: Render Dashboard → ifcdc-hq → Manual Deploy → choose latest commit\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
