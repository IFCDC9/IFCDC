import { Router } from "express";
import { authRequired, requireRole } from "../../middleware/legacyAuth";
import { getMonolithDb } from "../../monolith/dbAccess";
import { logAudit } from "../../monolith/audit";
import { ROLES } from "../../monolith/constants";
import { getOpenAI } from "../../lib/openai";

export function createAiRouter(): Router {
  const router = Router();

  router.post("/ai/chat", authRequired, async (req, res) => {
    try {
      const { message } = req.body;

      if (!message || typeof message !== "string") {
        return res.status(400).json({ error: "Message is required" });
      }

      const openai = getOpenAI();
      if (!openai) {
        return res.status(503).json({ error: "AI service not configured. Set AURA_OPENAI_API_KEY on Render." });
      }

      const systemPrompt = `You are an AI assistant for IFCDC (Imperial Foundation Community Development Center), a community health organization. You help staff with:
- Client care and case management insights
- Barbershop appointment scheduling
- Radio show content and community announcements
- Violence prevention program support
- General community health questions

Be helpful, professional, and culturally sensitive. Keep responses concise and actionable.`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message },
        ],
        max_tokens: 500,
      });

      const aiResponse = response.choices[0]?.message?.content || "I couldn't generate a response.";

      await logAudit(req, { action: "AI_CHAT", targetType: "AI", targetId: "chat", extra: { messageLength: message.length } });

      res.json({ response: aiResponse });
    } catch (err) {
      console.error("AI chat error:", err);
      res.status(500).json({ error: "AI service unavailable" });
    }
  });

  router.post(
    "/ai/client-summary",
    authRequired,
    requireRole(ROLES.EXEC, ROLES.CLINICIAN, ROLES.CASE_MANAGER, ROLES.ADMIN),
    async (req, res) => {
      try {
        const { clientId } = req.body;

        if (!clientId) {
          return res.status(400).json({ error: "Client ID is required" });
        }

        const db = getMonolithDb();
        const client = await db.get<any>("SELECT * FROM clients WHERE id = ?", clientId);
        if (!client) {
          return res.status(404).json({ error: "Client not found" });
        }

        const encounters = await db.all<any[]>(
          "SELECT * FROM encounters WHERE client_id = ? ORDER BY visit_date DESC LIMIT 10",
          clientId,
        );

        const openai = getOpenAI();
        if (!openai) {
          return res.status(503).json({ error: "AI service not configured. Set AURA_OPENAI_API_KEY on Render." });
        }

        const prompt = `Based on this client information, provide a brief care summary and recommendations:
Client: ${client.full_name}
Programs: ${client.programs || "None specified"}
Recent Encounters: ${encounters.length} visits
${encounters
  .slice(0, 3)
  .map((e: any) => `- ${e.visit_date}: ${e.type} - ${e.notes?.substring(0, 100) || "No notes"}`)
  .join("\n")}

Provide a 2-3 sentence summary and 2-3 actionable recommendations for the care team.`;

        const response = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content:
                "You are a healthcare case management assistant. Provide concise, actionable summaries. Never include PHI in your response beyond what was provided.",
            },
            { role: "user", content: prompt },
          ],
          max_tokens: 300,
        });

        const summary = response.choices[0]?.message?.content || "Unable to generate summary.";

        await logAudit(req, { action: "AI_CLIENT_SUMMARY", targetType: "AI", targetId: clientId, extra: {} });

        res.json({ summary, clientName: client.full_name });
      } catch (err) {
        console.error("AI client summary error:", err);
        res.status(500).json({ error: "AI service unavailable" });
      }
    },
  );

  router.post("/ai/radio-content", authRequired, requireRole(ROLES.ADMIN, "radio_host", "radio"), async (req, res) => {
    try {
      const { topic, contentType } = req.body;

      if (!topic) {
        return res.status(400).json({ error: "Topic is required" });
      }

      const typePrompts: Record<string, string> = {
        announcement: "Write a 30-second radio announcement",
        segment: "Create a 2-minute radio segment outline",
        talking_points: "Generate 5 talking points for a discussion",
      };

      const typePrompt = typePrompts[contentType] || typePrompts.announcement;

      const openai = getOpenAI();
      if (!openai) {
        return res.status(503).json({ error: "AI service not configured. Set AURA_OPENAI_API_KEY on Render." });
      }

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are a radio content creator for IFCDC Radio, a community radio station focused on health, wellness, and community empowerment. Write engaging, culturally relevant content.",
          },
          { role: "user", content: `${typePrompt} about: ${topic}` },
        ],
        max_tokens: 400,
      });

      const content = response.choices[0]?.message?.content || "Unable to generate content.";

      await logAudit(req, {
        action: "AI_RADIO_CONTENT",
        targetType: "AI",
        targetId: "radio",
        extra: { topic, contentType },
      });

      res.json({ content, contentType: contentType || "announcement" });
    } catch (err) {
      console.error("AI radio content error:", err);
      res.status(500).json({ error: "AI service unavailable" });
    }
  });

  router.post("/ai/schedule-help", authRequired, requireRole(ROLES.ADMIN, "barber", "owner"), async (req, res) => {
    try {
      const { question, appointments } = req.body;

      if (!question) {
        return res.status(400).json({ error: "Question is required" });
      }

      const appointmentContext = appointments?.length
        ? `Current appointments today: ${appointments.map((a: any) => `${a.time} - ${a.service}`).join(", ")}`
        : "No current appointments provided.";

      const openai = getOpenAI();
      if (!openai) {
        return res.status(503).json({ error: "AI service not configured. Set AURA_OPENAI_API_KEY on Render." });
      }

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are a scheduling assistant for IFCDC Barbershop. Help with appointment scheduling, time management, and client preferences. ${appointmentContext}`,
          },
          { role: "user", content: question },
        ],
        max_tokens: 250,
      });

      const answer = response.choices[0]?.message?.content || "Unable to help with scheduling.";

      await logAudit(req, { action: "AI_SCHEDULE_HELP", targetType: "AI", targetId: "schedule", extra: {} });

      res.json({ answer });
    } catch (err) {
      console.error("AI schedule help error:", err);
      res.status(500).json({ error: "AI service unavailable" });
    }
  });

  return router;
}

export function registerAiRoutes(app: import("express").Express): void {
  app.use("/api", createAiRouter());
}
