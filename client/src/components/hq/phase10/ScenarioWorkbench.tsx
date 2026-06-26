import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { TrendingUp, AlertTriangle } from "lucide-react";
import { phase10Api, type ScenarioResult } from "../../../api/phase10Api";
import { StatusBadge } from "../StatusBadge";
import { formatCurrency, formatLocaleNumber, formatPercent } from "../../../utils/safeFormat";

const PRESETS = [
  { label: "Baseline", input: {} },
  { label: "Growth", input: { budgetChangePercent: 10, headcountChange: 2, programEnrollmentChange: 8 } },
  { label: "Austerity", input: { budgetChangePercent: -8, headcountChange: -1 } },
  { label: "Grant Push", input: { grantWinRateAdjust: 15, donationGrowthPercent: 5 } },
];

export const ScenarioWorkbench: React.FC = () => {
  const [budgetPct, setBudgetPct] = useState(0);
  const [headcount, setHeadcount] = useState(0);
  const [grantAdj, setGrantAdj] = useState(0);
  const [result, setResult] = useState<ScenarioResult | null>(null);

  const run = useMutation({
    mutationFn: (input: Record<string, number | undefined>) => phase10Api.runScenario(input),
    onSuccess: setResult,
  });

  function runCurrent() {
    run.mutate({
      budgetChangePercent: budgetPct,
      headcountChange: headcount,
      grantWinRateAdjust: grantAdj,
      horizonMonths: 6,
    });
  }

  return (
    <div id="scenarios">
      <div className="hq-scenario-controls">
        <label>
          Budget change %
          <input type="range" min={-20} max={20} value={budgetPct} onChange={(e) => setBudgetPct(Number(e.target.value))} />
          <span>{budgetPct}%</span>
        </label>
        <label>
          Headcount change
          <input type="range" min={-5} max={10} value={headcount} onChange={(e) => setHeadcount(Number(e.target.value))} />
          <span>{headcount} FTE</span>
        </label>
        <label>
          Grant win rate adjust
          <input type="range" min={-15} max={25} value={grantAdj} onChange={(e) => setGrantAdj(Number(e.target.value))} />
          <span>{grantAdj}%</span>
        </label>
      </div>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
        {PRESETS.map((p) => (
          <button key={p.label} type="button" className="hq-btn hq-btn-ghost hq-btn-sm" onClick={() => run.mutate(p.input)}>
            {p.label}
          </button>
        ))}
        <button type="button" className="hq-btn hq-btn-primary hq-btn-sm" disabled={run.isPending} onClick={runCurrent}>
          <TrendingUp size={14} /> Run scenario
        </button>
      </div>
      {result && (
        <>
          <div className="hq-kpi-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", marginBottom: "0.75rem" }}>
            {result.projections.slice(0, 4).map((p) => (
              <div key={p.id} className="hq-kpi-card">
                <div className="hq-kpi-label">{p.label}</div>
                <div className="hq-kpi-value">
                  {p.unit === "$" ? formatCurrency(p.projected) : `${formatLocaleNumber(p.projected)}${p.unit === "%" ? "%" : ""}`}
                </div>
                <div className="hq-muted-text" style={{ fontSize: "0.72rem" }}>
                  Δ {p.unit === "$" ? formatCurrency(p.delta) : p.delta}
                </div>
              </div>
            ))}
          </div>
          <div className="hq-anomaly-alert hq-sev-medium">
            <AlertTriangle size={14} />
            <div>
              <strong>Risk: {result.summary.riskLevel}</strong>
              <span>{result.summary.recommendation}</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
