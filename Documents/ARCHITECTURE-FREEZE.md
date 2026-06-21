# IFCDC Enterprise Architecture — FROZEN

**Status:** FROZEN as of June 19, 2026  
**Workstation:** Mac — Permanent IFCDC Headquarters  
**Policy:** No additional structural changes without explicit executive authorization

---

## Freeze Declaration

The IFCDC enterprise architecture is **locked**. Phase 1 (Headquarters) and Phase 2 (Enterprise Platform) are complete. All future work is **product development** within this architecture — not infrastructure refactoring.

### What Is Frozen

| Layer | Location | Status |
|-------|----------|--------|
| Workspace structure | `Apps/`, `Backend/`, `Libraries/`, `Shared/`, `Media/`, `Documents/`, `Archive/` | 🔒 Locked |
| Shared libraries | `Libraries/ifcdc-packages/packages/` | 🔒 Locked |
| Backend services | `Backend/ifcdc-services/` | 🔒 Locked |
| App generator | `Libraries/ifcdc-cli/` | 🔒 Locked |
| Client SDK | `Shared/ifcdc-services.ts` | 🔒 Locked |
| Cursor workspace | `IFCDC.code-workspace` | 🔒 Locked |

### What Is NOT Frozen (Allowed Changes)

- Product features within existing apps
- Bug fixes and App Store submission work
- Wiring apps to use centralized services (migration, not restructuring)
- Documentation updates (required when shared services change)
- Environment configuration per app

### Prohibited Without Authorization

- New top-level directories
- New shared library packages (use existing 7)
- New backend service types (use existing 5)
- Duplicated auth, payment, notification, or AI implementations
- Folder moves or project reorganization
- Dependency downgrades from React 19 / Vite 7 standard

---

## Canonical Architecture

```
IFCDC/
├── Apps/                          # Product applications
├── Backend/ifcdc-services/        # Centralized microservices
│   ├── auth-service/              # Port 4100
│   ├── aura-ai-core/              # Port 4101
│   ├── notification-service/      # Port 4102
│   ├── payment-service/           # Port 4103
│   └── database-service/          # Port 4104
├── Libraries/
│   ├── ifcdc-packages/            # @ifcdc/* npm packages (7)
│   └── ifcdc-cli/                 # App generator
├── Shared/
│   └── ifcdc-services.ts          # Client SDK
├── Documents/                     # Architecture & product docs
├── Media/                         # Brand assets
└── Archive/                       # Backups & retired code
```

---

## Mandatory Service Usage

Every new feature **must** use centralized services. No exceptions.

| Capability | Use This | Never Duplicate |
|------------|----------|-----------------|
| Authentication | `@ifcdc/auth` + Auth Service `:4100` | Custom JWT, passport-only, local bcrypt auth |
| AI / AURA | `@ifcdc/aura-ai` + AURA Core `:4101` | Direct OpenAI calls in app code |
| Notifications | `@ifcdc/notifications` + Notification Service `:4102` | Direct Twilio, custom email senders |
| Payments | `@ifcdc/payments` + Payment Service `:4103` | Direct Stripe SDK in app routes |
| Database | `@ifcdc/database` + Database Service `:4104` | Ad-hoc pg pools per feature |
| HTTP to IFCDC APIs | `@ifcdc/api-client` | Raw fetch without typed client |
| UI utilities | `@ifcdc/ui-components` | Copy-pasted cn()/brand constants |

### Client SDK

All apps import centralized service calls from:

```
Shared/ifcdc-services.ts
```

Or install `@ifcdc/*` packages directly via `file:` paths in `package.json`.

---

## Service Port Map (Canonical)

| Service | Port | Health Endpoint |
|---------|------|-----------------|
| Auth | 4100 | `http://localhost:4100/health` |
| AURA AI | 4101 | `http://localhost:4101/health` |
| Notifications | 4102 | `http://localhost:4102/health` |
| Payments | 4103 | `http://localhost:4103/health` |
| Database | 4104 | `http://localhost:4104/health` |

Environment variables (all apps):

```
IFCDC_AUTH_URL=http://localhost:4100
IFCDC_AURA_URL=http://localhost:4101
IFCDC_NOTIFICATIONS_URL=http://localhost:4102
IFCDC_PAYMENTS_URL=http://localhost:4103
IFCDC_DATABASE_URL=http://localhost:4104
```

---

## Documentation Policy

When any shared service or `@ifcdc/*` package changes, update:

1. `Documents/SERVICE-CHANGELOG.md` — what changed, version, migration notes
2. Affected package `README.md` in `Libraries/ifcdc-packages/packages/<name>/`
3. `Shared/ifcdc-services.ts` JSDoc if client SDK surface changes

---

## Stack Standard (Frozen)

| Technology | Version |
|------------|---------|
| Node.js | 20+ (v24 LTS on HQ Mac) |
| React | 19.2.0 |
| Vite | 7.3.0 |
| TypeScript | 5.6.3 |
| Express | 4.21+ / 5.x |
| Drizzle ORM | 0.39+ (or Prisma 7 for Imperial Foundation only) |

---

## Reference Documents

| Document | Purpose |
|----------|---------|
| `ARCHITECTURE-FREEZE.md` | This file — frozen architecture policy |
| `PRODUCT-ROADMAP.md` | Product priority order and focus |
| `ENTERPRISE-ARCHITECTURE-REPORT.md` | Phase 2 technical report |
| `DEVELOPMENT-HEADQUARTERS-REPORT.md` | Phase 1 audit report |
| `SERVICE-CHANGELOG.md` | Shared service change log |

---

*Architecture frozen. Build products.*
