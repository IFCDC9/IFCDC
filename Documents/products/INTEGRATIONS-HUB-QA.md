# Integrations Hub — Enterprise QA

**Module:** `/hq/integrations`  
**API:** `GET /api/hq/integrations`  
**RBAC:** `hq.software` (Software Division module)  
**Target SLA:** Page loads in **≤ 5 seconds**, no crash, no infinite spinner

## Root cause (crash)

`IntegrationsHubPage.tsx` referenced **`qbConnect.isPending`** without defining `qbConnect` — a `ReferenceError` when rendering the QuickBooks card, crashing the entire page.

## Fix summary

| Layer | Change |
|-------|--------|
| **Crash** | Removed undefined `qbConnect`; added `useMutation` for QuickBooks OAuth |
| **Server** | New `integrationsHubEngine.ts` — 11 connectors, env probes, 4s aggregate timeout, 30s cache |
| **Client** | 5s fetch timeout, `HqQueryBoundary` + placeholder, degraded banner, empty state |
| **Cards** | Status, last checked, env readiness, credentials, health, working/disabled actions |
| **Error boundary** | `HqWidgetErrorBoundary` wraps connector grid |

## Required integration categories

| ID | Name | Category |
|----|------|----------|
| `grants_gov` | Grants.gov | Federal Grants |
| `sam_gov` | SAM.gov | Federal Grants |
| `paypal` | PayPal | Payments |
| `resend` | Email (Resend) | Communications |
| `openai_aura` | OpenAI / AURA | AI Intelligence |
| `render` | Render | Infrastructure |
| `github` | GitHub | Infrastructure |
| `postgres` | Supabase / Postgres | Database |
| `twilio` | Twilio (SMS) | Communications |
| `website_apps` | Website & App Services | Software Division |
| `quickbooks` | QuickBooks | Accounting (legacy OAuth) |

## Verification checklist

- [ ] `/hq/integrations` loads without white screen
- [ ] No `qbConnect is not defined` in browser console
- [ ] All 10 required + QuickBooks cards visible
- [ ] Each card shows status, last checked, env readiness, credentials, health
- [ ] Test Connection returns JSON message per card
- [ ] Disabled buttons show reason (Coming soon / Not configured)
- [ ] `GET /api/hq/integrations` responds in under 5s (authenticated)
- [ ] Render `/api/health` commit matches GitHub `main`

## Commands

```bash
npm run check
node script/integrations-hub-readiness.mjs

# Production
IFCDC_BASE_URL=https://ifcdc-hq-wst6.onrender.com \
FOUNDER_SEED_PASSWORD=<Render> \
node script/integrations-hub-readiness.mjs
```

## Production sign-off

| Check | Result | Date |
|-------|--------|------|
| GitHub main commit | | |
| Render live commit | | |
| Founder visual approval | | |
