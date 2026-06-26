import type { Server as HttpServer, IncomingMessage } from "http";
import { WebSocketServer, WebSocket } from "ws";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config/auth";
import { buildSafeAnalyticsOverview } from "./analyticsReporting";
import { buildEnterpriseNotifications } from "./enterpriseHub";
import { buildPredictiveTrends } from "./analyticsReporting";
import { getOrganizationMetrics } from "./metrics";
import type { HQUser } from "../middleware/hqAuth";
import { registerHqPushHandler, type HqRealtimeDomain } from "./hqRealtimeEvents";

/** Fallback sync interval if no events (keeps long-idle dashboards fresh) */
const FALLBACK_SYNC_MS = 5 * 60_000;

interface AuthenticatedSocket extends WebSocket {
  hqUser?: HQUser;
  isAlive?: boolean;
}

function parseCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function authenticateWsRequest(req: IncomingMessage): HQUser | null {
  try {
    const url = new URL(req.url ?? "", "http://localhost");
    let token = url.searchParams.get("token");
    if (!token) {
      token = parseCookie(req.headers.cookie, "ifcdc_token");
    }
    if (!token) return null;

    const payload = jwt.verify(token, JWT_SECRET) as { id: string; email: string; role: string; name?: string };
    return { id: payload.id, email: payload.email, role: payload.role, name: payload.name };
  } catch {
    return null;
  }
}

export async function buildHqRealtimeSnapshot() {
  const [overview, trends, metrics, notifications] = await Promise.all([
    buildSafeAnalyticsOverview().catch(() => null),
    buildPredictiveTrends().catch(() => null),
    getOrganizationMetrics(),
    buildEnterpriseNotifications().catch(() => ({ unreadCount: 0, notifications: [] })),
  ]);

  return {
    timestamp: new Date().toISOString(),
    organizationHealth: overview?.organizationHealth ?? null,
    finance: overview?.finance ?? null,
    grants: overview?.grants ?? null,
    people: overview?.people ?? null,
    programs: overview?.programs ?? null,
    donations: overview?.donations ?? null,
    trends: trends
      ? {
          trend: trends.trend,
          projectedCashFlow: trends.projectedCashFlow,
          donationGrowth: trends.donationGrowth,
        }
      : null,
    metrics,
    notifications: {
      unreadCount: notifications.unreadCount ?? 0,
    },
  };
}

export function attachHqRealtimeHub(server: HttpServer) {
  const wss = new WebSocketServer({ server, path: "/api/hq/ws" });
  const clients = new Set<AuthenticatedSocket>();
  let lastPushAt = 0;

  function broadcastRaw(payload: string) {
    for (const ws of Array.from(clients)) {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    }
  }

  function broadcast(payload: string) {
    broadcastRaw(payload);
  }

  // Anomaly alert push
  import("./anomalyMonitor").then(({ registerAnomalyBroadcast, startAnomalyMonitor }) => {
    registerAnomalyBroadcast((alerts) => {
      if (!clients.size) return;
      broadcastRaw(JSON.stringify({
        type: "anomaly_alert",
        alerts,
        timestamp: new Date().toISOString(),
      }));
    });
    startAnomalyMonitor();
  }).catch(() => undefined);

  async function pushUpdate(domain: HqRealtimeDomain, reason: "event" | "fallback" = "event") {
    if (!clients.size) return;
    try {
      const snapshot = await buildHqRealtimeSnapshot();
      lastPushAt = Date.now();
      broadcast(JSON.stringify({
        type: "update",
        domain,
        reason,
        data: snapshot,
        timestamp: new Date().toISOString(),
      }));
    } catch (error) {
      console.error("HQ realtime push error:", error);
    }
  }

  registerHqPushHandler(async (domain) => {
    await pushUpdate(domain, "event");
  });

  wss.on("connection", async (ws: AuthenticatedSocket, req) => {
    const user = authenticateWsRequest(req);
    if (!user) {
      ws.close(4401, "Authentication required");
      return;
    }

    ws.hqUser = user;
    ws.isAlive = true;
    clients.add(ws);

    ws.send(JSON.stringify({ type: "connected", userId: user.id, pushMode: "event-driven", timestamp: new Date().toISOString() }));

    // Initial snapshot on connect
    try {
      const snapshot = await buildHqRealtimeSnapshot();
      ws.send(JSON.stringify({ type: "snapshot", data: snapshot, timestamp: new Date().toISOString() }));
    } catch {
      /* initial load optional */
    }

    ws.on("pong", () => {
      ws.isAlive = true;
    });

    ws.on("close", () => {
      clients.delete(ws);
    });

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as { type?: string };
        if (msg.type === "ping") {
          ws.send(JSON.stringify({ type: "pong", timestamp: new Date().toISOString() }));
        }
      } catch {
        /* ignore */
      }
    });
  });

  const heartbeat = setInterval(() => {
    for (const ws of Array.from(clients)) {
      if (!ws.isAlive) {
        clients.delete(ws);
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30_000);

  // Fallback sync only when idle — no polling during active event-driven updates
  const fallback = setInterval(async () => {
    if (!clients.size) return;
    if (Date.now() - lastPushAt < FALLBACK_SYNC_MS - 30_000) return;
    await pushUpdate("all", "fallback");
  }, FALLBACK_SYNC_MS);

  wss.on("close", () => {
    clearInterval(heartbeat);
    clearInterval(fallback);
  });

  console.log("HQ realtime WebSocket hub attached at /api/hq/ws (event-driven push)");
  return wss;
}
