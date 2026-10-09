import type { Express, Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { COOKIE_NAME, JWT_SECRET } from "../config/auth";
import { getMonolithDb } from "../monolith/dbAccess";
import { logAudit } from "../monolith/audit";

const EXEC_EMAIL = "exec@ifcdc.org";
const MIN_LENGTH = 12;
const MAX_LENGTH = 128;

type Actor = { id: string; email: string; role: string };

function readFounder(req: Request): Actor | null {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token || typeof token !== "string") return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { id?: string; email?: string; role?: string };
    const role = String(payload.role || "").toLowerCase();
    if (role !== "founder" && role !== "owner") return null;
    if (!payload.id) return null;
    return { id: payload.id, email: String(payload.email || ""), role };
  } catch {
    return null;
  }
}

function takeReplacement(req: Request): { replacement: string; confirm: string } {
  const body = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
  const replacement = typeof body.replacement === "string" ? body.replacement : "";
  const confirm = typeof body.confirm === "string" ? body.confirm : "";
  delete body.replacement;
  delete body.confirm;
  return { replacement, confirm };
}

function page(message: string, showForm: boolean): string {
  const form = showForm
    ? `<form method="post" action="/hq/exec-credential" autocomplete="off">
        <label>New password
          <input type="password" name="replacement" autocomplete="new-password" required minlength="12" maxlength="128" spellcheck="false">
        </label>
        <label>Confirm new password
          <input type="password" name="confirm" autocomplete="new-password" required minlength="12" maxlength="128" spellcheck="false">
        </label>
        <button type="submit">Store replacement</button>
      </form>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <meta name="robots" content="noindex">
  <title>Executive credential replacement</title>
</head>
<body>
  <h1>Executive credential replacement</h1>
  <p>This updates only the existing exec@ifcdc.org account. It does not change the role, email, or permissions.</p>
  <p>${message}</p>
  ${form}
</body>
</html>`;
}

function sendPage(res: Response, status: number, message: string, showForm: boolean): void {
  res.status(status);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.type("html");
  res.send(page(message, showForm));
}

export function registerExecCredentialReplacement(app: Express): void {
  app.get("/hq/exec-credential", (req, res) => {
    const founder = readFounder(req);
    if (!req.cookies?.[COOKIE_NAME]) {
      sendPage(res, 401, "Authentication required.", false);
      return;
    }
    if (!founder) {
      sendPage(res, 403, "Founder session required.", false);
      return;
    }
    sendPage(res, 200, "Enter the replacement here. It stays in this browser.", true);
  });

  app.post("/hq/exec-credential", async (req, res) => {
    const founder = readFounder(req);
    const { replacement, confirm } = takeReplacement(req);
    if (!req.cookies?.[COOKIE_NAME]) {
      sendPage(res, 401, "Authentication required.", false);
      return;
    }
    if (!founder) {
      sendPage(res, 403, "Founder session required.", false);
      return;
    }
    if (replacement.length < MIN_LENGTH || replacement.length > MAX_LENGTH || replacement !== confirm) {
      sendPage(res, 400, "Enter the same replacement twice, between 12 and 128 characters.", true);
      return;
    }

    try {
      const db = getMonolithDb();
      const rows = await db.all<{ id: string; email: string; role: string; status: string | null }[]>(
        "SELECT id, email, role, status FROM users WHERE lower(email) = lower(?)",
        EXEC_EMAIL,
      );
      if (rows.length !== 1) {
        sendPage(res, 409, "The executive account is not available for replacement.", false);
        return;
      }
      const account = rows[0];
      if (account.role.toUpperCase() !== "EXEC" || (account.status || "active").toLowerCase() !== "active") {
        sendPage(res, 409, "The executive account is not available for replacement.", false);
        return;
      }
      const passwordHash = await bcrypt.hash(replacement, 10);
      const updated = await db.run(
        "UPDATE users SET password_hash = ? WHERE id = ? AND lower(email) = lower(?) AND upper(role) = 'EXEC'",
        passwordHash,
        account.id,
        EXEC_EMAIL,
      );
      if ((updated.changes ?? 0) !== 1) {
        sendPage(res, 409, "The executive account is not available for replacement.", false);
        return;
      }
      req.user = { id: founder.id, email: founder.email, role: founder.role };
      try {
        await logAudit(req, {
          action: "EXEC_CREDENTIAL_REPLACED",
          targetType: "USER",
          targetId: account.id,
        });
      } catch {
        console.error("Executive credential audit write failed");
      }
      sendPage(
        res,
        200,
        "Replacement stored. Sign in as exec@ifcdc.org in a separate browser. Do not send the password in chat.",
        false,
      );
    } catch {
      sendPage(res, 500, "Unable to update the credential.", true);
    }
  });
}
