# IFCDC Tapis — Product Document

**Priority:** #2 — Active Development  
**Path:** `Apps/IFCDC-TAPIS/Tapis-Init/`  
**Status:** Working Build — IFCDC Services Wired

---

## Mission

Community circles platform for mentorship, reflection, and moderated group communication within IFCDC.

---

## Build Status

| Check | Result | Date |
|-------|--------|------|
| `npm run check` | ✅ Pass (0 TS errors) | 2026-06-19 |
| `npm run build` | ✅ Pass (`dist/index.cjs` + client bundle) | 2026-06-19 |

---

## IFCDC Service Integration

| Capability | Package / Service | Integration Point |
|------------|-------------------|-------------------|
| Auth | `@ifcdc/auth` | `server/lib/ifcdc.ts` → `signTapisToken` / `verifyTapisToken`; `server/routes.ts` |
| Notifications | `@ifcdc/notifications` | `server/lib/ifcdc.ts` (ready for email flows) |
| Database | Drizzle ORM + PostgreSQL | `server/db.ts` |
| Health | IFCDC services `:4100–4104` | `GET /api/health` |

### Changes

- Replaced direct `bcrypt` + `jsonwebtoken` with `@ifcdc/auth` integration layer
- Fixed `ProductDetail.tsx` optional stock TypeScript error
- Added `.env.example` and health endpoint

---

## Change Log

| Date | Change | Author |
|------|--------|--------|
| 2026-06-19 | Wired `@ifcdc/auth`, `@ifcdc/notifications`; health endpoint; working build | Tessa |

---

*Update this document for all Tapis development activity.*
