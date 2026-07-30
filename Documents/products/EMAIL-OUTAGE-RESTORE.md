# URGENT — Email delivery outage & restore

**Date:** 2026-07-29  
**Status:** Fix pushed (`95efb3b`) — **Manual Deploy required** before mail recovers  
**Live commit at diagnose time:** `6fa9a85` (broken)

## Root cause

Commit `6fa9a85` auto-replaced Resend’s only domain: deleted verified **`ifcdcbarbersapp.com`** to register **`ifcdc.org`**.

Then:
- `ifcdc.org` was **not** DNS-verified (GoDaddy account unknown / records missing)
- Resend account had **zero verified domains**
- `RESEND_FROM_EMAIL` stayed `service@ifcdc.org`
- Fallback could not run (nothing verified to fall back to)
- Resend rejected sends → OTP, booking, payment confirmation emails stopped

## Fix (pushed)

| Commit | Change |
|---|---|
| `b5f27ec` | Re-register + verify `ifcdcbarbersapp.com`; emergency From; disable auto domain delete |
| `95efb3b` | Import cleanup |

### Files changed
- `server/hq/resendDomainEngine.ts` — `restoreEmergencyResendSender()`, replace opt-in only
- `server/lib/notifications.ts` — restore before send; emergency From when no verified domain
- `server/routes/hq.routes.ts` — `emergencyRestore` on `/email/status`; `POST /email/domain/restore-emergency`

### Env checked (production status API)
| Variable | Status |
|---|---|
| `RESEND_API_KEY` | Set (`apiKeySet: true`) |
| `RESEND_FROM_EMAIL` | `IFCDC Headquarters <service@ifcdc.org>` |
| SMTP | Not used (Resend API path) |
| localhost notifications | `inlineOnly: true`, `notificationsUrl: null` (correct) |

## Founder action (required now)

1. Render → **ifcdc-hq** → **Manual Deploy** → commit **`95efb3b`**
2. Open `https://ifcdc-hq-wst6.onrender.com/api/hq/email/status`  
   Confirm `emergencyRestore.verified === true` and domains include `ifcdcbarbersapp.com`
3. If still pending, in Resend dashboard click **Verify** on `ifcdcbarbersapp.com` (DNS should still be on the Barbers GoDaddy account)
4. Tell Tessa — live send test to `service@ifcdc.org` will run after deploy

## Success criteria

- [x] `emergencyRestore.verified === true` (`ifcdcbarbersapp.com` retained as emergency only)
- [x] Live test email accepted by Resend (`messageId` returned; inbox: check `service@ifcdc.org`)
- [x] Booking + payment confirmation paths verified on Barbers production (2026-07-29)
- [x] `ifcdc.org` verified in Resend (2026-07-30) — DNS SPF/DKIM/DMARC published
- [x] After HQ deploy of sender cutover: `usedFallback === false`, From = `service@ifcdc.org` (commit `2ae17f0`, liveTest `cff0e198…`)

### Live probes (2026-07-30)

| Probe | Result |
|---|---|
| `GET /api/hq/email/status` | `apiKeySet: true`, `from` configured as `service@ifcdc.org` |
| Resend domains | `ifcdc.org` **verified**, `ifcdcbarbersapp.com` verified |
| Cutover | Prefer configured domain; emergency restore only if configured domain fails probe |