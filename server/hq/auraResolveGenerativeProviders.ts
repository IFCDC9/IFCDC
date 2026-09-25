/**
 * Cloud-side generative provider discovery + OpenAI media execution (Phase 6).
 * Uses @ifcdc/aura-ai only — no new direct vendor client.
 * Never prints secrets / key prefixes / tokens.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { createAuraAI } from "@ifcdc/aura-ai";
import {
  resolveOpenAiCredentials,
  openAiClientOptions,
} from "../lib/openaiConfig";
import { getDataDir } from "../config/dataPaths";

export const PHASE6_CAPABILITIES = [
  "IMAGE_GENERATION",
  "IMAGE_EDITING",
  "TEXT_TO_VIDEO",
  "IMAGE_TO_VIDEO",
  "VIDEO_GENERATION",
  "BROLL_GENERATION",
  "VOICE_GENERATION",
  "FOUNDER_VOICE",
  "FOUNDER_VISUAL_GENERATION",
] as const;

const CAP_TO_INTERNAL: Record<string, string> = {
  IMAGE_GENERATION: "image_generation",
  IMAGE_EDITING: "image_editing",
  TEXT_TO_VIDEO: "text_to_video",
  IMAGE_TO_VIDEO: "image_to_video",
  VIDEO_GENERATION: "video_generation",
  BROLL_GENERATION: "background_scene_broll",
  VOICE_GENERATION: "voice_generation",
  FOUNDER_VOICE: "founder_voice_clone",
  FOUNDER_VISUAL_GENERATION: "founder_visual_clone",
  image_generation: "image_generation",
  image_editing: "image_editing",
  text_to_video: "text_to_video",
  image_to_video: "image_to_video",
  video_generation: "video_generation",
  background_scene_broll: "background_scene_broll",
  voice_generation: "voice_generation",
  founder_voice_clone: "founder_voice_clone",
  founder_visual_clone: "founder_visual_clone",
};

function generatedDir() {
  const dir = path.join(getDataDir(), "aura-resolve-generated");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function jobsDir() {
  const dir = path.join(getDataDir(), "aura-resolve-generation-jobs");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getAuraMediaClient() {
  const creds = resolveOpenAiCredentials();
  if (!creds) return null;
  const opts = openAiClientOptions(creds);
  return createAuraAI({
    apiKey: opts.apiKey,
    baseURL: opts.baseURL,
    organization: opts.organization,
    project: opts.project,
    model: process.env.AURA_MODEL || "gpt-4o-mini",
  });
}

function envCredentialInventory() {
  const names = [
    "AURA_OPENAI_API_KEY",
    "OPENAI_API_KEY",
    "AI_INTEGRATIONS_OPENAI_API_KEY",
    "REPLICATE_API_TOKEN",
    "RUNWAY_API_KEY",
    "LUMA_API_KEY",
    "ELEVENLABS_API_KEY",
    "ELEVEN_API_KEY",
    "STABILITY_API_KEY",
    "FAL_KEY",
    "FAL_API_KEY",
    "HEYGEN_API_KEY",
    "DID_API_KEY",
    "GOOGLE_AI_API_KEY",
    "GEMINI_API_KEY",
  ];
  return names.map((name) => {
    const raw = String(process.env[name] || "").trim();
    const present = Boolean(raw) && !/placeholder|your[_-]?|xxx|replace/i.test(raw) && raw.length >= 8;
    return { name, CREDENTIAL_PRESENT: present ? ("YES" as const) : ("NO" as const) };
  });
}

export async function discoverGenerativeProviders(opts?: { deep?: boolean }) {
  const inventory = envCredentialInventory();
  const openaiCred = resolveOpenAiCredentials();
  const providers: Array<Record<string, unknown>> = [];

  if (openaiCred) {
    const client = getAuraMediaClient();
    let probe: Awaited<ReturnType<NonNullable<ReturnType<typeof getAuraMediaClient>>["probeMediaCapabilities"]>> | null =
      null;
    try {
      probe = client ? await client.probeMediaCapabilities({ deep: Boolean(opts?.deep) }) : null;
    } catch (error) {
      probe = {
        PROVIDER_NAME: "openai",
        CREDENTIAL_PRESENT: "YES",
        MODEL_ACCESS: {
          chat: "UNKNOWN",
          image_generation: "UNKNOWN",
          image_editing: "UNKNOWN",
          voice_generation: "UNKNOWN",
          video_generation: "NO",
        },
        CAPABILITIES_AVAILABLE: [],
        INTEGRATION_STATUS: "ERROR",
        models: {},
        blockers: [`PROVIDER_HEALTH_ERROR:${String((error as Error)?.message || error).slice(0, 120)}`],
        note: "Probe failed (details truncated; no secrets).",
      };
    }
    providers.push({
      PROVIDER_NAME: "openai",
      CAPABILITIES_AVAILABLE: probe?.CAPABILITIES_AVAILABLE || ["chat"],
      CREDENTIAL_PRESENT: "YES",
      MODEL_ACCESS: probe?.MODEL_ACCESS || { chat: "YES" },
      INTEGRATION_STATUS: probe?.INTEGRATION_STATUS || "PARTIAL",
      models: probe?.models || {},
      blockers: probe?.blockers || [],
      via: "@ifcdc/aura-ai",
    });
  } else {
    providers.push({
      PROVIDER_NAME: "openai",
      CAPABILITIES_AVAILABLE: [],
      CREDENTIAL_PRESENT: "NO",
      MODEL_ACCESS: {
        chat: "NO",
        image_generation: "NO",
        image_editing: "NO",
        voice_generation: "NO",
        video_generation: "NO",
      },
      INTEGRATION_STATUS: "NOT_CONFIGURED",
      blockers: ["MISSING_CREDENTIAL:AURA_OPENAI_API_KEY"],
      via: "@ifcdc/aura-ai",
    });
  }

  // Explicit absent video/identity vendors
  for (const name of ["replicate", "runway", "luma", "elevenlabs", "stability", "fal", "heygen", "did"]) {
    const envName = inventory.find((i) => i.name.toLowerCase().includes(name.replace("-", ""))) || null;
    const present = inventory.some(
      (i) => i.CREDENTIAL_PRESENT === "YES" && i.name.toLowerCase().includes(name.replace("-", "")),
    );
    if (!present) {
      providers.push({
        PROVIDER_NAME: name,
        CAPABILITIES_AVAILABLE: [],
        CREDENTIAL_PRESENT: "NO",
        MODEL_ACCESS: "NO",
        INTEGRATION_STATUS: "NOT_CONFIGURED",
        blockers: [`MISSING_CREDENTIAL:${envName?.name || name.toUpperCase() + "_API_KEY"}`],
      });
    }
  }

  const openai = providers.find((p) => p.PROVIDER_NAME === "openai") as
    | {
        MODEL_ACCESS?: Record<string, string>;
        CREDENTIAL_PRESENT?: string;
      }
    | undefined;
  const access = openai?.MODEL_ACCESS || {};

  const capabilityRegistry = Object.fromEntries(
    PHASE6_CAPABILITIES.map((cap) => {
      const internal = CAP_TO_INTERNAL[cap];
      if (cap === "IMAGE_GENERATION") {
        const ok = access.image_generation === "YES";
        return [
          cap,
          {
            status: ok ? "PROVIDER_CONFIGURED" : openaiCred ? "ARCHITECTURE_READY" : "ARCHITECTURE_READY",
            provider: ok || openaiCred ? "openai" : null,
            internal,
            identityReference: false,
            maxDuration: null,
            aspectRatios: ["1:1", "9:16", "16:9"],
            availability: ok ? "callable" : openaiCred ? "credential_present_model_access_unknown_or_denied" : "no_credential",
            blocker: ok
              ? null
              : openaiCred
                ? "MISSING_MODEL_ACCESS:image_generation (dall-e-3 / gpt-image-1)"
                : "MISSING_CREDENTIAL:AURA_OPENAI_API_KEY",
            health: openai?.CREDENTIAL_PRESENT === "YES" ? "credential_ok" : "missing",
          },
        ];
      }
      if (cap === "IMAGE_EDITING") {
        const ok = access.image_editing === "YES";
        return [
          cap,
          {
            status: ok ? "PROVIDER_CONFIGURED" : "ARCHITECTURE_READY",
            provider: openaiCred ? "openai" : null,
            internal,
            identityReference: false,
            aspectRatios: ["1:1"],
            blocker: ok
              ? null
              : openaiCred
                ? "MISSING_MODEL_ACCESS:image_editing"
                : "MISSING_CREDENTIAL:AURA_OPENAI_API_KEY",
          },
        ];
      }
      if (cap === "VOICE_GENERATION") {
        const ok = access.voice_generation === "YES";
        return [
          cap,
          {
            status: ok ? "PROVIDER_CONFIGURED" : "ARCHITECTURE_READY",
            provider: openaiCred ? "openai" : null,
            internal,
            identityReference: false,
            syntheticOnly: true,
            blocker: ok
              ? null
              : openaiCred
                ? "MISSING_MODEL_ACCESS:voice_generation (tts-1)"
                : "MISSING_CREDENTIAL:AURA_OPENAI_API_KEY",
          },
        ];
      }
      if (cap === "FOUNDER_VOICE" || cap === "FOUNDER_VISUAL_GENERATION") {
        return [
          cap,
          {
            status: "ARCHITECTURE_READY",
            provider: null,
            internal,
            identityReference: true,
            blocker:
              "FOUNDATION_MEDIA_MISSING + MISSING_PROVIDER:founder identity clone (no HeyGen/D-ID/ElevenLabs clone credential)",
          },
        ];
      }
      return [
        cap,
        {
          status: "ARCHITECTURE_READY",
          provider: null,
          internal,
          identityReference: false,
          blocker: `MISSING_PROVIDER:${internal} (need Runway/Luma/Replicate or equivalent video credential)`,
        },
      ];
    }),
  );

  return {
    at: new Date().toISOString(),
    phase: 6,
    company: "IFCDC PRODUCTIONS",
    credentialInventory: inventory,
    providers,
    MODEL_CAPABILITY_REGISTRY: capabilityRegistry,
    router: {
      status: "ARCHITECTURE_READY",
      interface: "capability → approved adapter chain → failover → precise dependency",
      replaceable: true,
      hardCodedVendor: false,
    },
    note: "Report uses CREDENTIAL_PRESENT YES/NO only — no secret values.",
  };
}

function persistJob(job: Record<string, unknown>) {
  const file = path.join(jobsDir(), `${job.id}.json`);
  fs.writeFileSync(file, JSON.stringify(job, null, 2));
  return job;
}

export function listCloudGenerationJobs(limit = 30) {
  const dir = jobsDir();
  return fs
    .readdirSync(dir)
    .filter((n) => n.endsWith(".json"))
    .map((n) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, n), "utf8"));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a: any, b: any) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, limit);
}

export async function executeCloudGeneration(capabilityRaw: string, request: Record<string, unknown> = {}) {
  const capability = CAP_TO_INTERNAL[capabilityRaw] || capabilityRaw;
  const jobId = `cgen_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
  const job: Record<string, unknown> = {
    id: jobId,
    capability,
    status: "RUNNING",
    attempts: [],
    createdAt: new Date().toISOString(),
    publish: false,
    company: "IFCDC PRODUCTIONS",
  };
  persistJob(job);

  if (/founder_|face|likeness|clone/i.test(capability) || request.person === true) {
    const result = {
      ok: false,
      status: "ARCHITECTURE_READY",
      blocker: "FOUNDATION_MEDIA_MISSING_OR_PROVIDER",
      reason: "No Founder face/voice generation without approved source + identity provider",
    };
    persistJob({ ...job, status: "FAILED_DEPENDENCY", result });
    return { ...result, jobId };
  }

  const client = getAuraMediaClient();
  if (!client) {
    const result = {
      ok: false,
      status: "NOT_CONFIGURED",
      blocker: "MISSING_CREDENTIAL:AURA_OPENAI_API_KEY",
      reason: "No OpenAI credential configured for generative media",
    };
    persistJob({ ...job, status: "FAILED_DEPENDENCY", result });
    return { ...result, jobId };
  }

  const outDir = generatedDir();
  const maxAttempts = 3;

  for (let i = 0; i < maxAttempts; i++) {
    try {
      if (capability === "image_generation") {
        const prompt = String(
          request.prompt ||
            `Non-person abstract IFCDC training still: gold geometric shapes on black, no people, no faces, no readable logos. ${request.title || ""} ${request.subtitle || ""}`,
        ).trim();
        const size =
          Number(request.height) > Number(request.width)
            ? "1024x1792"
            : Number(request.width) > Number(request.height)
              ? "1792x1024"
              : "1024x1024";
        const gen = await client.generateImage({ prompt, size: size as "1024x1024" });
        (job.attempts as unknown[]).push({ n: i + 1, ok: gen.ok, status: gen.ok ? "GENERATED" : gen.status });
        if (!gen.ok) {
          if (/NOT_CONFIGURED|MODEL_ACCESS|MISSING_/i.test(gen.blocker)) {
            persistJob({ ...job, status: "FAILED_DEPENDENCY", result: gen });
            return { ...gen, jobId };
          }
          continue;
        }
        const fileName = String(request.fileName || `openai-image-${Date.now().toString(36)}.png`);
        const filePath = path.join(outDir, fileName);
        fs.writeFileSync(filePath, gen.bytes);
        const result = {
          ok: true,
          status: "GENERATED",
          capability,
          provider: "openai",
          providerModel: gen.model,
          fileName,
          path: filePath,
          fileBase64: gen.bytes.toString("base64"),
          mimeType: gen.mimeType,
          kind: "provider_image",
          bytes: gen.bytes.length,
          fake: false,
        };
        persistJob({ ...job, status: "SUCCEEDED", result: { ...result, fileBase64: `[omitted ${gen.bytes.length} bytes]` } });
        return { ...result, jobId };
      }

      if (capability === "voice_generation") {
        const text = String(request.text || request.prompt || "IFCDC PRODUCTIONS — training draft. Synthetic voice.").trim();
        const gen = await client.synthesizeSpeech({ text, voice: String(request.voice || "alloy") });
        (job.attempts as unknown[]).push({ n: i + 1, ok: gen.ok, status: gen.ok ? "GENERATED" : gen.status });
        if (!gen.ok) {
          if (/NOT_CONFIGURED|MODEL_ACCESS|MISSING_/i.test(gen.blocker)) {
            persistJob({ ...job, status: "FAILED_DEPENDENCY", result: gen });
            return { ...gen, jobId };
          }
          continue;
        }
        const fileName = String(request.fileName || `openai-tts-synthetic-${Date.now().toString(36)}.mp3`);
        const filePath = path.join(outDir, fileName);
        fs.writeFileSync(filePath, gen.bytes);
        const result = {
          ok: true,
          status: "GENERATED",
          capability,
          provider: "openai",
          providerModel: gen.model,
          fileName,
          path: filePath,
          fileBase64: gen.bytes.toString("base64"),
          mimeType: gen.mimeType,
          kind: "synthetic_voice",
          synthetic: true,
          voiceTag: "synthetic",
          bytes: gen.bytes.length,
          fake: false,
        };
        persistJob({ ...job, status: "SUCCEEDED", result: { ...result, fileBase64: `[omitted ${gen.bytes.length} bytes]` } });
        return { ...result, jobId };
      }

      if (capability === "image_editing") {
        const result = {
          ok: false,
          status: "ARCHITECTURE_READY",
          blocker: "MISSING_INPUT_OR_MODEL_ACCESS:image_editing",
          reason: "Image edit requires source image bytes + images.edit model access",
        };
        persistJob({ ...job, status: "FAILED_DEPENDENCY", result });
        return { ...result, jobId };
      }

      const result = {
        ok: false,
        status: "NOT_CONFIGURED",
        blocker: `MISSING_PROVIDER:${capability}`,
        reason: `No configured provider for ${capability}`,
      };
      persistJob({ ...job, status: "FAILED_DEPENDENCY", result });
      return { ...result, jobId };
    } catch (error) {
      (job.attempts as unknown[]).push({
        n: i + 1,
        ok: false,
        reason: String((error as Error)?.message || error).slice(0, 300),
      });
    }
  }

  const failed = {
    ok: false,
    status: "FAILED",
    blocker: `PROVIDER_ERROR:openai:${capability}`,
    reason: "Bounded retries exhausted",
    jobId,
  };
  persistJob({ ...job, status: "FAILED", result: failed });
  return failed;
}

export function phase6StatusFromDiscovery(discovery: Awaited<ReturnType<typeof discoverGenerativeProviders>>) {
  const reg = discovery.MODEL_CAPABILITY_REGISTRY as Record<string, { status?: string; blocker?: string | null }>;
  return {
    IMAGE_PROVIDER: reg.IMAGE_GENERATION?.status || "ARCHITECTURE_READY",
    IMAGE_EDIT_PROVIDER: reg.IMAGE_EDITING?.status || "ARCHITECTURE_READY",
    VIDEO_PROVIDER: reg.VIDEO_GENERATION?.status || "ARCHITECTURE_READY",
    VOICE_PROVIDER: reg.VOICE_GENERATION?.status || "ARCHITECTURE_READY",
    FOUNDER_VISUAL_PROVIDER: reg.FOUNDER_VISUAL_GENERATION?.status || "ARCHITECTURE_READY",
    FOUNDER_VOICE_PROVIDER: reg.FOUNDER_VOICE?.status || "ARCHITECTURE_READY",
  };
}
