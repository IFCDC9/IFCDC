import OpenAI from "openai";

export interface AuraConfig {
  apiKey: string;
  model?: string;
  systemPrompt?: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export const DEFAULT_AURA_SYSTEM_PROMPT = `You are AURA, the AI assistant for the Imperial Foundation Community Development Corporation (IFCDC).
You provide helpful, accurate, and community-focused responses.
Always maintain a professional, supportive, and inclusive tone.`;

export function createAuraAI(config: AuraConfig) {
  const client = new OpenAI({ apiKey: config.apiKey });
  const model = config.model ?? "gpt-4o-mini";
  const systemPrompt = config.systemPrompt ?? DEFAULT_AURA_SYSTEM_PROMPT;

  return {
    async chat(messages: ChatMessage[], options?: { temperature?: number; maxTokens?: number }) {
      const response = await client.chat.completions.create({
        model,
        messages: [{ role: "system", content: systemPrompt }, ...messages],
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? 2048,
      });
      return response.choices[0]?.message?.content ?? "";
    },

    async *stream(messages: ChatMessage[]) {
      const stream = await client.chat.completions.create({
        model,
        messages: [{ role: "system", content: systemPrompt }, ...messages],
        stream: true,
      });

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) yield content;
      }
    },

    async embed(text: string) {
      const response = await client.embeddings.create({
        model: "text-embedding-3-small",
        input: text,
      });
      return response.data[0]?.embedding ?? [];
    },
  };
}

export { OpenAI };
