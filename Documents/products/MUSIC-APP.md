# IFCDC Music App — Product Document

**Priority:** #1 — Active Development  
**Path:** `Apps/IFCDC-MUSIC-APP/IFCDC-MUSUC-APP/`  
**Status:** Working Build — IFCDC Services Wired

---

## Mission

Music production and distribution platform for IFCDC — upload, manage, and distribute music with AURA AI-powered DJ features.

---

## Build Status

| Check | Result | Date |
|-------|--------|------|
| `npm run check` | ✅ Pass (0 TS errors) | 2026-06-19 |
| `npm run build` | ✅ Pass (`dist/index.cjs` + client bundle) | 2026-06-19 |

---

## IFCDC Service Integration

| Capability | Package / Service | Integration Point |
|------------|-------------------|-------------------|
| Auth | `@ifcdc/auth` | `server/lib/ifcdc.ts` → `signMusicToken` / `verifyMusicToken`; `auth.route.ts`, `middleware/auth.ts` |
| AURA AI | `@ifcdc/aura-ai` | `server/lib/ifcdc.ts`; `server/services/ai/llmClient.ts`, `llm.ts` |
| Payments | `@ifcdc/payments` | Booking deposit intents via `createDepositPayment()` |
| Notifications | `@ifcdc/notifications` | Booking confirmations via `sendBookingConfirmation()` |
| Database | Drizzle ORM + PostgreSQL | `server/db.ts` (app-owned schema) |
| Health | IFCDC services `:4100–4104` | `GET /api/health` probes centralized backends |

### Integration Layer

All centralized service access routes through `server/lib/ifcdc.ts`. No duplicate auth, payment, notification, or primary LLM implementations in core flows.

### Security Fix

- Admin routes now require `authMiddleware` (`server/routes/admin.route.ts`)

### Known Follow-ups

- **Specialized OpenAI clients** (image gen, TTS, voice, chat integrations) in `server/replit_integrations/` and `server/routes/ai/` still use direct OpenAI for non-text modalities — migrate when `@ifcdc/aura-ai` expands
- **`@ifcdc/database`** deferred: duplicate `drizzle-orm` instances cause TS conflicts; using local Drizzle pool (same pattern as Swift-Ware/Tapis) until package peer-deps are fixed

---

## Environment

Copy `.env.example` → `.env`. Required: `DATABASE_URL`, `JWT_SECRET`. Optional: `OPENAI_API_KEY`, `STRIPE_SECRET_KEY`, `IFCDC_*_URL`.

---

## Change Log

| Date | Change | Author |
|------|--------|--------|
| 2026-06-19 | Wired `@ifcdc/auth`, `@ifcdc/aura-ai`, `@ifcdc/payments`, `@ifcdc/notifications`; health endpoint; admin auth guard; working build | Tessa |

---

*Update this document for all Music App development activity.*
