import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { grantsApi } from "../../../api/grantsApi";
import { useAuth } from "../../../auth/AuthContext";
import { GRANT_FACT_KEYS, type GrantFact, type GrantFactKey, type GrantNoticeReview } from "../../../../../shared/grantEligibility";

const labels: Record<GrantFactKey, string> = { legalName: "Legal name", taxStatus: "Tax status", serviceArea: "Service area", programs: "Current programs", experience: "Documented experience", partnerships: "Confirmed partners", registrations: "Registrations and verification dates", financialSummary: "Financial summary and reporting period" };
const emptyReview = (): GrantNoticeReview => ({ sourceUrl: "", sourceExcerpt: "", component: "", componentAwardLimit: 0, deadline: "", applicantType: "organization", criteria: [{ requirement: "", result: "unknown", evidenceRef: "" }], completeNoticeReviewed: false, requestedAmount: null, budgetSourceRef: "", fundingFeatures: [] });

export function GrantEligibilityReviewPanel({ applicationId }: { applicationId: string }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const founder = ["founder", "owner"].includes(String(user?.role).toLowerCase()) || user?.email?.toLowerCase() === "service@ifcdc.org";
  const assessment = useQuery({ queryKey: ["grant-eligibility", applicationId], queryFn: () => grantsApi.applicationEligibility(applicationId) });
  const [facts, setFacts] = useState<GrantFact[]>([]);
  const [review, setReview] = useState<GrantNoticeReview>(emptyReview);
  const [attested, setAttested] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    setFacts(assessment.data?.profile?.facts ?? []);
    setReview(assessment.data?.review ? { ...assessment.data.review, completeNoticeReviewed: false } : emptyReview());
    setAttested(false);
  }, [applicationId, assessment.data?.profile?.reviewedAt, assessment.data?.review?.reviewedAt]);
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["grant-eligibility"] });
    qc.invalidateQueries({ queryKey: ["grant-opportunity-finder"] });
    qc.invalidateQueries({ queryKey: ["grant-writer-studio"] });
  };
  const saveProfile = useMutation({ mutationFn: () => grantsApi.saveVerifiedProfile(facts.filter((f) => f.value.trim() || f.sourceRef.trim())), onSuccess: () => { setMessage("Organization facts confirmed. Review eligibility against these facts next."); invalidate(); }, onError: (e: Error) => setMessage(e.message) });
  const saveReview = useMutation({ mutationFn: () => grantsApi.saveEligibilityReview(assessment.data!.opportunity!.id, review), onSuccess: () => { setMessage("Eligibility review saved. This does not approve or submit an application."); invalidate(); }, onError: (e: Error) => setMessage(e.message) });
  function updateFact(key: GrantFactKey, field: "value" | "sourceRef", value: string) {
    setFacts((prev) => { const found = prev.find((f) => f.key === key) ?? { key, value: "", sourceRef: "" }; return [...prev.filter((f) => f.key !== key), { ...found, [field]: value }]; });
    setAttested(false);
  }
  const data = assessment.data;
  return <div className="hq-panel" style={{ padding: "1rem", marginBottom: "1rem" }}>
    <h4>Eligibility and verified organization facts</h4>
    <p role="status">{assessment.isLoading ? "Checking eligibility…" : assessment.isError ? "Eligibility review unavailable; drafting is paused." : data?.status === "eligible" ? "Eligible based on Founder-reviewed evidence" : data?.status === "ineligible" ? "Eligibility condition not met" : "Eligibility needs review"}</p>
    {data?.reasons.length ? <ul>{data.reasons.map((r) => <li key={r}>{r}</li>)}</ul> : null}
    <p className="hq-muted-text">Fit scores help research; they do not prove eligibility or predict an award. Review every condition in the full official notice.</p>
    {data?.opportunity?.url && /^https:\/\//.test(data.opportunity.url) && <a href={data.opportunity.url} target="_blank" rel="noopener noreferrer">Open funding opportunity</a>}
    {message && <p role="status">{message}</p>}
    <details>
      <summary>1. Confirm IFCDC facts from supporting documents</summary>
      <p>Legal name, tax status, service area and programs are required. Leave other facts blank when unverified. Use a document ID, vault reference or source URL; do not paste credentials.</p>
      {GRANT_FACT_KEYS.map((key) => <div key={key} style={{ marginTop: "0.75rem" }}>
        <label>{labels[key]}<textarea className="hq-input" rows={2} maxLength={6000} disabled={!founder} value={facts.find((f) => f.key === key)?.value ?? ""} onChange={(e) => updateFact(key, "value", e.target.value)} /></label>
        <label>Supporting document reference for {labels[key].toLowerCase()}<input className="hq-input" maxLength={1000} disabled={!founder} value={facts.find((f) => f.key === key)?.sourceRef ?? ""} onChange={(e) => updateFact(key, "sourceRef", e.target.value)} /></label>
      </div>)}
      {founder && <><label><input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} /> I checked these facts against the referenced documents.</label><button type="button" className="hq-btn hq-btn-secondary" disabled={!attested || saveProfile.isPending} onClick={() => saveProfile.mutate()}>Confirm organization facts</button></>}
      {data?.profile && <p>Confirmed by {data.profile.reviewedBy} on {data.profile.reviewedAt.slice(0, 10)}. Updating facts requires a fresh eligibility review.</p>}
    </details>
    <details>
      <summary>2. Review the official notice and all eligibility conditions</summary>
      <fieldset disabled={!founder || !data?.profile || saveReview.isPending} style={{ border: 0, padding: 0 }}>
        <label>Official notice URL<input className="hq-input" type="url" maxLength={2000} value={review.sourceUrl} onChange={(e) => setReview({ ...review, sourceUrl: e.target.value, completeNoticeReviewed: false })} /></label>
        <label>Funding component<input className="hq-input" maxLength={500} value={review.component} onChange={(e) => setReview({ ...review, component: e.target.value, completeNoticeReviewed: false })} /></label>
        <label>Component-specific maximum award from the notice<input className="hq-input" type="number" min="0" value={review.componentAwardLimit || ""} onChange={(e) => setReview({ ...review, componentAwardLimit: Number(e.target.value), completeNoticeReviewed: false })} /></label>
        <label>Official deadline (YYYY-MM-DD or rolling)<input className="hq-input" value={review.deadline} maxLength={10} onChange={(e) => setReview({ ...review, deadline: e.target.value, completeNoticeReviewed: false })} /></label>
        <label>Eligible recipient<select className="hq-input" value={review.applicantType} onChange={(e) => setReview({ ...review, applicantType: e.target.value as GrantNoticeReview["applicantType"], completeNoticeReviewed: false })}><option value="organization">Nonprofit / organization (check IFCDC specifically)</option><option value="individual">Individual / student scholarship</option><option value="school">School / educational institution only</option></select></label>
        <label>Official eligibility text and page references<textarea className="hq-input" rows={5} maxLength={15000} value={review.sourceExcerpt} onChange={(e) => setReview({ ...review, sourceExcerpt: e.target.value, completeNoticeReviewed: false })} /></label>
        {review.criteria.map((c, i) => <div key={i} style={{ margin: "0.75rem 0" }}>
          <label>Eligibility condition {i + 1}<input className="hq-input" value={c.requirement} maxLength={2000} onChange={(e) => setReview({ ...review, completeNoticeReviewed: false, criteria: review.criteria.map((x, n) => n === i ? { ...x, requirement: e.target.value } : x) })} /></label>
          <label>Finding for condition {i + 1}<select className="hq-input" value={c.result} onChange={(e) => setReview({ ...review, completeNoticeReviewed: false, criteria: review.criteria.map((x, n) => n === i ? { ...x, result: e.target.value as typeof c.result } : x) })}><option value="unknown">Unknown — evidence needed</option><option value="met">Met — evidence referenced</option><option value="unmet">Not met</option></select></label>
          <label>Evidence reference or reason for condition {i + 1}<input className="hq-input" value={c.evidenceRef} maxLength={1000} onChange={(e) => setReview({ ...review, completeNoticeReviewed: false, criteria: review.criteria.map((x, n) => n === i ? { ...x, evidenceRef: e.target.value } : x) })} /></label>
          {review.criteria.length > 1 && <button type="button" className="hq-btn hq-btn-ghost" onClick={() => setReview({ ...review, completeNoticeReviewed: false, criteria: review.criteria.filter((_, n) => n !== i) })}>Remove condition {i + 1}</button>}
        </div>)}
        <button type="button" className="hq-btn hq-btn-secondary" disabled={review.criteria.length >= 40} onClick={() => setReview({ ...review, completeNoticeReviewed: false, criteria: [...review.criteria, { requirement: "", result: "unknown", evidenceRef: "" }] })}>Add eligibility condition</button>
        <label>Supported request amount (optional; leave blank until budget is verified)<input className="hq-input" type="number" min="0" value={review.requestedAmount ?? ""} onChange={(e) => setReview({ ...review, completeNoticeReviewed: false, requestedAmount: e.target.value === "" ? null : Number(e.target.value) })} /></label>
        <label>Budget document reference<input className="hq-input" maxLength={1000} value={review.budgetSourceRef} onChange={(e) => setReview({ ...review, completeNoticeReviewed: false, budgetSourceRef: e.target.value })} /></label>
        <p>Funding features explicitly supported by the notice:</p>
        {(["multi_year", "renewable", "general_operating", "admin_costs"] as const).map((f) => <label key={f} style={{ display: "block" }}><input type="checkbox" checked={review.fundingFeatures.includes(f)} onChange={(e) => setReview({ ...review, completeNoticeReviewed: false, fundingFeatures: e.target.checked ? [...review.fundingFeatures, f] : review.fundingFeatures.filter((x) => x !== f) })} /> {f.replace(/_/g, " ")}</label>)}
        <label style={{ display: "block" }}><input type="checkbox" checked={review.completeNoticeReviewed} onChange={(e) => setReview({ ...review, completeNoticeReviewed: e.target.checked })} /> I reviewed the complete current notice, recorded every eligibility condition, and checked the evidence and component-specific limits.</label>
        <button type="button" className="hq-btn hq-btn-primary" disabled={!review.completeNoticeReviewed} onClick={() => saveReview.mutate()}>Save eligibility review</button>
      </fieldset>
      {!founder && <p>Founder access is required to confirm facts and eligibility.</p>}
      {data?.review && <p>Last reviewed by {data.review.reviewedBy} on {data.review.reviewedAt.slice(0, 10)}. Recheck funder amendments before submission.</p>}
    </details>
  </div>;
}
