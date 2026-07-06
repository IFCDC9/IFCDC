/**
 * Grant Center — live external feed connectors.
 * Syncs federal, foundation, and corporate opportunities into grant_opportunities.
 */
import { getDb } from "../db";
import { grantId } from "./grantsSchema";
import { allowStaticCsrFeedSync, allowGrantsGovRssFallback } from "./grantProductionPolicy";

export type GrantFeedProvider = "grants_gov" | "sam_gov" | "foundation_directory" | "corporate_csr";

export interface NormalizedGrantOpportunity {
  external_id: string;
  source_type: string;
  import_status?: string;
  title: string;
  funder: string;
  description: string;
  amount_min: number | null;
  amount_max: number | null;
  deadline: string | null;
  url: string;
  funder_type: string;
  geography: string;
  eligibility: string;
  requirements: string;
  is_live: number;
  is_national: number;
}

export interface FeedSyncResult {
  provider: GrantFeedProvider;
  status: "connected" | "error" | "skipped";
  imported: number;
  updated: number;
  error?: string;
  syncedAt: string;
}

export async function ensureGrantFeedSyncTables(): Promise<void> {
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS grant_feed_sync (
      provider TEXT PRIMARY KEY,
      last_sync_at TEXT,
      last_status TEXT,
      records_imported INTEGER DEFAULT 0,
      error_message TEXT
    );
  `);
}

async function recordFeedSync(provider: GrantFeedProvider, result: Omit<FeedSyncResult, "provider" | "syncedAt">): Promise<void> {
  await ensureGrantFeedSyncTables();
  const db = await getDb();
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO grant_feed_sync (provider, last_sync_at, last_status, records_imported, error_message)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(provider) DO UPDATE SET
       last_sync_at = excluded.last_sync_at,
       last_status = excluded.last_status,
       records_imported = excluded.records_imported,
       error_message = excluded.error_message`,
    provider,
    now,
    result.status,
    result.imported,
    result.error ?? null
  );
}

async function upsertFeedOpportunity(opp: NormalizedGrantOpportunity): Promise<"inserted" | "updated" | "skipped"> {
  const db = await getDb();
  const existing = await db.get<{ id: string }>(
    "SELECT id FROM grant_opportunities WHERE source_type = ? AND external_id = ?",
    opp.source_type,
    opp.external_id
  );
  const now = new Date().toISOString();
  if (existing) {
    await db.run(
      `UPDATE grant_opportunities SET title = ?, funder = ?, description = ?, amount_min = ?, amount_max = ?,
       deadline = ?, url = ?, funder_type = ?, geography = ?, eligibility = ?, requirements = ?,
       is_live = ?, is_national = ?, import_status = ?, last_verified_at = ?, updated_at = ?, status = 'open'
       WHERE id = ?`,
      opp.title,
      opp.funder,
      opp.description,
      opp.amount_min,
      opp.amount_max,
      opp.deadline,
      opp.url,
      opp.funder_type,
      opp.geography,
      opp.eligibility,
      opp.requirements,
      opp.is_live,
      opp.is_national,
      opp.import_status ?? "imported",
      now,
      now,
      existing.id
    );
    return "updated";
  }
  await db.run(
    `INSERT INTO grant_opportunities (
       id, title, funder, description, amount_min, amount_max, status, deadline, url, requirements,
       source_type, external_id, import_status, funder_type, geography, eligibility, is_live, is_national,
       posted_date, last_verified_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    grantId(),
    opp.title,
    opp.funder,
    opp.description,
    opp.amount_min,
    opp.amount_max,
    opp.deadline,
    opp.url,
    opp.requirements,
    opp.source_type,
    opp.external_id,
    opp.import_status ?? "imported",
    opp.funder_type,
    opp.geography,
    opp.eligibility,
    opp.is_live,
    opp.is_national,
    now,
    now,
    now,
    now
  );
  return "inserted";
}

async function importBatch(opps: NormalizedGrantOpportunity[]): Promise<{ imported: number; updated: number }> {
  let imported = 0;
  let updated = 0;
  for (const opp of opps) {
    const result = await upsertFeedOpportunity(opp);
    if (result === "inserted") imported++;
    else if (result === "updated") updated++;
  }
  return { imported, updated };
}

function parseAmount(raw: unknown): number | null {
  if (raw == null) return null;
  const n = Number(String(raw).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parseDeadline(raw: unknown): string | null {
  if (!raw) return null;
  const d = new Date(String(raw));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Grants.gov Search2 — public Applicant API (no API key required) */
async function fetchGrantsGovFeed(): Promise<NormalizedGrantOpportunity[]> {
  const { searchGrantsGovLive } = await import("./grantsGovIntegrationEngine");
  try {
    const { opps, source } = await searchGrantsGovLive(50);
    if (opps.length > 0) {
      console.info(`[grants-gov] Search2 sync: ${opps.length} opportunities (${source})`);
      return opps;
    }
    if (process.env.NODE_ENV === "production") {
      console.warn("[grants-gov] Search2 returned zero opportunities in production");
      return [];
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[grants-gov] Search2 failed:", msg);
    if (process.env.NODE_ENV === "production" || !allowGrantsGovRssFallback()) {
      throw new Error(msg);
    }
  }

  if (!allowGrantsGovRssFallback()) {
    return [];
  }

  try {
    const rss = await fetch("https://www.grants.gov/rss/GGrants.xml", { signal: AbortSignal.timeout(15000) });
    if (!rss.ok) return [];
    const xml = await rss.text();
    const items = Array.from(xml.matchAll(/<item>([\s\S]*?)<\/item>/gi));
    console.info(`[grants-gov] RSS fallback: ${items.length} items (non-production)`);
    return items.slice(0, 40).map((match, idx) => {
      const block = match[1] ?? "";
      const title = block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/i)?.[1]
        ?? block.match(/<title>(.*?)<\/title>/i)?.[1]
        ?? `Federal Opportunity ${idx + 1}`;
      const link = block.match(/<link>(.*?)<\/link>/i)?.[1] ?? "https://www.grants.gov";
      const desc = block.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/i)?.[1]
        ?? block.match(/<description>(.*?)<\/description>/i)?.[1]
        ?? "";
      const guid = block.match(/<guid.*?>(.*?)<\/guid>/i)?.[1] ?? link;
      return {
        external_id: guid.slice(0, 120),
        source_type: "grants_gov",
        import_status: "rss_fallback",
        title: title.replace(/<[^>]+>/g, "").trim(),
        funder: "U.S. Federal Agency (Grants.gov RSS)",
        description: desc.replace(/<[^>]+>/g, "").slice(0, 4000),
        amount_min: null,
        amount_max: null,
        deadline: null,
        url: link.trim(),
        funder_type: "federal",
        geography: "US",
        eligibility: "See Grants.gov listing",
        requirements: "Federal application requirements",
        is_live: 0,
        is_national: 1,
      };
    });
  } catch {
    return [];
  }
}

/** ProPublica nonprofit search — foundation grant programs */
async function fetchFoundationDirectoryFeed(): Promise<NormalizedGrantOpportunity[]> {
  try {
    const res = await fetch(
      "https://projects.propublica.org/nonprofits/api/v2/search.json?q=community+foundation+grant&page=0",
      { signal: AbortSignal.timeout(15000) }
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { organizations?: Record<string, unknown>[] };
    return (data.organizations ?? []).slice(0, 25).map((org) => {
      const ein = String(org.ein ?? org.organization_id ?? grantId());
      const name = String(org.name ?? "Private Foundation");
      return {
        external_id: `prop-${ein}`,
        source_type: "foundation_directory",
        import_status: "imported",
        title: `${name} — Foundation profile`,
        funder: name,
        description: `Public 990 nonprofit record (${String(org.city ?? "")} ${String(org.state ?? "")}). Verify open grant programs directly with the foundation — this is not an active RFP listing.`.trim(),
        amount_min: null,
        amount_max: parseAmount(org.gross_receipts ?? org.income_amount),
        deadline: null,
        url: `https://projects.propublica.org/nonprofits/organizations/${ein}`,
        funder_type: "foundation",
        geography: String(org.state ?? "US"),
        eligibility: "501(c)(3) organizations — verify grant programs with funder",
        requirements: "Contact foundation for current LOI or application guidelines",
        is_live: 0,
        is_national: 0,
      };
    });
  } catch {
    return [];
  }
}

/** Curated corporate CSR reference programs — not live grant listings. */
async function fetchCorporateCsrFeed(): Promise<NormalizedGrantOpportunity[]> {
  const programs: NormalizedGrantOpportunity[] = [
    {
      external_id: "csr-walmart-foundation",
      source_type: "corporate_csr",
      import_status: "static",
      title: "Walmart Foundation Community Grant Program (reference)",
      funder: "Walmart Foundation",
      description: "Community grants for hunger relief, workforce development, and disaster response.",
      amount_min: 25000,
      amount_max: 250000,
      deadline: null,
      url: "https://walmart.org/how-we-give/local-community-grants",
      funder_type: "corporate",
      geography: "US",
      eligibility: "Registered 501(c)(3) organizations",
      requirements: "Online application via Walmart Foundation portal",
      is_live: 0,
      is_national: 1,
    },
    {
      external_id: "csr-target-circle",
      source_type: "corporate_csr",
      import_status: "static",
      title: "Target Foundation Community Grants (reference)",
      funder: "Target Corporation",
      description: "Grants supporting economic opportunity, education, and community development.",
      amount_min: 10000,
      amount_max: 200000,
      deadline: null,
      url: "https://corporate.target.com/sustainability-governance/community-impact",
      funder_type: "corporate",
      geography: "US",
      eligibility: "501(c)(3) nonprofits in Target communities",
      requirements: "Invitation or open RFP per cycle",
      is_live: 0,
      is_national: 1,
    },
    {
      external_id: "csr-google-org",
      source_type: "corporate_csr",
      import_status: "static",
      title: "Google.org Impact Challenge (reference)",
      funder: "Google.org",
      description: "Technology and innovation grants for nonprofits addressing community challenges.",
      amount_min: 50000,
      amount_max: 1000000,
      deadline: null,
      url: "https://www.google.org/",
      funder_type: "corporate",
      geography: "US",
      eligibility: "Nonprofits with scalable impact models",
      requirements: "Application during open challenge cycles",
      is_live: 0,
      is_national: 1,
    },
    {
      external_id: "csr-bankofamerica",
      source_type: "corporate_csr",
      import_status: "static",
      title: "Bank of America Neighborhood Builders (reference)",
      funder: "Bank of America Charitable Foundation",
      description: "Leadership development and capacity-building grants for high-impact nonprofits.",
      amount_min: 200000,
      amount_max: 200000,
      deadline: null,
      url: "https://about.bankofamerica.com/en/making-an-impact/neighborhood-builders",
      funder_type: "corporate",
      geography: "US",
      eligibility: "501(c)(3) with strong leadership pipeline",
      requirements: "Nomination and application process",
      is_live: 0,
      is_national: 1,
    },
  ];
  return programs;
}

/** SAM.gov entity verification status (org readiness, not opportunities) */
async function syncSamGovStatus(): Promise<FeedSyncResult> {
  const uei = process.env.SAM_GOV_UEI ?? process.env.IFCDC_SAM_UEI;
  const syncedAt = new Date().toISOString();
  if (!uei) {
    const result = { status: "skipped" as const, imported: 0, updated: 0, error: "SAM_GOV_UEI not configured" };
    await recordFeedSync("sam_gov", result);
    return { provider: "sam_gov", ...result, syncedAt };
  }
  try {
    const apiKey = process.env.SAM_GOV_API_KEY;
    if (!apiKey) {
      const result = { status: "skipped" as const, imported: 0, updated: 0, error: "SAM_GOV_API_KEY not configured" };
      await recordFeedSync("sam_gov", result);
      return { provider: "sam_gov", ...result, syncedAt };
    }
    const url = `https://api.sam.gov/entity-information/v3/entities?ueiSAM=${encodeURIComponent(uei)}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { "X-Api-Key": apiKey },
    });
    const ok = res.ok;
    const result = {
      status: ok ? ("connected" as const) : ("error" as const),
      imported: ok ? 1 : 0,
      updated: 0,
      error: ok ? undefined : `SAM.gov API ${res.status}`,
    };
    await recordFeedSync("sam_gov", result);
    return { provider: "sam_gov", ...result, syncedAt };
  } catch (err) {
    const result = {
      status: "error" as const,
      imported: 0,
      updated: 0,
      error: err instanceof Error ? err.message : "SAM.gov sync failed",
    };
    await recordFeedSync("sam_gov", result);
    return { provider: "sam_gov", ...result, syncedAt };
  }
}

async function syncProvider(
  provider: GrantFeedProvider,
  fetcher: () => Promise<NormalizedGrantOpportunity[]>,
  opts?: { staticReference?: boolean }
): Promise<FeedSyncResult> {
  const syncedAt = new Date().toISOString();
  try {
    const opps = await fetcher();
    const { imported, updated } = await importBatch(opps);
    const hasRecords = imported + updated > 0;
    const status = hasRecords ? ("connected" as const) : ("error" as const);
    const result = {
      status,
      imported,
      updated,
      error: hasRecords
        ? opts?.staticReference
          ? "Curated reference data — verify cycles with each funder"
          : undefined
        : "No opportunities returned from feed",
    };
    await recordFeedSync(provider, result);
    return { provider, ...result, syncedAt };
  } catch (err) {
    const result = {
      status: "error" as const,
      imported: 0,
      updated: 0,
      error: err instanceof Error ? err.message : "Sync failed",
    };
    await recordFeedSync(provider, result);
    return { provider, ...result, syncedAt };
  }
}

export async function syncGrantFeeds(opts?: { providers?: GrantFeedProvider[] }): Promise<FeedSyncResult[]> {
  await ensureGrantFeedSyncTables();
  const defaultProviders: GrantFeedProvider[] = ["grants_gov", "foundation_directory"];
  if (allowStaticCsrFeedSync()) {
    defaultProviders.push("corporate_csr");
  }
  const providers = opts?.providers ?? defaultProviders;
  const results: FeedSyncResult[] = [];

  if (providers.includes("grants_gov")) {
    results.push(await syncProvider("grants_gov", fetchGrantsGovFeed));
  }
  if (providers.includes("foundation_directory")) {
    results.push(await syncProvider("foundation_directory", fetchFoundationDirectoryFeed));
  }
  if (providers.includes("corporate_csr")) {
    results.push(await syncProvider("corporate_csr", fetchCorporateCsrFeed, { staticReference: true }));
  }
  if (providers.includes("sam_gov")) {
    results.push(await syncSamGovStatus());
  }
  return results;
}

export async function getGrantFeedIntegrationStatus(): Promise<
  Record<string, { status: string; label: string; note: string; lastSync?: string; records?: number }>
> {
  await ensureGrantFeedSyncTables();
  const db = await getDb();
  const rows = await db.all("SELECT * FROM grant_feed_sync");
  const byProvider = Object.fromEntries(rows.map((r: { provider: string }) => [r.provider, r]));

  function statusFor(provider: GrantFeedProvider, label: string, defaultNote: string) {
    const row = byProvider[provider] as { last_status?: string; last_sync_at?: string; records_imported?: number; error_message?: string } | undefined;
    const connected = row?.last_status === "connected";
    return {
      status: connected ? "connected" : row?.last_status === "skipped" ? "configured" : row ? "syncing" : "pending",
      label,
      note: connected
        ? `Last sync ${row?.last_sync_at?.slice(0, 10) ?? "recent"} — ${row?.records_imported ?? 0} records`
        : row?.error_message ?? defaultNote,
      lastSync: row?.last_sync_at,
      records: row?.records_imported,
    };
  }

  return {
    grantsGov: statusFor("grants_gov", "Grants.gov", "Federal opportunity feed"),
    samGov: statusFor("sam_gov", "SAM.gov", "Entity verification"),
    foundationDirectory: statusFor("foundation_directory", "Foundation Directory", "990 nonprofit profiles — verify grant programs with each funder"),
    corporateGrants: statusFor("corporate_csr", "Corporate CSR Reference", "Curated program links — not live grant listings"),
  };
}

export async function countExternalFeedOpportunities(): Promise<number> {
  const db = await getDb();
  return (
    (await db.get<{ c: number }>(
      `SELECT COUNT(*) as c FROM grant_opportunities
       WHERE source_type = 'grants_gov'
         AND import_status = 'imported'
         AND COALESCE(is_live, 0) = 1`
    ))?.c ?? 0
  );
}
