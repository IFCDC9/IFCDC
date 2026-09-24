/**
 * Creative memory for AURA Resolve — IFCDC PRODUCTIONS company retained permanently.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const ROOT = join(homedir(), "Library/Application Support/IFCDC/aura-resolve");
const MEMORY_PATH = join(ROOT, "creative-memory.json");

export const PRODUCTION_COMPANY = "IFCDC PRODUCTIONS";

const DEFAULT = {
  version: 2,
  company: PRODUCTION_COMPANY,
  companyMemory: {
    name: PRODUCTION_COMPANY,
    creditLine: "AN IFCDC PRODUCTION",
    applyAutomatically: true,
    retainedPermanently: true,
  },
  preferences: {
    pacing: "medium",
    transitions: "hard-cut-plus-brand-flash",
    brandingPlacement: "lower-third-then-end-card",
    music: "ifcdc-bed-low",
    musicVolume: 0.28,
    endings: "smooth-fade-to-black",
    fadeSeconds: 1.1,
    openSeconds: 2.2,
    structure: "logo-hook-proof-cta-credit",
    formats: ["9:16", "16:9", "1:1"],
    templates: ["ifcdc-production-kit"],
    captions: true,
  },
  editorialDecisions: [],
  productions: [],
  revisions: [],
  masters: [],
  approvals: [],
  gateHistory: [],
};

function normalize(raw) {
  const base = structuredClone(DEFAULT);
  const merged = { ...base, ...raw };
  merged.company = PRODUCTION_COMPANY;
  merged.companyMemory = { ...base.companyMemory, ...(raw.companyMemory || {}), name: PRODUCTION_COMPANY };
  merged.preferences = { ...base.preferences, ...(raw.preferences || {}) };
  merged.productions = raw.productions || [];
  merged.revisions = raw.revisions || [];
  merged.masters = raw.masters || [];
  merged.approvals = raw.approvals || [];
  merged.editorialDecisions = raw.editorialDecisions || [];
  merged.gateHistory = raw.gateHistory || [];
  return merged;
}

export function readCreativeMemory() {
  mkdirSync(ROOT, { recursive: true });
  if (!existsSync(MEMORY_PATH)) {
    writeFileSync(MEMORY_PATH, JSON.stringify(DEFAULT, null, 2));
    return structuredClone(DEFAULT);
  }
  try {
    return normalize(JSON.parse(readFileSync(MEMORY_PATH, "utf8")));
  } catch {
    return structuredClone(DEFAULT);
  }
}

export function writeCreativeMemory(next) {
  mkdirSync(ROOT, { recursive: true });
  const normalized = normalize(next);
  writeFileSync(MEMORY_PATH, JSON.stringify(normalized, null, 2));
  return normalized;
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

export function rememberMaster(entry) {
  const memory = readCreativeMemory();
  memory.masters = [entry, ...(memory.masters || [])].slice(0, 40);
  return writeCreativeMemory(memory);
}

export function rememberEditorial(entry) {
  const memory = readCreativeMemory();
  memory.editorialDecisions = [entry, ...(memory.editorialDecisions || [])].slice(0, 60);
  if (entry.preferences) {
    memory.preferences = { ...memory.preferences, ...entry.preferences };
  }
  return writeCreativeMemory(memory);
}

export function rememberGate(entry) {
  const memory = readCreativeMemory();
  memory.gateHistory = [entry, ...(memory.gateHistory || [])].slice(0, 40);
  memory.currentGate = entry.gate;
  return writeCreativeMemory(memory);
}

export function ensureCompanyMemory() {
  const memory = readCreativeMemory();
  memory.company = PRODUCTION_COMPANY;
  memory.companyMemory = {
    name: PRODUCTION_COMPANY,
    creditLine: "AN IFCDC PRODUCTION",
    applyAutomatically: true,
    retainedPermanently: true,
  };
  return writeCreativeMemory(memory);
}
