/**
 * Cloud-side generative provider discovery + media execution (Phase 6 / 6C).
 * OpenAI via @ifcdc/aura-ai for image + synthetic TTS.
 * Runway for primary generative video when RUNWAY_API_KEY is PRESENT.
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
import {
  generateRunwayVideo,
  isRunwayVideoCapability,
  runwayApiKeyPresence,
  RUNWAY_I2V_MODEL,
  RUNWAY_T2V_MODEL,
} from "./runwayVideoProvider";

export const PHASE6_CAPABILITIES = [
  "IMAGE_GENERATION",
  "IMAGE_EDITING",
  "TEXT_TO_VIDEO",
  "IMAGE_TO_VIDEO",
  "VIDEO_GENERATION",
  "BROLL_GENERATION",
  "REFERENCE_CONTINUITY",
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
  REFERENCE_CONTINUITY: "reference_continuity",
  VOICE_GENERATION: "voice_generation",
  FOUNDER_VOICE: "founder_voice_clone",
  FOUNDER_VISUAL_GENERATION: "founder_visual_clone",
  image_generation: "image_generation",
  image_editing: "image_editing",
  text_to_video: "text_to_video",
  image_to_video: "image_to_video",
  video_generation: "video_generation",
  background_scene_broll: "background_scene_broll",
  reference_continuity: "reference_continuity",
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
          text_to_video: "NO",
          image_to_video: "NO",
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

  const runwayPresent = runwayApiKeyPresence() === "PRESENT";
  if (runwayPresent) {
    providers.push({
      PROVIDER_NAME: "runway",
      CAPABILITIES_AVAILABLE: [
        "text_to_video",
        "image_to_video",
        "video_generation",
        "background_scene_broll",
        "reference_continuity",
      ],
      CREDENTIAL_PRESENT: "YES",
      RUNWAY_API_KEY_PRESENT: "PRESENT",
      MODEL_ACCESS: {
        text_to_video: "YES",
        image_to_video: "YES",
        video_generation: "YES",
        background_scene_broll: "YES",
        reference_continuity: "UNKNOWN_UNTIL_CALL",
      },
      models: {
        text_to_video: RUNWAY_T2V_MODEL,
        image_to_video: RUNWAY_I2V_MODEL,
        video: RUNWAY_T2V_MODEL,
      },
      INTEGRATION_STATUS: "PROVIDER_CONFIGURED",
      PRIMARY_FOR: ["text_to_video", "image_to_video", "video_generation", "background_scene_broll"],
      via: "runway_rest_api",
      note: "Primary video provider. OpenAI remains image + synthetic TTS only.",
    });
  }

  // Explicit absent video/identity vendors (skip runway when PRESENT above)
  for (const name of ["replicate", "runway", "luma", "elevenlabs", "stability", "fal", "heygen", "did"]) {
    if (name === "runway" && runwayPresent) continue;
    const envName = inventory.find((i) => i.name.toLowerCase().includes(name.replace("-", ""))) || null;
    const present = inventory.some(
      (i) => i.CREDENTIAL_PRESENT === "YES" && i.name.toLowerCase().includes(name.replace("-", "")),
    );
    if (!present) {
      providers.push({
        PROVIDER_NAME: name,
        CAPABILITIES_AVAILABLE: [],
        CREDENTIAL_PRESENT: "NO",
        ...(name === "runway" ? { RUNWAY_API_KEY_PRESENT: "NOT_PRESENT" as const } : {}),
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
        models?: Record<string, string | null | undefined>;
      }
    | undefined;
  const access = openai?.MODEL_ACCESS || {};
  const openaiModels = openai?.models || {};

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
            model: openaiModels.imageEdit || null,
            internal,
            identityReference: false,
            aspectRatios: ["1:1"],
            availability: ok ? "callable" : "no_or_unknown_edit_access",
            blocker: ok
              ? null
              : openaiCred
                ? "MISSING_MODEL_ACCESS:image_editing"
                : "MISSING_CREDENTIAL:AURA_OPENAI_API_KEY",
          },
        ];
      }
      if (
        cap === "TEXT_TO_VIDEO" ||
        cap === "IMAGE_TO_VIDEO" ||
        cap === "VIDEO_GENERATION" ||
        cap === "BROLL_GENERATION" ||
        cap === "REFERENCE_CONTINUITY"
      ) {
        // Runway is PRIMARY video when key PRESENT. Never route video to OpenAI image models.
        if (runwayPresent) {
          const model =
            cap === "IMAGE_TO_VIDEO" ? RUNWAY_I2V_MODEL : RUNWAY_T2V_MODEL;
          return [
            cap,
            {
              status: "PROVIDER_CONFIGURED",
              provider: "runway",
              model,
              internal,
              identityReference: false,
              availability: "callable",
              blocker: null,
              EXTERNAL_VIDEO_PROVIDER_REQUIRED: "NO",
              failover: [],
              note: "Primary video = Runway. No other compatible video provider configured.",
            },
          ];
        }
        const videoOk = access.video_generation === "YES";
        const t2vOk = access.text_to_video === "YES";
        const i2vOk = access.image_to_video === "YES";
        const ok =
          cap === "TEXT_TO_VIDEO" ? t2vOk : cap === "IMAGE_TO_VIDEO" ? i2vOk : videoOk;
        return [
          cap,
          {
            status: ok ? "PROVIDER_CONFIGURED" : "ARCHITECTURE_READY",
            provider: ok ? "openai" : null,
            model: openaiModels.video || null,
            internal,
            identityReference: false,
            availability: ok ? "listed_on_key" : "no_video_model_on_key",
            blocker: ok
              ? null
              : "MISSING_PROVIDER:runway (RUNWAY_API_KEY NOT_PRESENT) — OpenAI image models must never receive video jobs",
            EXTERNAL_VIDEO_PROVIDER_REQUIRED: ok ? "NO" : "YES",
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

  const phase6bCapabilityAudit = [
    {
      CAPABILITY: "IMAGE_GENERATION",
      CURRENT_OPENAI_SUPPORT: access.image_generation === "YES" ? "YES" : "NO",
      MODEL: openaiModels.image || null,
      ACCESS_AVAILABLE: access.image_generation === "YES" ? "YES" : "NO",
      ADDITIONAL_PROVIDER_REQUIRED: access.image_generation === "YES" ? "NO" : "YES",
      REASON:
        access.image_generation === "YES"
          ? "PRESERVED_PHASE6_PASS (gpt-image-1 path)"
          : "No image model listed on configured key",
    },
    {
      CAPABILITY: "IMAGE_EDITING",
      CURRENT_OPENAI_SUPPORT: access.image_editing === "YES" ? "YES" : "NO",
      MODEL: openaiModels.imageEdit || null,
      ACCESS_AVAILABLE: access.image_editing === "YES" ? "YES" : "NO",
      ADDITIONAL_PROVIDER_REQUIRED: access.image_editing === "YES" ? "NO" : "YES",
      REASON:
        access.image_editing === "YES"
          ? "images.edit model listed (gpt-image-1 and/or dall-e-2)"
          : "No images.edit-capable model on configured key",
    },
    {
      CAPABILITY: "TEXT_TO_VIDEO",
      CURRENT_OPENAI_SUPPORT: access.text_to_video === "YES" ? "YES" : "NO",
      MODEL: runwayPresent ? RUNWAY_T2V_MODEL : openaiModels.video || null,
      ACCESS_AVAILABLE: runwayPresent || access.text_to_video === "YES" ? "YES" : "NO",
      ADDITIONAL_PROVIDER_REQUIRED: runwayPresent || access.text_to_video === "YES" ? "NO" : "YES",
      PRIMARY_PROVIDER: runwayPresent ? "runway" : access.text_to_video === "YES" ? "openai" : null,
      REASON: runwayPresent
        ? "PHASE_6C: Runway PRIMARY text-to-video"
        : access.text_to_video === "YES"
          ? "Video/sora model listed on key"
          : "No OpenAI video/sora model; RUNWAY_API_KEY NOT_PRESENT",
    },
    {
      CAPABILITY: "IMAGE_TO_VIDEO",
      CURRENT_OPENAI_SUPPORT: access.image_to_video === "YES" ? "YES" : access.image_to_video === "UNKNOWN" ? "UNKNOWN" : "NO",
      MODEL: runwayPresent ? RUNWAY_I2V_MODEL : openaiModels.video || null,
      ACCESS_AVAILABLE: runwayPresent || access.image_to_video === "YES" ? "YES" : "NO",
      ADDITIONAL_PROVIDER_REQUIRED: runwayPresent || access.image_to_video === "YES" ? "NO" : "YES",
      PRIMARY_PROVIDER: runwayPresent ? "runway" : access.image_to_video === "YES" ? "openai" : null,
      REASON: runwayPresent
        ? "PHASE_6C: Runway PRIMARY image-to-video (gen4_turbo)"
        : access.image_to_video === "YES"
          ? "Confirmed image-to-video on key"
          : "OpenAI image-to-video not confirmed; RUNWAY_API_KEY NOT_PRESENT",
    },
    {
      CAPABILITY: "VIDEO_GENERATION",
      CURRENT_OPENAI_SUPPORT: access.video_generation === "YES" ? "YES" : "NO",
      MODEL: runwayPresent ? RUNWAY_T2V_MODEL : openaiModels.video || null,
      ACCESS_AVAILABLE: runwayPresent || access.video_generation === "YES" ? "YES" : "NO",
      ADDITIONAL_PROVIDER_REQUIRED: runwayPresent || access.video_generation === "YES" ? "NO" : "YES",
      PRIMARY_PROVIDER: runwayPresent ? "runway" : access.video_generation === "YES" ? "openai" : null,
      REASON: runwayPresent
        ? "PHASE_6C: Runway PRIMARY video generation"
        : access.video_generation === "YES"
          ? "Video model listed on key"
          : "No OpenAI video model; external provider required for generative video/B-roll",
    },
    {
      CAPABILITY: "GENERATED_BROLL",
      CURRENT_OPENAI_SUPPORT: access.video_generation === "YES" ? "PARTIAL" : "NO",
      MODEL: runwayPresent ? RUNWAY_T2V_MODEL : openaiModels.video || null,
      ACCESS_AVAILABLE: runwayPresent || access.video_generation === "YES" ? "YES" : "NO",
      ADDITIONAL_PROVIDER_REQUIRED: runwayPresent || access.video_generation === "YES" ? "NO" : "YES",
      PRIMARY_PROVIDER: runwayPresent ? "runway" : null,
      REASON: runwayPresent
        ? "PHASE_6C: B-roll via Runway video"
        : "B-roll requires callable video generation; stills alone are not B-roll video",
    },
    {
      CAPABILITY: "REFERENCE_CONTINUITY",
      CURRENT_OPENAI_SUPPORT: "NO",
      MODEL: runwayPresent ? RUNWAY_T2V_MODEL : null,
      ACCESS_AVAILABLE: runwayPresent ? "UNKNOWN_UNTIL_CALL" : "NO",
      ADDITIONAL_PROVIDER_REQUIRED: runwayPresent ? "NO" : "YES",
      PRIMARY_PROVIDER: runwayPresent ? "runway" : null,
      REASON: runwayPresent
        ? "PHASE_6C: Attempt Runway reference/continuity if account exposes it; else NOT_AVAILABLE_ON_ACCOUNT"
        : "Requires RUNWAY_API_KEY + reference-capable endpoint",
    },
    {
      CAPABILITY: "FOUNDER_VISUAL_GENERATION",
      CURRENT_OPENAI_SUPPORT: "NO",
      MODEL: null,
      ACCESS_AVAILABLE: "NO",
      ADDITIONAL_PROVIDER_REQUIRED: "YES",
      REASON: "Blocked until Founder reference designation + identity provider (no HeyGen/D-ID credential)",
    },
    {
      CAPABILITY: "FOUNDER_VOICE_GENERATION",
      CURRENT_OPENAI_SUPPORT: "NO",
      MODEL: null,
      ACCESS_AVAILABLE: "NO",
      ADDITIONAL_PROVIDER_REQUIRED: "YES",
      REASON: "Synthetic TTS preserved; Founder voice clone needs designated voice ref + clone provider",
    },
    {
      CAPABILITY: "OPENAI_VOICE_GENERATION",
      CURRENT_OPENAI_SUPPORT: access.voice_generation === "YES" ? "YES" : "NO",
      MODEL: openaiModels.voice || null,
      ACCESS_AVAILABLE: access.voice_generation === "YES" ? "YES" : "NO",
      ADDITIONAL_PROVIDER_REQUIRED: access.voice_generation === "YES" ? "NO" : "YES",
      REASON:
        access.voice_generation === "YES"
          ? "PRESERVED_PHASE6_PASS (gpt-4o-mini-tts / tts path — synthetic only)"
          : "No TTS model listed on configured key",
    },
  ];

  const videoAccess = runwayPresent || access.video_generation === "YES";
  return {
    at: new Date().toISOString(),
    phase: "6C",
    company: "IFCDC PRODUCTIONS",
    RUNWAY_API_KEY_PRESENT: runwayApiKeyPresence(),
    credentialInventory: inventory,
    providers,
    MODEL_CAPABILITY_REGISTRY: capabilityRegistry,
    PHASE_6B_CAPABILITY_AUDIT: phase6bCapabilityAudit,
    EXTERNAL_VIDEO_PROVIDER_REQUIRED: videoAccess ? "NO" : "YES",
    RECOMMENDED_VIDEO_PROVIDER: runwayPresent ? "runway" : videoAccess ? null : "runway",
    RECOMMENDATION_REASON: runwayPresent
      ? "PHASE_6C: RUNWAY_API_KEY PRESENT — Runway is PRIMARY for text-to-video, image-to-video, B-roll, and reference/continuity when supported. OpenAI stays image + synthetic TTS only."
      : videoAccess
        ? "OpenAI video model listed on configured key — prefer OpenAI first"
        : "Runway is already named in the Phase 6 router, has mature text-to-video + image-to-video API (Gen-4 Turbo / Gen-4.5), camera/reference controls, and clear API credit pricing for commercial IFCDC PRODUCTIONS drafts. Luma is a strong alternative for Dream Machine quality; Replicate is better as a multi-model fallback than a primary video vendor.",
    ESTIMATED_PROVIDER_COST_STRUCTURE: runwayPresent
      ? "Runway API credits ≈ $0.01/credit; Gen-4 Turbo ≈ 5 credits/sec; Gen-4.5 ≈ 12 credits/sec. Prefer shortest duration (2s) and cheapest capable model per call."
      : videoAccess
        ? "n/a — OpenAI video on existing key"
        : "Runway API credits ≈ $0.01/credit; Gen-4 Turbo ≈ 5 credits/sec (~$0.05/sec, ~$0.25 per 5s); Gen-4.5 ≈ 12 credits/sec (~$0.12/sec). API credits are separate from web subscriptions. Commercial use typically requires a paid Runway plan/terms — Founder must approve before any account or spend.",
    READY_FOR_FOUNDER_PROVIDER_DECISION: runwayPresent ? "CONFIGURED" : "YES",
    router: {
      status: runwayPresent ? "PROVIDER_CONFIGURED" : "ARCHITECTURE_READY",
      interface: "capability → approved adapter chain → failover → precise dependency",
      replaceable: true,
      hardCodedVendor: false,
      videoPrimary: runwayPresent ? "runway" : null,
      videoFailover: [],
      imagePrimary: "openai",
      voicePrimary: "openai",
    },
    note: "Report uses CREDENTIAL_PRESENT YES/NO and RUNWAY_API_KEY_PRESENT PRESENT/NOT_PRESENT only — no secret values.",
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
    phase: "6C",
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

  const outDir = generatedDir();

  // Phase 6C — Runway PRIMARY for video. Never send video jobs to OpenAI image models.
  if (isRunwayVideoCapability(capability)) {
    if (runwayApiKeyPresence() !== "PRESENT") {
      const result = {
        ok: false,
        status: "NOT_CONFIGURED",
        blocker: "MISSING_CREDENTIAL:RUNWAY_API_KEY",
        reason: "RUNWAY_API_KEY_PRESENT=NOT_PRESENT — video cannot use OpenAI image models",
        RUNWAY_API_KEY_PRESENT: "NOT_PRESENT" as const,
      };
      persistJob({ ...job, status: "FAILED_DEPENDENCY", result });
      return { ...result, jobId };
    }

    let imageBytes: Buffer | null = null;
    let imageMimeType = "image/png";
    if (request.imageBase64) {
      try {
        imageBytes = Buffer.from(String(request.imageBase64), "base64");
      } catch {
        imageBytes = null;
      }
      if (request.imageMimeType) imageMimeType = String(request.imageMimeType);
    }
    if (!imageBytes?.length && request.imagePath && typeof request.imagePath === "string") {
      const safeName = path.basename(request.imagePath);
      const candidate = path.join(outDir, safeName);
      if (fs.existsSync(candidate)) imageBytes = fs.readFileSync(candidate);
    }
    // Prefer already-generated Phase 6 non-person HQ stills for i2v / reference.
    if (!imageBytes?.length && (capability === "image_to_video" || capability === "reference_continuity")) {
      const existing = fs
        .readdirSync(outDir)
        .filter((n) => /^(openai-image|openai-edit|phase6).*\.(png|jpe?g|webp)$/i.test(n))
        .sort()
        .reverse()[0];
      if (existing) {
        imageBytes = fs.readFileSync(path.join(outDir, existing));
        if (/\.jpe?g$/i.test(existing)) imageMimeType = "image/jpeg";
        else if (/\.webp$/i.test(existing)) imageMimeType = "image/webp";
      }
    }

    const prompt = String(
      request.prompt ||
        "Non-person abstract IFCDC gold and ivory geometric motion graphic on deep black. Slow elegant camera drift. No people, no faces, no readable logos.",
    ).trim();

    // One attempt, optional single retry only on clear integration/download bugs.
    let gen = await generateRunwayVideo(capability, {
      prompt,
      imageBytes,
      imageMimeType,
      durationSeconds: Number(request.durationSeconds) || 2,
      ratio: String(request.ratio || "1280:720"),
      referenceMode: capability === "reference_continuity",
    });
    (job.attempts as unknown[]).push({
      n: 1,
      ok: gen.ok,
      status: gen.status,
      provider: "runway",
      model: gen.providerModel,
    });

    const retriable =
      !gen.ok &&
      /DOWNLOAD_FAILED|NO_OUTPUT_URL|NO_TASK_ID|TIMEOUT|poll_/i.test(String(gen.blocker || ""));
    if (retriable) {
      gen = await generateRunwayVideo(capability, {
        prompt,
        imageBytes,
        imageMimeType,
        durationSeconds: Number(request.durationSeconds) || 2,
        ratio: String(request.ratio || "1280:720"),
        referenceMode: capability === "reference_continuity",
      });
      (job.attempts as unknown[]).push({
        n: 2,
        ok: gen.ok,
        status: gen.status,
        provider: "runway",
        model: gen.providerModel,
        retry: "integration_once",
      });
    }

    if (!gen.ok || !gen.bytes?.length) {
      const result = {
        ok: false,
        status: gen.status,
        blocker: gen.blocker,
        reason: gen.reason,
        provider: "runway",
        providerModel: gen.providerModel,
        RUNWAY_API_KEY_PRESENT: "PRESENT" as const,
        CREDITS_USED: gen.creditsReported
          ? gen.creditsUsed
          : "UNKNOWN_API_DID_NOT_REPORT",
        creditsReported: gen.creditsReported,
        durationSeconds: gen.durationSeconds,
        notAvailableOnAccount: Boolean(gen.notAvailableOnAccount),
      };
      persistJob({
        ...job,
        status: gen.notAvailableOnAccount ? "NOT_AVAILABLE_ON_ACCOUNT" : "FAILED_DEPENDENCY",
        result,
      });
      return { ...result, jobId };
    }

    const fileName = String(
      request.fileName || `runway-${capability.replace(/_/g, "-")}-${Date.now().toString(36)}.mp4`,
    );
    const filePath = path.join(outDir, fileName);
    fs.writeFileSync(filePath, gen.bytes);

    let preview: Record<string, unknown> | null = null;
    try {
      const { storeAuraResolvePreview } = await import("./auraResolveProductionNode");
      preview = await storeAuraResolvePreview({
        name: fileName,
        project: String(request.project || request.title || "IFCDC-PHASE6C-RUNWAY"),
        instruction: prompt.slice(0, 240),
        duration: gen.durationSeconds ?? null,
        contentType: "video/mp4",
        base64: gen.bytes.toString("base64"),
        size: gen.bytes.length,
      });
    } catch (error) {
      preview = {
        ok: false,
        error: String((error as Error)?.message || error).slice(0, 200),
      };
    }

    const creditsUsed = gen.creditsReported
      ? gen.creditsUsed
      : "UNKNOWN_API_DID_NOT_REPORT";

    const result = {
      ok: true,
      status: "GENERATED",
      capability,
      provider: "runway",
      providerModel: gen.providerModel,
      fileName,
      path: filePath,
      fileBase64: gen.bytes.toString("base64"),
      mimeType: gen.mimeType || "video/mp4",
      kind: "provider_video",
      bytes: gen.bytes.length,
      durationSeconds: gen.durationSeconds,
      ratio: gen.ratio,
      taskId: gen.taskId,
      CREDITS_USED: creditsUsed,
      creditsReported: gen.creditsReported,
      fake: false as const,
      publish: false,
      RUNWAY_API_KEY_PRESENT: "PRESENT" as const,
      preview,
      hqPreviewId: preview && "id" in preview ? preview.id : null,
      hqPreviewUrl: preview && "previewUrl" in preview ? preview.previewUrl : null,
    };
    persistJob({
      ...job,
      status: "SUCCEEDED",
      result: {
        ...result,
        fileBase64: `[omitted ${gen.bytes.length} bytes]`,
      },
    });
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
            ? "1024x1536"
            : Number(request.width) > Number(request.height)
              ? "1536x1024"
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
        let sourceBytes: Buffer | null = null;
        if (request.imageBase64) {
          try {
            sourceBytes = Buffer.from(String(request.imageBase64), "base64");
          } catch {
            sourceBytes = null;
          }
        }
        if (!sourceBytes?.length && request.imagePath && typeof request.imagePath === "string") {
          const safeName = path.basename(request.imagePath);
          const candidate = path.join(outDir, safeName);
          if (fs.existsSync(candidate)) sourceBytes = fs.readFileSync(candidate);
        }
        // Prefer an already-generated non-person HQ still if no source supplied
        if (!sourceBytes?.length) {
          const existing = fs
            .readdirSync(outDir)
            .filter((n) => /^openai-image-.*\.png$/i.test(n))
            .sort()
            .reverse()[0];
          if (existing) sourceBytes = fs.readFileSync(path.join(outDir, existing));
        }
        if (!sourceBytes?.length) {
          const result = {
            ok: false,
            status: "ARCHITECTURE_READY",
            blocker: "MISSING_INPUT:image_editing",
            reason: "Image edit requires source image bytes (upload imageBase64 or prior openai-image-*.png)",
          };
          persistJob({ ...job, status: "FAILED_DEPENDENCY", result });
          return { ...result, jobId };
        }
        const prompt = String(
          request.prompt ||
            "Non-person abstract edit: shift gold accents slightly warmer on black geometric shapes. No people, no faces, no readable logos.",
        ).trim();
        const gen = await client.editImage({ prompt, imageBytes: sourceBytes });
        (job.attempts as unknown[]).push({ n: i + 1, ok: gen.ok, status: gen.ok ? "GENERATED" : gen.status });
        if (!gen.ok) {
          if (/NOT_CONFIGURED|MODEL_ACCESS|MISSING_/i.test(gen.blocker)) {
            persistJob({ ...job, status: "FAILED_DEPENDENCY", result: gen });
            return { ...gen, jobId };
          }
          continue;
        }
        const fileName = String(request.fileName || `openai-edit-${Date.now().toString(36)}.png`);
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
          kind: "provider_image_edit",
          bytes: gen.bytes.length,
          fake: false,
        };
        persistJob({ ...job, status: "SUCCEEDED", result: { ...result, fileBase64: `[omitted ${gen.bytes.length} bytes]` } });
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
