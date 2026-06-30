/**
 * Honest labeling for grant opportunity provenance (production hardening).
 * dataSource values: api | imported | static | seed | local | manual
 */

export type GrantDataSource = "api" | "imported" | "static" | "seed" | "local" | "manual";

export function resolveOpportunityDataSource(row: Record<string, unknown>): GrantDataSource {
  const sourceType = String(row.source_type ?? "").trim();
  const importStatus = String(row.import_status ?? "").trim();

  if (sourceType === "dev_seed") return "seed";
  if (sourceType === "corporate_csr" || importStatus === "static") return "static";
  if (sourceType === "grants_gov") return "api";
  if (sourceType === "foundation_directory") return "api";
  if (importStatus === "imported" && sourceType) return "imported";
  if (sourceType === "manual" || row.created_by) return "manual";
  if (sourceType) return "local";
  return "local";
}

export function annotateOpportunity<T extends Record<string, unknown>>(row: T): T & { dataSource: GrantDataSource; dataSourceLabel: string } {
  const dataSource = resolveOpportunityDataSource(row);
  return {
    ...row,
    dataSource,
    dataSourceLabel: dataSourceLabel(dataSource, row),
  };
}

function dataSourceLabel(source: GrantDataSource, row: Record<string, unknown>): string {
  switch (source) {
    case "api":
      return row.source_type === "foundation_directory"
        ? "Foundation directory (verify programs with funder)"
        : "Live API feed";
    case "imported":
      return "Imported feed";
    case "static":
      return "Curated reference (not a live listing)";
    case "seed":
      return "Development sample data";
    case "manual":
      return "Manually entered";
    default:
      return "Organization database";
  }
}

export function summarizeGrantDataSources(rows: { dataSource?: GrantDataSource }[]): {
  api: number;
  imported: number;
  static: number;
  seed: number;
  local: number;
  manual: number;
  total: number;
} {
  const counts = { api: 0, imported: 0, static: 0, seed: 0, local: 0, manual: 0, total: rows.length };
  for (const row of rows) {
    const s = row.dataSource ?? "local";
    if (s === "api") counts.api++;
    else if (s === "imported") counts.imported++;
    else if (s === "static") counts.static++;
    else if (s === "seed") counts.seed++;
    else if (s === "manual") counts.manual++;
    else counts.local++;
  }
  return counts;
}

export function resolveFeedAggregateSource(externalCount: number, breakdown: ReturnType<typeof summarizeGrantDataSources>): string {
  if (externalCount > 0 && breakdown.seed === 0 && breakdown.static === 0) return "external";
  if (externalCount > 0) return "mixed";
  if (breakdown.seed > 0) return "seeded";
  return "local_only";
}
