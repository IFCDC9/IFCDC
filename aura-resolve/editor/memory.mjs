/**
 * Creative memory for AURA Resolve — IFCDC PRODUCTIONS global identity retained permanently.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import {
  PRODUCTION_COMPANY,
  PRODUCTION_IDENTITY,
  PRODUCTION_CREDIT_LINE,
  GLOBAL_IDENTITY_RULE,
  ensureGlobalProductionIdentity,
} from "../brand/production-identity.mjs";

const ROOT = join(homedir(), "Library/Application Support/IFCDC/aura-resolve");
const MEMORY_PATH = join(ROOT, "creative-memory.json");

export { PRODUCTION_COMPANY, PRODUCTION_IDENTITY, PRODUCTION_CREDIT_LINE };

const DEFAULT = {
  version: 3,
  company: PRODUCTION_COMPANY,
  productionCompany: PRODUCTION_COMPANY,
  productionIdentity: PRODUCTION_IDENTITY,
  companyMemory: {
    name: PRODUCTION_COMPANY,
    productionCompany: PRODUCTION_COMPANY,
    productionIdentity: PRODUCTION_IDENTITY,
    creditLine: PRODUCTION_CREDIT_LINE,
    applyAutomatically: true,
    retainedPermanently: true,
    organizationWide: true,
    notLimitedToBarbersApp: true,
    visibleBrandingAutoBurn: false,
  },
  permanentRules: [GLOBAL_IDENTITY_RULE],
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

function ensurePermanentRule(list) {
  const rules = Array.isArray(list) ? [...list] : [];
  const without = rules.filter((r) => r?.id !== GLOBAL_IDENTITY_RULE.id);
  return [GLOBAL_IDENTITY_RULE, ...without];
}

function normalize(raw) {
  const base = structuredClone(DEFAULT);
  const merged = { ...base, ...raw };
  merged.version = Math.max(3, Number(raw.version) || 3);
  merged.company = PRODUCTION_COMPANY;
  merged.productionCompany = PRODUCTION_COMPANY;
  merged.productionIdentity = PRODUCTION_IDENTITY;
  merged.companyMemory = {
    ...base.companyMemory,
    ...(raw.companyMemory || {}),
    name: PRODUCTION_COMPANY,
    productionCompany: PRODUCTION_COMPANY,
    productionIdentity: PRODUCTION_IDENTITY,
    creditLine: PRODUCTION_CREDIT_LINE,
    applyAutomatically: true,
    retainedPermanently: true,
    organizationWide: true,
    notLimitedToBarbersApp: true,
    visibleBrandingAutoBurn: false,
  };
  merged.permanentRules = ensurePermanentRule(raw.permanentRules || base.permanentRules);
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
  memory.productionCompany = PRODUCTION_COMPANY;
  memory.productionIdentity = PRODUCTION_IDENTITY;
  memory.companyMemory = {
    name: PRODUCTION_COMPANY,
    productionCompany: PRODUCTION_COMPANY,
    productionIdentity: PRODUCTION_IDENTITY,
    creditLine: PRODUCTION_CREDIT_LINE,
    applyAutomatically: true,
    retainedPermanently: true,
    organizationWide: true,
    notLimitedToBarbersApp: true,
    visibleBrandingAutoBurn: false,
  };
  memory.permanentRules = ensurePermanentRule(memory.permanentRules);
  try {
    memory.productionsLibrary = ensureGlobalProductionIdentity({ forceCards: false });
  } catch (err) {
    memory.productionsLibraryError = String(err?.message || err);
  }
  return writeCreativeMemory(memory);
}
