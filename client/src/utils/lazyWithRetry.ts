import { lazy, type ComponentType, type LazyExoticComponent } from "react";

type Importer<T> = () => Promise<{ default: T }>;

const CHUNK_RE =
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i;

const RELOAD_KEY = "__IFCDC_CHUNK_RELOAD__";

function maybeHardReload(): void {
  try {
    if (sessionStorage.getItem(RELOAD_KEY)) return;
    sessionStorage.setItem(RELOAD_KEY, "1");
    window.location.reload();
  } catch {
    /* ignore */
  }
}

/** Retry lazy chunks once — recovers from stale cache after production redeploys */
export function lazyWithRetry<T extends ComponentType<unknown>>(
  importer: Importer<T>,
  label = "module"
): LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      return await importer();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!CHUNK_RE.test(message)) throw err;

      console.warn(`IFCDC: retrying lazy load for ${label}…`);
      await new Promise((r) => setTimeout(r, 150));
      try {
        return await importer();
      } catch (retryErr) {
        const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
        if (CHUNK_RE.test(retryMsg)) maybeHardReload();
        throw retryErr;
      }
    }
  });
}
