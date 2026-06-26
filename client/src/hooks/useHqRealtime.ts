import { useEffect, useRef, useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";

type RealtimeMessage =
  | { type: "connected"; userId: string; pushMode?: string; timestamp: string }
  | { type: "snapshot"; data: Record<string, unknown>; timestamp: string }
  | { type: "update"; domain: string; reason: string; data: Record<string, unknown>; timestamp: string }
  | { type: "anomaly_alert"; alerts: { id: string; title: string; severity: string; detail: string; module: string }[]; timestamp: string }
  | { type: "pong"; timestamp: string };

function applySnapshot(queryClient: ReturnType<typeof useQueryClient>, snap: Record<string, unknown>) {
  queryClient.setQueryData(["hq-founder-analytics"], (prev: unknown) =>
    prev ? { ...(prev as object), ...pickAnalytics(snap) } : prev
  );
  queryClient.setQueryData(["analytics-overview"], (prev: unknown) =>
    prev ? { ...(prev as object), ...pickAnalytics(snap) } : prev
  );

  if (snap.organizationHealth) {
    queryClient.setQueryData(["hq-executive-overview"], (prev: Record<string, unknown> | undefined) =>
      prev ? { ...prev, organizationHealth: snap.organizationHealth, organizationHealthScore: (snap.organizationHealth as { overall: number }).overall } : prev
    );
  }

  if (snap.trends) {
    queryClient.setQueryData(["hq-founder-trends"], snap.trends);
    queryClient.setQueryData(["analytics-trends"], snap.trends);
  }

  if (snap.notifications) {
    queryClient.setQueryData(["enterprise-notif-count"], (prev: Record<string, unknown> | undefined) =>
      prev ? { ...prev, unreadCount: (snap.notifications as { unreadCount: number }).unreadCount } : { unreadCount: (snap.notifications as { unreadCount: number }).unreadCount }
    );
    queryClient.invalidateQueries({ queryKey: ["enterprise-notifications"] });
  }

  if (snap.finance) {
    queryClient.invalidateQueries({ queryKey: ["finance-overview"] });
    queryClient.invalidateQueries({ queryKey: ["hq-finance"] });
  }
  if (snap.grants) {
    queryClient.invalidateQueries({ queryKey: ["hq-grants"] });
    queryClient.invalidateQueries({ queryKey: ["grant-deadlines"] });
  }
  if (snap.programs) {
    queryClient.invalidateQueries({ queryKey: ["hq-programs-modules"] });
    queryClient.invalidateQueries({ queryKey: ["program-module"] });
  }
  if (snap.people) {
    queryClient.invalidateQueries({ queryKey: ["hq-people"] });
  }

  queryClient.invalidateQueries({ queryKey: ["hq-approval-tasks"] });
  queryClient.invalidateQueries({ queryKey: ["hq-executive-overview"] });
  queryClient.invalidateQueries({ queryKey: ["hq-founder-analytics"] });
  queryClient.invalidateQueries({ queryKey: ["hq-activity-feed"] });
  queryClient.invalidateQueries({ queryKey: ["analytics-activity"] });
  queryClient.invalidateQueries({ queryKey: ["hq-software-division"] });
}

export function useHqRealtime() {
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout>>();
  const [connected, setConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const [anomalyAlerts, setAnomalyAlerts] = useState<{ id: string; title: string; severity: string; detail: string; module: string }[]>([]);

  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const msg = JSON.parse(event.data as string) as RealtimeMessage;
      if (msg.type === "snapshot" || msg.type === "update") {
        applySnapshot(queryClient, msg.data);
        setLastUpdate(msg.timestamp ?? new Date().toISOString());
      }
      if (msg.type === "anomaly_alert") {
        setAnomalyAlerts(msg.alerts);
        setLastUpdate(msg.timestamp ?? new Date().toISOString());
        queryClient.invalidateQueries({ queryKey: ["hq-copilot-corrective"] });
        queryClient.invalidateQueries({ queryKey: ["intelligence-anomalies"] });
      }
    } catch {
      /* ignore */
    }
  }, [queryClient]);

  useEffect(() => {
    let closed = false;

    const connect = () => {
      if (closed) return;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${window.location.host}/api/hq/ws`);
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);
      ws.onmessage = handleMessage;

      ws.onclose = () => {
        setConnected(false);
        if (!closed) reconnectRef.current = setTimeout(connect, 4000);
      };

      ws.onerror = () => ws.close();
    };

    connect();

    const ping = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "ping" }));
      }
    }, 45_000);

    return () => {
      closed = true;
      clearInterval(ping);
      clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, [handleMessage]);

  return { connected, lastUpdate, anomalyAlerts };
}

function pickAnalytics(snap: Record<string, unknown>) {
  return {
    organizationHealth: snap.organizationHealth,
    finance: snap.finance,
    grants: snap.grants,
    people: snap.people,
    programs: snap.programs,
    donations: snap.donations,
  };
}
