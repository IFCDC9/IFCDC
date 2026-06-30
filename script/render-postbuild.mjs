#!/usr/bin/env node
import fs from "fs";
import path from "path";

const root = process.cwd();
const ifcdcPackages = ["auth", "aura-ai", "payments", "notifications", "headquarters-sdk"];
const distPublic = path.join(root, "dist", "public");
const indexHtmlPath = path.join(distPublic, "index.html");
const assetsDir = path.join(distPublic, "assets");

const required = [
  path.join(root, "dist", "index.cjs"),
  path.join(root, "dist", "index.mjs"),
  indexHtmlPath,
  ...ifcdcPackages.map((name) =>
    path.join(root, "node_modules", "@ifcdc", name, "dist", "index.js"),
  ),
];

for (const file of required) {
  if (!fs.existsSync(file)) {
    console.error(`Render postbuild: missing required artifact ${file}`);
    process.exit(1);
  }
}

const indexHtml = fs.readFileSync(indexHtmlPath, "utf8");
const assetRefs = [
  ...indexHtml.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g),
].map((m) => m[1]);

if (assetRefs.length === 0) {
  console.error("Render postbuild: index.html has no /assets/ script or stylesheet references");
  process.exit(1);
}

for (const ref of assetRefs) {
  const file = path.join(distPublic, ref.replace(/^\//, ""));
  if (!fs.existsSync(file)) {
    console.error(`Render postbuild: index.html references missing asset ${ref}`);
    process.exit(1);
  }
}

// Verify every chunk referenced inside JS bundles (lazy imports)
const CHUNK_REF_RE = /(?:\/assets\/|assets\/)([A-Za-z0-9_.-]+\.(?:js|css))/g;
const allRefs = new Set(assetRefs);
for (const name of fs.readdirSync(assetsDir)) {
  if (!name.endsWith(".js")) continue;
  const text = fs.readFileSync(path.join(assetsDir, name), "utf8");
  for (const m of text.matchAll(CHUNK_REF_RE)) {
    allRefs.add(`/assets/${m[1]}`);
  }
}
for (const ref of allRefs) {
  const file = path.join(distPublic, ref.replace(/^\//, ""));
  if (!fs.existsSync(file)) {
    console.error(`Render postbuild: bundle references missing asset ${ref}`);
    process.exit(1);
  }
}

const assetFiles = fs.readdirSync(assetsDir).filter((name) => name.endsWith(".js"));
if (assetFiles.length < 10) {
  console.error(`Render postbuild: expected many JS chunks in assets/, found ${assetFiles.length}`);
  process.exit(1);
}

console.log(
  `Render postbuild: verified SPA index + ${allRefs.size} linked assets + ${assetFiles.length} JS chunks`,
);
