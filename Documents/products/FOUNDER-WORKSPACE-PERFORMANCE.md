# Founder Workspace Performance Report

**Date:** July 13, 2026  
**Surface:** `/hq/founder-workspace`  
**API:** `GET /api/hq/aura/autonomous/workspace`

## Root causes

1. **Heavy sequential aggregators** — workspace waited on Mission Control + EO5 Command Center + full monitoring (nested 8–14s probes) + organizational memory embeddings.
2. **UI treated every fetch as a blocking load** — `isLoading || cyclePending` hid the whole dashboard indefinitely.
3. **Client timeout 45s** — Refresh appeared to hang until the heavy build finished or timed out.
4. **Null cards** — when heavy builders failed/timed out, org health / pipeline / system health fell through to “No data.”

## Fixes

| Change | Detail |
|---|---|
| Light parallel sources | Org health, grant dashboard, finance, monitoring (cached), briefing, approvals, workforce, DB counts — each hard-timed 1.5–4s |
| Removed from critical path | `buildEnterpriseOsMissionControl`, `buildEnterpriseOperationsCommandCenter`, memory retrieval |
| Server cache | 25s in-memory TTL; `?refresh=1` bypasses |
| Client timeout | 12s for workspace fetch |
| Loading UX | Full-page loading only on **first** load; refresh shows “Refreshing…” / “Last updated…” while cards stay visible |
| Status vocabulary | Live · No data · Unavailable (timeout) · Service unavailable |

## Request inventory (parallel)

| Source | Timeout | Purpose |
|---|---|---|
| `buildOrganizationHealthScore` | 2.5s | Organization Health |
| `buildGrantExecutiveDashboard` | 2.5s | Funding Pipeline / Active Grants |
| `buildExecutiveDashboard` (finance) | 2.5s | Financial Summary |
| `buildEnterpriseMonitoringOverview` (cached) | 4s | System Health |
| `getOrGenerateDailyBriefing` | 2.5s | Executive Briefing |
| `listLeadershipAlerts` | 2s | Critical Alerts |
| `listStrategicGoals` | 2s | Goals |
| `buildApprovalQueue` | 2s | Pending Approvals |
| `buildWorkforceDashboard` | 2.5s | HR Summary |
| `buildTechnicalCommandBriefing` | 3s | Software Division |
| DB prepared / cycle / docs / comms / projects | 1.5s | Supporting cards |

Wall time ≈ **max(individual timeouts)** under contention, typically **well under 5s** when sources are healthy; cached hits return in milliseconds.

## Performance goals

| Goal | Target | Mechanism |
|---|---|---|
| Initial load (cached) | &lt; 2s | 25s server cache |
| Refresh | &lt; 5s | Parallel timed probes + 12s client cap |
| No infinite loading | Required | First-load-only spinner; refresh non-blocking |

## Health score

`performance.workspaceHealthScore` is returned on every payload:

- % of cards in `live` status  
- penalties for timeouts and &gt;5s wall time  

Footer on the page shows: health %, total ms, slowest endpoint, live/degraded/empty counts.

## Remaining bottlenecks

- Cold monitoring overview (first uncached) can still approach ~4s (capped).
- Grant/finance SQLite aggregates on large DBs may approach 2.5s caps.
- Autonomous **cycle** (separate action) remains intentionally heavier and must not block workspace paint.
