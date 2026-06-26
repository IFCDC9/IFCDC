#!/usr/bin/env node
/**
 * HQ Dashboard format safety — ensures no unsafe .toLocaleString() on possibly undefined values.
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "client", "src");

const UNSAFE_PATTERNS = [
  /\)\.toLocaleString\(/,
  /\?\.\w+\.toLocaleString\(/,
  /[^?]\w+\.toLocaleString\(\)/,
];

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, files);
    else if (/\.(tsx|ts|jsx|js)$/.test(name)) files.push(p);
  }
  return files;
}

const hqFiles = walk(join(ROOT, "pages", "hq")).concat(walk(join(ROOT, "components", "hq")));
const issues = [];

for (const file of hqFiles) {
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes(".toLocaleString(")) continue;
    if (line.includes("safeFormat") || line.includes("formatDateTime") || line.includes("formatLocaleNumber")) continue;
    if (line.includes("new Date(") && line.includes("?")) continue;
    if (line.includes("fmtDate") || line.includes("toLocaleDateString")) continue;
    if (/if\s*\([^)]*==\s*null/.test(lines[i - 1] ?? "")) continue;
    if (line.trim().startsWith("//")) continue;
    if (line.includes("formatCurrency") || line.includes("formatChartCurrency")) continue;
    issues.push(`${file.replace(ROOT, "client/src")}:${i + 1}: ${line.trim()}`);
  }
}

const safeFormat = join(ROOT, "utils", "safeFormat.ts");
try {
  readFileSync(safeFormat, "utf8");
  console.log("✓ safeFormat utility present");
} catch {
  console.error("✗ safeFormat utility missing");
  process.exit(1);
}

if (issues.length) {
  console.log("\n⚠ Remaining direct .toLocaleString() usages (review for guards):\n");
  for (const issue of issues) console.log(" ", issue);
  console.log(`\n${issues.length} pattern(s) to review`);
} else {
  console.log("✓ No unsafe .toLocaleString() patterns in HQ components");
}

console.log("\nDone.");
