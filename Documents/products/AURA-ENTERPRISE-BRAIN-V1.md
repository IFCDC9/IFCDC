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
| 4 | Project Status Monitor | **Live** (`/hq/aura-brain` · tab 4) |
| 5 | System Health Monitor | **Live** (`/hq/aura-brain` · tab 5) |
| 6 | Executive Priority Queue | **Live** (`/hq/aura-brain` · tab 6) |
| 7 | Executive Action Center | **Live** (`/hq/aura-brain` · tab 7) |
| 8 | Secure AURA Action Log | **Live** (`/hq/aura-brain` · tab 8) |

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

## Module 4 — Project Status Monitor

**API:** `GET /api/hq/aura/brain-v1/projects`  
**UI:** `/hq/aura-brain` · Projects tab

Software Division registry + health polls: active projects, pending production status, unhealthy apps. Logs `brain_v1.projects.read`.

## Module 5 — System Health Monitor

**API:** `GET /api/hq/aura/brain-v1/system-health`  
**UI:** `/hq/aura-brain` · Systems tab

Wraps Enterprise Monitoring overview (components + alerts). Logs `brain_v1.system_health.read`.

## Module 6 — Executive Priority Queue

**API:** `GET /api/hq/aura/brain-v1/priority-queue`  
**UI:** `/hq/aura-brain` · Priority Queue tab

Ranked attention items from Command Center. Logs `brain_v1.priority_queue.read`.

## Module 7 — Executive Action Center

**API:** `GET /api/hq/aura/brain-v1/actions`, `POST /api/hq/aura/brain-v1/actions/execute`  
**UI:** `/hq/aura-brain` · Action Center tab

Safe navigate/acknowledge actions only. Confirm required for acknowledgments. Production-changing actions blocked. All executions logged.

## Module 8 — Secure AURA Action Log

**API:** `GET /api/hq/aura/brain-v1/action-log`  
**UI:** `/hq/aura-brain` · Action Log tab

Founder-only read of `aura_enterprise_brain_v1_action_log` (timestamp, user, command, result). Secret-like tokens redacted.

## Out of scope (this phase)

- Deploying the optional email template matrix
- Structural architecture changes
- Rebuilding existing HQ modules
