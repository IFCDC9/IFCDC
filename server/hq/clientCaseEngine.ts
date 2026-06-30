/**
 * IFCDC Headquarters — Client & Case Management Engine (Phase 2 M2.1)
 * First-class HQ module with shared auth, people bridge, and executive reporting.
 */
import { getDb } from "../db";
import { toEnterpriseRole } from "./enterpriseRoles";
import { logHqAudit } from "./hqAuditLog";

const EXECUTIVE_ROLES = new Set(["founder", "executive", "administrator", "owner", "EXEC"]);

export async function hasClientAccessHq(
  user: { id?: string; role?: string } | undefined,
  clientId: string,
): Promise<boolean> {
  if (!user?.id) return false;
  const role = user.role || "";
  if (EXECUTIVE_ROLES.has(role) || EXECUTIVE_ROLES.has(toEnterpriseRole(role))) return true;
  const db = await getDb();
  const assignment = await db.get(
    "SELECT 1 FROM client_assignments WHERE client_id = ? AND user_id = ?",
    clientId,
    user.id,
  );
  return !!assignment;
}

export async function buildClientCaseOverview() {
  const db = await getDb();
  const totalClients = (await db.get<{ c: number }>("SELECT COUNT(*) as c FROM clients"))?.c ?? 0;
  const activeAssignments = (await db.get<{ c: number }>(
    "SELECT COUNT(DISTINCT client_id) as c FROM client_assignments",
  ))?.c ?? 0;
  const openGoals = (await db.get<{ c: number }>(
    "SELECT COUNT(*) as c FROM goals WHERE status != 'completed'",
  ))?.c ?? 0;
  const encounters30d = (await db.get<{ c: number }>(
    "SELECT COUNT(*) as c FROM encounters WHERE created_at >= datetime('now', '-30 days')",
  ))?.c ?? 0;
  const upcomingAppts = (await db.get<{ c: number }>(
    "SELECT COUNT(*) as c FROM appointments WHERE start_time >= datetime('now') AND start_time < datetime('now', '+14 days')",
  ))?.c ?? 0;
  const openOutreach = (await db.get<{ c: number }>(
    "SELECT COUNT(*) as c FROM outreach_tasks WHERE status = 'OPEN'",
  ))?.c ?? 0;
  const highRisk = (await db.get<{ c: number }>(`
    SELECT COUNT(DISTINCT a.client_id) as c FROM assessments a
    JOIN (
      SELECT client_id, MAX(created_at) as max_created FROM assessments WHERE type = 'RISK' GROUP BY client_id
    ) latest ON a.client_id = latest.client_id AND a.created_at = latest.max_created
    WHERE a.type = 'RISK' AND a.data LIKE '%HIGH%'
  `))?.c ?? 0;

  return {
    totalClients,
    activeAssignments,
    openGoals,
    encounters30d,
    upcomingAppointments: upcomingAppts,
    openOutreachTasks: openOutreach,
    highRiskClients: highRisk,
    generatedAt: new Date().toISOString(),
  };
}

export async function listClientsForUser(user: { id: string; role: string }) {
  const db = await getDb();
  const isExec = EXECUTIVE_ROLES.has(user.role) || EXECUTIVE_ROLES.has(toEnterpriseRole(user.role));

  const rows = isExec
    ? await db.all<any[]>(
        "SELECT id, full_name, date_of_birth, phone, email, programs, created_at FROM clients ORDER BY created_at DESC LIMIT 500",
      )
    : await db.all<any[]>(
        `SELECT DISTINCT c.id, c.full_name, c.date_of_birth, c.phone, c.email, c.programs, c.created_at
         FROM clients c JOIN client_assignments ca ON ca.client_id = c.id
         WHERE ca.user_id = ? ORDER BY c.created_at DESC`,
        user.id,
      );

  return rows.map((c) => ({
    id: c.id,
    fullName: c.full_name,
    dateOfBirth: c.date_of_birth,
    contactInfo: { phone: c.phone, email: c.email },
    programs: JSON.parse(c.programs || "[]"),
    createdAt: c.created_at,
  }));
}

export async function getClientDetail(clientId: string, user: { id: string; role: string }) {
  if (!(await hasClientAccessHq(user, clientId))) return null;
  const db = await getDb();
  const c = await db.get<any>("SELECT * FROM clients WHERE id = ?", clientId);
  if (!c) return null;
  return {
    id: c.id,
    fullName: c.full_name,
    dateOfBirth: c.date_of_birth,
    contactInfo: { phone: c.phone, email: c.email },
    programs: JSON.parse(c.programs || "[]"),
    notifyChannel: c.notify_channel,
    createdAt: c.created_at,
  };
}

export async function getClientSummary(clientId: string, user: { id: string; role: string }) {
  if (!(await hasClientAccessHq(user, clientId))) return null;
  const db = await getDb();
  const client = await db.get<any>("SELECT * FROM clients WHERE id = ?", clientId);
  if (!client) return null;

  const goals = await db.all<any[]>(
    "SELECT id, title, status, target_date FROM goals WHERE client_id = ? ORDER BY created_at DESC LIMIT 10",
    clientId,
  );
  const nextAppt = await db.get<any>(
    "SELECT id, start_time, program, location FROM appointments WHERE client_id = ? AND start_time >= datetime('now') ORDER BY start_time ASC LIMIT 1",
    clientId,
  );
  const lastEnc = await db.get<any>(
    "SELECT id, type, created_at FROM encounters WHERE client_id = ? ORDER BY created_at DESC LIMIT 1",
    clientId,
  );
  const peopleLink = await db.get<{ id: string }>(
    "SELECT id FROM people WHERE linked_external_id = ? AND source_app = 'case_management'",
    clientId,
  );

  return {
    client: {
      id: client.id,
      fullName: client.full_name,
      contactInfo: { phone: client.phone, email: client.email },
      programs: JSON.parse(client.programs || "[]"),
    },
    goals: goals.map((g) => ({ id: g.id, title: g.title, status: g.status, targetDate: g.target_date })),
    nextAppointment: nextAppt
      ? { id: nextAppt.id, startTime: nextAppt.start_time, program: nextAppt.program, location: nextAppt.location }
      : null,
    lastEncounter: lastEnc ? { id: lastEnc.id, type: lastEnc.type, createdAt: lastEnc.created_at } : null,
    peopleRegistry: peopleLink ? { personId: peopleLink.id, linked: true } : { linked: false },
  };
}

export async function listAppointmentsForUser(
  user: { id: string; role: string },
  from: string,
  to: string,
) {
  const db = await getDb();
  const isExec = EXECUTIVE_ROLES.has(user.role) || EXECUTIVE_ROLES.has(toEnterpriseRole(user.role));

  const rows = isExec
    ? await db.all<any[]>(
        `SELECT a.id, a.client_id, a.program, a.start_time, a.end_time, a.location, c.full_name as client_name
         FROM appointments a JOIN clients c ON c.id = a.client_id
         WHERE a.start_time >= ? AND a.start_time <= ? ORDER BY a.start_time ASC`,
        from,
        to,
      )
    : await db.all<any[]>(
        `SELECT DISTINCT a.id, a.client_id, a.program, a.start_time, a.end_time, a.location, c.full_name as client_name
         FROM appointments a JOIN clients c ON c.id = a.client_id
         JOIN client_assignments ca ON ca.client_id = c.id
         WHERE ca.user_id = ? AND a.start_time >= ? AND a.start_time <= ?
         ORDER BY a.start_time ASC`,
        user.id,
        from,
        to,
      );

  return rows.map((a) => ({
    id: a.id,
    clientId: a.client_id,
    clientName: a.client_name,
    program: a.program,
    startTime: a.start_time,
    endTime: a.end_time,
    location: a.location,
  }));
}

/** Bridge client record to HQ people registry (person_type: client). */
export async function linkClientToPeopleRegistry(clientId: string, actorEmail?: string) {
  const db = await getDb();
  const client = await db.get<{ id: string; full_name: string; phone: string; email: string }>(
    "SELECT id, full_name, phone, email FROM clients WHERE id = ?",
    clientId,
  );
  if (!client) return { ok: false, error: "Client not found" };

  const existing = await db.get<{ id: string }>(
    "SELECT id FROM people WHERE linked_external_id = ? AND source_app = 'case_management'",
    clientId,
  );
  if (existing) return { ok: true, personId: existing.id, linked: true };

  const now = new Date().toISOString();
  const personId = `person_${Date.now().toString(36)}`;
  const parts = (client.full_name || "Client").split(" ");
  await db.run(
    `INSERT INTO people (id, first_name, last_name, email, phone, person_type, status, source_app, linked_external_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'client', 'active', 'case_management', ?, ?, ?)`,
    personId,
    parts[0] || "Client",
    parts.slice(1).join(" ") || "",
    client.email,
    client.phone,
    clientId,
    now,
    now,
  );

  await logHqAudit({
    action: "CLIENT_PEOPLE_LINK",
    entityType: "client",
    entityId: clientId,
    actorEmail,
    metadata: { personId },
  });

  return { ok: true, personId, linked: false };
}

export async function buildClientCaseExecutiveSummary() {
  const overview = await buildClientCaseOverview();
  const db = await getDb();

  const byProgram = (await db.all<{ program: string; count: number }[]>(`
    SELECT json_each.value as program, COUNT(*) as count
    FROM clients, json_each(clients.programs)
    GROUP BY program ORDER BY count DESC LIMIT 8
  `).catch(() => [])) as { program: string; count: number }[];

  return {
    overview,
    caseloadByProgram: byProgram,
    hqModule: "clients",
    integration: {
      auth: "hq",
      reporting: "/api/hq/analytics/overview",
      peopleBridge: "/api/hq/clients/:id/link-people",
    },
    generatedAt: new Date().toISOString(),
  };
}
