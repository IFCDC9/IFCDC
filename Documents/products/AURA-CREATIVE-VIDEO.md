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

## On-disk library

`~/Library/Application Support/IFCDC/aura-resolve/IFCDC-PRODUCTIONS/`

Rule file: `PRODUCTION-IDENTITY-RULE.md`  
Identity cards (still): `production-kit/identity/` — animated logo not yet rendered

Phase 5 paths:

- `ORIGINAL_FOUNDER_MEDIA/` — protected Founder source only
- `GENERATED_FOUNDER_MEDIA/` — generated outputs only (never mixed with originals)
- `FOUNDER-IDENTITY-LIBRARY/` — face/body/voice/wardrobe/location/role/camera/expression/movement/continuity slots
- `generation-registry.json` — provider-agnostic capability → adapter map
- `asset-library-index.json` — searchable categories
- `continuity/<project>.json` — per-project continuity memory

## Code

- `aura-resolve/brand/production-identity.mjs`
- `aura-resolve/generation/` — provider registry + adapters
- `aura-resolve/pipeline/production-pipeline.mjs` — idea → master stages
- `aura-resolve/library/` — asset library, continuity, founder identity
- Creative memory permanent rule `IFCDC_PRODUCTIONS_GLOBAL_IDENTITY` (append-only preference history)
- HQ planner + `/hq/aura-resolve` show production company vs brand promoted separately

`publish` stays `false`. Aura may plan/generate/edit/render drafts — Aura may NOT publish.
