# IFCDC Headquarters — Production Email Engine

**Status:** Live (July 2026)  
**Path:** `server/hq/emailEngine.ts`, `emailTemplates.ts`, `emailBrand.ts`

## What shipped

- Branded HTML emails (black / gold / white IFCDC Headquarters design)
- Verified Resend From for **all** HQ sends (fallback when configured domain is unverified)
- Template catalog wired for HQ modules
- AURA-composed personalized emails (replaces fixed test placeholders)
- Sender auth status: domain + SPF / DKIM / DMARC probe via Resend

## Templates

| ID | Module use |
|---|---|
| `welcome` | New account access |
| `password_reset` | Auth recovery |
| `booking_confirmation` | Bookings |
| `appointment_reminder` | Appointments |
| `approval_notification` / `denial_notification` | Workflows / grants |
| `grant_notification` | Grant Workspace |
| `contact_form` | Inbound inquiries |
| `executive_alert` | Founder / Mission Control |
| `daily_report` | Executive briefings |
| `aura_message` | AURA-generated Founder Mode mail |

## APIs

- `GET /api/hq/email/status` — delivery + `senderAuth` (SPF/DKIM/DMARC) + template catalog
- `GET /api/hq/email/templates` — catalog (auth)
- `POST /api/hq/email/send-template` — Founder send by template id
- `POST /api/hq/email/test-branded` — live AURA branded E2E test

## AURA behavior

`send_email` now:

1. Rejects instruction dumps as body content
2. Treats placeholder / empty bodies as **compose** requests
3. Calls `composeAuraEmail` → branded `aura_message` HTML
4. Sends via verified Resend domain

## Unverified Sender

Clients show “Unverified Sender” when the From domain is not authenticated.

**Fix on DNS / Resend (not code):**

1. Resend Dashboard → Domains → add `ifcdc.org` (or your sending domain)
2. Publish SPF, DKIM, and DMARC records Resend provides
3. Wait until domain status = `verified`
4. Set Render `RESEND_FROM_EMAIL=IFCDC Headquarters <service@ifcdc.org>` (or address on that verified domain)
5. Manual Deploy

HQ will report readiness on `/api/hq/email/status` → `senderAuth.trustedSender`.

## Live test

```bash
export IFCDC_BASE_URL=https://ifcdc-hq-wst6.onrender.com
export FOUNDER_SEED_PASSWORD='…'   # match Render
node script/email-engine-e2e.mjs
```
