/**
 * Creative memory for AURA Resolve — approved/rejected edits and preferences.
 * Lives on the Production Mac under the aura-resolve library (not a new DB service).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const ROOT = join(homedir(), "Library/Application Support/IFCDC/aura-resolve");
const MEMORY_PATH = join(ROOT, "creative-memory.json");

const DEFAULT = {
  version: 1,
  preferences: {
    pacing: "medium",
    transitions: "hard-cut-plus-brand-flash",
    brandingPlacement: "lower-third-then-end-card",
    music: "ifcdc-bed-low",
    endings: "smooth-fade-to-black",
    structure: "logo-hook-proof-cta",
    formats: ["9:16"],
    templates: ["barbers-promo-vertical"],
  },
  productions: [],
  revisions: [],
  approvals: [],
};

export function readCreativeMemory() {
  mkdirSync(ROOT, { recursive: true });
  if (!existsSync(MEMORY_PATH)) {
    writeFileSync(MEMORY_PATH, JSON.stringify(DEFAULT, null, 2));
    return structuredClone(DEFAULT);
  }
  try {
    return { ...structuredClone(DEFAULT), ...JSON.parse(readFileSync(MEMORY_PATH, "utf8")) };
  } catch {
    return structuredClone(DEFAULT);
  }
}

export function writeCreativeMemory(next) {
  mkdirSync(ROOT, { recursive: true });
  writeFileSync(MEMORY_PATH, JSON.stringify(next, null, 2));
  return next;
}

export function rememberProduction(entry) {
  const memory = readCreativeMemory();
  memory.productions = [entry, ...(memory.productions || [])].slice(0, 40);
  return writeCreativeMemory(memory);
}

export function rememberRevision(entry) {
  const memory = readCreativeMemory();
  memory.revisions = [entry, ...(memory.revisions || [])].slice(0, 40);
  if (entry.preferences) {
    memory.preferences = { ...memory.preferences, ...entry.preferences };
  }
  return writeCreativeMemory(memory);
}

export function rememberApproval(entry) {
  const memory = readCreativeMemory();
  memory.approvals = [entry, ...(memory.approvals || [])].slice(0, 40);
  return writeCreativeMemory(memory);
}
