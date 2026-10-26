# IFCDC official public website

This release reuses the existing IFCDC service and public-page infrastructure. It does not create a second hosting subscription or expose HQ records.

## Addresses and routes

- `https://ifcdc.org/` and `https://www.ifcdc.org/`: new CDC homepage, selected by the actual Host header.
- Existing Render root and `hq.ifcdc.org` root: keep the existing HQ SPA/sign-in behavior. HQ authorization is unchanged.
- `/website`: preview the public homepage on the current Render service before domain cutover.
- Public sections: `/about`, `/programs`, `/services`, `/media`, `/careers`, `/contact`, `/support`, `/privacy-policy`, `/terms-of-use`.
- Historical About/Programs/Contact HTML URLs resolve to the refreshed pages.
- Careers collects expressions of interest only. This release does not invent vacancies, collect identity documents/resumes, promise employment, or connect submissions to private employee payroll records.
- Program availability and service scope must be confirmed by IFCDC. No clinical or licensed treatment claims are added.

## Business contact and notifications

Contact and careers-interest forms save name, email, topic, message, consent, reference, timestamp, and notification status in `ifcdc_website_messages` on the existing persistent database. A client-generated request ID and content digest prevent duplicate submissions on same-request retry. Network/global hourly limits apply. No public read endpoint exposes these records.

Notifications use only `POSTMARK_SERVER_TOKEN`, a fixed verified sender `IFCDC Website <service@ifcdc.org>`, recipient `service@ifcdc.org`, and Postmark's outbound stream. They contain only the reference, not submitted message contents. No Resend fallback, personal mailbox, or mailto-form submission is used. No acknowledgement is automatically sent to a visitor-supplied email. Provider acceptance does not prove inbox delivery. Missing/failed/uncertain notification never removes the saved enquiry. Uncertain sends are not automatically repeated. Founder replies through the business mailbox; this release does not automate replies or newsletters.

The public support quote form still uses its existing separate quote ledger. Both types are visible in Software Engineering. Payments retain the existing credentials, enable flag, webhook, and verified receipts. No credentials are put in the public site or source code.

## Founder website manager

HQ → Software Engineering → Public website manager.

- Add a photo, video, or external-link entry with a division, title, and description.
- Save as draft or explicitly check Publish. Saving a published entry makes it visible immediately; uncheck Publish and save to remove it from public pages.
- Published items appear on Media; the homepage shows the newest three. Community/software pages show their corresponding entries. The Media filters cover every division.
- Upload JPEG, PNG, or WebP images up to 5 MB, or use a public HTTPS photo URL. File signatures are checked and uploads are served with fixed raster extensions, nosniff, and a sandbox policy. SVG/HTML uploads are rejected. A maximum of 100 stored photos and 100 content entries bounds storage for this initial release.
- Photos are stored below `IFCDC_DATA_DIR/website-media` (or existing data directory). Keep this folder on the same persistent disk and include it in independent media backups. Database-only snapshots do not include image files. No existing backups are changed.
- Uploaded image URLs are public to anyone who has the link, including before the containing entry is published. Draft metadata is restricted to Founder access.
- YouTube/Vimeo links are normalized to their exact player hosts and do not load an iframe until a visitor chooses Play. Arbitrary embed HTML/scripts are not accepted. External image hosts and video providers have separate privacy policies.
- Only the authenticated configured Founder with an allowed engineering role can read enquiries or change content. No AURA unattended publishing or payment action is added.

## Payment domain continuity

Public support mutations accept only exact approved website/HQ origins plus the existing configured live origin. Recurring checkout returns to the origin on which that attempt began. This origin is stored immutably per checkout to prevent a retry changing its callback target. No client-supplied redirect URL is followed. Existing Render receipts and webhooks continue to work; keep the Render subdomain enabled.

The webhook endpoint may remain `https://ifcdc-hq-wst6.onrender.com/api/public/support/webhook` while visitors use `https://ifcdc.org/support`. The same underlying service verifies the same PayPal live app/webhook. Public enablement and genuine donation/subscription acceptance remain required; HTTPS/domain verification is not proof of functional payments or Google Search Console verification.

## Deployment and acceptance

1. Apply the patch to current main, open PR, and pass CI; merge and manually deploy IFCDC-HQ.
2. Preview `/website` on desktop and phone. Review all program/service wording, contact address, and policies.
3. Open `https://ifcdc.org/` in a signed-out browser: expect CDC home, no HQ login redirect. Confirm `https://ifcdc-hq-wst6.onrender.com/login` and protected HQ routes still work.
4. Submit one agreed real enquiry, confirm its HQ reference, and independently confirm Postmark inbox delivery at service@ifcdc.org. Tests never send real email.
5. Publish an approved image/video/link from HQ, inspect it publicly, and test unpublishing. No filler photos, fake work, impact figures, or testimonials are published by this release.
6. Finish public PayPal configuration and validate one deliberate consenting donation and one recurring enrollment/cancellation, including signed payment events. Do not create repeated charges to test appearance.
7. Confirm root/www DNS, HTTPS, and business mail records. Existing Google TXT verification is preserved. Confirm ownership within the actual Google account before claiming Google verification.
8. Supply the exact Amazon book URL via existing `IFCDC_SUPPORT_BOOK_URL`; publishing doesn't invent an Amazon listing.
9. Confirm media backup coverage and configured business mailbox reply workflow before wide promotion.

The website includes no invented ® mark, legal registration approval, partners, performance metrics, vacancies, completed client projects, or fictional testimonials.
