# AURA Enterprise Operations 5.0

**Status:** Phase 1 shipped (July 2026)  
**Product:** IFCDC Headquarters / AURA  
**Route:** `/hq/enterprise-ops`  
**API:** `/api/hq/aura/os5/*`

## Mission

Transform AURA into the Enterprise Operations Engine for IFCDC Headquarters: coordinate departments, projects, cadences, and Founder-gated decisions as one system.

## What Phase 1 delivers

| Capability | Implementation |
|---|---|
| Multi-department orchestration | Durable **ops runs** with department steps (grants, finance, HR, software, compliance, docs, calendar, workflows) |
| Enterprise commands | NL → `runEnterpriseOperations5` (e.g. “Prepare next month's board meeting”) |
| Recurring automation | Cadences: weekly exec, monthly board, financial, compliance, grant status, technology health |
| Executive Command Center | Live org health, goals, pipeline, finance, HR, technology, compliance, alerts, approvals |
| Continuous improvement | Heuristics from Mission Control + workforce capacity + deploy alignment |
| Security | Founder Mode for create/approve/prepare; external distribution never auto-sent |

## Architecture (freeze-safe)

- Engine: `server/hq/auraEnterpriseOs5.ts`
- Routes: `server/routes/enterpriseOps5.routes.ts` → `/api/hq/aura/os5`
- AURA action: `enterprise_operations_5`
- Command-layer short-circuit before Software Engineering / LLM
- Composes **OS 4.0**, Build 60 ops, strategic goals, workforce, SE dashboard — does not replace Phase 10 or OS 4.0 pages

## Persistence

- `aura_eo5_ops_runs`
- `aura_eo5_cadence_preps`
- `aura_eo5_audit` (+ HQ audit mirror)

## Founder gates

- Creating ops runs and preparing cadences requires Founder Mode
- Ops runs start as `awaiting_founder` when any step is high-impact
- Cadence packages are **draft** until Founder review; external distribution remains gated

## Example commands

- `Show Enterprise Operations Command Center`
- `Prepare next month's board meeting`
- `Prepare weekly executive report`
- `Show continuous improvement`

## Success criteria (Phase 1)

AURA can open a single Command Center, create multi-department ops runs from natural language, prepare recurring packages for Founder approval, and surface continuous-improvement recommendations from live HQ data — without silent external distribution.
