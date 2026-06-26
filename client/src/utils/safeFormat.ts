/** Safe number/date formatting for Headquarters dashboards — never throws on undefined. */

export function coerceNumber(value: unknown, fallback = 0): number {
  if (value == null || value === "") return fallback;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function formatLocaleNumber(
  value: unknown,
  options?: Intl.NumberFormatOptions,
  empty = "—"
): string {
  const n = coerceNumber(value, NaN);
  if (Number.isNaN(n)) return empty;
  return n.toLocaleString("en-US", options);
}

export function formatCurrency(
  value: unknown,
  opts?: { minimumFractionDigits?: number; maximumFractionDigits?: number; empty?: string }
): string {
  const empty = opts?.empty ?? "—";
  const n = coerceNumber(value, NaN);
  if (Number.isNaN(n)) return empty;
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: opts?.minimumFractionDigits ?? 0,
    maximumFractionDigits: opts?.maximumFractionDigits ?? 0,
  })}`;
}

export function formatPercent(value: unknown, empty = "—"): string {
  const n = coerceNumber(value, NaN);
  if (Number.isNaN(n)) return empty;
  return `${n}%`;
}

export function formatDateTime(value: unknown, empty = "—"): string {
  if (value == null || value === "") return empty;
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return empty;
  return d.toLocaleString("en-US");
}

export function formatDate(value: unknown, empty = "—"): string {
  if (value == null || value === "") return empty;
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return empty;
  return d.toLocaleDateString("en-US");
}

/** Recharts / chart tooltip helper */
export function formatChartCurrency(value: unknown): string {
  return formatCurrency(value, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
