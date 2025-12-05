import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

export interface AuthedUser {
  id: string;
  name: string;
  role: string;
  email: string;
}

export interface AuthedRequest extends Request {
  user?: AuthedUser;
}

export function authMiddleware(req: AuthedRequest, _res: Response, next: NextFunction) {
  const cookieToken = req.cookies?.ifcdc_token;
  const authHeader = req.headers.authorization || "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  
  const token = cookieToken || bearerToken;

  if (!token) {
    req.user = undefined;
    return next();
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    req.user = {
      id: decoded.sub as string,
      name: decoded.name || "",
      role: decoded.role as string,
      email: decoded.email as string,
    };
  } catch {
    req.user = undefined;
  }
  
  return next();
}

export function requireAuth(allowedRoles?: string[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    if (allowedRoles && !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "Access denied" });
    }

    return next();
  };
}
