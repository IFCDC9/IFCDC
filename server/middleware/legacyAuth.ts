import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config/auth";
import { getMonolithDb } from "../monolith/dbAccess";

interface LegacyUserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  password_hash: string | null;
}

export async function authRequired(req: Request, res: Response, next: NextFunction) {
  let token = req.cookies?.ifcdc_token || null;

  if (!token) {
    const authHeader = req.header("Authorization") || "";
    token = authHeader.startsWith("Bearer ") ? authHeader.replace("Bearer ", "") : null;
  }

  if (!token && req.query.token) {
    token = req.query.token as string;
  }

  if (!token) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET) as { id: string; email: string; role: string };
    const db = getMonolithDb();
    const user = await db.get<LegacyUserRow>("SELECT * FROM users WHERE id = ?", payload.id);
    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }
    req.user = { id: user.id, name: user.name, email: user.email, role: payload.role || user.role };
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function requireRole(...roles: (string | string[])[]) {
  const allowedRoles = roles.flat();
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthenticated" });
    }
    if (req.user.role === "owner") {
      return next();
    }
    if (!req.user?.role || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== "admin" && req.user?.role !== "owner") {
    return res.status(403).json({ error: "Unauthorized" });
  }
  next();
}
