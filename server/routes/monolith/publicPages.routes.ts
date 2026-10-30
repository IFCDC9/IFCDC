import type { Express } from "express";
import path from "path";
import { getPublicDir } from "../../appPaths";
import { publicWebsiteHost } from "../../hq/publicWebsite";

export function registerPublicPageRoutes(app: Express): void {
  const publicDir = getPublicDir();

  const sendWebsite = (res: import("express").Response, file: string) => {
    res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY" });
    return res.sendFile(path.join(publicDir, file));
  };
  // Match the actual Host header, not an arbitrary forwarded host. No HQ auth changes.
  app.get("/", (req, res, next) => publicWebsiteHost(req.get("host") || "") ? sendWebsite(res, "cdc-home.html") : next());
  app.get("/index.html", (_req, res) => sendWebsite(res, "cdc-home.html"));
  app.get("/design-website", (_req, res) => sendWebsite(res, "cdc-design-app.html"));
  app.get(["/listen", "/listen.html"], (_req,res) => sendWebsite(res,"cdc-radio.html"));
  app.get("/website", (_req, res) => sendWebsite(res, "cdc-home.html"));
  const websitePages: Record<string,string> = { client: "client", "design-app": "design-app", about: "about", programs: "programs", services: "services", contact: "contact", careers: "careers", media: "media", "privacy-policy": "privacy", "terms-of-use": "terms" };
  for (const [route, file] of Object.entries(websitePages)) {
    app.get([`/${route}`, `/${route}.html`], (_req,res) => sendWebsite(res, `cdc-${file}.html`));
  }

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
