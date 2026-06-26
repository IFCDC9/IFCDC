import React from "react";

/** Shown on live dashboards — updates via WebSocket push */
export const HqLiveIndicator: React.FC<{ intervalSec?: number; connected?: boolean }> = ({ intervalSec, connected = true }) => (
  <span
    className={`hq-live-indicator${connected ? "" : " hq-live-indicator--offline"}`}
    title={
      connected
        ? intervalSec
          ? `Auto-refreshes every ${intervalSec}s`
          : "Real-time WebSocket push active"
        : "Reconnecting to live feed…"
    }
  >
    <span className={`hq-live-dot${connected ? "" : " hq-live-dot--offline"}`} />
    {connected ? "Live" : "Offline"}
  </span>
);
