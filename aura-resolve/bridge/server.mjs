/**
 * Local AURA–Resolve bridge. Binds 127.0.0.1 only.
 * Does not touch Ableton, Serato, or Music Intelligence.
 */
import { createServer } from "http";
import { spawnSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync, copyFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { connect } from "net";
import { randomBytes } from "crypto";
import { fileURLToPath } from "url";
import { EDITOR_COMMANDS, planInstruction, toResolveCall } from "../editor/commands.mjs";
import { clonePlan } from "../clone/pipeline.mjs";
import { runCreativeProduction, runMultiFormatMastering, readRenderBytes } from "../editor/produce.mjs";
import { stageBrandKit, readBrandKit } from "../brand/kit.mjs";
import { ensureProductionKit, readProductionKit } from "../brand/production-kit.mjs";
import { readCreativeMemory, ensureCompanyMemory } from "../editor/memory.mjs";
import { directCreativeIdea } from "../editor/director.mjs";
import { parseRevision } from "../editor/revision.mjs";
import { gatePayload } from "../editor/gates.mjs";
import { analyzeAssets } from "../editor/assets.mjs";
import { bootGenerationEngine, capabilityStatus, discoverProviders } from "../generation/engine.mjs";
import { inventoryProductionKitSlots } from "../brand/production-kit-slots.mjs";
import { founderIdentityStatus, designateFounderMedia, founderIdentityOnboardingPublic } from "../library/founder-identity.mjs";
import { readAssetLibraryPublic } from "../library/asset-library.mjs";
import { setOpenAiMediaHqLink } from "../generation/adapters/openai-media.mjs";
import { setRunwayMediaHqLink } from "../generation/adapters/runway-media.mjs";

const HOST = "127.0.0.1";
const PORT = Number(process.env.AURA_RESOLVE_BRIDGE_PORT || 4181);
const RESOLVE_PORT = 4182;
const ROOT = join(homedir(), "Library/Application Support/IFCDC/aura-resolve");
const TOKEN_PATH = join(ROOT, "bridge.token");
const STATUS_PATH = join(ROOT, "status.json");
const AUDIT_PATH = join(ROOT, "audit.jsonl");
const APP = "/Applications/DaVinci Resolve/DaVinci Resolve.app";
const SCRIPT_SRC = fileURLToPath(new URL("../resolve/ifcdc_aura_bridge.py", import.meta.url));
const SCRIPT_DEST = join(
  homedir(),
  "Library/Application Support/Blackmagic Design/DaVinci Resolve/Fusion/Scripts/Utility/IFCDC AURA Bridge.py",
);

mkdirSync(ROOT, { recursive: true });
if (!existsSync(TOKEN_PATH)) writeFileSync(TOKEN_PATH, randomBytes(24).toString("hex"));

function token() {
  return readFileSync(TOKEN_PATH, "utf8").trim();
}

function audit(action, ok, detail) {
  appendFileSync(AUDIT_PATH, JSON.stringify({ at: new Date().toISOString(), action, ok, detail }) + "\n");
}

function resolveVersion() {
  const info = join(APP, "Contents/Info.plist");
  if (!existsSync(info)) return { installed: false };
  const short = spawnSync("defaults", ["read", info, "CFBundleShortVersionString"], { encoding: "utf8" });
  const build = spawnSync("defaults", ["read", info, "CFBundleVersion"], { encoding: "utf8" });
  return {
    installed: true,
    path: APP,
    version: (short.stdout || "").trim(),
    build: (build.stdout || "").trim(),
  };
}

function resolveRunning() {
  const probe = spawnSync("pgrep", ["-x", "Resolve"], { encoding: "utf8" });
  return probe.status === 0;
}

function askResolve(action, payload, timeoutMs = 20000) {
  const message = JSON.stringify({ token: token(), action, payload: payload || {} }) + "\n";
  return new Promise((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port: RESOLVE_PORT });
    let raw = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("Resolve bridge timed out"));
    }, timeoutMs);
    socket.on("data", (chunk) => {
      raw += chunk.toString();
      if (raw.includes("\n")) {
        clearTimeout(timer);
        socket.end();
        try {
          resolve(JSON.parse(raw));
        } catch (error) {
          reject(error);
        }
      }
    });
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.write(message);
  });
}

function installScript() {
  mkdirSync(join(SCRIPT_DEST, ".."), { recursive: true });
  writeFileSync(SCRIPT_DEST, readFileSync(SCRIPT_SRC));
}

async function health() {
  const installed = resolveVersion();
  let inside = null;
  try {
    inside = JSON.parse(readFileSync(STATUS_PATH, "utf8"));
  } catch {
    inside = null;
  }
  let api = null;
  let apiError = null;
  try {
    api = await askResolve("status", {});
  } catch (error) {
    apiError = error.message;
  }
  return {
    ok: true,
    service: "aura-resolve-bridge",
    host: HOST,
    port: PORT,
    publicExposure: false,
    resolve: installed,
    resolveRunning: resolveRunning(),
    inside,
    api,
    apiError,
    scripting: {
      externalFusionscript: "REFUSED",
      mode: "in-app Utility script, localhost 4182",
      note: "System.Scripting.Mode is Local. scriptapp() still returns nothing on this install, so the official API is hosted inside Resolve.",
    },
  };
}

const ALLOWED = new Set([
  "status",
  "create_project",
  "import_media",
  "create_bin",
  "create_timeline",
  "add_clip",
  "trim_clip",
  "split_clip",
  "move_clip",
  "remove_clip",
  "duplicate_clip",
  "set_clip_duration",
  "reorder_clips",
  "add_transition",
  "add_title",
  "add_logo",
  "add_music",
  "add_voiceover",
  "adjust_audio_levels",
  "fade_audio",
  "fade_video",
  "add_subtitles",
  "apply_branding",
  "basic_cleanup",
  "save_project",
  "render",
  "render_status",
]);

installScript();

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${HOST}`);
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  try {
    if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/v1/status")) {
      const body = await health();
      res.writeHead(200);
      res.end(JSON.stringify(body, null, 2));
      return;
    }
    if (req.method === "GET" && url.pathname === "/v1/page") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      const body = await health();
      const api = body.api?.result || {};
      res.writeHead(200);
      res.end(`<!doctype html><meta charset="utf-8"><title>AURA Resolve</title>
        <body style="font-family:system-ui;background:#111;color:#f5f0e6;padding:2rem">
        <h1>AURA Resolve Bridge</h1>
        <p>Resolve ${body.resolveRunning ? "ONLINE" : "OFFLINE"} · ${body.resolve.version || "not installed"}</p>
        <p>Bridge ${body.api?.ok ? "ONLINE" : "OFFLINE"} · project ${api.project || "none"} · timeline ${api.timeline || "none"}</p>
        <pre>${JSON.stringify(body, null, 2)}</pre></body>`);
      return;
    }
    if (req.method === "POST" && url.pathname === "/v1/editor/plan") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString() || "{}") : {};
      const plan = planInstruction(body.instruction || "");
      const clone = /clone|barber|loctician|nail/.test(String(body.instruction || "").toLowerCase())
        ? clonePlan(body.instruction)
        : null;
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, publish: false, commands: EDITOR_COMMANDS, plan, clone }, null, 2));
      return;
    }
    if (req.method === "POST" && url.pathname === "/v1/editor/run") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString() || "{}") : {};
      if (body.publish === true) {
        res.writeHead(403);
        res.end(JSON.stringify({ ok: false, error: "publishing requires Founder approval and is not available" }));
        return;
      }
      if (body.founderApproved !== true) {
        res.writeHead(403);
        res.end(JSON.stringify({ ok: false, error: "Founder approval is required before a plan runs" }));
        return;
      }
      const plan = body.plan || planInstruction(body.instruction || "");
      const results = [];
      for (const step of plan.steps || []) {
        for (const call of toResolveCall(step)) {
          if (!ALLOWED.has(call.action)) {
            results.push({ action: call.action, ok: false, error: "operation is not allowlisted" });
            continue;
          }
          results.push({ action: call.action, ...(await askResolve(call.action, call.payload)) });
        }
      }
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, publish: false, results }, null, 2));
      return;
    }
    if (req.method === "POST" && url.pathname.startsWith("/v1/op/")) {
      const action = url.pathname.slice("/v1/op/".length);
      if (!ALLOWED.has(action)) {
        audit(action, false, "blocked");
        res.writeHead(403);
        res.end(JSON.stringify({ ok: false, error: "operation is not allowlisted" }));
        return;
      }
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const payload = chunks.length ? JSON.parse(Buffer.concat(chunks).toString() || "{}") : {};
      const result = await askResolve(action, payload);
      audit(action, result.ok !== false, result.error || "ok");
      res.writeHead(result.ok ? 200 : 400);
      res.end(JSON.stringify(result, null, 2));
      return;
    }
    res.writeHead(404);
    res.end(JSON.stringify({ ok: false, error: "not found" }));
  } catch (error) {
    res.writeHead(500);
    res.end(JSON.stringify({ ok: false, error: error.message }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`AURA Resolve bridge http://${HOST}:${PORT}`);
});

const HQ_FILE = join(ROOT, "hq-production.json");
const AGENT_STATE_PATH = join(ROOT, "agent-state.json");
const PRODUCTION_HQ = process.env.AURA_RESOLVE_HQ_URL || "https://ifcdc-hq-wst6.onrender.com";
/** Keep well inside HQ's 45s Production Mac TTL. */
const HEARTBEAT_INTERVAL_MS = Number(process.env.AURA_RESOLVE_HEARTBEAT_MS || 8000);
const MAX_BACKOFF_MS = Number(process.env.AURA_RESOLVE_MAX_BACKOFF_MS || 20000);
const HQ_FETCH_TIMEOUT_MS = Number(process.env.AURA_RESOLVE_HQ_TIMEOUT_MS || 8000);
const HQ_PREVIEW_TIMEOUT_MS = Number(process.env.AURA_RESOLVE_PREVIEW_TIMEOUT_MS || 120000);
const ACTION_FOR = {
  create_project: "create_project",
  open_project: "create_project",
  import_media: "import_media",
  import_assets: "import_media",
  create_bin: "create_bin",
  create_timeline: "create_timeline",
  add_clip: "add_clip",
  trim_clip: "trim_clip",
  split_clip: "split_clip",
  move_clip: "move_clip",
  remove_clip: "remove_clip",
  duplicate_clip: "duplicate_clip",
  set_clip_duration: "set_clip_duration",
  reorder_clips: "reorder_clips",
  add_title: "add_title",
  add_logo: "add_logo",
  add_music: "add_music",
  add_voiceover: "add_voiceover",
  add_transition: "add_transition",
  fade_audio: "fade_audio",
  fade_video: "fade_video",
  fade_music: "fade_audio",
  duck_music: "adjust_audio_levels",
  adjust_audio_levels: "adjust_audio_levels",
  add_subtitles: "add_subtitles",
  add_captions: "add_subtitles",
  apply_branding: "apply_branding",
  basic_cleanup: "basic_cleanup",
  save_project: "save_project",
  preview_project: "status",
  queue_render: "render",
  render_vertical: "render",
  render_landscape: "render",
  render_square: "render",
  resolve_status: "status",
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeAgentState(patch) {
  let prior = {};
  try {
    prior = JSON.parse(readFileSync(AGENT_STATE_PATH, "utf8"));
  } catch {
    prior = {};
  }
  writeFileSync(
    AGENT_STATE_PATH,
    JSON.stringify({ ...prior, ...patch, updatedAt: new Date().toISOString() }, null, 2),
  );
}

function readStoredLink() {
  if (!existsSync(HQ_FILE)) return null;
  try {
    const link = JSON.parse(readFileSync(HQ_FILE, "utf8"));
    const hqUrl = String(link.hqUrl || PRODUCTION_HQ).replace(/\/$/, "");
    if (hqUrl !== PRODUCTION_HQ) {
      console.warn(`[aura-resolve] refusing non-production hqUrl; forcing ${PRODUCTION_HQ}`);
    }
    if (!link.nodeId || !link.token) return null;
    return { hqUrl: PRODUCTION_HQ, nodeId: String(link.nodeId), token: String(link.token) };
  } catch {
    return null;
  }
}

function persistLink(link) {
  const next = { hqUrl: PRODUCTION_HQ, nodeId: link.nodeId, token: link.token };
  writeFileSync(HQ_FILE, JSON.stringify(next, null, 2));
  return next;
}

async function hqFetch(url, init = {}, timeoutMs = HQ_FETCH_TIMEOUT_MS) {
  return fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

/**
 * Claim/reconnect with stored credentials. Never storms: caller backs off.
 * Existing hq-production.json token is preferred; only mint credentials when none exist
 * and forceClaim is true.
 */
async function ensureHqLink({ forceClaim = false } = {}) {
  const stored = readStoredLink();
  if (stored && !forceClaim) return stored;
  if (!stored && !forceClaim) return null;

  const hqUrl = PRODUCTION_HQ;
  const nodeId = stored?.nodeId || `arn_${randomBytes(8).toString("hex")}`;
  const token = stored?.token || `arnt_${randomBytes(24).toString("base64url")}`;
  try {
    const response = await hqFetch(`${hqUrl}/api/hq/aura/resolve/node/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nodeId,
        token,
        label: "Founder Mac Resolve Node",
        hostname: "production-mac",
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok || response.status === 201) {
      return persistLink({ nodeId: body.nodeId || nodeId, token });
    }
    // Another node already owns the slot — keep stored token and retry heartbeat later.
    if (response.status === 403 && /already enrolled/i.test(String(body.error || ""))) {
      if (stored) return stored;
      console.warn("[aura-resolve] claim blocked: a Resolve node is already enrolled");
      writeAgentState({ ok: false, lastError: "claim_already_enrolled" });
      return null;
    }
    console.warn(`[aura-resolve] claim failed: ${response.status}`);
    writeAgentState({ ok: false, lastError: `claim_${response.status}` });
    return stored;
  } catch (error) {
    console.warn(`[aura-resolve] claim error: ${error.message}`);
    writeAgentState({ ok: false, lastError: error.message });
    return stored;
  }
}

async function completeCommand(link, id, result) {
  await hqFetch(`${link.hqUrl}/api/hq/aura/resolve/node/complete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${link.token}`,
      "x-aura-resolve-node-id": link.nodeId,
    },
    body: JSON.stringify({ id, result }),
  });
}

async function uploadPreviewToHq(link, meta) {
  const file = readRenderBytes(meta.path || meta.name);
  if (!file) return { ok: false, error: "render file missing" };
  const response = await hqFetch(
    `${link.hqUrl}/api/hq/aura/resolve/node/preview`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${link.token}`,
        "x-aura-resolve-node-id": link.nodeId,
      },
      body: JSON.stringify({
        name: file.name,
        project: meta.project || null,
        instruction: meta.instruction || null,
        duration: file.duration ?? meta.duration ?? null,
        publish: false,
        contentType: "video/mp4",
        base64: file.bytes.toString("base64"),
        size: file.size,
      }),
    },
    HQ_PREVIEW_TIMEOUT_MS,
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) return { ok: false, error: body.error || `preview_upload_${response.status}` };
  return { ok: true, ...body, name: file.name, duration: file.duration };
}

let commandWorker = Promise.resolve();

async function runQueuedCommand(link, command) {
  if (command.command === "editor_plan") {
    const instruction = command.args?.instruction || "";
    ensureCompanyMemory();
    const director = directCreativeIdea(instruction, { projectName: command.args?.projectName });
    const planned = planInstruction(instruction, { projectName: director.project });
    const clone = clonePlan(instruction);
    const brand = stageBrandKit({ intoMedia: true });
    const productionKit = ensureProductionKit({ force: false });
    const assets = analyzeAssets();
    await completeCommand(link, command.id, {
      ok: true,
      publish: false,
      company: "IFCDC PRODUCTIONS",
      productionCompany: director.productionCompany || "IFCDC PRODUCTIONS",
      productionIdentity: director.productionIdentity || "IFCDC PRODUCTION",
      brandPromoted: director.brandPromoted || planned.brandPromoted || null,
      projectTitle: director.projectTitle || planned.projectTitle || null,
      plan: { ...planned, ...director, steps: planned.steps },
      director,
      clone,
      brandKit: brand,
      productionKit: {
        company: productionKit.company,
        itemCount: (productionKit.items || []).length,
        fonts: productionKit.fonts,
      },
      assetIntelligence: assets,
      gate: gatePayload("PLAN"),
      commands: EDITOR_COMMANDS,
      memory: readCreativeMemory(),
    });
    writeFileSync(join(ROOT, "last-command.json"), JSON.stringify({ command: "editor_plan", at: new Date().toISOString() }));
    return;
  }
  if (command.command === "master_formats") {
    if (command.args?.publish === true) {
      await completeCommand(link, command.id, { ok: false, error: "publishing requires Founder approval and is not available", publish: false });
      return;
    }
    try {
      const mastered = await runMultiFormatMastering({
        sourceProject: command.args?.sourceProject || "IFCDC-AURA-BARBERS-PROMO-V1",
        sourcePath: command.args?.sourcePath || null,
        projectName: command.args?.projectName || "IFCDC-AURA-BARBERS-PROMO-P4",
        uploadPreview: (meta) => uploadPreviewToHq(link, meta),
      });
      writeFileSync(
        join(ROOT, "last-command.json"),
        JSON.stringify({ command: "master_formats", at: new Date().toISOString(), masters: mastered.masters?.map((m) => m.format) }),
      );
      await completeCommand(link, command.id, mastered);
    } catch (error) {
      await completeCommand(link, command.id, { ok: false, error: error.message, publish: false });
    }
    return;
  }
  if (command.command === "editor_run" || command.command === "request_revision") {
    if (command.args?.publish === true) {
      await completeCommand(link, command.id, { ok: false, error: "publishing requires Founder approval and is not available", publish: false });
      return;
    }
    try {
      setOpenAiMediaHqLink(link);
      setRunwayMediaHqLink(link);
      bootGenerationEngine({ hqLink: link });
      const revisionNote =
        command.command === "request_revision"
          ? command.args?.revisionNote || command.args?.note || "Founder revision"
          : null;
      if (revisionNote) {
        parseRevision(revisionNote, { instruction: command.args?.instruction || "" });
      }
      const produced = await runCreativeProduction({
        instruction: command.args?.instruction || "",
        revisionNote,
        projectName: command.args?.projectName || null,
        masterFormatsAfter: command.args?.masterFormatsAfter === true,
        askResolve: (action, payload) => askResolve(action, payload, action === "render" ? 60000 : 45000),
        uploadPreview: (meta) => uploadPreviewToHq(link, meta),
      });
      writeFileSync(
        join(ROOT, "last-command.json"),
        JSON.stringify({
          command: command.command,
          at: new Date().toISOString(),
          project: produced.plan?.project || produced.masters?.[0]?.name,
        }),
      );
      await completeCommand(link, command.id, produced);
    } catch (error) {
      await completeCommand(link, command.id, { ok: false, error: error.message, publish: false });
    }
    return;
  }
  if (command.command === "designate_founder_media") {
    try {
      const bytes = command.args?.base64 ? Buffer.from(String(command.args.base64), "base64") : null;
      const result = designateFounderMedia({
        slotId: command.args?.slotId,
        bytes,
        sourcePath: command.args?.sourcePath || null,
        originalName: command.args?.originalName || null,
        mimeType: command.args?.mimeType || null,
      });
      await completeCommand(link, command.id, result);
    } catch (error) {
      await completeCommand(link, command.id, { ok: false, error: error.message, publish: false });
    }
    return;
  }
  if (command.command === "provider_discovery") {
    try {
      setOpenAiMediaHqLink(link);
      setRunwayMediaHqLink(link);
      bootGenerationEngine({ hqLink: link });
      const discovery = await discoverProviders();
      await completeCommand(link, command.id, { ok: true, discovery, phase: "6C" });
    } catch (error) {
      await completeCommand(link, command.id, { ok: false, error: error.message, publish: false });
    }
    return;
  }
  if (command.command === "ingest_generated_media") {
    if (command.args?.publish === true) {
      await completeCommand(link, command.id, {
        ok: false,
        error: "publishing requires Founder approval and is not available",
        publish: false,
      });
      return;
    }
    try {
      const { buildAssetLibraryIndex } = await import("../library/asset-library.mjs");
      const { PRODUCTIONS_ROOT } = await import("../brand/production-identity.mjs");
      const videoDir = join(PRODUCTIONS_ROOT, "GENERATED_FOUNDER_MEDIA", "video");
      mkdirSync(videoDir, { recursive: true });
      const fileName = String(command.args?.fileName || `runway-ingest-${Date.now().toString(36)}.mp4`).replace(
        /[^a-zA-Z0-9._-]/g,
        "_",
      );
      const dest = join(videoDir, fileName);
      if (command.args?.base64) {
        writeFileSync(dest, Buffer.from(String(command.args.base64), "base64"));
      } else if (command.args?.sourcePath && existsSync(String(command.args.sourcePath))) {
        copyFileSync(String(command.args.sourcePath), dest);
      } else {
        await completeCommand(link, command.id, {
          ok: false,
          error: "base64 or sourcePath required",
          publish: false,
        });
        return;
      }
      const library = buildAssetLibraryIndex();
      let resolveImport = null;
      try {
        const created = await askResolve("create_project", {
          name: String(command.args?.project || "IFCDC-PHASE6C-RUNWAY"),
        });
        resolveImport = {
          create_project: created,
          import_media: await askResolve("import_media", { path: dest }),
        };
      } catch (error) {
        resolveImport = { ok: false, error: error.message };
      }
      let preview = null;
      if (command.args?.uploadPreview !== false) {
        preview = await uploadPreviewToHq(link, {
          path: dest,
          name: fileName,
          project: command.args?.project || "IFCDC-PHASE6C-RUNWAY",
          instruction: command.args?.instruction || "Phase 6C Runway ingest",
          duration: command.args?.durationSeconds ?? null,
        });
      }
      await completeCommand(link, command.id, {
        ok: true,
        publish: false,
        phase: "6C",
        path: dest,
        fileName,
        libraryCount: library?.count ?? library?.items?.length ?? null,
        resolveImport,
        preview,
        IFCDC_ASSET_LIBRARY_INGEST: "PASS",
        RESOLVE_GENERATED_MEDIA_INGEST: resolveImport?.import_media?.ok === false ? "FAIL" : "PASS",
      });
    } catch (error) {
      await completeCommand(link, command.id, { ok: false, error: error.message, publish: false });
    }
    return;
  }
  const action = ACTION_FOR[command.command];
  let result;
  if (!action) result = { ok: false, error: "command is not allowlisted" };
  else {
    const payload = { ...(command.args || {}), publish: false };
    if (command.command === "render_vertical") Object.assign(payload, { width: 1080, height: 1920 });
    if (command.command === "render_landscape") Object.assign(payload, { width: 1920, height: 1080 });
    if (command.command === "render_square") Object.assign(payload, { width: 1080, height: 1080 });
    try {
      result = await askResolve(action, payload, action === "render" ? 60000 : 20000);
    } catch (error) {
      result = { ok: false, error: error.message };
    }
  }
  if (result?.ok) {
    writeFileSync(
      join(ROOT, "last-command.json"),
      JSON.stringify({ command: command.command, at: new Date().toISOString() }),
    );
  }
  await completeCommand(link, command.id, result);
}

function enqueueCommand(link, command) {
  // Keep heartbeat responsive during long creative runs (TTL 45s).
  commandWorker = commandWorker
    .then(async () => {
      try {
        await runQueuedCommand(link, command);
      } catch (error) {
        console.error(`[aura-resolve] command ${command.id} failed:`, error.message);
        try {
          await completeCommand(link, command.id, { ok: false, error: error.message, publish: false });
        } catch {
          /* ignore */
        }
      }
    })
    .catch((error) => {
      console.error(`[aura-resolve] command worker:`, error.message);
    });
}

async function heartbeatOnce(link) {
  const snap = await health();
  const result = snap.api?.result || {};
  const rendersDir = join(ROOT, "renders");
  const mediaDir = join(ROOT, "media");
  const completedRenders = existsSync(rendersDir)
    ? readdirSync(rendersDir).filter((name) => name.endsWith(".mp4")).map((name) => ({ name }))
    : [];
  const assets = existsSync(mediaDir) ? readdirSync(mediaDir).map((name) => ({ name })) : [];
  let lastSuccessfulCommand = null;
  try {
    lastSuccessfulCommand = JSON.parse(readFileSync(join(ROOT, "last-command.json"), "utf8"));
  } catch {
    lastSuccessfulCommand = null;
  }
  const response = await hqFetch(`${link.hqUrl}/api/hq/aura/resolve/node/heartbeat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${link.token}`,
      "x-aura-resolve-node-id": link.nodeId,
    },
    body: JSON.stringify({
      bridge: snap.api?.ok ? "ONLINE" : "OFFLINE",
      resolveRunning: snap.resolveRunning,
      resolveVersion: result.version || snap.resolve?.version,
      project: result.project,
      timeline: result.timeline,
      resolve: result,
      completedRenders,
      assets,
      renderStatus: "idle",
      renderPercent: null,
      errors: snap.apiError ? [snap.apiError] : [],
      notes: [
        "Publishing stays off until Founder approval.",
        "Draft creative runs are available from HQ. Final/publish stays gated.",
        "IFCDC PRODUCTIONS identity applies to every new project automatically.",
        "Phase 6: provider router + Founder identity onboarding; generate only when configured; never invent media.",
      ],
      lastSuccessfulCommand,
      brandKit: (() => {
        try {
          const kit = readBrandKit();
          const prod = readProductionKit();
          const slots = inventoryProductionKitSlots({ forceCompose: false });
          return {
            assetCount: (kit.staged || kit.assets || []).filter((item) => item.available !== false).length,
            gaps: kit.gaps || [],
            productionKitItems: (prod.items || []).length,
            company: prod.company || "IFCDC PRODUCTIONS",
            productionKitSlots: slots,
          };
        } catch {
          return null;
        }
      })(),
      generation: (() => {
        try {
          setOpenAiMediaHqLink(link);
          setRunwayMediaHqLink(link);
          bootGenerationEngine({ hqLink: link });
          return { capabilities: capabilityStatus(), phase: "6C" };
        } catch {
          return null;
        }
      })(),
      founderIdentity: (() => {
        try {
          return founderIdentityOnboardingPublic();
        } catch {
          return null;
        }
      })(),
      assetLibrary: (() => {
        try {
          const lib = readAssetLibraryPublic();
          return { count: lib.count, categories: lib.categories };
        } catch {
          return null;
        }
      })(),
      productionKitSlots: (() => {
        try {
          return inventoryProductionKitSlots({ forceCompose: false });
        } catch {
          return null;
        }
      })(),
      clonePrep: (() => {
        try {
          return founderIdentityStatus();
        } catch {
          return null;
        }
      })(),
      creativeMemory: (() => {
        try {
          const memory = readCreativeMemory();
          return {
            company: memory.company,
            productionCompany: memory.productionCompany || memory.company,
            productionIdentity: memory.productionIdentity || "IFCDC PRODUCTION",
            permanentRules: (memory.permanentRules || []).map((r) => r.id),
            productions: (memory.productions || []).length,
            revisions: (memory.revisions || []).length,
            masters: (memory.masters || []).length,
            preferences: memory.preferences || {},
            preferencesHistoryCount: (memory.preferencesHistory || []).length,
            currentGate: memory.currentGate || null,
          };
        } catch {
          return null;
        }
      })(),
    }),
  });
  if (response.status === 401) {
    const err = new Error("resolve_node_token_rejected");
    err.code = 401;
    throw err;
  }
  if (!response.ok) {
    const err = new Error(`heartbeat_${response.status}`);
    err.code = response.status;
    throw err;
  }
  const body = await response.json();
  for (const command of body.commands || []) {
    enqueueCommand(link, command);
  }
  writeAgentState({
    ok: true,
    lastHeartbeatAt: new Date().toISOString(),
    lastError: null,
    hqUrl: link.hqUrl,
    nodeId: link.nodeId,
    heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
  });
}

async function productionHeartbeatLoop() {
  let backoff = HEARTBEAT_INTERVAL_MS;
  let claimCooldownUntil = 0;
  console.log(
    `[aura-resolve] production heartbeat loop start interval=${HEARTBEAT_INTERVAL_MS}ms maxBackoff=${MAX_BACKOFF_MS}ms ttlTarget=45000ms`,
  );
  for (;;) {
    try {
      let link = await ensureHqLink({ forceClaim: false });
      if (!link?.token && Date.now() >= claimCooldownUntil) {
        link = await ensureHqLink({ forceClaim: true });
        claimCooldownUntil = Date.now() + Math.min(backoff, MAX_BACKOFF_MS);
      }
      if (!link?.token) {
        await sleep(Math.min(backoff, MAX_BACKOFF_MS));
        backoff = Math.min(Math.floor(backoff * 1.8), MAX_BACKOFF_MS);
        continue;
      }
      await heartbeatOnce(link);
      backoff = HEARTBEAT_INTERVAL_MS;
      await sleep(HEARTBEAT_INTERVAL_MS);
    } catch (error) {
      console.error(`[aura-resolve] heartbeat: ${error.message}`);
      writeAgentState({ ok: false, lastError: error.message });
      if (error.code === 401 && Date.now() >= claimCooldownUntil) {
        // Re-claim with the same stored credentials once per cooldown — do not mint a new node.
        await ensureHqLink({ forceClaim: true });
        claimCooldownUntil = Date.now() + Math.min(backoff * 2, MAX_BACKOFF_MS);
      }
      await sleep(Math.min(backoff, MAX_BACKOFF_MS));
      backoff = Math.min(Math.floor(backoff * 1.8), MAX_BACKOFF_MS);
    }
  }
}

productionHeartbeatLoop().catch((error) => {
  console.error("[aura-resolve] heartbeat loop crashed", error.message);
  process.exit(1);
});
