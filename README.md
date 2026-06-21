# IFCDC Development Headquarters

Official software development workspace for the Imperial Foundation Community Development Corporation (IFCDC) ecosystem.

## Workspace Structure

```
IFCDC/
├── Apps/           # Application projects
├── Backend/        # Standalone APIs and microservices
├── Libraries/      # Reusable shared packages (@ifcdc/*)
├── Shared/         # Cross-project assets, configs, and utilities
├── Media/          # Brand assets, media files, design resources
├── Documents/      # Specifications, policies, and documentation
└── Archive/        # Deprecated projects and backups
```

## Active Projects

| Project | Path | Status |
|---------|------|--------|
| Imperial Foundation CDC | `Apps/IMPERIAL-FOUNDATION-CDC` | Community platform |
| CryptoCoin IFCDC | `Apps/CRYPTOCOIN-IFCDC/CryptoCoinIFCDC` | ERC-20 token platform |
| Swift-Ware | `Apps/IFCDC-SWIFT-WARE/Swift-Ware` | Business management |
| Tapis | `Apps/IFCDC-TAPIS/Tapis-Init` | Service platform |
| Inclusive Community | `Apps/INCLUSIVE-COMMUNITY-IFCDC/InclusiveCommunity` | Autism support platform |
| IFCDC Music App | `Apps/IFCDC-MUSIC-APP/IFCDC-MUSUC-APP` | Music production platform |

> **Architecture:** FROZEN — see `Documents/ARCHITECTURE-FREEZE.md`  
> **Headquarters vision:** `Documents/HEADQUARTERS-VISION.md` — Enterprise Operating System  
> **Product focus:** Music App MVP → Tapis → Inclusive → Imperial Foundation (HQ shell) → Swift-Ware → CryptoCoin  
> See `Documents/PRODUCT-ROADMAP.md`

## Shared Libraries

Reusable packages in `Libraries/ifcdc-packages/packages/`:

- `@ifcdc/auth` — Authentication (JWT, sessions, middleware)
- `@ifcdc/aura-ai` — AURA AI integration (OpenAI, prompts, streaming)
- `@ifcdc/notifications` — Email, SMS, push notifications
- `@ifcdc/payments` — Stripe, PayPal, payment processing
- `@ifcdc/ui-components` — Shared React UI components
- `@ifcdc/api-client` — Typed HTTP client for IFCDC APIs
- `@ifcdc/database` — Drizzle ORM utilities and connection helpers

## Getting Started

1. Open workspace: `File → Open Workspace from File → IFCDC.code-workspace`
2. Install Node.js 20+ (current: v24 LTS)
3. Install project dependencies: `npm install` in each app directory
4. Copy `.env.example` to `.env` and configure environment variables
5. Run development server: `npm run dev`

## Development Standards

- TypeScript for all new code
- Express + React + Vite stack for full-stack apps
- Drizzle ORM for database access
- Shared libraries for cross-cutting concerns
- Git version control on all projects

## Reports

See `Documents/DEVELOPMENT-HEADQUARTERS-REPORT.md` for the latest workspace health audit.
