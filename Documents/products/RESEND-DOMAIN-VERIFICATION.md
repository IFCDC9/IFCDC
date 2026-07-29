# Resend Domain Verification — ifcdc.org

**Status:** Deploy live (`da5ad26+`) — blocked by Resend **1-domain plan limit**  
**DNS host:** GoDaddy (`ns19.domaincontrol.com` / `ns20.domaincontrol.com`)  
**Updated:** 2026-07-29

## Live production diagnosis

| Check | Result |
|---|---|
| Render commit | `da5ad26` (resendDomainEngine **is deployed**) |
| `RESEND_FROM_EMAIL` | Already `IFCDC Headquarters <service@ifcdc.org>` |
| Resend domains | Only `ifcdcbarbersapp.com` (verified) |
| Create `ifcdc.org` | **Failed:** `Your plan includes 1 domain. Upgrade to add more.` |
| Effective From | Fallback `service@ifcdcbarbersapp.com` (`usedFallback: true`) |

Poll timed out earlier because `domainSetup` existed but `registered=false` with that plan-limit error — not because the engine was missing.

## Fix path (HQ sender = ifcdc.org)

1. **Manual Deploy** the commit that auto-replaces the plan-slot domain (`RESEND_ALLOW_DOMAIN_REPLACE` defaults to `true`).
2. Hit `GET /api/hq/email/status` — HQ removes `ifcdcbarbersapp.com` from Resend and registers `ifcdc.org`, returning `domainSetup.records`.
3. **GoDaddy DNS** for `ifcdc.org`: publish every SPF/DKIM record from `domainSetup.records` exactly.
4. Optional DMARC TXT `_dmarc`: `v=DMARC1; p=none; rua=mailto:service@ifcdc.org`
5. Founder → `POST /api/hq/email/domain/verify` (or Integrations Hub → Test Connection).
6. Confirm `verified=true`, `usedFallback=false`, domains=`ifcdc.org`.

### Alternative

- Upgrade Resend to **Pro** (10 domains) and keep both `ifcdc.org` + `ifcdcbarbersapp.com`.
- Or Founder-only: `POST /api/hq/email/domain/replace` with `{ "domain": "ifcdc.org" }`.

### Barbers note

After the slot swap, Barbers must send via `service@ifcdc.org` (same Resend account) **or** use a separate Resend API key / Pro plan if it still requires `@ifcdcbarbersapp.com`.

## Render env

```
RESEND_FROM_EMAIL=IFCDC Headquarters <service@ifcdc.org>
# optional: RESEND_ALLOW_DOMAIN_REPLACE=false  # disable auto-swap
```

## Success criteria

- `domainSetup.verified === true`
- `domainSetup.usedFallback === false`
- Integrations Hub Email (Resend) = **Connected**
- Communications / notifications From = `service@ifcdc.org`
