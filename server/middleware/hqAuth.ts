import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { canAccessModule, hasPermission, type Permission } from "../hq/enterpriseRoles";
import { JWT_SECRET } from "../config/auth";

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
    next();
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
