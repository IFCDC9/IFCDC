# AURA local change-package protocol v1

This milestone reviews a JSON change package, then stages its exact contents in
a private independent clone of the approved IFCDC9/IFCDC repository. It does not
extend the HQ runner job protocol. HQ still dispatches repository inspections only.
It does not run tests, commit, push, open a PR, merge or deploy.

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
verification. Authorization is currently the Founder's explicit local invocation.

Staging requires the approved repository to be clean and at the package base
commit. It produces `review.patch`, `review.json`, and a separate `workspace`
directory in a private temporary directory. No active checkout, branch or index
is modified. Keep the reported paths for review; temporary files may be cleaned
by the operating system. A failed stage removes only its own temporary directory.

The independent clone is filesystem isolation, not an execution sandbox. Do not
run package-supplied code with production credentials. Controlled test execution,
authenticated HQ dispatch/approval and result reporting are separate remaining
milestones. Production merges and deployments require Founder approval.

## Verification

```bash
node --test script/hq-aura-change-package.test.mjs
```

The integration tests use disposable Git repositories. They verify real staging,
unchanged original files/HEAD/index, review digest binding, original-file hashes,
wrong/stale/dirty repository refusal, path restrictions and symlink containment.
