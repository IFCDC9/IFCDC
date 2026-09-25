/**
 * OpenAI media adapter (Phase 6) — image + synthetic voice via @ifcdc/aura-ai or HQ proxy.
 * Local Pillow title cards are NOT image_generation. This adapter requires real model API bytes.
 * Never prints secrets. Never Founder face/voice clone.
 */
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { createRequire } from "module";
import { pathToFileURL } from "url";

const require = createRequire(import.meta.url);

function credentialPresent() {
  const keys = ["AURA_OPENAI_API_KEY", "OPENAI_API_KEY", "AI_INTEGRATIONS_OPENAI_API_KEY"];
  for (const name of keys) {
    const v = String(process.env[name] || "").trim();
    if (v && /^sk-/i.test(v) && v.length >= 40) return { present: true, source: name };
  }
  return { present: false, source: null };
}

async function loadAuraAI() {
  // Prefer package from HQ tree; fall back to dynamic import paths.
  const candidates = [
    join(process.cwd(), "Libraries/ifcdc-packages/packages/aura-ai/dist/index.js"),
    join(process.cwd(), "../Libraries/ifcdc-packages/packages/aura-ai/dist/index.js"),
    new URL("../../../Libraries/ifcdc-packages/packages/aura-ai/dist/index.js", import.meta.url).pathname,
  ];
  for (const p of candidates) {
    if (p && existsSync(p)) {
      return import(pathToFileURL(p).href);
    }
  }
  try {
    return await import("@ifcdc/aura-ai");
  } catch {
    return null;
  }
}

async function getLocalClient() {
  const cred = credentialPresent();
  if (!cred.present) return null;
  const mod = await loadAuraAI();
  if (!mod?.createAuraAI) return null;
  const apiKey =
    process.env[cred.source] ||
    process.env.AURA_OPENAI_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  return mod.createAuraAI({
    apiKey,
    model: process.env.AURA_MODEL || "gpt-4o-mini",
    organization: process.env.OPENAI_ORG_ID || process.env.OPENAI_ORGANIZATION || undefined,
    project: process.env.OPENAI_PROJECT_ID || undefined,
  });
}

/**
 * HQ cloud proxy — used when LaunchAgent has no local OpenAI key (typical Production Mac).
 * link: { hqUrl, token, nodeId }
 */
async function proxyGenerate(link, capability, request) {
  if (!link?.hqUrl || !link?.token || !link?.nodeId) {
    return {
      ok: false,
      status: "NOT_CONFIGURED",
      reason: "No local OpenAI credential and no HQ node link for proxy",
      blocker: "MISSING_CREDENTIAL:AURA_OPENAI_API_KEY (Mac) + HQ_PROXY_UNAVAILABLE",
    };
  }
  const response = await fetch(`${link.hqUrl}/api/hq/aura/resolve/node/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${link.token}`,
      "x-aura-resolve-node-id": link.nodeId,
    },
    body: JSON.stringify({
      capability,
      request: {
        prompt: request.prompt || request.title,
        text: request.text || request.prompt || request.title,
        subtitle: request.subtitle,
        size: request.size,
        width: request.width,
        height: request.height,
        fileName: request.fileName,
        voice: request.voice,
        person: false,
      },
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body?.ok) {
    return {
      ok: false,
      status: body?.status || "NOT_CONFIGURED",
      reason: body?.reason || body?.error || `HQ proxy HTTP ${response.status}`,
      blocker: body?.blocker || "MISSING_PROVIDER:openai_media_via_hq",
      provider: "hq-openai-proxy",
    };
  }
  return body;
}

function mapSize(request) {
  const w = Number(request.width || 0);
  const h = Number(request.height || 0);
  if (w && h) {
    if (h > w) return "1024x1792";
    if (w > h) return "1792x1024";
  }
  return request.size || "1024x1024";
}

function writeOut(outDir, fileName, bytes) {
  mkdirSync(outDir, { recursive: true });
  const name = fileName || `generated-${Date.now().toString(36)}.bin`;
  const path = join(outDir, name);
  writeFileSync(path, bytes);
  return { file: name, path };
}

/** Shared link setter — bridge injects HQ credentials for proxy mode. */
let hqLink = null;
export function setOpenAiMediaHqLink(link) {
  hqLink = link || null;
  openaiMediaAdapter.configured = credentialPresent().present || Boolean(hqLink);
  hqOpenaiProxyAdapter.configured = Boolean(hqLink);
}

function buildAdapter(id, { proxyOnly = false } = {}) {
  return {
    id,
    configured: proxyOnly ? false : credentialPresent().present,
    priority: proxyOnly ? 40 : 20,
    identityReference: false,
    maxDurationSeconds: null,
    aspectRatios: ["1:1", "9:16", "16:9"],
    costMetadata: { note: "OpenAI usage billed to configured org; no separate billing API wired" },
    capabilities: ["image_generation", "image_editing", "voice_generation"],
    describe() {
      const cred = credentialPresent();
      return {
        id,
        kind: "openai-media",
        PROVIDER_NAME: "openai",
        CREDENTIAL_PRESENT: cred.present || hqLink ? "YES" : "NO",
        CREDENTIAL_SOURCE: cred.present ? "local_env" : hqLink ? "hq_proxy" : null,
        personSynthesis: false,
        founderClone: false,
        availability: cred.present || hqLink ? "callable_if_model_access" : "waiting_credential",
        note: "Provider pixels/audio only. Synthetic voice tagged. No Founder clone.",
      };
    },
    async health() {
      const cred = credentialPresent();
      if (cred.present) {
        try {
          const client = await getLocalClient();
          if (!client?.probeMediaCapabilities) {
            return {
              status: "PROVIDER_CONFIGURED",
              PROVIDER_NAME: "openai",
              CREDENTIAL_PRESENT: "YES",
              MODEL_ACCESS: "UNKNOWN",
              INTEGRATION_STATUS: "PARTIAL",
            };
          }
          const probe = await client.probeMediaCapabilities({ deep: false });
          return {
            status: probe.INTEGRATION_STATUS,
            PROVIDER_NAME: probe.PROVIDER_NAME,
            CREDENTIAL_PRESENT: probe.CREDENTIAL_PRESENT,
            MODEL_ACCESS: probe.MODEL_ACCESS,
            CAPABILITIES_AVAILABLE: probe.CAPABILITIES_AVAILABLE,
            INTEGRATION_STATUS: probe.INTEGRATION_STATUS,
            blockers: probe.blockers,
          };
        } catch (error) {
          return {
            status: "ERROR",
            PROVIDER_NAME: "openai",
            CREDENTIAL_PRESENT: "YES",
            reason: String(error?.message || error).slice(0, 200),
          };
        }
      }
      if (hqLink) {
        return {
          status: "PROVIDER_CONFIGURED",
          PROVIDER_NAME: "openai",
          CREDENTIAL_PRESENT: "YES",
          CREDENTIAL_PATH: "hq_proxy",
          MODEL_ACCESS: "UNKNOWN_UNTIL_CALL",
          INTEGRATION_STATUS: "PARTIAL",
        };
      }
      return {
        status: "NOT_CONFIGURED",
        PROVIDER_NAME: "openai",
        CREDENTIAL_PRESENT: "NO",
        MODEL_ACCESS: "NO",
        INTEGRATION_STATUS: "NOT_CONFIGURED",
        blockers: ["MISSING_CREDENTIAL:AURA_OPENAI_API_KEY"],
      };
    },
    async generate(capability, request = {}) {
      if (request.person === true || /founder|face|likeness|clone/i.test(String(request.prompt || ""))) {
        return {
          ok: false,
          status: "ARCHITECTURE_READY",
          reason: "Person / Founder synthesis blocked without approved source + identity provider",
          blocker: "FOUNDATION_MEDIA_MISSING_OR_PROVIDER",
        };
      }

      const outDir = request.outDir;
      if (!outDir) {
        return { ok: false, status: "FAILED", reason: "outDir required", blocker: "MISSING_OUTDIR" };
      }

      // Prefer local client when credential present (unless proxy-only adapter).
      if (!proxyOnly) {
        const client = await getLocalClient();
        if (client) {
          if (capability === "image_generation") {
            const prompt =
              request.prompt ||
              `Non-person branded still for ${request.title || "IFCDC"}: abstract geometric gold and black composition, no people, no faces, no logos invented beyond simple shapes. ${request.subtitle || ""}`.trim();
            const result = await client.generateImage({ prompt, size: mapSize(request) });
            if (!result.ok) return result;
            const name = request.fileName || `openai-image-${Date.now().toString(36)}.png`;
            const written = writeOut(outDir, name, result.bytes);
            return {
              ok: true,
              status: "GENERATED",
              ...written,
              kind: "provider_image",
              providerModel: result.model,
              personSynthesis: false,
              bytes: result.bytes.length,
            };
          }
          if (capability === "image_editing") {
            if (!request.imagePath || !existsSync(request.imagePath)) {
              return {
                ok: false,
                status: "FAILED",
                reason: "imagePath required for editing",
                blocker: "MISSING_INPUT:image_editing",
              };
            }
            const { readFileSync } = await import("fs");
            const result = await client.editImage({
              prompt: request.prompt || "Subtle non-person edit",
              imageBytes: readFileSync(request.imagePath),
            });
            if (!result.ok) return result;
            const name = request.fileName || `openai-edit-${Date.now().toString(36)}.png`;
            const written = writeOut(outDir, name, result.bytes);
            return { ok: true, status: "GENERATED", ...written, kind: "provider_image_edit", providerModel: result.model };
          }
          if (capability === "voice_generation") {
            const text = request.text || request.prompt || `${request.title || "IFCDC"} — an IFCDC production.`;
            const result = await client.synthesizeSpeech({ text, voice: request.voice });
            if (!result.ok) return result;
            const name = request.fileName || `openai-tts-synthetic-${Date.now().toString(36)}.mp3`;
            const written = writeOut(outDir, name, result.bytes);
            return {
              ok: true,
              status: "GENERATED",
              ...written,
              kind: "synthetic_voice",
              synthetic: true,
              voiceTag: "synthetic",
              providerModel: result.model,
              personSynthesis: false,
            };
          }
        }
      }

      // HQ proxy path
      const proxied = await proxyGenerate(hqLink, capability, request);
      if (!proxied.ok) return proxied;
      if (!proxied.fileBase64) {
        return {
          ok: false,
          status: "PROVIDER_ERROR",
          reason: "HQ proxy returned ok without file bytes",
          blocker: "PROVIDER_ERROR:hq-openai-proxy",
        };
      }
      const bytes = Buffer.from(proxied.fileBase64, "base64");
      const ext =
        capability === "voice_generation" ? "mp3" : "png";
      const name =
        request.fileName ||
        proxied.fileName ||
        `openai-${capability.replace(/_/g, "-")}-${Date.now().toString(36)}.${ext}`;
      const written = writeOut(outDir, name, bytes);
      return {
        ok: true,
        status: "GENERATED",
        ...written,
        kind: proxied.kind || (capability === "voice_generation" ? "synthetic_voice" : "provider_image"),
        synthetic: Boolean(proxied.synthetic),
        voiceTag: proxied.synthetic ? "synthetic" : undefined,
        providerModel: proxied.providerModel || null,
        provider: "hq-openai-proxy",
        personSynthesis: false,
      };
    },
  };
}

export const openaiMediaAdapter = buildAdapter("openai-media", { proxyOnly: false });
export const hqOpenaiProxyAdapter = buildAdapter("hq-openai-proxy", { proxyOnly: true });

// silence unused require in environments without local openai
void require;
