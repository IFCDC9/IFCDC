# HQ Credential Separation — Founder vs Grants Operator

**Status:** Verified & tightened (July 2026)  
**Product:** IFCDC Headquarters authentication

## Accounts

| Account | Email | Password env | Role | Access |
|---|---|---|---|---|
| Founder / Super Admin | `service@ifcdc.org` (`MASTER_OWNER_EMAIL`) | `FOUNDER_SEED_PASSWORD` | `owner` → Founder Mode | Unrestricted HQ |
| Grants Operator | `813786b@gmail.com` (`GRANTS_OPERATOR_EMAIL`) | `GRANTS_OPERATOR_PASSWORD` | `grant_manager` | Grant ops only |

Credentials are **completely separate**. Never use one password for the other account.

## Required behavior

1. Login as Founder (`service@ifcdc.org` + `FOUNDER_SEED_PASSWORD`) → JWT role `owner` → session `founderMode: true` + full permissions (automatic on web; **no** Grants Operator password).
2. Founder opens Grant Workspace with Founder credentials alone (`hq.grants` + owner bypass).
3. Grant approvals, portal confirm, live workflow, enterprise admin, security settings remain Founder-gated.
4. Grants Operator (`813786b@gmail.com` + `GRANTS_OPERATOR_PASSWORD`): discovery, drafting, workspace, package prep via `hq.grants` / `hq.grants.manage` — **no** `hq.executive`, settings, board, or Founder approval endpoints.
5. AURA and acceptance scripts that need Founder Mode use **only** `FOUNDER_SEED_PASSWORD` for `service@ifcdc.org`.

## Which credential each workflow uses

| Workflow | Account | Password env |
|---|---|---|
| HQ login / Founder Mode / AURA PAT | Founder | `FOUNDER_SEED_PASSWORD` |
| Grant Center QA (Founder path) | Founder | `FOUNDER_SEED_PASSWORD` |
| Grants Operator day-to-day login | Grants Operator | `GRANTS_OPERATOR_PASSWORD` |
| Credential separation verify | Both (separately) | Both envs |

If Founder login returns **401 Invalid credentials**, the local `FOUNDER_SEED_PASSWORD` does **not** match Render `ifcdc-hq` — this is **not** a Grants Operator mix-up. On each deploy, HQ re-hashes Founder from `FOUNDER_SEED_PASSWORD` and Grants Operator from `GRANTS_OPERATOR_PASSWORD` independently.

## Key files

- `server/config/credentials.ts` — email/password env accessors (never cross-read)
- `server/config/validateProductionEnv.ts` — requires distinct emails **and** distinct passwords in production
- `server/routes/monolith/auth.routes.ts` — login role override by email
- `server/monolith/legacyDbBootstrap.ts` — seed + demote stray owners
- `server/hq/enterpriseRoles.ts` — permission matrix + session `founderMode`
- `server/hq/auraFounderTrustEngine.ts` — AURA Founder identity
- `server/routes/grants.routes.ts` — Founder Mode gates on approve/submit
- `script/aura-ops-acceptance.mjs` — Founder-only auth path
- `script/credential-separation-verify.mjs` — dual-account + cross-rejection checks

## Verify

```bash
IFCDC_BASE_URL=https://ifcdc-hq-wst6.onrender.com \
FOUNDER_SEED_PASSWORD=… \
GRANTS_OPERATOR_PASSWORD=… \
node script/credential-separation-verify.mjs
```

Founder-only AURA acceptance (does **not** use Grants Operator password):

```bash
IFCDC_BASE_URL=https://ifcdc-hq-wst6.onrender.com \
FOUNDER_SEED_PASSWORD=… \
node script/aura-ops-acceptance.mjs
```
