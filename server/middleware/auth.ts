import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

export interface AuthedRequest extends Request {
  user?: { id: string; role: string; email: string };
}

export function requireAuth(allowedRoles?: string[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

    if (!token) {
      return res.status(401).json({ error: "Missing token" });
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      req.user = { id: decoded.sub, role: decoded.role, email: decoded.email };

      if (allowedRoles && !allowedRoles.includes(decoded.role)) {
        return res.status(403).json({ error: "Forbidden" });
      }

      return next();
    } catch (err) {
      console.error("JWT error", err);
      return res.status(401).json({ error: "Invalid token" });
    }
  };
}
