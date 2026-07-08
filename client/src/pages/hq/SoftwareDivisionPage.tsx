import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  RefreshCw, ExternalLink, Lock, Monitor, Table2, Stethoscope, Shield, ClipboardList,
  Download, Search, Rocket, Trash2, Pencil,
} from "lucide-react";
import HQLayout from "../../layouts/HQLayout";
import { softwareDivisionApi, exportAppsCsv } from "../../api/softwareDivisionApi";
import { developerApi } from "../../api/developerApi";
import type { SoftwareAppEntry } from "../../api/hqApi";
import { StatusBadge } from "../../components/hq/StatusBadge";
import { HqPanel } from "../../components/hq/HqPanel";
import { HqQueryBoundary } from "../../components/hq/HqQueryBoundary";
import { AppDiagnosticsPanel } from "../../components/hq/AppDiagnosticsPanel";
import { SoftwareDivisionRegisterModal } from "../../components/hq/softwareDivision/SoftwareDivisionRegisterModal";
import { useHqRealtime } from "../../hooks/useHqRealtime";
import { useAuth } from "../../auth/AuthContext";

const TABS = [
  { id: "overview", label: "Overview", icon: Monitor },
  { id: "registry", label: "App Registry", icon: Table2 },
  { id: "diagnostics", label: "Diagnostics", icon: Stethoscope },
  { id: "framework", label: "Integration", icon: Shield },
  { id: "audit", label: "Audit Log", icon: ClipboardList },
] as const;

type TabId = (typeof TABS)[number]["id"];

const STATUS_VARIANT: Record<string, "locked" | "success" | "warning" | "gold" | "muted"> = {
  locked: "locked",
  production: "success",
  mvp: "gold",
  development: "warning",
  planned: "muted",
};

const EMPTY_APPS: SoftwareAppEntry[] = [];

function AppCard({
  app,
  onDiagnostics,
}: {
  app: SoftwareAppEntry;
  onDiagnostics: (id: string, name: string) => void;
}) {
  return (
    <div className={`hq-app-card ${app.health?.healthy ? "hq-app-healthy" : "hq-app-offline"}`}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>
        <div>
          <div className="hq-app-name">{app.name}</div>
          {app.locked && <span className="hq-app-locked-label"><Lock size={12} /> Production Locked</span>}
          {app.registered && <span className="hq-app-registered-label">HQ Registered {app.apiKeyPrefix && `· ${app.apiKeyPrefix}`}</span>}
        </div>
        <StatusBadge label={app.health?.healthy ? "Healthy" : "Offline"} variant={app.health?.healthy ? "success" : "danger"} pulse={app.health?.healthy} />
      </div>
      <p className="hq-app-desc">{app.description}</p>
      <div className="hq-app-meta">
        <StatusBadge label={app.status} variant={STATUS_VARIANT[app.status] ?? "muted"} />
        <span className="hq-app-meta-item">v{app.version ?? "1.0.0"}</span>
        {app.health && <span className="hq-app-meta-item">{app.health.latencyMs}ms</span>}
      </div>
      {app.health?.error && <div className="hq-app-error">{app.health.error}</div>}
      <div className="hq-app-actions">
        <button type="button" className="hq-btn hq-btn-secondary hq-btn-sm" onClick={() => onDiagnostics(app.id, app.name)}>
          <Stethoscope size={14} /> Diagnostics
        </button>
        {app.launchUrl && !app.locked && (
          <a href={app.launchUrl} target="_blank" rel="noopener noreferrer" className="hq-btn hq-btn-ghost hq-btn-sm">
            Open <ExternalLink size={12} />
          </a>
        )}
      </div>
    </div>
  );
}

const SoftwareDivisionPage: React.FC = () => {
  const [tab, setTab] = useState<TabId>("overview");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [registerOpen, setRegisterOpen] = useState(false);
  const [diagnosticsApp, setDiagnosticsApp] = useState<{ id: string; name: string } | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editStatus, setEditStatus] = useState("development");
  const { connected } = useHqRealtime();
  const { user } = useAuth();
  const qc = useQueryClient();
  const canWrite = ["owner", "founder", "executive", "administrator", "admin"].includes(String(user?.role ?? "").toLowerCase());

  const overview = useQuery({
    queryKey: ["hq-software-division"],
    queryFn: async () => {
      try {
        return { payload: await softwareDivisionApi.overview(), degraded: false, warning: null as string | null };
      } catch (e) {
        return {
          payload: { apps: EMPTY_APPS, timestamp: new Date().toISOString(), degraded: true },
          degraded: true,
          warning: e instanceof Error ? e.message : "Software Division API unavailable",
        };
      }
    },
    placeholderData: { payload: { apps: EMPTY_APPS, timestamp: new Date().toISOString() }, degraded: false, warning: null },
    staleTime: 30_000,
    retry: 0,
  });

  const framework = useQuery({
    queryKey: ["hq-software-division-framework"],
    queryFn: () => softwareDivisionApi.framework(),
    staleTime: 120_000,
    enabled: tab === "framework",
  });

  const allDiag = useQuery({
    queryKey: ["hq-software-all-diagnostics"],
    queryFn: () => softwareDivisionApi.allDiagnostics(),
    enabled: tab === "diagnostics",
    retry: 0,
  });

  const audit = useQuery({
    queryKey: ["hq-software-audit"],
    queryFn: () => developerApi.auditLog(100),
    enabled: tab === "audit",
  });

  const updateApp = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => softwareDivisionApi.updateApp(id, { status }),
    onSuccess: () => {
      setEditId(null);
      void qc.invalidateQueries({ queryKey: ["hq-software-division"] });
    },
  });

  const deleteApp = useMutation({
    mutationFn: (id: string) => softwareDivisionApi.deleteApp(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["hq-software-division"] }),
  });

  const rotateKey = useMutation({
    mutationFn: (id: string) => developerApi.rotateKey(id),
  });

  const apps = overview.data?.payload.apps ?? EMPTY_APPS;
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return apps.filter((a) => {
      if (statusFilter !== "all" && a.status !== statusFilter) return false;
      if (!q) return true;
      return a.name.toLowerCase().includes(q) || a.id.toLowerCase().includes(q);
    });
  }, [apps, search, statusFilter]);

  const healthy = apps.filter((a) => a.health?.healthy).length;
  const total = apps.length;
  const registered = apps.filter((a) => a.registered).length;

  const exportCsv = () => {
    const blob = new Blob([exportAppsCsv(filtered)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ifcdc-software-division-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <HQLayout title="Software Division" subtitle="Enterprise app registry, health monitoring, and integration framework" auraModule="software" auraActions={["ask", "summarize", "explain"]}>
      <div className="hq-sd-toolbar">
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          <StatusBadge label={`${healthy} / ${total} healthy`} variant={healthy === total && total > 0 ? "success" : "warning"} pulse />
          <StatusBadge label={`${registered} registered`} variant="gold" />
          <StatusBadge label="Barbers: Production Locked" variant="locked" />
          {connected && <StatusBadge label="Live monitoring" variant="success" pulse />}
        </div>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {canWrite && (
            <button type="button" className="hq-btn hq-btn-primary hq-btn-sm" onClick={() => setRegisterOpen(true)}>
              <Rocket size={14} /> Register App
            </button>
          )}
          <Link to="/hq/developer" className="hq-btn hq-btn-secondary hq-btn-sm">Developer Portal</Link>
          <button type="button" className="hq-btn hq-btn-secondary hq-btn-sm" onClick={() => void overview.refetch()} disabled={overview.isFetching}>
            <RefreshCw size={14} className={overview.isFetching ? "hq-spinner" : ""} />
            {overview.isFetching ? "Checking…" : "Refresh Health"}
          </button>
        </div>
      </div>

      <div className="hq-tabs">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.id} type="button" className={`hq-tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
              <Icon size={14} style={{ marginRight: "0.35rem", verticalAlign: "middle" }} />
              {t.label}
            </button>
          );
        })}
      </div>

      {overview.data?.degraded && (
        <div className="hq-panel hq-mb-md" style={{ borderColor: "var(--hq-warning)", padding: "0.85rem 1rem" }}>
          <strong style={{ color: "var(--hq-gold)" }}>Live health polling unavailable</strong>
          <p className="hq-muted-text" style={{ margin: "0.25rem 0 0", fontSize: "0.82rem" }}>
            {overview.data.warning ?? "Showing registry with empty health — retry refresh or check Render env URLs."}
          </p>
        </div>
      )}

      <HqQueryBoundary query={overview} hasRenderableData title="Software Division unavailable" loadingMessage="Loading Software Division…">
        {tab === "overview" && (
          <div className="hq-fade-in">
            {total === 0 ? (
              <HqPanel title="No applications in registry">
                <p className="hq-muted-text">Register an app or verify the Software Division API connection.</p>
              </HqPanel>
            ) : (
              <div className="hq-app-grid">
                {apps.map((app) => (
                  <AppCard key={app.id} app={app} onDiagnostics={(id, name) => setDiagnosticsApp({ id, name })} />
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "registry" && (
          <div className="hq-fade-in">
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
              <div style={{ position: "relative", flex: "1 1 200px" }}>
                <Search size={14} style={{ position: "absolute", left: 10, top: 10, opacity: 0.5 }} />
                <input className="hq-input" style={{ paddingLeft: 32 }} placeholder="Search apps…" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <select className="hq-input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="all">All statuses</option>
                <option value="production">Production</option>
                <option value="mvp">MVP</option>
                <option value="development">Development</option>
                <option value="locked">Locked</option>
                <option value="planned">Planned</option>
              </select>
              <button type="button" className="hq-btn hq-btn-secondary hq-btn-sm" onClick={exportCsv}>
                <Download size={14} /> Export CSV
              </button>
            </div>
            <HqPanel title="Application Registry" subtitle={`${filtered.length} of ${total} applications`}>
              <table className="hq-table hq-table-compact">
                <thead>
                  <tr>
                    <th>App</th><th>Status</th><th>Health</th><th>Latency</th><th>Registered</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((app) => (
                    <tr key={app.id}>
                      <td><strong>{app.name}</strong><div className="hq-muted-text" style={{ fontSize: "0.75rem" }}>{app.id}</div></td>
                      <td><StatusBadge label={app.status} variant={STATUS_VARIANT[app.status] ?? "muted"} /></td>
                      <td><StatusBadge label={app.health?.healthy ? "Online" : "Offline"} variant={app.health?.healthy ? "success" : "danger"} /></td>
                      <td>{app.health?.latencyMs != null ? `${app.health.latencyMs}ms` : "—"}</td>
                      <td>{app.registered ? "Yes" : "No"}</td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <button type="button" className="hq-btn hq-btn-ghost hq-btn-sm" onClick={() => setDiagnosticsApp({ id: app.id, name: app.name })}>Diag</button>
                        {app.registered && canWrite && !app.locked && (
                          <>
                            <button type="button" className="hq-btn hq-btn-ghost hq-btn-sm" onClick={() => { setEditId(app.id); setEditStatus(app.status); }} title="Edit status"><Pencil size={12} /></button>
                            <button type="button" className="hq-btn hq-btn-ghost hq-btn-sm" onClick={() => rotateKey.mutate(app.id)} title="Rotate API key">Key</button>
                            <button type="button" className="hq-btn hq-btn-ghost hq-btn-sm" onClick={() => { if (confirm(`Remove ${app.name} from HQ registry?`)) deleteApp.mutate(app.id); }} title="Delete"><Trash2 size={12} /></button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && <tr><td colSpan={6} className="hq-muted-text">No apps match your filters.</td></tr>}
                </tbody>
              </table>
            </HqPanel>
            {editId && canWrite && (
              <HqPanel title={`Edit status — ${editId}`} className="hq-mt-md">
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <select className="hq-input" value={editStatus} onChange={(e) => setEditStatus(e.target.value)}>
                    <option value="development">development</option>
                    <option value="mvp">mvp</option>
                    <option value="production">production</option>
                    <option value="planned">planned</option>
                  </select>
                  <button type="button" className="hq-btn hq-btn-primary hq-btn-sm" disabled={updateApp.isPending} onClick={() => updateApp.mutate({ id: editId, status: editStatus })}>Save</button>
                  <button type="button" className="hq-btn hq-btn-secondary hq-btn-sm" onClick={() => setEditId(null)}>Cancel</button>
                </div>
                {updateApp.isError && <p style={{ color: "#ef4444", fontSize: "0.85rem" }}>{(updateApp.error as Error).message}</p>}
              </HqPanel>
            )}
            {rotateKey.data && (
              <HqPanel title="New API key" className="hq-mt-md">
                <code style={{ wordBreak: "break-all" }}>{rotateKey.data.apiKey}</code>
                <p className="hq-muted-text" style={{ fontSize: "0.8rem" }}>{rotateKey.data.warning}</p>
              </HqPanel>
            )}
          </div>
        )}

        {tab === "diagnostics" && (
          <HqQueryBoundary query={allDiag} title="Diagnostics unavailable" loadingMessage="Running diagnostics…">
            {allDiag.data && (
              <HqPanel title="All Application Diagnostics" subtitle={`${allDiag.data.diagnostics.length} apps scanned`}>
                <table className="hq-table">
                  <thead><tr><th>App</th><th>Overall</th><th>Health</th><th>Latency</th><th>Registered</th><th></th></tr></thead>
                  <tbody>
                    {allDiag.data.diagnostics.map((d) => (
                      <tr key={d.appId}>
                        <td>{d.appName}</td>
                        <td><StatusBadge label={d.overall} variant={d.overall === "healthy" ? "success" : d.overall === "degraded" ? "warning" : "danger"} /></td>
                        <td>{d.health.healthy ? "Online" : "Offline"}</td>
                        <td>{d.health.latencyMs}ms</td>
                        <td>{d.deployment.registered ? "Yes" : "No"}</td>
                        <td><button type="button" className="hq-btn hq-btn-ghost hq-btn-sm" onClick={() => setDiagnosticsApp({ id: d.appId, name: d.appName })}>Details</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </HqPanel>
            )}
          </HqQueryBoundary>
        )}

        {tab === "framework" && (
          <HqQueryBoundary query={framework} title="Framework unavailable" loadingMessage="Loading integration framework…">
            {framework.data && (
              <HqPanel title="Enterprise Integration Framework" subtitle={`Framework v${framework.data.version}`}>
                <div className="hq-framework-service-grid">
                  {framework.data.inheritedServices.map((svc) => (
                    <div key={svc.id} className="hq-framework-service-card">
                      <div className="hq-framework-service-name">{svc.name}</div>
                      <code className="hq-framework-endpoint">{svc.endpoint}</code>
                    </div>
                  ))}
                </div>
              </HqPanel>
            )}
          </HqQueryBoundary>
        )}

        {tab === "audit" && (
          <HqQueryBoundary query={audit} title="Audit log unavailable" loadingMessage="Loading audit log…">
            {audit.data && (
              <HqPanel title="Developer & Software Division Audit" subtitle="Registration, key rotation, and validation events">
                <table className="hq-table hq-table-compact">
                  <thead><tr><th>When</th><th>App</th><th>Event</th><th>Actor</th><th>Detail</th></tr></thead>
                  <tbody>
                    {audit.data.entries.map((e) => (
                      <tr key={e.id}>
                        <td>{new Date(e.createdAt).toLocaleString()}</td>
                        <td>{e.appId ?? "—"}</td>
                        <td><StatusBadge label={e.eventType} variant={e.severity === "critical" ? "danger" : e.severity === "warning" ? "warning" : "muted"} /></td>
                        <td>{e.actorEmail ?? "—"}</td>
                        <td style={{ maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis" }}>{e.detail}</td>
                      </tr>
                    ))}
                    {audit.data.entries.length === 0 && <tr><td colSpan={5} className="hq-muted-text">No audit events yet.</td></tr>}
                  </tbody>
                </table>
              </HqPanel>
            )}
          </HqQueryBoundary>
        )}
      </HqQueryBoundary>

      {registerOpen && <SoftwareDivisionRegisterModal onClose={() => setRegisterOpen(false)} />}
      {diagnosticsApp && (
        <AppDiagnosticsPanel appId={diagnosticsApp.id} appName={diagnosticsApp.name} onClose={() => setDiagnosticsApp(null)} />
      )}
    </HQLayout>
  );
};

export default SoftwareDivisionPage;
