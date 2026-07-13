# AURA Autonomous Operations

**Status:** Phase 1 shipped (July 2026)  
**Product:** IFCDC Headquarters / AURA  
**Route:** `/hq/founder-workspace`  
**API:** `/api/hq/aura/autonomous/*`  
**Scheduler:** `aura_autonomous_ops` (hourly via `/hq/workflows`)

## Mission

AURA operates as Executive Chief of Staff: continuously monitor, prepare, recommend, and organize IFCDC Headquarters work while keeping every high-impact action under Founder approval.

## Phase 1 capabilities

| Capability | Implementation |
|---|---|
| Daily briefing | Reuses `getOrGenerateDailyBriefing` + surfaces in Founder Workspace |
| Continuous monitoring | Composes Enterprise Monitoring + Proactive Intelligence each cycle |
| Executive alerts | Leadership alerts; optional Founder email/SMS when cycle run with notify |
| Autonomous preparation | OS4 prepared actions + Ops5 weekly cadence drafts (review only) |
| Founder Workspace | `/hq/founder-workspace` — priorities, approvals, recommendations, grants, projects, alerts, goals, memory |
| Executive memory | `retrieveOrganizationalMemory` summary on workspace |
| Proactive recommendations | Evidence, sources, risks, benefits, confidence, recommended action |
| Command interface | AURA action `autonomous_operations` + natural language short-circuit |

## Security

- Autonomous **prep only** — no silent external distribution, deploy, or portal submit
- Cycle with Founder channel notify requires Founder Mode
- High-impact recommendations marked `founderApprovalRequired`

## AURA commands

- `Show Founder Workspace`
- `Run autonomous cycle`
- `Daily briefing`
- `Today's priorities`
- `Run autonomous cycle and notify me`

## Related surfaces

- `/hq/founder` — Founder Command Center  
- `/hq/enterprise-ops` — Ops 5.0  
- `/hq/enterprise-os` — OS 4.0  
- `/hq/monitoring` — continuous monitoring  
- `/hq/enterprise-readiness` — production certification  

## Success criteria (Phase 1)

AURA maintains a living Founder Workspace, runs scheduled autonomous cycles, prepares review packages, and surfaces evidence-based recommendations without executing high-impact actions alone.
