# AURA Phase 7 — Production Hardening & Legacy :4101 Deprecation

**Status:** SHIPPED (controlled consolidation — implementation retained for rollback)  
**Date:** August 13, 2026  
**Product:** IFCDC Headquarters / AURA  
**Constraint:** Twilio credentials, SMS number, Phase 6 statusCallback route, Founder password, and operational event bus unchanged.

## Target architecture (confirmed)

```
ONE AURA production path (HQ in-process OpenAI)
  → ONE secure authorization/action layer (/api/hq/aura/* + Founder trust)
  → ONE operational event system (auraOperationalEvents + Tab 9)
  → authorized IFCDC HQ modules
```

Legacy `:4101` (`Backend/ifcdc-services/aura-ai-core`) is **not** on this path.

## Rollback

| Item | Value |
|------|--------|
| Pre-Phase-7 tag | `phase6-acceptance` (commit `1e36fb4`) |
| Re-enable legacy core | `AURA_LEGACY_4101_ENABLED=true` then `npm run dev:aura -w Backend/ifcdc-services` |
| Re-enable HQ probe | `AURA_LEGACY_4101_PROBE=true` |
| Re-enable Shared SDK chat | same `AURA_LEGACY_4101_ENABLED=true` |
| Do not delete | `Backend/ifcdc-services/aura-ai-core/**` retained |

## Key files

| Change | Path |
|--------|------|
| Observability | `server/hq/auraLegacy4101.ts` |
| Skip default :4101 health | `server/lib/ifcdc.ts` |
| Status + diagnostics | `server/routes/hq.routes.ts`, `auraE2eDiagnosticsEngine.ts` |
| Soft-disable core | `Backend/ifcdc-services/aura-ai-core/src/server.ts` |
| Shared SDK gate | `Shared/ifcdc-services.ts` |
| Verify script | `script/phase7-aura-hardening-verify.mjs` |

## Env (Phase 7)

| Variable | Default | Purpose |
|----------|---------|---------|
| `AURA_LEGACY_4101_PROBE` | unset/false | When true, HQ still probes `IFCDC_AURA_URL` health and logs |
| `AURA_LEGACY_4101_ENABLED` | unset/false | When true, allow legacy core listen + Shared `auraChat()` |
| `IFCDC_AURA_URL` | `http://localhost:4101` | Legacy URL only (not production executive path) |

## Safety confirmations

- Twilio credentials / phone / Console: **untouched**
- `/api/twilio/aura/sms/status`: **untouched**
- Operational event bus: **untouched** (read surfaces only)
- Founder password: **untouched**
- Implementation of aura-ai-core: **not deleted**
