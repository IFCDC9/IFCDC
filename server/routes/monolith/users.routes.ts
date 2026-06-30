import { Router } from "express";
import bcrypt from "bcryptjs";
import { authRequired, requireRole } from "../../middleware/legacyAuth";
import { getMonolithDb } from "../../monolith/dbAccess";
import { logAudit } from "../../monolith/audit";
import { cryptoRandomId, ROLES, ROLE_VALUES } from "../../monolith/constants";

export function createUsersRouter(): Router {
  const router = Router();

// ----- Users -----
router.post("/users", authRequired, requireRole(ROLES.EXEC), async (req, res) => {
  const { name, email, role, password } = req.body || {};
  if (!name || !email || !role || !password) {
    return res.status(400).json({ error: "name, email, role, password are required" });
  }
  if (!ROLE_VALUES.includes(role)) {
    return res.status(400).json({ error: "Invalid role" });
  }

  const db = getMonolithDb();
  const existing = await db.get("SELECT 1 FROM users WHERE email = ?", email);
  if (existing) {
    return res.status(409).json({ error: "Email already in use" });
  }

  const id = cryptoRandomId();
  const password_hash = await bcrypt.hash(password, 10);
  const created_at = new Date().toISOString();

  await db.run(
    `INSERT INTO users (id, name, email, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    id, name, email, role, password_hash, created_at
  );

  await logAudit(req, { action: "CREATE_USER", targetType: "USER", targetId: id, extra: { createdRole: role } });

  res.status(201).json({ id, name, email, role, created_at });
});

router.get("/users", authRequired, requireRole(ROLES.EXEC), async (req, res) => {
  const db = getMonolithDb();
  const rows = await db.all("SELECT id, name, email, role, status, created_at FROM users ORDER BY created_at DESC");
  await logAudit(req, { action: "LIST_USERS", targetType: "USER", targetId: null, extra: { count: rows.length } });
  res.json(rows);
});

// Update user status (reinstate, suspend, etc.)
router.patch("/users/:id/status", authRequired, requireRole(ROLES.EXEC, ROLES.ADMIN), async (req, res) => {
  const { id } = req.params;
  const { status, reason } = req.body;
  
  if (!status || !['active', 'suspended', 'pending_review'].includes(status)) {
    return res.status(400).json({ error: "Valid status required: active, suspended, pending_review" });
  }
  
  const db = getMonolithDb();
  const user = await db.get<any>("SELECT * FROM users WHERE id = ?", id);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }
  
  const previousStatus = user.status || 'active';
  await db.run("UPDATE users SET status = ? WHERE id = ?", status, id);
  
  await logAudit(req, { 
    action: status === 'active' ? "REINSTATE_USER" : "UPDATE_USER_STATUS", 
    targetType: "USER", 
    targetId: id, 
    extra: { previousStatus, newStatus: status, reason: reason || null } 
  });
  
  res.json({ 
    message: status === 'active' ? 'User reinstated successfully' : 'User status updated',
    id,
    status,
    previousStatus
  });
});


  return router;
}

export function registerUsersRoutes(app: import("express").Express): void {
  app.use("/api", createUsersRouter());
}
