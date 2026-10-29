/** Listing availability is separate from organizational eligibility. No date means review required. */
export function grantOpportunityAvailability(row: { status?: unknown; deadline?: unknown }, now = new Date()) {
  const status = String(row.status ?? "").toLowerCase();
  if (!["open", "active", "researching"].includes(status)) return { canStart: false, reason: "Opportunity is not open for applications." };
  const value = String(row.deadline ?? "").trim();
  if (!value || value.toLowerCase() === "rolling") return { canStart: true, reason: "Verify the current official notice and deadline before drafting." };
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = Date.parse(value + "T00:00:00Z");
    if (!Number.isFinite(date) || new Date(date).toISOString().slice(0, 10) !== value) return { canStart: false, reason: "Deadline is invalid; verify the official notice before starting." };
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const part = (type: string) => parts.find((p) => p.type === type)!.value;
    const today = `${part("year")}-${part("month")}-${part("day")}`;
    if (value < today) return { canStart: false, reason: "Deadline has passed; verify a reopened notice before starting an application." };
    return { canStart: true, reason: "Verify the official deadline time and eligibility before drafting." };
  }
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return { canStart: false, reason: "Deadline is invalid; verify the official notice before starting." };
  if (date < now.getTime()) return { canStart: false, reason: "Deadline has passed; verify a reopened notice before starting an application." };
  return { canStart: true, reason: "Listing deadline has not passed; eligibility still requires review." };
}
