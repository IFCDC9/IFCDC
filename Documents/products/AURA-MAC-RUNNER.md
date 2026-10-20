# AURA Mac runner — repository inspection bridge

This adds an authenticated round trip between HQ and an outbound-only Node worker on a Mac. It is implemented and tested locally, not installed on the Founder's Mac or deployed to HQ.

## Current capability

Founder registers a runner, downloads its private configuration, and queues an inspection from Software Engineering. The worker polls HQ, checks the exact local repository root and origin, and reports the commit, branch, changed-file count and untracked-file count. File contents, filenames, local paths and git output are not uploaded.

The bridge accepts only `inspect_repository`. It has no shell, file-editing, model, dependency-install, test-execution, push, merge, deployment, voice or email capability. The existing local engineering task form is separate and is not forwarded by this bridge. Neither the runner result nor a successful local test proves that the production deployment is aligned.

## Credentials and task handling

- Founder enrollment returns a random device credential once; HQ stores its SHA-256 hash. Treat the downloaded configuration as a secret. Do not paste it into chat, screenshots, Git, or the Library.
- Runner credentials cannot access Founder routes. Founder session credentials cannot claim runner jobs. Excluded executive identities cannot enroll devices.
- Every job targets one runner. Atomic claims prevent duplicate pickup. Completion requires the assigned runner and its separate job lease.
- A five-minute lease expires uncertain work without automatically retrying it. Founder can request a new inspection. Revocation cancels queued/running inspections and prevents future access.
- Status, enrollment, claim and result responses are marked `no-store`. Stored results use a strict field allowlist; arbitrary output is discarded.
- Enrollment, queueing, claiming, completion and revocation write HQ audit events. Expired state is visible in job status.
- The worker opens no inbound network port. It uses HTTPS for HQ except loopback HTTP during local tests, refuses redirects, and sends no production credentials to git subprocesses.
- In watch mode, temporary connection failures back off to a maximum one-minute interval. An authentication rejection stops the worker.

## Deployment and Mac setup — after review

1. Review the source change and deploy the approved HQ server/client commit through the existing Founder-controlled process. GitHub publication is currently blocked by the connected integration's write permissions. The Mac worker alone cannot add missing cloud endpoints.
2. On the Mac, use a separate clean checkout containing these changes. Do not apply the patch over the original uncommitted engineering worktree.
3. Open the deployed HQ as Founder, go to Software Engineering → Runner connection, and register the Mac. Enter the exact approved local HQ repository folder and download the private configuration. A parent folder or a folder inside the repo is refused.
4. Save the downloaded file privately:

```sh
mkdir -p "$HOME/.config/ifcdc"
chmod 700 "$HOME/.config/ifcdc"
cp "$HOME/Downloads/aura-runner.json" "$HOME/.config/ifcdc/aura-runner.json"
chmod 600 "$HOME/.config/ifcdc/aura-runner.json"
```

Remove any extra downloaded copy through Finder after confirming the private copy. Do not commit either copy. A lost credential is replaced by revoking its runner and registering a new one.

5. From the clean HQ checkout, use Node 20 or newer. The worker uses only Node's built-in libraries; this inspection worker does not need npm packages or a paid coding agent.

```sh
node script/aura-mac-runner.mjs
```

This polls once and exits. If no task is queued, `idle` is expected. In HQ, click **Inspect repository**, then run the same command again. Check the returned job status and commit in HQ.

6. To keep polling while the Mac is awake:

```sh
node script/aura-mac-runner.mjs --watch
```

Stop with Control-C. This is not yet a launch agent or background service. An asleep/offline Mac does not run inspections; queued work stays queued. Do not confuse device registration with a live connection: the panel shows the last contact time.

## Validation

```sh
node --import tsx --test --test-concurrency=1 script/hq-aura-runner-bridge.test.ts script/hq-aura-engineering-workflow.test.ts
```

The tests use temporary repositories, temporary SQLite storage and loopback HTTP. They exercise actual enrollment, queue, worker execution and result delivery, denied credentials, wrong-repository checks, concurrent claims, wrong leases, replay, expiration and revocation. They do not contact production or GitHub.

## Next development milestone

Add a disposable sandbox and a reviewed change-package protocol before remotely executing generated tests or edits. Then connect a chosen model provider with a defined budget. This bridge does not silently enable either capability or assume an unpaid Cursor account is available.
