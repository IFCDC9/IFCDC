# @ifcdc/headquarters-sdk

Official SDK for connecting IFCDC applications to **Headquarters** — the enterprise operating system.

Every future application (Music, Radio, Tapis, Inclusive Community, CryptoCoin, Swift-Ware, and beyond) inherits:

- Enterprise authentication (single login, JWT, RBAC)
- People database (employees, volunteers, clients)
- Financial engine (GL, budgets, payroll, donations)
- Grant management
- Organization analytics and KPI monitoring
- AURA AI (chat, summarize, recommend, forecast)
- Enterprise notifications
- Real-time WebSocket updates

Each app remains **independently deployable**. The Barbers App is **production locked** and serves as the benchmark integration.

## Version 1.1.0

- Application onboarding wizard (`POST /api/hq/developer/onboard`)
- Event-driven WebSocket push (`type: "update"`) — no polling during active use
- Role-based dashboard templates (`GET /api/hq/workspace/templates`)
- `hq.softwareDivision.onboard()`, `hq.developer.*`, `hq.workspace.*` SDK methods

## Install

```bash
npm install @ifcdc/headquarters-sdk
```

Local monorepo link:

```json
"@ifcdc/headquarters-sdk": "file:../../Libraries/ifcdc-packages/packages/headquarters-sdk"
```

## Quick Start

```typescript
import { createHeadquartersClient } from "@ifcdc/headquarters-sdk";

const hq = createHeadquartersClient({
  baseUrl: "https://headquarters.ifcdc.org",
  appId: "music-app",
  token: process.env.IFCDC_HQ_TOKEN,
});

// Verify session
const session = await hq.auth.session();
console.log(session.user);

// Organization analytics
const analytics = await hq.analytics.overview();

// AURA executive assistant
const insight = await hq.aura.chat("What grant compliance items are due this month?");
```

## Authentication

Headquarters uses JWT via cookie (`ifcdc_token`) or `Authorization: Bearer <token>` header.

```typescript
// Verify token from connected app
const verified = await hq.auth.verify();

// Get full enterprise session with permissions
const session = await hq.auth.session();
```

### Required Headers

| Header | Value |
|--------|-------|
| `Authorization` | `Bearer <jwt>` |
| `X-IFCDC-App-Id` | Your Software Division app ID |
| `Content-Type` | `application/json` |

## API Modules

| Module | Methods |
|--------|---------|
| `auth` | `verify()`, `session()`, `roles()` |
| `people` | `list({ type, search })` |
| `finance` | `overview()` |
| `grants` | `overview()` |
| `analytics` | `overview()`, `trends()`, `kpiMonitoring()` |
| `aura` | `chat()`, `summarize()`, `recommend()`, `forecast()` |
| `notifications` | `list()` |
| `softwareDivision` | `framework()`, `health()`, `register()` |
| `health` | Platform health check |

## Real-Time WebSocket

Connect to `/api/hq/ws` for live dashboard updates (finance, grants, HR, analytics, notifications).

```typescript
const ws = new WebSocket(hq.realtimeUrl());
ws.onmessage = (event) => {
  const { type, data } = JSON.parse(event.data);
  if (type === "snapshot") {
    // data.finance, data.grants, data.people, data.notifications
  }
};
```

Authentication: HQ session cookie (browser) or `?token=<jwt>` query parameter.

Broadcast interval: every 20 seconds.

## Register a New Application

```typescript
await hq.softwareDivision.register({
  id: "music-app",
  name: "IFCDC Music",
  healthUrl: "https://music.ifcdc.org/api/health",
  launchUrl: "https://music.ifcdc.org",
  description: "Music division application",
});
```

View the full integration framework:

```typescript
const framework = await hq.softwareDivision.framework();
console.log(framework.inheritedServices);
```

## Integration Principles

1. One enterprise login across all applications
2. One people database shared by every module
3. One financial engine for all revenue and expenses
4. One analytics platform for organization-wide intelligence
5. One AURA AI layer for executive decision support
6. Each app remains independently deployable
7. Production-locked apps (Barbers) are never modified via HQ integration

## Developer Portal

Headquarters includes a built-in Developer Portal at `/hq/developer` with live API reference and copy-paste examples.

## License

MIT — IFCDC Software Division
