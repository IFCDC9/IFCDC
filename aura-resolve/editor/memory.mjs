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
    visualStyle: null,
    fonts: null,
    logoPlacement: null,
    introOutro: null,
    cta: null,
    camera: null,
    color: null,
  },
  /** Append-only — never overwrite earlier approved preference entries */
  preferencesHistory: [],
  successes: [],
  rejections: [],
  revisionHistory: [],
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
  merged.preferencesHistory = Array.isArray(raw.preferencesHistory) ? raw.preferencesHistory : [];
  merged.successes = Array.isArray(raw.successes) ? raw.successes : [];
  merged.rejections = Array.isArray(raw.rejections) ? raw.rejections : [];
  merged.revisionHistory = Array.isArray(raw.revisionHistory) ? raw.revisionHistory : [];
  merged.productions = raw.productions || [];
  merged.revisions = raw.revisions || [];
  merged.masters = raw.masters || [];
  merged.approvals = raw.approvals || [];
  merged.editorialDecisions = raw.editorialDecisions || [];
  merged.gateHistory = raw.gateHistory || [];
  return merged;
}

/**
 * Append-only preference record. Updates the effective preferences object
 * but NEVER deletes or rewrites earlier approved preference history entries.
 */
export function appendPreference(entry) {
  const memory = readCreativeMemory();
  const record = {
    id: `pref_${Date.now().toString(36)}`,
    at: new Date().toISOString(),
    approved: entry.approved === true,
    kind: entry.kind || "preference",
    payload: entry.payload || entry.preferences || {},
    note: entry.note || null,
  };
  memory.preferencesHistory = [record, ...(memory.preferencesHistory || [])].slice(0, 200);
  if (entry.preferences && typeof entry.preferences === "object") {
    memory.preferences = { ...memory.preferences, ...entry.preferences };
  }
  if (entry.success) {
    memory.successes = [{ at: record.at, ...entry.success }, ...(memory.successes || [])].slice(0, 80);
  }
  if (entry.rejection) {
    memory.rejections = [{ at: record.at, ...entry.rejection }, ...(memory.rejections || [])].slice(0, 80);
  }
  return writeCreativeMemory(memory);
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
  memory.revisionHistory = [
    {
      at: entry.at || new Date().toISOString(),
      note: entry.note || entry.revisionNote || null,
      intents: entry.intents || [],
      project: entry.project || null,
    },
    ...(memory.revisionHistory || []),
  ].slice(0, 80);
  if (entry.preferences) {
    // Append-only history first, then update effective prefs — never wipe prior approved entries.
    memory.preferencesHistory = [
      {
        id: `pref_${Date.now().toString(36)}`,
        at: new Date().toISOString(),
        approved: false,
        kind: "revision_preference",
        payload: entry.preferences,
        note: entry.note || entry.revisionNote || null,
      },
      ...(memory.preferencesHistory || []),
    ].slice(0, 200);
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
