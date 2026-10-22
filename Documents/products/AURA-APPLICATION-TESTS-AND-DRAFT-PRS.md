# AURA application tests and draft pull requests

This upgrade adds a bounded application test profile and a separately approved GitHub draft PR handoff. It does not add general diagnosis, full application testing, merging, deployment or rollback.

## Supported scope

`grant-subnav-v1` accepts a package modifying only the existing `client/src/components/hq/grants/GrantSubNav.tsx`. A package adding that file or changing other files is refused. The trusted harness checks navigation labels/accessibility name, Opportunity Finder callback, active styling and return callback, and non-submitting buttons. It is a component DOM test, not a complete Grants Center or browser test. Source dependencies outside that component are not snapshotted; unsupported imports fail.

The existing `package-validator-v1` profile remains available for package integrity checks only. Passing that profile cannot authorize draft PR publishing.

## Local application test image

Build from the narrow trusted context, not the repository root:

```sh
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
docker build --pull=false -t ifcdc-aura-ui-tests:v1 script/aura-ui-test-image
application_image="$(docker image inspect ifcdc-aura-ui-tests:v1 --format '{{.Id}}')"
node script/aura-check-application-sandbox.mjs "$application_image"
```

The image downloads fixed top-level React, React DOM, JSDOM and esbuild versions during preparation. Transitive dependencies and the base tag resolve at image-build time; the built image must then be configured by immutable local image ID. Execution never builds, installs or pulls dependencies. No repository, secrets, config or credentials enter the image build context.

After review/merge and local synchronization, preserve the private runner configuration and add `allowApplicationTests: true` plus `applicationTestImage: "sha256:..."` using the inspected ID. Keep the existing package test image and all enrollment credentials. Restart the watch worker so it loads both the new config and installed trusted harness. Older or opted-out workers cannot claim application test jobs. Dell application execution is not yet verified.

Runtime retains no network, read-only root and snapshot, non-root user, dropped capabilities, no-new-privileges, CPU/memory/PID limits, bounded output, timeout and forced container cleanup. Only the proposed component and installed trusted harness are snapshotted. An exit without all four successful test summaries is an error. These are tests of reviewed code, not proof against deliberately falsified behavior by malicious code.

## Draft PR publishing

Configure the separate Render secret `AURA_GITHUB_PR_TOKEN`, scoped only to IFCDC9/IFCDC with Contents read/write, Pull requests read/write and Metadata read. Keep the existing read credential unchanged. Do not paste tokens into chat or a package. Do not grant workflow/admin access.

Founder selects a passing application test and explicitly approves publishing its exact package. Server requires an active runner, successful test receipt, exact digest/base, supported file scope and current GitHub main equal to the package base. It rechecks original file content against its SHA-256. It publishes exact tested bytes on a new `aura/review-UUID` branch, then opens a draft PR to main. No command from the package runs on the host or server. GitHub credentials remain on the server and are never passed to the test container.

A durable unique record per package prevents duplicate writes, including after another test run. Uncertain attempts remain visible with their branch. Do not blindly retry them: inspect GitHub and reconcile manually. No automated deletion of branches occurs. Main can move after preflight; the branch still has the exact tested parent and GitHub review/CI must resolve any new conflict. Merge/deploy require separate Founder authorization.

## Validation

Local validation covers queue/lease/authentication boundaries, component scope, old-worker opt-out, real DOM harness pass/fail against trusted fixtures using a Docker CLI stand-in, premature exit rejection, UI approvals, publisher fixture requests, exact bytes/parent, stale main/source, duplicate publishing and uncertain outcome handling. TypeScript and production build are checked separately. Stand-in tests do not prove Docker isolation. Run the included real Docker release check on Founder Mac before publishing the upgrade. Live HQ dispatch and GitHub publishing must then be verified after merge, deployment and local runner setup.

## Live trial after deployment

Use the drafting form to request adding `aria-current="page"` to the active navigation button and omitting it on inactive buttons, changing only GrantSubNav.tsx. Review the complete proposed file. Stage on the up-to-date Founder Mac, select Grants navigation component tests, approve and run once. Only after a passing receipt, separately approve draft PR publishing. Review the PR diff and CI. These four tests do not assert the new aria-current behavior; add a corresponding trusted test before claiming that behavior is verified.
