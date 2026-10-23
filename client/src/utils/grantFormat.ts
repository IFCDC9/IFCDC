import { formatCurrency } from "./safeFormat";

/** Display grant deadline — never show a blank dash for missing dates. */
export function fmtGrantDeadline(d: string | null | undefined): string {
  if (!d?.trim()) return "No deadline listed";
  if (d.trim().toLowerCase() === "rolling") return "Rolling";
  // A funder calendar date is not a UTC instant. Keep Nov 2 as Nov 2 in every timezone.
  const calendarOnly = /^\d{4}-\d{2}-\d{2}$/.test(d.trim());
  const parsed = new Date(calendarOnly ? `${d.trim()}T00:00:00Z` : d);
  if (Number.isNaN(parsed.getTime())) return "No deadline listed";
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", ...(calendarOnly ? { timeZone: "UTC" } : {}) });
}

export function fmtGrantAmount(min?: number | null, max?: number | null): string {
  if (max != null && min != null && min !== max) return `${formatCurrency(min)} – ${formatCurrency(max)}`;
  if (max != null) return `Up to ${formatCurrency(max)}`;
  if (min != null) return `From ${formatCurrency(min)}`;
  return "Amount TBD";
}

export function fmtGrantSyncDate(d: string | null | undefined): string {
  if (!d?.trim()) return "—";
  const parsed = new Date(d);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
