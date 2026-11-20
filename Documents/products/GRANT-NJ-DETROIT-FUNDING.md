# Aura funding workflow — NJ programs and Detroit initiative

**Status:** HQ Grant Center extension (review PR, not production until Founder deploy)  
**Store:** existing Grant Center (`grant_opportunities` / applications / awards / documents)  
**Routes:** `/hq` Find Funding · `/hq/aura` · `/hq/grants` Opportunity Finder · `/hq/detroit`

## Aura executive desk (this branch)

Aura is an **AI operator**, not Founder. From the executive workspace she can:

1. Search official feeds (Grants.gov Search2; ProPublica 990 identities).
2. Store research in the **same** Grant Center (not a second browser store).
3. Summarize NJ vs Detroit vs shared-org rows, deadlines, missing documents, HR coverage.
4. Seed a budget narrative with Unknown line items and open proposal drafts in Grant Center.
5. Track follow-ups from Grant Center deadlines. Detroit parcel follow-ups stay in `/hq/detroit`.

She does **not** submit, contact funders or DLBA, accept awards, purchase property, commit funds, or Founder-approve. `exec@ifcdc.org` cannot Founder-approve.

## Walkthrough (no live submit)

1. Search official feeds from HQ / Aura / Grant Center **Find Funding**.
2. Verify source, date checked, official link, deadline, eligibility evidence, allowable costs, match, missing documents. Unverified = Unknown. Fit score is not eligibility.
3. Compare NJ program costs, Detroit initiative costs, and shared-org costs on one store.
4. Prepare budget skeleton and proposal draft in Grant Center (still potential_funding).
5. Founder review (not exec@ifcdc.org). MFA grant submit unchanged.
6. Founder submits on the **funder portal** outside HQ.
7. Record confirmation ID in Grant Center.
8. Track award, reporting, and renewals. Payroll is not funded until award + terms reviewed.

## Connected vs blocked feeds

See Grant Center panel. Blocked portals stay **unavailable** with an official manual URL and export instructions. Do not scrape.

## Money status

`potential_funding` · `submitted_application` · `award` · `received_revenue`
