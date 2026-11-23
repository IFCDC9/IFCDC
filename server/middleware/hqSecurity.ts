import type { Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";

/**
 * Rate limit HQ API routes — 300 req / 60s.
 * Copy is HQ-only. GSA SAM.gov throttle body is "Message throttled out" (typically 429).
 */
export const hqApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again shortly." },
});

export function hqSecurityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("X-IFCDC-Platform", "headquarters");
  next();
}
