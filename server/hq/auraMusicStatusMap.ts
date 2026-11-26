/**
 * AURA MUSIC lane mapping — HQ dashboard truth.
 *
 * Bridge HTTP up ≠ Ableton Live connected ≠ production ready.
 * Production READY only after a live control-surface readiness check.
 */

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

export const LIVE_CONTROL_SURFACE_FRESH_MS = 20_000;

export const FOUNDER_POWER_REQUIREMENTS = [
  "Keep the Founder Mac awake (sleep or shutdown drops Live, the bridge, and HQ heartbeats).",
  "Keep Ableton Live open with the IFCDC/Aura set loaded (the Remote Script / control surface must be running).",
  "Keep the AURA Ableton Bridge process running (LaunchAgent com.ifcdc.aura-ableton-bridge on 127.0.0.1:4177).",
  "Keep the production-node agent and watchdog LaunchAgents running so HQ receives authenticated heartbeats.",
] as const;

export const FOUNDER_LIVE_OPEN_STEP =
  "Keep the Mac awake. Open Ableton Live with the IFCDC/Aura set so the AURA Control Surface can write a heartbeat. Keep the Ableton Bridge process running. HQ cannot export or mark production READY while Live is closed.";

export interface AuraMusicLaneInput {
  musicIntelligence?: string | null;
  abletonBridge?: string | null;
  abletonLive?: string | null;
  productionNodeReported?: string | null;
  watchdog?: string | null;
  /** Enrolled Mac agent with a fresh HQ heartbeat (or local status file on this host). */
  nodeLinked?: boolean;
  liveRunning?: boolean;
  liveHeartbeatAgeMs?: number | null;
  fileQueueConnectedHint?: boolean;
}

export interface AuraMusicConnectivityAlert {
  code: string;
  severity: "warning" | "danger";
  title: string;
  message: string;
}

export interface AuraMusicLaneStatus {
  musicIntelligence: AuraMusicServiceState;
  abletonBridge: AuraMusicServiceState;
  abletonLive: AuraMusicServiceState;
  productionNode: AuraMusicServiceState;
  watchdog: AuraMusicServiceState;
  nodeLinked: boolean;
  auraMusicReady: boolean;
  autoRecoveryStatus: string;
  alerts: AuraMusicConnectivityAlert[];
  message: string | undefined;
  founderPowerRequirements: readonly string[];
}

function upper(raw: string | null | undefined, fallback: string): string {
  const s = String(raw ?? "").trim().toUpperCase();
  return s || fallback;
}

export function normalizeBridge(raw: string | null | undefined): AuraMusicServiceState {
  const s = upper(raw, "OFFLINE");
  if (s === "ONLINE" || s === "OFFLINE" || s === "RECONNECTING" || s === "ERROR") {
    return s as AuraMusicServiceState;
  }
  return "OFFLINE";
}

export function normalizeWatchdog(raw: string | null | undefined): AuraMusicServiceState {
  const s = upper(raw, "ERROR");
  if (s === "HEALTHY" || s === "ERROR" || s === "RECONNECTING") return s as AuraMusicServiceState;
  return "ERROR";
}

export function normalizeIntelligence(raw: string | null | undefined): AuraMusicServiceState {
  const s = upper(raw, "OFFLINE");
  if (s === "ONLINE" || s === "OFFLINE" || s === "ERROR") return s as AuraMusicServiceState;
  return "OFFLINE";
}

/**
 * Do not treat bridge ONLINE or a reported production ONLINE as Live connected.
 * Do not treat a stale heartbeat file as Live still being open.
 */
export function resolveAbletonLive(input: AuraMusicLaneInput): {
  connected: boolean;
  state: AuraMusicServiceState;
} {
  if (input.liveRunning === false) {
    return { connected: false, state: "DISCONNECTED" };
  }

  const reported = upper(input.abletonLive, "");
  const age = input.liveHeartbeatAgeMs;
  const freshHeartbeat =
    typeof age === "number" && Number.isFinite(age) && age >= 0 && age < LIVE_CONTROL_SURFACE_FRESH_MS;

  if (typeof age === "number" && Number.isFinite(age) && age >= LIVE_CONTROL_SURFACE_FRESH_MS) {
    return { connected: false, state: "DISCONNECTED" };
  }

  if (reported === "CONNECTED") {
    if (typeof age === "number" && Number.isFinite(age) && !freshHeartbeat) {
      return { connected: false, state: "DISCONNECTED" };
    }
    return { connected: true, state: "CONNECTED" };
  }

  if (input.liveRunning === true && freshHeartbeat) {
    return { connected: true, state: "CONNECTED" };
  }

  if (input.fileQueueConnectedHint === true && input.liveRunning !== false && reported !== "DISCONNECTED") {
    if (typeof age === "number" && Number.isFinite(age) && !freshHeartbeat) {
      return { connected: false, state: "DISCONNECTED" };
    }
    return { connected: true, state: "CONNECTED" };
  }

  return { connected: false, state: "DISCONNECTED" };
}

export function isProductionLaneReady(opts: {
  liveConnected: boolean;
  musicIntelligence: AuraMusicServiceState;
  abletonBridge: AuraMusicServiceState;
  watchdog: AuraMusicServiceState;
  nodeLinked: boolean;
}): boolean {
  return (
    opts.nodeLinked &&
    opts.liveConnected &&
    opts.musicIntelligence === "ONLINE" &&
    (opts.abletonBridge === "ONLINE" || opts.abletonBridge === "RECONNECTING") &&
    opts.watchdog !== "ERROR"
  );
}

export function mapAuraMusicLaneStatus(input: AuraMusicLaneInput): AuraMusicLaneStatus {
  const musicIntelligence = normalizeIntelligence(input.musicIntelligence);
  const abletonBridge = normalizeBridge(input.abletonBridge);
  const watchdog = normalizeWatchdog(input.watchdog);
  const nodeLinked = Boolean(input.nodeLinked);
  const live = resolveAbletonLive(input);

  const ready = isProductionLaneReady({
    liveConnected: live.connected,
    musicIntelligence,
    abletonBridge,
    watchdog,
    nodeLinked,
  });

  let productionNode: AuraMusicServiceState = "NOT READY";
  if (ready) productionNode = "READY";
  else if (!nodeLinked) productionNode = "OFFLINE";
  else if (abletonBridge === "RECONNECTING" || (live.connected === false && input.liveRunning === true)) {
    productionNode = "RECONNECTING";
  } else {
    productionNode = "NOT READY";
  }

  const alerts: AuraMusicConnectivityAlert[] = [];
  if (!nodeLinked) {
    alerts.push({
      code: "node_unlinked",
      severity: "danger",
      title: "Production node not linked",
      message:
        "HQ has no fresh authenticated heartbeat from the Founder Mac agent. Link is not the same as production ready.",
    });
  }
  if (nodeLinked && abletonBridge === "ONLINE" && !live.connected) {
    alerts.push({
      code: "live_disconnected",
      severity: "danger",
      title: "Ableton Live disconnected",
      message: FOUNDER_LIVE_OPEN_STEP,
    });
  }
  if (nodeLinked && !ready && live.connected === false && abletonBridge !== "ONLINE") {
    alerts.push({
      code: "live_or_bridge_down",
      severity: "danger",
      title: "Ableton lane down",
      message: FOUNDER_LIVE_OPEN_STEP,
    });
  }
  if (nodeLinked && productionNode !== "READY") {
    alerts.push({
      code: "production_not_ready",
      severity: "warning",
      title: "Production node not ready",
      message:
        "Linked means the Mac agent is talking to HQ. Production READY requires Music Intelligence, Ableton Bridge, a live Ableton control-surface check, and a healthy watchdog.",
    });
  }
  if (watchdog === "ERROR" && nodeLinked) {
    alerts.push({
      code: "watchdog_unhealthy",
      severity: "warning",
      title: "Watchdog not healthy",
      message: "The local watchdog status is stale or in error. Keep com.ifcdc.aura-music-watchdog running on the Mac.",
    });
  }

  let autoRecoveryStatus = "HEALTHY";
  if (ready) autoRecoveryStatus = "HEALTHY";
  else if (!live.connected && input.liveRunning === true) autoRecoveryStatus = "RECONNECTING";
  else if (!live.connected) autoRecoveryStatus = "WAITING_FOR_LIVE";
  else if (!nodeLinked) autoRecoveryStatus = "WAITING_FOR_NODE";
  else autoRecoveryStatus = "RECOVERING";

  const message = ready
    ? undefined
    : alerts[0]?.message || FOUNDER_LIVE_OPEN_STEP;

  return {
    musicIntelligence,
    abletonBridge,
    abletonLive: live.state,
    productionNode,
    watchdog,
    nodeLinked,
    auraMusicReady: ready,
    autoRecoveryStatus,
    alerts,
    message,
    founderPowerRequirements: FOUNDER_POWER_REQUIREMENTS,
  };
}
