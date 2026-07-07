/** Production policy for Grant Center demo seeds and static reference feeds. */

export function allowGrantDemoSeed(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.ALLOW_DEMO_SEED === "true";
}

/** HQ-wide demo/sample boot data (finance, operations, analytics fallbacks). */
export function allowHqDemoSeed(): boolean {
  return allowGrantDemoSeed();
}

export function isProductionHq(): boolean {
  return process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "true";
}

/** Curated CSR program URLs — reference only, not live grant listings. */
export function allowStaticCsrFeedSync(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.ALLOW_STATIC_CSR_FEED === "true";
}

/** RSS fallback for Grants.gov — disabled in production unless explicitly allowed. */
export function allowGrantsGovRssFallback(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.ALLOW_GRANTS_GOV_RSS_FALLBACK === "true";
}

/** SQL fragment excluding demo/seed rows in production. Pass alias when the table is aliased (e.g. "o"). */
export function productionGrantOpportunitySqlFilter(alias?: string): string {
  if (process.env.NODE_ENV !== "production") return "";
  const prefix = alias ? `${alias}.` : "";
  return ` AND ${prefix}source_type != 'dev_seed' AND COALESCE(${prefix}import_status, '') NOT IN ('seed', 'static')`;
}
