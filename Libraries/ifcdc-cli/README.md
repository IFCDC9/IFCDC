# IFCDC CLI — App Generator

Scaffold new IFCDC applications in minutes using the standard architecture.

## Usage

```bash
cd Libraries/ifcdc-cli
node bin/create-ifcdc-app.mjs <app-name>

# Custom output directory
node bin/create-ifcdc-app.mjs my-app --dir ~/Development/IFCDC/Apps
```

## Generated Stack

Every new app includes:

- **React 19** + TypeScript + Vite 7 + Tailwind CSS 4
- **Express.js** + Drizzle ORM + PostgreSQL
- All **@ifcdc/** shared libraries pre-wired
- Health, auth, and AURA AI routes scaffolded
- `.env.example` with all service URLs

## Example

```bash
node bin/create-ifcdc-app.mjs wellness-platform
cd ../../Apps/wellness-platform
npm install
cp .env.example .env
npm run dev
```

New app ready in under 2 minutes.
