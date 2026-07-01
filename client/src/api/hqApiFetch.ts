import { fetchWithTimeout } from "./safeFetch";

export const HQ_FETCH_TIMEOUT_MS = 20_000;
/** Phase 9/10 aggregate packages can be slow on cold start — allow longer before surfacing an error. */
export const HQ_HEAVY_FETCH_TIMEOUT_MS = 45_000;

export class HqApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "HqApiError";
    this.status = status;
  }
}

/** HQ API fetch with timeout — never leaves the UI in an endless loading state. */
export async function hqApiFetch<T>(
  url: string,
  options?: RequestInit & { timeoutMs?: number }
): Promise<T> {
  const { timeoutMs = HQ_FETCH_TIMEOUT_MS, ...init } = options ?? {};
  let res: Response;
  try {
    res = await fetchWithTimeout(url, { credentials: "include", ...init }, timeoutMs);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new HqApiError("Request timed out — headquarters API did not respond in time.", 408);
    }
    throw err;
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    const msg = err.error || err.message || `Request failed (${res.status})`;
    throw new HqApiError(typeof msg === "string" ? msg : "Request failed", res.status);
  }

  return res.json() as Promise<T>;
}
