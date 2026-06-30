import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { canAccessModule, hasPermission, type Permission } from "../hq/enterpriseRoles";
import { JWT_SECRET } from "../config/auth";
import { getDb } from "../db";
import { roleRequiresMfa } from "../hq/hqSecuritySessions";

export interface HQUser {
  id: string;
  email: string;
  role: string;
  name?: string;
}

declare global {
  namespace Express {
    interface Request {
      hqUser?: HQUser;
    }
  }
}

function isMfaExemptHqPath(path: string): boolean {
  return path.startsWith("/auth") || path.startsWith("/security");
}

async function enforcePrivilegedMfa(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (process.env.IFCDC_GRANTS_QA === "1") {
    next();
    return;
  }

  if (!req.hqUser || !roleRequiresMfa(req.hqUser.role)) {
    next();
    return;
  }

  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    next();
    return;
  }

  if (isMfaExemptHqPath(req.path)) {
    next();
    return;
  }

  try {
    const db = await getDb();
    const user = await db.get<{ twofa_enabled: number }>(
      "SELECT twofa_enabled FROM users WHERE id = ?",
      req.hqUser.id,
    );

    if (!user?.twofa_enabled) {
      res.status(403).json({
        error: "MFA required",
        requiresMfaSetup: true,
        message: "Privileged accounts must enable two-factor authentication in Security Center.",
      });
      return;
    }

    next();
  } catch (err) {
    console.error("MFA enforcement error:", err);
    res.status(500).json({ error: "Unable to verify MFA status" });
  }
}

export function hqAuthRequired(req: Request, res: Response, next: NextFunction) {
  let token = req.cookies?.ifcdc_token || null;

  if (!token) {
    const authHeader = req.header("Authorization") || "";
    token = authHeader.startsWith("Bearer ") ? authHeader.replace("Bearer ", "") : null;
  }

  if (!token) {
    return res.status(401).json({ error: "Authentication required" });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET) as { id: string; email: string; role: string; name?: string };
    req.hqUser = {
      id: payload.id,
      email: payload.email,
      role: payload.role,
      name: payload.name,
    };
    (req as Request).user = req.hqUser;
    void enforcePrivilegedMfa(req, res, next);
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function requireHQModule(module: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.hqUser) {
      return res.status(401).json({ error: "Authentication required" });
    }
    if (!canAccessModule(req.hqUser.role, module)) {
      return res.status(403).json({ error: `Access denied to ${module}` });
    }
    next();
  };
}

/** Require at least one of the given permissions (founder/owner always passes). */
export function requireHQPermission(...permissions: Permission[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.hqUser) {
      return res.status(401).json({ error: "Authentication required" });
    }
    if (req.hqUser.role === "owner") return next();
    const allowed = permissions.some((p) => hasPermission(req.hqUser!.role, p));
    if (!allowed) {
      return res.status(403).json({ error: "Insufficient permissions for this action" });
    }
    next();
  };
}
