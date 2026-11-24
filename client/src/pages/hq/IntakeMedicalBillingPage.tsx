import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import HQLayout from "../../layouts/HQLayout";
import { HqPanel } from "../../components/hq/HqPanel";
import { intakeMedicalApi } from "../../api/intakeMedicalBillingApi";
import { NEED_TYPES, SAFETY_COPY } from "@shared/hqIntake";
import { useAuth } from "../../auth/AuthContext";

const TABS = [
  "Intake",
  "Queue",
  "Assignment",
  "Referrals",
  "Follow-up",
  "Next steps",
  "Clinical",
  "Insurance",
  "Coding",
  "Billing prep",
] as const;

const NEED_LABELS: Record<string, string> = {
  youth_mentoring: "Youth mentoring",
  transitional_housing: "Transitional housing",
  economic_development_employment: "Economic development / employment",
  scholarships_education: "Scholarships / education",
  community_arts_media_radio: "Community arts / media / radio",
  mental_health_support_case_management: "Mental-health support and case management (referral pathway)",
  medical_clinical_referral: "Medical / clinical referrals (referral pathway)",
  other: "Other (participant-identified)",
};

const IntakeMedicalBillingPage: React.FC = () => {
  const client = useQueryClient();
  const { hasPermission } = useAuth();
  const canClinical = hasPermission("hq.intake.clinical");
  const canBilling = hasPermission("hq.intake.medical");
  const [tab, setTab] = useState<(typeof TABS)[number]>("Intake");
  const [selectedId, setSelectedId] = useState("");
  const [medicalId, setMedicalId] = useState("");
  const [label, setLabel] = useState("SYNTHETIC Participant River");
  const [submitterKind, setSubmitterKind] = useState<"staff" | "participant">("staff");
  const [consentServices, setConsentServices] = useState(true);
  const [consentShareOutside, setConsentShareOutside] = useState(false);
  const [contactPrefs, setContactPrefs] = useState("sms");
  const [language, setLanguage] = useState("en");
  const [accessibility, setAccessibility] = useState("");
  const [goals, setGoals] = useState("");
  const [referralSource, setReferralSource] = useState("");
  const [requestedSupport, setRequestedSupport] = useState("");
  const [urgentPhysical, setUrgentPhysical] = useState(false);
  const [urgentBehavioral, setUrgentBehavioral] = useState(false);
  const [needs, setNeeds] = useState<string[]>(["youth_mentoring"]);
  const [otherNeed, setOtherNeed] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [ownerLabel, setOwnerLabel] = useState("Unknown");
  const [department, setDepartment] = useState("youth_mentoring");
  const [nextAction, setNextAction] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [providerLabel, setProviderLabel] = useState("Unknown");
  const [payer, setPayer] = useState("");
  const [memberId, setMemberId] = useState("");
  const [note, setNote] = useState("");
  const [dx, setDx] = useState("");
  const [px, setPx] = useState("");
  const [medicalLabel, setMedicalLabel] = useState("SYNTHETIC Patient Alpha");
  const [message, setMessage] = useState("");
  const [coding, setCoding] = useState<Record<string, unknown> | null>(null);

  const list = useQuery({ queryKey: ["intake-coordination"], queryFn: intakeMedicalApi.listCoordination });
  const bundle = useQuery({
    queryKey: ["intake-coordination", selectedId],
    queryFn: () => intakeMedicalApi.getCoordination(selectedId),
    enabled: Boolean(selectedId),
  });
  const audit = useQuery({ queryKey: ["intake-audit"], queryFn: intakeMedicalApi.audit });
  const medicalList = useQuery({
    queryKey: ["intake-medical-cases"],
    queryFn: intakeMedicalApi.list,
    enabled: canBilling || canClinical,
  });

  const intake = bundle.data as {
    suggestedRoutes?: Array<{ departmentLabel: string; contactName: string; contactPhone: string; needType: string }>;
    crisis?: { display911?: boolean; display988?: boolean; autoContact911?: boolean; autoContact988?: boolean };
    participantNextSteps?: {
      assignedContactName: string;
      assignedContactPhone: string;
      assignedContactEmail: string;
      nextAction: string;
      followUpDate: string;
      workflowStatus: string;
    };
    codingFromIntake?: { refused?: boolean; reason?: string };
    clinicalArea?: { access?: string };
    intake?: { workflowStatus?: string; consentShareOutside?: boolean };
  } | undefined;

  const saveIntake = useMutation({
    mutationFn: () =>
      intakeMedicalApi.createCoordination({
        displayLabel: label,
        submitterKind,
        consentServices,
        consentShareOutside,
        contactPrefs,
        language,
        accessibility,
        goals,
        referralSource,
        requestedSupport,
        urgentPhysical,
        urgentBehavioral,
        needs: needs.map((needType) => ({ needType, otherText: needType === "other" ? otherNeed : "" })),
      }),
    onSuccess: async (data: { intake?: { id: string } }) => {
      const id = data.intake?.id;
      if (id) setSelectedId(id);
      setMessage("Synthetic intake saved. Suggested routes need staff confirmation. Not for real PHI.");
      setTab("Queue");
      await client.invalidateQueries({ queryKey: ["intake-coordination"] });
    },
    onError: (error: Error) => setMessage(error.message),
  });

  const crisis = intake?.crisis;
  const visibleTabs = useMemo(
    () =>
      TABS.filter((item) => {
        if (item === "Clinical" || item === "Insurance") return true;
        if (item === "Coding" || item === "Billing prep") return true;
        return true;
      }),
    [],
  );

  return (
    <HQLayout>
      <div className="hq-page hq-intake-page">
        <header className="hq-page-header">
          <h1>Participant Intake Center</h1>
          <p className="hq-text-muted">Universal needs, department routing, and referrals. Medical coding is a separate future workflow.</p>
        </header>
        <div className="hq-panel hq-intake-banner" role="status">
          <strong>HIPAA COMPLIANCE DISABLED · SYNTHETIC RECORDS ONLY · NOT FOR REAL PHI</strong>
          <p>{intakeMedicalApi.banner}</p>
          <p><strong>{SAFETY_COPY.notAClinician}</strong></p>
          <p>{SAFETY_COPY.noCodingFromIntake}</p>
        </div>
        {(urgentPhysical || crisis?.display911) && (
          <div className="hq-panel hq-intake-crisis" role="alert">
            <strong>911</strong>
            <p>{SAFETY_COPY.urgentPhysical}</p>
            <p>Auto-contact 911: <strong>No</strong>. This screen does not place a call.</p>
          </div>
        )}
        {(urgentBehavioral || crisis?.display988) && (
          <div className="hq-panel hq-intake-crisis" role="alert">
            <strong>988</strong>
            <p>{SAFETY_COPY.urgentBehavioral}</p>
            <p>Auto-contact 988: <strong>No</strong>. This screen does not place a call or send a text.</p>
          </div>
        )}
        <HqPanel title="Intake workspace" subtitle="Prototype · staff or participant · mobile-friendly">
          <div className="hq-intake-tabs">
            {visibleTabs.map((item) => (
              <button key={item} type="button" className={tab === item ? "hq-btn hq-btn-primary" : "hq-btn"} onClick={() => setTab(item)}>
                {item}
              </button>
            ))}
          </div>
          {message ? <p className="hq-intake-message">{message}</p> : null}

          {tab === "Intake" && (
            <form
              className="hq-intake-form"
              onSubmit={(event) => {
                event.preventDefault();
                saveIntake.mutate();
              }}
            >
              <label>
                Who is completing this form?
                <select value={submitterKind} onChange={(event) => setSubmitterKind(event.target.value as "staff" | "participant")}>
                  <option value="staff">Staff</option>
                  <option value="participant">Participant</option>
                </select>
              </label>
              <label>
                Synthetic display label
                <input value={label} onChange={(event) => setLabel(event.target.value)} required />
              </label>
              <label className="hq-intake-check">
                <input type="checkbox" checked={consentServices} onChange={(event) => setConsentServices(event.target.checked)} />
                Consent for IFCDC to coordinate requested services
              </label>
              <label className="hq-intake-check">
                <input type="checkbox" checked={consentShareOutside} onChange={(event) => setConsentShareOutside(event.target.checked)} />
                Consent to share the minimum needed with an outside provider
              </label>
              <label>
                Contact preference
                <input value={contactPrefs} onChange={(event) => setContactPrefs(event.target.value)} />
              </label>
              <label>
                Language
                <input value={language} onChange={(event) => setLanguage(event.target.value)} />
              </label>
              <label>
                Accessibility
                <input value={accessibility} onChange={(event) => setAccessibility(event.target.value)} />
              </label>
              <label>
                Goals
                <textarea value={goals} onChange={(event) => setGoals(event.target.value)} rows={3} />
              </label>
              <label>
                Referral source
                <input value={referralSource} onChange={(event) => setReferralSource(event.target.value)} />
              </label>
              <label>
                Requested support
                <textarea value={requestedSupport} onChange={(event) => setRequestedSupport(event.target.value)} rows={3} />
              </label>
              <fieldset>
                <legend>Needs</legend>
                {NEED_TYPES.map((need) => (
                  <label key={need} className="hq-intake-check">
                    <input
                      type="checkbox"
                      checked={needs.includes(need)}
                      onChange={(event) =>
                        setNeeds((current) =>
                          event.target.checked ? [...current, need] : current.filter((item) => item !== need),
                        )
                      }
                    />
                    {NEED_LABELS[need]}
                  </label>
                ))}
                {needs.includes("other") ? (
                  <label>
                    Other need (participant-identified)
                    <input value={otherNeed} onChange={(event) => setOtherNeed(event.target.value)} />
                  </label>
                ) : null}
              </fieldset>
              <label className="hq-intake-check">
                <input type="checkbox" checked={urgentPhysical} onChange={(event) => setUrgentPhysical(event.target.checked)} />
                Immediate physical danger or medical emergency (show 911 — do not auto-call)
              </label>
              <label className="hq-intake-check">
                <input type="checkbox" checked={urgentBehavioral} onChange={(event) => setUrgentBehavioral(event.target.checked)} />
                Behavioral-health crisis (show 988 — do not auto-call)
              </label>
              <button type="submit" className="hq-btn hq-btn-primary">Save synthetic intake</button>
            </form>
          )}

          {tab === "Queue" && (
            <div>
              <p>Workflow: intake → assignment → referral → follow-up → service connection → closure.</p>
              <ul className="hq-intake-list">
                {(list.data?.intakes ?? []).map((row) => (
                  <li key={row.id}>
                    <button type="button" className="hq-btn" onClick={() => { setSelectedId(row.id); setTab("Assignment"); }}>
                      {row.displayLabel} · {row.workflowStatus} · {row.assignedDepartment || "Unassigned"}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {tab === "Assignment" && (
            <form
              className="hq-intake-form"
              onSubmit={async (event) => {
                event.preventDefault();
                if (!selectedId) return setMessage("Save an intake first.");
                try {
                  await intakeMedicalApi.confirmAssignment(selectedId, {
                    department,
                    ownerId: ownerId || undefined,
                    ownerLabel: ownerLabel || "Unknown",
                    contactPhone: "Unknown",
                    contactEmail: "Unknown",
                    nextAction,
                    followUpDate,
                  });
                  setMessage("Assignment confirmed by staff. Department contacts stay Unknown unless documented.");
                  await bundle.refetch();
                  await client.invalidateQueries({ queryKey: ["intake-coordination"] });
                } catch (error) {
                  setMessage(error instanceof Error ? error.message : "Assignment failed");
                }
              }}
            >
              <p>Suggested routes are for staff review. Confirm owner, next action, and follow-up date. Do not invent contact names or phones.</p>
              <ul>
                {(intake?.suggestedRoutes ?? []).map((route) => (
                  <li key={route.needType}>
                    {NEED_LABELS[route.needType] || route.needType} → {route.departmentLabel}. Contact: {route.contactName} / {route.contactPhone}
                  </li>
                ))}
              </ul>
              <label>
                Department
                <select value={department} onChange={(event) => setDepartment(event.target.value)}>
                  {NEED_TYPES.map((need) => (
                    <option key={need} value={need}>{NEED_LABELS[need]}</option>
                  ))}
                </select>
              </label>
              <label>
                Owner id (must match a real HQ user; leave blank if Unknown)
                <input value={ownerId} onChange={(event) => setOwnerId(event.target.value)} placeholder="Unknown" />
              </label>
              <label>
                Owner display name
                <input value={ownerLabel} onChange={(event) => setOwnerLabel(event.target.value)} />
              </label>
              <label>
                Next action
                <input value={nextAction} onChange={(event) => setNextAction(event.target.value)} required />
              </label>
              <label>
                Follow-up date
                <input type="date" value={followUpDate} onChange={(event) => setFollowUpDate(event.target.value)} required />
              </label>
              <button type="submit" className="hq-btn hq-btn-primary">Confirm assignment</button>
            </form>
          )}

          {tab === "Referrals" && (
            <form
              className="hq-intake-form"
              onSubmit={async (event) => {
                event.preventDefault();
                if (!selectedId) return setMessage("Save an intake first.");
                try {
                  await intakeMedicalApi.referral(selectedId, {
                    providerLabel,
                    consentShareOutside,
                  });
                  setMessage("Outside referral recorded locally. No provider was contacted.");
                  await bundle.refetch();
                } catch (error) {
                  setMessage(error instanceof Error ? error.message : "Referral blocked");
                }
              }}
            >
              <p>Outside referrals require documented consent. This prototype never emails or calls a provider.</p>
              <label>
                Outside provider label
                <input value={providerLabel} onChange={(event) => setProviderLabel(event.target.value)} />
              </label>
              <p>Consent on file: {intake?.intake?.consentShareOutside || consentShareOutside ? "yes" : "no"}</p>
              <button type="submit" className="hq-btn hq-btn-primary">Record outside referral</button>
            </form>
          )}

          {tab === "Follow-up" && (
            <div className="hq-intake-form">
              <button
                type="button"
                className="hq-btn hq-btn-primary"
                onClick={async () => {
                  if (!selectedId) return setMessage("Save an intake first.");
                  await intakeMedicalApi.followup(selectedId, { summary: "SYNTHETIC follow-up completed", serviceConnected: true });
                  setMessage("Follow-up marked complete. Service connection recorded.");
                  await bundle.refetch();
                }}
              >
                Complete follow-up (service connected)
              </button>
              <button
                type="button"
                className="hq-btn"
                onClick={async () => {
                  if (!selectedId) return setMessage("Save an intake first.");
                  await intakeMedicalApi.followup(selectedId, { summary: "SYNTHETIC closed", close: true });
                  setMessage("Intake closed.");
                  await bundle.refetch();
                }}
              >
                Close intake
              </button>
            </div>
          )}

          {tab === "Next steps" && (
            <div>
              <h3>Participant next steps</h3>
              <p>Assigned IFCDC contact: <strong>{intake?.participantNextSteps?.assignedContactName || "Unknown"}</strong></p>
              <p>Phone: {intake?.participantNextSteps?.assignedContactPhone || "Unknown"}</p>
              <p>Email: {intake?.participantNextSteps?.assignedContactEmail || "Unknown"}</p>
              <p>Next action: {intake?.participantNextSteps?.nextAction || "Unknown"}</p>
              <p>Follow-up: {intake?.participantNextSteps?.followUpDate || "Unknown"}</p>
              <p>Status: {intake?.participantNextSteps?.workflowStatus || "intake"}</p>
            </div>
          )}

          {tab === "Clinical" && (
            canClinical ? (
              <form
                className="hq-intake-form"
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (!medicalId) return setMessage("Create a separate medical case first (billing/clinical workflow).");
                  await intakeMedicalApi.clinical(medicalId, { noteText: note, documentedDiagnoses: dx, documentedProcedures: px });
                  setMessage("Human-authored synthetic documentation saved. Aura did not invent clinical text.");
                }}
              >
                <p>{SAFETY_COPY.restrictedClinical}</p>
                <label>
                  Clinical note (human authored)
                  <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={4} />
                </label>
                <label>
                  Documented diagnoses
                  <textarea value={dx} onChange={(event) => setDx(event.target.value)} rows={2} />
                </label>
                <label>
                  Documented procedures
                  <textarea value={px} onChange={(event) => setPx(event.target.value)} rows={2} />
                </label>
                <button type="submit" className="hq-btn hq-btn-primary">Save clinical documentation</button>
              </form>
            ) : (
              <p>Access denied. Clinical notes stay in a separately restricted area.</p>
            )
          )}

          {tab === "Insurance" && (
            canClinical ? (
              <form
                className="hq-intake-form"
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (!medicalId) return setMessage("Create a separate medical case first.");
                  await intakeMedicalApi.insurance(medicalId, { payerName: payer, memberId });
                  setMessage("Insurance stored as synthetic metadata. Codes are not inferred from the card.");
                }}
              >
                <label>
                  Payer name
                  <input value={payer} onChange={(event) => setPayer(event.target.value)} />
                </label>
                <label>
                  Member id (synthetic only)
                  <input value={memberId} onChange={(event) => setMemberId(event.target.value)} />
                </label>
                <button type="submit" className="hq-btn hq-btn-primary">Save insurance</button>
              </form>
            ) : (
              <p>Access denied. Insurance records are clinical-restricted. Billing does not receive full clinical data by default.</p>
            )
          )}

          {tab === "Coding" && (
            canBilling ? (
              <div>
                <p>{SAFETY_COPY.noCodingFromIntake}</p>
                <p>{String(intake?.codingFromIntake?.reason || "")}</p>
                <button
                  type="button"
                  className="hq-btn hq-btn-primary"
                  onClick={async () => {
                    if (!medicalId) return setMessage("Create a separate medical case first.");
                    const result = await intakeMedicalApi.coding(medicalId);
                    setCoding(result as Record<string, unknown>);
                    setMessage(String((result as { reason?: string }).reason || "Coding assist complete."));
                  }}
                >
                  Request coding suggestions (separate medical case)
                </button>
                {coding ? <pre className="hq-intake-pre">{JSON.stringify(coding, null, 2)}</pre> : null}
              </div>
            ) : (
              <p>Access denied. Coding is a separate billing workflow.</p>
            )
          )}

          {tab === "Billing prep" && (
            canBilling ? (
              <div className="hq-intake-form">
                <label>
                  Separate medical case label
                  <input value={medicalLabel} onChange={(event) => setMedicalLabel(event.target.value)} />
                </label>
                <button
                  type="button"
                  className="hq-btn"
                  onClick={async () => {
                    const created = await intakeMedicalApi.saveCase({ displayLabel: medicalLabel, serviceIntent: "Unknown" }) as { intake?: { id: string } };
                    if (created.intake?.id) setMedicalId(created.intake.id);
                    setMessage("Separate medical billing case saved. Not ready for billing.");
                    await medicalList.refetch();
                  }}
                >
                  Save separate medical case
                </button>
                <button
                  type="button"
                  className="hq-btn hq-btn-primary"
                  onClick={async () => {
                    if (!medicalId) return setMessage("Save a medical case first.");
                    const result = await intakeMedicalApi.claim(medicalId, {
                      status: "draft",
                      edits: [{ note: "SYNTHETIC edit" }],
                      attachments: [{ name: "synthetic-attachment.txt" }],
                      denials: [{ reason: "Unknown — no payer response" }],
                    });
                    setMessage(JSON.stringify(result));
                  }}
                >
                  Save draft claim
                </button>
                <button type="button" className="hq-btn" disabled title="Claim submission is disabled">
                  Submit claim (disabled)
                </button>
                <ul>
                  {(medicalList.data?.cases ?? []).map((row) => (
                    <li key={row.id}>
                      <button type="button" className="hq-btn" onClick={() => setMedicalId(row.id)}>
                        {row.displayLabel}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p>Access denied. Draft claims are billing-staff only. Submit remains blocked.</p>
            )
          )}

          <h3>Audit (ids/actions only)</h3>
          <ul className="hq-intake-audit">
            {(audit.data?.events ?? []).slice(0, 12).map((event) => (
              <li key={`${event.action}-${event.createdAt}`}>{event.createdAt} · {event.action}</li>
            ))}
          </ul>
        </HqPanel>
      </div>
    </HQLayout>
  );
};

export default IntakeMedicalBillingPage;
