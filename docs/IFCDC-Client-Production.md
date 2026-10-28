# Aura client website production

This release adds actual website source generation and hosted publication to the existing client workflow. It supports business websites and service-request web apps. It does not implement arbitrary native iPhone/Android applications, customer sign-in, product checkout, confirmed appointment calendars, automatic app-store distribution, or autonomous ongoing maintenance.

## Deliverable types

**Business website:** responsive headline, introduction, services, about section, public contact email, optional telephone/location/hours, palette styling, the selected licensed library photograph when available, keyboard navigation and contact links. Its generated HTML can be hosted as a static website elsewhere.

**Service-request web app:** those pages plus a functioning inquiry form and private request records in the business's client workspace and Founder HQ. It includes a web-app manifest and icon. Browser installation availability varies; it is not a native app binary and does not promise offline support. Requests are explicitly not confirmed bookings and do not collect payments. IFCDC's backend is required for its request storage and hosted manifest routes; exported source needs adaptation before running those features elsewhere.

## Operating workflow

1. Create a real client account/project and agree a complete production quote. The client must accept the quote before a source build can be created. Existing payment-only test quotes do not cover a real website build; prepare the correct client project and agreement.
2. In HQ → Software Engineering → Client project production queue → Review / update progress, open **Aura website production → Prepare website content**.
3. Enter approved business facts. Optionally authorize **Ask Aura to draft the copy**. The existing private OpenAI credential resolver is used; `AURA_WEBSITE_MODEL` optionally selects the model (default `gpt-4o-mini`). A draft is a paid provider request and never executes on page load. The reservation limits are five requests per Founder and 25 globally per UTC day, 2,200 output tokens per request. Uncertain attempts are not automatically repeated. Copy may also be entered manually with no AI provider call.
4. Review the public name, headline, introduction, about text, services, public business contact email, optional public phone/location/hours, brand accent and supported website type. The account email is never copied into the public contact field automatically. The submitted palette and selected photograph are carried into the source. The Founder explicitly confirms content, rights and supported scope.
5. **Build website source** creates an immutable HTML artifact, approved-content JSON, checks report and SHA-256 reference. It makes no AI call, charges no customer and publishes nothing. The project retains up to 20 builds. Do not interpret automated structural checks as a complete accessibility, security or device certification.
6. Inspect the private preview and download source for your own review. Private previews are authenticated and sandboxed, scripts and form submission are blocked, and previews are marked not to be indexed. Verify content, navigation, public contact details and mobile layout before sharing. Test the live request flow immediately after publication.
7. **Share this build for client review** exposes that version in the client's **Your website builds** panel. The client previews it, confirms review and chooses **Approve this website build** or **Request website changes**. The server binds the decision to that build's exact source checksum. Revisions create new artifacts; shared drafts cannot be edited in place.
8. Once approved, choose a unique lowercase URL label and click **Publish approved website**. Publication additionally requires a verified completed build payment, or an explicitly waived build fee. The URL is `https://ifcdc.org/client-sites/YOUR-LABEL/`. A source handoff download for the client requires approval and the same paid/waived condition. This is shared IFCDC hosting; connecting a separate custom domain is additional deployment work, not part of this release's automatic launch.
9. Test the public contact links or inquiry form. Confirm inquiries appear only in the appropriate client's workspace and HQ. With project email notifications enabled, production updates and new inquiry notices use the existing durable outbox. Notices link to the private workspace and do not email private lead-message content to a public audience.
10. For maintenance, choose **Use content for a revision**, build a new version, share it for a new client approval, then publish it at the existing URL. Previously published source remains saved. Accepted earlier delivery terms are preserved. Changes outside the accepted scope need a separate agreement; this tool does not authorize extra charges.
11. **Confirm unpublish** takes the hosted website and new inquiry submissions offline. It retains source, approvals and saved inquiries. An approved retained version can be republished with the current site version.

## Access and hosting boundaries

Founder actions remain behind the existing private HQ authorization and same-origin mutation checks. Clients use their independent verified client account. They can see only their own shared builds and inquiries; they cannot see private draft builds, another client's records, or HQ. Public routes serve only an active published site's artifact, manifest and icon.

Generated content is validated data rather than executable model output. The renderer escapes text, validates colors/contact fields, uses trusted Commons photo metadata, and includes attribution. HTML is served with a content-security policy permitting only the stored version's fixed inquiry handler. No provider credentials or private inquiry records are included in the ZIP. Generated files are persisted in the existing SQLite database on the application data disk, covered by its database backups.

Public inquiry submission requires consent and the IFCDC website origin, rejects a filled spam trap, enforces bounded fields and a 16 KB body limit, and is limited to ten requests per IP per hour, 300 globally per hour, and 1,000 retained requests per project. Business owners should arrange a lawful retention process for their customer records. This release does not add automated data deletion or customer identity verification.

A structural report checks headings, section IDs, navigation anchors, contact link, viewport/mobile CSS, external script absence and artifact size. The ZIP is a standard stored archive independently checked with Python. Source checksums protect against corrupted saved artifacts and are preserved through review and publication.

## Deployment and verification

No new required environment variables or paid external hosting subscription are introduced. Preserve the current production credentials, enabled payment/email flags, persistent disk and backup settings. Existing OpenAI configuration is needed only for optional AI copy drafting. Manual source builds, preview and hosted publication do not invoke OpenAI or Runway.

After CI passes, merge and manually deploy IFCDC-HQ. First use a clearly scoped real client website with approved content and public contact information. Verify private preview, client approval, paid/waived gate, public URL, request capture, source download and unpublish/revision behavior before promising that client a completed launch. Keep complex/native app work on separately scoped engineering milestones.

Local validation uses isolated SQLite databases and fake email/AI transports; no real provider calls, customer charges or public client deployment were performed by the tests. A headless Chromium flow covers client sign-in, accepted scope, source build, private preview, exact-build approval, hosted page rendering, inquiry capture in the correct account, source download, desktop/mobile layout and unpublish. Actual AI provider output and a real client launch still require deployment-time review. Capacity, uptime and broad native-app autonomy are not established by these tests.
