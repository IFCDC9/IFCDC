# HQ Credential Separation — Founder vs Grants Operator

**Status:** Verified & tightened (July 2026)  
**Product:** IFCDC Headquarters authentication

## Accounts

| Account | Email | Password env | Role | Access |
|---|---|---|---|---|
| Founder / Super Admin | `service@ifcdc.org` (`MASTER_OWNER_EMAIL`) | `FOUNDER_SEED_PASSWORD` | `owner` → Founder Mode | Unrestricted HQ |
| Grants Operator | `813786b@gmail.com` (`GRANTS_OPERATOR_EMAIL`) | `GRANTS_OPERATOR_PASSWORD` | `grant_manager` | Grant ops only |

Credentials are **completely separate**. Founder never needs the operator password; operator never receives Founder Mode.

## Authorization rules

1. Login as Founder → JWT role `owner` → session `founderMode: true` + full permissions (automatic on web; no second password).
2. Founder opens Grant Workspace with Founder credentials alone (`hq.grants` + owner bypass).
3. Grant approvals, portal confirm, live workflow, enterprise admin, security settings remain Founder-gated.
4. Grants Operator: discovery, drafting, workspace, package prep via `hq.grants` / `hq.grants.manage` — **no** `hq.executive`, settings, board, or Founder approval endpoints.
5. AURA resolves `service@ifcdc.org` / `owner` as Founder Mode on HQ web sessions.

## Key files

- `server/config/credentials.ts` — email/password env accessors  
- `server/routes/monolith/auth.routes.ts` — login role override by email  
- `server/monolith/legacyDbBootstrap.ts` — seed + demote stray owners  
- `server/hq/enterpriseRoles.ts` — permission matrix + session `founderMode`  
- `server/hq/auraFounderTrustEngine.ts` — AURA Founder identity  
- `server/routes/grants.routes.ts` — Founder Mode gates on approve/submit  

## Verify

```bash
IFCDC_BASE_URL=https://ifcdc-hq-wst6.onrender.com \
FOUNDER_SEED_PASSWORD=… \
GRANTS_OPERATOR_PASSWORD=… \
node script/credential-separation-verify.mjs
```
