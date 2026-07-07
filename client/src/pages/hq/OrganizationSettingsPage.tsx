import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Shield, Key, Users, Building2, Globe, Plug, Settings } from "lucide-react";
import HQLayout from "../../layouts/HQLayout";
import { StatusBadge } from "../../components/hq/StatusBadge";
import { HqLoading } from "../../components/hq/HqLoading";
import { HqPanel } from "../../components/hq/HqPanel";
import { useAuth } from "../../auth/AuthContext";
import { hqApi } from "../../api/hqApi";

async function fetchMatrix() {
  const res = await fetch("/api/hq/auth/matrix", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to load permission matrix");
  return res.json();
}

const MODULE_SHORTCUTS = [
  { label: "People Management", to: "/hq/people", desc: "HR, employees, volunteers" },
  { label: "Financial Center", to: "/hq/finance", desc: "Ledger, budgets, AP/AR" },
  { label: "Grant Center", to: "/hq/grants", desc: "Pipeline, awards, compliance" },
  { label: "Organization Analytics", to: "/hq/analytics", desc: "Executive reports & KPIs" },
  { label: "Software Division", to: "/hq/software", desc: "App health & deployments" },
  { label: "AURA Command Center", to: "/hq/aura", desc: "AI insights & forecasting" },
];

const OrganizationSettingsPage: React.FC = () => {
  const { user } = useAuth();
  const [orgName, setOrgName] = useState("Imperial Foundation Community Development Corporation");
  const [orgTagline, setOrgTagline] = useState("Building stronger communities through enterprise innovation");

  const { data, isLoading, error } = useQuery({
    queryKey: ["enterprise-matrix"],
    queryFn: fetchMatrix,
  });

  const software = useQuery({
    queryKey: ["hq-settings-software"],
    queryFn: hqApi.softwareDivision,
  });

  return (
    <HQLayout title="Organization Settings" subtitle="Enterprise profile, roles, permissions, and connected applications">
      <div className="hq-kpi-grid" style={{ marginBottom: "1.5rem" }}>
        <div className="hq-kpi-card">
          <Shield className="hq-kpi-icon" size={24} />
          <div className="hq-kpi-label">Your Role</div>
          <div className="hq-kpi-value" style={{ fontSize: "1.25rem" }}>{user?.enterpriseRoleLabel}</div>
          <div className="hq-kpi-meta">{user?.permissions.length} permissions</div>
        </div>
        <div className="hq-kpi-card">
          <Key className="hq-kpi-icon" size={24} />
          <div className="hq-kpi-label">Single Sign-On</div>
          <div className="hq-kpi-value success" style={{ fontSize: "1.25rem" }}>Active</div>
          <div className="hq-kpi-meta">All IFCDC apps authenticate through HQ</div>
        </div>
        <div className="hq-kpi-card">
          <Users className="hq-kpi-icon" size={24} />
          <div className="hq-kpi-label">Enterprise Roles</div>
          <div className="hq-kpi-value">{data?.roles?.length ?? 10}</div>
          <div className="hq-kpi-meta">Centrally managed through Headquarters</div>
        </div>
        <div className="hq-kpi-card">
          <Plug className="hq-kpi-icon" size={24} />
          <div className="hq-kpi-label">Connected Apps</div>
          <div className="hq-kpi-value">{software.data?.apps?.length ?? "—"}</div>
          <div className="hq-kpi-meta">Software Division registry</div>
        </div>
      </div>

      <HqPanel title="Organization Profile" subtitle="Enterprise identity visible across all IFCDC applications" className="hq-fade-in">
        <div className="hq-form-grid">
          <label className="hq-field hq-field-full">
            <span><Building2 size={14} /> Organization Name</span>
            <input className="hq-input" value={orgName} onChange={(e) => setOrgName(e.target.value)} />
          </label>
          <label className="hq-field hq-field-full">
            <span><Globe size={14} /> Mission Tagline</span>
            <input className="hq-input" value={orgTagline} onChange={(e) => setOrgTagline(e.target.value)} />
          </label>
        </div>
        <p className="hq-muted-text" style={{ fontSize: "0.78rem", marginTop: "0.75rem" }}>
          Profile updates apply to your Headquarters session. Full org-wide branding sync coming in a future release.
        </p>
      </HqPanel>

      <HqPanel title="Headquarters Modules" subtitle="Quick access to every enterprise system" className="hq-mt-panel">
        <div className="hq-framework-service-grid">
          {MODULE_SHORTCUTS.map((m) => (
            <Link key={m.to} to={m.to} className="hq-framework-service-card" style={{ textDecoration: "none" }}>
              <div className="hq-framework-service-name"><Settings size={14} /> {m.label}</div>
              <div className="hq-framework-service-desc">{m.desc}</div>
            </Link>
          ))}
        </div>
      </HqPanel>

      <HqPanel title="Role & Permission Matrix" subtitle="Every user receives permissions based on their enterprise role" className="hq-mt-panel">
        {isLoading && <HqLoading message="Loading permission matrix…" />}
        {error && <div style={{ color: "#ef4444" }}>{(error as Error).message}</div>}
        {data?.roles && (
          <div className="hq-table-scroll">
            <table className="hq-table">
              <thead>
                <tr>
                  <th>Role</th>
                  <th>HQ Modules</th>
                  <th>Key Permissions</th>
                </tr>
              </thead>
              <tbody>
                {data.roles.map((r: { id: string; label: string; modules: string[]; permissions: string[] }) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.label}</strong>
                      {user?.enterpriseRole === r.id && <StatusBadge label="You" variant="gold" />}
                    </td>
                    <td>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
                        {r.modules.map((m: string) => (
                          <StatusBadge key={m} label={m.replace(/_/g, " ")} variant="muted" />
                        ))}
                      </div>
                    </td>
                    <td style={{ fontSize: "0.78rem" }}>
                      {r.permissions.slice(0, 6).join(" · ")}
                      {r.permissions.length > 6 && ` +${r.permissions.length - 6} more`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </HqPanel>

      <HqPanel title="Connected Applications" subtitle="Live Software Division registry — all apps authenticate through Headquarters" className="hq-mt-panel">
        {software.isLoading && <HqLoading message="Loading connected apps…" />}
        {software.data?.apps && (
          <div className="hq-dev-endpoint-table">
            {software.data.apps.map((app) => (
              <div key={app.id} className="hq-dev-endpoint-row">
                <span>{app.name}{app.locked ? " 🔒" : ""}</span>
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <StatusBadge label={app.status} variant={app.healthy ? "success" : "warning"} pulse={app.healthy} />
                  <code>{app.version ?? "—"}</code>
                </div>
              </div>
            ))}
          </div>
        )}
        <p style={{ fontSize: "0.82rem", color: "var(--hq-text-muted)", marginTop: "1rem", lineHeight: 1.6 }}>
          Every IFCDC application verifies identity through{" "}
          <code style={{ color: "var(--hq-gold)" }}>POST /api/hq/auth/verify</code>.
          Apps receive the user&apos;s enterprise role and permission set automatically.
        </p>
      </HqPanel>
    </HQLayout>
  );
};

export default OrganizationSettingsPage;
