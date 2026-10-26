import type { Express } from "express";
import path from "path";
import { getPublicDir } from "../../appPaths";

export function registerPublicPageRoutes(app: Express): void {
  const publicDir = getPublicDir();

  const pages: Record<string, string> = {
    "/support": "support.html",
    "/book-barbershop": "book-barbershop.html",
    "/mental-health": "mental-health.html",
    "/programs": "programs.html",
    "/contact": "contact.html",
    "/records-policy": "records-policy.html",
    "/roi": "roi.html",
    "/privacy-policy": "privacy-policy.html",
    "/terms-of-use": "terms-of-use.html",
    "/intake": "intake.html",
  };

  for (const [route, file] of Object.entries(pages)) {
    app.get(route, (_req, res) => {
      if (route === "/support") res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY" });
      res.sendFile(path.join(publicDir, file));
    });
  }
}
