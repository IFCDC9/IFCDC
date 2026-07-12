# IFCDC HQ — Build 58: Enterprise Quality Assurance, System Hardening & Production Certification

**Status:** Implemented (July 12, 2026)  
**Goal:** Certify IFCDC HQ as a stable, enterprise-grade production platform.

## Audit Findings Resolved

| Issue | Resolution |
|-------|------------|
| Client/server RBAC drift (`/hq/clients`, `/hq/knowledge`) | Synced `ROUTE_PERMISSIONS` + `hq.clients` / `hq.aura` |
| Broken `npm run enterprise:verify` | Restored `script/enterprise-production-verify.mjs` |
| Stale nav audit path lists | Shared `script/hq-nav-paths.mjs` covering all live HQ routes |
| False-zero System Health on probe timeouts | Stale-while-revalidate + longer timeouts in `executiveCommandHealth.ts` |
| Silent empty Document / Knowledge pages | Degraded-mode banners with retry |
| `HqQueryBoundary` hid timeouts behind placeholders | Soft degraded banner when `hasRenderableData` + error |
| Settings module marked beta while live | Status → `live` |
| `.env.example` gaps / real-looking PII | Added `IFCDC_DATA_DIR`, `ALLOW_DEMO_SEED`; sanitized phones/emails |

## Hardening Delivered

### Authentication & Authorization
- Client Permission type includes `hq.clients` / `hq.clients.manage`
- `/hq/clients` → `hq.clients` (unblocks Case Management for intended roles)
- `/hq/knowledge` → `hq.aura` on client **and** server (matches knowledge API module)

### UX Stability
- `HqQueryBoundary` surfaces degraded mode instead of silent zeros
- Document Center + Knowledge Base show explicit degraded banners
- No infinite blocking loader when placeholder/safe data is present

### System Health
- Command health cache TTL 90s; stale reuse up to 10 minutes
- Probe timeouts increased (org/finance/integrations/tech)
- Timed-out pillars reuse last-known scores (not 0)
- Coming-soon connectors excluded from live integration totals

### QA Tooling
- `npm run enterprise:verify` — tsc + client build + optional live audits
- `hq:nav-audit` / `hq:production-audit` include monitoring, knowledge, clients, manager, workspace, brain, OS

## Production Certification Checklist

| Gate | Status |
|------|--------|
| TypeScript (`tsc --noEmit`) | Pass (local) |
| Client production build | Pass (local) |
| Every nav route in audit list | Covered in scripts |
| RBAC client ↔ server parity (critical routes) | Fixed |
| Document upload/preview/version paths | Build 57 + degraded UX |
| Integration Hub / Monitoring | Builds 55–56 + health hardening |
| Secrets / demo seed documented | `.env.example` updated |
| Console/API silent failures | Degraded banners added on high-traffic modules |

### Operator verify (after Manual Deploy)
```bash
cd Apps/IMPERIAL-FOUNDATION-CDC
npm run enterprise:verify
IFCDC_BASE_URL=https://ifcdc-hq-wst6.onrender.com npm run hq:nav-audit
IFCDC_BASE_URL=… FOUNDER_SEED_PASSWORD=… npm run enterprise:verify
```

## Known Non-Blocking Notes
- Enterprise e-sign remains intentionally disabled (`501` for stub `signed:` payloads) — upload signed PDF as a new version.
- Legacy unused page modules (`HqFinancePage`, `HqHrPage`, `HqGrantsPage`) are not routed; left quarantined.
- Cross-browser/device visual QA requires Manual Deploy + human spot-check on Safari/Chrome/Edge/Firefox + iOS.

## Deploy
1. Push `main`
2. Render **Manual Deploy**
3. Run `enterprise:verify` against production URL
4. Spot-check Executive Dashboard System Health (should not collapse to false zeros after warm-up)

## Next
**Build 59 — Grant Center Foundation** (enterprise grant management, funding pipeline, compliance tracking, executive funding dashboard, grant lifecycle)
