/**
 * Runway video adapter (Phase 6C) — Mac side always proxies to HQ.
 * Local Mac .env has no generative keys; RUNWAY_API_KEY lives on Render HQ only.
 * Never prints secrets. Never Founder face/voice clone.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const VIDEO_CAPS = [
  "text_to_video",
  "image_to_video",
  "video_generation",
  "background_scene_broll",
  "reference_continuity",
];

let hqLink = null;

export function setRunwayMediaHqLink(link) {
  hqLink = link || null;
  runwayMediaAdapter.configured = Boolean(hqLink);
}

function writeOut(outDir, fileName, bytes) {
  mkdirSync(outDir, { recursive: true });
  const name = fileName || `runway-${Date.now().toString(36)}.mp4`;
  const path = join(outDir, name);
  writeFileSync(path, bytes);
  return { file: name, path };
}

async function proxyGenerate(capability, request) {
  if (!hqLink?.hqUrl || !hqLink?.token || !hqLink?.nodeId) {
    return {
      ok: false,
      status: "NOT_CONFIGURED",
      reason: "No HQ node link for Runway proxy (key is cloud-only)",
      blocker: "MISSING_CREDENTIAL:RUNWAY_API_KEY (Mac) + HQ_PROXY_UNAVAILABLE",
    };
  }

  let imageBase64 = request.imageBase64 || null;
  let imageMimeType = request.imageMimeType || "image/png";
  if (!imageBase64 && request.imagePath && existsSync(request.imagePath)) {
    imageBase64 = readFileSync(request.imagePath).toString("base64");
    if (/\.jpe?g$/i.test(request.imagePath)) imageMimeType = "image/jpeg";
    else if (/\.webp$/i.test(request.imagePath)) imageMimeType = "image/webp";
  }

  const response = await fetch(`${hqLink.hqUrl}/api/hq/aura/resolve/node/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${hqLink.token}`,
      "x-aura-resolve-node-id": hqLink.nodeId,
    },
    body: JSON.stringify({
      capability,
      request: {
        prompt: request.prompt || request.title,
        title: request.title,
        subtitle: request.subtitle,
        fileName: request.fileName,
        imageBase64,
        imageMimeType,
        durationSeconds: request.durationSeconds || 2,
        ratio: request.ratio || "1280:720",
        project: request.project,
        person: false,
      },
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body?.ok) {
    return {
      ok: false,
      status: body?.status || "NOT_CONFIGURED",
      reason: body?.reason || body?.error || `HQ Runway proxy HTTP ${response.status}`,
      blocker: body?.blocker || "MISSING_PROVIDER:runway_via_hq",
      provider: "hq-runway-proxy",
      CREDITS_USED: body?.CREDITS_USED,
      notAvailableOnAccount: Boolean(body?.notAvailableOnAccount),
    };
  }
  return body;
}

export const runwayMediaAdapter = {
  id: "runway-media",
  configured: false,
  priority: 10,
  identityReference: false,
  maxDurationSeconds: 10,
  aspectRatios: ["16:9", "9:16", "1:1"],
  costMetadata: {
    note: "Runway API credits; prefer gen4_turbo i2v / gen4.5 t2v; shortest duration",
  },
  capabilities: VIDEO_CAPS,
  describe() {
    return {
      id: "runway-media",
      kind: "runway-video",
      PROVIDER_NAME: "runway",
      CREDENTIAL_PRESENT: hqLink ? "YES" : "NO",
      CREDENTIAL_SOURCE: hqLink ? "hq_proxy" : null,
      RUNWAY_API_KEY_PRESENT: hqLink ? "PRESENT_VIA_HQ" : "NOT_PRESENT_LOCAL",
      personSynthesis: false,
      founderClone: false,
      availability: hqLink ? "callable_via_hq_proxy" : "waiting_hq_link",
      note: "Primary video provider. Key stays on Render HQ — never copied to Mac.",
    };
  },
  async health() {
    if (!hqLink) {
      return {
        status: "NOT_CONFIGURED",
        PROVIDER_NAME: "runway",
        CREDENTIAL_PRESENT: "NO",
        RUNWAY_API_KEY_PRESENT: "NOT_PRESENT_LOCAL",
        INTEGRATION_STATUS: "WAITING_HQ_LINK",
        blockers: ["HQ_PROXY_UNAVAILABLE"],
      };
    }
    return {
      status: "PROVIDER_CONFIGURED",
      PROVIDER_NAME: "runway",
      CREDENTIAL_PRESENT: "YES",
      CREDENTIAL_PATH: "hq_proxy",
      RUNWAY_API_KEY_PRESENT: "PRESENT_VIA_HQ",
      MODEL_ACCESS: "UNKNOWN_UNTIL_CALL",
      INTEGRATION_STATUS: "PARTIAL",
    };
  },
  async generate(capability, request = {}) {
    if (
      request.person === true ||
      /\b(founder|likeness|clone)\b/i.test(String(request.prompt || ""))
    ) {
      return {
        ok: false,
        status: "ARCHITECTURE_READY",
        reason: "Person / Founder synthesis blocked",
        blocker: "FOUNDATION_MEDIA_MISSING_OR_PROVIDER",
      };
    }
    const outDir = request.outDir;
    if (!outDir) {
      return { ok: false, status: "FAILED", reason: "outDir required", blocker: "MISSING_OUTDIR" };
    }
    if (!VIDEO_CAPS.includes(capability)) {
      return {
        ok: false,
        status: "NOT_CONFIGURED",
        reason: `runway-media does not handle ${capability}`,
        blocker: `MISSING_PROVIDER:${capability}`,
      };
    }

    const proxied = await proxyGenerate(capability, request);
    if (!proxied.ok) return proxied;
    if (!proxied.fileBase64) {
      return {
        ok: false,
        status: "PROVIDER_ERROR",
        reason: "HQ Runway proxy returned ok without file bytes",
        blocker: "PROVIDER_ERROR:hq-runway-proxy",
      };
    }
    const bytes = Buffer.from(proxied.fileBase64, "base64");
    const name =
      request.fileName ||
      proxied.fileName ||
      `runway-${capability.replace(/_/g, "-")}-${Date.now().toString(36)}.mp4`;
    const written = writeOut(outDir, name, bytes);
    return {
      ok: true,
      status: "GENERATED",
      ...written,
      kind: "provider_video",
      providerModel: proxied.providerModel || null,
      provider: "hq-runway-proxy",
      durationSeconds: proxied.durationSeconds ?? null,
      CREDITS_USED: proxied.CREDITS_USED,
      hqPreviewId: proxied.hqPreviewId || null,
      hqPreviewUrl: proxied.hqPreviewUrl || null,
      personSynthesis: false,
      bytes: bytes.length,
    };
  },
};
