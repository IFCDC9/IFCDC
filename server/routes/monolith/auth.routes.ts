import { Router, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import QRCode from "qrcode";
import * as client from "openid-client";
import { authenticator } from "../../otplib-compat";
import { JWT_SECRET } from "../../config/auth";
import { authRequired } from "../../middleware/legacyAuth";
import { getMonolithDb } from "../../monolith/dbAccess";
import { ADMIN_EMAIL, assignRole, cryptoRandomId } from "../../monolith/constants";
import { logAudit } from "../../monolith/audit";
import { getGoogleOAuthConfig, isGoogleOAuthConfigured } from "../../monolith/googleOAuth";
import { recordActiveSession, recordLoginAttempt, roleRequiresMfa } from "../../hq/hqSecuritySessions";
import { enforceSessionPolicyOnLogin } from "../../hq/sessionPolicy";

const MASTER_OWNER_EMAIL = (process.env.MASTER_OWNER_EMAIL || "service@ifcdc.org").toLowerCase();

async function handleLogin(req: Request, res: Response): Promise<Response | void> {
  try {
    const { email, password, totpCode } = req.body;
    const lowerEmail = (email || "").toLowerCase();
    const db = getMonolithDb();

    const user = await db.get<any>("SELECT * FROM users WHERE email = ?", lowerEmail);

    if (!user) {
      await recordLoginAttempt({
        email: lowerEmail,
        success: false,
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
        failureReason: "user_not_found",
      });
      return res.status(401).json({ error: "Invalid credentials" });
    }

    if (!user.password_hash) {
      const newHash = await bcrypt.hash(password, 10);
      await db.run("UPDATE users SET password_hash = ? WHERE id = ?", newHash, user.id);
    } else {
      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) {
        await recordLoginAttempt({
          userId: user.id,
          email: lowerEmail,
          success: false,
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
          failureReason: "invalid_password",
        });
        return res.status(401).json({ error: "Invalid credentials" });
      }
    }

    if (user.status !== "active") {
      return res.status(403).json({ message: "Account restricted" });
    }

    let effectiveRole = user.role;
    if (MASTER_OWNER_EMAIL && lowerEmail === MASTER_OWNER_EMAIL.toLowerCase()) {
      effectiveRole = "owner";
    } else if (ADMIN_EMAIL && lowerEmail === ADMIN_EMAIL.toLowerCase()) {
      effectiveRole = "admin";
    }

    const grantsQaBypass = process.env.IFCDC_GRANTS_QA === "1";

    if (roleRequiresMfa(effectiveRole) && !grantsQaBypass) {
      if (!user.twofa_enabled) {
        await recordLoginAttempt({
          userId: user.id,
          email: lowerEmail,
          success: false,
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
          failureReason: "mfa_setup_required",
        });
        return res.status(403).json({
          requiresMfaSetup: true,
          message: "Two-factor authentication is required for your role. Enable 2FA in Security Center before signing in.",
        });
      }

      if (!totpCode) {
        return res.status(200).json({ requires2FA: true, message: "Please enter your 2FA code" });
      }

      const isValid = authenticator.verify({ token: totpCode, secret: user.twofa_secret });
      if (!isValid) {
        await recordLoginAttempt({
          userId: user.id,
          email: lowerEmail,
          success: false,
          ipAddress: req.ip,
          userAgent: req.get("user-agent"),
          failureReason: "invalid_2fa",
        });
        return res.status(401).json({ error: "Invalid 2FA code" });
      }
    }

    const token = jwt.sign({ id: user.id, email: user.email, role: effectiveRole }, JWT_SECRET, {
      expiresIn: "7d",
    });

    res.cookie("ifcdc_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    await logAudit(req, { action: "LOGIN", targetType: "USER", targetId: user.id, extra: {} });

    await recordLoginAttempt({
      userId: user.id,
      email: lowerEmail,
      success: true,
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });
    const sessionId = await recordActiveSession({
      userId: user.id,
      email: lowerEmail,
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });
    await enforceSessionPolicyOnLogin(user.id, sessionId);

    return res.json({
      message: "Logged in",
      role: effectiveRole,
      user: { id: user.id, name: user.name, email: user.email, role: effectiveRole },
    });
  } catch (err) {
    console.error("Login error", err);
    return res.status(500).json({ error: "Server error" });
  }
}

export function createAuthRouter(): Router {
  const router = Router();

  router.post("/register", async (req, res) => {
    try {
      const { name, email, password } = req.body;

      if (!name || !email || !password) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      const lowerEmail = email.toLowerCase();
      const db = getMonolithDb();

      const existing = await db.get("SELECT 1 FROM users WHERE email = ?", lowerEmail);
      if (existing) {
        return res.status(409).json({ error: "Email already registered" });
      }

      const finalRole = assignRole(lowerEmail, MASTER_OWNER_EMAIL);
      const id = cryptoRandomId();
      const password_hash = await bcrypt.hash(password, 10);
      const created_at = new Date().toISOString();

      await db.run(
        `INSERT INTO users (id, name, email, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        id,
        name,
        lowerEmail,
        finalRole,
        password_hash,
        created_at,
      );

      await logAudit(req, { action: "REGISTER", targetType: "USER", targetId: id, extra: { role: finalRole } });

      return res.status(201).json({ message: "User created", role: finalRole });
    } catch (err) {
      console.error("Register error", err);
      return res.status(500).json({ error: "Server error" });
    }
  });

  router.post("/login", handleLogin);
  router.post("/logout", (_req, res) => {
    res.clearCookie("ifcdc_token");
    return res.json({ message: "Logged out" });
  });
  router.get("/me", authRequired, (req, res) => res.json({ user: req.user }));

  router.post("/2fa/setup", authRequired, async (req, res) => {
    try {
      const userId = req.user?.id;
      const db = getMonolithDb();
      const user = await db.get<any>("SELECT * FROM users WHERE id = ?", userId);

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const secret = authenticator.generateSecret();
      const otpauthUrl = authenticator.keyuri(user.email, "IFCDC", secret);
      const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

      await db.run("UPDATE users SET twofa_secret = ? WHERE id = ?", secret, userId);

      res.json({
        secret,
        qrCode: qrCodeDataUrl,
        message: "Scan the QR code with your authenticator app, then verify with a code",
      });
    } catch (err) {
      console.error("2FA setup error:", err);
      res.status(500).json({ error: "Failed to setup 2FA" });
    }
  });

  router.post("/2fa/verify", authRequired, async (req, res) => {
    try {
      const { code } = req.body;
      const userId = req.user?.id;

      if (!code) {
        return res.status(400).json({ error: "6-digit code required" });
      }

      const db = getMonolithDb();
      const user = await db.get<any>("SELECT * FROM users WHERE id = ?", userId);

      if (!user || !user.twofa_secret) {
        return res.status(400).json({ error: "Please generate a 2FA secret first" });
      }

      const isValid = authenticator.verify({ token: code, secret: user.twofa_secret });
      if (!isValid) {
        return res.status(401).json({ error: "Invalid code. Please try again." });
      }

      await db.run("UPDATE users SET twofa_enabled = 1 WHERE id = ?", userId);
      await logAudit(req, { action: "ENABLE_2FA", targetType: "USER", targetId: userId });

      res.json({ success: true, message: "2FA enabled successfully" });
    } catch (err) {
      console.error("2FA verify error:", err);
      res.status(500).json({ error: "Failed to verify 2FA" });
    }
  });

  router.post("/2fa/disable", authRequired, async (req, res) => {
    try {
      const { code, password } = req.body;
      const userId = req.user?.id;
      const db = getMonolithDb();
      const user = await db.get<any>("SELECT * FROM users WHERE id = ?", userId);

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      if (roleRequiresMfa(req.user!.role)) {
        return res.status(403).json({
          error: "MFA cannot be disabled for privileged roles",
          message: "Two-factor authentication is mandatory for your account role.",
        });
      }

      if (password) {
        const ok = await bcrypt.compare(password, user.password_hash);
        if (!ok) {
          return res.status(401).json({ error: "Invalid password" });
        }
      } else if (code) {
        const isValid = authenticator.verify({ token: code, secret: user.twofa_secret });
        if (!isValid) {
          return res.status(401).json({ error: "Invalid 2FA code" });
        }
      } else {
        return res.status(400).json({ error: "Password or 2FA code required" });
      }

      await db.run("UPDATE users SET twofa_enabled = 0, twofa_secret = NULL WHERE id = ?", userId);
      await logAudit(req, { action: "DISABLE_2FA", targetType: "USER", targetId: userId });

      res.json({ success: true, message: "2FA disabled" });
    } catch (err) {
      console.error("2FA disable error:", err);
      res.status(500).json({ error: "Failed to disable 2FA" });
    }
  });

  router.get("/2fa/status", authRequired, async (req, res) => {
    try {
      const userId = req.user?.id;
      const db = getMonolithDb();
      const user = await db.get<any>("SELECT twofa_enabled FROM users WHERE id = ?", userId);
      res.json({
        enabled: !!user?.twofa_enabled,
        required: roleRequiresMfa(req.user!.role),
      });
    } catch (err) {
      console.error("2FA status error:", err);
      res.status(500).json({ error: "Failed to get 2FA status" });
    }
  });

  return router;
}

export function registerLegacyAuthRoutes(app: import("express").Express): void {
  const authRouter = createAuthRouter();
  app.use("/api/auth", authRouter);
  app.use("/auth", authRouter);

  app.get("/auth/google", (req, res) => {
    const googleOAuthConfig = getGoogleOAuthConfig();
    if (!isGoogleOAuthConfigured() || !googleOAuthConfig) {
      return res.status(503).json({ error: "Google OAuth not configured" });
    }

    const redirectUri = `${req.protocol}://${req.get("host")}/auth/google/callback`;
    const state = Math.random().toString(36).substring(2);

    const authUrl = client.buildAuthorizationUrl(googleOAuthConfig, {
      redirect_uri: redirectUri,
      scope: "openid email profile",
      state,
    });

    res.cookie("oauth_state", state, { httpOnly: true, maxAge: 600000 });
    res.redirect(authUrl.href);
  });

  app.get("/auth/google/callback", async (req, res) => {
    try {
      const googleOAuthConfig = getGoogleOAuthConfig();
      if (!isGoogleOAuthConfigured() || !googleOAuthConfig) {
        return res.redirect("/login.html?error=google_not_configured");
      }

      const currentUrl = new URL(`${req.protocol}://${req.get("host")}${req.originalUrl}`);

      const tokens = await client.authorizationCodeGrant(googleOAuthConfig, currentUrl, {
        expectedState: req.cookies.oauth_state,
      });

      res.clearCookie("oauth_state");

      const claims = tokens.claims();
      if (!claims || !claims.email) {
        return res.redirect("/login.html?error=no_email");
      }

      const email = (claims.email as string).toLowerCase();
      const name = (claims.name as string) || email.split("@")[0];
      const picture = claims.picture as string | undefined;
      const db = getMonolithDb();

      let user = await db.get<any>("SELECT * FROM users WHERE email = ?", email);

      if (!user) {
        const id = cryptoRandomId();
        const finalRole = assignRole(email, MASTER_OWNER_EMAIL);
        const created_at = new Date().toISOString();

        await db.run(
          `INSERT INTO users (id, name, email, role, created_at, profile_image_url) VALUES (?, ?, ?, ?, ?, ?)`,
          id,
          name,
          email,
          finalRole,
          created_at,
          picture || null,
        );

        user = await db.get<any>("SELECT * FROM users WHERE id = ?", id);

        await logAudit(req, {
          action: "GOOGLE_REGISTER",
          targetType: "USER",
          targetId: id,
          extra: { email },
        });
      }

      if (user.status !== "active") {
        return res.redirect("/login.html?error=account_restricted");
      }

      let effectiveRole = user.role;
      if (MASTER_OWNER_EMAIL && email === MASTER_OWNER_EMAIL.toLowerCase()) effectiveRole = "owner";
      else if (ADMIN_EMAIL && email === ADMIN_EMAIL.toLowerCase()) effectiveRole = "admin";

      const token = jwt.sign({ id: user.id, email: user.email, role: effectiveRole }, JWT_SECRET, {
        expiresIn: "7d",
      });
      res.cookie("ifcdc_token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });

      await logAudit(req, {
        action: "GOOGLE_LOGIN",
        targetType: "USER",
        targetId: user.id,
        extra: {},
      });

      if (effectiveRole === "admin" || effectiveRole === "owner" || effectiveRole === "exec") {
        return res.redirect("/admin/dashboard.html");
      }
      return res.redirect("/dashboard.html");
    } catch (err) {
      console.error("Google OAuth callback error:", err);
      return res.redirect("/login.html?error=oauth_failed");
    }
  });

  app.get("/auth/google/available", (_req, res) => {
    res.json({ available: isGoogleOAuthConfigured() });
  });
}
