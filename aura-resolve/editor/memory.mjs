/**
 * Creative memory for AURA Resolve — IFCDC PRODUCTIONS global identity retained permanently.
 * Founder video-editing permanent rules are sourced from HQ creative memory when available.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "fs";
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

export { PRODUCTION_COMPANY, PRODUCTION_IDENTITY, PRODUCTION_CREDIT_LINE, MEMORY_PATH, ROOT as MEMORY_ROOT };

export const FOUNDER_VIDEO_EDITING_RULE_ID = "IFCDC_VIDEO_EDITING_FOUNDER_RULES_20260928";

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

/**
 * Merge HQ Founder video-editing permanent rules into local memory.
 * Does not wipe local file contents — HQ wins only for matching Founder rule ids.
 */
export function mergeHqFounderVideoEditingRules(memory, hqHits = []) {
  const next = normalize(memory || readCreativeMemory());
  const localRules = Array.isArray(next.permanentRules) ? [...next.permanentRules] : [];
  const applied = [];

  for (const hit of hqHits) {
    const rule = hit?.permanentRule;
    const ruleId = hit?.permanentRuleId || rule?.id;
    if (!rule || !ruleId) continue;
    const hqRule = {
      ...rule,
      id: ruleId,
      retainedPermanently: true,
      organizationWide: true,
      hqRecordId: hit.recordId || null,
      hqCreatedAt: hit.createdAt || null,
      hqSource: "aura_resolve_creative_memory",
      updatedAt: hit.createdAt || new Date().toISOString(),
    };
    const idx = localRules.findIndex((r) => r?.id === ruleId);
    if (idx >= 0) localRules[idx] = { ...localRules[idx], ...hqRule };
    else localRules.push(hqRule);
    applied.push({
      permanentRuleId: ruleId,
      recordId: hit.recordId || null,
      createdAt: hit.createdAt || null,
    });

    // Prefer HQ rule fields into effective preferences when present (does not wipe history).
    const rules = hqRule.rules && typeof hqRule.rules === "object" ? hqRule.rules : {};
    const prefPatch = {};
    if (rules.musicToPicture) prefPatch.musicToPicture = rules.musicToPicture;
    if (rules.watermarkCircularAlpha) prefPatch.watermarkCircularAlpha = rules.watermarkCircularAlpha;
    if (rules.framingFitFirst) {
      prefPatch.framingFitFirst = rules.framingFitFirst;
      prefPatch.framing = "fit-first-blur-pad-no-head-crop-no-stretch";
    }
    if (rules.storyStructure) prefPatch.structure = "beginning-development-ending";
    if (Object.keys(prefPatch).length) {
      next.preferences = { ...next.preferences, ...prefPatch };
    }
  }

  next.permanentRules = ensurePermanentRule(localRules);
  next.hqFounderRulesSync = {
    at: new Date().toISOString(),
    source: "aura_resolve_creative_memory",
    applied,
  };
  return { memory: next, applied };
}

/**
 * Pull Founder video-editing rules from HQ (node creative-memory API) and merge into local memory.
 * Preserves the local creative-memory.json file; HQ is source of truth for Founder editing rules.
 */
export async function loadEditingRulesFromHq(link, { fetchFn = fetch, timeoutMs = 8000 } = {}) {
  const localExisted = existsSync(MEMORY_PATH);
  const localStat = localExisted ? statSync(MEMORY_PATH) : null;
  const memoryBefore = readCreativeMemory();

  if (!link?.hqUrl || !link?.token || !link?.nodeId) {
    return {
      ok: false,
      error: "hq_link_missing",
      source: "local_only",
      memory: memoryBefore,
      applied: [],
      localPreserved: true,
      localPath: MEMORY_PATH,
      localExisted,
      localBytes: localStat?.size ?? null,
    };
  }

  const url = `${String(link.hqUrl).replace(/\/$/, "")}/api/hq/aura/resolve/node/creative-memory`;
  let body;
  try {
    const response = await fetchFn(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${link.token}`,
        "x-aura-resolve-node-id": link.nodeId,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      return {
        ok: false,
        error: `hq_creative_memory_${response.status}`,
        source: "local_only",
        memory: memoryBefore,
        applied: [],
        localPreserved: true,
        localPath: MEMORY_PATH,
        localExisted,
        hqUrl: url,
      };
    }
    body = await response.json();
  } catch (err) {
    return {
      ok: false,
      error: String(err?.message || err),
      source: "local_only",
      memory: memoryBefore,
      applied: [],
      localPreserved: true,
      localPath: MEMORY_PATH,
      localExisted,
      hqUrl: url,
    };
  }

  const hits = Array.isArray(body?.founderVideoEditingRules) ? body.founderVideoEditingRules : [];
  const { memory: merged, applied } = mergeHqFounderVideoEditingRules(memoryBefore, hits);
  // Preserve file: rewrite merged permanentRules/preferences only — full document kept otherwise.
  const written = writeCreativeMemory(merged);
  const afterStat = existsSync(MEMORY_PATH) ? statSync(MEMORY_PATH) : null;

  return {
    ok: true,
    source: "hq",
    hqUrl: url,
    memory: written,
    applied,
    founderVideoEditingRules: hits,
    creativeMemoryCount: Array.isArray(body?.creativeMemory) ? body.creativeMemory.length : 0,
    localPreserved: true,
    localPath: MEMORY_PATH,
    localExisted,
    localBytesBefore: localStat?.size ?? null,
    localBytesAfter: afterStat?.size ?? null,
    publish: false,
  };
}

/**
 * Session/edit start: keep company identity local, then pull Founder editing rules from HQ.
 */
export async function ensureEditingMemoryWithHq(link, opts = {}) {
  ensureCompanyMemory();
  return loadEditingRulesFromHq(link, opts);
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
