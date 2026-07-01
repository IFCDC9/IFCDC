#!/usr/bin/env node
/**
 * Generate a one-time Super Admin password for Render / local .env.
 * Writes to .credentials/ (gitignored) — never commit the output file.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "../.credentials");
const OUT_FILE = path.join(OUT_DIR, `super-admin-password-${new Date().toISOString().slice(0, 10)}.txt`);

const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%^&*-_=+";
const ALL = UPPER + LOWER + DIGITS + SYMBOLS;

function pick(set) {
  return set[crypto.randomInt(0, set.length)];
}

function generatePassword(length = 40) {
  const chars = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SYMBOLS)];
  while (chars.length < length) chars.push(pick(ALL));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

const password = generatePassword(40);
fs.mkdirSync(OUT_DIR, { recursive: true });
const body = `# IFCDC HQ Super Admin — one-time credential setup
# Generated: ${new Date().toISOString()}
# Account: service@ifcdc.org (MASTER_OWNER_EMAIL)
#
# Set on Render → ifcdc-hq → Environment:
#   MASTER_OWNER_EMAIL=service@ifcdc.org
#   FOUNDER_SEED_PASSWORD=<password below>
#
# Store in your password manager, then delete this file.

FOUNDER_SEED_PASSWORD=${password}
`;
fs.writeFileSync(OUT_FILE, body, { mode: 0o600 });
console.log(`Super Admin password written to:\n  ${OUT_FILE}\n`);
console.log("Copy FOUNDER_SEED_PASSWORD to Render (ifcdc-hq) and your password manager.");
console.log("Do not commit .credentials/ or paste this password in chat.");
