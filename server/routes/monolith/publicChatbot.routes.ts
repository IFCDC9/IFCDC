import { Router } from "express";
import rateLimit from "express-rate-limit";
import { getOpenAI } from "../../lib/openai";

const chatbotLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: "Too many requests. Please wait a moment before trying again." },
  standardHeaders: true,
  legacyHeaders: false,
});

export function createPublicChatbotRouter(): Router {
  const router = Router();

  router.post("/public/chatbot", chatbotLimiter, async (req, res) => {
    try {
      const { message, conversationHistory } = req.body;

      if (!message || typeof message !== "string") {
        return res.status(400).json({ error: "Message is required" });
      }

      if (message.length > 500) {
        return res.status(400).json({ error: "Message too long (max 500 characters)" });
      }

      const openai = getOpenAI();
      if (!openai) {
        return res.status(503).json({ error: "AI service not configured. Set AURA_OPENAI_API_KEY on Render." });
      }

      const systemPrompt = `You are a helpful assistant for Imperial Foundation CDC (IFCDC), a 501(c)(3) nonprofit organization in Asbury Park, NJ dedicated to community development, mentorship, and economic empowerment.

You can answer questions about:
- IFCDC programs and services (Mental Health & Wellness, Barbershop, Radio, Youth Development)
- Privacy Policy: IFCDC respects privacy, does not sell personal information, and uses data only for organizational communication
- Terms of Use: Website content is for lawful purposes only
- Records Policy: All health records are confidential, managed by Executive Director Mr. Fahreal Allah. Clients can request records or authorize sharing via Release of Information (ROI) form
- Contact: Phone (732) 743-5048, Email service@ifcdc.org, Address: 1215 Springwood Ave Suite 28, Asbury Park, NJ 07712
- Barbershop: Call (331) 316-8167 or book online at /book-barbershop.html
- Radio Shoutouts: Call (858) 758-8791

Keep responses concise, friendly, and helpful. If you don't know something specific, direct them to contact IFCDC directly.`;

      const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
        { role: "system", content: systemPrompt },
      ];

      if (Array.isArray(conversationHistory)) {
        const recentHistory = conversationHistory.slice(-6);
        for (const msg of recentHistory) {
          if (msg.role === "user" || msg.role === "assistant") {
            messages.push({ role: msg.role, content: String(msg.content).slice(0, 500) });
          }
        }
      }

      messages.push({ role: "user", content: message });

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages,
        max_tokens: 300,
      });

      const aiResponse =
        response.choices[0]?.message?.content ||
        "I'm sorry, I couldn't generate a response. Please contact us directly at (732) 743-5048.";

      res.json({ response: aiResponse });
    } catch (err) {
      console.error("Public chatbot error:", err);
      res.status(500).json({ error: "Chatbot service temporarily unavailable. Please contact us at (732) 743-5048." });
    }
  });

  return router;
}

export function registerPublicChatbotRoutes(app: import("express").Express): void {
  app.use("/api", createPublicChatbotRouter());
}
