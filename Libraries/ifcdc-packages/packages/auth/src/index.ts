import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import type { Request, Response, NextFunction } from "express";

export interface TokenPayload {
  userId: number | string;
  orgId?: number | string;
  role?: string;
  email?: string;
}

export interface AuthConfig {
  jwtSecret: string;
  expiresIn?: string | number;
  saltRounds?: number;
}

export function createAuthService(config: AuthConfig) {
  const { jwtSecret, expiresIn = "12h", saltRounds = 12 } = config;

  return {
    async hashPassword(password: string): Promise<string> {
      return bcrypt.hash(password, saltRounds);
    },

    async verifyPassword(password: string, hash: string): Promise<boolean> {
      return bcrypt.compare(password, hash);
    },

    signToken(payload: TokenPayload): string {
      return jwt.sign(payload, jwtSecret, { expiresIn: expiresIn as jwt.SignOptions["expiresIn"] });
    },

    verifyToken(token: string): TokenPayload | null {
      try {
        return jwt.verify(token, jwtSecret) as TokenPayload;
      } catch {
        return null;
      }
    },
  };
}

export interface AuthenticatedRequest extends Request {
  user?: TokenPayload;
}

export function createAuthMiddleware(config: AuthConfig) {
  const auth = createAuthService(config);

  return function authMiddleware(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const decoded = auth.verifyToken(token);
    if (!decoded) {
      return res.status(401).json({ error: "Invalid token" });
    }

    req.user = decoded;
    next();
  };
}

export { jwt, bcrypt };
