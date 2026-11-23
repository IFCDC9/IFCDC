/**
 * SAM.gov probe gating + HQ vs GSA rate-limit classification.
 * Auto probes (hub page-load, startup verify, startup-retry, watchdog, evidence)
 * must never call api.sam.gov. Founder Test Connection is the only force path.
 *
 * HQ limiter (server/middleware/hqSecurity.ts, 300 req / 60s) JSON:
 *   { error: "Too many requests. Please try again shortly." }
 * That is not SAM.gov. Distinct copy; classify HQ_RATE_LIMITED.
 *
 * GSA api.sam.gov (WSO2-style) JSON on quota exhaustion:
 *   { code: "900804", message: "Message throttled out",
 *     description: "You have exceeded your quota. You can access API after … 00:00:00+0000 UTC" }
 * Cited: open.gsa.gov Entity Management API rate-limit table; FSD KB0017604 daily
 * per-key tiers. 429 bodies name next access at 00:00:00+0000 UTC (next UTC day),
 * often ~24h from the prior UTC midnight — not HQ's 60s window.
 * Founder may run one Test Connection after that UTC reset, not the same ET calendar morning.
 * Classify as RATE_LIMITED, never AUTH_FAILED. No auto-retry loop.
 *
 * Hub cache: lastError = last probe message, connected = live.ok only. In-memory only.
 * Do not write production DB from the cache-reset helper.
 */

export const HQ_API_LIMITER_MESSAGE = "Too many requests. Please try again shortly.";
export const GSA_THROTTLE_MESSAGE = "Message throttled out";

export type SamLiveProbeSnapshot = {
  ok: boolean;
  message: string;
  latencyMs: number;
  uei: string | null;
  apiKeySet: boolean;
  httpStatus?: number;
  legalBusinessName?: string;
};

type SamProbeGate = {
  last: SamLiveProbeSnapshot | null;
  skipLiveUntilForced: boolean;
};

const gate: SamProbeGate = {
  last: null,
  // Auto paths never hit GSA. Cold boot / hub GET / watchdog skip until Founder Test Connection.
  skipLiveUntilForced: true,
};

export function isHqLimiterMessage(message: string): boolean {
  return /too many requests\. please try again shortly\.?/i.test(message || "");
}

export function isGsaThrottleMessage(message: string): boolean {
  const m = message || "";
  if (/message throttled out/i.test(m)) return true;
  if (/\b900804\b/.test(m)) return true;
  return false;
}

/** True when a live SAM call should not be auto-retried (401, 429, GSA throttle, HQ limiter). */
export function shouldAutoRetrySam(opts: { httpStatus?: number; message?: string }): boolean {
  const status = opts.httpStatus;
  if (status === 401 || status === 403 || status === 429) return false;
  const m = opts.message || "";
  if (isGsaThrottleMessage(m)) return false;
  if (isHqLimiterMessage(m)) return false;
  if (/\b401\b/.test(m) || /\b429\b/.test(m)) return false;
  return true;
}

export function shouldStartupRetryCard(card: { id: string; health?: { message?: string }; status?: string }): boolean {
  // Hub GET / startup / watchdog must never force SAM Test Connection.
  if (card.id === "sam_gov") return false;
  return true;
}

/**
 * HQ limiter copy vs GSA throttle vs other probe errors.
 * GSA "Message throttled out" is RATE_LIMITED even when the HTTP status is 401.
 */
export function classifyIntegrationError(message: string): string | undefined {
  const m = message || "";
  if (isGsaThrottleMessage(m)) return "RATE_LIMITED";
  if (isHqLimiterMessage(m)) return "HQ_RATE_LIMITED";
  if (/timeout/i.test(m)) return "TIMEOUT";
  if (/429|rate.?limit/i.test(m)) return "RATE_LIMITED";
  if (/401|unauthorized|auth failed/i.test(m)) return "AUTH_FAILED";
  if (/403|forbidden/i.test(m)) return "FORBIDDEN";
  if (/404|not found/i.test(m)) return "NOT_FOUND";
  if (/5\d\d|server error/i.test(m)) return "UPSTREAM_5XX";
  if (/missing|not configured|not set/i.test(m)) return "CONFIG_MISSING";
  if (/dns|domain|unverified/i.test(m)) return "DNS_OR_DOMAIN";
  if (/throttl/i.test(m)) return "RATE_LIMITED";
  return undefined;
}

export function inferRootCauseForCode(message: string, errorCode?: string): string | undefined {
  if (errorCode === "CONFIG_MISSING") return "Required Render environment variable is unset";
  if (errorCode === "AUTH_FAILED") return "API credentials rejected by provider";
  if (errorCode === "TIMEOUT") return "Provider did not respond within probe budget";
  if (errorCode === "DNS_OR_DOMAIN") return "Sender/domain authentication incomplete";
  if (errorCode === "RATE_LIMITED") return "GSA / SAM.gov throttled HQ probes (Message throttled out)";
  if (errorCode === "HQ_RATE_LIMITED") return "HQ API limiter — not SAM.gov";
  if (!message) return undefined;
  return message.slice(0, 180);
}

export function gsaBodyLooksThrottled(bodyMessage: string): boolean {
  return (
    isGsaThrottleMessage(bodyMessage)
    || /\b900804\b/.test(bodyMessage || "")
    || /exceeded your quota/i.test(bodyMessage || "")
    || /^throttl/i.test(bodyMessage || "")
  );
}

export function hubSamCacheFields(live: { ok?: boolean; message?: string } | null): {
  lastError: string | null;
  connected: boolean;
} {
  const connected = Boolean(live?.ok);
  return {
    lastError: connected ? null : live?.message || null,
    connected,
  };
}

export function rememberSamLiveResult(result: SamLiveProbeSnapshot): void {
  gate.last = result;
  // Keep auto probes gated even after a successful Founder Test Connection so
  // hub page-load and boot cannot spend GSA daily quota. Only force:true hits SAM.
  gate.skipLiveUntilForced = true;
}

export function shouldSkipLiveSamProbe(force?: boolean): boolean {
  if (force) return false;
  return true;
}

export function getLastSamProbe(): SamLiveProbeSnapshot | null {
  return gate.last;
}

/** Clear lastError for UI without calling SAM. Keep skip-live so page-load cannot re-hammer GSA. */
export function resetSamGovStatusCache(): {
  ok: true;
  samCalled: false;
  lastError: null;
  skipLiveUntilForced: boolean;
  connected: false;
} {
  gate.skipLiveUntilForced = true;
  gate.last = {
    ok: false,
    message: "Status cleared. Wait for the GSA throttle window, then use Test Connection once.",
    latencyMs: 0,
    uei: gate.last?.uei ?? null,
    apiKeySet: gate.last?.apiKeySet ?? false,
  };
  return {
    ok: true,
    samCalled: false,
    lastError: null,
    skipLiveUntilForced: true,
    connected: false,
  };
}

/** Test helper — do not use in production routes except tests. */
export function resetSamGovProbeGateForTests(): void {
  gate.last = null;
  gate.skipLiveUntilForced = false;
}

export function samHubStatusFromLive(
  live: { ok: boolean } | null,
  credentialsReady: boolean,
): "connected" | "degraded" | "not_configured" {
  if (live?.ok) return "connected";
  if (credentialsReady) return "degraded";
  return "not_configured";
}

export function skippedSamProbeResult(cached: SamLiveProbeSnapshot | null): SamLiveProbeSnapshot {
  if (!cached) {
    return {
      ok: false,
      message:
        "SAM.gov not probed automatically (no live call). Hub is not Connected until Founder Test Connection succeeds.",
      latencyMs: 0,
      uei: null,
      apiKeySet: false,
    };
  }
  if (cached.ok) return cached;
  return {
    ...cached,
    ok: false,
    message: `${cached.message} (live SAM probe skipped — auto paths do not call api.sam.gov)`,
  };
}
