# IFCDC Radio — implementation and rollout

## Delivered in this branch

Both `/radio` and `/app/radio` now open station operations. Founder/owner and admin can upload MP3 files (25 MB each, 500 tracks), select tracks in order, schedule a named show, and remove scheduled shows. Radio hosts and Executive roles have read/listening access. Existing show APIs are unchanged. New endpoints are mounted in the active application bootstrap with the existing HQ authentication and MFA policy; production HQ remains Founder-only. Activity entries record actor and action for uploads/schedule changes (last 1,000 entries).

The private listener calculates its place from the UTC schedule and seeks into the currently scheduled track. Newer shows interrupt older shows. No automatic resumption follows an interruption. Browser polling runs every five seconds; this is a programming preview, with possible gaps between tracks, not a broadcast transport. It requires an open listening browser and does not transmit audio to the public.

## Required configuration before use

Set `RADIO_DATA_DIR` to a dedicated directory on an attached persistent disk. Example: `/var/data/ifcdc-radio` ONLY if `/var/data` is the actual persistent disk mount. No ephemeral storage fallback is used. Run one HQ process against that directory: the write queue is process-local, not a distributed lock. Back up the entire directory (manifest plus MP3 files). Confirm available space and quota before ingesting recordings. Metadata commits use atomic rename; sudden machine failure may leave unreferenced uploaded audio. Audio durations are browser-supplied and need verification before production broadcasting.

No production configuration, merge, deployment, or existing backup changes have been made. The former suspended HQ hostname must separately be removed from the portfolio launch configuration after verifying its canonical setting.

## Acceptance run after deployment

1. Sign in as Founder and open `/radio`.
2. Upload two short MP3s; select them in order.
3. Schedule a show one minute ahead, using local time in the form.
4. Press Listen once it starts; verify the clock selects the appropriate audio and advances to the second recording.
5. Refresh and confirm the library and schedule survive; restart the test service and repeat.
6. Verify a host can listen but cannot upload or change schedules, and an unrelated role cannot fetch private audio.

Automated checks: `node --import tsx --test script/radio-station*.test.ts`.

## Remaining milestones toward the agreed independent station

1. Server-side media inspection, storage quotas, delete/archive, categories, waveform/level checks, verified duration, and larger-recording ingestion.
2. Recurring daily/weekly shows, timezone/DST policy, editable playlists, rotation rules, station IDs, advertisements, and schedule conflicts.
3. Dedicated always-running playout worker (separate from the HQ web process), approved audio processing/crossfades, silence detection, fallback playlist, watchdog, and restart recovery.
4. IFCDC-controlled Icecast deployment with authenticated encoder input, TLS listener endpoint, protected credentials, bandwidth sizing, and independently tested public website player.
5. Live microphone/DJ takeover, safe return to automation, now-playing metadata, real encoder/stream monitoring, and broadcast evidence logs.
6. Founder-scoped Aura actions and Dell connector after the independent station passes its acceptance broadcast.

Completion gate: upload → schedule → autonomous server playout → streaming endpoint → audible website playback, including disconnect/restart tests. The current branch does not yet meet that gate and must not be labeled on-air.


## Phase 2: private server playout

Set `RADIO_PLAYOUT_ENABLED=true` and `RADIO_FFMPEG_PATH=/usr/bin/ffmpeg` on the existing Render HQ service after merging this patch. Keep `RADIO_DATA_DIR=/opt/render/project/src/data/radio` on the existing persistent disk. No new disk or service is required. Keep PUBLIC_APP_URL and PUBLIC_BASE_URL on the verified active HQ hostname. One HQ process/instance only.

The new private `/api/radio/stream` endpoint uses the same HQ authentication/MFA and read-role checks as private library audio. A persistent 128 kbps MP3 encoder receives scheduled PCM audio or silence. It runs without listeners and joins a currently running show at the schedule offset after restart. The station page includes a separate audio control and playout status. The old per-track browser preview remains available. The endpoint allows at most ten listeners and disconnects slow clients to bound buffering. No public unauthenticated endpoint or public transmitter is enabled; `streaming:false` retains its public-broadcast meaning.

This is a private test transport in the web process, not the dedicated broadcast worker described in the roadmap. Schedule changes are polled every second; browser/encoder buffers add latency and transitions can have short gaps. Bad/missing media or encoder failures report an error and retry after five seconds; a stalled encoder is restarted after ten seconds. There is no fallback music, automatic gain processing, or crossfade. Browser-supplied durations remain a limitation. Deploys interrupt connections; press Play again after restart. Streaming bytes measure output, not proof that a listener hears program audio.

Storage now refuses to create an empty library if MP3 files exist without station.json. Do not delete existing files to bypass that warning; restore the matching manifest and audio backup. This does not recover previously lost uploads or prove the production disk survived deployment.

Validate with `node --import tsx --test script/radio-station*.test.ts script/radio-playout.test.ts`, `npm run check`, and `node --import tsx script/build.ts`. The playout test requires FFmpeg with libmp3lame and exercises real output, no-listener operation, scheduled playback, return to silence, shutdown, and a missing binary.

After deployment: play the private continuous control; schedule two short verified MP3s in order; hear both; close the browser and rejoin mid-show; confirm the expected clock position; capture library count/titles before a controlled service restart and verify the same files remain afterward. Confirm unauthenticated requests return 401. Keep public broadcasting disconnected until a separate public broadcast acceptance test passes.

## Phase 3: catalog and custom crate foundation

The uploaded radio library now supports editable artist, genre, era, BPM, musical key, mood, energy, clean/explicit status, category, kick/bass notes, vocal density, transition notes and Founder preferences (unreviewed, approved, favorite, rejected). Catalog changes retain actor/time and enter the station activity log. Unknown values remain unknown: no filename guessing is treated as clean approval or analysis. Search covers title and catalog fields.

Save a selected ordered playlist as a named crate, or build a snapshot from exact genre/mood, energy, BPM bounds, clean-only and approved/favorite-only rules. The builder excludes rejected tracks, excludes unknown clean tags when clean-only is selected, and excludes unknown BPM when a BPM range is requested. Results sort by ascending BPM then title, unknown BPM last. This is rule-based grouping, not measured beat/phrase/key compatibility. Inspect the ordered list, load it into the show selection, then schedule it explicitly. Existing schedules retain their track snapshots when crates change or are removed. A manual crate can include a rejected track if the Founder deliberately selects it; rejection exclusions apply to the builder.

Catalog editing and crate writes use the same Founder/admin authorization as schedule writes; hosts can read only. Crates live with station.json on the same persistent disk. Existing manifests without crates/catalog need no reset or migration command. Limits are 200 crates and 200 tracks per crate. No media is moved, renamed or deleted, no public endpoint is added, and no scheduled show is automatically changed.

This establishes the radio catalog APIs and user controls for Aura's later programming integration. It does not yet connect conversational Aura actions, measure audio BPM/key or kick/bass, infer mood/energy, import local Serato crates, or learn preferences from listening history. Existing Serato tools operate on local machine paths; those are not available to Render automatically. This phase requires no AI provider, new environment variables, paid service or automatic publishing. New endpoint shapes: PATCH /api/radio/library/:id/catalog (full validated catalog object), POST /api/radio/crates ({name,tracks} OR {name,rules}), DELETE /api/radio/crates/:id; GET /api/radio/station includes crates/catalog.

Validation: `node --import tsx --test --test-concurrency=1 script/radio-*.test.ts`, `npm run check`, `node --import tsx script/build.ts`. Tests cover legacy manifest compatibility and audio preservation, catalog/crate persistence, role denial, strict metadata validation, missing-track handling, clean/approval/rejection filters, unknown BPM, range validation and unchanged schedules. After deployment tag two recordings, save a manual crate, build a rule crate, review ordering, load into show selection, schedule, and recheck library/crates after a controlled restart.
