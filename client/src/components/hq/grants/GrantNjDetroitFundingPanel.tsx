import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { grantsApi } from "../../../api/grantsApi";
import { HqPanel } from "../HqPanel";
import { HqLoading } from "../HqLoading";
import { grantCallFailureText } from "./grantCallFailure";

type Initiative = "all" | "nj_programs" | "detroit_initiative";

export const GrantNjDetroitFundingPanel: React.FC = () => {
  const [initiative, setInitiative] = useState<Initiative>("all");
  const preview = useQuery({
    queryKey: ["grant-discovery-preview", initiative],
    queryFn: () => grantsApi.discoveryPreview(initiative === "all" ? undefined : initiative),
    staleTime: 120_000,
  });
  const hr = useQuery({
    queryKey: ["grant-hr-staff-pipeline"],
    queryFn: grantsApi.hrStaffPipeline,
    staleTime: 60_000,
  });
  const walk = useQuery({
    queryKey: ["grant-funding-walkthrough"],
    queryFn: grantsApi.fundingWalkthrough,
    staleTime: 300_000,
  });

  const cards = (preview.data?.opportunities ?? []) as Array<{
    title: string;
    funder: string;
    source: string;
    dateChecked: string;
    deadline: string;
    eligibilityEvidence: string;
    allowableCosts: string;
    matchRequirements: string;
    officialLink: string;
    initiative: string;
    moneyStatus: string;
    amount: string;
  }>;

  return (
    <HqPanel
      title="NJ programs & Detroit initiative"
      subtitle="One Grant Center store. Read-only official feed preview — Aura only claims live search when Grants.gov Search2 or ProPublica actually ran."
    >
      <p className="hq-muted-text">
        Match scores are not eligibility. Amounts stay potential_funding until a submitted application, award, or received revenue is recorded.
        Founder approval is required before submit. exec@ifcdc.org cannot approve. This panel does not submit, contact funders, or purchase property.
      </p>
      <div className="hq-founder-command-strip" style={{ margin: "1rem 0", flexWrap: "wrap" }}>
        {([
          ["all", "Both queues"],
          ["nj_programs", "New Jersey programs"],
          ["detroit_initiative", "Detroit initiative"],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`hq-btn hq-btn-sm ${initiative === id ? "hq-btn-primary" : "hq-btn-ghost"}`}
            onClick={() => setInitiative(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {preview.isLoading ? <HqLoading /> : preview.isError ? (
        <p role="alert">{grantCallFailureText(preview.error, "Read-only discovery preview failed.")}</p>
      ) : (
        <>
          <ul className="hq-muted-text" style={{ paddingLeft: "1.1rem" }}>
            {(preview.data?.feeds ?? []).map((feed) => (
              <li key={feed.id}>
                <strong>{feed.label}</strong>
                {feed.liveSearch ? " — live search on this branch. " : " — no live opportunity search. "}
                {feed.note}
                {feed.missingCredentialNames.length > 0 ? ` Missing env names: ${feed.missingCredentialNames.join(", ")}.` : ""}
              </li>
            ))}
          </ul>
          <p className="hq-muted-text">Checked {preview.data?.checkedAt ?? "Unknown"}.</p>
          <div className="hq-table-scroll">
            <table className="hq-table">
              <thead>
                <tr>
                  <th>Opportunity</th>
                  <th>Initiative</th>
                  <th>Source</th>
                  <th>Checked</th>
                  <th>Deadline</th>
                  <th>Eligibility evidence</th>
                  <th>Allowable costs</th>
                  <th>Match / money</th>
                  <th>Link</th>
                </tr>
              </thead>
              <tbody>
                {cards.map((card) => (
                  <tr key={`${card.officialLink}-${card.title}`}>
                    <td>
                      <strong>{card.title}</strong>
                      <div className="hq-muted-text">{card.funder} · {card.amount}</div>
                    </td>
                    <td>{card.initiative}</td>
                    <td>{card.source}</td>
                    <td>{card.dateChecked}</td>
                    <td>{card.deadline}</td>
                    <td>{card.eligibilityEvidence}</td>
                    <td>{card.allowableCosts}</td>
                    <td>{card.matchRequirements} · {card.moneyStatus}</td>
                    <td>
                      {card.officialLink && card.officialLink !== "Unknown" ? (
                        <a href={card.officialLink} target="_blank" rel="noreferrer">Official <ExternalLink size={12} /></a>
                      ) : "Unknown"}
                    </td>
                  </tr>
                ))}
                {cards.length === 0 && (
                  <tr><td colSpan={9} className="hq-muted-text">No current official hits for this filter. Feeds that failed stay listed above with Unknown results.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
      {hr.data && (
        <p className="hq-muted-text" style={{ marginTop: "1rem" }}>
          HR coverage: {String((hr.data.kpis as { coverageGaps?: number })?.coverageGaps ?? "Unknown")} staff gap(s).
          Payroll is not funded until an award is confirmed and terms are reviewed.
        </p>
      )}
      {Array.isArray(walk.data?.steps) && (
        <ol className="hq-muted-text">
          {(walk.data.steps as { id: string; label: string; moneyStatus: string }[]).map((step) => (
            <li key={step.id}>{step.label} · {step.moneyStatus}</li>
          ))}
        </ol>
      )}
    </HqPanel>
  );
};
