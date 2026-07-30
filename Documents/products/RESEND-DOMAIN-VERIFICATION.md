# Resend Domain Verification — ifcdc.org

**Status:** Blocked on GoDaddy DNS publish (Resend domain registered, status `failed`)  
**DNS host:** GoDaddy (`ns19.domaincontrol.com` / `ns20.domaincontrol.com`)  
**Updated:** 2026-07-30  
**Resend domain id:** `c770d1d2-fd0b-4cde-a7a9-be6b65637488`

## Live production diagnosis

| Check | Result |
|---|---|
| `RESEND_API_KEY` | Loaded |
| `RESEND_FROM_EMAIL` | `IFCDC Headquarters <service@ifcdc.org>` |
| Resend `ifcdc.org` | Registered, status **`failed`** (missing DNS) |
| Resend `ifcdcbarbersapp.com` | **Verified** — production fallback |
| Effective From | `service@ifcdcbarbersapp.com` (`usedFallback: true`) |
| Live dig `resend._domainkey.ifcdc.org` | No TXT |
| Live dig `send.ifcdc.org` | No MX / Resend SPF TXT |
| Live dig `_dmarc.ifcdc.org` | No TXT |

Outlook root MX/SPF on `ifcdc.org` must remain. Resend only needs the **`send.`** and **`resend._domainkey`** hosts (same pattern as working `ifcdcbarbersapp.com`).

## GoDaddy DNS to publish (exact)

Sign in → DNS for **ifcdc.org** → Add:

| Type | Host | Value | Priority |
|---|---|---|---|
| TXT | `resend._domainkey` | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDhRRVcMBZLyEEdSAVOskW7H1D85bGfBaVzAAoee8fEEjFX+NwpJMoipwx4UM/JIhIJFSS0p3oNmYmNh2RKXT4svUgmOSn+MWM41IkcFIC1qUkAteNr2tZtFicNMN4oGM8ETWBDG+exNyanxrteGmkhyX8E+ed6sbV8uXbfPyLYvwIDAQAB` | — |
| MX | `send` | `feedback-smtp.us-east-1.amazonses.com` | **10** |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` | — |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:service@ifcdc.org` | — |

Do **not** change root `@` MX (Outlook) or root SPF (`include:secureserver.net`).

## After DNS saves

1. Wait 5–30 minutes (sometimes faster).
2. Confirm dig:
   - `dig TXT resend._domainkey.ifcdc.org`
   - `dig MX send.ifcdc.org`
   - `dig TXT send.ifcdc.org`
3. Founder → Integrations Hub → Verify Domain, or:
   `POST /api/hq/email/domain/verify` (authenticated)
4. Confirm:
   - `domainSetup.verified === true`
   - `usedFallback === false`
   - `resendProbe.ok === true`
   - live send From = `IFCDC Headquarters <service@ifcdc.org>`

## Success criteria

- [ ] DNS records published at GoDaddy
- [ ] Resend `ifcdc.org` status = verified
- [ ] `usedFallback === false`
- [ ] Final liveTest From = `service@ifcdc.org`
