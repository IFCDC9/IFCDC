import React, { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ExternalLink, Lock, Rocket, Shield, RefreshCw } from "lucide-react";
import HQLayout from "../../layouts/HQLayout";
import { ssoApi, type SsoApp } from "../../api/ssoApi";
import { HqPanel } from "../../components/hq/HqPanel";
import { HqLoading } from "../../components/hq/HqLoading";
import { StatusBadge } from "../../components/hq/StatusBadge";
import { useHqRealtime } from "../../hooks/useHqRealtime";

const STATUS_VARIANT: Record<SsoApp["status"], "locked" | "success" | "warning" | "gold" | "muted"> = {
  "production-locked": "locked",
  production: "success",
  beta: "gold",
  development: "warning",
};

function canLaunchApp(app: SsoApp): boolean {
  if (app.status === "production-locked") return false;
  if (app.status === "development" && !app.launchPath.startsWith("http")) return false;
  return true;
}

const SsoGatewayPage: React.FC = () => {
  const { connected } = useHqRealtime();
  const [launching, setLaunching] = useState<string | null>(null);

  const apps = useQuery({ queryKey: ["hq-sso-apps"], queryFn: ssoApi.apps, staleTime: 60_000 });
  const manifest = useQuery({ queryKey: ["hq-sso-manifest"], queryFn: ssoApi.manifest, staleTime: 120_000 });

  const launch = useMutation({
    mutationFn: (appId: string) => ssoApi.launch(appId),
    onSuccess: (data) => {
      window.open(data.launchUrl, "_blank", "noopener,noreferrer");
    },
    onSettled: () => setLaunching(null),
  });

  const handleLaunch = (app: SsoApp) => {
    if (!canLaunchApp(app)) return;
    setLaunching(app.id);
    launch.mutate(app.id);
  };

  return (
    <HQLayout
      title="SSO Gateway"
      subtitle="Single sign-on hub — one secure IFCDC account for every application"
    >
      <div className="hq-sd-toolbar" style={{ marginBottom: "1.25rem" }}>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          <StatusBadge label="Headquarters Auth Hub" variant="gold" />
          <StatusBadge label={`${apps.data?.apps.length ?? 0} apps available`} variant="success" />
          {connected && <StatusBadge label="Live session" variant="success" pulse />}
        </div>
        <button type="button" className="hq-btn hq-btn-ghost hq-btn-sm" onClick={() => apps.refetch()} disabled={apps.isFetching}>
          <RefreshCw size={14} className={apps.isFetching ? "hq-spin" : ""} /> Refresh
        </button>
      </div>

      <HqPanel title="Connected Applications" subtitle="Launch any IFCDC application with your Headquarters credentials">
        {apps.isLoading ? <HqLoading /> : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "1rem" }}>
            {(apps.data?.apps ?? []).map((app) => {
              const launchable = canLaunchApp(app);
              return (
              <div key={app.id} className="hq-panel" style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem" }}>
                  <div>
                    <h4 style={{ margin: 0, fontSize: "0.95rem", color: "var(--hq-gold)" }}>{app.name}</h4>
                    <p style={{ margin: "0.35rem 0 0", fontSize: "0.78rem", color: "var(--hq-text-muted)", lineHeight: 1.4 }}>
                      {app.description}
                    </p>
                  </div>
                  <StatusBadge
                    label={app.status === "production-locked" ? "Locked" : app.status === "beta" ? "Beta" : app.status.replace(/-/g, " ")}
                    variant={STATUS_VARIANT[app.status]}
                  />
                </div>
                <div style={{ marginTop: "auto", display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <button
                    type="button"
                    className="hq-btn hq-btn-primary hq-btn-sm"
                    disabled={!launchable || launching === app.id || launch.isPending}
                    onClick={() => handleLaunch(app)}
                  >
                    {app.status === "production-locked" ? <Lock size={14} /> : <Rocket size={14} />}
                    {launching === app.id ? "Launching…" : launchable ? "Launch App" : "Configure URL"}
                  </button>
                  {app.launchPath.startsWith("http") && (
                    <a href={app.launchPath} target="_blank" rel="noopener noreferrer" className="hq-btn hq-btn-ghost hq-btn-sm" title="Open app URL">
                      <ExternalLink size={14} />
                    </a>
                  )}
                  <span className="hq-muted-text" style={{ fontSize: "0.72rem" }}>{app.launchPath}</span>
                </div>
              </div>
            );})}
            {!apps.data?.apps.length && (
              <p className="hq-muted-text">No applications available for your role.</p>
            )}
          </div>
        )}
      </HqPanel>

      <HqPanel title="Integration Manifest" subtitle="Endpoints for connected apps and the Developer Portal">
        {manifest.isLoading ? <HqLoading /> : (
          <div style={{ fontSize: "0.82rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem" }}>
              <Shield size={16} style={{ color: "var(--hq-gold)" }} />
              <strong>{String(manifest.data?.gateway ?? "IFCDC Headquarters SSO")}</strong>
              <span className="hq-muted-text">v{String(manifest.data?.version ?? "1.0")}</span>
            </div>
            <table className="hq-table">
              <thead><tr><th>Endpoint</th><th>Path</th></tr></thead>
              <tbody>
                {Object.entries((manifest.data?.endpoints as Record<string, string>) ?? {}).map(([key, path]) => (
                  <tr key={key}>
                    <td>{key}</td>
                    <td><code>{path}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="hq-muted-text" style={{ marginTop: "1rem" }}>
              IFCDC division apps authenticate through Headquarters SSO. On launch, HQ appends <code>?sso_token=…</code> to the target URL.
              External apps should set <code>HQ_*_LAUNCH_URL</code> environment variables on Render. Apps call <code>POST /api/hq/auth/sso/exchange</code> to establish a session.
            </p>
            <p className="hq-muted-text" style={{ marginTop: "0.5rem" }}>
              <strong>Barbers App</strong> remains production-locked and is not modified by HQ SSO changes.
            </p>
          </div>
        )}
      </HqPanel>
    </HQLayout>
  );
};

export default SsoGatewayPage;
