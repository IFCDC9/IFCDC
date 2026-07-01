type CacheEntry<T> = { at: number; key: string; data: T };

/** Short-lived in-memory cache for expensive HQ aggregate packages. */
export function createPackageCache<T>(ttlMs = 60_000) {
  let entry: CacheEntry<T> | null = null;

  return {
    async get(key: string, loader: () => Promise<T>): Promise<T> {
      const now = Date.now();
      if (entry && entry.key === key && now - entry.at < ttlMs) {
        return entry.data;
      }
      const data = await loader();
      entry = { at: now, key, data };
      return data;
    },
    clear() {
      entry = null;
    },
  };
}
