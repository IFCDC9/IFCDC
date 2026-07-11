# Imperial Foundation CDC — Product Document

**Priority:** #6  
**Path:** `Apps/IMPERIAL-FOUNDATION-CDC/`  
**Status:** Phase 1 — Grant Center V1 **LIVE on Render**  
**Production URL:** https://ifcdc-hq-wst6.onrender.com  
**Branch:** `main` · **Render service:** `ifcdc-hq`  
**Latest deploy:** `2a44a5a` — Phase 1 production hardening (2026-06-30)

---

## AURA Multi-Agent Executive Architecture (July 2026)

Founder speaks only to **AURA**. Behind the scenes, AURA convenes a live specialist team and returns one unified briefing.

| Agent | Live engines |
|-------|----------------|
| Chief of Staff | Executive briefings + synthesis |
| Grants Director | Grant Intelligence / funding matches |
| CFO | Finance briefing + dashboard |
| CTO | Technical Command health |
| HR Director | Workforce / staffing forecasts |
| Operations Director | Operations + Mission Control |
| Communications Director | Board/capital draft framing (no auto-send) |
| Compliance Officer | Compliance deadlines |
| Knowledge Librarian | Organizational Memory / Knowledge Base |
| Executive Intelligence Analyst | Strategic recommendations + metrics |

**Try:** “AURA, prepare IFCDC for next month's board meeting.” · “AURA, raise $10 million over the next five years.”

APIs: `GET /api/hq/aura/agents` · `POST /api/hq/aura/agents/orchestrate`

---

## AURA Intelligence System (July 2026)

Next-generation Founder enterprise intelligence layer on live HQ data (no demo answers).

| Capability | Engine / Route |
|------------|----------------|
| Organizational Memory (facts vs recommendations) | `auraOrganizationalMemory` · `POST /aura/intelligence/memory` |
| Cross-module Decision Support | `auraDecisionSupport` · `POST /aura/intelligence/decision-support` |
| Proactive alerts (deduped) | `auraProactiveIntelligence` · `POST /aura/intelligence/proactive-scan` |
| Intelligence Dashboard metrics | `auraIntelligenceMetrics` · `GET /aura/intelligence/metrics` · AURA Command Center → Intelligence |
| Technical Command | `auraTechnicalCommandEngine` |
| Voice follow-up reports | `auraFounderCallReport` |

**Voice (after Founder OTP):** “Can we afford to hire two case managers if this grant is awarded?” · “Check the entire system.” · “Send me a follow-up report.”

---

## AURA Technical Command Mode (July 2026)

Founder-only Technical Operations Wizard on the HQ phone line and in HQ web AURA Command.

| Capability | Status |
|------------|--------|
| Live health briefing (score, critical, warnings, priorities) | ✅ `auraTechnicalCommandEngine` |
| GitHub vs Render alignment | ✅ |
| Integrations Hub degradation scan | ✅ |
| Twilio / Resend / Founder phone readiness | ✅ |
| Repair tickets + tech audit trail | ✅ |
| Dangerous actions blocked without Founder approval | ✅ |
| Voice/SMS short-circuit after Founder Mode OTP | ✅ |
| HQ APIs `/api/hq/aura/technical/*` | ✅ |

**Try on call (after Founder verification):** “Check the entire system.” · “Compare GitHub main to Render live.” · “Check all integrations.” · “Create a repair task for Tessa.”

---

## Phase 1 Production Hardening (June 2026)

| Milestone | Status |
|-----------|--------|
| Live-data-only executive dashboards | ✅ Deployed |
| Demo seed disabled in production | ✅ Deployed |
| Barbers health URL slot + polling logic | ✅ Code live — **URL not set on Render** |
| `hq:production-audit` / `hq:phase1-verify` | ✅ Pass |
| Founder browser sign-off | ⏳ Pending |
| Full `production:verify` (auth + grants QA) | ⏳ Needs `FOUNDER_SEED_PASSWORD` |

**Full report:** [PHASE1-PRODUCTION-HARDENING.md](./PHASE1-PRODUCTION-HARDENING.md)

---

## Phase 1 Production Sign-Off (Grant Center V1 — prior)

| Milestone | Status |
|-----------|--------|
| GitHub `IFCDC9/IFCDC` unified on `main` | ✅ Complete |
| Render IFCDC-HQ build + deploy | ✅ Complete |
| `@ifcdc/*` package prebuild pipeline | ✅ Complete |
| Grant Center V1 | ✅ Released (`hq-grant-center-v1`) |

**Verification command:**

```bash
IFCDC_BASE_URL=https://ifcdc-hq.onrender.com npm run production:verify
```

Sub-gates: `grants:deploy-verify` (6), `grants:qa` (33), `people:readiness`.

---

## Build Status

| Check | Result | Date |
|-------|--------|------|
| `npm run check` | ✅ Pass | 2026-06 |
| `npm run build` | ✅ Pass | 2026-06 |
| `npm run grants:release` | ✅ Pass (33/33 QA) | 2026-06 |
| Render production deploy | ✅ Live | 2026-06 |
| Release tag | `hq-grant-center-v1` | 2026-06 |

---

## Deployment

| Host | Role | Status |
|------|------|--------|
| **Render** (`ifcdc-hq-wst6.onrender.com`) | Permanent production | **ACTIVE** |
| Replit | Interim / rollback | Retire after 7–14 days stable |

**Runbook:** [HQ-DEPLOY-RUNBOOK.md](../HQ-DEPLOY-RUNBOOK.md)  
**Ops reference:** [HQ-PRODUCTION-OPS.md](../HQ-PRODUCTION-OPS.md)  
**Render fix history:** [RENDER-GITHUB-FIX.md](../RENDER-GITHUB-FIX.md)  
**Blueprint:** `render.yaml` at repo root on `main`

### Phase 2 (next)

- Grant Writer Studio — collaboration and version history
- Live Grants.gov and SAM.gov integrations
- Automated funding pipeline
- Expanded reusable grant library
- AI-assisted grant writing and tracking

---

## IFCDC Service Integration

HQ platform uses embedded `@ifcdc/*` file packages (auth, aura-ai, payments, notifications, headquarters-sdk), compiled during `prebuild`.

Health: `/api/health`  
Executive Dashboard: `/hq`  
People & HR: `/hq/people`  
Grant Center: `/hq/grants`, `/api/hq/grants/center/*`

---

## Change Log

| Date | Change | Author |
|------|--------|--------|
| 2026-07-08 | Fix Founder OTP email delivery: direct Resend (skip localhost microservice), EMAIL_FROM/SMTP_FROM aliases, SMS backup, parallel send during voice, `/api/hq/email/status` | Tessa |
| 2026-07-08 | Founder phone auth: register +18484694448 as candidate; email OTP to service@ifcdc.org required (never ANI-alone Founder access); session reuse after verify | Tessa |
| 2026-07-08 | Fix unresponsive Grant Workspace Founder Approve / Request Changes / Generate Full Proposal / AURA FAB (`49200ce`) | Tessa |
| 2026-07-08 | Founder Mode trust: trusted-phone auto-elevation (no OTP on daily use), Founder voice greeting, OTP step-up only when needed, HQ trusted-device + Face ID/Touch ID binding, confidential RBAC for non-Founders | Tessa |
| 2026-06-30 | Phase 1 production hardening: live data only, Barbers monitoring, env reporting (`2a44a5a`) | Tessa |
| 2026-06 | Phase 1 Render production live; Git history unify; build pipeline fixes | Tessa |
| 2026-06 | Grant Center V1 enterprise platform; production QA; Render migration | Tessa |
| 2026-06-19 | Auth middleware TS fixes; donations db fix; working build | Tessa |

---

## AURA Founder Mode (Trust Model)

**Public HQ line stays secure** — never assume every caller on +1 (331) 316-8167 is the Founder.
**Never grant Founder Mode from phone number alone.**

| Path | Behavior |
|------|----------|
| Registered Founder candidate phone (`+18484694448` + `FOUNDER_TRUSTED_PHONES`) | Recognized on call; AURA emails a one-time code to `service@ifcdc.org` (SMS backup unless `AURA_FOUNDER_OTP_SMS=false`) |
| Correct OTP within 10 minutes | Founder Mode + Super Admin for that call/SMS session |
| Wrong / expired OTP | Privileges denied; all attempts audited |
| Already verified this session | No re-prompt until session expires |
| Unregistered number claiming Founder | Must be a registered candidate line first |
| HQ web Founder session | Founder Mode from auth; optional Face ID/Touch ID binds trusted browser device |
| Everyone else | Role-scoped modules; confidential domains redacted |

**Confidential domains unlocked in Founder Mode:** Grants, Financials, HR, Payroll, Operations, Budgets, Board documents, Software Division, Executive reports.

**Env:** `FOUNDER_TRUSTED_PHONES` / `AURA_FOUNDER_PHONES` (comma-separated E.164). Built-in candidate: `+18484694448`. Requires `RESEND_API_KEY` (+ verified `RESEND_FROM_EMAIL` / `EMAIL_FROM` / `SMTP_FROM`) for OTP email. SMS backup on by default. Check `/api/hq/email/status`.
