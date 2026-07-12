/** Production policy for Grant Center demo seeds and static reference feeds. */

/** Explicit opt-in only — never implied by NODE_ENV=development alone. */
export function allowGrantDemoSeed(): boolean {
  return process.env.ALLOW_DEMO_SEED === "true";
}

/** HQ-wide demo/sample boot data (finance, operations, analytics fallbacks). */
export function allowHqDemoSeed(): boolean {
  return allowGrantDemoSeed();
}

export function isProductionHq(): boolean {
  return process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "true";
}

/** Curated CSR program URLs — reference only. Explicit opt-in required. */
export function allowStaticCsrFeedSync(): boolean {
  return process.env.ALLOW_STATIC_CSR_FEED === "true";
}

/** RSS fallback for Grants.gov — explicit opt-in required. */
export function allowGrantsGovRssFallback(): boolean {
  return process.env.ALLOW_GRANTS_GOV_RSS_FALLBACK === "true";
}

/**
 * SQL fragment excluding demo/seed/static/rss rows from live ranking.
 * Always applied unless ALLOW_DEMO_SEED=true.
 * Prefer live Grants.gov imports (is_live=1 or source_type=grants_gov).
 */
export function productionGrantOpportunitySqlFilter(alias?: string): string {
  const prefix = alias ? `${alias}.` : "";
  if (allowGrantDemoSeed()) {
    return ` AND ${prefix}source_type != 'dev_seed' AND COALESCE(${prefix}import_status, '') != 'seed'`;
  }
  return ` AND ${prefix}source_type NOT IN ('dev_seed')
    AND COALESCE(${prefix}import_status, '') NOT IN ('seed', 'static', 'rss_fallback')
    AND (COALESCE(${prefix}is_live, 0) = 1 OR ${prefix}source_type = 'grants_gov')`;
}

/** True when an opportunity row is considered a live funding source for AURA ranking. */
export function isLiveGrantOpportunity(row: {
  source_type?: string | null;
  import_status?: string | null;
  is_live?: number | null;
}): boolean {
  const source = String(row.source_type ?? "");
  const status = String(row.import_status ?? "");
  if (source === "dev_seed" || status === "seed" || status === "static" || status === "rss_fallback") return false;
  if (allowGrantDemoSeed()) return source !== "dev_seed";
  return Number(row.is_live ?? 0) === 1 || source === "grants_gov";
}
