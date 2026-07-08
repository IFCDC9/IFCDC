#!/usr/bin/env node
/**
 * Trigger a Render manual deploy when RENDER_API_KEY + RENDER_SERVICE_ID are set.
 * Falls back to dashboard instructions when credentials are missing.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const envPath = path.join(root, ".env");
if (fs.existsSync(envPath)) {
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

const API_KEY = process.env.RENDER_API_KEY?.trim();
const SERVICE_ID = process.env.RENDER_SERVICE_ID?.trim();
const EXPECT = (process.env.IFCDC_EXPECT_COMMIT || "").trim() || (await import("node:child_process")).execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();

if (!API_KEY || !SERVICE_ID) {
  console.log("\n── Render manual deploy required (autoDeploy: false) ──");
  console.log("1. https://dashboard.render.com → ifcdc-hq");
  console.log("2. Cancel any in-progress deploy");
  console.log("3. Manual Deploy → latest main commit", EXPECT);
  console.log("4. Optional: Clear build cache\n");
  process.exit(2);
}

const res = await fetch(`https://api.render.com/v1/services/${SERVICE_ID}/deploys`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ clearCache: "clear" }),
});

const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error("Render deploy trigger failed:", res.status, body?.message || JSON.stringify(body).slice(0, 200));
  process.exit(1);
}

console.log(`\n✓ Render deploy triggered for commit ${EXPECT}`);
console.log(`  deploy id: ${body.id ?? "?"}`);
console.log(`  status: ${body.status ?? "?"}\n`);
