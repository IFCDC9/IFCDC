/**
 * Phase 7 — Legacy AURA :4101 observability + reversible disable switch.
 *
 * Production HQ AURA uses in-process OpenAI via server/lib/ifcdc.ts
 * (auraExecutiveChat / auraReceptionistChat / @ifcdc/aura-ai package).
 * The aura-ai-core microservice on :4101 is NOT on the executive path.
 *
 * Env:
 *   AURA_LEGACY_4101_PROBE=true  — still probe IFCDC_AURA_URL / :4101 health (observability)
 *   AURA_LEGACY_4101_ENABLED=true — allow Shared SDK / core service to treat :4101 as active
 *   IFCDC_AURA_URL — explicit legacy base URL (default http://localhost:4101)
 *
 * Defaults (production-safe): do NOT probe or require :4101.
 */
export type Legacy4101AccessRecord = {
  id: string;
  at: string;
  source: string;
  route: string;
  environment: string;
  caller?: string | null;
  result: "skipped" | "ok" | "fail" | "blocked" | "deprecated_call";
  detail?: string;
  url?: string;
};

const MEMORY_CAP = 200;
const recent: Legacy4101AccessRecord[] = [];

export function getLegacyAuraUrl(): string {
  return (process.env.IFCDC_AURA_URL || "http://localhost:4101").replace(/\/$/, "");
}

/** True when callers should still probe the legacy microservice. */
export function shouldProbeLegacy4101(): boolean {
  const raw = (process.env.AURA_LEGACY_4101_PROBE || "").trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "yes") return true;
  // Explicit IFCDC_AURA_URL in non-default host may indicate intentional legacy use
  const url = (process.env.IFCDC_AURA_URL || "").trim();
  if (!url) return false;
  if (/localhost:4101|127\.0\.0\.1:4101/i.test(url)) return false;
  return (process.env.AURA_LEGACY_4101_ENABLED || "").trim().toLowerCase() === "true";
}

/** True when legacy core/service chat path is considered enabled (rollback switch). */
export function isLegacy4101Enabled(): boolean {
  return (process.env.AURA_LEGACY_4101_ENABLED || "").trim().toLowerCase() === "true";
}

export function recordLegacy4101Access(opts: {
  source: string;
  route: string;
  result: Legacy4101AccessRecord["result"];
  caller?: string | null;
  detail?: string;
  url?: string;
}): Legacy4101AccessRecord {
  const entry: Legacy4101AccessRecord = {
    id: `l4101_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    source: opts.source,
    route: opts.route,
    environment: process.env.NODE_ENV || "development",
    caller: opts.caller ?? null,
    result: opts.result,
    detail: opts.detail,
    url: opts.url || getLegacyAuraUrl(),
  };
  recent.unshift(entry);
  if (recent.length > MEMORY_CAP) recent.length = MEMORY_CAP;

  const line =
    `[aura-legacy-4101] ${entry.at} source=${entry.source} route=${entry.route}`
    + ` env=${entry.environment} result=${entry.result}`
    + (entry.caller ? ` caller=${entry.caller}` : "")
    + (entry.detail ? ` detail=${entry.detail}` : "");
  if (entry.result === "ok" || entry.result === "skipped") {
    console.info(line);
  } else {
    console.warn(line);
  }
  return entry;
}

export function listLegacy4101Access(limit = 50): Legacy4101AccessRecord[] {
  return recent.slice(0, Math.max(1, Math.min(limit, MEMORY_CAP)));
}

export function getLegacy4101Summary(): {
  deprecated: true;
  productionPath: string;
  probeEnabled: boolean;
  legacyEnabled: boolean;
  legacyUrl: string;
  recentAccessCount: number;
  lastAccess: Legacy4101AccessRecord | null;
  rollback: string;
} {
  return {
    deprecated: true,
    productionPath: "HQ in-process OpenAI via /api/hq/aura/* (auraCommandLayer + ifcdc.ts)",
    probeEnabled: shouldProbeLegacy4101(),
    legacyEnabled: isLegacy4101Enabled(),
    legacyUrl: getLegacyAuraUrl(),
    recentAccessCount: recent.length,
    lastAccess: recent[0] || null,
    rollback:
      "Set AURA_LEGACY_4101_ENABLED=true and AURA_LEGACY_4101_PROBE=true, restart aura-ai-core on :4101. Tag: phase6-acceptance / pre-phase7-hardening.",
  };
}
