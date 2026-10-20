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
| **Render (production HQ)** | **Production control plane** (healthy). Diagnose, portfolio, approvals, deploy inspection. No local git/npm on the web process — this is intentional, not an error. |
| **Founder workstation** | Auto-detects the IFCDC monorepo, or set `AURA_SE_WORKSPACE_ROOT`. Branch/test/commit enabled. Push still needs Founder approval. |
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

## Engineering workflow (October 2026)

The Founder assigns a bounded task from **Software Engineering** (`/hq/software-engineering`). AURA operates the task. She is not the Founder account.

### Implemented locally; not yet verified in production

- Approved repository: `IFCDC9/IFCDC` (this Headquarters repo). No new git host.
- Isolated git worktree under the existing `.aura-engineer-worktrees` parent. The task branch is created from `origin/main`.
- Scoped terminal: `node --test` on a `script/*.test.*` file. Deploy, force-push, hook skip, secret printing, and git config changes are refused.
- File edit inside that worktree, then a recorded pass/fail.
- Reviewable GitHub pull request attributed to the authenticated requesting session. Audit operator remains AURA (`kind ai_operator`, `role aura`, `isFounder false`).
- Founder authorization for the task. `exec@ifcdc.org` and roles `exec` / `executive` / `executive_director` cannot approve, even if a founder flag is set.
- `autoDeploy` stays false. The workflow does not merge or deploy.
- Fetch and push destinations must both resolve to `IFCDC9/IFCDC` on GitHub.
- Linked files and directories inside a worktree are rejected before edits and test execution.
- Test subprocesses receive a small environment allowlist, not HQ tokens, database settings, or Node injection options. Output is bounded.
- Failed tasks and successful local-only tasks keep their worktree for inspection. Only work published in a PR may be cleaned automatically; `AURA_SE_RETAIN_WORKSPACE=1` retains published work too.

### Still missing

- A model that invents an arbitrary product patch from a vague bug report. This workflow writes the Founder's note, or explicit edits the Founder already supplied, then tests and opens the pull request.
- Merge to `main`, production deploy, restart, and migration.
- Running the git worktree on the Render control plane. Render remains diagnose / approve / inspect. Branch, test, and pull request run on the Founder workstation.
- Remote dispatch of engineering edits/tests. The separate [Mac runner bridge](AURA-MAC-RUNNER.md) implements authenticated repository inspection only; this engineering task form is not forwarded to the Mac.
- An OS/container sandbox for generated code. A git worktree and an environment allowlist do not restrict a test script's file, process, or network access. Use only reviewed code on the local runner until that sandbox exists.
- Voice. `auraBrainV1ReadOnlyAsk` is not part of this branch.

### Separate human/operator steps (Cursor is optional)

- Reviewing and merging the pull request.
- Manual Deploy on Render after a separate Founder decision.
- Interactive debugging when the recorded test output is not enough.
- Work outside `IFCDC9/IFCDC`.

### Founder steps

1. On the Founder workstation, open Headquarters and sign in with the Founder account.
2. Open **Software Engineering** (Operations).
3. In **Assign engineering work**, type the note AURA should write and click **Assign to AURA**.
4. The same assignment can be typed in **Founder command** as `assign engineering task:` followed by the note, then **Run**.
5. Read the reply for the pull request URL. Review it on GitHub.
6. Do not merge, Manual Deploy, send mail, or submit a grant from this task.

### Local verification

Run `node --import tsx --test --test-concurrency=1 script/hq-aura-engineering-workflow.test.ts`.
The tests use temporary repositories and SQLite storage, and do not push or open a PR.
The demonstration script uses a synthetic test session and is local-only; it does not prove a real Founder login or publish changes.
