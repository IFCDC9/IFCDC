/**
 * Phase 7 — cost-aware generation ledger.
 * Records provider/model/credits when the API reports them. Never regenerates without a reason.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { randomBytes } from "crypto";

const ROOT = join(homedir(), "Library/Application Support/IFCDC/aura-resolve");
const LEDGER_PATH = join(ROOT, "IFCDC-PRODUCTIONS", "cost-ledger.json");

function ensure() {
  mkdirSync(join(ROOT, "IFCDC-PRODUCTIONS"), { recursive: true });
  if (!existsSync(LEDGER_PATH)) {
    writeFileSync(
      LEDGER_PATH,
      JSON.stringify(
        {
          version: 1,
          company: "IFCDC PRODUCTIONS",
          phase: 7,
          entries: [],
          totalsByProvider: {},
        },
        null,
        2,
      ),
    );
  }
}

export function readCostLedger() {
  ensure();
  try {
    return JSON.parse(readFileSync(LEDGER_PATH, "utf8"));
  } catch {
    return { version: 1, company: "IFCDC PRODUCTIONS", phase: 7, entries: [], totalsByProvider: {} };
  }
}

function writeLedger(doc) {
  ensure();
  writeFileSync(LEDGER_PATH, JSON.stringify(doc, null, 2));
  return doc;
}

/**
 * Append a cost/credit entry. credits/cost only when API metadata reports them.
 */
export function recordCostEntry({
  provider,
  model = null,
  credits = null,
  cost = null,
  purpose,
  project,
  capability = null,
  accepted = null,
  rejected = null,
  reason = null,
  reuse = false,
  metadata = null,
} = {}) {
  const ledger = readCostLedger();
  const entry = {
    id: `cost_${Date.now().toString(36)}_${randomBytes(2).toString("hex")}`,
    at: new Date().toISOString(),
    provider: provider || "unknown",
    model,
    credits: credits == null ? null : Number(credits),
    cost: cost == null ? null : Number(cost),
    purpose: purpose || "generation",
    project: project || null,
    capability,
    accepted: accepted === true,
    rejected: rejected === true,
    reason,
    reuse: Boolean(reuse),
    // Strip anything that looks secret-ish from metadata
    metadata: sanitizeMeta(metadata),
    publish: false,
  };
  ledger.entries = [entry, ...(ledger.entries || [])].slice(0, 200);
  const key = entry.provider;
  if (!ledger.totalsByProvider[key]) ledger.totalsByProvider[key] = { credits: 0, calls: 0, reuse: 0 };
  ledger.totalsByProvider[key].calls += 1;
  if (entry.reuse) ledger.totalsByProvider[key].reuse += 1;
  if (entry.credits != null && Number.isFinite(entry.credits)) {
    ledger.totalsByProvider[key].credits += entry.credits;
  }
  writeLedger(ledger);
  return entry;
}

function sanitizeMeta(meta) {
  if (!meta || typeof meta !== "object") return null;
  const out = {};
  for (const [k, v] of Object.entries(meta)) {
    if (/key|token|secret|password|authorization|apiKey/i.test(k)) continue;
    if (typeof v === "string" && v.length > 500) out[k] = `${v.slice(0, 500)}…`;
    else out[k] = v;
  }
  return out;
}

export function creditsUsedForProject(project) {
  const ledger = readCostLedger();
  const entries = (ledger.entries || []).filter((e) => e.project === project && !e.reuse);
  const runway = entries
    .filter((e) => /runway/i.test(String(e.provider || "")))
    .reduce((sum, e) => sum + (Number(e.credits) || 0), 0);
  return {
    project,
    runwayCredits: runway,
    entries: entries.slice(0, 20),
    RUNWAY_CREDITS_USED: runway,
  };
}

/**
 * Refuse regeneration unless an explicit reason is supplied.
 */
export function assertRegenerationAllowed({ reason, priorAccepted } = {}) {
  if (priorAccepted && !reason) {
    return {
      ok: false,
      blocker: "REGENERATION_REFUSED_NO_REASON",
      message: "Do not regenerate an accepted asset without an explicit reason",
    };
  }
  return { ok: true };
}
