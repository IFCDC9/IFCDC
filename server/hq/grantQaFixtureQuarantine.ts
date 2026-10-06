/**
 * One closed production QA opportunity.
 * This is an id allowlist, not a filter on manual or closed rows.
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

/** SQL fragment: AND <column> != the quarantined opportunity id. */
export function excludeQuarantinedOpportunitySql(column: string): string {
  return ` AND ${opportunityIdColumn(column)} != '${QUARANTINED_QA_OPPORTUNITY_ID}'`;
}

/** Keeps rows whose opportunity link is empty. Drops only the quarantined id. */
export function excludeQuarantinedLinkedOpportunitySql(column: string): string {
  const safe = opportunityIdColumn(column);
  return ` AND (${safe} IS NULL OR ${safe} != '${QUARANTINED_QA_OPPORTUNITY_ID}')`;
}

/** Pipeline and notification rows that may still be selected. */
export function selectPipelineNotificationIds(
  rows: Array<{ id: string; opportunityId?: string | null }>,
): string[] {
  return rows
    .filter((row) => !isQuarantinedQaOpportunity(row.id) && !isQuarantinedQaOpportunity(row.opportunityId))
    .map((row) => row.id);
}
