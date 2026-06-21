import { createAuraAI, DEFAULT_AURA_SYSTEM_PROMPT, type ChatMessage } from "@ifcdc/aura-ai";
import { Router, type Request, type Response } from "express";
import { z } from "zod";

const chatSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(["user", "assistant", "system"]),
    content: z.string(),
  })),
  appContext: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
});

export function createAuraRouter(apiKey: string, systemPrompt?: string) {
  const aura = createAuraAI({ apiKey, systemPrompt: systemPrompt ?? DEFAULT_AURA_SYSTEM_PROMPT });
  const router = Router();

  router.post("/chat", async (req: Request, res: Response) => {
    const parsed = chatSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

    const { messages, appContext, temperature } = parsed.data;
    const contextPrefix = appContext
      ? [{ role: "system" as const, content: `Application context: ${appContext}` }]
      : [];

    try {
      const response = await aura.chat(
        [...contextPrefix, ...messages] as ChatMessage[],
        { temperature }
      );
      res.json({ response, model: "aura" });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "AI request failed" });
    }
  });

  router.post("/stream", async (req: Request, res: Response) => {
    const parsed = chatSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    try {
      for await (const chunk of aura.stream(parsed.data.messages as ChatMessage[])) {
        res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
      }
      res.write("data: [DONE]\n\n");
      res.end();
    } catch (err) {
      res.write(`data: ${JSON.stringify({ error: "Stream failed" })}\n\n`);
      res.end();
    }
  });

  router.post("/embed", async (req: Request, res: Response) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "Text required" });

    try {
      const embedding = await aura.embed(text);
      res.json({ embedding, dimensions: embedding.length });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Embedding failed" });
    }
  });

  return { router, aura };
}

export { createAuraAI, DEFAULT_AURA_SYSTEM_PROMPT };
