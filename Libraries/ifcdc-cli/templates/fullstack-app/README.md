# __APP_DISPLAY_NAME__

__APP_DESCRIPTION__

## Stack

- React 19 + TypeScript + Vite 7 + Tailwind CSS 4
- Express.js + Drizzle ORM + PostgreSQL
- @ifcdc/* shared libraries (auth, AURA AI, payments, notifications, database, UI)

## Quick Start

```bash
npm install
cp .env.example .env
npm run db:push
npm run dev
```

## IFCDC Services

Connect to centralized IFCDC backend services:

| Service | Port | Env Variable |
|---------|------|--------------|
| Auth | 4100 | `IFCDC_AUTH_URL` |
| AURA AI | 4101 | `IFCDC_AURA_URL` |
| Notifications | 4102 | `IFCDC_NOTIFICATIONS_URL` |
| Payments | 4103 | `IFCDC_PAYMENTS_URL` |
| Database | 4104 | `IFCDC_DATABASE_URL` |
