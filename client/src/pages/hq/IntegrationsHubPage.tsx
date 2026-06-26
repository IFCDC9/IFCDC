import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plug, RefreshCw, CheckCircle, Settings } from "lucide-react";
import HQLayout from "../../layouts/HQLayout";
import { integrationsApi } from "../../api/integrationsApi";
import { HqLoading } from "../../components/hq/HqLoading";
import { StatusBadge } from "../../components/hq/StatusBadge";
import { KpiCard } from "../../components/hq/KpiCard";

const STATUS_VARIANT: Record<string, "success" | "warning" | "muted" | "gold"> = {
  configured: "success",
  connected: "success",
  coming_soon: "muted",
  available: "gold",
  disconnected: "warning",
};

const IntegrationsHubPage: React.FC = () => {
  const qc = useQueryClient();
  const [configuring, setConfiguring] = useState<string | null>(null);
  const [configForm, setConfigForm] = useState<Record<string, string>>({});

  const hub = useQuery({ queryKey: ["integrations-hub"], queryFn: integrationsApi.hub, staleTime: 60_000 });

  const configure = useMutation({
    mutationFn: ({ provider, config }: { provider: string; config: Record<string, string> }) =>
      integrationsApi.configure(provider, config, true),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["integrations-hub"] });
      setConfiguring(null);
      setConfigForm({});
    },
  });

  const test = useMutation({
    mutationFn: integrationsApi.test,
  });

  const catalog = hub.data?.catalog ?? [];
  const connections = hub.data?.connections ?? [];

  const connectionFor = (id: string) =>
    connections.find((c) => (c as { provider?: string }).provider === id);

  return (
    <HQLayout
      title="Integrations Hub"
      subtitle="Connect Microsoft 365, Google Workspace, QuickBooks, payroll, banking, grants, and CRM systems"
    >
      <div className="hq-kpi-grid hq-fade-in" style={{ marginBottom: "1.25rem" }}>
        <KpiCard label="Available Connectors" value={catalog.length} icon={Plug} variant="gold" />
        <KpiCard label="Connected" value={hub.data?.connectedCount ?? 0} icon={CheckCircle} />
        <KpiCard label="Categories" value={new Set(catalog.map((c) => c.category)).size} icon={Settings} />
      </div>

      <div className="hq-sd-toolbar" style={{ marginBottom: "1rem" }}>
        <StatusBadge label="Enterprise API v1 available at /api/hq/v1" variant="gold" />
        <button type="button" className="hq-btn hq-btn-ghost hq-btn-sm" onClick={() => hub.refetch()} disabled={hub.isFetching}>
          <RefreshCw size={14} className={hub.isFetching ? "hq-spin" : ""} /> Refresh
        </button>
      </div>

      {hub.isLoading ? <HqLoading /> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "1rem" }}>
          {catalog.map((item) => {
            const conn = connectionFor(item.id);
            const connStatus = (conn as { status?: string })?.status ?? item.status;
            return (
              <div key={item.id} className="hq-panel" style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <h4 style={{ margin: 0, fontSize: "0.95rem", color: "var(--hq-gold)" }}>{item.name}</h4>
                    <div className="hq-muted-text" style={{ fontSize: "0.72rem", marginTop: "0.2rem" }}>{item.category}</div>
                  </div>
                  <StatusBadge label={connStatus.replace(/_/g, " ")} variant={STATUS_VARIANT[connStatus] ?? "muted"} />
                </div>
                <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--hq-text-muted)", lineHeight: 1.45 }}>{item.description}</p>
                <div style={{ marginTop: "auto", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                  {item.id === "quickbooks" ? (
                    <>
                      <button type="button" className="hq-btn hq-btn-sm hq-btn-primary" disabled={qbConnect.isPending} onClick={() => integrationsApi.quickBooksConnect().then((d) => { if (d.authUrl) window.location.href = d.authUrl; }).catch((e) => alert(e.message))}>
                        Connect OAuth
                      </button>
                      <button type="button" className="hq-btn hq-btn-sm hq-btn-ghost" disabled={test.isPending} onClick={() => test.mutate(item.id)}>
                        Test Connection
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="hq-btn hq-btn-sm hq-btn-primary" onClick={() => { setConfiguring(item.id); setConfigForm({}); }}>
                        <Settings size={14} /> Configure
                      </button>
                      <button type="button" className="hq-btn hq-btn-sm hq-btn-ghost" disabled={test.isPending} onClick={() => test.mutate(item.id)}>
                        Test Connection
                      </button>
                    </>
                  )}
                </div>
                {test.data && test.variables === item.id && (
                  <p style={{ fontSize: "0.75rem", margin: 0, color: test.data.success ? "var(--hq-success)" : "var(--hq-warning)" }}>
                    {test.data.message}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {configuring && (
        <div className="hq-modal-overlay" onClick={() => setConfiguring(null)}>
          <div className="hq-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Configure {catalog.find((c) => c.id === configuring)?.name}</h3>
            <p className="hq-muted-text">Credentials are stored securely in HQ. Connectors are stubs until external OAuth is configured.</p>
            <div className="hq-form-grid">
              {(catalog.find((c) => c.id === configuring)?.configFields ?? []).map((field) => (
                <label key={field}>
                  {field.replace(/_/g, " ")}
                  <input
                    type={field.includes("secret") || field.includes("token") || field.includes("key") ? "password" : "text"}
                    value={configForm[field] ?? ""}
                    onChange={(e) => setConfigForm({ ...configForm, [field]: e.target.value })}
                  />
                </label>
              ))}
            </div>
            <div className="hq-modal-actions">
              <button type="button" className="hq-btn hq-btn-secondary" onClick={() => setConfiguring(null)}>Cancel</button>
              <button
                type="button"
                className="hq-btn hq-btn-primary"
                disabled={configure.isPending}
                onClick={() => configure.mutate({ provider: configuring, config: configForm })}
              >
                {configure.isPending ? "Saving…" : "Save Configuration"}
              </button>
            </div>
          </div>
        </div>
      )}
    </HQLayout>
  );
};

export default IntegrationsHubPage;
