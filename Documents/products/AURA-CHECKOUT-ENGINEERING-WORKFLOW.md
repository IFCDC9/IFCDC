# AURA checkout tests and draft PR workflow

The new `checkout-sandbox-v1` profile closes the gap between staging a payment adapter and opening a tested draft PR from HQ. It does not implement arbitrary app construction, production deployment, real PayPal checkout, or automatic merging.

## What runs

The scope is exactly `script/ifcdc-checkout-pilot/paypal.mjs` and `script/ifcdc-checkout-pilot/checkout.test.mjs`, as creates or modifications. The worker re-stages the approved immutable package after checking the clean active repository and exact base. It copies only the proposed adapter and installed runner-owned `aura-checkout-suite.mjs` into the test snapshot. The package-supplied test file is published for review but is never executed by this profile. Changing package tests cannot weaken the installed 47-case contract suite.

The trusted suite verifies fixed USD 10.00 order creation, OAuth requests, merchant/product identity checks before capture, capture amount/currency/completion, reconciliation without another capture, bad inputs, provider failures and request timeouts using injected mock responses. Tests have no network, credentials or production data. The Docker image is pinned by local immutable ID and never pulled or built by the worker. Network, filesystem, user, capability, CPU, memory, PID, output and time limits match the existing sandbox. Missing or incomplete summaries fail; all 47 tests must pass without skips/cancellations/todos. The worker remains a trusted source of receipts, not cryptographic remote attestation. Tests are not a security proof against malicious code deliberately falsifying results.

## Install and enable on Founder Mac

After reviewing and merging this upgrade, deploy HQ and fast-forward the runner checkout to the merged commit while its working tree is clean. Preserve the existing private config and enrollment token. Stop only the runner watch process in its own terminal with Ctrl+C before updating; do not stop unrelated Node processes.

The already configured package test image is sufficient if it is a cached Node 24 Linux image. No UI dependencies or image build are needed. Run from the updated approved runner repository:

```sh
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
node script/aura-enable-checkout-tests.mjs
```

This reads the private runner config, validates the image, runs real Docker good/broken/premature-exit release checks, and only then adds `allowCheckoutTests: true` and `checkoutTestImage` atomically, preserving other fields. It does not display tokens. It uses the existing `packageTestImage` unless an immutable image ID is provided as its sole argument. A failed check leaves config unchanged. Restart:

```sh
AURA_RUNNER_CONFIG="$HOME/.config/ifcdc/aura-runner.json" node script/aura-mac-runner.mjs --watch
```

Only opted-in updated workers advertise the new capability. Old workers cannot claim these jobs. Existing staging/testing behavior remains available.

## HQ use and draft PRs

Draft or upload a fresh two-file package based on current main. Review and stage on Founder Mac, choose **Checkout payment contracts (offline)**, then approve the test run. The dashboard reports its bounded result and scope. A manual Terminal run is not imported as an HQ test receipt.

After a successful receipt, separately approve publishing that exact package. The server requires an active runner and matching successful profile/digest/base receipt, rechecks GitHub main and every original file (or absence for creates), checks create parent paths, and publishes both exact proposed files on a new draft branch. Existing create targets, stale bases and integrity-only passes are refused. Publishing deduplicates per package and retains uncertain attempts for manual reconciliation. Main is unchanged by this workflow; merging and deployment remain separate actions.

The old package `3caae8dfde1088e2007fd0368abcd460f0a52040f6510933a2fef7c28154e200` remains tied to base `5b07fe4`. Once main advances it must be freshly prepared and tested; do not edit its base or reuse its old receipt to bypass checks. This upgrade includes the reviewed reference files, so subsequent packages must use their current before hashes and contain actual changes.

## Release verification

Repository tests exercise HTTP dispatch, opt-in, digest/lease binding, trusted harness execution using a Docker CLI stand-in, broken and premature-exit rejection, exclusion of package tests/secrets, UI approvals, multi-file create publishing, parent refusal, existing create refusal and deduplication. The stand-in validates protocol, not Docker isolation. The real Docker release check must pass on Founder Mac before enabling. Production build and live HQ dispatch/publishing must be verified separately.

No PayPal network requests, buyer approvals, real sandbox captures, website/server/order database, webhooks, refunds or live deployment are established by these checks. The existing Barbers app's successful real booking is a separate integration and is not altered by this upgrade.

## Implementation verification (2026-10-24)

- 84 targeted tests passed, zero failed/skipped/cancelled. This includes the 47 trusted offline adapter contracts, HTTP runner and publishing tests, scope/isolation argument checks, setup failure preservation and UI approval tests.
- Production server/client build passed using `node --import tsx script/build.ts`. The standard tsx CLI hit a container IPC restriction; using Node's loader completed the same build script.
- Full TypeScript checking reports 28 diagnostics on both unchanged main and this upgrade, with no new diagnostic categories. Existing missing generated Prisma types and related errors remain; this is not a claim that the repository type check passes.
- Real Docker and live HQ/GitHub/PayPal integration have not been run in this environment. Run the included real Docker setup check on Founder Mac and verify the deployed HQ workflow before treating it as operational.
