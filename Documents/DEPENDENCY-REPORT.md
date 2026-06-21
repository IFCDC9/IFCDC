# IFCDC Dependency Report

Generated: 2026-06-18

## Executive Summary

| Metric | Value |
|--------|-------|
| Projects audited | 7 (6 apps + 1 shared lib monorepo) |
| Projects excluded | IFCDC-BARBERS-APP (production) |
| Dependencies installed | 7/7 |
| Production builds passing | 6/6 apps |
| TypeScript checks passing | 0/6 (pre-existing errors) |
| Shared libraries built | 7/7 |

---

## Healthy Projects

Projects with successful `npm install` and `npm run build`:

| Project | Build | Dependencies | README | Git |
|---------|-------|--------------|--------|-----|
| Imperial Foundation CDC | ✅ | ✅ | ✅ | ✅ |
| CryptoCoin IFCDC | ✅ | ✅ | ✅ | ✅ |
| Swift-Ware | ✅ | ✅ | ✅ | ✅ |
| Tapis | ✅ | ✅ | ✅ | ✅ |
| Inclusive Community | ✅ | ✅ | ✅ | ✅ |
| IFCDC Music App | ✅ | ✅ | ✅ | ✅ |
| IFCDC Shared Libraries | ✅ | ✅ | ✅ | N/A (root git) |

---

## Projects Requiring Attention

### TypeScript Errors (Pre-existing)

All apps have TypeScript errors in `npm run check`. These are schema/type mismatches from Replit migrations and do not block production builds.

| Project | Error Count | Primary Issues |
|---------|-------------|----------------|
| Imperial Foundation CDC | ~15+ | Prisma UUID vs number type mismatches, Stripe API version |
| CryptoCoin IFCDC | 4 | `window.ethereum` types, Vite `allowedHosts` config |
| Swift-Ware | 8 | Null safety, literal type assignments in routes |
| Tapis | 5+ | Drizzle enum type mismatches in storage |
| Inclusive Community | 8+ | Schema field mismatches, Vite config |
| IFCDC Music App | 10+ | Replit integration types, schema mismatches |

### Security Vulnerabilities

| Project | Total | Critical | High | Moderate | Low |
|---------|-------|----------|------|----------|-----|
| Imperial Foundation CDC | 38 | 0 | 25 | 10 | 3 |
| CryptoCoin IFCDC | 27 | 0 | 10 | 14 | 3 |
| Inclusive Community | 28 | 0 | 13 | 14 | 1 |
| IFCDC Music App | 24 | 1 | 11 | 10 | 2 |
| Swift-Ware | 15 | 0 | 9 | 5 | 1 |
| Tapis | 14 | 0 | 8 | 5 | 1 |

**Common vulnerable packages:** `esbuild`, `qs`, `yaml`, transitive dependencies in Vite/esbuild toolchain.

**Recommended action:** Run `npm audit fix` per project for safe patches. Avoid `--force` until TypeScript errors are resolved.

---

## Missing Packages

All projects had `package-lock.json` files. Fresh `npm install` completed successfully for all 7 targets.

**Fixed during audit:**
- Imperial Foundation CDC — Reinstalled `node_modules` to fix cross-platform esbuild binary (`@esbuild/win32-x64` → `@esbuild/darwin-x64`)

---

## Build Errors

| Project | Status | Notes |
|---------|--------|-------|
| Imperial Foundation CDC | ✅ Fixed | Required node_modules reinstall for macOS esbuild |
| CryptoCoin IFCDC | ✅ Pass | |
| Swift-Ware | ✅ Pass | |
| Tapis | ✅ Pass | |
| Inclusive Community | ✅ Pass | |
| IFCDC Music App | ✅ Pass | |
| Shared Libraries | ✅ Pass | Auth and database packages fixed during setup |

---

## Recommended Upgrades

### Safe (Minor/Patch)

- `@jridgewell/trace-mapping` → 0.3.31
- All `@radix-ui/*` packages → latest patch versions
- `@openzeppelin/contracts` 5.2.0 → 5.6.1 (CryptoCoin)

### Moderate Risk

- React 18 → 19 (Imperial Foundation already on React 19)
- Vite 5 → 7 (CryptoCoin, Inclusive Community still on Vite 5)
- Express 4 → 5 (CryptoCoin, Inclusive Community still on Express 4)
- `drizzle-orm` 0.39 → latest

### High Risk (Defer)

- `@hookform/resolvers` 3.x → 5.x (breaking API changes)
- `@neondatabase/serverless` 0.10 → 1.x (major version)
- Stripe API version updates (Imperial Foundation)

---

## Shared Libraries Status

| Package | Build | Purpose |
|---------|-------|---------|
| `@ifcdc/auth` | ✅ | JWT, bcrypt, Express middleware |
| `@ifcdc/aura-ai` | ✅ | OpenAI AURA assistant |
| `@ifcdc/notifications` | ✅ | Email, SMS, push |
| `@ifcdc/payments` | ✅ | Stripe payment intents |
| `@ifcdc/ui-components` | ✅ | React UI utilities, brand constants |
| `@ifcdc/api-client` | ✅ | Typed HTTP client |
| `@ifcdc/database` | ✅ | Drizzle ORM connection helpers |

---

## Audit Commands

Re-run the audit script:

```bash
bash Documents/audit-projects.sh
```

Per-project checks:

```bash
cd Apps/<project> && npm run check && npm run build && npm audit
```
