import { spawnSync } from "node:child_process";
import { build as esbuild } from "esbuild";
import { rm, readFile, writeFile } from "fs/promises";

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

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "esm",
    outfile: "dist/index.mjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
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

  // Create CJS wrapper for deployment compatibility
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
  console.log("Created dist/index.cjs wrapper");

  console.log("building client...");
  const vite = spawnSync("npx", ["vite", "build"], { stdio: "inherit" });
  if (vite.status !== 0) {
    throw new Error("Vite client build failed");
  }
  console.log("client build complete");
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
