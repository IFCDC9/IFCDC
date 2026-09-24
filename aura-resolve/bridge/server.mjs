/**
 * Local AURA–Resolve bridge. Binds 127.0.0.1 only.
 * Does not touch Ableton, Serato, or Music Intelligence.
 */
import { createServer } from "http";
import { spawnSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { connect } from "net";
import { randomBytes } from "crypto";
import { fileURLToPath } from "url";
import { EDITOR_COMMANDS, planInstruction, toResolveCall } from "../editor/commands.mjs";
import { clonePlan } from "../clone/pipeline.mjs";

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

function askResolve(action, payload) {
  const message = JSON.stringify({ token: token(), action, payload: payload || {} }) + "\n";
  return new Promise((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port: RESOLVE_PORT });
    let raw = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("Resolve bridge timed out"));
    }, 20000);
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
  "create_timeline",
  "add_clip",
  "trim_clip",
  "split_clip",
  "move_clip",
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
const PRODUCTION_HQ = process.env.AURA_RESOLVE_HQ_URL || "https://ifcdc-hq-wst6.onrender.com";
const ACTION_FOR = {
  create_project: "create_project",
  open_project: "create_project",
  import_media: "import_media",
  create_timeline: "create_timeline",
  add_clip: "add_clip",
  add_title: "add_title",
  add_logo: "add_logo",
  add_music: "add_music",
  add_voiceover: "add_voiceover",
  add_transition: "add_transition",
  fade_audio: "fade_audio",
  fade_video: "fade_video",
  save_project: "save_project",
  preview_project: "status",
  queue_render: "render",
  render_vertical: "render",
  render_landscape: "render",
  resolve_status: "status",
};

async function ensureHqLink() {
  if (existsSync(HQ_FILE)) return JSON.parse(readFileSync(HQ_FILE, "utf8"));
  const hqUrl = PRODUCTION_HQ;
  const nodeId = `arn_${randomBytes(8).toString("hex")}`;
  const token = `arnt_${randomBytes(24).toString("base64url")}`;
  try {
    const response = await fetch(`${hqUrl}/api/hq/aura/resolve/node/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nodeId, token, label: "Founder Mac Resolve Node", hostname: "production-mac" }),
    });
    if (!response.ok) return null;
    const body = await response.json();
    const link = { hqUrl, nodeId: body.nodeId || nodeId, token };
    writeFileSync(HQ_FILE, JSON.stringify(link, null, 2));
    return link;
  } catch {
    return null;
  }
}

async function heartbeatOnce() {
  const link = await ensureHqLink();
  if (!link?.token) return;
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
  const response = await fetch(`${link.hqUrl}/api/hq/aura/resolve/node/heartbeat`, {
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
      notes: ["Publishing stays off until Founder approval."],
      lastSuccessfulCommand,
    }),
  });
  if (!response.ok) return;
  const body = await response.json();
  for (const command of body.commands || []) {
    if (command.command === "editor_plan") {
      const planned = await fetch(`http://${HOST}:${PORT}/v1/editor/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: command.args?.instruction || "" }),
      }).then((item) => item.json());
      await fetch(`${link.hqUrl}/api/hq/aura/resolve/node/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${link.token}`, "x-aura-resolve-node-id": link.nodeId },
        body: JSON.stringify({ id: command.id, result: { ok: true, publish: false, plan: planned } }),
      });
      writeFileSync(join(ROOT, "last-command.json"), JSON.stringify({ command: "editor_plan", at: new Date().toISOString() }));
      continue;
    }
    const action = ACTION_FOR[command.command];
    let result;
    if (!action) result = { ok: false, error: "command is not allowlisted" };
    else {
      const payload = { ...(command.args || {}) };
      if (command.command === "render_vertical") Object.assign(payload, { width: 1080, height: 1920 });
      if (command.command === "render_landscape") Object.assign(payload, { width: 1920, height: 1080 });
      try {
        result = await askResolve(action, payload);
      } catch (error) {
        result = { ok: false, error: error.message };
      }
    }
    if (result?.ok) writeFileSync(join(ROOT, "last-command.json"), JSON.stringify({ command: command.command, at: new Date().toISOString() }));
    await fetch(`${link.hqUrl}/api/hq/aura/resolve/node/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${link.token}`, "x-aura-resolve-node-id": link.nodeId },
      body: JSON.stringify({ id: command.id, result }),
    });
  }
}

setInterval(() => {
  heartbeatOnce().catch((error) => console.error("resolve heartbeat", error.message));
}, 8000);
heartbeatOnce().catch(() => {});
