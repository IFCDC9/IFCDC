# AURA Creative Video Production — Global Identity

**Status:** Permanent organization-wide rule  
**Scope:** Every video / film / commercial / promo / social / training / music video / documentary / short / branded piece created through AURA Resolve

## Defaults (automatic)

| Field | Value |
|---|---|
| `PRODUCTION_COMPANY` | `IFCDC PRODUCTIONS` |
| `PRODUCTION_IDENTITY` | `IFCDC PRODUCTION` |
| Production credit | `AN IFCDC PRODUCTION` |

The planner inherits these without the Founder stating them. `brandPromoted` is inferred from the instruction (product/program) and is never conflated with the production company.

## Distinctions

1. **Ownership / metadata** — always IFCDC PRODUCTIONS
2. **Visible branding** — template + Founder direction; cards available, not auto-burned onto every frame
3. **Brand promoted** — e.g. IFCDC Barbers App, IFCDC youth programs

## Phase 7 — Autonomous production orchestration

Founder gives a natural-language production request from HQ. Aura:

1. Parses structured intake fields (`PROJECT_TYPE`, `TARGET_AUDIENCE`, `DURATION`, `ASPECT_RATIO`, `BRAND`, `STYLE`, `SCENES`, `VOICE`, `MUSIC`, `CTA`, `PLATFORM`, `EXISTING_ASSETS_TO_USE`, `NEW_ASSETS_REQUIRED`, `FOUNDER_APPROVAL_REQUIRED`)
2. Searches the IFCDC asset library **before** any generation
3. Generates only missing media via the HQ provider router (OpenAI image/TTS; Runway video — minimum credits; prefer reuse)
4. Builds the timeline in Resolve on the Production Mac through the private bridge
5. Returns the draft to `/hq/aura-resolve` for PLAY / APPROVE / REJECT / REQUEST REVISION / CREATE ALTERNATE / CHANGE FORMAT
6. Applies surgical revisions (prefer local remaster; no unnecessary Runway)
7. Appends production memory; persists job state for resume
8. Answers live status from real project records

`publish` stays `false`. Aura may NOT publish. Reference/continuity remains `NOT_AVAILABLE_ON_ACCOUNT`.

Code:

- `aura-resolve/editor/intake.mjs`
- `aura-resolve/editor/autonomous-orchestrator.mjs`
- `aura-resolve/editor/cost-ledger.mjs`
- `aura-resolve/editor/job-recovery.mjs`
- HQ routes: `/aura/resolve/produce`, `/revise`, `/status-ask`, `/preview-decision`, `/resume`
- Proof: `script/phase7-autonomous-proof.mjs`

## Phase 6C — Runway video

- `RUNWAY_API_KEY` lives on Render HQ only (`PRESENT` / `NOT_PRESENT` — never logged).
- Runway is PRIMARY for text-to-video, image-to-video, B-roll, and reference/continuity when the account exposes it.
- OpenAI remains image generation (`gpt-image-1`), image edit, and synthetic TTS only — never video.
- Mac Production Node proxies video through HQ; local `.env` does not hold the Runway key.
- `publish` stays `false`.

## On-disk library

`~/Library/Application Support/IFCDC/aura-resolve/IFCDC-PRODUCTIONS/`

Rule file: `PRODUCTION-IDENTITY-RULE.md`  
Identity cards (still): `production-kit/identity/` — animated logo not yet rendered

Phase 5+ paths:

- `ORIGINAL_FOUNDER_MEDIA/` — protected Founder source only
- `GENERATED_FOUNDER_MEDIA/` — generated outputs only (never mixed with originals)
- `FOUNDER-IDENTITY-LIBRARY/` — face/body/voice/wardrobe/location/role/camera/expression/movement/continuity slots
- `generation-registry.json` — provider-agnostic capability → adapter map
- `asset-library-index.json` — searchable categories
- `continuity/<project>.json` — per-project continuity memory
- `autonomous-jobs/` — Phase 7 job recovery state
- `cost-ledger.json` — Phase 7 cost/credit ledger

## Code

- `aura-resolve/brand/production-identity.mjs`
- `aura-resolve/generation/` — provider registry + adapters (`runway-media` via HQ proxy)
- `server/hq/runwayVideoProvider.ts` — cloud Runway REST
- `aura-resolve/pipeline/production-pipeline.mjs` — idea → master stages
- `aura-resolve/library/` — asset library, continuity, founder identity
- Creative memory permanent rule `IFCDC_PRODUCTIONS_GLOBAL_IDENTITY` (append-only preference history)
- HQ planner + `/hq/aura-resolve` show production company vs brand promoted separately

`publish` stays `false`. Aura may plan/generate/edit/render drafts — Aura may NOT publish.
