# IFCDC Product Roadmap

**Mode:** Product Development — Ecosystem Build  
**Headquarters:** Mac — `~/Development/IFCDC/`  
**North Star:** `Documents/HEADQUARTERS-VISION.md` — Enterprise Operating System  
**Updated:** June 19, 2026

---

## Platform Status

The IFCDC Enterprise Platform is **complete and stable**. Infrastructure is frozen.

The long-term destination is the **IFCDC Headquarters Platform** — the digital command center for the entire organization. See `Documents/HEADQUARTERS-PLATFORM-MAP.md` for how today's frozen kernel maps to that vision.

**Imperial Foundation CDC** (`Apps/IMPERIAL-FOUNDATION-CDC/`) is the **IFCDC Headquarters host** — Phase 1 foundation is live. See `Documents/HEADQUARTERS-IMPLEMENTATION.md`.

| Layer | Status |
|-------|--------|
| Shared libraries (`@ifcdc/*`) | ✅ Stable |
| Backend services (`:4100–4104`) | ✅ Stable |
| App generator (`ifcdc-cli`) | ✅ Stable |
| Client SDK (`Shared/ifcdc-services.ts`) | ✅ Stable |

**No architectural refactoring** unless required for security, performance, or stability.

---

## Locked Production Software

| Product | Path | Policy |
|---------|------|--------|
| **IFCDC Barbers App** | `Apps/IFCDC-BARBERS-APP/` | 🔒 **Permanently locked** — no code changes, dependency upgrades, or structural modifications without explicit authorization |

---

## Product Priority Order

| # | Phase | Focus | Status |
|---|-------|-------|--------|
| **1** | **Single Login & Enterprise RBAC** | HQ JWT, 10 roles, permission matrix | ✅ Live |
| **2** | **People Management Center** | Master people database for entire ecosystem | ✅ Live |
| **3** | **Financial Center** | Complete accounting engine — GL, AP/AR, payroll, bank reconciliation, statements, audit | ✅ Live |
| **4** | **Grant Center Phase 2** | Full lifecycle integrated with Financial Center — budgets, labor, expenditures, compliance | ✅ Live |
| **5** | **Software Division Expansion** | Version, build, deployment, health, analytics, performance, usage, errors | Planned |
| **6** | **Analytics & Executive Reporting** | Cross-module KPIs — finance, grants, HR, programs, donations, software health | Planned |
| **7** | **Remaining HQ Modules** | Housing, Scholarships, Programs, Media, Documents, Notifications, Settings | Planned |

### Long-Term Vision

Headquarters functions as the **ERP for IFCDC** — one login, one financial system, one HR system, one grant system, one analytics engine, one AURA AI. Every application (Barbers, Music, Radio, Tapis, Inclusive Community, Swift-Ware, CryptoCoin, and future software) plugs into this centralized platform.

**Barbers App remains production locked** and serves as the quality benchmark for all future applications.

### Application Deployment Order (after HQ operational)

| # | Product | Path |
|---|---------|------|
| 1 | IFCDC Headquarters | `Apps/IMPERIAL-FOUNDATION-CDC/` |
| 2 | IFCDC Music App | `Apps/IFCDC-MUSIC-APP/IFCDC-MUSUC-APP/` |
| 3 | IFCDC Tapis | `Apps/IFCDC-TAPIS/Tapis-Init/` |
| 4 | Inclusive Community | `Apps/INCLUSIVE-COMMUNITY-IFCDC/InclusiveCommunity/` |
| 5 | Swift-Ware | `Apps/IFCDC-SWIFT-WARE/Swift-Ware/` |
| 6 | CryptoCoin IFCDC | `Apps/CRYPTOCOIN-IFCDC/CryptoCoinIFCDC/` |
| 7 | IFCDC Radio | `Apps/IMPERIAL-FOUNDATION-CDC/` (radio module) |

---

## Development Protocol (Per Application)

1. **Complete core functionality** — all MVP features working end-to-end
2. **Polish UI/UX** — production-quality, IFCDC-branded experience
3. **Integrate centralized services** — Auth, AURA AI, Notifications, Payments, Database
4. **Pass MVP Gate** — all 18 requirements in `Documents/IFCDC-MVP-STANDARD.md`
5. **Generate 6 post-MVP deliverables** — `Documents/templates/MVP-DELIVERABLES-TEMPLATE.md`
6. **Then proceed** to the next application

**Do not proceed until production-ready MVP status is achieved.**

---

## Product #1: IFCDC Headquarters — Enterprise Auth (Complete)

**Documentation:** `Documents/ENTERPRISE-AUTH.md`

- Single sign-on via HQ JWT cookie
- 10 enterprise roles with permission matrix
- Permission-gated navigation and routes
- `POST /api/hq/auth/verify` for connected apps
- Organization Settings role matrix UI

## Product #1b: IFCDC Headquarters — Module Build (Active)

**Implementation status:** `Documents/HEADQUARTERS-IMPLEMENTATION.md`

---

## Product #2: IFCDC Music App (Paused — resumes after HQ Phase 2 modules)

**MVP checklist:** `Documents/products/MUSIC-APP-MVP.md`  
**MVP standard:** `Documents/IFCDC-MVP-STANDARD.md`  
**Post-MVP folder:** `Documents/products/MUSIC-APP-MVP-COMPLETE/` *(on gate pass)*

### Stack
React 18 | Vite 7 | Express 5 | Drizzle | FFmpeg | Electron desktop

### MVP Focus
- DJ library management + AURA AI assistant
- Crate assembly + client delivery
- Booking calendar + deposit payments
- Polished landing/auth + unified app shell

---

## Product #2: IFCDC Tapis

**Path:** `Apps/IFCDC-TAPIS/Tapis-Init/`  
**Status:** Services wired, build clean — awaiting MVP sprint

Community circles platform for mentorship, reflection, and moderated communication.

---

## Product #3: Inclusive Community

**Path:** `Apps/INCLUSIVE-COMMUNITY-IFCDC/InclusiveCommunity/`  
**Status:** AURA AI wired, build clean — awaiting MVP sprint

Autism support platform with sensory tools, routines, and AI communication assistance.

---

## Product #4: Imperial Foundation CDC

**Path:** `Apps/IMPERIAL-FOUNDATION-CDC/`  
**Status:** Build clean — awaiting MVP sprint

Community health system API and public-facing CDC platform.

---

## Product #5: Swift-Ware

**Path:** `Apps/IFCDC-SWIFT-WARE/Swift-Ware/`  
**Status:** Auth wired, build clean — awaiting MVP sprint

Business management platform for IFCDC organizations.

---

## Product #6: CryptoCoin IFCDC

**Path:** `Apps/CRYPTOCOIN-IFCDC/CryptoCoinIFCDC/`  
**Status:** Integration layer wired, build clean — awaiting MVP sprint

ERC-20 token platform with liquidity pools and analytics.

---

## Feature Development Rules

Every new feature:

1. **Check** `@ifcdc/*` packages and backend services first
2. **Use** centralized services — never duplicate auth, AI, payments, notifications
3. **Route** through `server/lib/ifcdc.ts` integration layer
4. **Document** in `Documents/products/<APP>.md`
5. **Log** shared service changes in `Documents/SERVICE-CHANGELOG.md`

---

*One platform. Six missions. Build the IFCDC software ecosystem.*
