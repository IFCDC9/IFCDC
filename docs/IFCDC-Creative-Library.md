# IFCDC creative inspiration library

Visitors can explore original IFCDC visual directions before signing in. The homepage introduces three directions; `/design-app#creative-library` contains the full collection. Existing client accounts, HQ authorization, quotes, messages and delivery review remain in their existing workflows.

## Included experience

- Eight starting directions: Wild Kingdom, Ocean Motion, Forest & Future, Beyond the Summit, Bloom Studio, Cosmic Tomorrow, Wings & Wonder, and Paws & People.
- Each direction combines a credited photograph, coordinated colors, graphic treatment, layout, suggested audience and features, and an editable starter idea.
- Applying a visual style preserves the visitor's existing name, audience, purpose and features. Replacing those fields with a starter idea requires a separate confirmation.
- Sixteen topic shortcuts and an optional subject search provide more photographs through Wikimedia Commons. There is no paid API key or paid generation involved in browsing.
- Clients can save and reopen their chosen direction and photograph. The server resolves trusted image metadata, stores creator/license/source credits with the project, and exposes them in the private HQ design brief.
- Submitted concepts remain locked. Clients start another concept to make a new direction.

## Images and rights

The eight bundled JPEG thumbnails are recorded in `public/creative-library/credits.json`, including creator, original source page, license and display changes. They remain available if external search is unavailable. Photo and license links are displayed beside the photographs; a selected photograph's credit can also be downloaded.

External search accepts only raster images carrying recognized CC BY, CC BY-SA, CC0 or public-domain metadata, with a creator credit and supported source/thumbnail URLs. Unsupported or restricted results are omitted. Search results are references to the provider's images, not exclusive IFCDC-owned artwork. Check each source page before final delivery, retain attribution, and comply with any applicable license conditions. The image library is large and searchable; provider availability and usage limits still apply.

Sources:

- https://www.mediawiki.org/wiki/API:Imageinfo
- https://www.mediawiki.org/wiki/Extension:CommonsMetadata
- https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia
- https://creativecommons.org/reusing-cc-licensed-content/

## Operation

The server calls only the fixed Commons API endpoint, validates search text and pagination, sets a timeout and response-size limit, caches results for five minutes, coalesces duplicate requests, limits simultaneous external requests, and rate-limits browsing. It persists image metadata in `ifcdc_creative_library_assets` in the existing application database. The table is created when first needed. No credentials or infrastructure changes are required.

Search sends the subject to Wikimedia; selecting or browsing an external result loads the thumbnail from Wikimedia. The privacy notice explains these connections. The original design form works independently of the inspiration collection.

## Validation and deployment

Automated coverage checks image metadata and URL filtering, attribution persistence, forged-credit rejection, ownership boundaries, provider failure handling, and designer interactions. An isolated Chromium flow checks save/reopen/submission to HQ, submitted-project locking, homepage theme links, and desktop/mobile layout. Test sign-ins use a fake email provider and do not send real email or create paid generation jobs.

After normal CI passes, merge and manually deploy the IFCDC-HQ Render service. Verify `/design-app#creative-library`, search for a subject, save a private concept, reopen it, and confirm its credits in HQ. This change does not implement automatic finished-app generation, client checkout, recurring billing, or establish production capacity. Those require their own validation.
