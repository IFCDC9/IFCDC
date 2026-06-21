# IFCDC Shared Libraries

Monorepo of reusable packages for the IFCDC software ecosystem.

## Packages

| Package | Description |
|---------|-------------|
| `@ifcdc/auth` | JWT authentication, password hashing, Express middleware |
| `@ifcdc/aura-ai` | AURA AI assistant (OpenAI integration) |
| `@ifcdc/notifications` | Email, SMS, push notifications |
| `@ifcdc/payments` | Stripe payment processing |
| `@ifcdc/ui-components` | Shared React UI utilities and brand constants |
| `@ifcdc/api-client` | Typed HTTP client for IFCDC APIs |
| `@ifcdc/database` | Drizzle ORM database utilities |

## Setup

```bash
cd Libraries/ifcdc-packages
npm install
npm run build
```

## Linking to Apps

```bash
# From an app directory
npm install ../../../Libraries/ifcdc-packages/packages/auth
```

Or use npm workspaces by adding to the app's `package.json`:

```json
{
  "dependencies": {
    "@ifcdc/auth": "file:../../../Libraries/ifcdc-packages/packages/auth"
  }
}
```
