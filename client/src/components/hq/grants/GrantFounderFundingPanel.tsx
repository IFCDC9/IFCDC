import React from "react";
import { useQuery } from "@tanstack/react-query";
import { grantsApi } from "../../../api/grantsApi";
import { HqPanel } from "../HqPanel";
import { formatCurrency } from "../../../utils/safeFormat";

type Field<T> = { status: "available"; value: T } | { status: "unavailable"; value: null };

interface FundingRow {
  id: string;
  title: string;
  funder: string | null;
  eligibility: Field<string>;
  programMatch: Field<{ slug: string; label: string; matchedTerms: string[] }>;
  barbersWorkforceRelevant: Field<boolean>;
  fundingAmount: Field<{ min: number | null; max: number | null }>;
  awardRange: Field<{ label: "Award Range"; min: number | null; max: number | null }>;
  maximumIndividualAward: Field<{ label: "Maximum Individual Award"; amount: number }>;
  estimatedProgramFunding: Field<{ label: "Estimated/Total Program Funding"; estimated: number | null; totalProgram: number | null }>;
  deadline: Field<string>;
  deadlineSource: "deadline" | "close_date" | null;
  freshness: Field<string[]>;
  renewable: Field<true>;
  proposalStatus: Field<string>;
  budgetStatus: Field<{ state: "recorded"; totalRequested: number | null }>;
  founderApprovalStatus: Field<string>;
  submissionReadiness: Field<"ready">;
  awardStatus: Field<{ status: string; amount: number | null }>;
  complianceStatus: Field<string>;
}

interface FundingView {
  readOnly: true;
  libraryCount: number;
  priority: FundingRow[];
}

function shown(value: string | null | undefined): string {
  return value && value.trim() ? value : "Unavailable";
}

function fieldText<T>(field: Field<T> | undefined, format: (value: T) => string): string {
  if (!field || field.status !== "available") return "Unavailable";
  return format(field.value);
}

function money(value: number | null | undefined): string | null {
  return typeof value === "number" ? formatCurrency(value) : null;
}

function rangeText(field: FundingRow["awardRange"] | undefined): string {
  if (!field || field.status !== "available") return "Unavailable";
  const min = money(field.value.min);
  const max = money(field.value.max);
  if (min && max) return `${min}–${max}`;
  return max || min || "Unavailable";
}

function individualText(field: FundingRow["maximumIndividualAward"] | undefined): string {
  if (!field || field.status !== "available") return "Unavailable";
  return money(field.value.amount) || "Unavailable";
}

function programText(field: FundingRow["estimatedProgramFunding"] | undefined): string {
  if (!field || field.status !== "available") return "Unavailable";
  const estimated = money(field.value.estimated);
  const total = money(field.value.totalProgram);
  if (estimated && total) return `${estimated} estimated · ${total} total program`;
  if (total) return `${total} total program`;
  return estimated || "Unavailable";
}

function deadlineText(row: FundingRow): string {
  if (row.deadline.status !== "available") return "Deadline unavailable";
  const day = row.deadline.value.slice(0, 10);
  return row.deadlineSource === "close_date" ? `${day} (source date)` : day;
}

export const GrantFounderFundingPanel: React.FC = () => {
  const view = useQuery({
    queryKey: ["grant-founder-funding-view"],
    queryFn: grantsApi.founderFundingView,
  });
  const data = view.data as FundingView | undefined;
  const rows = data?.priority ?? [];

  return (
    <HqPanel
      title="Founder funding view"
      subtitle="Read-only ranking of the existing Grant Center library. Nothing is submitted or approved from this panel."
    >
      {view.isLoading && <p className="hq-muted-text">Reading the local grant library…</p>}
      {view.isError && (
        <p className="hq-muted-text">{(view.error as Error).message || "Founder funding view unavailable"}</p>
      )}
      {data && (
        <>
          <p className="hq-muted-text">{data.libraryCount} opportunities in the existing library. Highest-priority rows are listed first.</p>
          <table className="hq-table hq-table-compact">
            <thead>
              <tr>
                <th>Opportunity</th>
                <th>Match</th>
                <th>Barbers / workforce</th>
                <th>Amount</th>
                <th>Deadline</th>
                <th>Freshness</th>
                <th>Renewable</th>
                <th>Proposal</th>
                <th>Budget</th>
                <th>Founder approval</th>
                <th>Readiness</th>
                <th>Award</th>
                <th>Compliance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <div>{row.title}</div>
                    <div className="hq-muted-text">{shown(row.funder)}</div>
                    <div className="hq-muted-text">{fieldText(row.eligibility, (value) => value)}</div>
                  </td>
                  <td>{fieldText(row.programMatch, (value) => value.label)}</td>
                  <td>{fieldText(row.barbersWorkforceRelevant, (value) => (value ? "Relevant" : "No workforce match"))}</td>
                  <td>
                    <div>Award Range: {rangeText(row.awardRange)}</div>
                    <div>Maximum Individual Award: {individualText(row.maximumIndividualAward)}</div>
                    <div>Estimated/Total Program Funding: {programText(row.estimatedProgramFunding)}</div>
                  </td>
                  <td>{deadlineText(row)}</td>
                  <td>{fieldText(row.freshness, (value) => value.join(", "))}</td>
                  <td>{fieldText(row.renewable, () => "Recurring record")}</td>
                  <td>{fieldText(row.proposalStatus, (value) => value)}</td>
                  <td>{fieldText(row.budgetStatus, (value) => (value.totalRequested != null ? formatCurrency(value.totalRequested) : "Recorded"))}</td>
                  <td>{fieldText(row.founderApprovalStatus, (value) => value)}</td>
                  <td>{fieldText(row.submissionReadiness, (value) => value)}</td>
                  <td>{fieldText(row.awardStatus, (value) => value.status)}</td>
                  <td>{fieldText(row.complianceStatus, (value) => value)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={13} className="hq-muted-text">No opportunities are stored in the local library.</td></tr>
              )}
            </tbody>
          </table>
        </>
      )}
    </HqPanel>
  );
};
