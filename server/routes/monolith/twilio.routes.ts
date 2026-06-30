import type { Express } from "express";
import express from "express";
import twilio from "twilio";
import { getMonolithDb } from "../../monolith/dbAccess";
import { cryptoRandomId } from "../../monolith/constants";

export function registerTwilioRoutes(app: Express, publicIfcdcPhone?: string): void {
  app.post("/twilio/voice/reminder", async (_req, res) => {
    const VoiceResponse = twilio.twiml.VoiceResponse;
    const twiml = new VoiceResponse();
    const mainPhone = publicIfcdcPhone || "our main office number";
    const msg =
      "Hello. This is a reminder from I. F. C. D. C. " +
      "You have an upcoming appointment scheduled with our organization. " +
      "If you need to cancel or reschedule, please call " +
      mainPhone +
      ". Thank you.";
    twiml.say({ voice: "alice", language: "en-US" }, msg);
    res.type("text/xml");
    res.send(twiml.toString());
  });

  app.post(
    "/twilio/voice-status",
    express.urlencoded({ extended: false }),
    async (req, res) => {
      try {
        const callStatus = req.body.CallStatus;
        const from = req.body.From;
        const missedStatuses = ["no-answer", "busy", "failed", "canceled"];
        if (!missedStatuses.includes((callStatus || "").toLowerCase())) {
          return res.type("text/xml").send("<Response></Response>");
        }

        const db = getMonolithDb();
        const client = await db.get<{ id: string }>(
          "SELECT id FROM clients WHERE phone = ? LIMIT 1",
          from,
        );
        const created_at = new Date().toISOString();
        await db.run(
          `INSERT INTO outreach_tasks (id, client_id, phone, channel, reason, status, created_at, completed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          cryptoRandomId(),
          client ? client.id : null,
          from,
          "VOICE",
          "MISSED_CALL",
          "OPEN",
          created_at,
          null,
        );
        res.type("text/xml").send("<Response></Response>");
      } catch (err) {
        console.error("Error in /twilio/voice-status:", err);
        res.type("text/xml").send("<Response></Response>");
      }
    },
  );
}
