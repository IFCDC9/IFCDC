# Document Management — Enterprise QA

**Module:** `/hq/documents`  
**API:** `/api/hq/documents/*`  
**RBAC:** `hq.settings`  
**SLA:** Loads in ≤ 5 seconds, no crash, no infinite spinner

## Root cause (crash)

`DocumentCenterPage.tsx` used `<HqLoading />` without importing it — `ReferenceError` blocked the document library table from rendering.

## Fix summary

| Layer | Change |
|-------|--------|
| Crash | Import `HqLoading`; wrap library in `HqQueryBoundary` with placeholder data |
| API | `hqApiFetch` + 5s timeout; degraded empty JSON on server errors |
| Categories | Grants, Board Records, IRS/Nonprofit, Policies, Contracts, Program Files, Reports, Founder Approvals (+ legacy) |
| Actions | Upload, search/filter, approve/reject, archive/restore, version, OCR index, sign |
| RBAC | `canViewAccessLevel` on list/detail; approve/archive gated to executive roles |
| Mobile | Card list on ≤768px; stacked toolbar; responsive modals |
| Schema | `lifecycle_status` column for archive |

## Verification checklist

- [ ] `/hq/documents` loads without white screen
- [ ] Upload document (file or URL) succeeds
- [ ] Search and folder filters work
- [ ] Approve/reject on pending documents (founder/executive)
- [ ] Archive and restore work
- [ ] iPhone layout: cards visible, no horizontal overflow
- [ ] `GET /api/hq/documents` < 5s
- [ ] Render commit matches GitHub `main`

## Commands

```bash
npm run check && npm run build
IFCDC_BASE_URL=https://ifcdc-hq-wst6.onrender.com FOUNDER_SEED_PASSWORD=<Render> node script/documents-readiness.mjs
```

## Founder sign-off

| Check | Result | Date |
|-------|--------|------|
| GitHub main | | |
| Render live | | |
| Founder approval | | |
