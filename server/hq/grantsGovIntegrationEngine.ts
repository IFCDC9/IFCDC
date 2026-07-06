/**
 * Grants.gov integration — public Applicant API (search2) probe, sync, Integrations Hub details.
 *
 * Official docs: https://grants.gov/api/api-guide
 * search2 and fetchOpportunity do NOT require authentication or an API key.
 */
import { getGrantFeedIntegrationStatus, syncGrantFeeds, countExternalFeedOpportunities } from "./grantFeedConnectors";

const SEARCH2_URL = "https://api.grants.gov/v1/api/search2";
const PROBE_TIMEOUT_MS = 8_000;
const DEFAULT_KEYWORD = "community development nonprofit";

export type GrantsGovIntegrationDetail = {
  label: string;
  value: string;
  status?: "success" | "warning" | "muted" | "danger";
};

export type GrantsGovProbeResult = {
  healthy: boolean;
  apiReachable: boolean;
  recordCount: number;
  latencyMs: number;
  message: string;
  httpStatus?: number;
  source?: "search2" | "none";
};

function optionalApiKey(): string | null {
  const key = (process.env.GRANTS_GOV_API_KEY || "").trim();
  return key || null;
}

function searchKeyword(): string {
  return (process.env.GRANTS_GOV_SEARCH_KEYWORD || DEFAULT_KEYWORD).trim();
}

function searchHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  const key = optionalApiKey();
  if (key) headers["X-Api-Key"] = key;
  return headers;
}

function searchBody(rows: number) {
  return JSON.stringify({
    rows,
    keyword: searchKeyword(),
    oppStatuses: "posted",
  });
}

function parseSearchHits(data: unknown): Record<string, unknown>[] {
  if (!data || typeof data !== "object") return [];
  const root = data as Record<string, unknown>;
  const nested = root.data as Record<string, unknown> | undefined;
  const hits =
    root.oppHits ??
    root.opportunities ??
    nested?.oppHits ??
    nested?.opportunities ??
    root.hits ??
    [];
  return Array.isArray(hits) ? (hits as Record<string, unknown>[]) : [];
}

/** Live POST to Grants.gov Search2 (public Applicant API — no credentials required). */
export async function probeGrantsGovApi(): Promise<GrantsGovProbeResult> {
  const started = Date.now();
  try {
    const res = await fetch(SEARCH2_URL, {
      method: "POST",
      headers: searchHeaders(),
      body: searchBody(10),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const latencyMs = Date.now() - started;

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        healthy: false,
        apiReachable: false,
        recordCount: 0,
        latencyMs,
        httpStatus: res.status,
        message: `Grants.gov Search2 returned ${res.status}${body ? `: ${body.slice(0, 120)}` : ""}`,
        source: "none",
      };
    }

    const data = await res.json();
    const hits = parseSearchHits(data);
    const count = hits.length;
    return {
      healthy: count > 0,
      apiReachable: true,
      recordCount: count,
      latencyMs,
      httpStatus: res.status,
      message:
        count > 0
          ? `Grants.gov Search2 connected (public API) · ${count} opportunities in probe`
          : "Grants.gov API reachable but returned zero opportunities — check search keyword",
      source: "search2",
    };
  } catch (err) {
    return {
      healthy: false,
      apiReachable: false,
      recordCount: 0,
      latencyMs: Date.now() - started,
      message: err instanceof Error ? err.message : "Grants.gov probe failed",
      source: "none",
    };
  }
}

export function resolveGrantsGovHubStatus(
  probe: GrantsGovProbeResult,
  feedConnected: boolean
): "connected" | "degraded" | "not_configured" {
  if (feedConnected && probe.healthy && probe.apiReachable) return "connected";
  if (probe.apiReachable && probe.recordCount > 0) return feedConnected ? "connected" : "degraded";
  if (probe.apiReachable) return "degraded";
  return "not_configured";
}

export async function buildGrantsGovDetails(
  probe: GrantsGovProbeResult,
  feed?: Awaited<ReturnType<typeof getGrantFeedIntegrationStatus>>["grantsGov"]
): Promise<GrantsGovIntegrationDetail[]> {
  const liveCount = await countExternalFeedOpportunities().catch(() => 0);
  return [
    {
      label: "API endpoint",
      value: "POST /v1/api/search2 (public)",
      status: probe.apiReachable ? "success" : "muted",
    },
    {
      label: "Authentication",
      value: "None required (Applicant API)",
      status: "success",
    },
    {
      label: "Search keyword",
      value: searchKeyword(),
      status: "muted",
    },
    {
      label: "Probe results",
      value: probe.recordCount > 0 ? `${probe.recordCount} opportunities` : "0 in probe",
      status: probe.recordCount > 0 ? "success" : "warning",
    },
    {
      label: "Live opportunities in HQ",
      value: String(liveCount),
      status: liveCount > 0 ? "success" : "warning",
    },
    {
      label: "Last feed sync",
      value: feed?.lastSync ? new Date(feed.lastSync).toLocaleString() : "Not synced yet",
      status: feed?.lastSync ? "success" : "warning",
    },
  ];
}

export async function testGrantsGovIntegrationLive() {
  const probe = await probeGrantsGovApi();

  let syncMessage = "";
  let feedConnected = false;
  if (probe.apiReachable) {
    const syncResults = await syncGrantFeeds({ providers: ["grants_gov"] });
    const grantsSync = syncResults.find((r) => r.provider === "grants_gov");
    feedConnected = grantsSync?.status === "connected";
    syncMessage = grantsSync
      ? `Sync: ${grantsSync.status} — ${grantsSync.imported} new, ${grantsSync.updated} updated`
      : "";
  }

  const feed = (await getGrantFeedIntegrationStatus()).grantsGov;
  const status = resolveGrantsGovHubStatus(probe, feedConnected || feed.status === "connected");
  const details = await buildGrantsGovDetails(probe, feed);
  const success = status === "connected";

  const { invalidateIntegrationsHubCache } = await import("./integrationsHubEngine");
  invalidateIntegrationsHubCache();

  return {
    success,
    message: [probe.message, syncMessage].filter(Boolean).join(" · "),
    provider: "grants_gov",
    status,
    testedAt: new Date().toISOString(),
    details,
    snapshot: {
      probeRecordCount: probe.recordCount,
      liveOpportunities: await countExternalFeedOpportunities().catch(() => 0),
      latencyMs: probe.latencyMs,
      feedStatus: feed.status,
      authRequired: false,
    },
  };
}

/** Parse Search2 hits for grant feed sync (shared with grantFeedConnectors). */
export function normalizeGrantsGovHits(hits: Record<string, unknown>[]) {
  return hits.map((hit) => {
    const id = String(hit.id ?? hit.opportunityId ?? hit.number ?? hit.oppId ?? "");
    return {
      external_id: id || `gg-${Date.now()}`,
      source_type: "grants_gov",
      import_status: "imported",
      title: String(hit.title ?? hit.opportunityTitle ?? "Federal Grant Opportunity"),
      funder: String(hit.agencyName ?? hit.agency ?? hit.agencyCode ?? "U.S. Federal Agency"),
      description: String(hit.description ?? hit.synopsis ?? hit.oppDescription ?? "").slice(0, 4000),
      amount_min: parseGrantAmount(hit.awardFloor ?? hit.estimatedFunding),
      amount_max: parseGrantAmount(hit.awardCeiling ?? hit.estimatedFunding),
      deadline: parseGrantDeadline(hit.closeDate ?? hit.applicationDueDate ?? hit.closeDateFormatted),
      url: String(
        hit.opportunityUrl ??
          hit.url ??
          (id ? `https://www.grants.gov/search-results-detail/${id}` : "https://www.grants.gov")
      ),
      funder_type: "federal",
      geography: "US",
      eligibility: String(hit.eligibility ?? hit.eligibilityCategory ?? "See opportunity listing"),
      requirements: String(hit.requirements ?? "Federal grant application requirements apply"),
      is_live: 1,
      is_national: 1,
    };
  });
}

function parseGrantAmount(raw: unknown): number | null {
  if (raw == null) return null;
  const n = Number(String(raw).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parseGrantDeadline(raw: unknown): string | null {
  if (!raw) return null;
  const d = new Date(String(raw));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Public Search2 — no API key required per Grants.gov API Guide. */
export async function searchGrantsGovLive(rows = 50) {
  const res = await fetch(SEARCH2_URL, {
    method: "POST",
    headers: searchHeaders(),
    body: searchBody(rows),
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Grants.gov Search2 ${res.status}${errText ? `: ${errText.slice(0, 200)}` : ""}`);
  }

  const data = await res.json();
  const hits = parseSearchHits(data);
  return { opps: normalizeGrantsGovHits(hits), source: "search2" as const };
}
