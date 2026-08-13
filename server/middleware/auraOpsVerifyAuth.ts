/**
 * Phase 6 / AURA ops verification auth.
 *
 * Accepts either:
 *  1. Existing Founder HQ session JWT (cookie `ifcdc_token` or Authorization Bearer)
 *  2. Narrowly scoped ops verify token (AURA_OPS_VERIFY_TOKEN) via
 *     Authorization Bearer or X-IFCDC-Ops-Token
 *
 * Does not accept or require the Founder password.
 */
import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config/auth";
import { getFounderEmail } from "../hq/auraFounderTrustEngine";
import { getMonolithDb } from "../monolith/dbAccess";
import type { HQUser } from "./hqAuth";

function timingSafeEqualString(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function getAuraOpsVerifyToken(): string {
  return (process.env.AURA_OPS_VERIFY_TOKEN || process.env.IFCDC_AURA_OPS_VERIFY_TOKEN || "").trim();
}

function extractBearer(req: Request): string | null {
  const authHeader = req.header("Authorization") || "";
  if (authHeader.startsWith("Bearer ")) return authHeader.slice(7).trim() || null;
  return null;
}

function extractCookieToken(req: Request): string | null {
  return req.cookies?.ifcdc_token || null;
}

function extractOpsHeaderToken(req: Request): string | null {
  const h = req.header("X-IFCDC-Ops-Token") || req.header("X-Aura-Ops-Token");
  return h?.trim() || null;
}

async function resolveFounderHqUser(): Promise<HQUser | null> {
  const email = getFounderEmail();
  try {
    const db = getMonolithDb();
    const user = await db.get<{ id: string; email: string; role: string; name?: string }>(
      "SELECT id, email, role, name FROM users WHERE lower(email) = lower(?) LIMIT 1",
      email,
    );
    if (user) {
      return {
        id: user.id,
        email: user.email,
        role: "owner",
        name: user.name || "Founder",
        mfaVerified: true,
      };
    }
  } catch {
    /* fall through */
  }
  return {
    id: "ops-verify-founder",
    email,
    role: "owner",
    name: "Founder",
    mfaVerified: true,
  };
}

function tryJwtAuth(req: Request): HQUser | null {
  const token = extractCookieToken(req) || extractBearer(req);
  if (!token) return null;
  // Ops tokens are not JWTs — skip verify noise
  if (token.split(".").length !== 3) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET) as {
      id?: string;
      sub?: string;
      email?: string;
      role?: string;
      name?: string;
      mfaVerified?: boolean;
    };
    if (!payload.email && !payload.id && !payload.sub) return null;
    return {
      id: payload.id || payload.sub || "",
      email: payload.email || "",
      role: payload.role || "client",
      name: payload.name,
      mfaVerified: payload.mfaVerified === true,
    };
  } catch {
    return null;
  }
}

async function tryOpsTokenAuth(req: Request): Promise<HQUser | null> {
  const expected = getAuraOpsVerifyToken();
  if (!expected) return null;

  const candidates = [extractOpsHeaderToken(req), extractBearer(req)].filter(
    (t): t is string => Boolean(t),
  );
  for (const provided of candidates) {
    if (timingSafeEqualString(provided, expected)) {
      return resolveFounderHqUser();
    }
  }
  return null;
}

/**
 * Auth for protected Phase 6 verification + diagnostics helpers.
 * Prefer Founder JWT; allow ops verify token when configured on the server.
 */
export async function auraOpsVerifyAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const jwtUser = tryJwtAuth(req);
  if (jwtUser) {
    req.hqUser = jwtUser;
    (req as Request).user = jwtUser;
    next();
    return;
  }

  const opsUser = await tryOpsTokenAuth(req);
  if (opsUser) {
    req.hqUser = opsUser;
    (req as Request).user = opsUser;
    (req as Request & { auraOpsTokenAuth?: boolean }).auraOpsTokenAuth = true;
    next();
    return;
  }

  const opsConfigured = Boolean(getAuraOpsVerifyToken());
  res.status(401).json({
    error: "Authentication required",
    code: "aura_ops_auth_required",
    hint: opsConfigured
      ? "Provide Founder HQ Bearer JWT (HQ_TOKEN) or X-IFCDC-Ops-Token (AURA_OPS_VERIFY_TOKEN)."
      : "Provide Founder HQ Bearer JWT (HQ_TOKEN), or complete Founder phone OTP session mint, or configure AURA_OPS_VERIFY_TOKEN on the server.",
  });
}
