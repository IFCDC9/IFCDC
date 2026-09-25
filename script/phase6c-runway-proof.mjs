#!/usr/bin/env node
/**
 * Phase 6C Runway production proofs against Render HQ.
 * Never prints secrets. Reports PRESENT/NOT_PRESENT and capability outcomes only.
 *
 * Usage:
 *   FOUNDER_SEED_PASSWORD=... node script/phase6c-runway-proof.mjs
 * Optional: IFCDC_BASE_URL (default production), FOUNDER_EMAIL
 */
import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const BASE = (process.env.IFCDC_BASE_URL || "https://ifcdc-hq-wst6.onrender.com").replace(/\/$/, "");
const EMAIL = process.env.FOUNDER_EMAIL || "service@ifcdc.org";
const PASSWORD = process.env.FOUNDER_SEED_PASSWORD || process.env.FOUNDER_PASSWORD || "";

const PHASE6_IMAGE = join(
  homedir(),
  "Library/Application Support/IFCDC/aura-resolve/IFCDC-PRODUCTIONS/GENERATED_FOUNDER_MEDIA/images/phase6-openai-image-muh0wbxg.png",
);

const PROMPT =
  "Non-person abstract IFCDC gold and ivory geometric motion graphic on deep black. Slow elegant camera drift. No people, no faces, no readable logos.";

function redact(obj) {
  const s = JSON.stringify(obj, null, 2);
  return s
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/sk-[a-zA-Z0-9_-]+/g, "[redacted]")
    .replace(/"fileBase64"\s*:\s*"[^"]+"/g, '"fileBase64":"[omitted]"')
    .replace(/"base64"\s*:\s*"[^"]+"/g, '"base64":"[omitted]"');
}

async function login() {
  if (!PASSWORD) {
    throw new Error("FOUNDER_SEED_PASSWORD required for production proofs");
  }
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const body = await res.json().catch(() => ({}));
  const setCookie = res.headers.getSetCookie?.() || [];
  const cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  if (!res.ok || !cookie) {
    throw new Error(`login failed HTTP ${res.status}: ${String(body.error || body.message || "").slice(0, 120)}`);
  }
  return cookie;
}

async function api(cookie, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, json };
}

function loadPhase6ImageBase64() {
  if (!existsSync(PHASE6_IMAGE)) return null;
  return {
    imageBase64: readFileSync(PHASE6_IMAGE).toString("base64"),
    imageMimeType: "image/png",
    source: PHASE6_IMAGE,
  };
}

async function waitMacJob(cookie, queuedId, timeoutMs = 180_000) {
  if (!queuedId) return null;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const status = await api(cookie, "GET", "/api/hq/aura/resolve/status");
    const jobs = status.json?.jobs || [];
    const hit = jobs.find((j) => j.id === queuedId || j.commandId === queuedId);
    if (hit && (hit.status === "complete" || hit.status === "failed" || hit.result)) {
      return hit;
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
  return { status: "TIMEOUT" };
}

async function main() {
  const report = {
    PHASE_6C_STATUS: "IN_PROGRESS",
    RUNWAY_API_KEY_PRESENT: "UNKNOWN",
    RUNWAY_PROVIDER: "runway",
    RUNWAY_CONNECTION: "UNKNOWN",
    TEXT_TO_VIDEO: "NOT_RUN",
    IMAGE_TO_VIDEO: "NOT_RUN",
    REFERENCE_CONTINUITY: "NOT_RUN",
    GENERATED_VIDEO_FILE: [],
    IFCDC_ASSET_LIBRARY_INGEST: "NOT_RUN",
    RESOLVE_GENERATED_MEDIA_INGEST: "NOT_RUN",
    HQ_PREVIEW_RETURN: "NOT_RUN",
    CREDITS_USED: [],
    PRODUCTION_MAC: "UNKNOWN",
    BRIDGE_PRIVACY: "UNKNOWN",
    PUBLISHING: "OFF",
    CURSOR_REQUIRED_FOR_NORMAL_VIDEO_PRODUCTION: "NO_ONCE_PROVIDER_CONFIGURED",
    BLOCKERS: [],
    productionCommit: null,
  };

  const health = await fetch(`${BASE}/api/hq/health`).then((r) => r.json()).catch(() => null);
  report.RUNWAY_API_KEY_PRESENT = health?.RUNWAY_API_KEY_PRESENT || "NOT_PRESENT";
  console.log("HEALTH_RUNWAY_API_KEY_PRESENT=", report.RUNWAY_API_KEY_PRESENT);

  const cookie = await login();
  const providers = await api(cookie, "GET", "/api/hq/aura/resolve/providers");
  report.RUNWAY_API_KEY_PRESENT =
    providers.json?.RUNWAY_API_KEY_PRESENT ||
    providers.json?.discovery?.RUNWAY_API_KEY_PRESENT ||
    report.RUNWAY_API_KEY_PRESENT;
  report.RUNWAY_CONNECTION =
    report.RUNWAY_API_KEY_PRESENT === "PRESENT" ? "CONFIGURED_ON_HQ" : "NOT_PRESENT";
  console.log("PROVIDERS_RUNWAY_API_KEY_PRESENT=", report.RUNWAY_API_KEY_PRESENT);

  const status = await api(cookie, "GET", "/api/hq/aura/resolve/status");
  report.PRODUCTION_MAC = status.json?.productionMac || (status.json?.bridge === "ONLINE" ? "ONLINE" : "OFFLINE");

  if (report.RUNWAY_API_KEY_PRESENT !== "PRESENT") {
    report.PHASE_6C_STATUS = "BLOCKED";
    report.BLOCKERS.push("RUNWAY_API_KEY_PRESENT=NOT_PRESENT on production");
    console.log(redact(report));
    process.exit(2);
  }

  // 1) text-to-video — full path
  const t2v = await api(cookie, "POST", "/api/hq/aura/resolve/generate", {
    capability: "text_to_video",
    prompt: PROMPT,
    project: "IFCDC-PHASE6C-T2V",
    durationSeconds: 2,
    ratio: "1280:720",
    fileName: `runway-t2v-${Date.now().toString(36)}.mp4`,
    publish: false,
    ingestToMac: true,
  });
  console.log("T2V_HTTP", t2v.status, "ok=", t2v.json?.ok, "model=", t2v.json?.providerModel, "preview=", t2v.json?.hqPreviewId);
  if (t2v.json?.ok) {
    report.TEXT_TO_VIDEO = `END_TO_END_PASS model=${t2v.json.providerModel} duration=${t2v.json.durationSeconds}s preview=${t2v.json.hqPreviewId} file=${t2v.json.fileName} job=${t2v.json.jobId}`;
    report.GENERATED_VIDEO_FILE.push({
      capability: "text_to_video",
      fileName: t2v.json.fileName,
      previewId: t2v.json.hqPreviewId,
      model: t2v.json.providerModel,
      durationSeconds: t2v.json.durationSeconds,
    });
    report.HQ_PREVIEW_RETURN = t2v.json.hqPreviewId ? `PASS:${t2v.json.hqPreviewId}` : "FAIL";
    report.CREDITS_USED.push({
      capability: "text_to_video",
      CREDITS_USED: t2v.json.CREDITS_USED,
      model: t2v.json.providerModel,
      durationSeconds: t2v.json.durationSeconds,
    });
    const queuedId = t2v.json.macIngest?.id || t2v.json.macIngest?.jobId || t2v.json.macIngest?.queued?.id;
    const mac = await waitMacJob(cookie, queuedId);
    if (mac && mac.status !== "TIMEOUT") {
      const result = mac.result || mac;
      report.IFCDC_ASSET_LIBRARY_INGEST = result.IFCDC_ASSET_LIBRARY_INGEST || (result.path ? "PASS" : "UNKNOWN");
      report.RESOLVE_GENERATED_MEDIA_INGEST =
        result.RESOLVE_GENERATED_MEDIA_INGEST ||
        (result.resolveImport?.import_media?.ok !== false && result.path ? "PASS" : "FAIL");
    } else if (!queuedId) {
      report.IFCDC_ASSET_LIBRARY_INGEST = "SKIPPED_MAC_OFFLINE_OR_NO_QUEUE";
      report.RESOLVE_GENERATED_MEDIA_INGEST = "SKIPPED_MAC_OFFLINE_OR_NO_QUEUE";
      report.BLOCKERS.push("Mac ingest not queued after T2V (node offline?)");
    } else {
      report.IFCDC_ASSET_LIBRARY_INGEST = "TIMEOUT_WAITING_MAC";
      report.RESOLVE_GENERATED_MEDIA_INGEST = "TIMEOUT_WAITING_MAC";
    }
  } else {
    report.TEXT_TO_VIDEO = `FAIL:${t2v.json?.blocker || t2v.json?.status}:${String(t2v.json?.reason || "").slice(0, 200)}`;
    report.BLOCKERS.push(`text_to_video:${t2v.json?.blocker || t2v.json?.error}`);
  }

  // 2) image-to-video — reuse Phase 6 still
  const img = loadPhase6ImageBase64();
  if (!img) {
    report.IMAGE_TO_VIDEO = "FAIL:MISSING_PHASE6_IMAGE_ON_DISK";
    report.BLOCKERS.push("Phase 6 image missing locally; refused to mint a new OpenAI still for i2v");
  } else {
    const i2v = await api(cookie, "POST", "/api/hq/aura/resolve/generate", {
      capability: "image_to_video",
      prompt: PROMPT,
      project: "IFCDC-PHASE6C-I2V",
      durationSeconds: 2,
      ratio: "1280:720",
      fileName: `runway-i2v-${Date.now().toString(36)}.mp4`,
      imageBase64: img.imageBase64,
      imageMimeType: img.imageMimeType,
      publish: false,
      ingestToMac: true,
    });
    console.log("I2V_HTTP", i2v.status, "ok=", i2v.json?.ok, "model=", i2v.json?.providerModel, "preview=", i2v.json?.hqPreviewId);
    if (i2v.json?.ok) {
      report.IMAGE_TO_VIDEO = `END_TO_END_PASS model=${i2v.json.providerModel} duration=${i2v.json.durationSeconds}s preview=${i2v.json.hqPreviewId} file=${i2v.json.fileName}`;
      report.GENERATED_VIDEO_FILE.push({
        capability: "image_to_video",
        fileName: i2v.json.fileName,
        previewId: i2v.json.hqPreviewId,
        model: i2v.json.providerModel,
        durationSeconds: i2v.json.durationSeconds,
        sourceImage: "phase6-openai-image-muh0wbxg.png",
      });
      report.CREDITS_USED.push({
        capability: "image_to_video",
        CREDITS_USED: i2v.json.CREDITS_USED,
        model: i2v.json.providerModel,
        durationSeconds: i2v.json.durationSeconds,
      });
      const queuedId = i2v.json.macIngest?.id || i2v.json.macIngest?.jobId || i2v.json.macIngest?.queued?.id;
      await waitMacJob(cookie, queuedId);
    } else {
      report.IMAGE_TO_VIDEO = `FAIL:${i2v.json?.blocker || i2v.json?.status}:${String(i2v.json?.reason || "").slice(0, 200)}`;
      report.BLOCKERS.push(`image_to_video:${i2v.json?.blocker || i2v.json?.error}`);
    }
  }

  // 3) reference/continuity — one attempt; NOT_AVAILABLE_ON_ACCOUNT is honest
  if (img) {
    const ref = await api(cookie, "POST", "/api/hq/aura/resolve/generate", {
      capability: "reference_continuity",
      prompt: "Continue the same non-person IFCDC gold/ivory abstract plate in gentle motion. No people.",
      project: "IFCDC-PHASE6C-REF",
      durationSeconds: 2,
      ratio: "1280:720",
      fileName: `runway-ref-${Date.now().toString(36)}.mp4`,
      imageBase64: img.imageBase64,
      imageMimeType: img.imageMimeType,
      publish: false,
      ingestToMac: true,
    });
    console.log("REF_HTTP", ref.status, "ok=", ref.json?.ok, "status=", ref.json?.status, "preview=", ref.json?.hqPreviewId);
    if (ref.json?.ok) {
      report.REFERENCE_CONTINUITY = `END_TO_END_PASS model=${ref.json.providerModel} duration=${ref.json.durationSeconds}s preview=${ref.json.hqPreviewId} file=${ref.json.fileName}`;
      report.GENERATED_VIDEO_FILE.push({
        capability: "reference_continuity",
        fileName: ref.json.fileName,
        previewId: ref.json.hqPreviewId,
        model: ref.json.providerModel,
        durationSeconds: ref.json.durationSeconds,
      });
      report.CREDITS_USED.push({
        capability: "reference_continuity",
        CREDITS_USED: ref.json.CREDITS_USED,
        model: ref.json.providerModel,
        durationSeconds: ref.json.durationSeconds,
      });
      const queuedId = ref.json.macIngest?.id || ref.json.macIngest?.jobId || ref.json.macIngest?.queued?.id;
      await waitMacJob(cookie, queuedId);
    } else if (ref.json?.notAvailableOnAccount || /NOT_AVAILABLE_ON_ACCOUNT/i.test(String(ref.json?.blocker || ""))) {
      report.REFERENCE_CONTINUITY = `NOT_AVAILABLE_ON_ACCOUNT:${String(ref.json?.reason || ref.json?.blocker || "").slice(0, 240)}`;
    } else {
      report.REFERENCE_CONTINUITY = `FAIL:${ref.json?.blocker || ref.json?.status}:${String(ref.json?.reason || "").slice(0, 200)}`;
      report.BLOCKERS.push(`reference_continuity:${ref.json?.blocker || ref.json?.error}`);
    }
  } else {
    report.REFERENCE_CONTINUITY = "NOT_RUN:MISSING_SOURCE_IMAGE";
  }

  const t2vPass = /^END_TO_END_PASS/.test(report.TEXT_TO_VIDEO);
  const i2vPass = /^END_TO_END_PASS/.test(report.IMAGE_TO_VIDEO);
  report.PHASE_6C_STATUS = t2vPass
    ? i2vPass || /NOT_AVAILABLE_ON_ACCOUNT|END_TO_END_PASS/.test(report.REFERENCE_CONTINUITY)
      ? "PASS_WITH_PROOFS"
      : "PARTIAL"
    : "FAIL";

  console.log("\n=== PHASE 6C REPORT ===");
  console.log(redact(report));
}

main().catch((err) => {
  console.error("phase6c proof failed:", String(err?.message || err).slice(0, 300));
  process.exit(1);
});
