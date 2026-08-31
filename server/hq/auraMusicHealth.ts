/**
 * AURA MUSIC health + command-center payload for IFCDC HQ.
 *
 * Security:
 * - Never exposes ports 4177/4178 to the public internet.
 * - Cloud/Render HQ returns a clear "production node not on this host" payload
 *   without probing localhost (avoids hangs / false failures).
 * - Local Founder Mac HQ reads ~/Music/IFCDC-MUSIC/status/aura-music-ready.json
 *   (written by the private watchdog) and optionally probes 127.0.0.1 only.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const MUSIC_ROOT = join(homedir(), "Music", "IFCDC-MUSIC");
const DEFAULT_STATUS = join(MUSIC_ROOT, "status", "aura-music-ready.json");
const EXPORTS_DIR = join(MUSIC_ROOT, "exports");
const JOBS_DIR = join(MUSIC_ROOT, "jobs");
const JOBS_QUEUE_FILE = join(JOBS_DIR, "queue.json");
const JOBS_CURRENT_FILE = join(JOBS_DIR, "current.json");

export type AuraMusicServiceState =
  | "ONLINE"
  | "OFFLINE"
  | "RECONNECTING"
  | "ERROR"
  | "READY"
  | "NOT READY"
  | "CONNECTED"
  | "DISCONNECTED"
  | "HEALTHY"
  | "NOT_APPLICABLE"
  | "UNKNOWN";

export interface AuraMusicCommandCenter {
  ok: boolean;
  configured: boolean;
  mode: "local_status_file" | "local_live_probe" | "cloud_hq" | "local_offline" | "remote_production_node";
  auraMusicReady: boolean;
  publicExposure: false;
  architecture: string;
  message?: string;
  generatedAt: string;
  statusGeneratedAt: string | null;
  currentPhase: string;
  phases: {
    phase1: { status: string; label: string };
    phase2: { status: string; label: string };
    phase2Hardening: { status: string; label: string };
    phase3: { status: string; label: string };
  };
  services: {
    musicIntelligence: AuraMusicServiceState;
    abletonBridge: AuraMusicServiceState;
    abletonLive: AuraMusicServiceState;
    productionNode: AuraMusicServiceState;
    watchdog: AuraMusicServiceState;
  };
  lastHeartbeatAt: string | null;
  lastHeartbeatAgeMs: number | null;
  bridgeBuild: string | null;
  bridgeExpectedBuild: string | null;
  bridgeRestartCount: number;
  bridgeReconnectAttempts: number;
  bridgeLastError: string | null;
  autoRecoveryStatus: string;
  remoteScriptStatus: string;
  currentJob: AuraMusicJob | null;
  jobQueue: AuraMusicJob[];
  recentExports: AuraMusicExport[];
  sections: { id: string; label: string; available: boolean; status?: string; note?: string }[];
  summary: Record<string, string>;
  nodeId?: string;
  nodeLabel?: string;
  modules?: {
    mixingIntelligence: { status: string; label: string };
    samplingMastery: { status: string; label: string; mastered?: string };
    vocalProductionGate: { status: string; label: string };
    masteringEngine: { status: string; label: string };
    abletonMastery: { overallPercent: number | null; level9Complete: boolean; level7Complete: boolean };
  };
}

export interface AuraMusicJob {
  id: string;
  title: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  detail?: string;
}

export interface AuraMusicExport {
  name: string;
  path: string;
  modifiedAt: string;
  sizeBytes: number;
}

const ARCHITECTURE =
  "Authorized Device → IFCDC HQ → AURA MUSIC → Secure Music Job Queue → Ableton Production Node → Music Library";

function buildSections(): NonNullable<AuraMusicCommandCenter["sections"]> {
  const m = readMasterySnapshot();
  const samplingNote = m.level7Complete
    ? `Level 7 Sampling — ${m.l7Mastered ?? 18}/${m.l7Total ?? 18} mastered · IFCDC Music Library`
    : "Level 7 Sampling — operational · IFCDC Music Library";
  return [
    { id: "dashboard", label: "Dashboard", available: true, status: "ACTIVE" },
    {
      id: "library",
      label: "Library",
      available: true,
      status: "ACTIVE",
      note: "IFCDC Music Library — ingest, rights, search on production node",
    },
    {
      id: "projects",
      label: "Projects",
      available: true,
      status: "ACTIVE",
      note: "MUSIC-###### projects + Signature Sound productions",
    },
    {
      id: "mix",
      label: "Mix",
      available: true,
      status: "ACTIVE",
      note: "Mixing Intelligence — controlled engineering racks + Mix review",
    },
    {
      id: "sampling",
      label: "Sampling",
      available: true,
      status: "ACTIVE",
      note: samplingNote,
    },
    {
      id: "master",
      label: "Master",
      available: false,
      status: "SOON",
      note: "Dedicated AURA Mastering Engine — not started",
    },
    { id: "jobs", label: "Jobs", available: true, status: "ACTIVE", note: "Secure Music Job Queue" },
    { id: "ableton", label: "Ableton", available: true, status: "ACTIVE", note: "Production node + Ableton mastery" },
  ];
}

function statusPath(): string {
  return process.env.AURA_MUSIC_STATUS_FILE || DEFAULT_STATUS;
}

/** Local node is available when env is set OR the Mac status file exists on this host. */
function hasLocalNodeSignal(): boolean {
  if (String(process.env.AURA_MUSIC_LOCAL_NODE || "").trim() === "1") return true;
  return existsSync(statusPath());
}

function readJsonFile<T>(path: string): T | null {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function listRecentExports(limit = 12): AuraMusicExport[] {
  try {
    if (!existsSync(EXPORTS_DIR)) return [];
    return readdirSync(EXPORTS_DIR)
      .filter((n) => !n.startsWith(".") && !n.endsWith(".status.json"))
      .map((name) => {
        const full = join(EXPORTS_DIR, name);
        const st = statSync(full);
        return {
          name,
          path: full,
          modifiedAt: st.mtime.toISOString(),
          sizeBytes: st.size,
        };
      })
      .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
      .slice(0, limit);
  } catch {
    return [];
  }
}

function readJobs(): { current: AuraMusicJob | null; queue: AuraMusicJob[] } {
  const current = readJsonFile<AuraMusicJob>(JOBS_CURRENT_FILE);
  const queueRaw = readJsonFile<{ jobs?: AuraMusicJob[] } | AuraMusicJob[]>(JOBS_QUEUE_FILE);
  let queue: AuraMusicJob[] = [];
  if (Array.isArray(queueRaw)) queue = queueRaw;
  else if (queueRaw && Array.isArray(queueRaw.jobs)) queue = queueRaw.jobs;
  return { current, queue };
}

function readMasterySnapshot() {
  const masteryRoot = join(MUSIC_ROOT, "mastery");
  const read = (name: string) => readJsonFile<Record<string, unknown>>(join(masteryRoot, name));
  const l7 = read("levels-7-status.json");
  const l9 = read("levels-9-status.json");
  const vocal = read("vocal-gate-status.json");
  const matrix = read("capability-matrix.json");

  const level7Complete = Boolean((l7?.level7 as { complete?: boolean })?.complete);
  const level9Complete = Boolean((l9?.level9 as { complete?: boolean })?.complete);
  const vocalComplete = Boolean(vocal?.gate && String(vocal.gate).includes("ALL CHECKS PASSED"));

  let overallPercent: number | null =
    typeof l9?.overallMasteryPercent === "number"
      ? (l9.overallMasteryPercent as number)
      : typeof l7?.overallMasteryPercent === "number"
        ? (l7.overallMasteryPercent as number)
        : null;

  if (overallPercent == null && matrix?.capabilities && Array.isArray(matrix.capabilities)) {
    const caps = matrix.capabilities as Array<{ status?: string }>;
    const mastered = caps.filter((c) => c.status === "MASTERED").length;
    overallPercent = caps.length ? Math.round((mastered / caps.length) * 1000) / 10 : null;
  }

  return {
    overallPercent,
    level7Complete,
    level9Complete,
    vocalComplete,
    l7Mastered: (l7?.level7 as { mastered?: number; total?: number })?.mastered,
    l7Total: (l7?.level7 as { total?: number })?.total ?? 18,
  };
}

function moduleBlock(remote?: {
  overallPercent?: number | null;
  level7Complete?: boolean;
  level9Complete?: boolean;
  vocalComplete?: boolean;
  l7Mastered?: number;
  l7Total?: number;
} | null) {
  const local = readMasterySnapshot();
  const m = {
    overallPercent: local.overallPercent ?? remote?.overallPercent ?? null,
    level7Complete: local.level7Complete || Boolean(remote?.level7Complete),
    level9Complete: local.level9Complete || Boolean(remote?.level9Complete),
    vocalComplete: local.vocalComplete || Boolean(remote?.vocalComplete),
    l7Mastered: local.l7Mastered ?? remote?.l7Mastered,
    l7Total: local.l7Total ?? remote?.l7Total ?? 18,
  };
  return {
    mixingIntelligence: { status: "ACTIVE", label: "Mixing Intelligence — engineering racks + Mix review" },
    samplingMastery: {
      status: m.level7Complete ? "COMPLETE" : "ACTIVE",
      label: m.level7Complete
        ? `Sampling Mastery — ${m.l7Mastered ?? 18}/${m.l7Total ?? 18} mastered`
        : "Sampling Mastery — in progress",
      mastered: m.level7Complete ? `${m.l7Mastered ?? 18}/${m.l7Total ?? 18}` : undefined,
    },
    vocalProductionGate: {
      status: m.vocalComplete ? "COMPLETE" : "NOT STARTED",
      label: m.vocalComplete ? "Vocal Production Gate — Hard Street Soul V6" : "Vocal Production Gate — pending",
    },
    masteringEngine: { status: "SOON", label: "Dedicated AURA Mastering Engine — not started" },
    abletonMastery: {
      overallPercent: m.overallPercent,
      level9Complete: m.level9Complete,
      level7Complete: m.level7Complete,
    },
  };
}

function attachModules(
  payload: AuraMusicCommandCenter,
  remote?: Parameters<typeof moduleBlock>[0]
): AuraMusicCommandCenter {
  return { ...payload, modules: moduleBlock(remote) };
}

function finalizePayload(
  payload: AuraMusicCommandCenter,
  remote?: Parameters<typeof moduleBlock>[0]
): AuraMusicCommandCenter {
  return attachModules({ ...payload, sections: buildSections() }, remote);
}

function normalizeProductionNode(raw: string | undefined): AuraMusicServiceState {
  const s = String(raw || "NOT READY").toUpperCase();
  if (["READY", "NOT READY", "RECONNECTING", "OFFLINE", "ERROR"].includes(s)) return s as AuraMusicServiceState;
  if (s === "ONLINE") return "READY";
  return "NOT READY";
}

function phaseBlock(phase3Status: "ACTIVE" | "BLOCKED" = "ACTIVE") {
  return {
    phase1: { status: "PASS", label: "AURA ↔ Ableton Bridge" },
    phase2: { status: "PASS", label: "Audio Intelligence Foundation" },
    phase2Hardening: { status: "PASS", label: "Auto-start / recovery (LaunchAgents)" },
    phase3: {
      status: phase3Status === "ACTIVE" ? "ACTIVE" : "BLOCKED",
      label:
        phase3Status === "ACTIVE"
          ? "Mixing Intelligence — controlled engineering racks + Mix V1"
          : "Automatic mixing — awaiting Founder authorization",
    },
  };
}

function cloudPayload(): AuraMusicCommandCenter {
  const generatedAt = new Date().toISOString();
  return finalizePayload({
    ok: true,
    configured: false,
    mode: "cloud_hq",
    auraMusicReady: false,
    publicExposure: false,
    architecture: ARCHITECTURE,
    message:
      "AURA MUSIC production node is not linked. Enroll the Founder Mac agent so it can push authenticated heartbeats to HQ. Ports 4177/4178 stay private.",
    generatedAt,
    statusGeneratedAt: null,
    currentPhase: "2 (hardened) — production node offline from this HQ host",
    phases: phaseBlock("ACTIVE"),
    services: {
      musicIntelligence: "OFFLINE",
      abletonBridge: "OFFLINE",
      abletonLive: "DISCONNECTED",
      productionNode: "OFFLINE",
      watchdog: "ERROR",
    },
    lastHeartbeatAt: null,
    lastHeartbeatAgeMs: null,
    bridgeBuild: null,
    bridgeExpectedBuild: null,
    bridgeRestartCount: 0,
    bridgeReconnectAttempts: 0,
    bridgeLastError: null,
    autoRecoveryStatus: "UNKNOWN",
    remoteScriptStatus: "UNKNOWN",
    currentJob: null,
    jobQueue: [],
    recentExports: [],
    sections: [],
    summary: {
      "Music Intelligence": "OFFLINE",
      "Ableton Bridge": "OFFLINE",
      "Ableton Live": "DISCONNECTED",
      "Production Node": "OFFLINE",
      Watchdog: "ERROR",
    },
  });
}

function fromRemoteNodeSnapshot(snap: {
  online: boolean;
  nodeId: string | null;
  label: string | null;
  lastSeenAt: string | null;
  ageMs: number | null;
  heartbeat: Record<string, unknown> | null;
  timedOut: boolean;
}): AuraMusicCommandCenter {
  if (!snap.online || !snap.heartbeat) {
    const base = cloudPayload();
    return finalizePayload({
      ...base,
      configured: true,
      mode: "remote_production_node",
      message: snap.timedOut
        ? `Production node ${snap.nodeId ?? ""} last seen ${snap.lastSeenAt ?? "never"} — heartbeat timed out. Waiting for Mac agent reconnect.`
        : "Production node enrolled but no heartbeat received yet.",
      lastHeartbeatAt: snap.lastSeenAt,
      lastHeartbeatAgeMs: snap.ageMs,
      nodeId: snap.nodeId ?? undefined,
      services: {
        ...base.services,
        productionNode: snap.timedOut ? "OFFLINE" : "NOT READY",
      },
      summary: {
        ...base.summary,
        "Production Node": snap.timedOut ? "OFFLINE" : "NOT READY",
      },
    });
  }

  const hb = snap.heartbeat as {
    services?: Record<string, string>;
    summary?: Record<string, string>;
    lastHeartbeatAt?: string | null;
    lastHeartbeatAgeMs?: number | null;
    bridgeBuild?: string | null;
    bridgeExpectedBuild?: string | null;
    bridgeRestartCount?: number;
    bridgeReconnectAttempts?: number;
    bridgeLastError?: string | null;
    autoRecoveryStatus?: string;
    remoteScriptStatus?: string;
    currentJob?: AuraMusicJob | null;
    jobQueue?: AuraMusicJob[];
    recentExports?: AuraMusicExport[];
    auraMusicReady?: boolean;
    statusGeneratedAt?: string | null;
    workerAvailable?: boolean;
    masterySnapshot?: {
      overallPercent?: number | null;
      level7Complete?: boolean;
      level9Complete?: boolean;
      vocalComplete?: boolean;
      l7Mastered?: number;
      l7Total?: number;
    };
    modules?: AuraMusicCommandCenter["modules"];
  };

  const services = hb.services ?? {};
  const musicIntelligence = (services.musicIntelligence || "OFFLINE") as AuraMusicServiceState;
  const abletonBridge = (services.abletonBridge || "OFFLINE") as AuraMusicServiceState;
  const abletonLive = (services.abletonLive || "DISCONNECTED") as AuraMusicServiceState;
  const productionNode = normalizeProductionNode(services.productionNode || summaryRawFallback(hb.summary, "Production Node"));
  const watchdog = (services.watchdog || "ERROR") as AuraMusicServiceState;
  const ready =
    musicIntelligence === "ONLINE" &&
    productionNode === "READY" &&
    snap.online &&
    watchdog !== "ERROR";

  const remoteMastery = hb.masterySnapshot || {
    overallPercent: hb.modules?.abletonMastery?.overallPercent ?? null,
    level7Complete: hb.modules?.abletonMastery?.level7Complete,
    level9Complete: hb.modules?.abletonMastery?.level9Complete,
    vocalComplete: hb.modules?.vocalProductionGate?.status === "COMPLETE",
    l7Mastered: hb.modules?.samplingMastery?.mastered
      ? Number(String(hb.modules.samplingMastery.mastered).split("/")[0])
      : undefined,
  };

  return finalizePayload({
    ok: ready,
    configured: true,
    mode: "remote_production_node",
    auraMusicReady: ready,
    publicExposure: false,
    architecture: ARCHITECTURE,
    message: undefined,
    generatedAt: new Date().toISOString(),
    statusGeneratedAt: hb.statusGeneratedAt ?? snap.lastSeenAt,
    currentPhase: "3 — Mixing Intelligence (remote production node)",
    phases: phaseBlock("ACTIVE"),
    services: {
      musicIntelligence,
      abletonBridge,
      abletonLive,
      productionNode,
      watchdog,
    },
    lastHeartbeatAt: hb.lastHeartbeatAt ?? snap.lastSeenAt,
    lastHeartbeatAgeMs: hb.lastHeartbeatAgeMs ?? snap.ageMs,
    bridgeBuild: hb.bridgeBuild ?? null,
    bridgeExpectedBuild: hb.bridgeExpectedBuild ?? null,
    bridgeRestartCount: hb.bridgeRestartCount ?? 0,
    bridgeReconnectAttempts: hb.bridgeReconnectAttempts ?? 0,
    bridgeLastError: hb.bridgeLastError ?? null,
    autoRecoveryStatus: hb.autoRecoveryStatus || "UNKNOWN",
    remoteScriptStatus: hb.remoteScriptStatus || "UNKNOWN",
    currentJob: (hb.currentJob as AuraMusicJob | null) ?? null,
    jobQueue: (hb.jobQueue as AuraMusicJob[]) ?? [],
    recentExports: (hb.recentExports as AuraMusicExport[]) ?? [],
    sections: [],
    summary: {
      "Music Intelligence": musicIntelligence,
      "Ableton Bridge": abletonBridge,
      "Ableton Live": abletonLive,
      "Production Node": productionNode,
      Watchdog: watchdog,
      "Node ID": snap.nodeId ?? "—",
      Worker: hb.workerAvailable === false ? "UNAVAILABLE" : "AVAILABLE",
      "Bridge Build": hb.bridgeBuild || hb.summary?.["Bridge Build"] || "UNKNOWN",
    },
    nodeId: snap.nodeId ?? undefined,
    nodeLabel: snap.label ?? undefined,
  }, remoteMastery);
}

function summaryRawFallback(summary: Record<string, string> | undefined, key: string): string | undefined {
  return summary?.[key];
}

function deriveFromStatus(raw: Record<string, unknown>): AuraMusicCommandCenter {
  const servicesRaw = (raw.services ?? {}) as Record<string, { status?: string; detail?: Record<string, unknown> }>;
  const summaryRaw = (raw.summary ?? {}) as Record<string, string>;

  const musicIntelligence = (servicesRaw.musicIntelligence?.status ||
    summaryRaw["Music Intelligence"] ||
    "OFFLINE") as AuraMusicServiceState;
  const abletonBridge = (servicesRaw.abletonBridge?.status ||
    summaryRaw["Ableton Bridge"] ||
    "OFFLINE") as AuraMusicServiceState;
  const productionNode = normalizeProductionNode(
    servicesRaw.abletonProductionNode?.status ||
      summaryRaw["Ableton Production Node"] ||
      summaryRaw["Production Node"]
  );

  const nodeDetail = (servicesRaw.abletonProductionNode?.detail ?? {}) as {
    liveRunning?: boolean;
    heartbeatAgeMs?: number | null;
    heartbeat?: { ok?: boolean };
    status?: string;
  };
  const bridgeDetail = (servicesRaw.abletonBridge?.detail ?? {}) as {
    ableton?: { fileQueue?: { lastHeartbeatAt?: string; heartbeatAgeMs?: number; connectedHint?: boolean } };
    build?: string;
    expectedBuild?: string;
    lastHeartbeatAt?: string;
    lastHeartbeatAgeMs?: number;
    restartCount?: number;
    reconnectAttempts?: number;
    lastError?: string;
    autoRecoveryStatus?: string;
    remoteScriptStatus?: string;
  };
  const bridgeService = servicesRaw.abletonBridge as {
    status?: string;
    build?: string;
    expectedBuild?: string;
    lastHeartbeatAt?: string;
    lastHeartbeatAgeMs?: number;
    restartCount?: number;
    reconnectAttempts?: number;
    lastError?: string;
    autoRecoveryStatus?: string;
    remoteScriptStatus?: string;
  } | undefined;
  const fq = bridgeDetail.ableton?.fileQueue;
  const lastHeartbeatAt =
    bridgeService?.lastHeartbeatAt || bridgeDetail.lastHeartbeatAt || fq?.lastHeartbeatAt || null;
  const lastHeartbeatAgeMs =
    typeof bridgeService?.lastHeartbeatAgeMs === "number"
      ? bridgeService.lastHeartbeatAgeMs
      : typeof bridgeDetail.lastHeartbeatAgeMs === "number"
        ? bridgeDetail.lastHeartbeatAgeMs
        : typeof fq?.heartbeatAgeMs === "number"
          ? fq.heartbeatAgeMs
          : typeof nodeDetail.heartbeatAgeMs === "number"
            ? nodeDetail.heartbeatAgeMs
            : null;

  const liveService = servicesRaw.abletonLive as { status?: string } | undefined;
  const liveConnected =
    liveService?.status === "CONNECTED" ||
    productionNode === "READY" ||
    Boolean(nodeDetail.liveRunning && (lastHeartbeatAgeMs == null || lastHeartbeatAgeMs < 30_000)) ||
    Boolean(fq?.connectedHint);

  const statusGeneratedAt = typeof raw.generatedAt === "string" ? raw.generatedAt : null;
  const statusAgeMs = statusGeneratedAt ? Date.now() - Date.parse(statusGeneratedAt) : null;
  const watchdog: AuraMusicServiceState =
    statusAgeMs != null && Number.isFinite(statusAgeMs) && statusAgeMs < 45_000 ? "HEALTHY" : "ERROR";

  const ready =
    musicIntelligence === "ONLINE" &&
    productionNode === "READY" &&
    watchdog !== "ERROR";
  const { current, queue } = readJobs();

  return finalizePayload({
    ok: ready,
    configured: true,
    mode: "local_status_file",
    auraMusicReady: ready,
    publicExposure: false,
    architecture: ARCHITECTURE,
    generatedAt: new Date().toISOString(),
    statusGeneratedAt,
    currentPhase: "3 — Mixing Intelligence",
    phases: phaseBlock("ACTIVE"),
    services: {
      musicIntelligence,
      abletonBridge,
      abletonLive: liveConnected ? "CONNECTED" : "DISCONNECTED",
      productionNode,
      watchdog,
    },
    lastHeartbeatAt,
    lastHeartbeatAgeMs,
    bridgeBuild: bridgeService?.build || bridgeDetail.build || null,
    bridgeExpectedBuild: bridgeService?.expectedBuild || bridgeDetail.expectedBuild || null,
    bridgeRestartCount: bridgeService?.restartCount ?? bridgeDetail.restartCount ?? 0,
    bridgeReconnectAttempts: bridgeService?.reconnectAttempts ?? bridgeDetail.reconnectAttempts ?? 0,
    bridgeLastError: bridgeService?.lastError || bridgeDetail.lastError || null,
    autoRecoveryStatus: bridgeService?.autoRecoveryStatus || bridgeDetail.autoRecoveryStatus || "UNKNOWN",
    remoteScriptStatus: bridgeService?.remoteScriptStatus || bridgeDetail.remoteScriptStatus || "UNKNOWN",
    currentJob: current,
    jobQueue: queue,
    recentExports: listRecentExports(),
    sections: [],
    summary: {
      "Music Intelligence": musicIntelligence,
      "Ableton Bridge": abletonBridge,
      "Ableton Live": liveConnected ? "CONNECTED" : "DISCONNECTED",
      "Production Node": productionNode,
      Watchdog: watchdog,
      "Bridge Build": bridgeService?.build || bridgeDetail.build || "UNKNOWN",
      "Auto-Recovery": bridgeService?.autoRecoveryStatus || bridgeDetail.autoRecoveryStatus || "UNKNOWN",
    },
  });
}

async function probe(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean };
    return res.ok && json.ok !== false;
  } catch {
    return false;
  }
}

async function liveProbePayload(): Promise<AuraMusicCommandCenter> {
  const intelUrl = process.env.AURA_MUSIC_INTEL_URL || "http://127.0.0.1:4178/health";
  const bridgeUrl = process.env.AURA_ABLETON_BRIDGE_URL || "http://127.0.0.1:4177/health";
  const [intel, bridge] = await Promise.all([probe(intelUrl), probe(bridgeUrl)]);
  const musicIntelligence: AuraMusicServiceState = intel ? "ONLINE" : "OFFLINE";
  const abletonBridge: AuraMusicServiceState = bridge ? "ONLINE" : "OFFLINE";
  const ready = intel && bridge;
  const { current, queue } = readJobs();

  return finalizePayload({
    ok: ready,
    configured: true,
    mode: "local_live_probe",
    auraMusicReady: ready,
    publicExposure: false,
    architecture: ARCHITECTURE,
    message: ready ? undefined : "Local production node partially offline",
    generatedAt: new Date().toISOString(),
    statusGeneratedAt: null,
    currentPhase: "3 — Mixing Intelligence",
    phases: phaseBlock("ACTIVE"),
    services: {
      musicIntelligence,
      abletonBridge,
      abletonLive: "UNKNOWN",
      productionNode: ready ? "READY" : "NOT READY",
      watchdog: ready ? "HEALTHY" : "ERROR",
    },
    lastHeartbeatAt: null,
    lastHeartbeatAgeMs: null,
    currentJob: current,
    jobQueue: queue,
    recentExports: listRecentExports(),
    sections: [],
    summary: {
      "Music Intelligence": musicIntelligence,
      "Ableton Bridge": abletonBridge,
      "Ableton Live": "UNKNOWN",
      "Production Node": ready ? "READY" : "NOT READY",
      Watchdog: ready ? "HEALTHY" : "ERROR",
    },
  });
}

/** Backward-compatible health summary used by GET /aura/music/health */
export async function getAuraMusicHealthSummary(): Promise<Record<string, unknown>> {
  const cc = await getAuraMusicCommandCenter();
  return {
    ok: cc.ok,
    configured: cc.configured,
    mode: cc.mode,
    auraMusicReady: cc.auraMusicReady,
    ready: cc.auraMusicReady,
    message: cc.message,
    publicExposure: false,
    architecture: cc.architecture,
    generatedAt: cc.generatedAt,
    summary: cc.summary,
    services: cc.services,
    lastHeartbeatAt: cc.lastHeartbeatAt,
  };
}

/** Full Command Center payload for HQ UI */
export async function getAuraMusicCommandCenter(): Promise<AuraMusicCommandCenter> {
  // Prefer local Mac status when this HQ process is on the Founder workstation.
  if (hasLocalNodeSignal()) {
    const path = statusPath();
    if (existsSync(path)) {
      try {
        const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
        return deriveFromStatus(raw);
      } catch (err) {
        const base = await liveProbePayload();
        return finalizePayload({
          ...base,
          mode: "local_offline",
          message: err instanceof Error ? err.message : String(err),
          services: { ...base.services, watchdog: "ERROR" },
          summary: { ...base.summary, Watchdog: "ERROR" },
        });
      }
    }
    if (String(process.env.AURA_MUSIC_LOCAL_NODE || "").trim() === "1") {
      return liveProbePayload();
    }
  }

  // Cloud HQ: use authenticated remote production-node heartbeats (never probe 4177/4178).
  try {
    const { getPrimaryAuraMusicNodeSnapshot } = await import("./auraMusicProductionNode");
    const snap = await getPrimaryAuraMusicNodeSnapshot();
    if (snap) {
      return fromRemoteNodeSnapshot({
        ...snap,
        heartbeat: (snap.heartbeat as Record<string, unknown> | null) ?? null,
      });
    }
  } catch (err) {
    console.warn("[aura-music] remote node snapshot unavailable:", err instanceof Error ? err.message : err);
  }

  return cloudPayload();
}
