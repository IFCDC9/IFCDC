/**
 * Bootstrap + generate-missing-assets orchestration — Phase 6.
 */
import {
  CAPABILITIES,
  capabilityStatus,
  generate,
  listAdapters,
  registerAdapter,
  notConfiguredResult,
  healthCheckRegistry,
  modelCapabilityRegistryPublic,
  providersFor,
} from "./registry.mjs";
import { localGraphicsAdapter, localMusicStageAdapter } from "./adapters/local-graphics.mjs";
import { openaiMediaAdapter, hqOpenaiProxyAdapter, setOpenAiMediaHqLink } from "./adapters/openai-media.mjs";
import { createGenerationJob, runGenerationJob, listGenerationJobs } from "./jobs.mjs";

let booted = false;

export function bootGenerationEngine(opts = {}) {
  if (opts.hqLink) setOpenAiMediaHqLink(opts.hqLink);
  if (booted) return capabilityStatus();
  registerAdapter(localGraphicsAdapter);
  registerAdapter(localMusicStageAdapter);
  registerAdapter(openaiMediaAdapter);
  registerAdapter(hqOpenaiProxyAdapter);

  // Explicit unconfigured stubs for video / founder clone so HQ lists every capability honestly.
  const stubCaps = [
    "video_generation",
    "image_to_video",
    "text_to_video",
    "background_scene_broll",
    "founder_voice_clone",
    "founder_visual_clone",
  ];
  for (const capability of stubCaps) {
    registerAdapter({
      id: `stub-${capability}`,
      configured: false,
      capabilities: [capability],
      identityReference: /founder_/i.test(capability),
      async generate(cap) {
        return notConfiguredResult(
          cap,
          capability.startsWith("founder_")
            ? "Founder identity provider + approved source media required"
            : `No video provider credential configured for ${cap}`,
        );
      },
      describe() {
        return {
          configured: false,
          status: "NOT_CONFIGURED",
          blocker: `MISSING_PROVIDER:${capability}`,
        };
      },
    });
  }
  booted = true;
  return capabilityStatus();
}

/**
 * Attempt generation only for capabilities that are configured.
 * Returns generated files + exact missing list — never invents media.
 */
export async function generateMissingAssets(needs = [], context = {}) {
  bootGenerationEngine();
  const generated = [];
  const missing = [];
  const skipped = [];

  for (const need of needs) {
    const capability = need.capability || need.role;
    const person =
      need.person === true ||
      /founder|face|voice.?clone|likeness|clone/i.test(String(capability || "")) ||
      /founder|face|voice.?clone|likeness/i.test(String(need.label || ""));

    if (person) {
      skipped.push({
        ...need,
        status: "ARCHITECTURE_READY",
        blocker:
          need.blocker ||
          "FOUNDATION_MEDIA_MISSING_OR_PROVIDER: approved Founder source media + approved clone provider required; no face/voice synthesis without both",
      });
      continue;
    }

    if (!capability) {
      missing.push({ ...need, status: "UNSPECIFIED_CAPABILITY" });
      continue;
    }

    // Persist job — bounded retry + failover inside runGenerationJob / generate().
    const job = createGenerationJob({
      capability,
      request: {
        ...context,
        title: need.title || context.title,
        subtitle: need.subtitle || context.subtitle,
        prompt: need.prompt || context.prompt,
        text: need.text || context.text,
        outDir: context.outDir,
        fileName: need.fileName,
        width: context.width,
        height: context.height,
        person: false,
      },
    });

    const result = await runGenerationJob(job.id, generate);

    if (result.ok && result.path) {
      generated.push({ ...need, ...result, jobId: job.id });
    } else {
      missing.push({
        ...need,
        status: result.status || "NOT_CONFIGURED",
        blocker: result.blocker || result.reason || `MISSING_PROVIDER:${capability}`,
        result,
        jobId: job.id,
      });
    }
  }

  return {
    at: new Date().toISOString(),
    company: "IFCDC PRODUCTIONS",
    phase: 6,
    fake: false,
    capabilities: capabilityStatus(),
    registry: modelCapabilityRegistryPublic(),
    adapters: listAdapters().filter((a) => !String(a.id).startsWith("stub-")),
    generated,
    missing,
    skipped,
    anyGenerated: generated.length > 0,
    jobs: listGenerationJobs(12),
  };
}

export async function discoverProviders() {
  bootGenerationEngine();
  const health = await healthCheckRegistry();
  return {
    at: new Date().toISOString(),
    phase: 6,
    company: "IFCDC PRODUCTIONS",
    inventory: health.providers.map((p) => ({
      PROVIDER_NAME: p.health?.PROVIDER_NAME || p.id,
      CAPABILITIES_AVAILABLE: p.capabilities,
      CREDENTIAL_PRESENT: p.health?.CREDENTIAL_PRESENT || (p.configured ? "YES" : "NO"),
      MODEL_ACCESS: p.health?.MODEL_ACCESS || "UNKNOWN",
      INTEGRATION_STATUS: p.health?.INTEGRATION_STATUS || p.health?.status || "UNKNOWN",
      blockers: p.health?.blockers || [],
    })),
    capabilities: health.capabilities,
    registry: modelCapabilityRegistryPublic(),
  };
}

export {
  CAPABILITIES,
  capabilityStatus,
  generate,
  listAdapters,
  healthCheckRegistry,
  modelCapabilityRegistryPublic,
  providersFor,
  createGenerationJob,
  runGenerationJob,
  listGenerationJobs,
  setOpenAiMediaHqLink,
};
