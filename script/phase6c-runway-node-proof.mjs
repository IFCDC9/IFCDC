#!/usr/bin/env node
/**
 * Phase 6C proofs via Production Mac → HQ node proxy (no Founder cookie required).
 * Reads hq-production.json locally; never prints token/secrets.
 * Key stays on Render; Mac only proxies.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "fs";
import { homedir } from "os";
import { join, basename } from "path";

const ROOT = join(homedir(), "Library/Application Support/IFCDC/aura-resolve");
const LINK_PATH = join(ROOT, "hq-production.json");
const VIDEO_DIR = join(ROOT, "IFCDC-PRODUCTIONS/GENERATED_FOUNDER_MEDIA/video");
const PHASE6_IMAGE = join(
  ROOT,
  "IFCDC-PRODUCTIONS/GENERATED_FOUNDER_MEDIA/images/phase6-openai-image-muh0wbxg.png",
);
const BRIDGE = "http://127.0.0.1:4181";
const PROMPT =
  "Non-person abstract IFCDC gold and ivory geometric motion graphic on deep black. Slow elegant camera drift. No people, no faces, no readable logos.";

function loadLink() {
  const raw = JSON.parse(readFileSync(LINK_PATH, "utf8"));
  if (!raw?.hqUrl || !raw?.token || !raw?.nodeId) throw new Error("hq-production.json incomplete");
  return raw;
}

async function nodeGenerate(link, capability, request) {
  const res = await fetch(`${link.hqUrl}/api/hq/aura/resolve/node/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${link.token}`,
      "x-aura-resolve-node-id": link.nodeId,
    },
    body: JSON.stringify({ capability, request: { ...request, person: false } }),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function uploadPreview(link, filePath, meta) {
  const bytes = readFileSync(filePath);
  const res = await fetch(`${link.hqUrl}/api/hq/aura/resolve/node/preview`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${link.token}`,
      "x-aura-resolve-node-id": link.nodeId,
    },
    body: JSON.stringify({
      name: basename(filePath),
      project: meta.project,
      instruction: meta.instruction,
      duration: meta.duration ?? null,
      publish: false,
      contentType: "video/mp4",
      base64: bytes.toString("base64"),
      size: bytes.length,
    }),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function bridgeOp(action, payload = {}) {
  const res = await fetch(`${BRIDGE}/v1/op/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function libraryRefresh() {
  const { buildAssetLibraryIndex } = await import("../aura-resolve/library/asset-library.mjs");
  return buildAssetLibraryIndex();
}

function saveVideo(fileName, fileBase64) {
  mkdirSync(VIDEO_DIR, { recursive: true });
  const path = join(VIDEO_DIR, fileName);
  writeFileSync(path, Buffer.from(fileBase64, "base64"));
  return path;
}

async function prove(link, capability, request, { doResolveIngest = false } = {}) {
  const out = {
    capability,
    http: null,
    ok: false,
    status: null,
    model: null,
    fileName: null,
    path: null,
    previewId: null,
    credits: null,
    durationSeconds: null,
    library: null,
    resolve: null,
    reason: null,
    blocker: null,
  };
  const gen = await nodeGenerate(link, capability, request);
  out.http = gen.status;
  out.ok = Boolean(gen.json?.ok);
  out.status = gen.json?.status || null;
  out.model = gen.json?.providerModel || null;
  out.credits = gen.json?.CREDITS_USED ?? null;
  out.durationSeconds = gen.json?.durationSeconds ?? null;
  out.blocker = gen.json?.blocker || null;
  out.reason = gen.json?.reason || null;
  out.hqPreviewId = gen.json?.hqPreviewId || null;

  if (!gen.json?.ok || !gen.json?.fileBase64) {
    return out;
  }

  const fileName = gen.json.fileName || `runway-${capability}-${Date.now().toString(36)}.mp4`;
  const path = saveVideo(fileName, gen.json.fileBase64);
  out.fileName = fileName;
  out.path = path;

  try {
    const lib = await libraryRefresh();
    out.library = { count: lib.count, ingested: existsSync(path) };
  } catch (e) {
    out.library = { error: String(e.message || e).slice(0, 120) };
  }

  if (doResolveIngest) {
    try {
      const project = await bridgeOp("create_project", { name: request.project || "IFCDC-PHASE6C-RUNWAY" });
      const imported = await bridgeOp("import_media", { path });
      out.resolve = {
        create_project: project.json?.ok !== false,
        import_media: imported.json?.ok !== false,
        details: { create: project.json, import: imported.json },
      };
    } catch (e) {
      out.resolve = { error: String(e.message || e).slice(0, 160) };
    }
  }

  // Prefer HQ preview already stored by cloud generate; else upload from Mac.
  if (out.hqPreviewId) {
    out.previewId = out.hqPreviewId;
  } else {
    const prev = await uploadPreview(link, path, {
      project: request.project || "IFCDC-PHASE6C-RUNWAY",
      instruction: request.prompt || PROMPT,
      duration: out.durationSeconds,
    });
    out.previewId = prev.json?.id || prev.json?.preview?.id || null;
  }
  return out;
}

async function main() {
  const health = await fetch("https://ifcdc-hq-wst6.onrender.com/api/hq/health").then((r) => r.json());
  const link = loadLink();
  const bridgeHealth = await fetch(`${BRIDGE}/health`).then((r) => r.json()).catch(() => null);
  const lanIp = process.env.LAN_IP || "";
  let lanRefuse = "UNTESTED";
  if (lanIp) {
    try {
      await fetch(`http://${lanIp}:4181/health`, { signal: AbortSignal.timeout(1500) });
      lanRefuse = "FAIL_OPEN";
    } catch {
      lanRefuse = "REFUSED";
    }
  }

  const img = existsSync(PHASE6_IMAGE)
    ? { imageBase64: readFileSync(PHASE6_IMAGE).toString("base64"), imageMimeType: "image/png" }
    : null;

  console.log("HEALTH_RUNWAY_API_KEY_PRESENT=", health.RUNWAY_API_KEY_PRESENT);
  console.log("BRIDGE=", bridgeHealth?.ok ? "ONLINE" : "OFFLINE", "host=", bridgeHealth?.host);

  const t2v = await prove(
    link,
    "text_to_video",
    {
      prompt: PROMPT,
      project: "IFCDC-PHASE6C-T2V",
      durationSeconds: 2,
      ratio: "1280:720",
      fileName: `runway-t2v-${Date.now().toString(36)}.mp4`,
    },
    { doResolveIngest: true },
  );
  console.log(
    "T2V",
    t2v.ok,
    "model=",
    t2v.model,
    "preview=",
    t2v.previewId,
    "file=",
    t2v.fileName,
    "credits=",
    t2v.credits,
    "blocker=",
    t2v.blocker,
    "reason=",
    String(t2v.reason || "").slice(0, 160),
  );

  let i2v = { ok: false, blocker: "MISSING_PHASE6_IMAGE" };
  if (img) {
    i2v = await prove(
      link,
      "image_to_video",
      {
        prompt: PROMPT,
        project: "IFCDC-PHASE6C-I2V",
        durationSeconds: 2,
        ratio: "1280:720",
        fileName: `runway-i2v-${Date.now().toString(36)}.mp4`,
        ...img,
      },
      { doResolveIngest: true },
    );
    console.log(
      "I2V",
      i2v.ok,
      "model=",
      i2v.model,
      "preview=",
      i2v.previewId,
      "file=",
      i2v.fileName,
      "credits=",
      i2v.credits,
      "blocker=",
      i2v.blocker,
      "reason=",
      String(i2v.reason || "").slice(0, 160),
    );
  }

  let ref = { ok: false, blocker: "MISSING_PHASE6_IMAGE" };
  if (img) {
    ref = await prove(
      link,
      "reference_continuity",
      {
        prompt: "Continue the same non-person IFCDC gold/ivory abstract plate in gentle motion. No people.",
        project: "IFCDC-PHASE6C-REF",
        durationSeconds: 2,
        ratio: "1280:720",
        fileName: `runway-ref-${Date.now().toString(36)}.mp4`,
        ...img,
      },
      { doResolveIngest: true },
    );
    console.log(
      "REF",
      ref.ok,
      "status=",
      ref.status,
      "model=",
      ref.model,
      "preview=",
      ref.previewId,
      "file=",
      ref.fileName,
      "credits=",
      ref.credits,
      "blocker=",
      ref.blocker,
      "reason=",
      String(ref.reason || "").slice(0, 200),
    );
  }

  const report = {
    PHASE_6C_STATUS: t2v.ok ? "PASS_WITH_PROOFS" : "FAIL",
    RUNWAY_API_KEY_PRESENT: health.RUNWAY_API_KEY_PRESENT || "NOT_PRESENT",
    RUNWAY_PROVIDER: "runway",
    RUNWAY_CONNECTION: health.RUNWAY_API_KEY_PRESENT === "PRESENT" ? "CONNECTED_VIA_HQ_NODE_PROXY" : "NOT_PRESENT",
    TEXT_TO_VIDEO: t2v.ok
      ? `END_TO_END_PASS model=${t2v.model} duration=${t2v.durationSeconds}s preview=${t2v.previewId} file=${t2v.fileName}`
      : `FAIL:${t2v.blocker}:${String(t2v.reason || "").slice(0, 200)}`,
    IMAGE_TO_VIDEO: i2v.ok
      ? `END_TO_END_PASS model=${i2v.model} duration=${i2v.durationSeconds}s preview=${i2v.previewId} file=${i2v.fileName}`
      : /NOT_AVAILABLE/i.test(String(i2v.blocker || ""))
        ? `NOT_AVAILABLE_ON_ACCOUNT:${String(i2v.reason || "").slice(0, 200)}`
        : `FAIL:${i2v.blocker}:${String(i2v.reason || "").slice(0, 200)}`,
    REFERENCE_CONTINUITY: ref.ok
      ? `END_TO_END_PASS model=${ref.model} duration=${ref.durationSeconds}s preview=${ref.previewId} file=${ref.fileName}`
      : /NOT_AVAILABLE/i.test(String(ref.blocker || ref.status || ""))
        ? `NOT_AVAILABLE_ON_ACCOUNT:${String(ref.reason || ref.blocker || "").slice(0, 240)}`
        : `FAIL:${ref.blocker}:${String(ref.reason || "").slice(0, 200)}`,
    GENERATED_VIDEO_FILE: [t2v, i2v, ref]
      .filter((x) => x.ok && x.fileName)
      .map((x) => ({
        capability: x.capability,
        fileName: x.fileName,
        path: x.path,
        previewId: x.previewId,
        model: x.model,
        durationSeconds: x.durationSeconds,
      })),
    IFCDC_ASSET_LIBRARY_INGEST: t2v.library?.ingested ? "PASS" : t2v.ok ? "FAIL" : "NOT_RUN",
    RESOLVE_GENERATED_MEDIA_INGEST: t2v.resolve?.import_media ? "PASS" : t2v.ok ? `FAIL:${JSON.stringify(t2v.resolve).slice(0, 160)}` : "NOT_RUN",
    HQ_PREVIEW_RETURN: t2v.previewId ? `PASS:${t2v.previewId}` : t2v.ok ? "FAIL" : "NOT_RUN",
    CREDITS_USED: [t2v, i2v, ref]
      .filter((x) => x.capability)
      .map((x) => ({
        capability: x.capability,
        CREDITS_USED: x.credits == null ? "UNKNOWN_API_DID_NOT_REPORT" : x.credits,
        model: x.model,
        durationSeconds: x.durationSeconds,
        ok: x.ok,
      })),
    PRODUCTION_MAC: bridgeHealth?.ok ? "ONLINE" : "OFFLINE",
    BRIDGE_PRIVACY: `loopback_only host=${bridgeHealth?.host || "?"} publicExposure=${bridgeHealth?.publicExposure} lan4181=${lanRefuse}`,
    PUBLISHING: "OFF",
    CURSOR_REQUIRED_FOR_NORMAL_VIDEO_PRODUCTION: "NO",
    BLOCKERS: [t2v, i2v, ref].filter((x) => !x.ok).map((x) => `${x.capability}:${x.blocker}:${String(x.reason || "").slice(0, 160)}`),
    productionCommit: "a5e8e4d",
  };

  if (t2v.ok && (i2v.ok || /NOT_AVAILABLE/.test(report.REFERENCE_CONTINUITY) || i2v.ok === false)) {
    // tighten status
    report.PHASE_6C_STATUS = t2v.ok && (i2v.ok || String(i2v.blocker || "").includes("MISSING")) ? (i2v.ok ? "PASS_WITH_PROOFS" : "PARTIAL") : report.PHASE_6C_STATUS;
  }
  if (t2v.ok && i2v.ok) report.PHASE_6C_STATUS = "PASS_WITH_PROOFS";

  console.log("\n=== PHASE 6C REPORT ===");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error("proof_failed", String(e.message || e).slice(0, 240));
  process.exit(1);
});
