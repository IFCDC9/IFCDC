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

## Code

- `aura-resolve/brand/production-identity.mjs`
- Creative memory permanent rule `IFCDC_PRODUCTIONS_GLOBAL_IDENTITY`
- HQ planner + `/hq/aura-resolve` show production company vs brand promoted separately

`publish` stays `false`.
