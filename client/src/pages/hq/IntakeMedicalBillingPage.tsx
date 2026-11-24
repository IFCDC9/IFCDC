import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import HQLayout from "../../layouts/HQLayout";
import { HqPanel } from "../../components/hq/HqPanel";
import { intakeMedicalApi } from "../../api/intakeMedicalBillingApi";

const TABS = ["Intake", "Insurance", "Clinical", "Coding", "Billing prep"] as const;

const IntakeMedicalBillingPage: React.FC = () => {
  const client = useQueryClient();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Intake");
  const [selectedId, setSelectedId] = useState<string>("");
  const [label, setLabel] = useState("SYNTHETIC Patient Alpha");
  const [intent, setIntent] = useState("Unknown");
  const [payer, setPayer] = useState("");
  const [memberId, setMemberId] = useState("");
  const [note, setNote] = useState("");
  const [dx, setDx] = useState("");
  const [px, setPx] = useState("");
  const [message, setMessage] = useState("");
  const [coding, setCoding] = useState<Record<string, unknown> | null>(null);

  const list = useQuery({ queryKey: ["intake-medical-cases"], queryFn: intakeMedicalApi.list });
  const bundle = useQuery({
    queryKey: ["intake-medical-case", selectedId],
    queryFn: () => intakeMedicalApi.get(selectedId),
    enabled: Boolean(selectedId),
  });

  const saveCase = useMutation({
    mutationFn: () => intakeMedicalApi.saveCase({ id: selectedId || undefined, displayLabel: label, serviceIntent: intent }),
    onSuccess: async (data: { intake?: { id: string } }) => {
      const id = data.intake?.id;
      if (id) setSelectedId(id);
      setMessage("Synthetic intake saved. Not ready for billing.");
      await client.invalidateQueries({ queryKey: ["intake-medical-cases"] });
    },
    onError: (error: Error) => setMessage(error.message),
  });

  return (
    <HQLayout>
      <div className="hq-page">
        <header className="hq-page-header">
          <h1>Intake Center — Medical & Billing Readiness</h1>
          <p className="hq-text-muted">Founder / authorized billing role only. Isolated from grants, HR, and Detroit.</p>
        </header>
        <div className="hq-panel" style={{ borderColor: "var(--hq-gold)", marginBottom: "1rem", padding: "1rem" }}>
          <strong>NOT READY FOR BILLING · NOT FOR REAL PHI</strong>
          <p style={{ margin: "0.5rem 0 0" }}>{intakeMedicalApi.banner}</p>
        </div>
        <HqPanel title="Synthetic workspace" subtitle="Prototype records only">
          <p>
            Eligibility: <strong>Unknown</strong> until a payer responds. Provider enrollment, NPI, taxonomy, and contracts:
            <strong> Unknown</strong>. Do not upload insurance cards or patient files.
          </p>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", margin: "0.75rem 0" }}>
            {TABS.map((item) => (
              <button key={item} type="button" className={tab === item ? "hq-btn hq-btn-primary" : "hq-btn"} onClick={() => setTab(item)}>
                {item}
              </button>
            ))}
          </div>
          {message ? <p>{message}</p> : null}
          {tab === "Intake" && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                saveCase.mutate();
              }}
            >
              <label>
                Synthetic display label
                <input value={label} onChange={(event) => setLabel(event.target.value)} required />
              </label>
              <label>
                Service intent
                <input value={intent} onChange={(event) => setIntent(event.target.value)} />
              </label>
              <p>Service location, licensed providers, and billing enrollment remain Unknown unless the Founder documents them.</p>
              <button type="submit" className="hq-btn hq-btn-primary">Save synthetic intake</button>
            </form>
          )}
          {tab === "Insurance" && (
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                if (!selectedId) return setMessage("Save an intake first.");
                await intakeMedicalApi.insurance(selectedId, { payerName: payer, memberId });
                setMessage("Insurance stored as synthetic metadata. Eligibility remains Unknown. Codes are not inferred from the card.");
                await bundle.refetch();
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
              <p>NJ Medicaid / Michigan participation: Unknown. Never infer diagnosis or procedure codes from a card.</p>
              <button type="submit" className="hq-btn hq-btn-primary">Save insurance</button>
            </form>
          )}
          {tab === "Clinical" && (
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                if (!selectedId) return setMessage("Save an intake first.");
                await intakeMedicalApi.clinical(selectedId, { noteText: note, documentedDiagnoses: dx, documentedProcedures: px });
                setMessage("Human-authored synthetic documentation saved. Aura did not invent clinical text.");
                await bundle.refetch();
              }}
            >
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
          )}
          {tab === "Coding" && (
            <div>
              <p>Coding assistance is local rules only. It does not call Aura/OpenAI and cannot run from a card alone. Human approval is required.</p>
              <button
                type="button"
                className="hq-btn hq-btn-primary"
                onClick={async () => {
                  if (!selectedId) return setMessage("Save an intake first.");
                  const result = await intakeMedicalApi.coding(selectedId);
                  setCoding(result as Record<string, unknown>);
                  setMessage(String((result as { reason?: string }).reason || "Coding assist complete."));
                }}
              >
                Request coding suggestions
              </button>
              {coding ? (
                <pre style={{ whiteSpace: "pre-wrap", marginTop: "1rem" }}>{JSON.stringify(coding, null, 2)}</pre>
              ) : null}
            </div>
          )}
          {tab === "Billing prep" && (
            <div>
              <p>Draft claims, edits, attachments, and denial tracking only. Submit is permanently blocked in this prototype.</p>
              <button
                type="button"
                className="hq-btn hq-btn-primary"
                onClick={async () => {
                  if (!selectedId) return setMessage("Save an intake first.");
                  const result = await intakeMedicalApi.claim(selectedId, {
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
            </div>
          )}
          <h3>Cases</h3>
          <ul>
            {(list.data?.cases ?? []).map((row) => (
              <li key={row.id}>
                <button type="button" className="hq-btn" onClick={() => setSelectedId(row.id)}>
                  {row.displayLabel} · {row.status} · {row.serviceIntent}
                </button>
              </li>
            ))}
          </ul>
        </HqPanel>
      </div>
    </HQLayout>
  );
};

export default IntakeMedicalBillingPage;
