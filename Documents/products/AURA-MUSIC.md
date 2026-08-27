# AURA MUSIC — IFCDC HQ Module

**Priority:** HQ capability (music production via AURA)  
**Status:** Phase 1 PASS · Phase 2 PASS · Phase 2 Hardening PASS (reboot verified 2026-08-27)  
**Standalone music platform:** **Forbidden** — AURA MUSIC is part of IFCDC HQ, not a separate product

---

## Mission

AURA MUSIC is an **IFCDC HQ module**. Authorized devices only command AURA through HQ. Ableton processing runs on a dedicated production node behind the scenes.

---

## Target architecture (locked)

```
Any Authorized Device (iPhone / iPad / Mac / Windows / …)
        ↓
IFCDC HQ
        ↓
AURA MUSIC
        ↓
Secure Music Job Queue
        ↓
Ableton Production Node  (this Mac in Phase 1; dedicated node later)
        ↓
Mix / Master / QC
        ↓
IFCDC Music Library
```

**Device role:** command AURA only.  
**Ableton role:** production node — not opened on the client device.

### Phase 1 (Ableton bridge — PASS)

```
Local caller / smoke test / future HQ route
  → http://127.0.0.1:4177  (AURA Ableton Bridge — localhost only)
  → file-queue (+ optional OSC)
  → MIDI Remote Script / Max for Live
  → Ableton Live 10 Suite (production node on this Mac)
```

### Phase 2 (Audio intelligence — PASS)

```
Local caller / future HQ route
  → http://127.0.0.1:4178  (AURA MUSIC Intelligence — localhost only)
  → SQLite Music Library + analysis + rights + search + projects
  → Originals preserved under ~/Music/IFCDC-MUSIC/library/
```

Phase 1 bridge was **not** modified for Phase 2.

### Phase 2 Hardening (auto-start / recovery — PASS)

macOS LaunchAgents (`RunAtLoad` + `KeepAlive`) start and restart:

- Music Intelligence → `127.0.0.1:4178`
- Ableton Bridge → `127.0.0.1:4177`
- Watchdog → `~/Music/IFCDC-MUSIC/status/aura-music-ready.json`

Reboot verified 2026-08-27: no Terminal / `npm start`; services ONLINE; Ableton session/tracks reachable; HQ local health PASS; cloud HQ remains `NOT_APPLICABLE` / no public ports. **Phase 3 authorized 2026-08-27** — controlled mixing intelligence (Mix V1).

### Distinction: IFCDC Music App vs AURA MUSIC

| | **IFCDC Music App** | **AURA MUSIC** |
|--|---------------------|----------------|
| What | Consumer/product app in workspace (`Apps/IFCDC-MUSIC-APP/…`) | HQ module for AURA-driven production |
| Role | End-user music product (MVP product #2) | Production pipeline: analyze/library/mix/master/QC via AURA |
| Relationship | May later *consume* HQ/AURA MUSIC jobs | Lives under HQ architecture; not a fork of AURA |

Phase 1–2 packages live under `Apps/IFCDC-MUSIC-APP/…/aura-music/` as a **safe local package location** (architecture freeze — no new top-level folders).

### HQ Command Center (UI)

Sidebar: **AURA MUSIC** → `/hq/aura-music`  
API: `GET /api/hq/aura/music/command-center` (auth + `aura` module; never exposes 4177/4178)  
Sections foundation: Dashboard · Library · Projects · Mix · Master · Sampling · Sounds · Jobs · Ableton  

---

## Phase roadmap

| Phase | Scope | Status |
|-------|--------|--------|
| **1** | AURA ↔ Ableton Bridge | **PASS** |
| **2** | Audio Intelligence Foundation (ingest/analyze/library/search/rights/projects/reports) | **PASS** |
| **2H** | Auto-start / crash recovery / local health (LaunchAgents) | **PASS** (reboot verified) |
| **3** | Mixing Intelligence (controlled racks, Mix V1, engineering reports, taste feedback foundation) | **ACTIVE** (2026-08-27) |
| 4 | Mastering + QC + reference comparison | Not started — needs Founder approval |
| 5 | Stem management + full Music Library UX | Not started |
| later | HQ Secure Music Job Queue + remote device → production node | Not started |

---

## Safety / freeze compliance

- No new top-level IFCDC folders  
- No new `@ifcdc/*` packages or backend microservices  
- No Imperial Foundation HQ route changes  
- No production database or deployment changes  
- Bridge binds to **127.0.0.1** only  

---

## Change log

| Date | Change |
|------|--------|
| 2026-08-27 | Phase 3 Mixing Intelligence — decision engine, engineering racks, Mix V1 orchestrator, taste feedback foundation |
| 2026-08-26 | Phase 1 local bridge, Max for Live script, fixtures, docs, output folders |

---

*Update this document as AURA MUSIC phases progress.*
