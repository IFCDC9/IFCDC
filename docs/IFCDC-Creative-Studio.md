# IFCDC client design and Runway creative studio

The public designer at `/design-app` supports App and Website projects. `/design-website` opens the same designer with Website selected. Clients choose eight palettes or a custom accent, five original geometric treatments, and requested creative assets. Preview art and SVG downloads are local and free. The final brief includes exact colors, art direction, and requested media and saves through the existing private software enquiry workflow. Contact details and HQ records are never automatically sent to Runway.

## Private studio

Founder: HQ → Software Engineering → AURA creative asset studio · Runway.

The studio uses the existing `RUNWAY_API_KEY` credential used by AURA's Resolve video provider. It does not replace the existing video path. Credential presence is not proof of provider access. The new studio supports:

- `gen4_image`, one 1920:1080 image, 8 estimated credits.
- `gen4.5`, one 1280:720 two-second video, 24 estimated credits.

Generation is private and needs specific confirmation in HQ. Prompts are explicitly entered; client records and contact details are not automatically attached. A saved website enquiry reference can optionally link a job to a project. Anonymous users, staff, and other owner-email accounts cannot use the studio API. Existing HQ MFA controls apply.

Outputs remain private provider links. They are temporary and are not automatically copied to permanent project storage, delivered to clients, or published on the website. Download an approved output into the appropriate project files before delivery. Do not paste temporary links into a public portfolio as permanent media.

## Render configuration

Service: IFCDC-HQ. Preserve existing environment values, Postmark, PayPal, database, media, and backups.

1. Reuse the existing private `RUNWAY_API_KEY` if present. Otherwise create an API credential in the Runway developer account and add it directly in Render. Never put a real key in chat, public forms, Git, or a client brief.
2. Ensure the API account has credits; the consumer Runway subscription is separate.
3. Set `IFCDC_RUNWAY_STUDIO_ENABLED` to `true` to enable generation after configuration.
4. Optional: `IFCDC_RUNWAY_DAILY_CREDITS` defaults to `100`, accepts whole values from 1 through 1000. This is a UTC-day conservative reservation limit for this new studio only. It does NOT cap the full Runway account, the consumer app, or existing Resolve generations.

The studio is disabled by default and never generates merely because the panel is opened. No real generation is part of the automated test suite.

## Job and spending behavior

Each generation reserves credits in SQLite before the provider request, using an atomic daily sum guard. Idempotent request IDs prevent duplicate submissions and reject changed requests using the same ID. Ambiguous provider responses become UNCERTAIN, with no automatic resubmission. Rejected and uncertain requests remain conservatively reserved for the day. SUBMITTING records after an interruption also remain reserved. Check the provider dashboard before intentionally creating a new job. Credits shown are reservations using published model estimates, not an account balance or settlement statement.

Task status is manually refreshed, no more frequently than once per five seconds per task. A refresh never starts a generation. The existing video provider's polling interval is also aligned to five seconds. No public client can trigger paid generation.

## Remaining scope

This update does not deliver the separate applicant/staff/admin/client portals, automated client fulfilment, app publishing, or unrestricted autonomous AURA spending. Existing HQ access policy is unchanged. No live API account or generation has been verified during implementation; activation requires the user's configured account and deployment.

## Provider contract references

Verified October 26, 2026:
- API reference: https://docs.dev.runwayml.com/api/
- API getting started: https://docs.dev.runwayml.com/guides/using-the-api/
- Pricing: https://docs.dev.runwayml.com/guides/pricing/
- App and API credits: https://help.runwayml.com/hc/en-us/articles/15124877443219-How-do-credits-work

The server uses fixed `https://api.dev.runwayml.com/v1` endpoints, Bearer auth, and `X-Runway-Version: 2024-11-06`. Model prices and availability can change; check current provider pricing before enabling live use.
