#!/usr/bin/env node
/**
 * Render prestart — persist HQ uploads on the same disk as SQLite (data/).
 * Symlinks server/uploads/hq → data/hq-uploads so grant documents survive redeploys.
 */
import fs from "fs";
import path from "path";

const root = process.cwd();
const uploadTarget = path.join(root, "data", "hq-uploads");
const uploadLink = path.join(root, "server", "uploads", "hq");

fs.mkdirSync(path.join(root, "data"), { recursive: true });
fs.mkdirSync(uploadTarget, { recursive: true });
fs.mkdirSync(path.dirname(uploadLink), { recursive: true });

try {
  const stat = fs.lstatSync(uploadLink);
  if (stat.isSymbolicLink()) {
    fs.unlinkSync(uploadLink);
  } else if (stat.isDirectory()) {
    // First deploy: move any seeded files onto the persistent disk
    for (const name of fs.readdirSync(uploadLink)) {
      const src = path.join(uploadLink, name);
      const dest = path.join(uploadTarget, name);
      if (!fs.existsSync(dest)) fs.renameSync(src, dest);
    }
    fs.rmSync(uploadLink, { recursive: true, force: true });
  } else {
    fs.rmSync(uploadLink, { force: true });
  }
} catch (err) {
  if (err?.code !== "ENOENT") throw err;
}

fs.symlinkSync(uploadTarget, uploadLink);
console.log(`Render prestart: ${uploadLink} → ${uploadTarget}`);
