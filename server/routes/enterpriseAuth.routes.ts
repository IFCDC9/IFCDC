import { Router } from "express";
import type { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { getDb } from "../db";
import { hqAuthRequired } from "../middleware/hqAuth";
import {
  ENTERPRISE_ROLES,
  ENTERPRISE_ROLE_LABELS,
  ROLE_PERMISSIONS,
  HQ_MODULE_PERMISSIONS,
  ROUTE_PERMISSIONS,
  buildEnterpriseSession,
  hasPermission,
  toEnterpriseRole,
} from "../hq/enterpriseRoles";
import { JWT_SECRET } from "../config/auth";
import {
  listSsoAppsForRole,
  createSsoLaunchToken,
  createHqSessionToken,
  buildSoftwareDivisionSsoManifest,
  getSsoApp,
  canLaunchSsoApp,
} from "../hq/ssoGateway";
import { buildWelcomeGreeting } from "../hq/welcomeGreeting";
import { COOKIE_NAME } from "../config/auth";

const router = Router();

/** Public — role definitions for UI and connected apps */
router.get("/roles", (_req, res) => {
  res.json({
    roles: ENTERPRISE_ROLES.map((r) => ({
      id: r,
      label: ENTERPRISE_ROLE_LABELS[r],
      permissions: ROLE_PERMISSIONS[r],
    })),
    modules: HQ_MODULE_PERMISSIONS,
    routePermissions: ROUTE_PERMISSIONS,
  });
});

/** Full enterprise session for Headquarters client */
router.get("/session", hqAuthRequired, async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    const user = await db.get<{ id: string; email: string; role: string; name: string }>(
      "SELECT id, email, role, name FROM users WHERE id = ?",
      req.hqUser!.id
    );

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const effectiveRole = req.hqUser!.role;
    const employee = await db.get(
      `SELECT id, first_name as firstName, last_name as lastName, role, location, status
       FROM employees WHERE email = ?`,
      user.email
    );

    const session = buildEnterpriseSession({
      id: user.id,
      email: user.email,
      role: effectiveRole,
      name: user.name,
    });

    res.json({
      user: {
        ...session,
        employee: employee ?? null,
        welcomeGreeting: buildWelcomeGreeting({
          name: user.name,
          email: user.email,
          employee: employee as { firstName?: string; lastName?: string } | null,
        }),
      },
      platform: "IFCDC Headquarters",
      singleSignOn: true,
    });
  } catch (error) {
    console.error("Enterprise session error:", error);
    res.status(500).json({ error: "Failed to load session" });
  }
});

/**
 * Token verification for connected IFCDC applications.
 * Apps send the HQ cookie token or Bearer JWT to receive role + permissions.
 */
router.post("/verify", (req: Request, res: Response) => {
  let token = req.cookies?.ifcdc_token || null;
  if (!token) {
    const authHeader = req.header("Authorization") || "";
    token = authHeader.startsWith("Bearer ") ? authHeader.replace("Bearer ", "") : null;
  }
  if (!token && req.body?.token) {
    token = req.body.token;
  }

  if (!token) {
    return res.status(401).json({ valid: false, error: "No token provided" });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET) as { id: string; email: string; role: string; name?: string };
    const session = buildEnterpriseSession(payload);
    res.json({
      valid: true,
      userId: payload.id,
      email: payload.email,
      role: payload.role,
      enterpriseRole: session.enterpriseRole,
      permissions: session.permissions,
      modules: session.modules,
      defaultRoute: session.defaultRoute,
    });
  } catch {
    res.status(401).json({ valid: false, error: "Invalid or expired token" });
  }
});

/** Check a specific permission */
router.get("/can", hqAuthRequired, (req: Request, res: Response) => {
  const permission = req.query.permission as string;
  if (!permission) {
    return res.status(400).json({ error: "permission query param required" });
  }
  const allowed = hasPermission(req.hqUser!.role, permission as never);
  res.json({ allowed, permission });
});

/** Permission matrix — administrators only */
router.get("/matrix", hqAuthRequired, (req: Request, res: Response) => {
  const role = toEnterpriseRole(req.hqUser!.role);
  if (req.hqUser!.role !== "owner" && role !== "founder" && role !== "administrator") {
    return res.status(403).json({ error: "Administrator access required" });
  }

  res.json({
    roles: ENTERPRISE_ROLES.map((r) => ({
      id: r,
      label: ENTERPRISE_ROLE_LABELS[r],
      permissions: ROLE_PERMISSIONS[r],
      modules: Object.entries(HQ_MODULE_PERMISSIONS)
        .filter(([, roles]) => roles.includes(r))
        .map(([m]) => m),
    })),
  });
});

/** SSO Gateway — list apps the current user may launch */
router.get("/sso/apps", hqAuthRequired, (req: Request, res: Response) => {
  const apps = listSsoAppsForRole(req.hqUser!.role);
  res.json({ apps, gateway: "IFCDC Headquarters SSO" });
});

/** SSO Gateway — issue a short-lived launch token for a connected app */
router.post("/sso/launch", hqAuthRequired, async (req: Request, res: Response) => {
  const appId = String(req.body?.appId ?? "");
  const app = getSsoApp(appId);
  if (!app) return res.status(404).json({ error: "Application not found" });
  if (!hasPermission(req.hqUser!.role, app.permission as never)) {
    return res.status(403).json({ error: "You do not have access to this application" });
  }
  if (!canLaunchSsoApp(app)) {
    return res.status(403).json({ error: "This application is not yet available for launch. Configure HQ_*_LAUNCH_URL for external apps." });
  }

  const db = await getDb();
  const user = await db.get<{ id: string; email: string; role: string; name: string }>(
    "SELECT id, email, role, name FROM users WHERE id = ?", req.hqUser!.id
  );
  if (!user) return res.status(404).json({ error: "User not found" });

  const token = createSsoLaunchToken(user, appId);
  const origin = `${req.protocol}://${req.get("host")}`;
  const launchUrl = app.launchPath.startsWith("http")
    ? `${app.launchPath}?sso_token=${encodeURIComponent(token)}`
    : `${origin}${app.launchPath}?sso_token=${encodeURIComponent(token)}`;

  res.json({
    appId,
    appName: app.name,
    token,
    launchUrl,
    launchPath: app.launchPath,
    expiresIn: "8h",
    verifyEndpoint: "/api/hq/auth/verify",
  });
});

/** SSO manifest for Developer Portal and connected apps */
router.get("/sso/manifest", hqAuthRequired, (_req, res) => {
  res.json(buildSoftwareDivisionSsoManifest());
});

/**
 * Exchange an SSO launch token (?sso_token=) for a standard HQ session cookie.
 * Future IFCDC apps call this on first load to establish a Headquarters session.
 */
router.post("/sso/exchange", async (req: Request, res: Response) => {
  const token = String(req.body?.token ?? req.query?.token ?? "");
  if (!token) return res.status(400).json({ error: "token required" });

  try {
    const payload = jwt.verify(token, JWT_SECRET) as {
      id: string; email: string; role: string; name?: string; sso?: boolean; ssoApp?: string;
    };
    if (!payload.id || !payload.email) {
      return res.status(401).json({ error: "Invalid SSO token payload" });
    }

    const db = await getDb();
    const user = await db.get<{ id: string; email: string; role: string; name: string }>(
      "SELECT id, email, role, name FROM users WHERE id = ?", payload.id
    );
    if (!user) return res.status(401).json({ error: "User not found" });

    const sessionToken = createHqSessionToken(user);
    res.cookie(COOKIE_NAME, sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    const session = buildEnterpriseSession({
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    });

    res.json({
      success: true,
      user: session,
      launchedFrom: payload.ssoApp ?? null,
      verifyEndpoint: "/api/hq/auth/verify",
      expiresIn: "7d",
    });
  } catch {
    res.status(401).json({ error: "Invalid or expired SSO token" });
  }
});

export default router;
