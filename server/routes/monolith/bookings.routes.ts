import { Router } from "express";
import { authRequired, requireRole } from "../../middleware/legacyAuth";
import { getMonolithDb } from "../../monolith/dbAccess";
import { logAudit } from "../../monolith/audit";
import { cryptoRandomId, ROLES } from "../../monolith/constants";
import { hasClientAccess } from "../../monolith/clientAccess";
import {
  buildSafeAppointmentReminderText,
  isSmsAllowedForChannel,
  isVoiceAllowedForChannel,
  normalizeChannel,
  normalizePhone,
} from "../../monolith/phoneUtils";
import type { createTwilioSenders } from "../../monolith/twilioHelpers";

type TwilioSenders = ReturnType<typeof createTwilioSenders>;

export function createBookingsRouter(twilio: TwilioSenders): Router {
  const router = Router();
  const { sendSafeSms, sendVoiceReminderCall } = twilio;

// ADMIN: Get all bookings/appointments
router.get('/api/bookings/admin', authRequired, requireRole(['admin']), async (req, res) => {
  try {
    const db = getMonolithDb();
    const rows = await db.all<any[]>(
      `SELECT a.id, a.client_id, a.program, a.start_time, a.end_time,
              a.location, a.notes, a.created_by, a.created_at,
              c.full_name as client_name, c.phone as client_phone, c.email as client_email
       FROM appointments a
       LEFT JOIN clients c ON a.client_id = c.id
       ORDER BY a.start_time DESC`
    );

    await logAudit(req, { action: "ADMIN_LIST_ALL_BOOKINGS", targetType: "APPOINTMENT", targetId: null, extra: { count: rows.length } });

    res.json(rows.map((a) => ({
      id: a.id,
      clientId: a.client_id,
      clientName: a.client_name,
      clientPhone: a.client_phone,
      clientEmail: a.client_email,
      program: a.program,
      startTime: a.start_time,
      endTime: a.end_time,
      location: a.location,
      notes: a.notes,
      createdBy: a.created_by,
      createdAt: a.created_at,
    })));
  } catch (err) {
    console.error("Error fetching admin bookings:", err);
    res.status(500).json({ error: "Failed to load bookings" });
  }
});

// BARBER: Get barber bookings (barber + admin access)
router.get('/api/bookings/barber', authRequired, requireRole(['barber', 'admin']), async (req, res) => {
  try {
    const db = getMonolithDb();
    const rows = await db.all<any[]>(
      `SELECT a.id, a.client_id, a.program, a.start_time, a.end_time,
              a.location, a.notes, a.created_by, a.created_at,
              c.full_name as client_name, c.phone as client_phone, c.email as client_email
       FROM appointments a
       LEFT JOIN clients c ON a.client_id = c.id
       WHERE a.program = 'BARBERSHOP' OR a.program = 'barbershop'
       ORDER BY a.start_time DESC`
    );

    await logAudit(req, { action: "BARBER_LIST_BOOKINGS", targetType: "APPOINTMENT", targetId: null, extra: { count: rows.length } });

    res.json(rows.map((a) => ({
      id: a.id,
      clientId: a.client_id,
      clientName: a.client_name,
      clientPhone: a.client_phone,
      clientEmail: a.client_email,
      program: a.program,
      startTime: a.start_time,
      endTime: a.end_time,
      location: a.location,
      notes: a.notes,
      createdBy: a.created_by,
      createdAt: a.created_at,
    })));
  } catch (err) {
    console.error("Error fetching barber bookings:", err);
    res.status(500).json({ error: "Failed to load bookings" });
  }
});

// RADIO: Get radio board data (radio + admin access)
router.get('/api/radio/board', authRequired, requireRole(['radio', 'admin']), async (req, res) => {
  try {
    // Return radio schedule/board data
    res.json({
      schedule: [],
      onAir: null,
      upcoming: []
    });
  } catch (err) {
    console.error("Error fetching radio board:", err);
    res.status(500).json({ error: "Failed to load radio board" });
  }
});

router.post(
  "/clients/:clientId/appointments/:apptId/remind",
  authRequired,
  requireRole(ROLES.EXEC, ROLES.CASE_MANAGER, ROLES.ADMIN),
  async (req, res) => {
    const { clientId, apptId } = req.params;

    const db = getMonolithDb();
    const client = await db.get<{ id: string; full_name: string; phone: string }>(
      "SELECT id, full_name, phone FROM clients WHERE id = ?",
      clientId
    );
    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    if (!(await hasClientAccess(req.user, client.id))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const appt = await db.get<{ id: string; start_time: string; location: string; program: string }>(
      `SELECT id, start_time, location, program FROM appointments WHERE id = ? AND client_id = ?`,
      apptId, clientId
    );
    if (!appt) {
      return res.status(404).json({ error: "Appointment not found" });
    }

    const to = client.phone;
    if (!to) {
      return res.status(400).json({ error: "No phone number on file for client" });
    }

    const when = new Date(appt.start_time).toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    });

    const body =
      `Reminder: You have an upcoming IFCDC appointment on ${when}. ` +
      `If you have questions, please contact us. Reply STOP to opt out.`;

    try {
      await sendSafeSms(to, body);
      await logAudit(req, { action: "SEND_APPT_REMINDER", targetType: "APPOINTMENT", targetId: appt.id, extra: { clientId, phone: to } });
      res.json({ ok: true });
    } catch (err) {
      console.error("Twilio error:", err);
      res.status(500).json({ error: "Failed to send reminder" });
    }
  }
);

// ----- Appointment Notifications: SMS Reminder (by appointment ID) -----
router.post(
  "/appointments/:id/remind-sms",
  authRequired,
  requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER),
  async (req, res) => {
    try {
      try {
        twilio.ensureTwilioConfigured();
      } catch {
        return res.status(500).json({ error: "Twilio not configured on this server." });
      }

      const apptId = req.params.id;

      const db = getMonolithDb();
      const appt = await db.get<{
        id: string;
        client_id: string;
        program: string;
        start_time: string;
        full_name: string;
        phone: string;
        notify_channel: string | null;
      }>(
        `
        SELECT a.id, a.client_id, a.program, a.start_time,
               c.full_name, c.phone, c.notify_channel
        FROM appointments a
        JOIN clients c ON c.id = a.client_id
        WHERE a.id = ?
        `,
        apptId
      );

      if (!appt) {
        return res.status(404).json({ error: "Appointment not found" });
      }

      if (!(await hasClientAccess(req.user, appt.client_id))) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const chan = normalizeChannel(appt.notify_channel);
      if (!isSmsAllowedForChannel(chan)) {
        return res.status(400).json({
          error: "Client is not configured to receive SMS reminders.",
        });
      }

      if (!appt.phone) {
        return res.status(400).json({ error: "Client does not have a phone number on file" });
      }

      const body = buildSafeAppointmentReminderText(
        { fullName: appt.full_name },
        appt
      );

      const now = new Date();
      const apptTime = new Date(appt.start_time);
      const leadHour = Math.max(0, Math.round((apptTime.getTime() - now.getTime()) / (1000 * 60 * 60)));

      let notifStatus = "SENT";
      let notifError: string | null = null;

      try {
        const sms = await sendSafeSms(appt.phone, body);

        await logAudit(req, { action: "SEND_SMS_REMINDER", targetType: "APPOINTMENT", targetId: apptId, extra: {
          to: normalizePhone(appt.phone),
          sid: sms.sid,
        } });
      } catch (smsErr: any) {
        notifStatus = "FAILED";
        notifError = smsErr?.message || "Unknown SMS error";
      }

      await db.run(
        `INSERT INTO appointment_notifications (id, appointment_id, channel, lead_hour, status, error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        cryptoRandomId(),
        apptId,
        "SMS",
        leadHour,
        notifStatus,
        notifError,
        now.toISOString()
      );

      if (notifStatus === "FAILED") {
        return res.status(500).json({ error: notifError || "Failed to send SMS reminder" });
      }

      res.json({ ok: true });
    } catch (err) {
      console.error("Error sending SMS reminder:", err);
      res.status(500).json({ error: "Failed to send SMS reminder" });
    }
  }
);

// ----- Appointment Notifications: Voice Reminder (initiate call) -----
router.post(
  "/appointments/:id/remind-voice",
  authRequired,
  requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER),
  async (req, res) => {
    try {
      try {
        twilio.ensureTwilioConfigured();
      } catch {
        return res.status(500).json({ error: "Twilio not configured on this server." });
      }

      const apptId = req.params.id;

      const db = getMonolithDb();
      const appt = await db.get<{
        id: string;
        client_id: string;
        program: string;
        start_time: string;
        full_name: string;
        phone: string;
        notify_channel: string | null;
      }>(
        `
        SELECT a.id, a.client_id, a.program, a.start_time,
               c.full_name, c.phone, c.notify_channel
        FROM appointments a
        JOIN clients c ON c.id = a.client_id
        WHERE a.id = ?
        `,
        apptId
      );

      if (!appt) {
        return res.status(404).json({ error: "Appointment not found" });
      }

      if (!(await hasClientAccess(req.user, appt.client_id))) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const chan = normalizeChannel(appt.notify_channel);
      if (!isVoiceAllowedForChannel(chan)) {
        return res.status(400).json({
          error: "Client is not configured to receive voice reminders.",
        });
      }

      if (!appt.phone) {
        return res.status(400).json({ error: "Client does not have a phone number on file" });
      }

      const now = new Date();
      const apptTime = new Date(appt.start_time);
      const leadHour = Math.max(0, Math.round((apptTime.getTime() - now.getTime()) / (1000 * 60 * 60)));

      let notifStatus = "SENT";
      let notifError: string | null = null;

      try {
        const call = await sendVoiceReminderCall(appt.phone, appt.id);

        await logAudit(req, { action: "SEND_VOICE_REMINDER", targetType: "APPOINTMENT", targetId: apptId, extra: {
          to: normalizePhone(appt.phone),
          sid: call.sid,
        } });
      } catch (callErr: any) {
        notifStatus = "FAILED";
        notifError = callErr?.message || "Unknown voice call error";
      }

      await db.run(
        `INSERT INTO appointment_notifications (id, appointment_id, channel, lead_hour, status, error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        cryptoRandomId(),
        apptId,
        "VOICE",
        leadHour,
        notifStatus,
        notifError,
        now.toISOString()
      );

      if (notifStatus === "FAILED") {
        return res.status(500).json({ error: notifError || "Failed to start voice reminder call" });
      }

      res.json({ ok: true });
    } catch (err) {
      console.error("Error sending voice reminder:", err);
      res.status(500).json({ error: "Failed to start voice reminder call" });
    }
  }
);

router.post(
  "/clients/:id/notify",
  authRequired,
  requireRole(ROLES.EXEC, ROLES.CASE_MANAGER, ROLES.ADMIN),
  async (req, res) => {
    const clientId = req.params.id;
    const { message, phoneOverride } = req.body || {};

    const db = getMonolithDb();
    const client = await db.get<{ id: string; full_name: string; phone: string }>(
      "SELECT id, full_name, phone FROM clients WHERE id = ?",
      clientId
    );
    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    if (!(await hasClientAccess(req.user, client.id))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const to = phoneOverride || client.phone;
    if (!to) {
      return res.status(400).json({ error: "No phone number available" });
    }

    const safeBody =
      message ||
      "You have an upcoming IFCDC appointment. If you have any questions, please call us. Reply STOP to opt out.";

    try {
      await sendSafeSms(to, safeBody);
      await logAudit(req, { action: "SEND_SMS", targetType: "NOTIFICATION", targetId: clientId, extra: { to } });
      res.json({ ok: true });
    } catch (err) {
      console.error("Twilio error:", err);
      res.status(500).json({ error: "Failed to send SMS" });
    }
  }
);

router.get("/audit-logs", authRequired, requireRole(ROLES.EXEC), async (req, res) => {
  const db = getMonolithDb();
  const logs = await db.all<any[]>("SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 500");
  res.json(logs.map((log) => ({
    ...log,
    extra: JSON.parse(log.extra || "{}"),
  })));
});

  return router;
}

export function registerBookingsRoutes(
  app: import("express").Express,
  twilio: TwilioSenders,
): void {
  app.use("/api", createBookingsRouter(twilio));
}
