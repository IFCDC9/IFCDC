# IFCDC Enterprise Authentication & RBAC

**Status:** Phase 1 — Live  
**Host:** `Apps/IMPERIAL-FOUNDATION-CDC/`  
**Priority:** #1 — Foundation for all HQ modules and connected apps

## Single Sign-On

Every IFCDC user authenticates once through Headquarters. The same JWT cookie (`ifcdc_token`) works across:

- IFCDC Headquarters (all modules)
- Connected applications via token verification API

### Login Flow

1. User signs in at `/login`
2. Server issues HTTP-only JWT cookie (7-day expiry)
3. Client loads full enterprise session from `GET /api/hq/auth/session`
4. User is redirected to their role's `defaultRoute`

### Connected App Integration

Any IFCDC application verifies identity through Headquarters:

```
POST /api/hq/auth/verify
Cookie: ifcdc_token=<jwt>
  OR
Authorization: Bearer <jwt>

Response:
{
  "valid": true,
  "userId": "...",
  "email": "...",
  "role": "admin",
  "enterpriseRole": "administrator",
  "permissions": ["hq.executive", "hq.hr", ...],
  "modules": ["executive", "hr", "finance", ...],
  "defaultRoute": "/hq"
}
```

## Enterprise Roles

| Role | Label | Default Route |
|------|-------|---------------|
| `founder` | Founder | `/hq` |
| `executive` | Executive | `/hq` |
| `administrator` | Administrator | `/hq` |
| `board_member` | Board Member | `/hq` |
| `grant_manager` | Grant Manager | `/hq/grants` |
| `employee` | Employee | `/hq/programs` |
| `volunteer` | Volunteer | `/hq/programs` |
| `barber` | Barber | `/barber` |
| `client` | Client | `/` |
| `donor` | Donor | `/hq/donations` |

Legacy roles (`owner`, `admin`, `EXEC`, `barber`, `program_staff`, etc.) map automatically to enterprise roles.

## Permission System

Permissions are granular strings (e.g. `hq.grants.manage`, `app.barbers`). Each role receives a fixed permission set defined in `server/hq/enterpriseRoles.ts`.

### HQ Module Access

| Module | Roles |
|--------|-------|
| Executive Dashboard | founder, executive, administrator, board_member, grant_manager |
| HR | founder, executive, administrator |
| Grants | founder, executive, administrator, board_member, grant_manager |
| Finance | founder, executive, administrator, board_member, grant_manager |
| Donations | founder, executive, administrator, board_member, grant_manager, donor |
| Programs | founder, executive, administrator, employee, volunteer |
| Software Division | founder, executive, administrator |
| Settings | founder, executive, administrator |

## API Endpoints

```
GET  /api/hq/auth/session     — Full enterprise session (authenticated)
GET  /api/hq/auth/roles       — Public role definitions
POST /api/hq/auth/verify      — Token verification for connected apps
GET  /api/hq/auth/can         — Check specific permission
GET  /api/hq/auth/matrix      — Permission matrix (admin only)
```

## Client Integration

- `AuthContext` loads enterprise session with `permissions`, `enterpriseRole`, `defaultRoute`
- `ProtectedRoute` supports `requiredRoute` and `requiredPermission`
- `HQLayout` navigation filters by user permissions automatically
- Organization Settings (`/hq/settings`) displays the live permission matrix

## Development Priority (Updated)

1. ✅ **Single Login & Enterprise Roles** — This document
2. **Human Resources Platform** — Next
3. **Grant Center** — Phase 2 (documents, reminders, labor reporting)
4. **Financial Center** — Complete accounting
5. **Remaining HQ Modules**

## Barbers App Policy

The IFCDC Barbers App remains **production locked**. It authenticates through HQ via `/api/hq/auth/verify` when integrated — no modifications to Barbers code unless explicitly authorized.
