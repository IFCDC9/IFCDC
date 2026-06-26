import { lazy, type ComponentType, type LazyExoticComponent } from "react";

type Importer<T> = () => Promise<{ default: T }>;

const CHUNK_RE =
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i;

/** Retry lazy chunks once — recovers from stale Vite HMR / browser cache after dev rebuilds */
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
      await new Promise((r) => setTimeout(r, 120));
      return importer();
    }
  });
}
