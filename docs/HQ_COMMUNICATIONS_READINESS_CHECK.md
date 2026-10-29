# Correct communications readiness evidence

The previous assessment checked for any table matching `comm%`. HQ Communications
actually uses `hq_messages` and `hq_announcements`, created by the existing HQ
bootstrap. Consequently "Communications tables missing" could be a false alarm
even with the correct tables present.

The probe now selects the columns used by that module with `WHERE 1 = 0`. It
does not read message contents, create tables/rows, or send anything. It names a
genuinely missing required table. Other query errors are propagated rather than
being converted to a claim of missing tables. Passing storage validation remains
UNVERIFIED for end-to-end communications behavior.

The readiness dashboard now reads findings from the latest run and current issue
statuses. Older run records are retained; their unresolved findings do not leak
into the current dashboard. The saved score/check results do not change when an
issue status is reviewed, and resolving an issue does not certify an untested flow.
The summary's issue count reflects current review status.

Readiness badges now use the shared badge component's actual label/variant props.
Severity and UNVERIFIED/PASS/FAIL are visible instead of blank badges. A checklist
summary distinguishes failed checks from missing verification evidence.

Validation: isolated SQLite probes for the actual table names, missing tables,
missing columns, locked queries, empty mail history, rendered badge labels, and
two assessment runs plus issue-status updates. No live services or production
data are needed. After Founder review, deploy IFCDC-HQ and run one new read-only
assessment. Check the Communications Center storage result and verify delivery
separately before claiming the communications workflow works.
