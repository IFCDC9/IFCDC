# AURA local change-package protocol v1

This protocol reviews a JSON change package, then stages its exact contents in
a private independent clone of the approved IFCDC9/IFCDC repository. An updated
HQ and runner can dispatch `stage_change_package_v1` after Founder review and
approval, provided package staging is explicitly enabled in the local private
configuration. It does not run tests, commit, push, open a PR, merge or deploy.

## Package

```json
{
  "version": 1,
  "repository": "IFCDC9/IFCDC",
  "baseCommit": "<exact 40-character commit SHA>",
  "summary": "Describe the requested change",
  "files": [
    {
      "path": "Documents/products/example.md",
      "beforeSha256": null,
      "content": "A new file.\n"
    }
  ]
}
```

`beforeSha256` is null only for a new file. Existing files require the SHA-256 of
their exact original bytes. Packages contain at most 25 files and 250,000 bytes.
Only regular text files in the listed application/document/script roots are
supported; secrets, hidden files, security-related paths, runner/control scripts,
configuration, deletions and symlinks are excluded. This is a conservative first
protocol, not a general-purpose patch format.

## Review and stage

Run from the repository containing the tool:

```bash
node script/aura-change-package.mjs review /absolute/path/package.json
node script/aura-change-package.mjs stage /absolute/path/package.json /absolute/path/approved-repository REVIEWED_SHA256
```

Review the actual JSON file contents before staging. The review output lists
original/new hashes, byte counts and the canonical package digest. Pass that exact
digest to `stage`; any subsequent package content change invalidates it.
The digest binds content; it is not a cryptographic signature or Founder identity
verification. Local CLI authorization is the Founder's explicit invocation;
HQ authorization uses the authenticated Founder session and approval of the exact
package digest and selected runner.

Staging requires the approved repository to be clean and at the package base
commit. It produces `review.patch`, `review.json`, and a separate `workspace`
directory in a private temporary directory. No active checkout, branch or index
is modified. Keep the reported paths for review; temporary files may be cleaned
by the operating system. A failed stage removes only its own temporary directory.

## HQ dispatch

Update HQ and the selected computer's runner to the same release. Restart the
runner after the update: a running Node process keeps the old inspection-only
code. Existing device credentials remain valid; do not register again or share
credentials between computers.

Enable `allowPackageStaging: true` in the selected computer's private
`~/.config/ifcdc/aura-runner.json`, preserving its token and repository root.
Leave the setting absent or false to retain inspection-only behavior. The HQ
interface cannot enable it on a computer. Do not display or upload that file.

In HQ Software Engineering → Computer runner connection, upload the package JSON,
validate it, review the complete proposed file contents, choose the computer,
check the approval box, then select **Approve and queue isolated staging**.
Editing the package clears approval. Jobs expire after 30 minutes in the queue;
claimed jobs have a five-minute lease and are never automatically retried.
Old workers and workers without the local opt-in cannot claim staging jobs.

HQ displays a bounded runner-reported receipt: package digest, base commit,
file count, local review ID, and `testsRun: false`. This is a report from that
computer, not independent proof of filesystem contents. Local workspace and patch
paths appear only in that computer's terminal after a successful result upload.
Inspect `review.patch` and the separate workspace there. An interrupted result
upload may leave a staged workspace whose HQ job expires; inspect it locally
instead of blindly resubmitting. Revocation prevents new claims and result
acceptance; it cannot undo local staging that already began.

Only the assigned runner receives package contents. General runner listings omit
payload contents, credentials and local absolute paths. The current UI accepts
Mac and Windows repository paths, but staging still needs a real Windows trial.

The independent clone is filesystem isolation, not an execution sandbox. Do not
run package-supplied code with production credentials. A separate, locally opted-in
container test job is described in AURA-CONTROLLED-PACKAGE-TESTS.md. Production merges and deployments
require Founder approval. This release does not generate engineering packages
from natural-language instructions; a package must be prepared and reviewed first.

## Verification

```bash
node --test script/hq-aura-change-package.test.mjs
```

The integration tests use disposable Git repositories. They verify real staging,
unchanged original files/HEAD/index, review digest binding, original-file hashes,
wrong/stale/dirty repository refusal, path restrictions and symlink containment.
