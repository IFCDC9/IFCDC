# Resend Domain Verification — ifcdc.org

**Status:** ✅ Verified in Resend — production sender `service@ifcdc.org`  
**DNS host:** GoDaddy (`ns19.domaincontrol.com` / `ns20.domaincontrol.com`)  
**Updated:** 2026-07-30

## Live production diagnosis

| Check | Result |
|---|---|
| `RESEND_API_KEY` | Loaded |
| `RESEND_FROM_EMAIL` | `IFCDC Headquarters <service@ifcdc.org>` |
| Resend `ifcdc.org` | **Verified** |
| Resend `ifcdcbarbersapp.com` | Verified (kept as emergency fallback only) |
| DNS DKIM / SPF / DMARC | Published under `resend._domainkey`, `send`, `_dmarc` |

## Behavior after cutover

1. HQ probes Resend for the **configured** From domain first.
2. If `ifcdc.org` is verified → send as `IFCDC Headquarters <service@ifcdc.org>` (`usedFallback: false`).
3. Emergency restore of `ifcdcbarbersapp.com` runs **only** when the configured domain is not verified.

## Render env (required)

```
RESEND_FROM_EMAIL=IFCDC Headquarters <service@ifcdc.org>
RESEND_API_KEY=re_…
```

Confirm on Render → **ifcdc-hq** → Environment, then **Manual Deploy** after code that prefers verified configured domain (no always-on emergency restore).

## Success criteria

- [x] DNS records published at GoDaddy
- [x] Resend `ifcdc.org` status = verified
- [ ] Deploy cutover commit + confirm `usedFallback === false`
- [ ] Final liveTest From = `IFCDC Headquarters <service@ifcdc.org>`
