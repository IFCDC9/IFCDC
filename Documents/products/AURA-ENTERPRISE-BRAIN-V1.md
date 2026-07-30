# AURA Enterprise Brain v1

Founder-only executive operating surface for IFCDC HQ. Built incrementally on existing engines — does not replace Enterprise Brain 2.0/3.0, Founder Command Center, or AURA Command Center.

## Requirements

- Founder-only access
- Read-only by default
- Confirm before any production-changing action (Action Center — Module 7)
- No secrets or environment variables exposed
- Every AURA Brain v1 action logged (timestamp, user, command, result)

## Module roadmap

| # | Module | Status |
|---|--------|--------|
| 1 | Executive Command Center | **Live** (`/hq/aura-brain` · tab 1) |
| 2 | Organization Health Dashboard | **Live** (`/hq/aura-brain` · tab 2) |
| 3 | Executive Daily Briefing | **Live** (`/hq/aura-brain` · tab 3) |
| 4 | Project Status Monitor | Planned |
| 5 | System Health Monitor | Planned |
| 6 | Executive Priority Queue | Planned |
| 7 | Executive Action Center | Planned |
| 8 | Secure AURA Action Log | Planned (table + write path live with Module 1) |

## Module 1 — Executive Command Center

**API:** `GET /api/hq/aura/brain-v1/command-center`  
**UI:** `/hq/aura-brain`  
**Engine:** `server/hq/auraEnterpriseBrainV1.ts`

Answers:

- What needs my attention?
- What changed since my last login?
- What systems are healthy / require action?
- What projects are active?
- What deployments are pending?
- What emails failed?
- What should I do next?

Sources (aggregated, timeout-bounded): command health, platform services, software division health polls, leadership alerts, activity feed, login history, email delivery status + audit email failures.

Action log table: `aura_enterprise_brain_v1_action_log` (redacts secret-like tokens).

## Module 2 — Organization Health Dashboard

**API:** `GET /api/hq/aura/brain-v1/org-health`  
**UI:** `/hq/aura-brain` · Organization Health tab

Surfaces overall org health grade/score, weighted factors with healthy/watch/action status, and command-health pillars. Read-only; logs `brain_v1.org_health.read`.

## Module 3 — Executive Daily Briefing

**API:** `GET /api/hq/aura/brain-v1/daily-briefing`  
**UI:** `/hq/aura-brain` · Daily Briefing tab

Wraps existing executive daily briefing cache (`getOrGenerateDailyBriefing(false)`) plus Enterprise Brain 2.0 highlights. Does not force-regenerate. Logs `brain_v1.daily_briefing.read`.

## Out of scope (this phase)

- Deploying the optional email template matrix
- Structural architecture changes
- Rebuilding existing HQ modules
