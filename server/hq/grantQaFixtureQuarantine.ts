/**
 * Read-time quarantine for the known QA id and exact timestamp-tagged QA records.
 * Does not delete rows or exclude ordinary manual / closed opportunities.
 */
export const QUARANTINED_QA_OPPORTUNITY_ID = "0e864db8-4387-477a-96d6-4fdc94e04501";

export function isQuarantinedQaOpportunity(id: unknown): boolean {
  return String(id ?? "").trim() === QUARANTINED_QA_OPPORTUNITY_ID;
}

function opportunityIdColumn(column: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(column)) {
    throw new Error("Invalid opportunity id column");
  }
  return column;
}

/** Exclude known QA opportunities, including later timestamp-tagged test runs. */
export function excludeQuarantinedOpportunitySql(column: string): string {
  return ` AND ${opportunityIdColumn(column)} NOT IN (SELECT id FROM grant_opportunities WHERE ${qaOpportunityPredicate()})`;
}

/** Keep null opportunity links; exclude links to identified QA opportunities. */
export function excludeQuarantinedLinkedOpportunitySql(column: string): string {
  const safe = opportunityIdColumn(column);
  return ` AND (${safe} IS NULL OR ${safe} NOT IN (SELECT id FROM grant_opportunities WHERE ${qaOpportunityPredicate()}))`;
}

/** Match only the timestamp-tagged titles emitted by grant-center-qa.mjs. */
function taggedTitle(kind: "Application" | "Opportunity"): string {
  const suffix = ` ${kind}`;
  const digits = `substr(trim(title), 10, length(trim(title)) - ${9 + suffix.length})`;
  return `(trim(title) GLOB 'qa-grant-[0-9]*${suffix}' AND length(${digits}) > 0 AND ${digits} NOT GLOB '*[^0-9]*')`;
}
function qaOpportunityPredicate(): string {
  return `(id = '${QUARANTINED_QA_OPPORTUNITY_ID}' OR (funder = 'QA Foundation' AND ${taggedTitle("Opportunity")}))`;
}

/** Read-time quarantine: preserves every row, including orphan QA applications. */
export function excludeQaApplicationsSql(column = "id"): string {
  return ` AND ${opportunityIdColumn(column)} NOT IN (SELECT id FROM grant_applications WHERE ${taggedTitle("Application")} OR opportunity_id IN (SELECT id FROM grant_opportunities WHERE ${qaOpportunityPredicate()}))`;
}

export function isQaOpportunityRecord(row: { id?: unknown; title?: unknown; funder?: unknown }): boolean {
  return isQuarantinedQaOpportunity(row.id) || (row.funder === "QA Foundation" && /^qa-grant-\d+ Opportunity$/.test(String(row.title ?? "").trim()));
}

/** Pipeline and notification rows that may still be selected. */
export function selectPipelineNotificationIds(
  rows: Array<{ id: string; opportunityId?: string | null }>,
): string[] {
  return rows
    .filter((row) => !isQuarantinedQaOpportunity(row.id) && !isQuarantinedQaOpportunity(row.opportunityId))
    .map((row) => row.id);
}
