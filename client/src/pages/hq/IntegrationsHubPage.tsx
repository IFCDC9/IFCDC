import React, { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Plug, RefreshCw, CheckCircle, AlertTriangle, Activity } from "lucide-react";
import HQLayout from "../../layouts/HQLayout";
import { EMPTY_INTEGRATION_HEALTH, integrationsApi } from "../../api/integrationsApi";
import { HqQueryBoundary } from "../../components/hq/HqQueryBoundary";
import { StatusBadge } from "../../components/hq/StatusBadge";
import { KpiCard } from "../../components/hq/KpiCard";
import { HqWidgetErrorBoundary } from "../../components/hq/HqErrorBoundary";
import {
  EMPTY_INTEGRATIONS_HUB,
  normalizeIntegrationsHub,
  type IntegrationsHubPayload,
  type IntegrationHubCard,
} from "../../data/integrationsHubDefaults";
import {
  IntegrationHubCardView,
  IntegrationsHubEmptyState,
} from "../../components/hq/integrations/IntegrationHubCard";
import { IntegrationsHealthPanel } from "../../components/hq/integrations/IntegrationsHealthPanel";

type HubLoadResult = {
  hub: IntegrationsHubPayload;
  degraded: boolean;
  warning: string | null;
};

const HUB_PLACEHOLDER: HubLoadResult = {
  hub: EMPTY_INTEGRATIONS_HUB,
  degraded: false,
  warning: null,
};

const REQUIRED_INTEGRATION_IDS = [
  "grants_gov",
  "sam_gov",
  "paypal",
  "resend",
  "openai_aura",
  "render",
  "github",
  "postgres",
  "twilio",
  "website_apps",
  "quickbooks",
] as const;

const IntegrationsHubPage: React.FC = () => {
  const qc = useQueryClient();
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [configuring, setConfiguring] = useState<IntegrationHubCard | null>(null);
  const [testResults, setTestResults] = useState<Record<string, string>>({});

  const hubQuery = useQuery({
    queryKey: ["integrations-hub"],
    queryFn: async (): Promise<HubLoadResult> => {
      try {
        const raw = await integrationsApi.hub();
        return {
          hub: normalizeIntegrationsHub(raw),
          degraded: Boolean(raw.degraded),
          warning: raw.warning ?? null,
        };
      } catch (err) {
        const warning = err instanceof Error ? err.message : "Integrations Hub API did not respond in time.";
        console.warn("[integrations-hub] degraded load:", warning);
        return {
          hub: normalizeIntegrationsHub(EMPTY_INTEGRATIONS_HUB),
          degraded: true,
          warning,
        };
      }
    },
    placeholderData: HUB_PLACEHOLDER,
    staleTime: 45_000,
    refetchInterval: 60_000,
    retry: 0,
  });

  const healthQuery = useQuery({
    queryKey: ["integrations-health"],
    queryFn: async () => {
      try {
        return await integrationsApi.health();
      } catch (err) {
        console.warn("[integrations-hub] health dashboard degraded:", err);
        return EMPTY_INTEGRATION_HEALTH;
      }
    },
    placeholderData: EMPTY_INTEGRATION_HEALTH,
    staleTime: 45_000,
    refetchInterval: 60_000,
    retry: 0,
  });

  const test = useMutation({
    mutationFn: integrationsApi.test,
    onSuccess: (data, provider) => {
      const detailLines = Array.isArray((data as { details?: { label: string; value: string }[] }).details)
        ? (data as { details: { label: string; value: string }[] }).details.map((d) => `${d.label}: ${d.value}`).join(" · ")
        : "";
      const msg = [data.message, detailLines].filter(Boolean).join(" — ");
      setTestResults((prev) => ({ ...prev, [provider]: msg || data.message }));
      void qc.invalidateQueries({ queryKey: ["integrations-hub"] });
      void qc.invalidateQueries({ queryKey: ["integrations-health"] });
      if (provider === "grants_gov" && data.success) {
        void qc.invalidateQueries({ queryKey: ["grant-opportunity-finder"] });
      }
      if (provider === "paypal" && data.success) {
        void qc.invalidateQueries({ queryKey: ["finance-payments"] });
      }
    },
    onError: (err: Error, provider) => {
      setTestResults((prev) => ({ ...prev, [provider]: err.message }));
    },
  });

  const qbConnect = useMutation({
    mutationFn: integrationsApi.quickBooksConnect,
    onSuccess: (data) => {
      if (data.authUrl) window.location.href = data.authUrl;
    },
  });

  const retryDegraded = useMutation({
    mutationFn: () => integrationsApi.retryDegraded(),
    onSuccess: (data) => {
      setTestResults((prev) => ({
        ...prev,
        _bulk: `Retry: ${data.recovered.length} recovered / ${data.attempted} attempted`,
      }));
      void qc.invalidateQueries({ queryKey: ["integrations-hub"] });
      void qc.invalidateQueries({ queryKey: ["integrations-health"] });
      void qc.invalidateQueries({ queryKey: ["hq-executive-overview"] });
      void qc.invalidateQueries({ queryKey: ["enterprise-monitoring"] });
    },
    onError: (err: Error) => {
      setTestResults((prev) => ({ ...prev, _bulk: err.message }));
    },
  });

  const hub = hubQuery.data?.hub ?? EMPTY_INTEGRATIONS_HUB;
  const integrations = hub.integrations;
  const degraded = hubQuery.data?.degraded ?? false;
  const loadWarning = hubQuery.data?.warning;

  const categories = useMemo(
    () => ["all", ...Array.from(new Set(integrations.map((i) => i.category))).sort()],
    [integrations]
  );

  const filtered = useMemo(
    () => (categoryFilter === "all" ? integrations : integrations.filter((i) => i.category === categoryFilter)),
    [integrations, categoryFilter]
  );

  const missingRequired = REQUIRED_INTEGRATION_IDS.filter(
    (id) => !integrations.some((i) => i.id === id)
  );

  return (
    <HQLayout
      title="Integrations Hub"
      subtitle="Build 56 — enterprise connectivity layer with live health, retry, and diagnostics"
      auraModule="integrations"
      auraActions={["ask", "explain", "summarize"]}
    >
      <HqQueryBoundary
        query={hubQuery}
        title="Integrations Hub unavailable"
        message="Connector registry could not be loaded. Retry or check Render environment configuration."
        loadingMessage="Loading integrations…"
        hasRenderableData
      >
        <>
          {degraded && (
            <div className="hq-anomaly-alert hq-sev-medium hq-fade-in" style={{ marginBottom: "1rem" }}>
              <AlertTriangle size={16} />
              <div>
                <strong>Degraded mode</strong>
                <span>
                  {loadWarning ?? "Some integration probes were slow — cards may show partial status. Refresh to retry."}
                </span>
              </div>
            </div>
          )}

          <HqWidgetErrorBoundary label="Integration health dashboard">
            <IntegrationsHealthPanel
              health={healthQuery.data ?? null}
              loading={healthQuery.isLoading && !healthQuery.isFetched}
            />
          </HqWidgetErrorBoundary>

          <div className="hq-kpi-grid hq-fade-in" style={{ marginBottom: "1.25rem" }}>
            <KpiCard
              label="Health Score"
              value={`${hub.summary.healthScore ?? healthQuery.data?.overallHealthScore ?? 0}/100`}
              icon={Activity}
              variant={(hub.summary.healthScore ?? 0) >= 80 ? "success" : (hub.summary.healthScore ?? 0) >= 60 ? "warning" : "danger"}
            />
            <KpiCard label="Connected" value={hub.summary.connected || hub.connectedCount} icon={CheckCircle} variant="success" />
            <KpiCard label="Warning" value={hub.summary.warning ?? 0} icon={AlertTriangle} variant={(hub.summary.warning ?? 0) > 0 ? "warning" : "muted"} />
            <KpiCard label="Offline" value={hub.summary.offline ?? hub.summary.notConfigured} icon={Plug} variant={(hub.summary.offline ?? 0) > 0 ? "danger" : "muted"} />
          </div>

          <div className="hq-sd-toolbar" style={{ marginBottom: "1rem", flexWrap: "wrap", gap: "0.5rem" }}>
            <StatusBadge label="Live production connectors" variant="gold" />
            <button
              type="button"
              className="hq-btn hq-btn-sm hq-btn-secondary"
              disabled={retryDegraded.isPending || hubQuery.isFetching}
              onClick={() => retryDegraded.mutate()}
            >
              <RefreshCw size={14} className={retryDegraded.isPending ? "hq-spin" : ""} />
              {retryDegraded.isPending ? "Retrying…" : "Retry degraded"}
            </button>
            <button
              type="button"
              className="hq-btn hq-btn-sm hq-btn-ghost"
              disabled={hubQuery.isFetching || healthQuery.isFetching}
              onClick={() => {
                void hubQuery.refetch();
                void healthQuery.refetch();
              }}
            >
              <RefreshCw size={14} /> Refresh status
            </button>
            <Link to="/hq/monitoring" className="hq-btn hq-btn-sm hq-btn-ghost">Enterprise Monitoring</Link>
            {testResults._bulk && <StatusBadge label={testResults._bulk} variant="muted" />}
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                className={`hq-btn hq-btn-sm ${categoryFilter === cat ? "hq-btn-primary" : "hq-btn-ghost"}`}
                onClick={() => setCategoryFilter(cat)}
              >
                {cat === "all" ? "All" : cat}
              </button>
            ))}
            <button
              type="button"
              className="hq-btn hq-btn-ghost hq-btn-sm"
              onClick={() => hubQuery.refetch()}
              disabled={hubQuery.isFetching}
            >
              <RefreshCw size={14} className={hubQuery.isFetching ? "hq-spin" : ""} /> Refresh
            </button>
          </div>

          {missingRequired.length > 0 && integrations.length > 0 && (
            <div className="hq-anomaly-alert hq-sev-medium" style={{ marginBottom: "1rem" }}>
              <AlertTriangle size={14} />
              <div>
                <strong>Catalog incomplete</strong>
                <span>Missing cards: {missingRequired.join(", ")}</span>
              </div>
            </div>
          )}

          {integrations.length === 0 ? (
            <IntegrationsHubEmptyState onRetry={() => void hubQuery.refetch()} />
          ) : (
            <HqWidgetErrorBoundary label="Integration connectors">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "1rem" }}>
                {filtered.map((card) => (
                  <IntegrationHubCardView
                    key={card.id}
                    card={card}
                    testMessage={testResults[card.id]}
                    testPending={test.isPending && test.variables === card.id}
                    oauthPending={qbConnect.isPending && card.id === "quickbooks"}
                    onTest={() => test.mutate(card.id)}
                    onOAuth={() => qbConnect.mutate()}
                    onConfigure={() => setConfiguring(card)}
                  />
                ))}
              </div>
            </HqWidgetErrorBoundary>
          )}

          {configuring && (
            <div className="hq-modal-overlay" onClick={() => setConfiguring(null)}>
              <div className="hq-modal" onClick={(e) => e.stopPropagation()}>
                <h3>{configuring.name}</h3>
                <p className="hq-muted-text">
                  Most IFCDC integrations are configured via Render environment variables — not stored in HQ UI.
                </p>
                <ul style={{ fontSize: "0.85rem", paddingLeft: "1.1rem", margin: "0.75rem 0" }}>
                  {configuring.requiredCredentials.map((cred) => (
                    <li key={cred.key} style={{ color: cred.configured ? "var(--hq-success)" : "var(--hq-text-muted)" }}>
                      <code>{cred.key}</code> — {cred.configured ? "configured" : "not set"}
                    </li>
                  ))}
                </ul>
                {configuring.actions.find((a) => a.reason)?.reason && (
                  <p className="hq-muted-text" style={{ fontSize: "0.8rem" }}>
                    {configuring.actions.find((a) => a.reason)?.reason}
                  </p>
                )}
                {configuring.id === "paypal" && (
                  <div style={{ fontSize: "0.82rem", marginTop: "0.75rem", lineHeight: 1.5 }}>
                    <p style={{ margin: "0 0 0.5rem" }}>
                      <strong>PayPal production setup</strong>
                    </p>
                    <ol style={{ margin: 0, paddingLeft: "1.2rem" }}>
                      <li>
                        In Render → <strong>ifcdc-hq</strong> → Environment, set{" "}
                        <code>PAYPAL_CLIENT_ID</code>, <code>PAYPAL_CLIENT_SECRET</code>, and{" "}
                        <code>PAYPAL_ENV=live</code> (or <code>LIVE</code> — both work).
                      </li>
                      <li>Save and redeploy so the service loads the new variables.</li>
                      <li>
                        Register webhook URL in PayPal Developer Dashboard:{" "}
                        <code>https://ifcdc-hq-wst6.onrender.com/api/paypal/webhook-log</code>
                      </li>
                      <li>Click <strong>Test Connection</strong> to verify OAuth and order creation.</li>
                    </ol>
                  </div>
                )}
                {configuring.id === "grants_gov" && (
                  <div style={{ fontSize: "0.82rem", marginTop: "0.75rem", lineHeight: 1.5 }}>
                    <p style={{ margin: "0 0 0.5rem" }}>
                      <strong>Grants.gov — public Applicant API</strong>
                    </p>
                    <p className="hq-muted-text" style={{ margin: 0 }}>
                      IFCDC HQ uses <code>POST /v1/api/search2</code> only. Per the{" "}
                      <a href="https://grants.gov/api/api-guide" target="_blank" rel="noopener noreferrer">
                        official API Guide
                      </a>
                      , <strong>no API key or credentials are required</strong> for search2 or fetchOpportunity.
                      Click <strong>Test Connection</strong> to probe the live public API and sync opportunities.
                    </p>
                  </div>
                )}
                {configuring.id === "twilio" && (
                  <div style={{ fontSize: "0.82rem", marginTop: "0.75rem", lineHeight: 1.5 }}>
                    <p style={{ margin: "0 0 0.5rem" }}>
                      <strong>Twilio + AURA voice setup (+1 331-316-8167)</strong>
                    </p>
                    <ol style={{ margin: 0, paddingLeft: "1.2rem" }}>
                      <li>
                        In Render → <strong>ifcdc-hq</strong> → Environment, set{" "}
                        <code>TWILIO_ACCOUNT_SID</code>, <code>TWILIO_AUTH_TOKEN</code>,{" "}
                        <code>TWILIO_PHONE_NUMBER=+13313168167</code>, and <code>OPENAI_API_KEY</code>.
                      </li>
                      <li>Save and redeploy so the service loads the new variables.</li>
                      <li>
                        In Twilio Console → Phone Numbers → +1 (331) 316-8167, set webhooks:
                        <ul style={{ margin: "0.35rem 0", paddingLeft: "1rem" }}>
                          <li>
                            Voice: <code>https://ifcdc-hq-wst6.onrender.com/api/twilio/aura/voice</code>
                          </li>
                          <li>
                            SMS: <code>https://ifcdc-hq-wst6.onrender.com/api/twilio/aura/sms</code>
                          </li>
                          <li>
                            Status callback:{" "}
                            <code>https://ifcdc-hq-wst6.onrender.com/api/twilio/aura/voice/status</code>
                          </li>
                        </ul>
                      </li>
                      <li>
                        Click <strong>Test Connection</strong> to verify account, number status, and AURA readiness.
                      </li>
                      <li>Call +1 (331) 316-8167 to hear AURA answer live.</li>
                    </ol>
                  </div>
                )}
                {configuring.id === "github" && (
                  <div style={{ fontSize: "0.82rem", marginTop: "0.75rem", lineHeight: 1.5 }}>
                    <p style={{ margin: "0 0 0.5rem" }}>
                      <strong>Setup (one-time)</strong>
                    </p>
                    <ol style={{ margin: 0, paddingLeft: "1.2rem" }}>
                      <li>
                        Create a token at{" "}
                        <a href="https://github.com/settings/tokens/new?scopes=repo" target="_blank" rel="noopener noreferrer">
                          github.com/settings/tokens
                        </a>{" "}
                        (classic <code>repo</code> read, or fine-grained read on <code>IFCDC9/IFCDC</code>).
                      </li>
                      <li>
                        In Render → <strong>ifcdc-hq</strong> → Environment, add{" "}
                        <code>GITHUB_TOKEN</code> = your token (secret).
                      </li>
                      <li>Save — Render redeploys automatically. Return here and click <strong>Test Connection</strong>.</li>
                    </ol>
                    <p className="hq-muted-text" style={{ marginTop: "0.5rem", fontSize: "0.78rem" }}>
                      Note: Render already deploys from GitHub without this token. This only powers HQ Integrations Hub health checks.
                    </p>
                  </div>
                )}
                <div className="hq-modal-actions">
                  {configuring.actions.find((a) => a.id === "render-env" && a.href)?.href && (
                    <a
                      href={configuring.actions.find((a) => a.id === "render-env")!.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hq-btn hq-btn-primary"
                    >
                      Open Render Environment
                    </a>
                  )}
                  <button type="button" className="hq-btn hq-btn-secondary" onClick={() => setConfiguring(null)}>
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      </HqQueryBoundary>
    </HQLayout>
  );
};

export default IntegrationsHubPage;
