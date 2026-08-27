/**
 * AURA MUSIC Production Node agent routes (Mac → HQ outbound) + HQ command enqueue.
 */
import { Router } from "express";
import type { Request, Response } from "express";
import { hqAuthRequired, requireHQModule } from "../middleware/hqAuth";
import {
  AURA_MUSIC_COMMAND_ALLOWLIST,
  authenticateAuraMusicNode,
  claimFirstAuraMusicNode,
  claimPendingAuraMusicCommands,
  completeAuraMusicCommand,
  enqueueAuraMusicCommand,
  enrollAuraMusicProductionNode,
  getAuraMusicCommand,
  listRecentAuraMusicCommands,
  recordAuraMusicNodeHeartbeat,
  getPrimaryAuraMusicNodeSnapshot,
} from "../hq/auraMusicProductionNode";

const router = Router();

function founderOrAdmin(req: Request): boolean {
  const role = String(req.hqUser?.role || "").toLowerCase();
  return ["founder", "owner", "executive", "administrator", "admin"].includes(role);
}

/** Founder enrolls a Mac production node — returns plaintext token once. */
router.post("/node/enroll", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  try {
    if (!founderOrAdmin(req)) {
      return res.status(403).json({ error: "Founder/executive enrollment required" });
    }
    const enrolled = await enrollAuraMusicProductionNode({
      label: String(req.body?.label || "Founder Mac Production Node"),
      hostname: String(req.body?.hostname || "").trim() || undefined,
      enrolledBy: req.hqUser?.email || req.hqUser?.id,
    });
    res.status(201).json({
      ok: true,
      ...enrolled,
      hqBaseUrl: process.env.PUBLIC_APP_URL || process.env.PUBLIC_BASE_URL || null,
      agentEnv: {
        AURA_MUSIC_HQ_BASE_URL: process.env.PUBLIC_APP_URL || process.env.PUBLIC_BASE_URL || "",
        AURA_MUSIC_NODE_ID: enrolled.nodeId,
        AURA_MUSIC_NODE_TOKEN: enrolled.token,
      },
      warning: "Store the token securely on the Mac. It will not be shown again.",
    });
  } catch (error) {
    console.error("POST /aura/music/node/enroll error:", error);
    res.status(500).json({ error: "Enrollment failed" });
  }
});

/** Optional bootstrap enroll using shared secret (Render + Mac) — one-time setup. */
router.post("/node/bootstrap-enroll", async (req, res) => {
  try {
    const expected = String(process.env.AURA_MUSIC_NODE_BOOTSTRAP_SECRET || "").trim();
    const provided = String(req.body?.bootstrapSecret || req.headers["x-aura-music-bootstrap"] || "").trim();
    if (!expected || provided !== expected) {
      return res.status(403).json({ error: "Bootstrap not configured or secret invalid" });
    }
    const enrolled = await enrollAuraMusicProductionNode({
      label: String(req.body?.label || "Founder Mac Production Node"),
      hostname: String(req.body?.hostname || "").trim() || undefined,
      enrolledBy: "bootstrap",
    });
    res.status(201).json({
      ok: true,
      ...enrolled,
      hqBaseUrl: process.env.PUBLIC_APP_URL || process.env.PUBLIC_BASE_URL || null,
    });
  } catch (error) {
    console.error("POST /aura/music/node/bootstrap-enroll error:", error);
    res.status(500).json({ error: "Bootstrap enrollment failed" });
  }
});

/**
 * First-node claim — only when HQ has zero active nodes and
 * AURA_MUSIC_ALLOW_FIRST_NODE_CLAIM=1. Mac presents nodeId+token; HQ stores hash.
 */
router.post("/node/claim", async (req, res) => {
  try {
    const result = await claimFirstAuraMusicNode({
      nodeId: String(req.body?.nodeId || ""),
      token: String(req.body?.token || ""),
      label: String(req.body?.label || "Founder Mac Production Node"),
      hostname: String(req.body?.hostname || "").trim() || undefined,
    });
    if (!result.ok) return res.status(403).json({ error: result.error });
    res.status(201).json({
      ok: true,
      nodeId: result.nodeId,
      hqBaseUrl: process.env.PUBLIC_APP_URL || process.env.PUBLIC_BASE_URL || null,
    });
  } catch (error) {
    console.error("POST /aura/music/node/claim error:", error);
    res.status(500).json({ error: "Node claim failed" });
  }
});

/** Mac agent can read back the snapshot HQ stored for this node (no session cookie). */
router.get("/node/snapshot", async (req, res) => {
  try {
    const auth = await authenticateAuraMusicNode(req);
    if (!auth) return res.status(401).json({ error: "Unauthorized production node" });
    const snap = await getPrimaryAuraMusicNodeSnapshot();
    if (!snap || snap.nodeId !== auth.nodeId) {
      return res.status(404).json({ error: "Snapshot not found for this node" });
    }
    res.json({ ok: true, ...snap });
  } catch (error) {
    console.error("GET /aura/music/node/snapshot error:", error);
    res.status(500).json({ error: "Snapshot unavailable" });
  }
});

/**
 * Node self-test: enqueue an allowlisted command for this node and return id.
 * Used for remote acceptance without a browser session. Founder UI uses /commands.
 */
router.post("/node/self-command", async (req, res) => {
  try {
    const auth = await authenticateAuraMusicNode(req);
    if (!auth) return res.status(401).json({ error: "Unauthorized production node" });
    const command = String(req.body?.command || "read_session").trim();
    const enqueued = await enqueueAuraMusicCommand({
      nodeId: auth.nodeId,
      command,
      args: (req.body?.args as Record<string, unknown>) || {},
      requestedBy: `node:${auth.nodeId}`,
      replayKey: req.body?.replayKey ? String(req.body.replayKey) : undefined,
    });
    res.status(201).json({ ok: true, ...enqueued, allowlist: AURA_MUSIC_COMMAND_ALLOWLIST });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(400).json({ error: msg });
  }
});

/** Mac agent heartbeat (Bearer node token). */
router.post("/node/heartbeat", async (req, res) => {
  try {
    const auth = await authenticateAuraMusicNode(req);
    if (!auth) return res.status(401).json({ error: "Unauthorized production node" });
    await recordAuraMusicNodeHeartbeat(auth.nodeId, {
      ...(req.body || {}),
      nodeId: auth.nodeId,
    });
    const pending = await claimPendingAuraMusicCommands(auth.nodeId, 5);
    res.json({
      ok: true,
      nodeId: auth.nodeId,
      serverTime: new Date().toISOString(),
      commands: pending,
    });
  } catch (error) {
    console.error("POST /aura/music/node/heartbeat error:", error);
    res.status(500).json({ error: "Heartbeat failed" });
  }
});

/** Mac agent polls commands (also returned on heartbeat). */
router.get("/node/commands", async (req, res) => {
  try {
    const auth = await authenticateAuraMusicNode(req);
    if (!auth) return res.status(401).json({ error: "Unauthorized production node" });
    const pending = await claimPendingAuraMusicCommands(auth.nodeId, 5);
    res.json({ ok: true, commands: pending });
  } catch (error) {
    console.error("GET /aura/music/node/commands error:", error);
    res.status(500).json({ error: "Command poll failed" });
  }
});

/** Mac agent posts command result. */
router.post("/node/commands/:id/result", async (req, res) => {
  try {
    const auth = await authenticateAuraMusicNode(req);
    if (!auth) return res.status(401).json({ error: "Unauthorized production node" });
    const ok = await completeAuraMusicCommand({
      nodeId: auth.nodeId,
      commandId: String(req.params.id),
      ok: Boolean(req.body?.ok),
      result: req.body?.result,
      error: req.body?.error ? String(req.body.error).slice(0, 1000) : undefined,
    });
    if (!ok) return res.status(409).json({ error: "Command not found or already completed" });
    res.json({ ok: true });
  } catch (error) {
    console.error("POST /aura/music/node/commands/:id/result error:", error);
    res.status(500).json({ error: "Result submit failed" });
  }
});

/** HQ UI — node link status */
router.get("/node/status", hqAuthRequired, requireHQModule("aura"), async (_req, res) => {
  try {
    const snap = await getPrimaryAuraMusicNodeSnapshot();
    res.json({
      ok: true,
      allowlist: AURA_MUSIC_COMMAND_ALLOWLIST,
      node: snap,
      recentCommands: await listRecentAuraMusicCommands(15),
    });
  } catch (error) {
    console.error("GET /aura/music/node/status error:", error);
    res.status(500).json({ error: "Node status unavailable" });
  }
});

/** HQ UI — enqueue allowlisted remote command */
router.post("/commands", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  try {
    if (!founderOrAdmin(req)) {
      return res.status(403).json({ error: "Founder/executive required to issue production commands" });
    }
    const command = String(req.body?.command || "").trim();
    const enqueued = await enqueueAuraMusicCommand({
      command,
      args: (req.body?.args as Record<string, unknown>) || {},
      requestedBy: req.hqUser?.email || req.hqUser?.id,
      replayKey: req.body?.replayKey ? String(req.body.replayKey) : undefined,
    });
    res.status(201).json({ ok: true, ...enqueued, allowlist: AURA_MUSIC_COMMAND_ALLOWLIST });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    res.status(400).json({ error: msg });
  }
});

/** HQ UI — fetch command result */
router.get("/commands/:id", hqAuthRequired, requireHQModule("aura"), async (req, res) => {
  try {
    const cmd = await getAuraMusicCommand(String(req.params.id));
    if (!cmd) return res.status(404).json({ error: "Command not found" });
    res.json({ ok: true, command: cmd });
  } catch (error) {
    console.error("GET /aura/music/commands/:id error:", error);
    res.status(500).json({ error: "Command lookup failed" });
  }
});

router.get("/commands", hqAuthRequired, requireHQModule("aura"), async (_req, res) => {
  try {
    res.json({
      ok: true,
      allowlist: AURA_MUSIC_COMMAND_ALLOWLIST,
      commands: await listRecentAuraMusicCommands(25),
    });
  } catch (error) {
    res.status(500).json({ error: "Command list failed" });
  }
});

export default router;
