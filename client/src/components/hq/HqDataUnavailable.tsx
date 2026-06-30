import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface HqDataUnavailableProps {
  title?: string;
  message?: string;
  detail?: string;
  onRetry?: () => void;
}

/** Shown in production when live HQ data cannot be loaded — never demo numbers. */
export const HqDataUnavailable: React.FC<HqDataUnavailableProps> = ({
  title = "Live data unavailable",
  message = "Headquarters could not load production metrics from the API.",
  detail,
  onRetry,
}) => (
  <div className="hq-panel hq-fade-in" style={{ padding: "1.5rem", textAlign: "center", maxWidth: 520, margin: "2rem auto" }}>
    <AlertTriangle size={32} style={{ color: "var(--hq-warning)", marginBottom: "0.75rem" }} />
    <h3 style={{ color: "var(--hq-gold)", marginBottom: "0.5rem" }}>{title}</h3>
    <p style={{ color: "var(--hq-text-muted)", fontSize: "0.9rem", marginBottom: "0.75rem" }}>{message}</p>
    {detail && (
      <p style={{ color: "var(--hq-text-muted)", fontSize: "0.8rem", fontFamily: "monospace" }}>{detail}</p>
    )}
    {onRetry && (
      <button type="button" className="hq-btn hq-btn-secondary" style={{ marginTop: "1rem" }} onClick={onRetry}>
        <RefreshCw size={14} style={{ marginRight: 6 }} />
        Retry
      </button>
    )}
  </div>
);
