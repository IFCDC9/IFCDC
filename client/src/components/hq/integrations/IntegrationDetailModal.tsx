import React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { X, RefreshCw, Activity, AlertTriangle, Clock } from "lucide-react";
import { StatusBadge } from "../StatusBadge";
import { integrationsApi, type IntegrationLiveDetail, type IntegrationProbeLogEntry } from "../../../api/integrationsApi";
import type { IntegrationHubCard } from "../../../data/integrationsHubDefaults";

function fmt(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function MiniSpark({ values, color = "var(--hq-gold)" }: { values: number[]; color?: string }) {
  if (!values.length) return <span className="hq-muted-text">No history yet</span>;
  const max = Math.max(...values, 1);
  return (
    <div
      style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 36 }}
      aria-label="Response time history"
    >
      {values.map((v, i) => (
        <div
          key={i}
          title={`${v}ms`}
          style={{
            flex: 1,
            minWidth: 3,
            height: `${Math.max(8, Math.round((v / max) * 100))}%`,
            background: color,
            opacity: 0.55 + (i / values.length) * 0.45,
            borderRadius: 1,
          }}
        />
      ))}
    </div>
  );
}

function TrendBars({
  trend,
}: {
  trend: { at: string; ok: boolean; latencyMs: number }[];
}) {
  if (!trend.length) return <span className="hq-muted-text">No trend data yet</span>;
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 36 }}>
      {trend.map((t, i) => (
        <div
          key={`${t.at}-${i}`}
          title={`${t.ok ? "OK" : "FAIL"} · ${t.latencyMs}ms · ${fmt(t.at)}`}
          style={{
            flex: 1,
            minWidth: 3,
            height: "70%",
            background: t.ok ? "var(--hq-success)" : "var(--hq-danger)",
            opacity: 0.75,
            borderRadius: 1,
          }}
        />
      ))}
    </div>
  );
}

function LogList({
  title,
  entries,
}: {
  title: string;
  entries: IntegrationProbeLogEntry[];
}) {
  if (!entries.length) {
    return (
      <div style={{ marginBottom: "0.85rem" }}>
        <h4 style={{ fontSize: "0.78rem", color: "var(--hq-text-dim)", margin: "0 0 0.35rem" }}>{title}</h4>
        <p className="hq-muted-text" style={{ fontSize: "0.75rem", margin: 0 }}>
          None recorded in probe log
        </p>
      </div>
    );
  }
  return (
    <div style={{ marginBottom: "0.85rem" }}>
      <h4 style={{ fontSize: "0.78rem", color: "var(--hq-text-dim)", margin: "0 0 0.35rem" }}>{title}</h4>
      <ul className="hq-activity-list" style={{ maxHeight: 160, overflowY: "auto" }}>
        {entries.map((e, idx) => (
          <li key={`${e.provider}-${e.at}-${idx}`} className="hq-activity-item">
            <div className="hq-activity-content">
              <div className="hq-activity-title">
                {e.ok ? "OK" : e.errorCode || "FAIL"}
                {!e.ok && e.rootCause ? ` — ${e.rootCause}` : ""}
              </div>
              <div className="hq-activity-detail">
                {e.message}
                {e.latencyMs != null ? ` · ${e.latencyMs}ms` : ""}
              </div>
            </div>
            <div className="hq-activity-time">{new Date(e.at).toLocaleTimeString()}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export type IntegrationDetailModalProps = {
  providerId: string;
  fallbackCard?: IntegrationHubCard | null;
  onClose: () => void;
  onConfigure: (card: IntegrationHubCard) => void;
  onOpenLogs?: () => void;
};

export const IntegrationDetailModal: React.FC<IntegrationDetailModalProps> = ({
  providerId,
  fallbackCard,
  onClose,
  onConfigure,
  onOpenLogs,
}) => {
  const qc = useQueryClient();
  const [actionMsg, setActionMsg] = React.useState<string | null>(null);

  const detailQuery = useQuery({
    queryKey: ["integrations-health-detail", providerId],
    queryFn: () => integrationsApi.healthDetail(providerId),
    staleTime: 15_000,
    retry: 1,
  });

  const test = useMutation({
    mutationFn: () => integrationsApi.test(providerId),
    onSuccess: (data) => {
      setActionMsg(data.message || (data.success ? "Connection OK" : "Test failed"));
      void qc.invalidateQueries({ queryKey: ["integrations-health-detail", providerId] });
      void qc.invalidateQueries({ queryKey: ["integrations-hub"] });
      void qc.invalidateQueries({ queryKey: ["integrations-health"] });
    },
    onError: (err: Error) => setActionMsg(err.message),
  });

  const retry = useMutation({
    mutationFn: () => integrationsApi.retryDegraded([providerId]),
    onSuccess: (data) => {
      const recovered = data.recovered.includes(providerId);
      setActionMsg(
        recovered
          ? "Retry succeeded — connector recovered"
          : `Retry finished (${data.attempted} attempted)`,
      );
      void qc.invalidateQueries({ queryKey: ["integrations-health-detail", providerId] });
      void qc.invalidateQueries({ queryKey: ["integrations-hub"] });
      void qc.invalidateQueries({ queryKey: ["integrations-health"] });
    },
    onError: (err: Error) => setActionMsg(err.message),
  });

  const qbConnect = useMutation({
    mutationFn: integrationsApi.quickBooksConnect,
    onSuccess: (data) => {
      if (data.authUrl) window.location.href = data.authUrl;
      else setActionMsg("QuickBooks OAuth URL unavailable");
    },
    onError: (err: Error) => setActionMsg(err.message),
  });

  const detail: IntegrationLiveDetail | undefined = detailQuery.data;
  const service = detail?.service;
  const card = detail?.hubCard ?? fallbackCard ?? null;
  const ops = service?.ops;
  const name = service?.name || card?.name || providerId;
  const status = service?.displayStatus || "Disconnected";
  const busy = test.isPending || retry.isPending || qbConnect.isPending || detailQuery.isFetching;

  async function refreshStatus() {
    setActionMsg(null);
    await detailQuery.refetch();
    void qc.invalidateQueries({ queryKey: ["integrations-health"] });
    void qc.invalidateQueries({ queryKey: ["integrations-hub"] });
    setActionMsg("Status refreshed from live health API");
  }

  function openConfig() {
    if (card) onConfigure(card);
    else setActionMsg("Configuration is managed via Render environment variables for this service.");
  }

  function reconnect() {
    if (providerId === "quickbooks") {
      qbConnect.mutate();
      return;
    }
    test.mutate();
  }

  function viewLogs() {
    if (onOpenLogs) onOpenLogs();
    else {
      const el = document.getElementById("integrations-probe-log");
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
      onClose();
    }
  }

  return (
    <div
      className="hq-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="integration-detail-title"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        className="hq-modal hq-modal--wide"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: "min(90vh, 900px)", overflowY: "auto" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.75rem" }}>
          <div>
            <h3 id="integration-detail-title" style={{ marginBottom: "0.35rem" }}>
              {name}
            </h3>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", alignItems: "center" }}>
              <StatusBadge
                label={status}
                variant={status === "Connected" ? "success" : status === "Warning" ? "warning" : "danger"}
              />
              {ops?.productionVsTest && (
                <StatusBadge
                  label={ops.productionVsTest === "production" ? "Production" : ops.productionVsTest === "test" ? "Test" : ops.productionVsTest}
                  variant={ops.productionVsTest === "production" ? "gold" : "muted"}
                />
              )}
              {ops?.serviceOwner && <StatusBadge label={`Owner: ${ops.serviceOwner}`} variant="muted" />}
            </div>
          </div>
          <button type="button" className="hq-btn hq-btn-sm hq-btn-ghost" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {detailQuery.isLoading && !service ? (
          <p className="hq-muted-text">Loading live integration detail…</p>
        ) : detailQuery.isError && !service ? (
          <div className="hq-anomaly-alert hq-sev-medium">
            <AlertTriangle size={14} />
            <span>Could not load detail from health API. Retry or close.</span>
          </div>
        ) : (
          <>
            <div
              className="hq-integration-detail-metrics"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                gap: "0.65rem",
                margin: "1rem 0",
                fontSize: "0.78rem",
              }}
            >
              <Metric label="Current status" value={status} />
              <Metric label="Last successful sync" value={fmt(ops?.lastSuccessfulSync || service?.lastChecked)} />
              <Metric label="Last checked" value={fmt(service?.lastChecked)} />
              <Metric
                label="API latency"
                value={service?.latencyMs != null ? `${service.latencyMs}ms` : "—"}
              />
              <Metric label="Failed requests" value={String(ops?.failedRequestCount ?? 0)} />
              <Metric label="Connected environment" value={ops?.connectedEnvironment || "—"} />
              <Metric label="Authentication" value={ops?.authStatus || "unknown"} />
              <Metric
                label="24h uptime"
                value={ops?.uptime24hPct != null ? `${ops.uptime24hPct}%` : "—"}
              />
              <Metric
                label="7d uptime"
                value={ops?.uptime7dPct != null ? `${ops.uptime7dPct}%` : "—"}
              />
              <Metric label="Environment" value={ops?.environmentName || "—"} />
            </div>

            {ops?.credentialExpirationWarning && (
              <div className="hq-anomaly-alert hq-sev-medium" style={{ marginBottom: "0.85rem" }}>
                <AlertTriangle size={14} />
                <div>
                  <strong>Credential warning</strong>
                  <span>{ops.credentialExpirationWarning}</span>
                </div>
              </div>
            )}

            {service?.message && (
              <p style={{ fontSize: "0.82rem", margin: "0 0 0.85rem" }}>
                <Activity size={12} style={{ marginRight: 6, verticalAlign: -1 }} />
                {service.message}
              </p>
            )}

            <div
              className="hq-integration-detail-charts"
              style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.85rem", marginBottom: "0.85rem" }}
            >
              <div>
                <h4 style={{ fontSize: "0.78rem", color: "var(--hq-text-dim)", margin: "0 0 0.35rem" }}>
                  Success / failure trend
                </h4>
                <TrendBars trend={ops?.successFailureTrend ?? []} />
              </div>
              <div>
                <h4 style={{ fontSize: "0.78rem", color: "var(--hq-text-dim)", margin: "0 0 0.35rem" }}>
                  Response-time history
                </h4>
                <MiniSpark values={ops?.responseTimeHistoryMs ?? []} />
              </div>
            </div>

            <LogList title="Recent errors" entries={detail?.recentErrors ?? []} />
            <LogList title="Recent warnings" entries={detail?.recentWarnings ?? []} />
            <LogList title="Recent sync history (last 10)" entries={detail?.syncHistory ?? ops?.last10SyncEvents ?? []} />

            {actionMsg && (
              <p
                style={{
                  fontSize: "0.78rem",
                  color: /fail|error|unavailable/i.test(actionMsg) ? "var(--hq-warning)" : "var(--hq-success)",
                }}
              >
                {actionMsg}
              </p>
            )}

            <div className="hq-modal-actions" style={{ flexWrap: "wrap", justifyContent: "flex-start" }}>
              <button
                type="button"
                className="hq-btn hq-btn-primary"
                disabled={busy}
                onClick={() => test.mutate()}
              >
                {test.isPending ? "Testing…" : "Test connection"}
              </button>
              <button type="button" className="hq-btn hq-btn-secondary" disabled={busy} onClick={() => void refreshStatus()}>
                <RefreshCw size={14} className={detailQuery.isFetching ? "hq-spin" : ""} /> Refresh status
              </button>
              <button type="button" className="hq-btn hq-btn-secondary" disabled={busy} onClick={() => retry.mutate()}>
                Retry failed request
              </button>
              <button type="button" className="hq-btn hq-btn-ghost" disabled={busy} onClick={viewLogs}>
                View logs
              </button>
              <button type="button" className="hq-btn hq-btn-ghost" disabled={busy} onClick={openConfig}>
                Open configuration
              </button>
              <button type="button" className="hq-btn hq-btn-ghost" disabled={busy} onClick={reconnect}>
                {qbConnect.isPending ? "Connecting…" : "Reconnect"}
              </button>
              <button type="button" className="hq-btn hq-btn-ghost" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: "0.55rem 0.65rem",
        borderRadius: 6,
        border: "1px solid var(--hq-border)",
        background: "rgba(255,255,255,0.02)",
      }}
    >
      <div className="hq-muted-text" style={{ fontSize: "0.65rem", marginBottom: 2, display: "flex", alignItems: "center", gap: 4 }}>
        <Clock size={10} /> {label}
      </div>
      <div style={{ fontWeight: 600, wordBreak: "break-word" }}>{value}</div>
    </div>
  );
}
