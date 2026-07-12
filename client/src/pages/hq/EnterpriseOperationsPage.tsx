import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Link2 } from "lucide-react";
import HQLayout from "../../layouts/HQLayout";
import { operationsApi } from "../../api/operationsApi";
import { OPERATIONS_MODULES, type OpsColumn } from "../../config/operationsModules";
import { HQ_MODULE_CONFIGS } from "../../config/hqNavigation";
import { KpiCard } from "../../components/hq/KpiCard";
import { HqPanel } from "../../components/hq/HqPanel";
import { StatusBadge } from "../../components/hq/StatusBadge";
import { HqLoading } from "../../components/hq/HqLoading";
import { formatCurrency } from "../../utils/safeFormat";

function fmtCell(col: OpsColumn, val: unknown): string {
  if (val == null || val === "") return "—";
  if (col.format === "date") {
    try { return new Date(String(val)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); } catch { return String(val); }
  }
  if (col.format === "currency") {
    const n = Number(val);
    if (!Number.isFinite(n)) return "—";
    return n > 1000 ? `$${(n / 100).toFixed(2)}` : formatCurrency(n);
  }
  return String(val);
}

interface Props {
  moduleKey: keyof typeof OPERATIONS_MODULES;
}

const EnterpriseOperationsPage: React.FC<Props> = ({ moduleKey }) => {
  const def = OPERATIONS_MODULES[moduleKey];
  const config = HQ_MODULE_CONFIGS[moduleKey];
  const [tab, setTab] = useState(def.tabs[0].id);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const qc = useQueryClient();

  const activeTab = def.tabs.find((t) => t.id === tab) ?? def.tabs[0];

  const overview = useQuery({ queryKey: ["ops-overview"], queryFn: operationsApi.overview });
  const list = useQuery({
    queryKey: ["ops-list", activeTab.path],
    queryFn: () => operationsApi.list(activeTab.path),
    enabled: !!activeTab.path,
  });

  const createMut = useMutation({
    mutationFn: (body: Record<string, unknown>) => operationsApi.create(activeTab.path, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ops-list", activeTab.path] });
      qc.invalidateQueries({ queryKey: ["ops-overview"] });
      setShowForm(false);
      setForm({});
    },
  });

  const moduleOverview = overview.data?.[def.overviewKey] as Record<string, number> | undefined;

  return (
    <HQLayout title={config?.title ?? def.key} subtitle={config?.subtitle ?? "Connected to IFCDC Headquarters"}>
      <HqPanel title="Headquarters Integration" subtitle="One login · One database · One source of truth">
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
          <StatusBadge label="Live" variant="success" pulse />
          <span style={{ fontSize: "0.82rem", color: "var(--hq-text-muted)" }}>
            Connected to People, Finance, Grants, Analytics, Notifications &amp; AURA AI
          </span>
          {def.relatedModules.map((m) => (
            <Link key={m.path} to={m.path} className="hq-module-chip"><Link2 size={12} />{m.label}</Link>
          ))}
          {moduleKey === "compliance" && (
            <Link to="/hq/documents?category=policies" className="hq-module-chip"><Link2 size={12} />Policy Documents</Link>
          )}
          {(moduleKey === "assets" || moduleKey === "facilities") && (
            <Link to="/hq/documents" className="hq-module-chip"><Link2 size={12} />Document Vault</Link>
          )}
        </div>
      </HqPanel>

      {overview.isLoading && <HqLoading message="Loading module metrics…" />}

      {moduleOverview && (
        <div className="hq-kpi-grid" style={{ marginTop: "1.25rem" }}>
          {def.kpis.map((k) => (
            <KpiCard key={k.field} label={k.label} value={moduleOverview[k.field] ?? 0} />
          ))}
        </div>
      )}

      <div className="hq-tabs" style={{ marginTop: "1.25rem" }}>
        {def.tabs.map((t) => (
          <button key={t.id} type="button" className={`hq-tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "1rem" }}>
        <button type="button" className="hq-btn hq-btn-primary" onClick={() => setShowForm(true)}>
          <Plus size={16} /> {activeTab.createLabel}
        </button>
      </div>

      {showForm && (
        <div className="hq-modal-overlay" onClick={() => setShowForm(false)} role="presentation">
          <div className="hq-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{activeTab.createLabel}</h3>
            <div className="hq-form-grid">
              {activeTab.createFields.map((f) => (
                <label key={f.key}>
                  {f.label}
                  {f.type === "select" ? (
                    <select value={form[f.key] ?? ""} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}>
                      <option value="">Select…</option>
                      {f.options?.map((o) => <option key={o} value={o}>{o.replace(/_/g, " ")}</option>)}
                    </select>
                  ) : (
                    <input
                      type={f.type === "number" ? "number" : f.type === "date" ? "datetime-local" : "text"}
                      value={form[f.key] ?? ""}
                      onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                    />
                  )}
                </label>
              ))}
            </div>
            <div className="hq-modal-actions">
              <button type="button" className="hq-btn hq-btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
              <button
                type="button"
                className="hq-btn hq-btn-primary"
                disabled={createMut.isPending}
                onClick={() => {
                  const body: Record<string, unknown> = {};
                  for (const [k, v] of Object.entries(form)) {
                    if (v === "") continue;
                    body[k] = k.includes("amount") || k.includes("cents") || k === "capacity" || k === "sqft" || k === "mileage" || k === "year" || k === "version"
                      ? Number(v) : v;
                  }
                  if (activeTab.path.includes("applications") && !body.applied_at) body.applied_at = new Date().toISOString();
                  if (activeTab.path.includes("scholarship") && activeTab.id === "applications" && !body.submitted_at) body.submitted_at = new Date().toISOString();
                  createMut.mutate(body);
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {list.isLoading && <HqLoading message="Loading records…" />}

      {list.data && (
        <HqPanel title={activeTab.label} subtitle={`${list.data.items.length} records — synced with Headquarters`}>
          <table className="hq-table">
            <thead>
              <tr>{activeTab.columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr>
            </thead>
            <tbody>
              {list.data.items.length === 0 && (
                <tr><td colSpan={activeTab.columns.length} className="hq-empty-cell">No records yet. Add your first entry above.</td></tr>
              )}
              {list.data.items.map((row) => (
                <tr key={String(row.id)}>
                  {activeTab.columns.map((c) => (
                    <td key={c.key}>
                      {c.format === "status" ? <StatusBadge label={String(row[c.key] ?? "—")} variant="muted" /> : fmtCell(c, row[c.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </HqPanel>
      )}
    </HQLayout>
  );
};

export default EnterpriseOperationsPage;
