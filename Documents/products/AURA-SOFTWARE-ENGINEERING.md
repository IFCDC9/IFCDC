# AURA Software Engineering Engine

**Status:** Phase 1 shipped (July 2026)  
**Product:** IFCDC Headquarters / AURA  
**Route:** `/hq/software-engineering`  
**API:** `/api/hq/aura/software-engineering/*`

## Mission

AURA is IFCDC’s controlled AI Chief Software Engineer: inspect, diagnose, prepare fixes, run real tests (when a workspace is configured), and stage Founder approvals — without silent production changes.

## Hybrid execution model

| Host | Allowed |
|---|---|
| **Render (production HQ)** | Code index via GitHub API, portfolio health, diagnoses, change packages, Founder approval records, PR/deploy *instructions* |
| **`AURA_SE_WORKSPACE_ROOT` (Founder Mac / agent)** | Branch create, real `npm run check\|build\|test`, local commit, push *after* Founder approval |
| **Never without Founder approval** | Push, merge to main, force-push, production deploy/restart/rollback, destructive DB |

## Security

- Repository allowlist (`auraSoftwareEngineeringPolicy.ts`)
- No `.env` bodies; env **names** only from `.env.example`
- Secret redaction in snippets
- Destructive verb blocklist
- Audit log: `aura_se_audit_log`
- Approval records must include repository, branch, commit, service, action, risk summary

## AURA tools

- `se_portfolio_status`
- `se_diagnose`
- `se_prepare_fix`
- `se_run_tests`
- `se_prepare_pr`
- `se_compare_deploy`
- `se_request_founder_approval`

## Founder workflow

1. Command → inspect / diagnose  
2. Prepare change package on `aura/se-*` branch (workspace)  
3. Run real tests (or receive `blocked_no_workspace` — never a fake pass)  
4. Request Founder approval with exact action metadata  
5. Founder approves → push/PR/deploy instructions  
6. Manual Deploy on Render when `autoDeploy: false`  
7. Verify live commit alignment  

## First acceptance test (low-risk)

Target: HQ lacked a Software Engineering surface (nav + dashboard). Non-destructive UI/ops capability.

Acceptance script: `script/aura-se-acceptance.mjs`

```bash
export IFCDC_BASE_URL=https://ifcdc-hq-wst6.onrender.com   # or http://localhost:5000
export MASTER_OWNER_EMAIL=service@ifcdc.org
export FOUNDER_SEED_PASSWORD='…'
# Optional for local index/tests:
export AURA_SE_WORKSPACE_ROOT=/Users/fahrealallah/Development/IFCDC
node script/aura-se-acceptance.mjs
```

## Env

| Variable | Purpose |
|---|---|
| `GITHUB_TOKEN` | Index + commit alignment |
| `GITHUB_OWNER` / `GITHUB_REPO` / `GITHUB_BRANCH` | Override defaults (`IFCDC9/IFCDC`, `main`) |
| `AURA_SE_WORKSPACE_ROOT` | Local monorepo root for git/tests |
| `AURA_SE_EXTRA_REPOS` | `owner/repo\|branch\|prefix1;prefix2,...` |
| `RENDER_GIT_COMMIT` | Live commit compare (set by Render) |

## Out of scope (Phase 1)

Auto production deploy, Render restart, production migrations, AST semantic index, mobile device farm.
