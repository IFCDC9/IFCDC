#!/usr/bin/env node
/**
 * Compile local @ifcdc/* file dependencies before the HQ app build/start.
 * Source lives in Libraries/ifcdc-packages; npm links them into node_modules.
 * Package main entries point at dist/index.js, which is not committed to git.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const tscBin = path.join(root, "node_modules", "typescript", "bin", "tsc");

if (!fs.existsSync(tscBin)) {
  console.error("build-ifcdc-packages: typescript is required (npm ci must include devDependencies)");
  process.exit(1);
}

const packages = [
  "auth",
  "aura-ai",
  "payments",
  "notifications",
  "headquarters-sdk",
];

console.log("Building @ifcdc/* workspace packages...");

for (const name of packages) {
  const pkgDir = path.join(root, "Libraries", "ifcdc-packages", "packages", name);
  const pkgJson = path.join(pkgDir, "package.json");

  if (!fs.existsSync(pkgJson)) {
    console.error(`build-ifcdc-packages: missing package at ${pkgDir}`);
    process.exit(1);
  }

  console.log(`  @ifcdc/${name}`);
  const result = spawnSync(process.execPath, [tscBin, "-p", "tsconfig.json"], {
    cwd: pkgDir,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  const distIndex = path.join(pkgDir, "dist", "index.js");
  const linkedIndex = path.join(root, "node_modules", "@ifcdc", name, "dist", "index.js");

  if (!fs.existsSync(distIndex)) {
    console.error(`build-ifcdc-packages: missing ${distIndex}`);
    process.exit(1);
  }

  if (!fs.existsSync(linkedIndex)) {
    console.error(`build-ifcdc-packages: missing linked module ${linkedIndex}`);
    process.exit(1);
  }
}

console.log("build-ifcdc-packages: all @ifcdc packages compiled");
