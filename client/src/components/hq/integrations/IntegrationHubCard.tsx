import React from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Clock, KeyRound, Activity } from "lucide-react";
import { StatusBadge } from "../StatusBadge";
import type { IntegrationHubCard as Card, IntegrationHubAction } from "../../data/integrationsHubDefaults";
import { displayStatusForCard } from "../../data/integrationsHubDefaults";

const STATUS_VARIANT: Record<string, "success" | "warning" | "muted" | "gold" | "danger"> = {
  connected: "success",
  configured: "gold",
  not_configured: "warning",
  degraded: "warning",
  coming_soon: "muted",
  Connected: "success",
  Warning: "warning",
  Disconnected: "danger",
};

function formatChecked(iso: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

const DETAIL_COLOR: Record<string, string> = {
  success: "var(--hq-success)",
  warning: "var(--hq-warning)",
  danger: "var(--hq-danger)",
  muted: "var(--hq-text-muted)",
};

export const IntegrationHubCardView: React.FC<{
  card: Card;
  testMessage?: string;
  testPending?: boolean;
  onTest: () => void;
  onConfigure: () => void;
  onOAuth: () => void;
  oauthPending?: boolean;
}> = ({ card, testMessage, testPending, onTest, onConfigure, onOAuth, oauthPending }) => {
  const configuredCount = card.requiredCredentials.filter((c) => c.configured).length;
  const totalCreds = card.requiredCredentials.length;

  function renderAction(action: IntegrationHubAction) {
    const disabled = action.kind === "disabled" || testPending || oauthPending;
    const className = `hq-btn hq-btn-sm ${
      action.kind === "primary" ? "hq-btn-primary" : action.kind === "disabled" ? "hq-btn-ghost" : "hq-btn-secondary"
    }`;

    if (action.action === "link" && action.href) {
      const external = action.href.startsWith("http");
      if (external) {
        return (
          <a key={action.id} href={action.href} target="_blank" rel="noopener noreferrer" className={className}>
            {action.label}
          </a>
        );
      }
      return (
        <Link key={action.id} to={action.href} className={className}>
          {action.label}
        </Link>
      );
    }

    if (action.action === "test") {
      return (
        <button key={action.id} type="button" className={className} disabled={disabled} onClick={onTest} title={action.reason}>
          {testPending ? "Testing…" : action.label}
        </button>
      );
    }

    if (action.action === "oauth") {
      return (
        <button key={action.id} type="button" className={className} disabled={disabled} onClick={onOAuth} title={action.reason}>
          {oauthPending ? "Connecting…" : action.label}
        </button>
      );
    }

    if (action.action === "configure") {
      return (
        <button
          key={action.id}
          type="button"
          className={className}
          disabled={action.kind === "disabled"}
          onClick={onConfigure}
          title={action.reason}
        >
          {action.label}
        </button>
      );
    }

    return (
      <button key={action.id} type="button" className={className} disabled title={action.reason}>
        {action.label}
      </button>
    );
  }

  return (
    <div className="hq-panel hq-fade-in" style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem" }}>
        <div>
          <h4 style={{ margin: 0, fontSize: "0.95rem", color: "var(--hq-gold)" }}>{card.name}</h4>
          <div className="hq-muted-text" style={{ fontSize: "0.72rem", marginTop: "0.2rem" }}>{card.category}</div>
        </div>
        <StatusBadge label={displayStatusForCard(card)} variant={STATUS_VARIANT[displayStatusForCard(card)] ?? "muted"} />
      </div>

      <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--hq-text-muted)", lineHeight: 1.45 }}>{card.description}</p>

      <div style={{ display: "grid", gap: "0.35rem", fontSize: "0.75rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", color: "var(--hq-text-muted)" }}>
          <Clock size={12} /> Last checked: {formatChecked(card.lastChecked)}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", color: "var(--hq-text-muted)" }}>
          <CheckCircle2 size={12} />
          Environment: {card.environmentReadiness.ready ? "Ready" : "Incomplete"} ({configuredCount}/{totalCreds} credentials)
        </div>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "0.35rem", color: card.health.healthy ? "var(--hq-success)" : "var(--hq-warning)" }}>
          <Activity size={12} style={{ marginTop: 2 }} />
          <span>
            {card.health.message}
            {typeof card.health.latencyMs === "number" ? ` · ${card.health.latencyMs}ms` : ""}
          </span>
        </div>
      </div>

      {card.details && card.details.length > 0 && (
        <div
          style={{
            display: "grid",
            gap: "0.3rem",
            fontSize: "0.72rem",
            padding: "0.5rem 0.65rem",
            borderRadius: "6px",
            background: "rgba(255,255,255,0.03)",
            border: "1px solid var(--hq-border)",
          }}
        >
          {card.details.map((row) => (
            <div key={row.label} style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
              <span className="hq-muted-text">{row.label}</span>
              <span
                style={{
                  textAlign: "right",
                  color: row.status ? DETAIL_COLOR[row.status] ?? "var(--hq-text)" : "var(--hq-text)",
                  fontFamily: row.label.toLowerCase().includes("commit") ? "monospace" : "inherit",
                }}
              >
                {row.value}
              </span>
            </div>
          ))}
        </div>
      )}

      <div>
        <div className="hq-muted-text" style={{ fontSize: "0.7rem", marginBottom: "0.35rem", display: "flex", alignItems: "center", gap: "0.25rem" }}>
          <KeyRound size={11} /> Required credentials
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
          {card.requiredCredentials.map((cred) => (
            <StatusBadge
              key={cred.key}
              label={cred.configured ? cred.label : `${cred.label} ✗`}
              variant={cred.configured ? "success" : "muted"}
            />
          ))}
        </div>
        {card.environmentReadiness.missing.length > 0 && (
          <p className="hq-muted-text" style={{ fontSize: "0.7rem", margin: "0.35rem 0 0" }}>
            Missing on Render: {card.environmentReadiness.missing.join(", ")}
          </p>
        )}
      </div>

      <div style={{ marginTop: "auto", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        {card.actions.map((action) => renderAction(action))}
      </div>

      {testMessage && (
        <p style={{ fontSize: "0.75rem", margin: 0, color: testMessage.includes("not") ? "var(--hq-warning)" : "var(--hq-success)" }}>
          {testMessage}
        </p>
      )}
    </div>
  );
};

export const IntegrationsHubEmptyState: React.FC<{ onRetry?: () => void }> = ({ onRetry }) => (
  <div className="hq-panel hq-fade-in" style={{ padding: "2rem", textAlign: "center" }}>
    <AlertTriangle size={32} style={{ color: "var(--hq-gold)", marginBottom: "0.75rem" }} />
    <h3 style={{ margin: "0 0 0.5rem", color: "var(--hq-gold)" }}>No integrations loaded</h3>
    <p className="hq-muted-text" style={{ maxWidth: 420, margin: "0 auto 1rem" }}>
      Integration connectors could not be retrieved. Configure environment variables on Render and retry.
    </p>
    {onRetry && (
      <button type="button" className="hq-btn hq-btn-primary" onClick={onRetry}>
        Retry
      </button>
    )}
  </div>
);
