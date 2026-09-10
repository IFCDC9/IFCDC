# AURA DJ — Serato

**Status:** **AURA DJ CORE FOUNDATION = 11 / 11 PASSED** (2026-09-10)  
**Architecture:** SOFTWARE-FIRST — controllers are **optional accessories only**  
**Relationship:** Expansion of AURA — not a reset of AURA Music.

## Permanent operating model

```
Founder
→ IFCDC HQ
→ AURA DJ
→ AURA–Serato Bridge (:4179)
→ Serato DJ Pro Software
```

- **Founder** = crowd motivator / creative director  
- **AURA** = actual DJ (search, load, match, cue, transition, mix, remember)  
- Hardware DJ controllers are **not required** for core operation

## Core matrix (LOCKED)

| # | Competency | Status |
|---|------------|--------|
| 1 | Readback / Observation | PASSED |
| 2 | BPM / Key | PASSED |
| 3 | Cue / Grid | PASSED |
| 4 | Control / Load | PASSED |
| 5 | Transport | PASSED |
| 6 | Two-Deck State | PASSED |
| 7 | Crossfader | PASSED |
| 8 | Transition Intelligence | PASSED |
| 9 | Safe Transition | PASSED |
| 10 | Channel Faders | PASSED |
| 11 | Live Mixing Foundation | PASSED |

Evidence: `aura-music/serato-bridge/validation-artifacts/AURA-DJ-CORE-11-OF-11-CERTIFICATION.json`  
Channel faders: software UI slow-cliclick → live Remote `mixer.upfaders[]` (`AURA-CF-LADDER-PASS.json`)

**Do not rediscover** verified control methods. **Do not downgrade** PASSED core rows.

## Separation of concerns

| Platform | Role |
|----------|------|
| **Ableton** | Production / engineering |
| **Serato** | DJ performance / library / mixing |

Shared intelligence (taste, BPM, key, genre, mood, energy, provenance) may cross platforms. **Operational control systems stay separate.**

## Intelligence loop (permanent)

```
RECALL → UNDERSTAND → PLAN → EXECUTE → VERIFY → EVALUATE → LEARN → SAVE → APPLY
```

APIs:

- `GET /v1/dj/intelligence`  
- `GET /v1/dj/memory/recall`  
- `POST /v1/dj/intelligence/tick`  
- `POST /v1/dj/direction` / `transition-reaction` / `select-next`

Durable memory root: `~/Music/IFCDC-MUSIC/library/aura-dj/`

## Next development (post-core)

EQ · Filter · Gain · Loops · Hot Cues · Stems · FX · Sampler · deeper crate intelligence · faster search · advanced matching · set construction / memory · recovery · advanced live mixing · energy / vocal / phrase / crowd-direction

## HQ visibility

- Tab: **AURA DJ — Serato** inside `/hq/aura-music`  
- Deep links: `/hq/aura-dj`, `/hq/aura-serato`  
- Live data: bridge `GET /v1/hq/snapshot` → HQ `GET /api/hq/aura/music/serato`  
- Cloud HQ: Founder Mac production-node heartbeat (`auraDjHq`)  
- Shows: Core Foundation 11/11, Serato/bridge status, capabilities, lesson, progress, next objective, blockers, intelligence ticks, memory status

## Implementation paths

- Bridge: `aura-music/serato-bridge/`  
- LaunchAgent: `com.ifcdc.aura-serato-bridge`  
- Cert: `~/Music/IFCDC-MUSIC/library/aura-dj/certification-status.json`  
- Capabilities: `.../memory/capabilities.json`  
- Mix lessons: `.../memory/mixes/lessons.jsonl`

## Rules

- Do **not** invent track metadata — use KNOWN / ESTIMATED / UNKNOWN  
- Do **not** reset certifications, mix lessons, or verified controls  
- Do **not** require a physical controller for core AURA DJ  
- Founder confirmation is for taste / crowd / creative direction — not objective machine proofs  
- Founder instructions always override older taste priors  
