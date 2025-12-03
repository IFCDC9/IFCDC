import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config/env";

interface TokenPayload {
  sub: number;
  role: string;
}

export interface AuthRequest extends Request {
  user?: TokenPayload;
}

export const requireAuth = (req: AuthRequest, res: Response, next: NextFunction) => {
  const header = req.headers.authorization || "";
  const token = header.replace("Bearer ", "");

  if (!token) {
    return res.status(401).json({ message: "Missing token" });
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret || "fallback-secret") as unknown as TokenPayload;
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid token" });
  }
};

export const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  requireAuth(req, res, () => {
    if (req.user?.role !== "admin") {
      return res.status(403).json({ message: "Admin only" });
    }
    next();
  });
};

export const requireDirector = (req: AuthRequest, res: Response, next: NextFunction) => {
  requireAuth(req, res, () => {
    if (req.user?.role !== "admin" && req.user?.role !== "director") {
      return res.status(403).json({ message: "Director or admin only" });
    }
    next();
  });
};

export const requireAdminOrSupervisor = (req: AuthRequest, res: Response, next: NextFunction) => {
  requireAuth(req, res, () => {
    if (req.user?.role !== "admin" && req.user?.role !== "director") {
      return res.status(403).json({ message: "Admin or supervisor access required" });
    }
    next();
  });
};
