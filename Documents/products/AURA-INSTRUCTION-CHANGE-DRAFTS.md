# AURA instruction-to-package drafts

Founder can describe a small change and select one to five portable source paths
in IFCDC9/IFCDC from HQ's Software Engineering runner panel. The server reads
main's commit once and fetches each selected file at that exact SHA. Missing files
can be proposed as new files. Only regular UTF-8 text is supported; the total
source context is limited to 60,000 bytes. The existing package path policy runs
before any source request, including protection of credentials and runner files.

HQ's configured AI provider receives only the instruction and selected source
snapshot. It has no tools, shell, runner credential or production access in this
operation. It returns proposed complete replacement contents. The server refuses
unknown files, model-supplied digests or command fields, duplicate paths, unchanged
files, oversized output and invalid packages. Original SHA-256 values and the
base commit are computed from the fetched snapshot, not supplied by the model.
Source comments are explicitly treated as data, not executable instructions.

The returned package populates the existing review box. Founder must validate,
review and separately approve staging. A returned draft never queues a job or
inherits approval. Changing inputs while a request is pending makes its late
response obsolete, preserving current work. At most one draft per Founder and
four per server process are in progress. GitHub calls and model calls are bounded;
model calls do not automatically retry, except configured credential fallback on
authentication failure. No source or generated content is included in audit
metadata; successful draft audit records contain the digest, base and file count.

## Prerequisites and limits

- Existing Founder session and authorization; device credentials cannot draft.
- HQ GITHUB_TOKEN with repository read access and an existing working AI key/model.
- The local runner must be at the generated package's exact base for staging.
- Drafting does not establish correctness, run tests, open a PR, commit or deploy.
- The existing package-validator-v1 test profile checks validator contracts only.
  It does not validate the proposed application changes.
- This adds bounded drafting, not automatic diagnosis, source selection, broad
  application tests or a general autonomous repair-and-release pipeline.

## Validation

Regression tests cover instruction/output bounds, source-hash and commit binding,
GitHub snapshots, unsafe sources, route authorization, manual approval and obsolete
UI responses. Model and GitHub responses are fixtures; no live model call or HQ
production drafting has been verified until a Founder trial is performed.
