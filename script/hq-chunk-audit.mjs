#!/usr/bin/env node
/**
 * IFCDC HQ — Full Vite chunk integrity audit.
 * Verifies every /assets/*.js referenced by the production build exists on disk
 * and (optionally) on the live deployment with correct MIME type.
 *
 * Usage:
 *   node script/hq-chunk-audit.mjs
 *   IFCDC_BASE_URL=https://ifcdc-hq-wst6.onrender.com node script/hq-chunk-audit.mjs --live
 */
import fs from "fs";
import path from "path";

const root = process.cwd();
const distPublic = path.join(root, "dist", "public");
const assetsDir = path.join(distPublic, "assets");
const live = process.argv.includes("--live");
const BASE = process.env.IFCDC_BASE_URL || "https://ifcdc-hq-wst6.onrender.com";

const CHUNK_REF_RE = /(?:\/assets\/|assets\/)([A-Za-z0-9_.-]+\.(?:js|css))/g;

function collectRefsFromFile(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const refs = new Set();
  for (const m of text.matchAll(CHUNK_REF_RE)) {
    refs.add(`/assets/${m[1]}`);
  }
  return refs;
}

function collectAllRefs() {
  const refs = new Set();
  const indexHtml = path.join(distPublic, "index.html");
  if (!fs.existsSync(indexHtml)) {
    throw new Error("dist/public/index.html missing — run npm run build first");
  }
  for (const m of fs.readFileSync(indexHtml, "utf8").matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)) {
    refs.add(m[1]);
  }
  if (!fs.existsSync(assetsDir)) {
    throw new Error("dist/public/assets missing");
  }
  for (const name of fs.readdirSync(assetsDir)) {
    if (!name.endsWith(".js")) continue;
    for (const ref of collectRefsFromFile(path.join(assetsDir, name))) {
      refs.add(ref);
    }
  }
  return [...refs].sort();
}

async function probeLive(ref) {
  const res = await fetch(`${BASE}${ref}`, { redirect: "follow" });
  const mime = res.headers.get("content-type") || "";
  const ok =
    res.ok &&
    (ref.endsWith(".css") ? mime.includes("text/css") : mime.includes("javascript"));
  const bodyStart = (await res.text()).slice(0, 40);
  const htmlShell = bodyStart.includes("<!DOCTYPE") || bodyStart.includes("<html");
  return { status: res.status, mime, ok: ok && !htmlShell, htmlShell };
}

async function main() {
  console.log("\n=== IFCDC HQ Chunk Integrity Audit ===\n");
  const refs = collectAllRefs();
  let fail = 0;

  console.log(`Found ${refs.length} unique asset references in build output\n`);

  for (const ref of refs) {
    const local = path.join(distPublic, ref.replace(/^\//, ""));
    if (!fs.existsSync(local)) {
      console.log(`✗ MISSING local ${ref}`);
      fail++;
      continue;
    }
    if (!live) {
      console.log(`✓ local ${ref}`);
      continue;
    }
    const probe = await probeLive(ref);
    if (probe.ok) {
      console.log(`✓ live ${ref} — ${probe.status} ${probe.mime.split(";")[0]}`);
    } else {
      console.log(
        `✗ live ${ref} — ${probe.status} ${probe.mime.split(";")[0]}${probe.htmlShell ? " (HTML shell — chunk mismatch)" : ""}`,
      );
      fail++;
    }
  }

  const jsCount = fs.readdirSync(assetsDir).filter((n) => n.endsWith(".js")).length;
  console.log(`\nJS chunks on disk: ${jsCount}`);
  console.log(`=== Result: ${fail === 0 ? "PASS" : `${fail} FAIL`} ===\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
