import OpenAI, { toFile } from "openai";

export interface AuraConfig {
  apiKey: string;
  model?: string;
  systemPrompt?: string;
  baseURL?: string;
  organization?: string;
  project?: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type MediaCapabilityProbe = {
  PROVIDER_NAME: "openai";
  CREDENTIAL_PRESENT: "YES" | "NO";
  MODEL_ACCESS: {
    chat: "YES" | "NO" | "UNKNOWN";
    image_generation: "YES" | "NO" | "UNKNOWN";
    image_editing: "YES" | "NO" | "UNKNOWN";
    voice_generation: "YES" | "NO" | "UNKNOWN";
    video_generation: "YES" | "NO";
  };
  CAPABILITIES_AVAILABLE: string[];
  INTEGRATION_STATUS: "READY" | "PARTIAL" | "NOT_CONFIGURED" | "ERROR";
  models: {
    image?: string | null;
    imageEdit?: string | null;
    voice?: string | null;
    chat?: string | null;
  };
  blockers: string[];
  /** Never includes secret values */
  note: string;
};

export const DEFAULT_AURA_SYSTEM_PROMPT = `You are AURA, the AI assistant for the Imperial Foundation Community Development Corporation (IFCDC).
You provide helpful, accurate, and community-focused responses.
Always maintain a professional, supportive, and inclusive tone.`;

const DEFAULT_IMAGE_MODELS = ["gpt-image-1", "dall-e-3", "dall-e-2"];
const DEFAULT_TTS_MODELS = ["gpt-4o-mini-tts", "tts-1-hd", "tts-1"];

function envModel(name: string, fallback: string | null = null): string | null {
  const v = String(process.env[name] || "").trim();
  return v || fallback;
}

export function createAuraAI(config: AuraConfig) {
  const client = new OpenAI({
    apiKey: config.apiKey,
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    ...(config.organization ? { organization: config.organization } : {}),
    ...(config.project ? { project: config.project } : {}),
  });
  const model = config.model ?? "gpt-4o-mini";
  const systemPrompt = config.systemPrompt ?? DEFAULT_AURA_SYSTEM_PROMPT;

  return {
    client,

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

    /**
     * Provider-generated image pixels. Never invents a file without an API response.
     * Does not synthesize Founder likeness — caller must keep prompts non-person unless approved.
     */
    async generateImage(opts: {
      prompt: string;
      size?: "1024x1024" | "1024x1536" | "1536x1024" | "1792x1024" | "1024x1792" | "256x256" | "512x512";
      model?: string;
      quality?: string;
    }): Promise<{ ok: true; bytes: Buffer; mimeType: string; model: string; revisedPrompt?: string } | { ok: false; status: string; reason: string; blocker: string }> {
      const prompt = String(opts.prompt || "").trim();
      if (!prompt) {
        return { ok: false, status: "FAILED", reason: "prompt required", blocker: "MISSING_PROMPT" };
      }
      const candidates = [opts.model, envModel("AURA_IMAGE_MODEL"), ...DEFAULT_IMAGE_MODELS].filter(
        (m, i, arr): m is string => Boolean(m) && arr.indexOf(m) === i,
      );
      let lastError = "no image model attempted";
      for (const imageModel of candidates) {
        try {
          const params: Record<string, unknown> = {
            model: imageModel,
            prompt,
            n: 1,
            size: opts.size || "1024x1024",
          };
          // Current OpenAI image endpoints reject response_format on gpt-image and some dall-e paths.
          // Prefer native b64 when present; otherwise fetch URL bytes.
          const response = await client.images.generate(params as unknown as Parameters<typeof client.images.generate>[0]);
          const data = (response as { data?: Array<{ b64_json?: string | null; url?: string | null; revised_prompt?: string | null }> }).data;
          const item = data?.[0];
          let bytes: Buffer | null = null;
          if (item?.b64_json) {
            bytes = Buffer.from(item.b64_json, "base64");
          } else if (item?.url) {
            const fetched = await fetch(item.url);
            if (!fetched.ok) {
              lastError = `model ${imageModel} URL fetch failed HTTP ${fetched.status}`;
              continue;
            }
            bytes = Buffer.from(await fetched.arrayBuffer());
          }
          if (!bytes?.length) {
            lastError = `model ${imageModel} returned no image bytes`;
            continue;
          }
          return {
            ok: true,
            bytes,
            mimeType: "image/png",
            model: imageModel,
            revisedPrompt: item?.revised_prompt || undefined,
          };
        } catch (error) {
          lastError = String((error as Error)?.message || error);
          // Try next model on model_not_found / access / param errors.
          if (/model|access|permission|not found|404|400|Unknown parameter/i.test(lastError)) continue;
          return {
            ok: false,
            status: "PROVIDER_ERROR",
            reason: lastError.slice(0, 400),
            blocker: `PROVIDER_ERROR:openai:image_generation`,
          };
        }
      }
      return {
        ok: false,
        status: "MODEL_ACCESS_DENIED",
        reason: lastError.slice(0, 400),
        blocker: "MISSING_MODEL_ACCESS:image_generation (need dall-e-3 / gpt-image-1 on AURA_OPENAI_API_KEY)",
      };
    },

    async editImage(opts: {
      prompt: string;
      imageBytes: Buffer;
      maskBytes?: Buffer;
      model?: string;
      size?: string;
    }): Promise<{ ok: true; bytes: Buffer; mimeType: string; model: string } | { ok: false; status: string; reason: string; blocker: string }> {
      const prompt = String(opts.prompt || "").trim();
      if (!prompt || !opts.imageBytes?.length) {
        return {
          ok: false,
          status: "FAILED",
          reason: "prompt and imageBytes required",
          blocker: "MISSING_INPUT:image_editing",
        };
      }
      const imageModel = opts.model || envModel("AURA_IMAGE_EDIT_MODEL") || "dall-e-2";
      try {
        const imageFile = await toFile(opts.imageBytes, "source.png", { type: "image/png" });
        const params: Record<string, unknown> = {
          model: imageModel,
          image: imageFile,
          prompt,
          n: 1,
          size: opts.size || "1024x1024",
          response_format: "b64_json",
        };
        if (opts.maskBytes?.length) {
          params.mask = await toFile(opts.maskBytes, "mask.png", { type: "image/png" });
        }
        const response = await client.images.edit(params as unknown as Parameters<typeof client.images.edit>[0]);
        const data = (response as { data?: Array<{ b64_json?: string | null }> }).data;
        const b64 = data?.[0]?.b64_json;
        if (!b64) {
          return {
            ok: false,
            status: "PROVIDER_ERROR",
            reason: "edit returned no image bytes",
            blocker: "PROVIDER_ERROR:openai:image_editing",
          };
        }
        return { ok: true, bytes: Buffer.from(b64, "base64"), mimeType: "image/png", model: imageModel };
      } catch (error) {
        const reason = String((error as Error)?.message || error).slice(0, 400);
        return {
          ok: false,
          status: /model|access|permission|not found/i.test(reason) ? "MODEL_ACCESS_DENIED" : "PROVIDER_ERROR",
          reason,
          blocker: "MISSING_MODEL_ACCESS:image_editing (need images.edit on AURA_OPENAI_API_KEY)",
        };
      }
    },

    /**
     * Synthetic TTS only — never Founder voice clone. Caller must tag synthetic.
     */
    async synthesizeSpeech(opts: {
      text: string;
      voice?: string;
      model?: string;
      format?: "mp3" | "wav" | "opus" | "aac" | "flac";
    }): Promise<
      | { ok: true; bytes: Buffer; mimeType: string; model: string; voice: string; synthetic: true }
      | { ok: false; status: string; reason: string; blocker: string }
    > {
      const text = String(opts.text || "").trim();
      if (!text) {
        return { ok: false, status: "FAILED", reason: "text required", blocker: "MISSING_PROMPT" };
      }
      const voice = opts.voice || process.env.AURA_TTS_VOICE || "alloy";
      const candidates = [opts.model, envModel("AURA_TTS_MODEL"), ...DEFAULT_TTS_MODELS].filter(
        (m, i, arr): m is string => Boolean(m) && arr.indexOf(m) === i,
      );
      let lastError = "no tts model attempted";
      for (const ttsModel of candidates) {
        try {
          const response = await client.audio.speech.create({
            model: ttsModel,
            voice: voice as "alloy",
            input: text,
            response_format: opts.format || "mp3",
          });
          const ab = await response.arrayBuffer();
          return {
            ok: true,
            bytes: Buffer.from(ab),
            mimeType: opts.format === "wav" ? "audio/wav" : "audio/mpeg",
            model: ttsModel,
            voice,
            synthetic: true,
          };
        } catch (error) {
          lastError = String((error as Error)?.message || error);
          if (/model|access|permission|not found|404|400/i.test(lastError)) continue;
          return {
            ok: false,
            status: "PROVIDER_ERROR",
            reason: lastError.slice(0, 400),
            blocker: "PROVIDER_ERROR:openai:voice_generation",
          };
        }
      }
      return {
        ok: false,
        status: "MODEL_ACCESS_DENIED",
        reason: lastError.slice(0, 400),
        blocker: "MISSING_MODEL_ACCESS:voice_generation (need tts-1 on AURA_OPENAI_API_KEY)",
      };
    },

    /**
     * Health/capability probe — never returns secret values or key prefixes.
     */
    async probeMediaCapabilities(opts?: { deep?: boolean }): Promise<MediaCapabilityProbe> {
      const blockers: string[] = [];
      const models: MediaCapabilityProbe["models"] = {
        chat: model,
        image: envModel("AURA_IMAGE_MODEL"),
        imageEdit: envModel("AURA_IMAGE_EDIT_MODEL") || "dall-e-2",
        voice: envModel("AURA_TTS_MODEL"),
      };
      const access: MediaCapabilityProbe["MODEL_ACCESS"] = {
        chat: "UNKNOWN",
        image_generation: "UNKNOWN",
        image_editing: "UNKNOWN",
        voice_generation: "UNKNOWN",
        video_generation: "NO",
      };

      if (!config.apiKey) {
        return {
          PROVIDER_NAME: "openai",
          CREDENTIAL_PRESENT: "NO",
          MODEL_ACCESS: {
            chat: "NO",
            image_generation: "NO",
            image_editing: "NO",
            voice_generation: "NO",
            video_generation: "NO",
          },
          CAPABILITIES_AVAILABLE: [],
          INTEGRATION_STATUS: "NOT_CONFIGURED",
          models,
          blockers: ["MISSING_CREDENTIAL:AURA_OPENAI_API_KEY"],
          note: "OpenAI wrapper present; no API key configured.",
        };
      }

      try {
        const listed = await client.models.list();
        const ids = new Set<string>();
        for await (const m of listed) ids.add(m.id);
        access.chat = [...ids].some((id) => /gpt|o1|o3|chat/i.test(id)) ? "YES" : "UNKNOWN";
        const imageHit = DEFAULT_IMAGE_MODELS.find((id) => ids.has(id)) || [...ids].find((id) => /dall-e|gpt-image|image/i.test(id));
        const voiceHit = DEFAULT_TTS_MODELS.find((id) => ids.has(id)) || [...ids].find((id) => /tts|audio/i.test(id));
        if (imageHit) {
          access.image_generation = "YES";
          models.image = models.image || imageHit;
          access.image_editing = ids.has("dall-e-2") || /dall-e-2|gpt-image/i.test(imageHit) ? "YES" : "UNKNOWN";
        } else {
          access.image_generation = "NO";
          blockers.push("MISSING_MODEL_ACCESS:image_generation");
        }
        if (voiceHit) {
          access.voice_generation = "YES";
          models.voice = models.voice || voiceHit;
        } else {
          access.voice_generation = "NO";
          blockers.push("MISSING_MODEL_ACCESS:voice_generation");
        }
        blockers.push("MISSING_PROVIDER:video_generation");
      } catch (error) {
        const reason = String((error as Error)?.message || error);
        if (/401|invalid api key|authentication/i.test(reason)) {
          blockers.push("INVALID_CREDENTIAL:AURA_OPENAI_API_KEY");
          return {
            PROVIDER_NAME: "openai",
            CREDENTIAL_PRESENT: "YES",
            MODEL_ACCESS: {
              chat: "NO",
              image_generation: "NO",
              image_editing: "NO",
              voice_generation: "NO",
              video_generation: "NO",
            },
            CAPABILITIES_AVAILABLE: [],
            INTEGRATION_STATUS: "ERROR",
            models,
            blockers,
            note: "Credential present but rejected by provider (value not shown).",
          };
        }
        blockers.push(`PROVIDER_HEALTH_ERROR:${reason.slice(0, 120)}`);
      }

      // Optional deep probe: tiny image call only when explicitly requested.
      if (opts?.deep && access.image_generation === "UNKNOWN") {
        const probe = await this.generateImage({
          prompt: "Solid black square, abstract, no people, no faces, no text.",
          size: "1024x1024",
        });
        access.image_generation = probe.ok ? "YES" : "NO";
        if (probe.ok) models.image = probe.model;
        else blockers.push(probe.blocker);
      }

      const available = Object.entries(access)
        .filter(([, v]) => v === "YES")
        .map(([k]) => k);

      return {
        PROVIDER_NAME: "openai",
        CREDENTIAL_PRESENT: "YES",
        MODEL_ACCESS: access,
        CAPABILITIES_AVAILABLE: available,
        INTEGRATION_STATUS: available.length ? (blockers.length ? "PARTIAL" : "READY") : "NOT_CONFIGURED",
        models,
        blockers,
        note: "OpenAI text provider may also expose image/TTS models; video remains unconfigured.",
      };
    },
  };
}

export { OpenAI };
