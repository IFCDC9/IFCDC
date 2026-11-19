# Aura funding workflow — NJ programs and Detroit initiative

**Status:** HQ Grant Center extension (review PR, not production until Founder deploy)  
**Store:** existing Grant Center (`grant_opportunities` / applications / awards / documents)  
**Routes:** `/hq/grants` Opportunity Finder · `/hq/detroit` Grant Center connection

## Already live on origin/main (PR #72)

Detroit property workspace, Grant Center research save, conservative Unknown defaults, no DLBA scrape.

## This branch

- Read-only Grants.gov Search2 + ProPublica 990 preview for NJ, Detroit/Michigan, and national keywords.
- Initiative tags: `nj_programs` | `detroit_initiative` | `shared_org` | `unknown`.
- HR/payroll coverage panel: payroll is not funded until award + terms.
- Founder walkthrough: discovery → draft → Founder review → portal confirm → award → renewal.
- `exec@ifcdc.org` cannot Founder-approve grant submit.

## Not live / blocked

- NJ SAGE / NJ DOL APIs — no connector.
- Detroit Land Bank / Michigan SIGMA APIs — no connector.
- SAM.gov assistance listings as opportunities — entity probe only (`SAM_GOV_ENABLED`, `SAM_GOV_API_KEY`, `SAM_GOV_UEI`).
- Corporate CSR — static reference, not live search.
- Aura is not submitting, contacting funders, buying property, or committing funds.

## Money status

`potential_funding` · `submitted_application` · `award` · `received_revenue`
