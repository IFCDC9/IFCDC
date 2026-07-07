import type { Request } from "express";

/**
 * MFA enrollment is required only for high-risk mutations (federal submission, authenticated gov data).
 * Executive AURA chat, grant discovery, navigation, summaries, and drafting do NOT require MFA setup.
 */

export function normalizeHqRequestPath(req: Request): string {
  return (req.originalUrl ?? req.url ?? req.path).split("?")[0];
}

function pathMatches(path: string, pattern: RegExp): boolean {
  return pattern.test(path);
}

/** True when this request must have twofa_enabled on the account before proceeding. */
export function hqMutationRequiresMfaEnrollment(req: Request): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return false;

  const path = normalizeHqRequestPath(req);
  const body = (req.body ?? {}) as Record<string, unknown>;

  // Auth + Security Center (MFA enrollment itself)
  if (path.startsWith("/api/auth") || path.includes("/security")) return false;

  // Federal / funder submission
  if (pathMatches(path, /\/api\/hq\/grants\/applications\/[^/]+\/workflow$/i) && body.action === "submit") {
    return true;
  }

  if (
    pathMatches(path, /\/api\/hq\/grants\/applications\/[^/]+$/i)
    && req.method === "PATCH"
    && body.status === "submitted"
  ) {
    return true;
  }

  if (
    pathMatches(path, /\/api\/hq\/grants\/pipeline\/enterprise\/applications\/[^/]+\/advance$/i)
    && (body.toStage === "submitted" || body.stage === "submitted")
  ) {
    return true;
  }

  // Authenticated SAM.gov private entity profile (not public Grants.gov search)
  if (pathMatches(path, /\/api\/hq\/integrations\/sam\/entity-profile/i)) return true;
  if (pathMatches(path, /\/api\/hq\/grants\/sam\/entity-profile/i)) return true;

  // All other HQ mutations — including AURA chat, grant search, navigation, drafting — are allowed
  return false;
}

export const MFA_POLICY_SUMMARY = {
  advisoryExempt: [
    "AURA Executive Chat and copilot",
    "Grant discovery, matching, and ranking",
    "Grants.gov / public feed sync",
    "Navigation and executive summaries",
    "Grant drafting and founder review (pre-submission)",
  ],
  enrollmentRequired: [
    "Submitting grant applications to funders",
    "Authenticated SAM.gov private entity profile access",
  ],
} as const;
