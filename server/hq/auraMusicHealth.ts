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
  | "READY"
  | "NOT READY"
  | "CONNECTED"
  | "DISCONNECTED"
  | "HEALTHY"
  | "ERROR"
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
  currentJob: AuraMusicJob | null;
  jobQueue: AuraMusicJob[];
  recentExports: AuraMusicExport[];
  sections: { id: string; label: string; available: boolean; note?: string }[];
  summary: Record<string, string>;
  nodeId?: string;
  nodeLabel?: string;
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

const SECTIONS = [
  { id: "dashboard", label: "Dashboard", available: true },
  { id: "library", label: "Library", available: true, note: "Foundation — ingest/search via Phase 2 API on production node" },
  { id: "projects", label: "Projects", available: true, note: "Foundation — MUSIC-###### projects" },
  { id: "mix", label: "Mix", available: false, note: "Phase 3 — awaiting Founder authorization" },
  { id: "master", label: "Master", available: false, note: "Phase 4 — not started" },
  { id: "sampling", label: "Sampling", available: false, note: "Foundation placeholder" },
  { id: "sounds", label: "Sounds", available: false, note: "Foundation placeholder" },
  { id: "jobs", label: "Jobs", available: true, note: "Secure Music Job Queue foundation" },
  { id: "ableton", label: "Ableton", available: true, note: "Production node status + session" },
] as const;

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

function phaseBlock() {
  return {
    phase1: { status: "PASS", label: "AURA ↔ Ableton Bridge" },
    phase2: { status: "PASS", label: "Audio Intelligence Foundation" },
    phase2Hardening: { status: "PASS", label: "Auto-start / recovery (LaunchAgents)" },
    phase3: { status: "BLOCKED", label: "Automatic mixing — awaiting Founder authorization" },
  };
}

function cloudPayload(): AuraMusicCommandCenter {
  const generatedAt = new Date().toISOString();
  return {
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
    phases: phaseBlock(),
    services: {
      musicIntelligence: "OFFLINE",
      abletonBridge: "OFFLINE",
      abletonLive: "DISCONNECTED",
      productionNode: "NOT READY",
      watchdog: "ERROR",
    },
    lastHeartbeatAt: null,
    lastHeartbeatAgeMs: null,
    currentJob: null,
    jobQueue: [],
    recentExports: [],
    sections: SECTIONS.map((s) => ({ ...s })),
    summary: {
      "Music Intelligence": "OFFLINE",
      "Ableton Bridge": "OFFLINE",
      "Ableton Live": "DISCONNECTED",
      "Production Node": "NOT READY",
      Watchdog: "ERROR",
    },
  };
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
    return {
      ...base,
      configured: true,
      mode: "remote_production_node",
      message: snap.timedOut
        ? `Production node ${snap.nodeId ?? ""} last seen ${snap.lastSeenAt ?? "never"} — heartbeat timed out. Waiting for Mac agent reconnect.`
        : "Production node enrolled but no heartbeat received yet.",
      lastHeartbeatAt: snap.lastSeenAt,
      lastHeartbeatAgeMs: snap.ageMs,
      nodeId: snap.nodeId ?? undefined,
    } as AuraMusicCommandCenter;
  }

  const hb = snap.heartbeat as {
    services?: Record<string, string>;
    summary?: Record<string, string>;
    lastHeartbeatAt?: string | null;
    lastHeartbeatAgeMs?: number | null;
    currentJob?: AuraMusicJob | null;
    jobQueue?: AuraMusicJob[];
    recentExports?: AuraMusicExport[];
    auraMusicReady?: boolean;
    statusGeneratedAt?: string | null;
    workerAvailable?: boolean;
  };

  const services = hb.services ?? {};
  const musicIntelligence = (services.musicIntelligence || "OFFLINE") as AuraMusicServiceState;
  const abletonBridge = (services.abletonBridge || "OFFLINE") as AuraMusicServiceState;
  const abletonLive = (services.abletonLive || "DISCONNECTED") as AuraMusicServiceState;
  const productionNode = (services.productionNode || "NOT READY") as AuraMusicServiceState;
  const watchdog = (services.watchdog || "ERROR") as AuraMusicServiceState;
  const ready =
    Boolean(hb.auraMusicReady) &&
    musicIntelligence === "ONLINE" &&
    abletonBridge === "ONLINE" &&
    snap.online;

  return {
    ok: ready,
    configured: true,
    mode: "remote_production_node",
    auraMusicReady: ready,
    publicExposure: false,
    architecture: ARCHITECTURE,
    message: undefined,
    generatedAt: new Date().toISOString(),
    statusGeneratedAt: hb.statusGeneratedAt ?? snap.lastSeenAt,
    currentPhase: "2 (hardened) — remote production node linked",
    phases: phaseBlock(),
    services: {
      musicIntelligence,
      abletonBridge,
      abletonLive,
      productionNode,
      watchdog,
    },
    lastHeartbeatAt: hb.lastHeartbeatAt ?? snap.lastSeenAt,
    lastHeartbeatAgeMs: hb.lastHeartbeatAgeMs ?? snap.ageMs,
    currentJob: (hb.currentJob as AuraMusicJob | null) ?? null,
    jobQueue: (hb.jobQueue as AuraMusicJob[]) ?? [],
    recentExports: (hb.recentExports as AuraMusicExport[]) ?? [],
    sections: SECTIONS.map((s) => ({ ...s })),
    summary: {
      "Music Intelligence": musicIntelligence,
      "Ableton Bridge": abletonBridge,
      "Ableton Live": abletonLive,
      "Production Node": productionNode,
      Watchdog: watchdog,
      "Node ID": snap.nodeId ?? "—",
      Worker: hb.workerAvailable === false ? "UNAVAILABLE" : "AVAILABLE",
    },
    nodeId: snap.nodeId ?? undefined,
    nodeLabel: snap.label ?? undefined,
  } as AuraMusicCommandCenter;
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
  const productionNode = (servicesRaw.abletonProductionNode?.status ||
    summaryRaw["Ableton Production Node"] ||
    "NOT READY") as AuraMusicServiceState;

  const nodeDetail = (servicesRaw.abletonProductionNode?.detail ?? {}) as {
    liveRunning?: boolean;
    heartbeatAgeMs?: number | null;
    heartbeat?: { ok?: boolean };
    status?: string;
  };
  const bridgeDetail = (servicesRaw.abletonBridge?.detail ?? {}) as {
    ableton?: { fileQueue?: { lastHeartbeatAt?: string; heartbeatAgeMs?: number; connectedHint?: boolean } };
  };
  const fq = bridgeDetail.ableton?.fileQueue;
  const lastHeartbeatAt = fq?.lastHeartbeatAt ?? null;
  const lastHeartbeatAgeMs =
    typeof fq?.heartbeatAgeMs === "number"
      ? fq.heartbeatAgeMs
      : typeof nodeDetail.heartbeatAgeMs === "number"
        ? nodeDetail.heartbeatAgeMs
        : null;

  const liveConnected =
    productionNode === "READY" ||
    Boolean(nodeDetail.liveRunning && (lastHeartbeatAgeMs == null || lastHeartbeatAgeMs < 30_000)) ||
    Boolean(fq?.connectedHint);

  const statusGeneratedAt = typeof raw.generatedAt === "string" ? raw.generatedAt : null;
  const statusAgeMs = statusGeneratedAt ? Date.now() - Date.parse(statusGeneratedAt) : null;
  const watchdog: AuraMusicServiceState =
    statusAgeMs != null && Number.isFinite(statusAgeMs) && statusAgeMs < 45_000 ? "HEALTHY" : "ERROR";

  const ready = Boolean(raw.ok ?? raw.ready ?? raw.auraMusicReady) && musicIntelligence === "ONLINE" && abletonBridge === "ONLINE";
  const { current, queue } = readJobs();

  return {
    ok: ready,
    configured: true,
    mode: "local_status_file",
    auraMusicReady: ready,
    publicExposure: false,
    architecture: ARCHITECTURE,
    generatedAt: new Date().toISOString(),
    statusGeneratedAt,
    currentPhase: "2 (hardened)",
    phases: phaseBlock(),
    services: {
      musicIntelligence,
      abletonBridge,
      abletonLive: liveConnected ? "CONNECTED" : "DISCONNECTED",
      productionNode: productionNode === "READY" ? "READY" : "NOT READY",
      watchdog,
    },
    lastHeartbeatAt,
    lastHeartbeatAgeMs,
    currentJob: current,
    jobQueue: queue,
    recentExports: listRecentExports(),
    sections: SECTIONS.map((s) => ({ ...s })),
    summary: {
      "Music Intelligence": musicIntelligence,
      "Ableton Bridge": abletonBridge,
      "Ableton Live": liveConnected ? "CONNECTED" : "DISCONNECTED",
      "Production Node": productionNode === "READY" ? "READY" : "NOT READY",
      Watchdog: watchdog,
    },
  };
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

  return {
    ok: ready,
    configured: true,
    mode: "local_live_probe",
    auraMusicReady: ready,
    publicExposure: false,
    architecture: ARCHITECTURE,
    message: ready ? undefined : "Local production node partially offline",
    generatedAt: new Date().toISOString(),
    statusGeneratedAt: null,
    currentPhase: "2 (hardened)",
    phases: phaseBlock(),
    services: {
      musicIntelligence,
      abletonBridge,
      abletonLive: "UNKNOWN",
      productionNode: "NOT READY",
      watchdog: "ERROR",
    },
    lastHeartbeatAt: null,
    lastHeartbeatAgeMs: null,
    currentJob: current,
    jobQueue: queue,
    recentExports: listRecentExports(),
    sections: SECTIONS.map((s) => ({ ...s })),
    summary: {
      "Music Intelligence": musicIntelligence,
      "Ableton Bridge": abletonBridge,
      "Ableton Live": "UNKNOWN",
      "Production Node": "NOT READY",
      Watchdog: "ERROR",
    },
  };
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
        return {
          ...base,
          mode: "local_offline",
          message: err instanceof Error ? err.message : String(err),
          services: { ...base.services, watchdog: "ERROR" },
          summary: { ...base.summary, Watchdog: "ERROR" },
        };
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
      return fromRemoteNodeSnapshot(snap);
    }
  } catch (err) {
    console.warn("[aura-music] remote node snapshot unavailable:", err instanceof Error ? err.message : err);
  }

  return cloudPayload();
}
