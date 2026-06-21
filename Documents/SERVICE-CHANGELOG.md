# IFCDC Shared Service Changelog

All changes to centralized backend services and `@ifcdc/*` packages are logged here.

**Policy:** Update this file whenever a shared service or package changes.

---

## Format

```
## [version] — YYYY-MM-DD — Package/Service Name
### Added
### Changed
### Fixed
### Migration Notes
```

---

## [1.0.0] — 2026-06-19 — Initial Freeze Release

All services and packages frozen at v1.0.0 as part of enterprise architecture freeze.

### Services (Backend/ifcdc-services/)

| Service | Version | Port | Status |
|---------|---------|------|--------|
| `@ifcdc/auth-service` | 1.0.0 | 4100 | Frozen |
| `@ifcdc/aura-ai-core` | 1.0.0 | 4101 | Frozen |
| `@ifcdc/notification-service` | 1.0.0 | 4102 | Frozen |
| `@ifcdc/payment-service` | 1.0.0 | 4103 | Frozen |
| `@ifcdc/database-service` | 1.0.0 | 4104 | Frozen |

### Packages (Libraries/ifcdc-packages/)

| Package | Version | Status |
|---------|---------|--------|
| `@ifcdc/auth` | 1.0.0 | Frozen |
| `@ifcdc/aura-ai` | 1.0.0 | Frozen |
| `@ifcdc/notifications` | 1.0.0 | Frozen |
| `@ifcdc/payments` | 1.0.0 | Frozen |
| `@ifcdc/ui-components` | 1.0.0 | Frozen |
| `@ifcdc/api-client` | 1.0.0 | Frozen |
| `@ifcdc/database` | 1.0.0 | Frozen |

### Client SDK

| File | Version | Status |
|------|---------|--------|
| `Shared/ifcdc-services.ts` | 1.0.0 | Frozen |

### Migration Notes

- Apps with local auth (Swift-Ware, Tapis, Music, Inclusive) should migrate to Auth Service on next feature touch
- Apps with direct OpenAI calls should migrate to AURA Core on next AI feature
- Apps with direct Stripe should migrate to Payment Service on next payment feature
- No breaking changes until v1.1.0 — additive only

---

*Next entry goes here when a shared service changes.*
