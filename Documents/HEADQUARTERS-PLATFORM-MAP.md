# IFCDC Headquarters — Platform Map

**Purpose:** Connect the approved Headquarters vision to the frozen enterprise architecture and current execution plan.  
**Vision:** `HEADQUARTERS-VISION.md`  
**Updated:** June 19, 2026

---

## What Exists Today (Frozen Foundation)

The enterprise platform built in Phase 2 is the **kernel** of Headquarters. It does not need to be rebuilt.

```
┌─────────────────────────────────────────────────────────────────┐
│                  IFCDC HEADQUARTERS (Vision)                     │
│         Digital command center for the entire organization       │
├─────────────────────────────────────────────────────────────────┤
│  Executive │ HR │ Finance │ Programs │ Software │ Comms │ Docs  │
├─────────────────────────────────────────────────────────────────┤
│              AURA AI Command Center (organization-wide)          │
├─────────────────────────────────────────────────────────────────┤
│  Analytics Layer │ RBAC │ Enterprise App Store │ Notifications  │
├─────────────────────────────────────────────────────────────────┤
│           FROZEN ENTERPRISE KERNEL (built — do not rebuild)      │
│  @ifcdc/auth │ @ifcdc/aura-ai │ @ifcdc/notifications            │
│  @ifcdc/payments │ @ifcdc/database │ @ifcdc/ui-components        │
│  Backend :4100–4104 │ Shared/ifcdc-services.ts │ ifcdc-cli       │
└─────────────────────────────────────────────────────────────────┘
```

---

## Module → Implementation Map

| Headquarters Module | Current State | Host / Path | Next Phase |
|---------------------|---------------|-------------|------------|
| **Executive Dashboard** | Partial | `IMPERIAL-FOUNDATION-CDC` stats/dashboard widgets | Imperial MVP sprint |
| **Founder Dashboard** | Not built | Imperial Foundation | Post-Imperial MVP |
| **Organization Analytics** | Partial | Per-app `/api/analytics`, `/api/health` | HQ aggregation service |
| **Organization Health Score** | Not built | Composite of app health + KPIs | V2 Headquarters |
| **HR — Employees** | Partial | Imperial `/api/hr/*` | Imperial MVP sprint |
| **HR — Time Clock** | Partial | Imperial `/api/time-entries` | Imperial MVP sprint |
| **Finance — Grants** | Partial | Imperial grant reports, funding sources | Imperial MVP sprint |
| **Finance — Donations** | Partial | Imperial donations + Stripe | Imperial MVP sprint |
| **Programs** | Partial | Imperial programs, logic models, barber, radio | Program dashboards |
| **Software Division** | In progress | `Apps/*` — each app wires to `@ifcdc/*` | App-by-app MVP gate |
| **AURA Command Center** | Kernel live | `@ifcdc/aura-ai` + `:4101` | Per-app → org-wide memory |
| **Communications** | Kernel live | `@ifcdc/notifications` + `:4102` | HQ announcement center |
| **Documents** | Partial | Imperial policies, GCS in Music App | HQ document vault |
| **Analytics** | Per-app | Music Analytics, Imperial reports | HQ rollup dashboard |
| **Security / RBAC** | Per-app | `rolePermissions.ts`, Imperial roles | Unified HQ role matrix |
| **Enterprise App Store** | Future | `ifcdc-cli` generator | Post all-app MVPs |

---

## Software Division — App Reporting Model

Every IFCDC application reports to Headquarters through a standard contract:

| Signal | Endpoint / Mechanism | Status |
|--------|----------------------|--------|
| **Health** | `GET /api/health` + IFCDC service probes | ✅ Music, Tapis, Swift-Ware, Inclusive, CryptoCoin |
| **Identity** | `@ifcdc/auth` JWT with `userId`, `role`, `email` | ✅ Wired in active apps |
| **Usage analytics** | `GET /api/analytics/overview` (per-app) | ✅ Music App |
| **Admin oversight** | `GET /api/admin/*` (role-gated) | ✅ Music App |
| **HQ aggregation** | Central dashboard consuming app APIs | 🔜 Imperial Foundation convergence |

### App Priority (unchanged — Music first)

1. IFCDC Music App ← **active MVP sprint**
2. IFCDC Tapis
3. Inclusive Community
4. Imperial Foundation CDC ← **natural Headquarters shell**
5. Swift-Ware
6. CryptoCoin IFCDC

Barbers App: **locked** — flagship production, reports to HQ when HQ aggregation is live.

---

## AURA — One AI Architecture

```
                    ┌──────────────────────┐
                    │  AURA Command Center │
                    │  (HQ — future UI)    │
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐
                    │  aura-ai-core :4101  │
                    │  Organization memory │
                    └──────────┬───────────┘
           ┌───────────────────┼───────────────────┐
           │                   │                   │
    ┌──────▼──────┐    ┌───────▼──────┐   ┌───────▼──────┐
    │ Music App   │    │ Tapis        │   │ Inclusive    │
    │ server/lib/ │    │ server/lib/  │   │ server/lib/  │
    │ ifcdc.ts    │    │ ifcdc.ts     │   │ ifcdc.ts     │
    └─────────────┘    └──────────────┘   └──────────────┘
```

**Rule:** No app implements its own AI stack. All flows through `@ifcdc/aura-ai` or `:4101`.

---

## RBAC — Unified Role Matrix (Target)

Headquarters will unify per-app roles into one organization-wide matrix:

| HQ Role | Maps To App Roles |
|---------|-------------------|
| Founder | `superadmin` across all apps |
| Executive | `admin` + cross-department read |
| Director | `admin` within department |
| Manager | `dj` / `mentor` / `case_manager` equivalents |
| Employee | `user` / `employee` |
| Volunteer | `volunteer` |
| Client | `client` |
| Community Member | `guest` → registered `user` |
| Developer | `admin` in Software Division only |

Current implementation: per-app `rolePermissions.ts` and server `requireRole()` — converges during Imperial Foundation MVP sprint.

---

## Execution Phases

### Phase A — Now (Product MVPs)
Complete each commercial app against `IFCDC-MVP-STANDARD.md`.  
**Active:** Music App. **Blocked:** all others until Music passes gate.

### Phase B — Imperial Foundation Convergence
Imperial Foundation CDC becomes the Headquarters shell. Existing modules (HR, grants, programs, donations) upgraded to production MVP and wired as HQ department dashboards.

### Phase C — HQ Aggregation Layer
- Central analytics rollup from all app `/api/health` + `/api/analytics`
- Organization Health Score composite
- Software Division launcher (links to all apps with SSO)

### Phase D — Enterprise App Store
- One-click app install via `ifcdc-cli`
- Automatic sharing of auth, AURA, notifications, analytics, payments

---

## What We Do NOT Do Now

Per `ARCHITECTURE-FREEZE.md`:

- ❌ Rebuild the frozen kernel (`@ifcdc/*`, backend services)
- ❌ Create new top-level directories
- ❌ Start full Headquarters UI before Music MVP gate passes
- ❌ Modify Barbers App

---

## Immediate Next Action

**Continue IFCDC Music App MVP sprint** — the Software Division's first production-ready commercial product. Every Music App integration (`@ifcdc/auth`, AURA, payments, notifications, analytics, admin portal) is a **prototype of how all apps will report to Headquarters**.

---

*The vision is approved. The foundation is built. Execution is phased and disciplined.*
