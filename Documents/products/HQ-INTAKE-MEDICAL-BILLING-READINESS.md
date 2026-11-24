# HQ Intake Center — Medical & Billing Readiness

**Status:** Prototype only — **not ready for billing** · **not for real PHI**  
**HQ route:** `/hq/intake`  
**API:** `/api/hq/intake-medical`  
**Auth:** existing HQ session (`@ifcdc/auth` / `hqAuthRequired`). No duplicate auth.  
**Access:** Founder (`owner`/`founder`) and authorized `billing` role only.  
**Tenant:** `ifcdc-intake-medical` tables (`hq_intake_*`), isolated from grants, HR, People, Finance, and Detroit.  
**Data:** synthetic records in tests only. Production boot does **not** seed patients.  
**Branch:** `hq/intake-medical-billing-readiness` from `origin/main`. Not merged. Not deployed.

Aura is **not** a SAM Entity Administrator and is **not** a licensed coder or biller. This workspace does not submit claims, change SAM.gov, send external email, merge to `main`, or deploy.

---

## Phase 1 — Readiness report (repo facts vs Unknown)

Facts below are from HQ docs/code on `origin/main` plus this prototype. If it is not in the repo, it is **Unknown**.

### Intended services

| Question | Finding |
|---|---|
| Clinical medical practice vs nonclinical case management | **Unknown as a billing decision.** HQ has a Client & Case Management module (`/hq/clients`, `clientCaseEngine`) and grant language about mentoring, housing, outreach, and case management. A grant draft notes HIPAA / Monmouth ACTS referrals as **NOT STATED as demonstrated** (`MONMOUTH-CC-13-2027-PACKAGE-DRAFT-NOT-SUBMITTED.md`). Legacy `health-system.routes.ts` uses Prisma API-key roles (`CLINICIAN`, `CASE_MANAGER`, `CHW`) and is **not** this workspace; it is not evidence of licensed clinical billing. |
| Licensed providers on staff | **Unknown** |
| NPI (individual / organization) | **Unknown** — not in HQ product docs or schema as a verified enrollment record |
| Taxonomy codes | **Unknown** |
| Payer enrollment / contracts | **Unknown** |
| Service location for billing | **Unknown** (prototype stores `Unknown`) |
| IFCDC enrolled / eligible to bill any payer | **Unknown — do not assume yes** |

### Insurers and programs

| Program | Finding |
|---|---|
| NJ Medicaid | **Unknown** — no enrollment artifact in repo |
| Michigan Medicaid / other MI payers | **Unknown** |
| Commercial insurers | **Unknown** |
| Clearinghouse / billing partner selected | **Unknown** — no Change Healthcare, Waystar, Stedi, Office Ally, or similar connector in this prototype; claim submit is hard-blocked |

### Hosting, storage, AI, comms vs HIPAA BAA

| System | What the repo shows | HIPAA / BAA |
|---|---|---|
| Render (`ifcdc-hq`, `https://ifcdc-hq-wst6.onrender.com`) | Production HQ web service, Ohio, SQLite disk `ifcdc-hq-data` at `/opt/render/project/src/data` (`render.yaml`) | **Unknown / not verified.** No BAA, Business Associate, or HIPAA-eligible Render plan is documented in HQ product docs. Treat Render as **not HIPAA-cleared** for real PHI unless the Founder files a BAA. |
| SQLite on Render disk | HQ operational database for grants, people, this prototype’s `hq_intake_*` tables | **Unknown / not a HIPAA-designated store.** Disk persistence is operational, not a covered-entity EHR. |
| Aura / OpenAI (`AURA_OPENAI_API_KEY`, in-process OpenAI — Phase 7) | Executive chat, grant writer, voice, embeddings | **Unknown / not in place as HIPAA-eligible.** No OpenAI BAA is documented in this repo. **Do not put PHI in Aura prompts, logs, analytics, or error messages.** This prototype’s coding path is **local rules only** and does not call OpenAI. |
| Postmark / Resend | Transactional HQ email (`POSTMARK_SERVER_TOKEN`, Resend fallback) | **Unknown / not verified for PHI.** Grant and project mail exist; they are not a medical claims channel. This prototype sends **no** email. |
| Twilio | Voice/SMS for HQ | **Unknown / not verified for PHI** in this billing context |
| Legacy health-system Prisma routes | Separate API-key health module | **Not wired** to this workspace; do not treat as HIPAA-ready EHR |

**Conclusion:** HIPAA BAAs and safeguards for OpenAI and Render are **not documented as in place**. Prototype is allowed with **synthetic data only**. UI and API both state **not ready for billing / not for real PHI**.

---

## Phase 2 — Safe prototype (implemented)

Create / view / edit:

1. **Intake** — synthetic case label, service intent (defaults Unknown)
2. **Insurance** — payer/member metadata; eligibility always **Unknown**
3. **Clinical documentation** — human-authored text only; Aura does not invent notes
4. **Coding assistance** — suggestions + code-set version (**Unknown** until a licensed codebook is on file) + rationale + missing flags + **human approval required**. Card-only input is refused.
5. **Billing preparation** — draft claim, edits, attachments metadata, denial tracking, audit. **Submit returns 409. Nothing is transmitted.**

### Data model (HQ SQLite)

`hq_intake_cases`, `hq_intake_insurance`, `hq_intake_clinical`, `hq_intake_coding`, `hq_intake_claims`, `hq_intake_audit`  
All rows carry `tenant_id = ifcdc-intake-medical`. Cross-tenant access is denied.

### Security / BAA blockers (must stay closed)

- No real insurance cards, patient details, clinical notes, or claims in HQ or any AI
- No production payer or clearinghouse accounts
- No claim submission, certification, external email, SAM.gov changes, merge-to-main as production, or deploy from this work
- No coverage or payment guarantee
- No PHI in Aura prompts, logs, analytics, or error messages (audit stores ids/actions only)
- Do not use existing Client & Case Management or grant tables as a medical record
- Do not reuse `health-system.routes.ts` API keys for this module

### Human roles

| Role | Access |
|---|---|
| Founder (`owner` / `founder`) | Full prototype |
| Authorized billing (`billing`) | Full prototype |
| Grants Operator, HR, Finance, Detroit/programs, employee | **Denied** (403) |
| Aura | Not a coder, biller, or SAM Entity Administrator |

### Workflow

1. Founder (or billing) opens `/hq/intake` and acknowledges the banner.  
2. Create synthetic intake only.  
3. Optional insurance metadata — eligibility stays Unknown.  
4. Human clinical documentation — never invented.  
5. Request coding suggestions (local). Approve in HQ; still not billable.  
6. Prepare a **draft** claim, edits, attachment names, denial notes.  
7. Submit remains disabled until BAAs, enrollment, NPI, contracts, and a clearinghouse are **documented and verified** in a later Founder-authorized phase.

### Phased plan (later — not this PR)

| Phase | Gate | This PR |
|---|---|---|
| 0 Readiness | Report Unknowns | Done |
| 1 Synthetic prototype | BAA unverified ⇒ synthetic only | Done, unmerged |
| 2 Legal / HIPAA | Founder-signed BAAs (Render, OpenAI if used, email, billing vendor) | Not started |
| 3 Enrollment | NPI, taxonomy, payer contracts, service location on file | Unknown |
| 4 Clearinghouse sandbox | Named partner, test payer only | Unknown |
| 5 Production billing | Explicit Founder authorization | **Not ready** |

---

## Decisions needed from Founder

1. Are intended services **clinical billing** or **nonclinical case management** (or both, separately)?  
2. Who are the licensed providers, if any? Supply NPI / taxonomy or mark **Unknown**.  
3. Which payers (NJ Medicaid, Michigan, commercial) should even be in scope?  
4. Which billing/clearinghouse partner, if any?  
5. Will IFCDC execute HIPAA BAAs with Render, OpenAI, Postmark/Resend, Twilio, and a billing vendor **before** any real PHI?  
6. Who is the authorized `billing` human besides the Founder?  
7. Confirm: no production deploy of this branch until BAAs and enrollment are real.

Do **not** mark this product ready for billing.
