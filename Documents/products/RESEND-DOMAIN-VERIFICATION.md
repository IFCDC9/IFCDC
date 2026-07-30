# Resend Domain Verification — ifcdc.org

**Status:** ✅ Production live on `service@ifcdc.org` (commit `2ae17f0`)  
**DNS host:** GoDaddy (`ns19.domaincontrol.com` / `ns20.domaincontrol.com`)  
**Updated:** 2026-07-30

## Live production confirmation

| Check | Result |
|---|---|
| Deploy commit | `2ae17f0` |
| `RESEND_API_KEY` | Loaded |
| `RESEND_FROM_EMAIL` | `IFCDC Headquarters <service@ifcdc.org>` |
| Resend `ifcdc.org` | **Verified** |
| `usedFallback` | **false** |
| Effective From | `IFCDC Headquarters <service@ifcdc.org>` |
| `trustedSender` | true |
| Live test | `messageId` `cff0e198-35b0-4d11-a884-03580381c3a4` From = `service@ifcdc.org` |

Emergency domain `ifcdcbarbersapp.com` remains registered but is **not** used while `ifcdc.org` stays verified.

## Success criteria

- [x] DNS records published at GoDaddy
- [x] Resend `ifcdc.org` status = verified
- [x] Deploy cutover commit + `usedFallback === false`
- [x] Final liveTest From = `IFCDC Headquarters <service@ifcdc.org>`
