# HQ Universal Participant Intake & Service-Coordination Center

**Status:** Prototype only — **HIPAA Compliance Disabled** · **synthetic records only** · **not for real PHI** · **not ready for live sensitive intake**  
**HQ route:** `/hq/intake`  
**API:** `/api/hq/intake-medical` (coordination under `/coordination`; medical/billing remains a **separate** restricted workflow)  
**Auth:** existing HQ session (`@ifcdc/auth` / `hqAuthRequired`). No duplicate auth.  
**Tenant:** `ifcdc-intake-medical` (`hq_intake_*`), isolated from grants, HR, Detroit, finance, People.  
**Data:** synthetic records in tests only. Production boot does **not** seed participants.  
**Branch:** `hq/universal-participant-intake` from `origin/main` (PR #81 already merged). Do **not** merge as production. Do **not** deploy for live participants.

Staff and Aura organize needs and coordinate referrals. They **must not diagnose, recommend treatment, or replace a licensed clinician**. Medical/mental-health are **referral pathways**, not the whole app. Medical coding and claims stay a **separate future** workflow — never inferred from intake or insurance cards. This workspace does **not** send mail, submit claims, or contact providers.

---

## Screens

| Screen | What it does |
|---|---|
| Intake | Mobile-friendly form for **staff or participant**: consent, contact prefs, language/accessibility, goals, referral source, requested support, needs, urgent flags |
| Queue | Workflow list: intake → assignment → referral → follow-up → service connection → closure |
| Assignment | Suggested department/referral route for **staff review**. Staff must confirm department, owner, next action, follow-up date. Contacts default to **Unknown** |
| Referrals | Outside provider referral **blocked without consent**. Recorded locally only |
| Follow-up | Mark follow-up complete / service connected / closed |
| Next steps | Participant view: assigned IFCDC contact, phone, email, next action (Unknown if none on file) |
| Clinical / Insurance | Separately restricted. Billing does **not** get full clinical by default |
| Coding / Billing prep | Separate future workflow. Claim submit disabled |

Urgent flags **display** 911 (physical danger / ED) and 988 (behavioral-health crisis). **No auto-contact.**

---

## Data model (HQ SQLite, tenant `ifcdc-intake-medical`)

| Table | Purpose |
|---|---|
| `hq_intake_records` | Universal intake, consent, workflow, assignment snapshot |
| `hq_intake_needs` | Need types (including participant-identified `other`) |
| `hq_intake_assignments` | Staff-confirmed owner / next action / follow-up |
| `hq_intake_outside_referrals` | Outside referral record or consent-blocked row |
| `hq_intake_followups` | Follow-up completion |
| `hq_intake_notices` | **Generic** notice text only (`mailed = 0`) |
| `hq_intake_cases` / `insurance` / `clinical` / `coding` / `claims` | Separate medical-billing prototype (PR #81) |
| `hq_intake_audit` | Action + ids only (no labels, notes, member ids) |

Need types: youth mentoring; transitional housing; economic development/employment; scholarships/education; community arts/media/radio; mental-health support and case management; medical/clinical referrals; other.

---

## Roles (least privilege)

| Role | Access |
|---|---|
| Founder (`owner` / `founder`) | Full prototype |
| Intake coordinator | Create/review intakes, confirm assignment, referrals, follow-up. No clinical-restricted area |
| Department staff | **Assigned cases only** |
| Clinical-referral staff | Intake + clinical-restricted area. Not billing submit |
| Billing | Separate coding/draft-claim workflow. **Not** full clinical by default |
| Grants, HR, Finance, Detroit, employee | **Denied** (403) |

---

## Privacy map (systems that could touch sensitive data)

| System | What the repo shows | HIPAA / BAA | Intake use |
|---|---|---|---|
| Render (`ifcdc-hq`) | Production HQ, Ohio, SQLite disk | **Unknown / not verified.** Treat as **not HIPAA-cleared** | Prototype only |
| SQLite on Render disk | Operational HQ DB including `hq_intake_*` | **Not** a HIPAA-designated store | Synthetic only |
| Backups / R2 | HQ backup jobs | **Unknown** for PHI | Do not put real PHI on disk |
| Aura / OpenAI | Executive chat, grants, embeddings | **Unknown / no OpenAI BAA on file** | Do **not** put PHI in prompts, logs, or errors. Routing is local rules |
| Postmark | Transactional HQ email | **Does not sign HIPAA BAAs** | Notifications **generic only** — never health content. This prototype **does not send mail** |
| Logging / analytics | HQ logs | Not a designated PHI store | Audit stores ids/actions only |
| Twilio | Voice/SMS | **Unknown** for this intake | Unused here |

**Launch gate:** Do **not** activate live intake for sensitive information until the Founder reviews privacy, BAAs, access, incident response, and retention.

---

## Tests (synthetic)

`npm run test:universal-participant-intake`

- Housing need → housing route, contact Unknown  
- Youth program referral  
- Mental-health referral pathway  
- Urgent medical concern displays 911/988 and does **not** auto-call  
- Consent vs no-consent outside referral (409 without consent)  
- Follow-up completion → service connection  
- Mobile layout (stacked 44px controls)  
- Audit history without PHI  
- Access denied for grants/HR/finance/employee; department staff cannot open unassigned cases; billing cannot POST clinical  
- Coding not inferred from intake  

---

## Launch blockers (must stay closed)

- HIPAA Compliance Disabled on Render  
- No Founder-reviewed BAAs (Render, OpenAI, backups, logging). **Postmark will not sign a HIPAA BAA**  
- Department contacts, licensed clinicians, outside partners: **Unknown**  
- NPI / payer enrollment / clearinghouse: **Unknown** (billing still blocked)  
- No real PHI, no live sensitive intake, no production deploy of this branch as a covered intake desk  

---

## Founder decisions still required

1. Who is the named intake coordinator besides the Founder?  
2. Department owners, phones, emails — or keep **Unknown**  
3. Which outside partners (housing, clinical, mental-health) exist, with procedures — or keep **Unknown**  
4. Will IFCDC execute HIPAA-capable BAAs **before** any real PHI? Postmark cannot be used for health content.  
5. Retention, incident response, and who may open the clinical-restricted area  
6. Confirm: no live sensitive intake, no merge-as-production, no deploy until those reviews exist  

Do **not** mark this product ready for live participant PHI.
