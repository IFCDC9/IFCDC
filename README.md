# IFCDC Headquarters

**Imperial Foundation CDC (IFCDC)** — enterprise operating system for nonprofit headquarters operations, community programs, grant management, finance, and the IFCDC Software Division app portfolio.

- **Frontend:** React 19 + Vite + TypeScript (HQ portal at `/hq`)
- **Backend:** Express + SQLite (primary runtime database)
- **Node:** 20+

---

## Local Setup

### Prerequisites

- [Node.js](https://nodejs.org/) **20 or later** (see `.nvmrc`)
- npm (included with Node.js)

### 1. Clone and install dependencies

```bash
git clone https://github.com/IFCDC9/IFCDC.git
cd IFCDC
npm install
```

### 2. Create your local environment file

Copy the committed template to a private `.env` file in the repository root:

```bash
cp .env.example .env
```

`.env` is gitignored and must never be committed. Only `.env.example` (with placeholders) belongs in version control.

### 3. Configure required environment variables

Open `.env` and replace placeholder values with your own configuration.

#### Minimum for local development

These variables are enough to start the dev server and log in:

| Variable | Description |
|----------|-------------|
| `NODE_ENV` | Set to `development` for local work |
| `PORT` | Local server port (default: `5000`) |
| `JWT_SECRET` | Any long random string for signing session tokens locally |
| `MASTER_OWNER_EMAIL` | Email for the founder account created on first startup |
| `FOUNDER_SEED_PASSWORD` | Password for the founder account (change after first login) |
| `PUBLIC_APP_URL` | Local app URL, e.g. `http://localhost:5000` |
| `PUBLIC_BASE_URL` | Usually the same as `PUBLIC_APP_URL` locally |

#### Required for production (Render, etc.)

Set strong, unique values for every `[REQUIRED]` variable documented in `.env.example`:

| Variable | Description |
|----------|-------------|
| `NODE_ENV` | Must be `production` |
| `JWT_SECRET` | Cryptographically strong secret — never use dev placeholders |
| `MASTER_OWNER_EMAIL` | Founder login email |
| `FOUNDER_SEED_PASSWORD` | Strong initial founder password |
| `PUBLIC_APP_URL` | Public HTTPS URL of your deployment |
| `PUBLIC_BASE_URL` | Public HTTPS base URL for callbacks |

#### Optional integrations

Enable features by setting the corresponding variables in `.env`. See `.env.example` for the full list, including:

- **AURA AI:** `OPENAI_API_KEY`
- **Email:** `RESEND_API_KEY`, `RESEND_FROM_EMAIL`
- **SMS:** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_SMS_FROM`, `TWILIO_VOICE_FROM`
- **Payments:** `STRIPE_SECRET_KEY`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`
- **Grant feeds:** `GRANTS_GOV_SEARCH_KEYWORD` (public search2 — no key), `SAM_GOV_API_KEY`, `SAM_GOV_UEI`
- **Google login:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- **Software Division apps:** `HQ_*_LAUNCH_URL`, `HQ_*_HEALTH_URL`

Leave optional variables commented out or unset if you are not using that integration.

### 4. Start the development server

```bash
npm run dev
```

The app serves the React client and Express API together. Open:

- **HQ Portal:** [http://localhost:5000/hq](http://localhost:5000/hq)
- **Login:** [http://localhost:5000/login](http://localhost:5000/login)
- **Health check:** [http://localhost:5000/api/health](http://localhost:5000/api/health)

Log in with the `MASTER_OWNER_EMAIL` and `FOUNDER_SEED_PASSWORD` values from your `.env` file.

### 5. Build for production (optional local test)

```bash
npm run build
npm start
```

### 6. Run verification scripts (optional)

Readiness and audit scripts read from your environment (including `IFCDC_BASE_URL`, `MASTER_OWNER_EMAIL`, and `FOUNDER_SEED_PASSWORD`):

```bash
npm run check              # TypeScript type check
npm run platform:audit     # End-to-end platform smoke audit
npm run grants:qa          # Grant Center QA
```

Point `IFCDC_BASE_URL` in `.env` at your running server before running audits locally.

---

## Project Structure

```
├── client/              # React HQ portal and legacy admin UI
├── server/              # Express API, HQ domain engines, middleware
├── shared/              # Shared Zod schemas
├── Libraries/ifcdc-packages/  # Internal @ifcdc/* SDK packages
├── script/              # Build, audit, and readiness scripts
├── public/              # Legacy static public site
├── data/                # SQLite database (gitignored, created at runtime)
├── render.yaml          # Render.com deployment blueprint
└── .env.example         # Environment variable template (copy to .env)
```

---

## Deployment

Production deployment is configured for [Render](https://render.com) via `render.yaml`. Set environment variables in the Render dashboard to match the production sections in `.env.example`.

---

## Internal Packages

See [Libraries/ifcdc-packages/README.md](Libraries/ifcdc-packages/README.md) for the `@ifcdc/headquarters-sdk` and related package documentation.
