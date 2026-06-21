# IFCDC Barbers App — Product Document

**Priority:** #1 — App Store Launch  
**Path:** `Apps/IFCDC-BARBERS-APP/`  
**Status:** Production — Active Development

---

## Mission

Launch the IFCDC Barbers App on the Apple App Store as the flagship IFCDC product.

---

## Architecture Compliance

This is a **production application**. Existing behavior must be preserved.

### New Features Only

Any new feature added during App Store prep must use centralized IFCDC services:

| Need | Use |
|------|-----|
| Auth | `@ifcdc/auth` / Auth Service `:4100` |
| AI | `@ifcdc/aura-ai` / AURA Core `:4101` |
| Notifications | `@ifcdc/notifications` / Notification Service `:4102` |
| Payments | `@ifcdc/payments` / Payment Service `:4103` |

Do not add duplicate implementations alongside existing production code.

---

## App Store Checklist

- [ ] App metadata and screenshots
- [ ] Privacy policy URL
- [ ] Terms of service
- [ ] App Store Connect configuration
- [ ] TestFlight beta testing
- [ ] Production build verification
- [ ] Review submission

---

## Change Log

| Date | Change | Author |
|------|--------|--------|
| 2026-06-19 | Product document created — App Store launch priority | Tessa |

---

*Update this document for all Barbers App development activity.*
