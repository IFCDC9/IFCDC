import type { Twilio } from "twilio";
import { getMonolithDb } from "./dbAccess";
import { cryptoRandomId } from "./constants";
import { logAudit } from "./audit";
import {
  buildSafeAppointmentReminderText,
  isSmsAllowedForChannel,
  normalizeChannel,
  normalizePhone,
} from "./phoneUtils";

async function appointmentNotificationExists(
  appointmentId: string,
  channel: string,
  leadHours: number,
): Promise<boolean> {
  const db = getMonolithDb();
  const row = await db.get(
    `SELECT 1 FROM appointment_notifications WHERE appointment_id = ? AND channel = ? AND lead_hour = ? LIMIT 1`,
    appointmentId,
    channel,
    leadHours,
  );
  return !!row;
}

async function getProgramLeadHoursMap(): Promise<Record<string, { sms: number | null; voice: number | null }>> {
  const db = getMonolithDb();
  const rows = await db.all<any[]>(`SELECT code, default_sms_lead_hours, default_voice_lead_hours FROM programs`);
  const map: Record<string, { sms: number | null; voice: number | null }> = {};
  for (const r of rows) {
    map[r.code] = { sms: r.default_sms_lead_hours, voice: r.default_voice_lead_hours };
  }
  return map;
}

function resolveSmsLeadHours(
  programCode: string,
  programMap: Record<string, { sms: number | null; voice: number | null }>,
  globalFallbackHours: number,
): number {
  const entry = programMap[programCode] || {};
  const v = entry.sms;
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  return globalFallbackHours;
}

async function findSmsReminderCandidates(
  programMap: Record<string, { sms: number | null; voice: number | null }>,
  globalFallbackHours: number,
): Promise<any[]> {
  const db = getMonolithDb();
  const now = new Date();
  const windowEnd = new Date(now.getTime() + 96 * 60 * 60 * 1000);
  const rows = await db.all<any[]>(
    `SELECT a.id, a.client_id, a.program, a.start_time, a.location, c.full_name, c.phone, c.notify_channel
     FROM appointments a JOIN clients c ON c.id = a.client_id
     WHERE a.start_time >= ? AND a.start_time < ? AND c.phone IS NOT NULL AND c.phone <> ''
     ORDER BY a.start_time ASC`,
    now.toISOString(),
    windowEnd.toISOString(),
  );

  const candidates: any[] = [];
  for (const appt of rows) {
    if (!isSmsAllowedForChannel(appt.notify_channel)) continue;
    const leadHours = resolveSmsLeadHours(appt.program || "", programMap, globalFallbackHours);
    if (!leadHours || leadHours <= 0) continue;
    const diffHours = (new Date(appt.start_time).getTime() - now.getTime()) / (60 * 60 * 1000);
    if (diffHours < leadHours || diffHours >= leadHours + 24) continue;
    if (await appointmentNotificationExists(appt.id, "SMS", leadHours)) continue;
    candidates.push({ ...appt, leadHours });
  }
  return candidates;
}

async function recordAppointmentNotification(
  appointmentId: string,
  channel: string,
  leadHours: number,
  status: string,
  errorMessage?: string | null,
) {
  const db = getMonolithDb();
  await db.run(
    `INSERT INTO appointment_notifications (id, appointment_id, channel, lead_hour, status, error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    cryptoRandomId(),
    appointmentId,
    channel,
    leadHours,
    status,
    errorMessage || null,
    new Date().toISOString(),
  );
}

export async function runAppointmentReminderCron(opts: {
  twilioClient: Twilio | null;
  twilioSmsFrom: string | undefined;
  cronSecret: string | undefined;
  globalFallbackHours: number;
  providedToken: string | undefined;
  sendSms: (to: string, body: string) => Promise<unknown>;
}) {
  if (!opts.cronSecret || opts.providedToken !== opts.cronSecret) {
    return { status: 403 as const, body: { error: "Forbidden" } };
  }
  if (!opts.twilioClient) {
    return { status: 500 as const, body: { error: "Twilio not configured on this server." } };
  }
  if (!Number.isFinite(opts.globalFallbackHours) || opts.globalFallbackHours <= 0) {
    return { status: 500 as const, body: { error: "Invalid APPT_REMINDER_LEAD_HOURS configuration." } };
  }

  const programMap = await getProgramLeadHoursMap();
  const upcoming = await findSmsReminderCandidates(programMap, opts.globalFallbackHours);
  let attempted = 0;
  let sent = 0;
  const failures: Array<{ appointmentId: string; error: string }> = [];
  const db = getMonolithDb();

  for (const appt of upcoming) {
    attempted++;
    const body = buildSafeAppointmentReminderText({ fullName: appt.full_name }, appt);
    try {
      await opts.sendSms(appt.phone, body);
      await recordAppointmentNotification(appt.id, "SMS", appt.leadHours, "SENT", null);
      await db.run(
        `INSERT INTO outreach_tasks (id, client_id, phone, channel, reason, status, created_at) VALUES (?, ?, ?, ?, ?, 'OPEN', ?)`,
        cryptoRandomId(),
        appt.client_id,
        normalizePhone(appt.phone),
        "SMS",
        "Automated appointment reminder sent",
        new Date().toISOString(),
      );
      sent++;
    } catch (err: any) {
      await recordAppointmentNotification(appt.id, "SMS", appt.leadHours, "FAILED", err.message);
      failures.push({ appointmentId: appt.id, error: err.message });
    }
  }

  await logAudit(
    { user: { id: "cron", role: "SYSTEM" }, method: "POST", originalUrl: "/api/cron/send-upcoming-reminders" } as any,
    {
      action: "AUTO_SEND_APPOINTMENT_REMINDERS",
      targetType: "CRON",
      targetId: null,
      extra: { globalFallbackHours: opts.globalFallbackHours, totalCandidates: upcoming.length, attempted, sent, failures: failures.length },
    },
  );

  return {
    status: 200 as const,
    body: {
      globalFallbackHours: opts.globalFallbackHours,
      totalCandidates: upcoming.length,
      attempted,
      sent,
      failures,
      timestamp: new Date().toISOString(),
    },
  };
}
