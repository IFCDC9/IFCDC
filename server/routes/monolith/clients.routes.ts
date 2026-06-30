import { Router } from "express";
import { authRequired, requireRole } from "../../middleware/legacyAuth";
import { getMonolithDb } from "../../monolith/dbAccess";
import { logAudit } from "../../monolith/audit";
import { cryptoRandomId, ROLES } from "../../monolith/constants";
import { hasClientAccess } from "../../monolith/clientAccess";
import { normalizeChannel } from "../../monolith/phoneUtils";

export function createClientsRouter(): Router {
  const router = Router();

router.post("/clients", authRequired, requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER), async (req, res) => {
  const { fullName, dateOfBirth, contactInfo, programs } = req.body || {};
  if (!fullName) {
    return res.status(400).json({ error: "fullName is required" });
  }

  const id = cryptoRandomId();
  const created_at = new Date().toISOString();
  const phone = contactInfo?.phone || null;
  const email = contactInfo?.email || null;
  const programsJson = JSON.stringify(Array.isArray(programs) ? programs : []);

  const db = getMonolithDb();
  await db.run(
    `INSERT INTO clients (id, full_name, date_of_birth, phone, email, programs, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id, fullName, dateOfBirth || null, phone, email, programsJson, created_at
  );

  await db.run(
    `INSERT INTO client_assignments (id, client_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)`,
    cryptoRandomId(), id, req.user!.id, req.user!.role, created_at
  );

  await logAudit(req, { action: "CREATE_CLIENT", targetType: "CLIENT", targetId: id, extra: { fullName } });

  res.status(201).json({
    id, fullName, dateOfBirth,
    contactInfo: { phone, email },
    programs: JSON.parse(programsJson),
    createdAt: created_at,
  });
});

router.get("/clients", authRequired, requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER), async (req, res) => {
  let rows;
  if (req.user!.role === ROLES.EXEC) {
    const db = getMonolithDb();
    rows = await db.all<any[]>(
      "SELECT id, full_name, date_of_birth, phone, email, programs, created_at FROM clients ORDER BY created_at DESC"
    );
  } else {
    const db = getMonolithDb();
    rows = await db.all<any[]>(
      `SELECT DISTINCT c.id, c.full_name, c.date_of_birth, c.phone, c.email,
                       c.programs, c.created_at
       FROM clients c
       JOIN client_assignments ca ON ca.client_id = c.id
       WHERE ca.user_id = ?
       ORDER BY c.created_at DESC`,
      req.user!.id
    );
  }

  const list = rows.map((c) => ({
    id: c.id,
    fullName: c.full_name,
    dateOfBirth: c.date_of_birth,
    contactInfo: { phone: c.phone, email: c.email },
    programs: JSON.parse(c.programs || "[]"),
    createdAt: c.created_at,
  }));

  await logAudit(req, { action: "LIST_CLIENTS", targetType: "CLIENT", targetId: null, extra: { count: list.length } });
  res.json(list);
});

router.get("/clients/:id", authRequired, requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER), async (req, res) => {
  const db = getMonolithDb();
  const c = await db.get<any>("SELECT id, full_name, date_of_birth, phone, email, programs, created_at FROM clients WHERE id = ?", req.params.id);
  if (!c) {
    return res.status(404).json({ error: "Client not found" });
  }

  if (!(await hasClientAccess(req.user, c.id))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  await logAudit(req, { action: "VIEW_CLIENT", targetType: "CLIENT", targetId: c.id });

  res.json({
    id: c.id,
    fullName: c.full_name,
    dateOfBirth: c.date_of_birth,
    contactInfo: { phone: c.phone, email: c.email },
    programs: JSON.parse(c.programs || "[]"),
    createdAt: c.created_at,
  });
});

router.post("/clients/:id/encounters", authRequired, requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER, ROLES.CHW), async (req, res) => {
  const { program, type, summary, note } = req.body || {};

  const db = getMonolithDb();
  const client = await db.get<{ id: string }>("SELECT id FROM clients WHERE id = ?", req.params.id);
  if (!client) {
    return res.status(404).json({ error: "Client not found" });
  }

  if (!(await hasClientAccess(req.user, client.id))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (!program || !type) {
    return res.status(400).json({ error: "program and type are required (e.g. 'MentalHealth', 'Screening')" });
  }

  const id = cryptoRandomId();
  const created_at = new Date().toISOString();

  await db.run(
    `INSERT INTO encounters (id, client_id, program, type, summary, note, created_by, created_by_role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, client.id, program, type, summary || "", note || "", req.user!.id, req.user!.role, created_at
  );

  await logAudit(req, { action: "CREATE_ENCOUNTER", targetType: "ENCOUNTER", targetId: id, extra: { clientId: client.id, program, type } });

  res.status(201).json({
    id,
    clientId: client.id,
    program, type, summary, note,
    createdBy: req.user!.id,
    createdByRole: req.user!.role,
    createdAt: created_at,
  });
});

router.get("/clients/:id/encounters", authRequired, requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER), async (req, res) => {
  const db = getMonolithDb();
  const client = await db.get<{ id: string }>("SELECT id FROM clients WHERE id = ?", req.params.id);
  if (!client) {
    return res.status(404).json({ error: "Client not found" });
  }

  if (!(await hasClientAccess(req.user, client.id))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const rows = await db.all<any[]>(
    "SELECT id, client_id, program, type, summary, note, created_by, created_by_role, created_at FROM encounters WHERE client_id = ? ORDER BY created_at DESC",
    client.id
  );

  await logAudit(req, { action: "LIST_ENCOUNTERS", targetType: "ENCOUNTER", targetId: null, extra: { clientId: client.id, count: rows.length } });

  res.json(rows.map((r) => ({
    id: r.id,
    clientId: r.client_id,
    program: r.program,
    type: r.type,
    summary: r.summary,
    note: r.note,
    createdBy: r.created_by,
    createdByRole: r.created_by_role,
    createdAt: r.created_at,
  })));
});

// ----- Client 360 Summary -----
router.get(
  "/clients/:id/summary",
  authRequired,
  requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER),
  async (req, res) => {
    const clientId = req.params.id;

    try {
      const db = getMonolithDb();
      const client = await db.get<{ id: string; full_name: string; date_of_birth: string; programs: string }>(
        "SELECT id, full_name, date_of_birth, programs FROM clients WHERE id = ?",
        clientId
      );
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }

      if (!(await hasClientAccess(req.user, client.id))) {
        return res.status(403).json({ error: "Forbidden" });
      }

      // ---- Latest RISK assessment ----
      const riskRow = await db.get<{ data: string; created_at: string }>(
        `SELECT data, created_at
         FROM assessments
         WHERE client_id = ? AND type = 'RISK'
         ORDER BY created_at DESC
         LIMIT 1`,
        clientId
      );

      let riskSummary: { suicideRisk: string | null; violenceRisk: string | null; safetyPlanNeeded: boolean; createdAt: string } | null = null;
      if (riskRow) {
        try {
          const data = JSON.parse(riskRow.data || "{}");
          riskSummary = {
            suicideRisk: data.suicideRisk || null,
            violenceRisk: data.violenceRisk || null,
            safetyPlanNeeded: !!data.safetyPlanNeeded,
            createdAt: riskRow.created_at,
          };
        } catch (_) {
          riskSummary = null;
        }
      }

      // ---- Next appointment ----
      const nowIso = new Date().toISOString();
      const nextAppt = await db.get<{ id: string; program: string; start_time: string; end_time: string; location: string }>(
        `SELECT id, program, start_time, end_time, location
         FROM appointments
         WHERE client_id = ? AND start_time >= ?
         ORDER BY start_time ASC
         LIMIT 1`,
        clientId,
        nowIso
      );

      let nextAppointment: { id: string; program: string; startTime: string; endTime: string; location: string } | null = null;
      if (nextAppt) {
        nextAppointment = {
          id: nextAppt.id,
          program: nextAppt.program,
          startTime: nextAppt.start_time,
          endTime: nextAppt.end_time,
          location: nextAppt.location,
        };
      }

      // ---- Last encounter ----
      const lastEnc = await db.get<{ id: string; type: string; program: string; note: string; created_at: string }>(
        `SELECT id, type, program, note, created_at
         FROM encounters
         WHERE client_id = ?
         ORDER BY created_at DESC
         LIMIT 1`,
        clientId
      );

      let lastEncounter: { id: string; type: string; program: string; notePreview: string; createdAt: string } | null = null;
      if (lastEnc) {
        lastEncounter = {
          id: lastEnc.id,
          type: lastEnc.type,
          program: lastEnc.program,
          notePreview: (lastEnc.note || "").slice(0, 120),
          createdAt: lastEnc.created_at,
        };
      }

      // ---- Active goals by program ----
      const goalsRows = await db.all<{ program: string; count: number }[]>(
        `SELECT program, COUNT(*) as count
         FROM goals
         WHERE client_id = ? AND status = 'ACTIVE'
         GROUP BY program`,
        clientId
      );

      const activeGoalsByProgram = goalsRows.map((g) => ({
        program: g.program,
        count: g.count,
      }));

      await logAudit(req, { action: "VIEW_CLIENT_SUMMARY", targetType: "CLIENT_SUMMARY", targetId: clientId, extra: {
        hasRisk: !!riskSummary,
        hasNextAppt: !!nextAppointment,
        hasLastEnc: !!lastEncounter,
      } });

      res.json({
        clientId: client.id,
        fullName: client.full_name,
        dateOfBirth: client.date_of_birth,
        programs: (() => {
          try {
            return JSON.parse(client.programs || "[]");
          } catch {
            return [];
          }
        })(),
        risk: riskSummary,
        nextAppointment,
        lastEncounter,
        activeGoalsByProgram,
      });
    } catch (err) {
      console.error("Error in /api/clients/:id/summary:", err);
      res.status(500).json({ error: "Failed to build client summary" });
    }
  }
);

// ----- Goals (per client, per program) -----

// List goals for a client
router.get("/clients/:id/goals", authRequired, requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER), async (req, res) => {
  const clientId = req.params.id;
  const db = getMonolithDb();
  const client = await db.get<{ id: string }>("SELECT id FROM clients WHERE id = ?", clientId);
  if (!client) {
    return res.status(404).json({ error: "Client not found" });
  }
  if (!(await hasClientAccess(req.user, client.id))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const rows = await db.all<any[]>(
    `SELECT id, program, title, status, notes, target_date, created_by, created_at, completed_at
     FROM goals WHERE client_id = ? ORDER BY status ASC, created_at DESC`,
    clientId
  );

  await logAudit(req, { action: "LIST_GOALS", targetType: "GOAL", targetId: null, extra: { clientId, count: rows.length } });

  res.json(rows.map((g) => ({
    id: g.id,
    clientId,
    program: g.program,
    title: g.title,
    status: g.status,
    notes: g.notes,
    targetDate: g.target_date,
    createdBy: g.created_by,
    createdAt: g.created_at,
    completedAt: g.completed_at,
  })));
});

// Create a goal for a client
router.post("/clients/:id/goals", authRequired, requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER), async (req, res) => {
  const clientId = req.params.id;
  const { program, title, notes, targetDate } = req.body || {};

  const db = getMonolithDb();
  const client = await db.get<{ id: string }>("SELECT id FROM clients WHERE id = ?", clientId);
  if (!client) {
    return res.status(404).json({ error: "Client not found" });
  }
  if (!(await hasClientAccess(req.user, client.id))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (!program || !title) {
    return res.status(400).json({ error: "program and title are required" });
  }

  const id = cryptoRandomId();
  const created_at = new Date().toISOString();

  await db.run(
    `INSERT INTO goals (id, client_id, program, title, status, notes, target_date, created_by, created_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    id, clientId, program, title, "ACTIVE", notes || "", targetDate || null, req.user!.id, created_at
  );

  await logAudit(req, { action: "CREATE_GOAL", targetType: "GOAL", targetId: id, extra: { clientId, program } });

  res.status(201).json({
    id,
    clientId,
    program,
    title,
    status: "ACTIVE",
    notes: notes || "",
    targetDate: targetDate || null,
    createdBy: req.user!.id,
    createdAt: created_at,
    completedAt: null,
  });
});

// ----- Client notification preferences -----
router.patch(
  "/clients/:id/notification-preferences",
  authRequired,
  requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER),
  async (req, res) => {
    const clientId = req.params.id;
    const { notifyChannel } = req.body || {};

    const db = getMonolithDb();
    const client = await db.get<{ id: string }>(
      "SELECT id FROM clients WHERE id = ?",
      clientId
    );
    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }
    if (!(await hasClientAccess(req.user, client.id))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    let value: string | null = notifyChannel;
    if (value != null) {
      value = normalizeChannel(value);
    }

    await db.run(
      `
      UPDATE clients
      SET notify_channel = ?
      WHERE id = ?
      `,
      value,
      clientId
    );

    await logAudit(req, { action: "UPDATE_NOTIFY_CHANNEL", targetType: "CLIENT", targetId: clientId, extra: {
      notifyChannel: value,
    } });

    res.json({ ok: true, notifyChannel: value });
  }
);

// Update goal status / notes
router.patch("/clients/:clientId/goals/:goalId", authRequired, requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER), async (req, res) => {
  const { clientId, goalId } = req.params;
  const { status, title, notes, targetDate } = req.body || {};

  const db = getMonolithDb();
  const client = await db.get<{ id: string }>("SELECT id FROM clients WHERE id = ?", clientId);
  if (!client) {
    return res.status(404).json({ error: "Client not found" });
  }
  if (!(await hasClientAccess(req.user, client.id))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const goal = await db.get<{ id: string; status: string; completed_at: string | null }>(
    "SELECT id, status, completed_at FROM goals WHERE id = ? AND client_id = ?",
    goalId, clientId
  );
  if (!goal) {
    return res.status(404).json({ error: "Goal not found" });
  }

  const newStatus = status || goal.status;
  const allowedStatuses = ["ACTIVE", "COMPLETED", "ON_HOLD"];
  if (status && !allowedStatuses.includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }

  const completed_at = newStatus === "COMPLETED" && goal.status !== "COMPLETED"
    ? new Date().toISOString()
    : goal.completed_at || null;

  await db.run(
    `UPDATE goals
     SET status = COALESCE(?, status),
         title = COALESCE(?, title),
         notes = COALESCE(?, notes),
         target_date = COALESCE(?, target_date),
         completed_at = ?
     WHERE id = ? AND client_id = ?`,
    newStatus, title || null, notes || null, targetDate || null, completed_at, goalId, clientId
  );

  await logAudit(req, { action: "UPDATE_GOAL", targetType: "GOAL", targetId: goalId, extra: { clientId, status: newStatus } });

  const updated = await db.get<any>(
    `SELECT id, program, title, status, notes, target_date, created_by, created_at, completed_at
     FROM goals WHERE id = ?`,
    goalId
  );

  res.json({
    id: updated.id,
    clientId,
    program: updated.program,
    title: updated.title,
    status: updated.status,
    notes: updated.notes,
    targetDate: updated.target_date,
    createdBy: updated.created_by,
    createdAt: updated.created_at,
    completedAt: updated.completed_at,
  });
});

// ----- Assessments (structured intake / risk) -----
router.post(
  "/clients/:id/assessments",
  authRequired,
  requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER),
  async (req, res) => {
    const clientId = req.params.id;
    const { type, data } = req.body || {};

    const db = getMonolithDb();
    const client = await db.get<{ id: string }>("SELECT id FROM clients WHERE id = ?", clientId);
    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    if (!(await hasClientAccess(req.user, client.id))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    if (!type || !data) {
      return res.status(400).json({ error: "type and data are required" });
    }

    const id = cryptoRandomId();
    const created_at = new Date().toISOString();

    await db.run(
      `INSERT INTO assessments (id, client_id, type, data, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      id, clientId, type, JSON.stringify(data), req.user!.id, created_at
    );

    await logAudit(req, { action: "CREATE_ASSESSMENT", targetType: "ASSESSMENT", targetId: id, extra: { type } });

    res.status(201).json({
      id,
      clientId,
      type,
      data,
      createdBy: req.user!.id,
      createdAt: created_at,
    });
  }
);

router.get(
  "/clients/:id/assessments",
  authRequired,
  requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER),
  async (req, res) => {
    const clientId = req.params.id;
    const db = getMonolithDb();
    const client = await db.get<{ id: string }>("SELECT id FROM clients WHERE id = ?", clientId);
    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    if (!(await hasClientAccess(req.user, client.id))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const rows = await db.all<any[]>(
      `SELECT id, type, data, created_by, created_at
       FROM assessments
       WHERE client_id = ?
       ORDER BY created_at DESC`,
      clientId
    );

    await logAudit(req, { action: "LIST_ASSESSMENTS", targetType: "ASSESSMENT", targetId: null, extra: {
      clientId,
      count: rows.length,
    } });

    res.json(
      rows.map((a) => ({
        id: a.id,
        clientId,
        type: a.type,
        data: JSON.parse(a.data || "{}"),
        createdBy: a.created_by,
        createdAt: a.created_at,
      }))
    );
  }
);

router.post("/clients/:id/assignments", authRequired, requireRole(ROLES.EXEC), async (req, res) => {
  const clientId = req.params.id;
  const { userId, role } = req.body || {};

  if (!userId || !role) {
    return res.status(400).json({ error: "userId and role are required" });
  }

  const db = getMonolithDb();
  const client = await db.get("SELECT id FROM clients WHERE id = ?", clientId);
  if (!client) {
    return res.status(404).json({ error: "Client not found" });
  }

  const user = await db.get("SELECT id, role FROM users WHERE id = ?", userId);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  if (user.role === ROLES.EXEC) {
    return res.status(400).json({ error: "Cannot assign EXEC as owner" });
  }

  const id = cryptoRandomId();
  const created_at = new Date().toISOString();

  await db.run(
    `INSERT INTO client_assignments (id, client_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)`,
    id, clientId, userId, role, created_at
  );

  await logAudit(req, { action: "CREATE_ASSIGNMENT", targetType: "CLIENT_ASSIGNMENT", targetId: id, extra: { clientId, userId, role } });

  res.status(201).json({
    id,
    clientId,
    userId,
    role,
    createdAt: created_at,
  });
});

router.get("/clients/:id/assignments", authRequired, requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER), async (req, res) => {
  const clientId = req.params.id;

  const db = getMonolithDb();
  const client = await db.get<{ id: string }>("SELECT id FROM clients WHERE id = ?", clientId);
  if (!client) {
    return res.status(404).json({ error: "Client not found" });
  }

  if (!(await hasClientAccess(req.user, client.id))) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const rows = await db.all<any[]>(`
    SELECT ca.id, ca.client_id, ca.user_id, ca.role, ca.created_at,
           u.name as user_name, u.email as user_email
    FROM client_assignments ca
    JOIN users u ON ca.user_id = u.id
    WHERE ca.client_id = ?
    ORDER BY ca.created_at DESC
  `, clientId);

  await logAudit(req, { action: "LIST_ASSIGNMENTS", targetType: "CLIENT_ASSIGNMENT", targetId: null, extra: { clientId, count: rows.length } });

  res.json(rows.map((r) => ({
    id: r.id,
    clientId: r.client_id,
    userId: r.user_id,
    userName: r.user_name,
    userEmail: r.user_email,
    role: r.role,
    createdAt: r.created_at,
  })));
});

router.delete("/clients/:id/assignments/:assignmentId", authRequired, requireRole(ROLES.EXEC), async (req, res) => {
  const db = getMonolithDb();
  const client = await db.get("SELECT id FROM clients WHERE id = ?", req.params.id);
  if (!client) {
    return res.status(404).json({ error: "Client not found" });
  }

  const assignment = await db.get(
    "SELECT id, user_id FROM client_assignments WHERE id = ? AND client_id = ?",
    req.params.assignmentId, client.id
  );
  if (!assignment) {
    return res.status(404).json({ error: "Assignment not found" });
  }

  await db.run("DELETE FROM client_assignments WHERE id = ?", assignment.id);

  await logAudit(req, { action: "REMOVE_ASSIGNMENT", targetType: "CLIENT_ASSIGNMENT", targetId: assignment.id, extra: { clientId: client.id, userId: assignment.user_id } });

  res.json({ message: "Assignment removed" });
});

router.post(
  "/clients/:id/appointments",
  authRequired,
  requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER),
  async (req, res) => {
    const clientId = req.params.id;
    const { program, startTime, endTime, location, notes } = req.body || {};

    const db = getMonolithDb();
    const client = await db.get<{ id: string }>("SELECT id FROM clients WHERE id = ?", clientId);
    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    if (!(await hasClientAccess(req.user, client.id))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    if (!program || !startTime) {
      return res.status(400).json({ error: "program and startTime are required" });
    }

    const id = cryptoRandomId();
    const created_at = new Date().toISOString();

    await db.run(
      `INSERT INTO appointments (id, client_id, program, start_time, end_time, location, notes, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, clientId, program, startTime, endTime || null, location || null, notes || "", req.user!.id, created_at
    );

    await logAudit(req, { action: "CREATE_APPOINTMENT", targetType: "APPOINTMENT", targetId: id, extra: { clientId, program, startTime } });

    res.status(201).json({
      id,
      clientId,
      program,
      startTime,
      endTime: endTime || null,
      location: location || null,
      notes: notes || "",
      createdBy: req.user!.id,
      createdAt: created_at,
    });
  }
);

router.get(
  "/clients/:id/appointments",
  authRequired,
  requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER),
  async (req, res) => {
    const clientId = req.params.id;

    const db = getMonolithDb();
    const client = await db.get<{ id: string }>("SELECT id FROM clients WHERE id = ?", clientId);
    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    if (!(await hasClientAccess(req.user, client.id))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const rows = await db.all<any[]>(
      `SELECT id, client_id, program, start_time, end_time, location, notes, created_by, created_at
       FROM appointments WHERE client_id = ? ORDER BY start_time ASC`,
      clientId
    );

    await logAudit(req, { action: "LIST_APPOINTMENTS", targetType: "APPOINTMENT", targetId: null, extra: { clientId, count: rows.length } });

    res.json(rows.map((a) => ({
      id: a.id,
      clientId: a.client_id,
      program: a.program,
      startTime: a.start_time,
      endTime: a.end_time,
      location: a.location,
      notes: a.notes,
      createdBy: a.created_by,
      createdAt: a.created_at,
    })));
  }
);

router.get(
  "/appointments",
  authRequired,
  requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER),
  async (req, res) => {
    let { from, to } = req.query as { from?: string; to?: string };

    const now = new Date();
    if (!from) {
      const start = new Date(now);
      start.setDate(start.getDate() - 1);
      from = start.toISOString();
    }
    if (!to) {
      const end = new Date(now);
      end.setDate(end.getDate() + 7);
      to = end.toISOString();
    }

    try {
      let rows;
      if (req.user!.role === ROLES.EXEC) {
        const db = getMonolithDb();
        rows = await db.all<any[]>(
          `SELECT a.id, a.client_id, a.program, a.start_time, a.end_time,
                  a.location, a.notes, a.created_by, a.created_at,
                  c.full_name as client_name, c.phone as client_phone
           FROM appointments a
           JOIN clients c ON a.client_id = c.id
           WHERE a.start_time >= ? AND a.start_time <= ?
           ORDER BY a.start_time ASC`,
          from, to
        );
      } else {
        const db = getMonolithDb();
        rows = await db.all<any[]>(
          `SELECT DISTINCT a.id, a.client_id, a.program, a.start_time, a.end_time,
                           a.location, a.notes, a.created_by, a.created_at,
                           c.full_name as client_name, c.phone as client_phone
           FROM appointments a
           JOIN clients c ON a.client_id = c.id
           JOIN client_assignments ca ON ca.client_id = c.id
           WHERE ca.user_id = ?
             AND a.start_time >= ?
             AND a.start_time <= ?
           ORDER BY a.start_time ASC`,
          req.user!.id, from, to
        );
      }

      await logAudit(req, { action: "LIST_APPOINTMENTS_BY_RANGE", targetType: "APPOINTMENT", targetId: null, extra: { from, to, count: rows.length } });

      res.json(rows.map((a) => ({
        id: a.id,
        clientId: a.client_id,
        clientName: a.client_name,
        clientPhone: a.client_phone,
        program: a.program,
        startTime: a.start_time,
        endTime: a.end_time,
        location: a.location,
        notes: a.notes,
        createdBy: a.created_by,
        createdAt: a.created_at,
      })));
    } catch (err) {
      console.error("Error listing appointments by range:", err);
      res.status(500).json({ error: "Failed to load appointments" });
    }
  }
);

  return router;
}

export function registerClientRoutes(app: import("express").Express): void {
  app.use("/api", createClientsRouter());
}
