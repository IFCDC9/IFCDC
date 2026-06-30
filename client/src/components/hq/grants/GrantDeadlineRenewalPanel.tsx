import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Calendar, RefreshCw, CheckCircle } from "lucide-react";
import { grantsApi, type GrantAward, type GrantDeadline } from "../../../api/grantsApi";
import { HqPanel } from "../HqPanel";
import { StatusBadge } from "../StatusBadge";
import { HqLoading } from "../HqLoading";
import { useGrantManage } from "../../../hooks/useGrantManage";
import { formatCurrency } from "../../../utils/safeFormat";

const fmt = formatCurrency;

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export const GrantDeadlineRenewalPanel: React.FC = () => {
  const qc = useQueryClient();
  const { canManage } = useGrantManage();
  const [renewalForm, setRenewalForm] = useState({ award_id: "", renewal_date: "", notes: "" });

  const deadlines = useQuery({
    queryKey: ["grants-deadlines-upcoming"],
    queryFn: () => grantsApi.deadlines(true),
    staleTime: 30_000,
  });
  const renewals = useQuery({
    queryKey: ["grants-renewals"],
    queryFn: grantsApi.renewals,
    staleTime: 30_000,
  });
  const awards = useQuery({
    queryKey: ["grants-awards"],
    queryFn: grantsApi.awards,
    staleTime: 60_000,
  });

  const completeDeadline = useMutation({
    mutationFn: grantsApi.completeDeadline,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["grants-deadlines-upcoming"] }),
  });
  const createRenewal = useMutation({
    mutationFn: grantsApi.createRenewal,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["grants-renewals"] });
      qc.invalidateQueries({ queryKey: ["grant-funding-engine"] });
      setRenewalForm({ award_id: "", renewal_date: "", notes: "" });
    },
  });

  const awardList = awards.data?.awards ?? [];
  const deadlineList = deadlines.data?.deadlines ?? [];
  const renewalList = renewals.data?.renewals ?? [];

  return (
    <div className="hq-grid-2">
      <HqPanel title="Deadline Management" subtitle="Upcoming submissions and compliance due dates">
        {deadlines.isLoading ? <HqLoading /> : (
          <table className="hq-table">
            <thead>
              <tr><th>Deadline</th><th>Grant</th><th>Due</th><th></th></tr>
            </thead>
            <tbody>
              {deadlineList.map((d: GrantDeadline) => (
                <tr key={d.id}>
                  <td><strong>{d.title}</strong><div className="hq-muted-text" style={{ fontSize: "0.78rem" }}>{d.deadline_type}</div></td>
                  <td>{d.opportunity_title ?? "—"}</td>
                  <td>{fmtDate(d.due_date)}</td>
                  <td>
                    {!d.completed && canManage && (
                      <button
                        type="button"
                        className="hq-btn hq-btn-sm hq-btn-secondary"
                        disabled={completeDeadline.isPending}
                        onClick={() => completeDeadline.mutate(d.id)}
                      >
                        <CheckCircle size={12} /> Done
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!deadlineList.length && (
                <tr><td colSpan={4} className="hq-empty-cell">No upcoming deadlines in the next 30 days.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </HqPanel>

      <HqPanel title="Renewal Tracking" subtitle="Plan and monitor grant renewals">
        {renewals.isLoading ? <HqLoading /> : (
          <>
            {canManage && (
            <div style={{ display: "grid", gap: "0.5rem", marginBottom: "1rem" }}>
              <label style={{ fontSize: "0.78rem", color: "var(--hq-text-muted)" }}>Award to renew</label>
              <select
                className="hq-aura-input"
                value={renewalForm.award_id}
                onChange={(e) => setRenewalForm({ ...renewalForm, award_id: e.target.value })}
              >
                <option value="">Select active award…</option>
                {awardList.map((a: GrantAward) => (
                  <option key={a.id} value={a.id}>{a.opportunity_title ?? a.application_title ?? a.id} — {fmt(a.amount)}</option>
                ))}
              </select>
              <label style={{ fontSize: "0.78rem", color: "var(--hq-text-muted)" }}>Target renewal date</label>
              <input
                className="hq-aura-input"
                type="date"
                value={renewalForm.renewal_date}
                onChange={(e) => setRenewalForm({ ...renewalForm, renewal_date: e.target.value })}
              />
              <label style={{ fontSize: "0.78rem", color: "var(--hq-text-muted)" }}>Notes</label>
              <textarea
                className="hq-aura-input"
                rows={2}
                value={renewalForm.notes}
                onChange={(e) => setRenewalForm({ ...renewalForm, notes: e.target.value })}
                placeholder="Renewal strategy, funder requirements…"
              />
              <button
                type="button"
                className="hq-btn hq-btn-primary hq-btn-sm"
                style={{ justifySelf: "start" }}
                disabled={!renewalForm.award_id || !renewalForm.renewal_date || createRenewal.isPending}
                onClick={() =>
                  createRenewal.mutate({
                    original_award_id: renewalForm.award_id,
                    renewal_date: renewalForm.renewal_date,
                    notes: renewalForm.notes || undefined,
                  })
                }
              >
                <RefreshCw size={14} /> Plan Renewal
              </button>
            </div>
            )}
            <ul className="hq-activity-list" style={{ margin: 0, padding: 0, listStyle: "none" }}>
              {renewalList.map((r) => (
                <li key={String(r.id)} className="hq-activity-item">
                  <div className="hq-activity-icon"><Calendar size={16} /></div>
                  <div className="hq-activity-content">
                    <div className="hq-activity-title">{String(r.original_grant ?? "Grant renewal")}</div>
                    <div className="hq-activity-detail">{fmtDate(r.renewal_date as string)} · {String(r.notes ?? "")}</div>
                  </div>
                  <StatusBadge label={String(r.status ?? "planned")} variant="gold" />
                </li>
              ))}
              {!renewalList.length && <li className="hq-muted-text">No renewals planned yet.</li>}
            </ul>
          </>
        )}
      </HqPanel>
    </div>
  );
};
