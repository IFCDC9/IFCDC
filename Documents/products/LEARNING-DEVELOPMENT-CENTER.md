# IFCDC HQ — Learning & Development Center

**Status:** Implemented (July 12, 2026)  
**Route:** `/hq/learning`  
**API:** `/api/hq/learning/*`

## Purpose
Training foundation linked to the Policy & Governance Center. Supports IFCDC-produced videos and high-quality external courses, role-based required learning paths, quizzes, certificates, acknowledgments, and grant-funded professional development cost tracking.

## Capabilities
| Capability | Detail |
|---|---|
| Courses | IFCDC or external; optional `policy_id` / category link |
| Role paths | employee, volunteer, board_member, manager, grant_manager, contractor |
| Assignments | Assign course → track progress → complete with quiz score |
| Certificates | Issued on pass; code `IFCDC-LD-…` |
| Acknowledgments | Recorded on completion |
| People mirror | Completion can write `people_training` when `person_id` set |
| Grant PD costs | Ledger with optional `grant_award_id` for allowable PD |

## Seed catalog
On first boot: 12 foundational courses + 6 role paths linked to published policies where available.

## Freeze-safe
`server/hq/learningDevelopmentEngine.ts` only — no new packages or microservices.
