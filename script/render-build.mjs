#!/usr/bin/env node
/**
 * Render production build — phased, timed, with hard timeouts.
 * Replaces bare `npm run build` in Render buildCommand to avoid silent hangs.
 *
 * Phases (each must exit cleanly):
 *   1. build-ifcdc-packages.mjs
 *   2. script/build.ts (server esbuild + vite client)
 *   3. render-postbuild.mjs (artifact verification)
 *
 * Start command remains separate: render-prestart.mjs && npm run start
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const NODE_HEAP = "--max-old-space-size=768";

function stamp() {
  return new Date().toISOString();
}

function runPhase(label, command, args, timeoutMs) {
  console.log(`\n[render-build] ▶ ${label}`);
  console.log(`[render-build]   started ${stamp()}`);
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    timeout: timeoutMs,
    env: {
      ...process.env,
      NODE_OPTIONS: [process.env.NODE_OPTIONS, NODE_HEAP].filter(Boolean).join(" "),
      RENDER: process.env.RENDER ?? "true",
    },
  });
  const elapsed = Math.round((Date.now() - started) / 1000);

  if (result.error?.code === "ETIMEDOUT") {
    console.error(`[render-build] ✗ ${label} TIMED OUT after ${timeoutMs / 1000}s`);
    process.exit(1);
  }
  if (result.signal) {
    console.error(`[render-build] ✗ ${label} killed by signal ${result.signal} after ${elapsed}s`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`[render-build] ✗ ${label} failed (exit ${result.status}) after ${elapsed}s`);
    process.exit(result.status ?? 1);
  }
  console.log(`[render-build] ✓ ${label} complete (${elapsed}s)`);
}

console.log("[render-build] IFCDC HQ — production build pipeline");
console.log(`[render-build] node ${process.version} | ${stamp()}`);

const tsx = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
if (!fs.existsSync(tsx)) {
  console.error("[render-build] tsx not found — run npm ci --include=dev");
  process.exit(1);
}

// Phase 1: @ifcdc/* packages (~30s)
runPhase("build-ifcdc-packages", process.execPath, ["script/build-ifcdc-packages.mjs"], 300_000);

// Phase 2: server esbuild + vite client (can be slow on Render starter — 20 min cap)
runPhase("app build (server + client)", process.execPath, [tsx, "script/build.ts"], 1_200_000);

// Phase 3: verify dist artifacts (~5s)
runPhase("render-postbuild verify", process.execPath, ["script/render-postbuild.mjs"], 120_000);

console.log(`\n[render-build] ✅ Build pipeline finished — ${stamp()}`);
