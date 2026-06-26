import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, ExternalLink, Lock, ChevronDown, ChevronUp, Plug, Shield, Rocket, Stethoscope } from "lucide-react";
import HQLayout from "../../layouts/HQLayout";
import { hqApi } from "../../api/hqApi";
import { StatusBadge } from "../../components/hq/StatusBadge";
import { HqLoading } from "../../components/hq/HqLoading";
import { HqPanel } from "../../components/hq/HqPanel";
import { AppDiagnosticsPanel } from "../../components/hq/AppDiagnosticsPanel";
import { useHqRealtime } from "../../hooks/useHqRealtime";

const STATUS_VARIANT: Record<string, "locked" | "success" | "warning" | "gold" | "muted"> = {
  locked: "locked",
  production: "success",
  mvp: "gold",
  development: "warning",
  planned: "muted",
};

const SoftwareDivisionPage: React.FC = () => {
  const [frameworkOpen, setFrameworkOpen] = useState(false);
  const [diagnosticsApp, setDiagnosticsApp] = useState<{ id: string; name: string } | null>(null);
  const { connected } = useHqRealtime();

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["hq-software-division"],
    queryFn: hqApi.softwareDivision,
    staleTime: 60_000,
  });

  const framework = useQuery({
    queryKey: ["hq-software-division-framework"],
    queryFn: hqApi.softwareDivisionFramework,
    staleTime: 120_000,
  });

  const healthy = data?.apps.filter((a) => a.health?.healthy).length ?? 0;
  const total = data?.apps.length ?? 0;
  const registered = data?.apps.filter((a) => a.registered).length ?? 0;

  return (
    <HQLayout title="Software Division" subtitle="Health monitoring, deployment diagnostics, and enterprise app registry">
      <div className="hq-sd-toolbar">
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          <StatusBadge label={`${healthy} / ${total} healthy`} variant={healthy === total ? "success" : "warning"} pulse />
          <StatusBadge label={`${registered} registered`} variant="gold" />
          <StatusBadge label="Barbers: Production Locked" variant="locked" />
          {connected && <StatusBadge label="Live monitoring" variant="success" pulse />}
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <Link to="/hq/developer" className="hq-btn hq-btn-primary hq-btn-sm">
            <Rocket size={14} /> Register App
          </Link>
          <button type="button" className="hq-btn hq-btn-secondary hq-btn-sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw size={14} className={isFetching ? "hq-spinner" : ""} />
            {isFetching ? "Checking…" : "Refresh All Health"}
          </button>
        </div>
      </div>

      {isLoading && <HqLoading message="Polling application health…" />}
      {error && <div style={{ color: "#ef4444" }}>{(error as Error).message}</div>}

      {data && (
        <div className="hq-app-grid">
          {data.apps.map((app) => (
            <div key={app.id} className={`hq-app-card ${app.health?.healthy ? "hq-app-healthy" : "hq-app-offline"}`}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>
                <div>
                  <div className="hq-app-name">{app.name}</div>
                  {app.locked && (
                    <span className="hq-app-locked-label">
                      <Lock size={12} /> Production Locked
                    </span>
                  )}
                  {app.registered && (
                    <span className="hq-app-registered-label">
                      <Plug size={12} /> HQ Registered {app.apiKeyPrefix && `· ${app.apiKeyPrefix}`}
                    </span>
                  )}
                </div>
                <StatusBadge
                  label={app.health?.healthy ? "Healthy" : "Offline"}
                  variant={app.health?.healthy ? "success" : "danger"}
                  pulse={app.health?.healthy}
                />
              </div>

              <p className="hq-app-desc">{app.description}</p>

              <div className="hq-app-meta">
                <StatusBadge label={app.status} variant={STATUS_VARIANT[app.status] ?? "muted"} />
                <span className="hq-app-meta-item">v{app.version ?? "1.0.0"}</span>
                {app.health && <span className="hq-app-meta-item">{app.health.latencyMs}ms</span>}
                {(app.health as { deployment?: string })?.deployment && (
                  <span className="hq-app-meta-item">{(app.health as { deployment?: string }).deployment}</span>
                )}
              </div>

              {app.health?.error && (
                <div className="hq-app-error">{app.health.error}</div>
              )}

              <div className="hq-app-actions">
                <button type="button" className="hq-btn hq-btn-secondary hq-btn-sm" onClick={() => setDiagnosticsApp({ id: app.id, name: app.name })}>
                  <Stethoscope size={14} /> Diagnostics
                </button>
                {app.launchUrl && !app.locked && (
                  <a href={app.launchUrl} target="_blank" rel="noopener noreferrer" className="hq-btn hq-btn-ghost hq-btn-sm">
                    Open <ExternalLink size={12} />
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <HqPanel title="Enterprise Integration Framework" subtitle="Every IFCDC app inherits HQ services" className="hq-mt-panel">
        <button type="button" className="hq-framework-toggle" onClick={() => setFrameworkOpen(!frameworkOpen)} aria-expanded={frameworkOpen}>
          <Shield size={16} />
          <span>Framework v{framework.data?.version ?? "2.1"} — {framework.data?.inheritedServices.length ?? 9} inherited services</span>
          {frameworkOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        {frameworkOpen && framework.data && (
          <div className="hq-framework-panel hq-fade-in">
            <div className="hq-framework-service-grid">
              {framework.data.inheritedServices.map((svc) => (
                <div key={svc.id} className="hq-framework-service-card">
                  <div className="hq-framework-service-name">{svc.name}</div>
                  <code className="hq-framework-endpoint">{svc.endpoint}</code>
                </div>
              ))}
            </div>
          </div>
        )}
      </HqPanel>

      {diagnosticsApp && (
        <AppDiagnosticsPanel
          appId={diagnosticsApp.id}
          appName={diagnosticsApp.name}
          onClose={() => setDiagnosticsApp(null)}
        />
      )}
    </HQLayout>
  );
};

export default SoftwareDivisionPage;
