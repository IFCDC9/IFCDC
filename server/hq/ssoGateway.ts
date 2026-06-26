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
    description: "Music division platform (coming soon)",
    launchPath: "/hq/media",
    permission: "app.music",
    status: "development",
  },
  {
    id: "tapis",
    name: "TapIs",
    description: "TapIs application (coming soon)",
    launchPath: "/hq/software",
    permission: "app.tapis",
    status: "development",
  },
  {
    id: "inclusive-community",
    name: "Inclusive Community",
    description: "Inclusive Community platform (coming soon)",
    launchPath: "/hq/programs/outreach",
    permission: "hq.programs",
    status: "development",
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
    id: "swift-ware",
    name: "Swift-Ware",
    description: "Swift-Ware division (coming soon)",
    launchPath: "/hq/software",
    permission: "app.swiftware",
    status: "development",
  },
  {
    id: "cryptocoin",
    name: "CryptoCoin",
    description: "CryptoCoin platform (coming soon)",
    launchPath: "/hq/finance",
    permission: "hq.finance",
    status: "development",
  },
];

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
  return SSO_REGISTERED_APPS.find((a) => a.id === appId);
}

export function buildSoftwareDivisionSsoManifest() {
  return {
    gateway: "IFCDC Headquarters SSO",
    version: "1.0",
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
    })),
  };
}
