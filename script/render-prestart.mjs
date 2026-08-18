#!/usr/bin/env node
/**
 * Render prestart — keep HQ uploads on the persistent disk (IFCDC_DATA_DIR).
 * Canonical: data/uploads/hq  (same path hqFileStorage uses).
 * Legacy:    data/hq-uploads and server/uploads/hq are migrated then linked.
 */
import fs from "fs";
import path from "path";

const root = process.cwd();
const dataDir = (process.env.IFCDC_DATA_DIR || "").trim() || path.join(root, "data");
const canonical = path.join(dataDir, "uploads", "hq");
const legacyDisk = path.join(dataDir, "hq-uploads");
const legacyServer = path.join(root, "server", "uploads", "hq");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function migrateIntoCanonical(fromDir) {
  if (!fs.existsSync(fromDir)) return;
  let stat;
  try {
    stat = fs.lstatSync(fromDir);
  } catch {
    return;
  }
  if (stat.isSymbolicLink()) return;
  if (!stat.isDirectory()) return;
  for (const name of fs.readdirSync(fromDir)) {
    if (name.startsWith(".")) continue;
    const src = path.join(fromDir, name);
    const dest = path.join(canonical, name);
    if (fs.existsSync(dest)) continue;
    try {
      if (fs.statSync(src).isFile()) fs.renameSync(src, dest);
    } catch {
      try {
        fs.copyFileSync(src, dest);
      } catch {
        /* ignore */
      }
    }
  }
}

function replaceWithSymlink(linkPath, target) {
  ensureDir(path.dirname(linkPath));
  try {
    const stat = fs.lstatSync(linkPath);
    if (stat.isSymbolicLink()) fs.unlinkSync(linkPath);
    else if (stat.isDirectory()) {
      migrateIntoCanonical(linkPath);
      fs.rmSync(linkPath, { recursive: true, force: true });
    } else {
      fs.rmSync(linkPath, { force: true });
    }
  } catch (err) {
    if (err?.code !== "ENOENT") throw err;
  }
  fs.symlinkSync(target, linkPath);
}

ensureDir(dataDir);
ensureDir(canonical);
migrateIntoCanonical(legacyDisk);
migrateIntoCanonical(legacyServer);
replaceWithSymlink(legacyServer, canonical);
replaceWithSymlink(legacyDisk, canonical);
console.log(`Render prestart: canonical uploads ${canonical}`);
console.log(`Render prestart: ${legacyServer} → ${canonical}`);
console.log(`Render prestart: ${legacyDisk} → ${canonical}`);
