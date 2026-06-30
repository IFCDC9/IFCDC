import { ROLES } from "./constants";
import { getMonolithDb } from "./dbAccess";

export async function buildVolumeReportForUser(user: { id: string; role: string }, from: string, to: string, programFilter: string | null) {
  const db = getMonolithDb();
  const isExec = user.role === ROLES.EXEC;
  const userId = user.id;

  // ---- Clients served ----
  let clientsServedRow;
  if (isExec) {
    const params: any[] = [from, to, from, to];
    const whereProgramClauseAppt = programFilter ? " AND a.program = ?" : "";
    const whereProgramClauseEnc = programFilter ? " AND e.program = ?" : "";

    const clientsQuery = `
      SELECT COUNT(DISTINCT client_id) as count FROM (
        SELECT a.client_id
        FROM appointments a
        WHERE a.start_time >= ? AND a.start_time < ?${whereProgramClauseAppt}
        UNION ALL
        SELECT e.client_id
        FROM encounters e
        WHERE e.created_at >= ? AND e.created_at < ?${whereProgramClauseEnc}
      )
    `;

    if (programFilter) {
      params.push(programFilter, programFilter);
    }

    clientsServedRow = await db.get<{ count: number }>(clientsQuery, ...params);
  } else {
    const params: any[] = [userId, from, to, userId, from, to];
    const whereProgramClauseAppt = programFilter ? " AND a.program = ?" : "";
    const whereProgramClauseEnc = programFilter ? " AND e.program = ?" : "";
    if (programFilter) {
      params.push(programFilter, programFilter);
    }

    const clientsQuery = `
      SELECT COUNT(DISTINCT client_id) as count FROM (
        SELECT a.client_id
        FROM appointments a
        JOIN client_assignments ca ON ca.client_id = a.client_id
        WHERE ca.user_id = ?
          AND a.start_time >= ? AND a.start_time < ?${whereProgramClauseAppt}
        UNION ALL
        SELECT e.client_id
        FROM encounters e
        JOIN client_assignments ca2 ON ca2.client_id = e.client_id
        WHERE ca2.user_id = ?
          AND e.created_at >= ? AND e.created_at < ?${whereProgramClauseEnc}
      )
    `;
    clientsServedRow = await db.get<{ count: number }>(clientsQuery, ...params);
  }
  const totalClientsServed = clientsServedRow?.count || 0;

  // ---- Appointments ----
  let totalAppointmentsRow;
  let apptsByProgramRows;

  if (isExec) {
    const baseParams: any[] = [from, to];
    const whereProgram = programFilter ? " AND program = ?" : "";
    const params = programFilter ? [...baseParams, programFilter] : baseParams;

    totalAppointmentsRow = await db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM appointments WHERE start_time >= ? AND start_time < ?${whereProgram}`,
      ...params
    );

    apptsByProgramRows = await db.all<{ program: string; count: number }[]>(
      `SELECT program, COUNT(*) as count FROM appointments WHERE start_time >= ? AND start_time < ?${whereProgram} GROUP BY program`,
      ...params
    );
  } else {
    const baseParams: any[] = [userId, from, to];
    const whereProgram = programFilter ? " AND a.program = ?" : "";
    const params = programFilter ? [...baseParams, programFilter] : baseParams;

    totalAppointmentsRow = await db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM appointments a JOIN client_assignments ca ON ca.client_id = a.client_id WHERE ca.user_id = ? AND a.start_time >= ? AND a.start_time < ?${whereProgram}`,
      ...params
    );

    apptsByProgramRows = await db.all<{ program: string; count: number }[]>(
      `SELECT a.program, COUNT(*) as count FROM appointments a JOIN client_assignments ca ON ca.client_id = a.client_id WHERE ca.user_id = ? AND a.start_time >= ? AND a.start_time < ?${whereProgram} GROUP BY a.program`,
      ...params
    );
  }

  const totalAppointments = totalAppointmentsRow?.count || 0;
  const appointmentsByProgram = (apptsByProgramRows || []).map((r) => ({
    program: r.program,
    count: r.count,
  }));

  // ---- Encounters ----
  let totalEncountersRow;
  let encountersByTypeRows;

  if (isExec) {
    const baseParams: any[] = [from, to];
    const whereProgram = programFilter ? " AND program = ?" : "";
    const params = programFilter ? [...baseParams, programFilter] : baseParams;

    totalEncountersRow = await db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM encounters WHERE created_at >= ? AND created_at < ?${whereProgram}`,
      ...params
    );

    encountersByTypeRows = await db.all<{ type: string; count: number }[]>(
      `SELECT type, COUNT(*) as count FROM encounters WHERE created_at >= ? AND created_at < ?${whereProgram} GROUP BY type`,
      ...params
    );
  } else {
    const baseParams: any[] = [userId, from, to];
    const whereProgram = programFilter ? " AND e.program = ?" : "";
    const params = programFilter ? [...baseParams, programFilter] : baseParams;

    totalEncountersRow = await db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM encounters e JOIN client_assignments ca ON ca.client_id = e.client_id WHERE ca.user_id = ? AND e.created_at >= ? AND e.created_at < ?${whereProgram}`,
      ...params
    );

    encountersByTypeRows = await db.all<{ type: string; count: number }[]>(
      `SELECT e.type, COUNT(*) as count FROM encounters e JOIN client_assignments ca ON ca.client_id = e.client_id WHERE ca.user_id = ? AND e.created_at >= ? AND e.created_at < ?${whereProgram} GROUP BY e.type`,
      ...params
    );
  }

  const totalEncounters = totalEncountersRow?.count || 0;
  const encountersByType = (encountersByTypeRows || []).map((r) => ({
    type: r.type,
    count: r.count,
  }));

  return {
    from,
    to,
    program: programFilter,
    totalClientsServed,
    totalAppointments,
    totalEncounters,
    appointmentsByProgram,
    encountersByType,
  };
}

export async function buildRiskMixReportForUser(user: { id: string; role: string }) {
  const db = getMonolithDb();
  const isExec = user.role === ROLES.EXEC;
  const userId = user.id;

  let rows;
  if (isExec) {
    rows = await db.all<{ client_id: string; data: string }[]>(`
      SELECT a.client_id, a.data
      FROM assessments a
      JOIN (
        SELECT client_id, MAX(created_at) AS max_created_at
        FROM assessments
        WHERE type = 'RISK'
        GROUP BY client_id
      ) latest
        ON a.client_id = latest.client_id
       AND a.created_at = latest.max_created_at
      WHERE a.type = 'RISK'
    `);
  } else {
    rows = await db.all<{ client_id: string; data: string }[]>(
      `
      SELECT a.client_id, a.data
      FROM assessments a
      JOIN (
        SELECT client_id, MAX(created_at) AS max_created_at
        FROM assessments
        WHERE type = 'RISK'
        GROUP BY client_id
      ) latest
        ON a.client_id = latest.client_id
       AND a.created_at = latest.max_created_at
      JOIN client_assignments ca ON ca.client_id = a.client_id
      WHERE a.type = 'RISK'
        AND ca.user_id = ?
    `,
      userId
    );
  }

  const suicideCounts: Record<string, number> = { LOW: 0, MODERATE: 0, HIGH: 0, UNKNOWN: 0 };
  const violenceCounts: Record<string, number> = { LOW: 0, MODERATE: 0, HIGH: 0, UNKNOWN: 0 };

  let totalWithRisk = 0;

  for (const row of rows || []) {
    try {
      const data = JSON.parse(row.data || "{}");

      let s = (data.suicideRisk || "UNKNOWN").toString().toUpperCase();
      let v = (data.violenceRisk || "UNKNOWN").toString().toUpperCase();

      if (!["LOW", "MODERATE", "HIGH"].includes(s)) s = "UNKNOWN";
      if (!["LOW", "MODERATE", "HIGH"].includes(v)) v = "UNKNOWN";

      suicideCounts[s] = (suicideCounts[s] || 0) + 1;
      violenceCounts[v] = (violenceCounts[v] || 0) + 1;
      totalWithRisk++;
    } catch (_) {
      // ignore bad JSON
    }
  }

  return {
    totalWithRisk,
    suicideRisk: suicideCounts,
    violenceRisk: violenceCounts,
  };
}

export async function buildProgramDashboardForUser(user: { id: string; role: string }, programCode: string, from: string, to: string) {
  const db = getMonolithDb();
  const isExec = user.role === ROLES.EXEC;
  const userId = user.id;

  // ---- Clients in this program ----
  let clientsRow;
  if (isExec) {
    clientsRow = await db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM clients WHERE programs LIKE ?`,
      `%"${programCode}"%`
    );
  } else {
    clientsRow = await db.get<{ count: number }>(
      `SELECT COUNT(DISTINCT c.id) as count
       FROM clients c
       JOIN client_assignments ca ON ca.client_id = c.id
       WHERE ca.user_id = ? AND c.programs LIKE ?`,
      userId,
      `%"${programCode}"%`
    );
  }
  const totalClientsInProgram = clientsRow?.count || 0;

  // ---- Goals (all time: active; in range: completed) ----
  let activeGoalsRow;
  let completedGoalsRow;

  if (isExec) {
    activeGoalsRow = await db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM goals WHERE program = ? AND status = 'ACTIVE'`,
      programCode
    );
    completedGoalsRow = await db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM goals
       WHERE program = ? AND status = 'COMPLETED' AND completed_at >= ? AND completed_at < ?`,
      programCode, from, to
    );
  } else {
    activeGoalsRow = await db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM goals g
       JOIN client_assignments ca ON ca.client_id = g.client_id
       WHERE g.program = ? AND g.status = 'ACTIVE' AND ca.user_id = ?`,
      programCode, userId
    );
    completedGoalsRow = await db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM goals g
       JOIN client_assignments ca ON ca.client_id = g.client_id
       WHERE g.program = ? AND g.status = 'COMPLETED' AND g.completed_at >= ? AND g.completed_at < ? AND ca.user_id = ?`,
      programCode, from, to, userId
    );
  }
  const activeGoals = activeGoalsRow?.count || 0;
  const completedGoalsInRange = completedGoalsRow?.count || 0;

  // ---- Appointments & encounters in this program (in range) ----
  let apptRow;
  let encRow;
  let moveInRow;

  if (isExec) {
    apptRow = await db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM appointments WHERE program = ? AND start_time >= ? AND start_time < ?`,
      programCode, from, to
    );
    encRow = await db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM encounters WHERE program = ? AND created_at >= ? AND created_at < ?`,
      programCode, from, to
    );
    moveInRow = await db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM encounters WHERE program = ? AND type = 'MOVE_IN' AND created_at >= ? AND created_at < ?`,
      programCode, from, to
    );
  } else {
    apptRow = await db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM appointments a
       JOIN client_assignments ca ON ca.client_id = a.client_id
       WHERE a.program = ? AND a.start_time >= ? AND a.start_time < ? AND ca.user_id = ?`,
      programCode, from, to, userId
    );
    encRow = await db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM encounters e
       JOIN client_assignments ca ON ca.client_id = e.client_id
       WHERE e.program = ? AND e.created_at >= ? AND e.created_at < ? AND ca.user_id = ?`,
      programCode, from, to, userId
    );
    moveInRow = await db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM encounters e
       JOIN client_assignments ca ON ca.client_id = e.client_id
       WHERE e.program = ? AND e.type = 'MOVE_IN' AND e.created_at >= ? AND e.created_at < ? AND ca.user_id = ?`,
      programCode, from, to, userId
    );
  }

  const appointmentsInRange = apptRow?.count || 0;
  const encountersInRange = encRow?.count || 0;
  const moveInsInRange = moveInRow?.count || 0;

  return {
    program: programCode,
    from,
    to,
    totalClientsInProgram,
    activeGoals,
    completedGoalsInRange,
    appointmentsInRange,
    encountersInRange,
    moveInsInRange,
  };
}

export async function buildGoalsSummaryForUser(user: { id: string; role: string }, from: string, to: string) {
  const db = getMonolithDb();
  const isExec = user.role === ROLES.EXEC;
  const userId = user.id;

  let rows;
  if (isExec) {
    rows = await db.all<{ program: string; total_goals: number; completed_in_range: number }[]>(
      `SELECT program,
              COUNT(*) as total_goals,
              SUM(CASE WHEN status = 'COMPLETED' AND completed_at >= ? AND completed_at < ? THEN 1 ELSE 0 END) as completed_in_range
       FROM goals
       GROUP BY program`,
      from, to
    );
  } else {
    rows = await db.all<{ program: string; total_goals: number; completed_in_range: number }[]>(
      `SELECT g.program,
              COUNT(*) as total_goals,
              SUM(CASE WHEN g.status = 'COMPLETED' AND g.completed_at >= ? AND g.completed_at < ? THEN 1 ELSE 0 END) as completed_in_range
       FROM goals g
       JOIN client_assignments ca ON ca.client_id = g.client_id
       WHERE ca.user_id = ?
       GROUP BY g.program`,
      from, to, userId
    );
  }

  return (rows || []).map((r) => ({
    program: r.program,
    totalGoals: r.total_goals || 0,
    completedInRange: r.completed_in_range || 0,
  }));
}

