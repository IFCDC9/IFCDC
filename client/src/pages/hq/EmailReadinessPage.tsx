/**
 * Executive Email Readiness Report — Founder read-only view.
 * Data: GET /api/hq/email/readiness
 */
import React, { useCallback, useEffect, useState } from "react";
import { hqApiFetch } from "../../api/hqApiFetch";

type Workflow = {
  id: string;
  name: string;
  category: string;
  routeOrService: string;
  templateId: string | null;
  senderExpected: string;
  recipientLogic: string;
  status: string;
  notes: string;
  securityNotes?: string;
};

type Report = {
  generatedAt: string;
  sender: {
    configured: string;
    effective: string | null;
    usedFallback: boolean | null;
    apiKeySet: boolean;
    probeOk: boolean | null;
  };
  summary: {
    totalWorkflows: number;
    connected: number;
    partial: number;
    templateOnly: number;
    notConfigured: number;
    tested: number;
    passed: number;
    failed: number;
    notConfiguredTests: number;
    warnings: number;
    productionReadinessPercent: number;
  };
  workflows: Workflow[];
  templateDryRender: Array<{ templateId: string; ok: boolean; error?: string }>;
  recommendations: string[];
  lastResults: Array<{
    workflowId: string;
    name: string;
    result: string;
    messageId: string | null;
    sender: string | null;
    template: string | null;
    deliveryStatus: string;
    warnings: string[];
  }>;
};

const EmailReadinessPage: React.FC = () => {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await hqApiFetch<{ ok: boolean; report: Report }>("/api/hq/email/readiness", {
        timeoutMs: 60_000,
      });
      setReport(data.report);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load readiness report");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="hq-page">
        <h1>Executive Email Readiness</h1>
        <p>Loading inventory…</p>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="hq-page">
        <h1>Executive Email Readiness</h1>
        <p className="hq-error">{error || "No report"}</p>
        <button type="button" className="hq-btn hq-btn-secondary" onClick={() => void load()}>
          Retry
        </button>
      </div>
    );
  }

  const s = report.summary;

  return (
    <div className="hq-page" style={{ maxWidth: 1100 }}>
      <header style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ marginBottom: "0.35rem" }}>Executive Email Readiness Report</h1>
        <p style={{ color: "var(--hq-muted, #888)", margin: 0 }}>
          Read-only inventory of IFCDC HQ email workflows. Generated {new Date(report.generatedAt).toLocaleString()}
        </p>
      </header>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: "0.75rem",
          marginBottom: "1.5rem",
        }}
      >
        {[
          ["Readiness", `${s.productionReadinessPercent}%`],
          ["Workflows", String(s.totalWorkflows)],
          ["Connected", String(s.connected)],
          ["Partial", String(s.partial)],
          ["Template only", String(s.templateOnly)],
          ["Not configured", String(s.notConfigured)],
        ].map(([label, value]) => (
          <div
            key={label}
            style={{
              border: "1px solid #333",
              borderRadius: 8,
              padding: "0.85rem 1rem",
              background: "#111",
            }}
          >
            <div style={{ fontSize: 12, color: "#999" }}>{label}</div>
            <div style={{ fontSize: 22, fontWeight: 600, color: "#c9a227" }}>{value}</div>
          </div>
        ))}
      </section>

      <section style={{ marginBottom: "1.5rem", border: "1px solid #333", borderRadius: 8, padding: "1rem", background: "#111" }}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Sender</h2>
        <p style={{ margin: "0.25rem 0" }}>Configured: <code>{report.sender.configured}</code></p>
        <p style={{ margin: "0.25rem 0" }}>Effective: <code>{report.sender.effective || "—"}</code></p>
        <p style={{ margin: "0.25rem 0" }}>
          API key: {report.sender.apiKeySet ? "set" : "missing"} · Probe:{" "}
          {report.sender.probeOk == null ? "—" : report.sender.probeOk ? "ok" : "fail"} · Fallback:{" "}
          {report.sender.usedFallback == null ? "—" : report.sender.usedFallback ? "yes" : "no"}
        </p>
      </section>

      <section style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ fontSize: 16 }}>Workflows</h2>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #333" }}>
                <th style={{ padding: "0.5rem" }}>Name</th>
                <th style={{ padding: "0.5rem" }}>Status</th>
                <th style={{ padding: "0.5rem" }}>Template</th>
                <th style={{ padding: "0.5rem" }}>Route / service</th>
              </tr>
            </thead>
            <tbody>
              {report.workflows.map((w) => (
                <tr key={w.id} style={{ borderBottom: "1px solid #222" }}>
                  <td style={{ padding: "0.55rem", verticalAlign: "top" }}>
                    <strong>{w.name}</strong>
                    <div style={{ color: "#888", marginTop: 4 }}>{w.notes}</div>
                  </td>
                  <td style={{ padding: "0.55rem", verticalAlign: "top" }}>
                    <code>{w.status}</code>
                  </td>
                  <td style={{ padding: "0.55rem", verticalAlign: "top" }}>{w.templateId || "—"}</td>
                  <td style={{ padding: "0.55rem", verticalAlign: "top", color: "#aaa" }}>{w.routeOrService}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ fontSize: 16 }}>Template dry-render</h2>
        <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
          {report.templateDryRender.map((t) => (
            <li key={t.templateId} style={{ marginBottom: 4 }}>
              <code>{t.templateId}</code> — {t.ok ? "PASS" : `FAIL ${t.error || ""}`}
            </li>
          ))}
        </ul>
      </section>

      {report.recommendations.length > 0 && (
        <section style={{ marginBottom: "1.5rem" }}>
          <h2 style={{ fontSize: 16 }}>Recommendations</h2>
          <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
            {report.recommendations.map((r) => (
              <li key={r} style={{ marginBottom: 6 }}>
                {r}
              </li>
            ))}
          </ul>
        </section>
      )}

      <p style={{ color: "#888", fontSize: 12 }}>
        Matrix runner: <code>POST /api/hq/email/readiness/run-matrix</code> (Founder inbox only). Do not run bulk
        broadcast tests without approval.
      </p>
    </div>
  );
};

export default EmailReadinessPage;
