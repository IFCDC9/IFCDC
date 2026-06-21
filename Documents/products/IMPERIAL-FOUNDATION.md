# Imperial Foundation CDC — Product Document

**Priority:** #6  
**Path:** `Apps/IMPERIAL-FOUNDATION-CDC/`  
**Status:** Working Build — TypeScript Clean

---

## Build Status

| Check | Result | Date |
|-------|--------|------|
| `npm run check` | ✅ Pass | 2026-06-19 |
| `npm run build` | ✅ Pass (`dist/index.cjs`) | 2026-06-19 |

---

## IFCDC Service Integration

Imperial Foundation is a large monolithic health-system API (`server/index.ts` + modular routes). Existing health endpoint at `/api/health` via `server/routes/health.routes.ts`.

### Fixes Applied

- Resolved `AuthedRequest` / Express `User` type conflicts in `server/middleware/auth.ts`
- Fixed `donations.ts` SQLite null reference (`getDb()` instead of stale `db` export)

### Follow-up (non-blocking)

- Incremental migration of inline `bcryptjs`/`jwt` in `server/index.ts` to `@ifcdc/auth` integration layer (large surface area; build is clean without full migration)

---

## Change Log

| Date | Change | Author |
|------|--------|--------|
| 2026-06-19 | Auth middleware TS fixes; donations db fix; working build | Tessa |
