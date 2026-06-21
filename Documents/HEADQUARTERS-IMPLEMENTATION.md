# IFCDC Headquarters — Implementation Status

**Host:** `Apps/IMPERIAL-FOUNDATION-CDC/`  
**Status:** Phase 1 Foundation — In Progress  
**Barbers App:** Production locked — read-only blueprint only

## Enterprise Policy

- Headquarters is the **central operating system** for the IFCDC ecosystem
- Every application authenticates through HQ and reports health/analytics back
- Barbers App is **not modified** unless explicitly authorized for critical fixes
- Development priority: **HQ → Music → Tapis → Inclusive Community → Website → Swift-Ware → CryptoCoin → Radio**

## Phase 1 — Foundation (Current)

### Completed

| Component | Path | Description |
|-----------|------|-------------|
| IFCDC integration layer | `server/lib/ifcdc.ts` | Auth, AURA, payments, notifications, service probes |
| Enterprise RBAC | `server/hq/roles.ts` | HQ roles + legacy role mapping + module permissions |
| Software Division registry | `server/hq/appRegistry.ts` | 8 apps with health polling |
| HQ API routes | `server/routes/hq.routes.ts` | Executive overview, software division, AURA, notifications |
| HQ auth middleware | `server/middleware/hqAuth.ts` | JWT auth compatible with monolith |
| Health endpoint | `GET /api/health` | HQ self-reporting for app registry |
| Executive Dashboard | `/hq` | Org health score, platform services, module cards |
| Software Division UI | `/hq/software` | Live health badges for all registered apps |
| AURA Command Center | `/hq/aura` | Enterprise AI chat interface |
| HQ Layout | `client/src/layouts/HQLayout.tsx` | Unified HQ navigation shell |

### API Endpoints

```
GET  /api/health
GET  /api/hq/health
GET  /api/hq/executive/overview
GET  /api/hq/software-division
GET  /api/hq/software-division/registry
POST /api/hq/software-division/register
GET  /api/hq/aura/status
POST /api/hq/aura/chat
GET  /api/hq/platform/services
GET  /api/hq/roles
POST /api/hq/notifications/broadcast
```

### Software Division Registry

| App | Status | Locked |
|-----|--------|--------|
| IFCDC Barbers App | locked | ✅ |
| IFCDC Music App | mvp | |
| IFCDC Radio | development | |
| IFCDC Tapis | mvp | |
| Inclusive Community | mvp | |
| Imperial Foundation CDC Website | development | |
| Swift-Ware | mvp | |
| CryptoCoin IFCDC | mvp | |

Configure health URLs via environment variables: `HQ_BARBERS_HEALTH_URL`, `HQ_MUSIC_HEALTH_URL`, etc.

## Phase 2 — Module Expansion (Next)

- Grant Center (full CRUD + calendar + compliance)
- Financial Center (accounting, budgeting, invoices, tax)
- HR system expansion (time clock, scheduling, benefits, hiring, training)
- Volunteer Management module
- Documents module
- Organization Analytics dashboards
- Enterprise Notifications inbox
- Organization Settings + centralized RBAC UI
- Wire `registerRoutes()` for Prisma-backed endpoints (time-entries, grant reports)

## Phase 3 — Platform Unification

- All apps authenticate via `@ifcdc/auth` through HQ
- HQ polls analytics from each app's `/api/analytics/overview`
- Revenue and user activity aggregation
- Auto-registration for new applications
- AURA monitors all apps and routes support requests

## Enterprise Roles

Founder · Executive Director · Board Members · Administrators · Managers · Employees · Volunteers · Developers · Community Members · Clients

Managed centrally through `server/hq/roles.ts` with legacy role mapping.
