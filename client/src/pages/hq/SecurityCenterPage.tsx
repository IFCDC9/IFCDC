import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Shield, Lock, Activity, Database, RefreshCw, Smartphone, Monitor, AlertTriangle } from "lucide-react";
import HQLayout from "../../layouts/HQLayout";
import { securityApi } from "../../api/securityApi";
import { authApi } from "../../api/authApi.ts";
import { KpiCard } from "../../components/hq/KpiCard";
import { HqPanel } from "../../components/hq/HqPanel";
import { HqLoading } from "../../components/hq/HqLoading";
import { StatusBadge } from "../../components/hq/StatusBadge";
import { formatDateTime } from "../../utils/safeFormat";

type Tab = "overview" | "mfa" | "sessions" | "logins" | "threats" | "backup";

const SecurityCenterPage: React.FC = () => {
  const [tab, setTab] = useState<Tab>("overview");
  const [auditLimit, setAuditLimit] = useState(50);
  const [mfaCode, setMfaCode] = useState("");
  const [qrCode, setQrCode] = useState<string | null>(null);
  const qc = useQueryClient();

  const dashboard = useQuery({ queryKey: ["security-dashboard"], queryFn: securityApi.dashboard, staleTime: 60_000 });
  const audit = useQuery({ queryKey: ["security-audit", auditLimit], queryFn: () => securityApi.audit(auditLimit), staleTime: 30_000 });
  const activity = useQuery({ queryKey: ["security-activity"], queryFn: () => securityApi.activity(30) });
  const logins = useQuery({ queryKey: ["security-logins"], queryFn: () => securityApi.loginHistory(40), enabled: tab === "logins" || tab === "overview" });
  const sessions = useQuery({ queryKey: ["security-sessions"], queryFn: () => securityApi.sessions(30), enabled: tab === "sessions" || tab === "overview" });
  const devices = useQuery({ queryKey: ["security-devices"], queryFn: () => securityApi.devices(20), enabled: tab === "sessions" });
  const threats = useQuery({ queryKey: ["security-threats"], queryFn: securityApi.threats, enabled: tab === "threats" || tab === "overview" });
  const restorePoints = useQuery({ queryKey: ["security-restore-points"], queryFn: () => securityApi.restorePoints(15), enabled: tab === "backup" || tab === "overview" });
  const mfaStatus = useQuery({ queryKey: ["mfa-status"], queryFn: authApi.mfaStatus, enabled: tab === "mfa" });

  const mfaSetup = useMutation({
    mutationFn: authApi.mfaSetup,
    onSuccess: (data) => setQrCode(data.qrCode),
  });
  const mfaVerify = useMutation({
    mutationFn: () => authApi.mfaVerify(mfaCode),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["mfa-status"] }); qc.invalidateQueries({ queryKey: ["security-dashboard"] }); setQrCode(null); setMfaCode(""); },
  });
  const createBackup = useMutation({
    mutationFn: securityApi.createBackup,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["security-restore-points"] }); qc.invalidateQueries({ queryKey: ["security-dashboard"] }); },
  });
  const revokeSession = useMutation({
    mutationFn: securityApi.revokeSession,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["security-sessions"] }),
  });

  const data = dashboard.data;
  const backup = data?.backup as { status?: string; message?: string; lastBackup?: { createdAt?: string; filename?: string } } | undefined;

  return (
    <HQLayout title="Enterprise Security Center" subtitle="MFA, sessions, audit logs, threat monitoring, and database backups">
      <div className="hq-sd-toolbar" style={{ marginBottom: "1rem" }}>
        <StatusBadge label="SSO Enabled" variant="success" />
        <button type="button" className="hq-btn hq-btn-ghost hq-btn-sm" onClick={() => dashboard.refetch()} disabled={dashboard.isFetching}>
          <RefreshCw size={14} className={dashboard.isFetching ? "hq-spin" : ""} /> Refresh
        </button>
      </div>

      <nav className="hq-tabs" style={{ marginBottom: "1.25rem" }}>
        {([
          ["overview", "Overview"],
          ["mfa", "MFA"],
          ["sessions", "Sessions & Devices"],
          ["logins", "Login History"],
          ["threats", "Threat Monitor"],
          ["backup", "Backups"],
        ] as [Tab, string][]).map(([id, label]) => (
          <button key={id} type="button" className={`hq-tab ${tab === id ? "active" : ""}`} onClick={() => setTab(id)}>{label}</button>
        ))}
      </nav>

      {dashboard.isLoading && tab === "overview" ? <HqLoading /> : data && tab === "overview" && (
        <>
          <div className="hq-kpi-grid hq-fade-in" style={{ marginBottom: "1.25rem" }}>
            <KpiCard label="Security Score" value={`${data.securityScore}%`} icon={Shield} variant="gold" />
            <KpiCard label="Active Sessions" value={(data.sessions as { activeSessionCount?: number }).activeSessionCount ?? 0} icon={Monitor} />
            <KpiCard label="Audit Events (24h)" value={data.audit.last24h} icon={Database} />
            <KpiCard label="Failed Logins (24h)" value={threats.data?.failedLogins24h ?? 0} icon={AlertTriangle} variant={(threats.data?.failedLogins24h ?? 0) > 5 ? "warning" : "muted"} />
          </div>
          <div className="hq-grid-2 hq-fade-in" style={{ marginBottom: "1.25rem" }}>
            <HqPanel title="MFA Compliance" subtitle="Founder, Executive, and Administrator accounts">
              <StatusBadge label={data.mfa.status.replace(/_/g, " ")} variant={data.mfa.status === "compliant" ? "success" : "warning"} />
              <p className="hq-muted-text" style={{ marginTop: "0.75rem" }}>{data.mfa.message}</p>
              <button type="button" className="hq-btn hq-btn-sm hq-btn-secondary" style={{ marginTop: "0.5rem" }} onClick={() => setTab("mfa")}>Configure MFA</button>
            </HqPanel>
            <HqPanel title="Backup Health" subtitle={backup?.status ?? "—"}>
              <p className="hq-muted-text">{backup?.message}</p>
              {backup?.lastBackup?.createdAt && (
                <p style={{ fontSize: "0.75rem", color: "var(--hq-text-dim)" }}>
                  Last: {backup.lastBackup.filename} · {formatDateTime(backup.lastBackup.createdAt)}
                </p>
              )}
              <button type="button" className="hq-btn hq-btn-sm hq-btn-primary" style={{ marginTop: "0.5rem" }} disabled={createBackup.isPending} onClick={() => createBackup.mutate()}>
                {createBackup.isPending ? "Creating…" : "Create Backup Now"}
              </button>
            </HqPanel>
          </div>
        </>
      )}

      {tab === "mfa" && (
        <HqPanel title="Multi-Factor Authentication" subtitle="TOTP authenticator for privileged HQ accounts">
          {mfaStatus.isLoading ? <HqLoading /> : (
            <>
              <StatusBadge label={mfaStatus.data?.enabled ? "MFA Enabled" : "MFA Not Enabled"} variant={mfaStatus.data?.enabled ? "success" : "warning"} />
              {!mfaStatus.data?.enabled && (
                <div style={{ marginTop: "1rem" }}>
                  <button type="button" className="hq-btn hq-btn-primary hq-btn-sm" disabled={mfaSetup.isPending} onClick={() => mfaSetup.mutate()}>
                    <Smartphone size={14} /> Generate QR Code
                  </button>
                  {qrCode && (
                    <div style={{ marginTop: "1rem" }}>
                      <img src={qrCode} alt="MFA QR Code" style={{ maxWidth: 200, borderRadius: 8 }} />
                      <div className="hq-aura-input-row" style={{ marginTop: "0.75rem", maxWidth: 320 }}>
                        <input className="hq-input" placeholder="6-digit code" value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} maxLength={6} />
                        <button type="button" className="hq-btn hq-btn-primary" disabled={mfaVerify.isPending || mfaCode.length < 6} onClick={() => mfaVerify.mutate()}>Verify & Enable</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              <p className="hq-muted-text" style={{ marginTop: "1rem" }}>Required for Founder, Executive, and Administrator roles when enabled.</p>
            </>
          )}
        </HqPanel>
      )}

      {tab === "sessions" && (
        <div className="hq-grid-2 hq-fade-in">
          <HqPanel title="Active Sessions" subtitle="HQ login sessions across devices">
            {sessions.isLoading ? <HqLoading /> : (
              <table className="hq-table">
                <thead><tr><th>User</th><th>Device</th><th>IP</th><th>Last Seen</th><th></th></tr></thead>
                <tbody>
                  {(sessions.data?.sessions ?? []).map((s) => (
                    <tr key={s.id}>
                      <td>{s.email}</td>
                      <td>{s.device_label}</td>
                      <td>{s.ip_address ?? "—"}</td>
                      <td style={{ fontSize: "0.75rem" }}>{formatDateTime(s.last_seen_at)}</td>
                      <td>
                        <button type="button" className="hq-btn hq-btn-sm hq-btn-ghost" onClick={() => revokeSession.mutate(s.id)}>Revoke</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </HqPanel>
          <HqPanel title="Known Devices" subtitle="Grouped by device and user">
            {devices.isLoading ? <HqLoading /> : (
              <ul className="hq-activity-list">
                {(devices.data?.devices ?? []).map((d, i) => (
                  <li key={i} className="hq-activity-item">
                    <div className="hq-activity-content">
                      <div className="hq-activity-title">{String((d as { device_label?: string }).device_label ?? "Device")}</div>
                      <div className="hq-activity-detail">{String((d as { email?: string }).email)} · {String((d as { ip_address?: string }).ip_address ?? "")}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </HqPanel>
        </div>
      )}

      {tab === "logins" && (
        <HqPanel title="Login History" subtitle="Successful and failed authentication attempts">
          {logins.isLoading ? <HqLoading /> : (
            <table className="hq-table">
              <thead><tr><th>Time</th><th>Email</th><th>Result</th><th>Device</th><th>IP</th></tr></thead>
              <tbody>
                {(logins.data?.logins ?? []).map((row) => {
                  const r = row as { id: string; email: string; success: number; device_label: string; ip_address: string; created_at: string };
                  return (
                    <tr key={r.id}>
                      <td style={{ fontSize: "0.75rem" }}>{formatDateTime(r.created_at)}</td>
                      <td>{r.email}</td>
                      <td><StatusBadge label={r.success ? "Success" : "Failed"} variant={r.success ? "success" : "danger"} /></td>
                      <td>{r.device_label}</td>
                      <td>{r.ip_address ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </HqPanel>
      )}

      {tab === "threats" && (
        <HqPanel title="Threat Monitor" subtitle="Suspicious activity in the last 24 hours">
          {threats.isLoading ? <HqLoading /> : (
            <ul className="hq-activity-list">
              {(threats.data?.threats ?? []).map((t, i) => (
                <li key={i} className="hq-activity-item">
                  <AlertTriangle size={14} style={{ color: t.level === "high" ? "var(--hq-danger)" : "var(--hq-warning)" }} />
                  <div className="hq-activity-content">
                    <div className="hq-activity-title">{t.title}</div>
                    <div className="hq-activity-detail">{t.detail}</div>
                  </div>
                  <StatusBadge label={t.level} variant={t.level === "high" ? "danger" : t.level === "medium" ? "warning" : "muted"} />
                </li>
              ))}
            </ul>
          )}
        </HqPanel>
      )}

      {tab === "backup" && (
        <HqPanel title="Restore Points" subtitle="Automated and manual database snapshots">
          <button type="button" className="hq-btn hq-btn-primary hq-btn-sm" style={{ marginBottom: "1rem" }} disabled={createBackup.isPending} onClick={() => createBackup.mutate()}>
            <Database size={14} /> {createBackup.isPending ? "Creating…" : "Create Snapshot"}
          </button>
          {restorePoints.isLoading ? <HqLoading /> : (
            <table className="hq-table">
              <thead><tr><th>Filename</th><th>Size</th><th>Created</th></tr></thead>
              <tbody>
                {(restorePoints.data?.restorePoints ?? []).map((rp) => (
                  <tr key={rp.id}>
                    <td>{rp.filename}</td>
                    <td>{(rp.size_bytes / 1024).toFixed(1)} KB</td>
                    <td>{formatDateTime(rp.created_at)}</td>
                  </tr>
                ))}
                {!restorePoints.data?.restorePoints?.length && (
                  <tr><td colSpan={3} className="hq-empty-cell">No restore points — create a backup or run scheduled jobs</td></tr>
                )}
              </tbody>
            </table>
          )}
        </HqPanel>
      )}

      {(tab === "overview") && (
        <div className="hq-grid-main-side hq-fade-in" style={{ marginTop: "1.25rem" }}>
          <HqPanel title="Audit Log" subtitle="Organization-wide mutation history" headerExtra={
            <select className="hq-input" style={{ width: "auto", fontSize: "0.78rem" }} value={auditLimit} onChange={(e) => setAuditLimit(Number(e.target.value))}>
              <option value={25}>Last 25</option><option value={50}>Last 50</option><option value={100}>Last 100</option>
            </select>
          }>
            {audit.isLoading ? <HqLoading /> : (
              <table className="hq-table">
                <thead><tr><th>Time</th><th>Action</th><th>Entity</th><th>Actor</th></tr></thead>
                <tbody>
                  {(audit.data?.audit ?? []).map((entry) => (
                    <tr key={entry.id}>
                      <td style={{ fontSize: "0.75rem" }}>{formatDateTime(entry.created_at)}</td>
                      <td><StatusBadge label={entry.action} variant="muted" /></td>
                      <td>{entry.entity_type}</td>
                      <td>{entry.actor_email ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </HqPanel>
          <HqPanel title="Activity Monitor" subtitle="Recent security events">
            {activity.isLoading ? <HqLoading /> : (
              <ul className="hq-activity-list">
                {(activity.data?.activity ?? []).map((entry) => (
                  <li key={entry.id} className="hq-activity-item">
                    <div className="hq-activity-content">
                      <div className="hq-activity-title">{entry.action}</div>
                      <div className="hq-activity-detail">{entry.detail}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </HqPanel>
        </div>
      )}
    </HQLayout>
  );
};

export default SecurityCenterPage;
