# IFCDC Commercial Product MVP Standard

**Effective:** June 19, 2026  
**Applies to:** All IFCDC applications except locked production software  
**Policy:** No application proceeds to the next project until production-ready MVP status is achieved

---

## Dual Product Model

Every IFCDC application must be built as:

1. **Standalone commercial product** — sellable, deployable, brand-complete software with its own mission and monetization path
2. **IFCDC Enterprise Ecosystem member** — shares Authentication, AURA AI, Notifications, Payments, and Database services via `@ifcdc/*` packages and centralized backends (`:4100–4104`)

The Barbers App (`Apps/IFCDC-BARBERS-APP/`) is the **flagship production application** and remains **permanently locked**.

---

## MVP Gate — Required Before Next Application

Each application must complete **all applicable items** below:

| # | Requirement | Description |
|---|-------------|-------------|
| 1 | **Production-quality UI/UX** | Polished, intentional design; no placeholder screens in core flows |
| 2 | **Mobile & desktop responsiveness** | Usable on phone, tablet, and desktop viewports |
| 3 | **Authentication** | `@ifcdc/auth` or Auth Service `:4100` — no duplicate auth |
| 4 | **User roles & permissions** | Role-based access enforced client and server |
| 5 | **AURA AI integration** | `@ifcdc/aura-ai` or AURA Core `:4101` for AI features |
| 6 | **Notifications** | `@ifcdc/notifications` or Notification Service `:4102` |
| 7 | **Payments** | `@ifcdc/payments` or Payment Service `:4103` *(when applicable)* |
| 8 | **Analytics dashboard** | Usage, engagement, or business metrics for operators/users |
| 9 | **Admin portal** | Configuration, users, flags, or system oversight |
| 10 | **Legal pages** | Privacy Policy + Terms of Service |
| 11 | **Accessibility compliance** | WCAG-oriented: keyboard nav, ARIA, contrast, focus states |
| 12 | **Security audit** | Auth guards, input validation, no exposed secrets, admin protection |
| 13 | **Performance optimization** | Clean builds, reasonable bundle size, lazy loading where needed |
| 14 | **Branding consistency** | IFCDC gold/purple identity, logo, typography |
| 15 | **App Store / Play Store readiness** | Metadata, icons, privacy URLs *(if mobile)* |
| 16 | **Deployment documentation** | Environment, build, hosting, rollback |
| 17 | **Version 1 roadmap** | Post-launch maintenance and V1.x scope |
| 18 | **Version 2 roadmap** | Next-generation features and platform expansion |

---

## Post-MVP Deliverables (Per Application)

When MVP gate is passed, generate all six documents in `Documents/products/<APP>-MVP-COMPLETE/`:

| # | Deliverable | Purpose |
|---|-------------|---------|
| 1 | **Technical Report** | Architecture, integrations, build, security, performance |
| 2 | **Business Report** | Market positioning, value proposition, competitive context |
| 3 | **Deployment Checklist** | Step-by-step launch procedure |
| 4 | **Marketing Launch Checklist** | Store listings, screenshots, press, social |
| 5 | **Monetization Strategy** | Pricing tiers, revenue model, payment flows |
| 6 | **Future Feature Roadmap** | V1 maintenance + V2 innovation plan |

Template: `Documents/templates/MVP-DELIVERABLES-TEMPLATE.md`

---

## Development Protocol

```
For each app in priority order:
  1. Audit against MVP Gate checklist
  2. Complete gaps (product work only — no infrastructure refactoring)
  3. Verify: npm run check + npm run build (zero blocking errors)
  4. Generate 6 post-MVP deliverables
  5. Executive sign-off
  6. Proceed to next application
```

---

## Product Priority Order

| # | Application | Path |
|---|-------------|------|
| 1 | IFCDC Music App | `Apps/IFCDC-MUSIC-APP/IFCDC-MUSUC-APP/` |
| 2 | IFCDC Tapis | `Apps/IFCDC-TAPIS/Tapis-Init/` |
| 3 | Inclusive Community | `Apps/INCLUSIVE-COMMUNITY-IFCDC/InclusiveCommunity/` |
| 4 | Imperial Foundation CDC | `Apps/IMPERIAL-FOUNDATION-CDC/` |
| 5 | Swift-Ware | `Apps/IFCDC-SWIFT-WARE/Swift-Ware/` |
| 6 | CryptoCoin IFCDC | `Apps/CRYPTOCOIN-IFCDC/CryptoCoinIFCDC/` |

---

## Forbidden During Product Sprints

- Modifying `IFCDC-BARBERS-APP/` without explicit authorization
- New top-level directories or shared library packages
- Duplicated auth, AI, payment, or notification implementations
- Infrastructure refactoring not driven by security, performance, or stability

---

*One enterprise platform. Six commercial products. Global scale.*
