import type { OrganizationHealthScore } from "../api/analyticsApi";

export type OrganizationHealthSource = {
  organizationHealth?: OrganizationHealthScore | null;
  organizationHealthScore?: number | null;
};

/** Prefer live analytics health, then executive overview, without fabricating scores. */
export function resolveOrganizationHealth(
  analytics?: OrganizationHealthSource | null,
  executive?: OrganizationHealthSource | null
): OrganizationHealthScore | null {
  const fromAnalytics = analytics?.organizationHealth;
  const fromExecutive = executive?.organizationHealth;

  const overall =
    fromAnalytics?.overall ??
    fromExecutive?.overall ??
    analytics?.organizationHealthScore ??
    executive?.organizationHealthScore;

  if (overall == null || !Number.isFinite(overall)) return null;

  const source = fromAnalytics?.overall != null ? fromAnalytics : fromExecutive;
  return {
    overall: Math.round(overall),
    grade: source?.grade ?? gradeFromScore(overall),
    factors: source?.factors?.length ? source.factors : [],
  };
}

export function gradeFromScore(score: number): string {
  if (score >= 90) return "Excellent";
  if (score >= 75) return "Strong";
  if (score >= 60) return "Stable";
  if (score >= 45) return "Needs Attention";
  return "Critical";
}

export function formatHealthScore(health: OrganizationHealthScore | null | undefined, loading = false): string {
  if (loading) return "—";
  if (!health || !Number.isFinite(health.overall)) return "—";
  return `${health.overall}%`;
}
