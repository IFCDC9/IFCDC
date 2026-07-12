import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { FileBarChart, Download, Building2, Landmark, FileText, Globe, Briefcase } from "lucide-react";
import HQLayout from "../../layouts/HQLayout";
import { reportingApi, type ReportCatalogItem } from "../../api/reportingApi";
import { HqPanel } from "../../components/hq/HqPanel";
import { StatusBadge } from "../../components/hq/StatusBadge";
import { HqLoading } from "../../components/hq/HqLoading";
import { downloadReportJson } from "../../api/analyticsApi";

const CATEGORY_META: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  irs: { label: "IRS", icon: Landmark, color: "gold" },
  funder: { label: "Grant Funders", icon: FileText, color: "success" },
  state: { label: "State Agencies", icon: Globe, color: "warning" },
  internal: { label: "Internal Management", icon: Briefcase, color: "muted" },
  board: { label: "Board", icon: Building2, color: "gold" },
  annual: { label: "Annual", icon: FileBarChart, color: "success" },
};

const GENERATORS: Record<string, () => Promise<Record<string, unknown>>> = {
  irs_990: reportingApi.irs990,
  funder_grant: reportingApi.funderGrant,
  funder_pipeline: reportingApi.funderPipeline,
  state_annual: reportingApi.stateAnnual,
  state_charitable: reportingApi.stateCharitable,
  internal_management: reportingApi.internalManagement,
  internal_finance: reportingApi.internalFinance,
  board_package: reportingApi.boardPackage,
  board_financial: reportingApi.internalFinance,
  annual_organizational: reportingApi.annualOrganizational,
};

const EnterpriseReportingPage: React.FC = () => {
  const [category, setCategory] = useState<string>("all");
  const [generated, setGenerated] = useState<{ id: string; data: Record<string, unknown> } | null>(null);
  const [loading, setLoading] = useState<string | null>(null);

  const catalog = useQuery({ queryKey: ["report-catalog"], queryFn: reportingApi.catalog });

  const reports = (catalog.data?.reports ?? []).filter((r) => category === "all" || r.category === category);

  const generate = async (report: ReportCatalogItem) => {
    const fn = GENERATORS[report.id];
    if (!fn) return;
    setLoading(report.id);
    try {
      const data = await fn();
      setGenerated({ id: report.id, data });
    } finally {
      setLoading(null);
    }
  };

  return (
    <HQLayout title="Enterprise Reporting Center" subtitle="Automated reports for IRS, funders, state agencies, board, and internal management">
      <div style={{ marginBottom: "0.75rem" }}>
        <Link to="/hq/documents?category=reports" className="hq-btn hq-btn-sm hq-btn-ghost">Reports Document Vault →</Link>
      </div>
      <div className="hq-tabs">
        <button type="button" className={`hq-tab ${category === "all" ? "active" : ""}`} onClick={() => setCategory("all")}>All Reports</button>
        {Object.entries(CATEGORY_META).map(([key, meta]) => (
          <button key={key} type="button" className={`hq-tab ${category === key ? "active" : ""}`} onClick={() => setCategory(key)}>
            <meta.icon size={16} /> {meta.label}
          </button>
        ))}
      </div>

      <div className="hq-tab-content hq-fade-in">
        {catalog.isLoading ? <HqLoading /> : (
          <div className="hq-grid-2">
            <div>
              <div className="hq-app-grid">
                {reports.map((r) => {
                  const meta = CATEGORY_META[r.category];
                  return (
                    <div key={r.id} className="hq-app-card">
                      <meta.icon size={20} style={{ color: "var(--hq-gold)", marginBottom: "0.5rem" }} />
                      <div className="hq-app-name">{r.title}</div>
                      <div className="hq-muted-text" style={{ fontSize: "0.78rem", margin: "0.35rem 0" }}>{r.description}</div>
                      <StatusBadge label={r.frequency} variant="muted" />
                      <button type="button" className="hq-btn hq-btn-primary hq-btn-sm" style={{ marginTop: "0.75rem", width: "100%" }}
                        disabled={loading === r.id} onClick={() => generate(r)}>
                        {loading === r.id ? "Generating…" : "Generate"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            <HqPanel title="Report Preview" subtitle={generated ? generated.id.replace(/_/g, " ") : "Select a report to generate"}>
              {generated ? (
                <>
                  <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: "0.78rem", lineHeight: 1.55, maxHeight: 480, overflow: "auto", color: "var(--hq-text-muted)" }}>
                    {JSON.stringify(generated.data, null, 2).slice(0, 8000)}
                  </pre>
                  <button type="button" className="hq-btn hq-btn-secondary" style={{ marginTop: "1rem" }}
                    onClick={() => downloadReportJson(generated.data, `ifcdc-${generated.id}.json`)}>
                    <Download size={14} /> Download JSON
                  </button>
                </>
              ) : (
                <p className="hq-muted-text">Reports are generated automatically from live Headquarters data — finance, grants, programs, and HR.</p>
              )}
            </HqPanel>
          </div>
        )}
      </div>
    </HQLayout>
  );
};

export default EnterpriseReportingPage;
