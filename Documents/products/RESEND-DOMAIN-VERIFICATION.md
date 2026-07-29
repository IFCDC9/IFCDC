# Resend Domain Verification — ifcdc.org

**Status:** Blocked on GoDaddy DNS (SPF/DKIM not published)  
**DNS host:** GoDaddy (`ns19.domaincontrol.com` / `ns20.domaincontrol.com`)  
**Updated:** 2026-07-29

## Live production diagnosis

| Check | Result |
|---|---|
| `RESEND_API_KEY` on Render | Set |
| `RESEND_FROM_EMAIL` | Already `IFCDC Headquarters <service@ifcdc.org>` |
| Resend domains | Only `ifcdcbarbersapp.com` (verified) |
| `ifcdc.org` in Resend | **Not registered** |
| Effective From | Fallback `service@ifcdcbarbersapp.com` (`usedFallback: true`) |
| DNS `resend._domainkey.ifcdc.org` | NXDOMAIN |
| DNS `send.ifcdc.org` TXT/MX | NXDOMAIN |
| DNS `_dmarc.ifcdc.org` | NXDOMAIN |

Root cause: HQ is configured to send as `service@ifcdc.org`, but that domain is not verified in Resend, so mail falls back to the Barbers domain.

## Automated path (after this deploy)

1. **Manual Deploy** `ifcdc-hq` on Render (includes `resendDomainEngine` + `/api/hq/email/domain/*`).
2. Hit `GET https://ifcdc-hq-wst6.onrender.com/api/hq/email/status`  
   - Auto-registers `ifcdc.org` in Resend via production API key  
   - Returns `domainSetup.records` (exact SPF/DKIM rows)
3. **Founder — GoDaddy DNS** for `ifcdc.org`: add every record from `domainSetup.records` exactly.
4. Optional DMARC TXT at `_dmarc`:
   - `v=DMARC1; p=none; rua=mailto:service@ifcdc.org`
5. Founder Mode → `POST /api/hq/email/domain/verify` **or** Integrations Hub → Email (Resend) → **Test Connection**.
6. Confirm:
   - `domainSetup.verified === true`
   - `domainSetup.usedFallback === false`
   - Integrations Hub Resend = **Connected**
   - Communications / notifications From = `service@ifcdc.org`

## Render env (confirm — usually already set)

```
RESEND_FROM_EMAIL=IFCDC Headquarters <service@ifcdc.org>
```

Aliases also accepted: `EMAIL_FROM`, `SMTP_FROM`. Standardized name for HQ is **`RESEND_FROM_EMAIL`**.

No redeploy is needed for the env value alone if it is already set; redeploy **is** required for the domain-engine code.

## GoDaddy steps

1. GoDaddy → My Products → **ifcdc.org** → DNS  
2. Add **each** record from `domainSetup.records` (typically SPF MX + TXT at `send`, plus DKIM)  
3. Do **not** remove existing Outlook apex MX unless migrating mailbox hosting  
4. Wait 5–30 minutes → Verify in Resend / HQ  
5. Re-test Integrations Hub Email (Resend)

## Success criteria (100%)

- Integration status: **Connected**
- Sender domain: **verified**
- Environment: **Complete**
- Fallback: **Off**
- Test Connection: success from `service@ifcdc.org`
- Communications Center + HQ notifications send as `service@ifcdc.org`

## Local helper (optional)

If you export the production Resend key into the shell:

```bash
RESEND_API_KEY=re_… node script/resend-domain-setup.mjs
RESEND_API_KEY=re_… node script/resend-domain-setup.mjs --verify
```
