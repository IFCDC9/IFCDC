import type { Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { HQ_API_LIMITER_MESSAGE } from "../hq/samGovProbePolicy";

/** Rate limit HQ API routes — enterprise security baseline */
export const hqApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: HQ_API_LIMITER_MESSAGE },
});

export function hqSecurityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("X-IFCDC-Platform", "headquarters");
  next();
}
