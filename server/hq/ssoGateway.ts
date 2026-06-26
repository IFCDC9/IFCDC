import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config/auth";
import { SOFTWARE_DIVISION_APPS } from "./appRegistry";
import { hasPermission } from "./enterpriseRoles";

export interface SsoAppDefinition {
  id: string;
  name: string;
  description: string;
  launchPath: string;
  permission: string;
  status: "production" | "production-locked" | "beta" | "development";
  icon?: string;
  externalUrl?: string;
  healthUrl?: string;
}

function divisionApp(appId: string) {
  return SOFTWARE_DIVISION_APPS.find((a) => a.id === appId);
}

function divisionLaunch(appId: string, fallback: string): string {
  const app = divisionApp(appId);
  return app?.launchUrl ?? fallback;
}

function mapDivisionStatus(appId: string): SsoAppDefinition["status"] {
  const app = divisionApp(appId);
  if (!app) return "development";
  if (app.locked || app.status === "locked") return "production-locked";
  if (app.status === "production") return "production";
  if (app.status === "mvp") return "beta";
  if (app.status === "development" || app.status === "planned") return "development";
  return "beta";
}

function isExternalLaunch(path: string): boolean {
  return path.startsWith("http://") || path.startsWith("https://");
}

export const SSO_REGISTERED_APPS: SsoAppDefinition[] = [
  {
    id: "headquarters",
    name: "IFCDC Headquarters",
    description: "Enterprise Operating System — command center for the entire organization",
    launchPath: "/hq",
    permission: "hq.executive",
    status: "production",
  },
  {
    id: "barbers",
    name: "IFCDC Barbers",
    description: "Barbershop operations platform (production-locked)",
    launchPath: "/app/barbershop",
    permission: "app.barbers",
    status: "production-locked",
  },
  {
    id: "radio",
    name: "IFCDC Radio",
    description: "Live broadcast and programming platform",
    launchPath: "/app/radio",
    permission: "app.radio",
    status: "production",
  },
  {
    id: "programs",
    name: "Community Programs",
    description: "Program enrollment and session management",
    launchPath: "/app/programs",
    permission: "hq.programs",
    status: "production",
  },
  {
    id: "music",
    name: "IFCDC Music",
    description: divisionApp("music")?.description ?? "Music division — DJ library, AURA AI, crates, and bookings",
    launchPath: divisionLaunch("music", "/hq/media"),
    permission: "app.music",
    status: mapDivisionStatus("music"),
    externalUrl: isExternalLaunch(divisionLaunch("music", "")) ? divisionLaunch("music", "") : undefined,
    healthUrl: divisionApp("music")?.healthUrl,
  },
  {
    id: "tapis",
    name: "IFCDC Tapis",
    description: divisionApp("tapis")?.description ?? "Mentorship circles and community reflection platform",
    launchPath: divisionLaunch("tapis", "/hq/programs"),
    permission: "app.tapis",
    status: mapDivisionStatus("tapis"),
    externalUrl: isExternalLaunch(divisionLaunch("tapis", "")) ? divisionLaunch("tapis", "") : undefined,
    healthUrl: divisionApp("tapis")?.healthUrl,
  },
  {
    id: "inclusive",
    name: "Inclusive Community",
    description: divisionApp("inclusive")?.description ?? "Autism support platform with AURA communication assistance",
    launchPath: divisionLaunch("inclusive", "/hq/programs"),
    permission: "app.inclusive",
    status: mapDivisionStatus("inclusive"),
    externalUrl: isExternalLaunch(divisionLaunch("inclusive", "")) ? divisionLaunch("inclusive", "") : undefined,
    healthUrl: divisionApp("inclusive")?.healthUrl,
  },
  {
    id: "community-portal",
    name: "Community Portal",
    description: "Public-facing community engagement and program access portal",
    launchPath: "/programs",
    permission: "hq.programs",
    status: "production",
  },
  {
    id: "housing",
    name: "Housing Programs",
    description: "Transitional housing and placement management",
    launchPath: "/hq/housing",
    permission: "hq.programs",
    status: "production",
  },
  {
    id: "scholarships",
    name: "Scholarship Management",
    description: "Scholarship applications and awards",
    launchPath: "/hq/scholarships",
    permission: "hq.programs",
    status: "production",
  },
  {
    id: "media-division",
    name: "Media Division",
    description: "IFCDC Radio and content production",
    launchPath: "/hq/media",
    permission: "hq.programs",
    status: "production",
  },
  {
    id: "swiftware",
    name: "Swift-Ware",
    description: divisionApp("swiftware")?.description ?? "Business management for IFCDC organizations",
    launchPath: divisionLaunch("swiftware", "/hq/integrations"),
    permission: "app.swiftware",
    status: mapDivisionStatus("swiftware"),
    externalUrl: isExternalLaunch(divisionLaunch("swiftware", "")) ? divisionLaunch("swiftware", "") : undefined,
    healthUrl: divisionApp("swiftware")?.healthUrl,
  },
  {
    id: "cryptocoin",
    name: "CryptoCoin IFCDC",
    description: divisionApp("cryptocoin")?.description ?? "ERC-20 token platform with liquidity pools",
    launchPath: divisionLaunch("cryptocoin", "/hq/finance"),
    permission: "app.cryptocoin",
    status: mapDivisionStatus("cryptocoin"),
    externalUrl: isExternalLaunch(divisionLaunch("cryptocoin", "")) ? divisionLaunch("cryptocoin", "") : undefined,
    healthUrl: divisionApp("cryptocoin")?.healthUrl,
  },
];

export function canLaunchSsoApp(app: SsoAppDefinition): boolean {
  if (app.status === "production-locked") return false;
  if (app.status === "development" && !app.externalUrl) return false;
  return true;
}

export function listSsoAppsForRole(role: string): SsoAppDefinition[] {
  return SSO_REGISTERED_APPS.filter((app) => hasPermission(role, app.permission as never));
}

export function createSsoLaunchToken(user: { id: string; email: string; role: string; name?: string }, appId: string): string {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      ssoApp: appId,
      sso: true,
    },
    JWT_SECRET,
    { expiresIn: "8h" }
  );
}

/** Exchange an SSO launch token for a standard HQ session token (for embedded / same-origin apps). */
export function createHqSessionToken(user: { id: string; email: string; role: string; name?: string }): string {
  return jwt.sign(
    { id: user.id, sub: user.id, email: user.email, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

export function getSsoApp(appId: string): SsoAppDefinition | undefined {
  return SSO_REGISTERED_APPS.find((a) => a.id === appId || a.id === appId.replace(/-/g, ""));
}

export function buildSoftwareDivisionSsoManifest() {
  return {
    gateway: "IFCDC Headquarters SSO",
    version: "1.1",
    endpoints: {
      verify: "/api/hq/auth/verify",
      session: "/api/hq/auth/session",
      exchange: "/api/hq/auth/sso/exchange",
      apps: "/api/hq/auth/sso/apps",
      launch: "/api/hq/auth/sso/launch",
    },
    apps: SSO_REGISTERED_APPS,
    divisionApps: SOFTWARE_DIVISION_APPS.map((a) => ({
      id: a.id,
      name: a.name,
      status: a.status,
      healthUrl: a.healthUrl,
      launchUrl: a.launchUrl,
    })),
  };
}
