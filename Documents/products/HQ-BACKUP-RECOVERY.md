# HQ Database Backup Recovery

## Isolated restore — PASSED (2026-10-18)

- Date: 2026-10-18
- Commit live at verification: `293fc37`
- Object: `daily/2026-10-17/ifcdc-2026-10-17T02-58-57-772Z.db.enc`
- integrity_check: ok
- source_bytes: 755859492
- plaintext deleted: yes
- Automated uploads: still off (`IFCDC_DB_BACKUP_UPLOAD_ENABLED` not enabled) until a separate approval
- Production: unchanged
- Production credentials were not rotated

## External copy — VERIFIED (2026-10-18)

- Mount path: `/Volumes/IFCDC HQ Secure Backups`
- Destination: `/Volumes/IFCDC HQ Secure Backups/IFCDC-HQ-R2-VERIFIED-2026-10-17/ifcdc-2026-10-17T02-58-57-772Z.db.enc`
- Size: 755859492 bytes (source and copy)
- SHA-256: `d8d73a2ebe2ec3de4617ed16dda509786e2c0ee35bb5d876a555ac8d88736e91` (source and copy match)
- External copy: verified
- Local download and R2 object retained
- No plaintext `.db` written in the new folder

The October 17 object stays closed. This change does not replace it.

## October 19 off-server object — integrity accepted, recovery not complete

Recorded from evidence already accepted. This change does not download the object again and does not rerun `integrity_check`.

- Object: `daily/2026-10-19/ifcdc-2026-10-19T11-58-23-661Z.db.enc`
- Bucket: `ifcdc-hq-db-backups`
- source_bytes / ciphertext_bytes: 794116132
- ciphertext SHA-256: `82a36aa544d787592e92f29c32241809ac3e35f60c3c6d8b4c7a85eb23b76dd8`
- plaintext_bytes: 794116096
- Envelope overhead: 36 bytes, matching IFCDCDB1 (8-byte magic + 12-byte IV + 16-byte tag)
- integrity_check: ok
- user_table_count: 225
- `hq_scheduled_jobs`: 14 rows readable
- `hq_backup_snapshots`: 3 rows readable
- plaintext_deleted: yes
- Production database was not opened and was not overwritten
- The October 19 upload did not insert a new `hq_backup_snapshots` row. Existing on-disk snapshot rows, including October 13, stay in place.

### Status levels

- Database integrity: passed (`integrity_check` ok) for this object
- Application recovery: readable scheduled-job and snapshot rows only. Automated criteria (readonly open, integrity before any application read, a known table can be queried, a missing critical table fails, production path is never opened) were tested on a fixture. This production object was not opened again from the workstation, so the whole application is not recovered.
- External copy: not verified
- Full recovery / off-server restore verified: false

### External copy — not done

`/Volumes/IFCDC HQ Secure Backups` was mounted. The October 17 copy is still at `IFCDC-HQ-R2-VERIFIED-2026-10-17/`. The October 19 ciphertext is not on this Mac. Render deleted the temp file. R2 credentials and `BACKUP_ENCRYPTION_KEY` were not taken from the environment or from the HQ `.env`, and the disk was not searched for them. No file was written to the secure volume, to `/Volumes/IFCDC`, or to any other backup folder.
