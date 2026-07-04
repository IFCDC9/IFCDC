import { spawnSync, execSync } from "node:child_process";
import { build as esbuild } from "esbuild";
import { rm, readFile, writeFile } from "fs/promises";
import path from "node:path";
import fs from "node:fs";

const allowlist = [
  "@neondatabase/serverless",
  "@prisma/adapter-pg",
  "@prisma/client",
  "bcryptjs",
  "cors",
  "dotenv",
  "express",
  "pg",
  "zod",
  "zod-validation-error",
  "csv-stringify",
  "jsonwebtoken",
];

function log(msg: string) {
  console.log(`[build] ${msg} — ${new Date().toISOString()}`);
}

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  log("building server (esbuild)…");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  const esbuildStarted = Date.now();
  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "esm",
    outfile: "dist/index.mjs",
    banner: {
      js: `
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
      `.trim(),
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });
  log(`server bundle complete (${Math.round((Date.now() - esbuildStarted) / 1000)}s)`);

  const startScript = `#!/usr/bin/env node
const { spawn } = require('child_process');
const path = require('path');

const mjsFile = path.join(__dirname, 'index.mjs');
const child = spawn('node', [mjsFile], {
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'production' }
});

child.on('exit', (code) => process.exit(code));
`;
  await writeFile("dist/index.cjs", startScript);
  log("Created dist/index.cjs wrapper");

  log("building client (vite)…");
  const viteBin = path.join(process.cwd(), "node_modules", "vite", "bin", "vite.js");
  if (!fs.existsSync(viteBin)) {
    throw new Error(`Vite not found at ${viteBin} — ensure devDependencies are installed (npm ci --include=dev)`);
  }
  const viteStarted = Date.now();
  const vite = spawnSync(process.execPath, [viteBin, "build"], { stdio: "inherit" });
  if (vite.status !== 0) {
    throw new Error("Vite client build failed");
  }
  log(`client build complete (${Math.round((Date.now() - viteStarted) / 1000)}s)`);

  let commit = (process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || "").trim();
  if (!commit) {
    try {
      commit = execSync("git rev-parse HEAD", {
        stdio: ["ignore", "pipe", "ignore"],
      })
        .toString()
        .trim();
    } catch {
      commit = "";
    }
  }
  await writeFile(
    "dist/build-info.json",
    JSON.stringify({ commit: commit || null, builtAt: new Date().toISOString() }),
  );
  log(`Wrote dist/build-info.json (commit ${commit ? commit.slice(0, 7) : "unknown"})`);
}

buildAll().catch((err) => {
  console.error("[build] FAILED:", err);
  process.exit(1);
});
