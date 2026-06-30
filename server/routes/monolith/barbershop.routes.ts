import { Router } from "express";
import type { Twilio } from "twilio";
import { authRequired, requireRole } from "../../middleware/legacyAuth";
import { getMonolithDb } from "../../monolith/dbAccess";
import { logAudit } from "../../monolith/audit";
import { cryptoRandomId, ROLES } from "../../monolith/constants";
import { buildSafeAppointmentReminderText, normalizePhone } from "../../monolith/phoneUtils";

const BARBERSHOP_SERVICES = [
  { id: "haircut", name: "Haircut", duration: 30, price: 25 },
  { id: "beard", name: "Beard Trim", duration: 15, price: 15 },
  { id: "haircut_beard", name: "Haircut + Beard", duration: 45, price: 35 },
  { id: "lineup", name: "Line Up / Edge Up", duration: 15, price: 15 },
  { id: "kids_cut", name: "Kids Cut (12 & Under)", duration: 25, price: 20 },
  { id: "shave", name: "Full Shave", duration: 30, price: 25 },
];

export interface BarbershopRouteDeps {
  twilioClient: Twilio | null;
  twilioSmsFrom: string | undefined;
}

export function createBarbershopRouter(deps: BarbershopRouteDeps): Router {
  const router = Router();
  const { twilioClient, twilioSmsFrom } = deps;

  router.get("/barbershop/services", authRequired, async (_req, res) => {
    res.json(BARBERSHOP_SERVICES);
  });

  router.get("/barbershop/barbers", authRequired, async (_req, res) => {
    try {
      const db = getMonolithDb();
      const barbers = await db.all<any[]>(
        `SELECT id, first_name, last_name, email, phone FROM employees WHERE role = 'barber' AND status = 'active' ORDER BY first_name`,
      );
      res.json(
        barbers.map((b) => ({
          id: b.id,
          firstName: b.first_name,
          lastName: b.last_name,
          name: `${b.first_name} ${b.last_name}`,
          email: b.email,
          phone: b.phone,
        })),
      );
    } catch (err) {
      console.error("Error fetching barbers:", err);
      res.status(500).json({ error: "Failed to load barbers" });
    }
  });

  router.post(
    "/barbershop/book",
    authRequired,
    requireRole("barber", "admin", "owner", ROLES.EXEC),
    async (req, res) => {
      try {
        const { clientFirstName, clientLastName, clientPhone, clientEmail, serviceId, barberId, date, startTime, notes } =
          req.body;

        if (!clientFirstName || !clientLastName || !serviceId || !barberId || !date || !startTime) {
          return res.status(400).json({
            error: "Missing required fields: clientFirstName, clientLastName, serviceId, barberId, date, startTime",
          });
        }

        const db = getMonolithDb();
        const fullName = `${clientFirstName} ${clientLastName}`;

        let client = await db.get<any>(
          `SELECT id, notify_channel FROM clients WHERE LOWER(full_name) = LOWER(?) OR (phone = ? AND phone IS NOT NULL AND phone != '')`,
          [fullName, clientPhone || null],
        );

        if (!client) {
          const clientId = cryptoRandomId();
          const now = new Date().toISOString();
          await db.run(
            `INSERT INTO clients (id, full_name, phone, email, programs, notify_channel, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            clientId,
            fullName,
            clientPhone || null,
            clientEmail || null,
            JSON.stringify(["BARBERSHOP"]),
            "SMS",
            now,
          );
          client = { id: clientId, notify_channel: "SMS" };
        }

        const service = BARBERSHOP_SERVICES.find((s) => s.id === serviceId);
        if (!service) {
          return res.status(400).json({ error: "Invalid service" });
        }

        const startDateTime = new Date(`${date}T${startTime}:00`);
        const endDateTime = new Date(startDateTime.getTime() + service.duration * 60000);
        const endTime = `${String(endDateTime.getHours()).padStart(2, "0")}:${String(endDateTime.getMinutes()).padStart(2, "0")}`;

        const startISO = `${date}T${startTime}:00`;
        const endISO = `${date}T${endTime}:00`;

        const conflicts = await db.get<any>(
          `SELECT id FROM appointments 
       WHERE program = 'BARBERSHOP' 
       AND created_by = ?
       AND start_time >= ? AND start_time < ?
       AND (
         (start_time < ? AND end_time > ?)
         OR (start_time >= ? AND start_time < ?)
       )`,
          barberId,
          `${date}T00:00:00`,
          `${date}T23:59:59`,
          endISO,
          startISO,
          startISO,
          endISO,
        );

        if (conflicts) {
          return res.status(409).json({ error: "Time slot conflicts with existing appointment" });
        }

        const appointmentId = cryptoRandomId();
        const now = new Date().toISOString();
        const appointmentNotes = `[${service.name}]${notes ? " " + notes : ""}`;

        await db.run(
          `INSERT INTO appointments (id, client_id, program, start_time, end_time, location, notes, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          appointmentId,
          client.id,
          "BARBERSHOP",
          startISO,
          endISO,
          "IFCDC Barbershop",
          appointmentNotes,
          barberId,
          now,
        );

        await logAudit(req, {
          action: "CREATE_BARBERSHOP_BOOKING",
          targetType: "APPOINTMENT",
          targetId: appointmentId,
          extra: { clientName: fullName, service: service.name, date, startTime, barberId },
        });

        const clientOptedIn = client.notify_channel === "SMS" || !client.notify_channel;
        if (clientOptedIn && twilioClient && clientPhone) {
          try {
            const formattedDate = new Date(date).toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            });
            const smsBody = `IFCDC Barbershop: Your ${service.name} appointment is confirmed for ${formattedDate} at ${startTime}. See you soon!`;

            await twilioClient.messages.create({
              body: smsBody,
              from: twilioSmsFrom,
              to: clientPhone.startsWith("+") ? clientPhone : `+1${clientPhone.replace(/\D/g, "")}`,
            });
            console.log(`SMS confirmation sent to ${clientPhone}`);
          } catch (smsErr) {
            console.error("SMS confirmation failed:", smsErr);
          }
        }

        res.status(201).json({
          id: appointmentId,
          clientId: client.id,
          clientName: fullName,
          service: service.name,
          serviceDuration: service.duration,
          date,
          startTime,
          endTime,
          barberId,
        });
      } catch (err) {
        console.error("Error creating booking:", err);
        res.status(500).json({ error: "Failed to create booking" });
      }
    },
  );

  router.post(
    "/barbershop/appointments/:id/send-reminder",
    authRequired,
    requireRole("barber", "admin", "owner", ROLES.EXEC),
    async (req, res) => {
      try {
        const { id } = req.params;

        if (!twilioClient || !twilioSmsFrom) {
          return res.status(503).json({ error: "SMS service is not configured. Please configure Twilio credentials." });
        }

        const db = getMonolithDb();
        const appointment = await db.get<any>(
          `SELECT a.id, a.start_time, a.end_time, a.notes, a.program, c.id as client_id, c.full_name, c.phone, c.notify_channel
       FROM appointments a
       JOIN clients c ON a.client_id = c.id
       WHERE a.id = ? AND a.program = 'BARBERSHOP'`,
          id,
        );

        if (!appointment) {
          return res.status(404).json({ error: "Appointment not found" });
        }

        if (!appointment.phone) {
          return res.status(400).json({ error: "Client has no phone number on file" });
        }

        if (appointment.notify_channel === "NONE") {
          return res.status(400).json({ error: "Client has opted out of SMS notifications" });
        }

        const reminderText = buildSafeAppointmentReminderText(
          { fullName: appointment.full_name },
          { start_time: appointment.start_time },
        );

        const phoneNorm = normalizePhone(appointment.phone);
        if (!phoneNorm) {
          return res.status(400).json({ error: "Invalid phone number format" });
        }
        await twilioClient.messages.create({
          to: phoneNorm,
          from: twilioSmsFrom,
          body: reminderText,
        });

        await logAudit(req, {
          action: "SEND_BARBERSHOP_REMINDER",
          targetType: "SMS",
          targetId: id,
          extra: {
            clientName: appointment.full_name,
            phone: appointment.phone,
            appointmentTime: appointment.start_time,
          },
        });

        res.json({ success: true, message: "Reminder sent successfully" });
      } catch (err: any) {
        console.error("Error sending reminder:", err);
        if (err.message?.includes("Twilio is not configured")) {
          return res.status(503).json({ error: "SMS service is not properly configured" });
        }
        res.status(500).json({ error: "Failed to send reminder: " + (err.message || "Unknown error") });
      }
    },
  );

  router.post("/test-sms", authRequired, requireRole("admin", "owner", ROLES.EXEC), async (req, res) => {
    try {
      const { to, message } = req.body;

      if (!twilioClient || !twilioSmsFrom) {
        return res.status(503).json({
          error: "SMS service is not configured. Ensure TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_SMS_FROM are set.",
        });
      }

      if (!to) {
        return res.status(400).json({ error: "Phone number (to) is required" });
      }

      const phoneNorm = normalizePhone(to);
      if (!phoneNorm) {
        return res.status(400).json({ error: "Invalid phone number format" });
      }

      const smsBody = message || "Test message from IFCDC Health System";

      await twilioClient.messages.create({
        to: phoneNorm,
        from: twilioSmsFrom,
        body: smsBody,
      });

      await logAudit(req, { action: "TEST_SMS", targetType: "SMS", targetId: "test", extra: { to: phoneNorm } });

      res.json({ success: true, message: "Test SMS sent successfully to " + phoneNorm });
    } catch (err: any) {
      console.error("Error sending test SMS:", err);
      res.status(500).json({ error: "Failed to send SMS: " + (err.message || "Unknown error") });
    }
  });

  router.post("/public/book-barbershop", async (req, res) => {
    try {
      const { firstName, lastName, phone, email, service, serviceName, date, time, notes, smsOptIn } = req.body;

      if (!firstName || !lastName || !phone || !service || !date || !time) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      const db = getMonolithDb();
      const fullName = `${firstName} ${lastName}`;
      const notifyChannel = smsOptIn !== false ? "SMS" : "NONE";
      let client = await db.get<any>(
        `SELECT id, notify_channel FROM clients WHERE phone = ? AND phone IS NOT NULL`,
        [phone],
      );

      if (!client) {
        const clientId = cryptoRandomId();
        const now = new Date().toISOString();
        await db.run(
          `INSERT INTO clients (id, full_name, phone, email, programs, notify_channel, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          clientId,
          fullName,
          phone,
          email || null,
          JSON.stringify(["BARBERSHOP"]),
          notifyChannel,
          now,
        );
        client = { id: clientId, notify_channel: notifyChannel };
      } else {
        await db.run(`UPDATE clients SET notify_channel = ? WHERE id = ?`, notifyChannel, client.id);
        client.notify_channel = notifyChannel;
      }

      const knownService = BARBERSHOP_SERVICES.find((s) => s.id === service);
      const duration = knownService?.duration || 30;
      const displayName = knownService?.name || serviceName || service;

      const startDateTime = new Date(`${date}T${time}:00`);
      const endDateTime = new Date(startDateTime.getTime() + duration * 60000);
      const endTime = `${String(endDateTime.getHours()).padStart(2, "0")}:${String(endDateTime.getMinutes()).padStart(2, "0")}`;

      const startISO = `${date}T${time}:00`;
      const endISO = `${date}T${endTime}:00`;

      const appointmentId = cryptoRandomId();
      const now = new Date().toISOString();
      const appointmentNotes = `[${displayName}] ONLINE REQUEST${notes ? " - " + notes : ""}`;

      const defaultBarber = await db.get<any>(`SELECT id FROM users WHERE role IN ('barber', 'owner') LIMIT 1`);
      const barberId = defaultBarber?.id || "unassigned";

      await db.run(
        `INSERT INTO appointments (id, client_id, program, start_time, end_time, location, notes, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        appointmentId,
        client.id,
        "BARBERSHOP",
        startISO,
        endISO,
        "IFCDC Barbershop",
        appointmentNotes,
        barberId,
        now,
      );

      const shouldSendSms = client.notify_channel === "SMS";
      if (shouldSendSms && twilioClient && phone) {
        try {
          const formattedDate = new Date(date).toLocaleDateString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
          });
          const smsBody = `IFCDC Barbershop: Your appointment for ${displayName} on ${formattedDate} at ${time} has been received! We'll confirm shortly. Questions? Call us!`;

          await twilioClient.messages.create({
            body: smsBody,
            from: twilioSmsFrom,
            to: phone.startsWith("+") ? phone : `+1${phone.replace(/\D/g, "")}`,
          });
          console.log(`SMS confirmation sent to ${phone}`);
        } catch (smsErr) {
          console.error("SMS confirmation failed:", smsErr);
        }
      }

      res.status(201).json({
        success: true,
        message: "Booking request submitted",
        appointmentId,
        clientName: fullName,
        service: displayName,
        date,
        time,
      });
    } catch (err) {
      console.error("Error creating public booking:", err);
      res.status(500).json({ error: "Failed to submit booking request" });
    }
  });

  return router;
}

export function registerBarbershopRoutes(app: import("express").Express, deps: BarbershopRouteDeps): void {
  app.use("/api", createBarbershopRouter(deps));
}
