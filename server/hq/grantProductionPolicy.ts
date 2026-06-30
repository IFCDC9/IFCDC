/** Production policy for Grant Center demo seeds and static reference feeds. */

export function allowGrantDemoSeed(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.ALLOW_DEMO_SEED === "true";
}

/** Curated CSR program URLs — reference only, not live grant listings. */
export function allowStaticCsrFeedSync(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.ALLOW_STATIC_CSR_FEED === "true";
}
