/** True in Vite production builds (Render deploy). */
export const isProductionClient = import.meta.env.PROD;

/** Dev-only placeholder for React Query — never use in production. */
export function devPlaceholder<T>(fallback: T): T | undefined {
  return isProductionClient ? undefined : fallback;
}

/** Throw in production so React Query surfaces errors; return fallback only in dev. */
export async function strictApiCall<T>(fn: () => Promise<T>, devFallback?: T): Promise<T> {
  if (!isProductionClient) {
    try {
      return await fn();
    } catch {
      if (devFallback !== undefined) return devFallback;
      throw new Error("API unavailable");
    }
  }
  return fn();
}
