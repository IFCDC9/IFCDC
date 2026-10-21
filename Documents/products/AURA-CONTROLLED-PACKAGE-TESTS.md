# Controlled package tests, first profile

`test_change_package_v1` is a separate Founder-approved job, not an extension
of staging approval. The first fixed profile is `package-validator-v1`: four
Node unit tests for package format, digest binding, unsafe paths, command fields,
portable collisions and size limits. The harness is fixed in the installed
worker. Only the validator module from the exact staged base is copied into
its sandbox. This does NOT test app screens, grants workflows, builds, the full
repository suite, or arbitrary changed files. In particular, a documentation
package's passing result proves only that these validator contract tests pass
at its base. It does not prove the documentation change or application works.

## Approval and binding

After a successful staging receipt, select that staged package in HQ's computer
runner panel. The label includes computer, package digest prefix and review ID.
Approve the fixed profile and queue package tests. The server recovers the
immutable package from the successful staging job; no client-supplied commands,
paths, image choices, or replacement package are accepted. It targets the same
registered computer. Each result is bound to the staging job, digest, base,
profile, runner, and single-use lease. Staging records continue to say that
staging itself ran no tests; the separate test record reports its own outcome.

An updated worker advertises this capability only with `allowPackageTests: true`
in its private configuration. Existing inspection and staging configurations
remain valid and do not gain test execution automatically. A missing sandbox
fails closed and never executes staged code on the host. The runner itself must
be trusted, as with all local job receipts; this is not remote attestation.

## Local Docker prerequisite

A running local Docker installation and a trusted, cached Node 24 Linux image
are required. Installation and an initial image pull are separate setup actions;
the worker never installs software, pulls images, or builds images. Verify Docker
locally before enabling tests. Pin the image's immutable **local image ID**
(`sha256:` followed by 64 lowercase hex characters) in `packageTestImage` in the
same private config, preserving the token, HQ origin and repository path. Tags
such as `node:24` and remote daemon settings are not accepted by this worker.
The Docker CLI is invoked with a minimal environment and its default local
connection, not an inherited DOCKER_HOST/DOCKER_CONTEXT or user Docker config.
If that default connection is unavailable, configure Docker locally first.

Each job re-stages the immutable package into a fresh independent clone, after
checking the approved active repository is clean and still at the exact base.
It copies only `shared/auraChangePackage.mjs` and the fixed suite into a temporary
snapshot. No .git folder, dependencies, config, connection tokens, or production
data enter the container. Symlink source files/directories are refused.

The container has no network, a read-only root and snapshot, a small noexec tmpfs,
a non-root UID, no Linux capabilities, no-new-privileges, a 64-process limit,
256 MiB memory, and one CPU. Node is the fixed entrypoint; no shell is used.
The process has a 60-second time limit and 64 KiB output ceiling. Container removal
is attempted even if the Docker client is killed; cleanup failures are reported
as errors and must be checked locally before another run. Docker isolation is a
boundary, not a guarantee against all runtime/kernel vulnerabilities.

## Results and failure handling

HQ receives status, pass/fail/error, exit code and duration when known, profile,
package digest, staging job and base. It receives no raw stdout/stderr or local
paths. A zero exit code is a runner-reported pass of this fixed suite only.
Failures before execution report `testsRun: false`; uncertain execution or
cleanup reports `testsRun: null`. A timed-out or interrupted upload is never
automatically retried. Inspect locally before requeuing uncertain work.

Queue TTL is 30 minutes and execution lease is five minutes. Old workers cannot
claim test jobs. Revocation prevents claims and result acceptance but cannot
instantly cancel a container already started by a local worker. The local limit
and cleanup still apply. No test job commits, pushes, opens a PR, merges or deploys.

## Validation and remaining evidence

Run the package validator suite and the existing engineering regression tests.
`script/hq-aura-package-tests.test.mjs` checks fixed sandbox arguments and refusal.
The bridge tests exercise real HTTP, plain Node, approval and result binding,
a minimal-environment Docker CLI stand-in, real passing/failing Node unit suites,
and stale/dirty base refusal. The stand-in verifies process orchestration only;
it does not establish container isolation.

Founder Mac validation: local regression tests, TypeScript, and production
build passed. All four validator tests passed inside real Docker using the fixed
sandbox arguments and minimal CLI environment; container removal succeeded.
Resource enforcement under load and live HQ-to-Mac and Windows test execution
remain unverified. The manual container run does not establish live HQ dispatch.
