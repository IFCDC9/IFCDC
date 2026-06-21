#!/usr/bin/env node
/**
 * IFCDC App Generator
 * Usage: node create-ifcdc-app.mjs <app-name> [--dir <path>]
 * Example: node create-ifcdc-app.mjs my-new-app --dir ~/Development/IFCDC/Apps
 */

import { mkdir, writeFile, cp } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const TEMPLATE_DIR = join(__dirname, "..", "templates", "fullstack-app");

const args = process.argv.slice(2);
const appName = args[0];
const dirFlag = args.indexOf("--dir");
const targetDir = dirFlag !== -1 ? args[dirFlag + 1] : join(__dirname, "..", "..", "Apps");

if (!appName || appName.startsWith("--")) {
  console.error(`
IFCDC App Generator v1.0.0

Usage:
  create-ifcdc-app <app-name> [--dir <path>]

Options:
  --dir    Output directory (default: IFCDC/Apps/)

Example:
  create-ifcdc-app wellness-platform
  create-ifcdc-app my-app --dir ~/Development/IFCDC/Apps
`);
  process.exit(1);
}

const slug = appName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const displayName = appName.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const projectPath = resolve(targetDir, slug);

async function replaceInFile(filePath, replacements) {
  const { readFile } = await import("node:fs/promises");
  let content = await readFile(filePath, "utf-8");
  for (const [key, value] of Object.entries(replacements)) {
    content = content.replaceAll(key, value);
  }
  await writeFile(filePath, content);
}

async function main() {
  console.log(`\n🏛️  IFCDC App Generator`);
  console.log(`   Creating: ${displayName}`);
  console.log(`   Location: ${projectPath}\n`);

  await mkdir(projectPath, { recursive: true });
  await cp(TEMPLATE_DIR, projectPath, { recursive: true });

  const replacements = {
    "__APP_NAME__": slug,
    "__APP_DISPLAY_NAME__": displayName,
    "__APP_DESCRIPTION__": `${displayName} — IFCDC application`,
  };

  const filesToProcess = [
    "package.json",
    "README.md",
    ".env.example",
    "client/index.html",
    "server/index.ts",
  ];

  for (const file of filesToProcess) {
    try {
      await replaceInFile(join(projectPath, file), replacements);
    } catch {
      // file may not exist in template
    }
  }

  console.log(`✅ Project scaffolded at: ${projectPath}`);
  console.log(`
Next steps:
  cd ${projectPath}
  npm install
  cp .env.example .env
  npm run dev

IFCDC Services (optional):
  Auth:         http://localhost:4100
  AURA AI:      http://localhost:4101
  Notifications: http://localhost:4102
  Payments:     http://localhost:4103
  Database:     http://localhost:4104
`);
}

main().catch((err) => {
  console.error("Failed to create app:", err.message);
  process.exit(1);
});
