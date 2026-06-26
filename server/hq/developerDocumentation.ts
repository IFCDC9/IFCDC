/** Structured developer documentation served to the Developer Portal and SDK */

export const SDK_VERSION = "1.3.0";
export const PLATFORM_VERSION = "2.1.0";

export const IMPLEMENTATION_EXAMPLES = [
  {
    id: "full-app",
    title: "Complete App Integration",
    language: "typescript",
    code: `import { createHeadquartersClient } from "@ifcdc/headquarters-sdk";

const hq = createHeadquartersClient({
  baseUrl: process.env.IFCDC_HQ_BASE_URL!,
  appId: process.env.IFCDC_APP_ID!,
  token: process.env.IFCDC_HQ_TOKEN,
});

// Auth — inherit enterprise login
const session = await hq.auth.session();

// People — one people database
const employees = await hq.people.list({ type: "employee" });

// Finance & Grants — never rebuild these
const finance = await hq.finance.overview();
const grants = await hq.grants.overview();

// Analytics & AURA
const analytics = await hq.analytics.overview();
const insight = await hq.aura.chat("Summarize organization health");

// Real-time updates
const ws = new WebSocket(hq.realtimeUrl());
ws.onmessage = (e) => {
  const { type, data } = JSON.parse(e.data);
  if (type === "update") syncFromHQ(data);
};`,
  },
  {
    id: "express-middleware",
    title: "Express.js HQ Auth Middleware",
    language: "typescript",
    code: `import { createHeadquartersClient } from "@ifcdc/headquarters-sdk";

const hq = createHeadquartersClient({
  baseUrl: process.env.IFCDC_HQ_BASE_URL!,
  appId: process.env.IFCDC_APP_ID!,
  token: process.env.IFCDC_HQ_TOKEN,
});

export async function hqAuthMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "HQ auth required" });
  hq.setToken(token);
  const verified = await hq.auth.verify();
  if (!verified.valid) return res.status(401).json({ error: "Invalid HQ token" });
  req.hqUser = verified;
  next();
}`,
  },
  {
    id: "react-provider",
    title: "React App with HQ Session",
    language: "typescript",
    code: `// Fetch HQ session on app load — single sign-on
const session = await fetch("/api/hq/auth/session", { credentials: "include" });
const { user } = await session.json();

// User inherits permissions from Headquarters
// No local auth rebuild needed`,
  },
];

export function buildDeveloperDocumentation() {
  return {
    platform: "IFCDC Headquarters Enterprise Operating System",
    platformVersion: PLATFORM_VERSION,
    sdk: {
      package: "@ifcdc/headquarters-sdk",
      version: SDK_VERSION,
      install: "npm install @ifcdc/headquarters-sdk",
      quickStart: `import { createHeadquartersClient } from "@ifcdc/headquarters-sdk";

const hq = createHeadquartersClient({
  baseUrl: process.env.IFCDC_HQ_BASE_URL!,
  appId: process.env.IFCDC_APP_ID!,
  token: process.env.IFCDC_HQ_TOKEN,
});

const session = await hq.auth.session();
const analytics = await hq.analytics.overview();`,
    },
    versioning: {
      policy: "Semantic versioning for @ifcdc/headquarters-sdk",
      current: SDK_VERSION,
      platform: PLATFORM_VERSION,
      compatibility: {
        "1.0.x": "Initial SDK — auth, analytics, aura, notifications",
        "1.1.x": "Onboarding API, event-driven WebSocket, role templates",
        "1.2.x": "Quick register, diagnostics API, compatibility matrix, env provisioning",
        "1.3.x": "Environment validation, credential rotation, audit logging, SDK setup scripts, sample projects",
      },
      breakingChanges: "Major version bumps require HQ platform migration window announced via Software Division",
    },
    security: {
      requiredHeaders: [
        "Authorization: Bearer <jwt-or-api-key>",
        "X-IFCDC-App-Id: <registered-app-id>",
        "Content-Type: application/json",
      ],
      apiKeys: {
        format: "ifcdc_<app-id>_<secret>",
        storage: "Store in environment variables — never commit to source control",
        rotation: "Rotate via POST /api/hq/developer/apps/:id/rotate-key in Developer Portal Credentials tab",
      },
      transport: "HTTPS required in production. WebSocket uses WSS.",
      barbersProductionLocked: true,
      rbac: "All endpoints enforce HQ RBAC — apps inherit user permissions from HQ session",
    },
    integrationGuides: [
      {
        id: "auth",
        title: "Authentication",
        steps: [
          "User logs in through Headquarters (single sign-on)",
          "App receives JWT via cookie or Bearer token",
          "Call POST /api/hq/auth/verify to validate and get permissions",
          "Use hq.auth.session() from SDK for full enterprise session",
        ],
        example: `const verified = await hq.auth.verify();
if (verified.valid) {
  console.log(verified.role, verified.permissions);
}`,
      },
      {
        id: "people",
        title: "People & HR",
        steps: [
          "Use GET /api/hq/people for master people records",
          "Set source_app header to your app ID when creating records",
          "HR changes push real-time WebSocket updates to all dashboards",
        ],
        example: `const { people } = await hq.people.list({ type: "employee" });`,
      },
      {
        id: "finance",
        title: "Finance",
        steps: [
          "Read financial overview via hq.finance.overview()",
          "Do not duplicate GL — post through HQ finance endpoints",
          "Finance mutations trigger instant dashboard updates via WebSocket",
        ],
        example: `const finance = await hq.finance.overview();`,
      },
      {
        id: "realtime",
        title: "Real-Time Updates",
        steps: [
          "Connect to WS /api/hq/ws with HQ session cookie or ?token=<jwt>",
          "Listen for type: 'update' messages (event-driven, not polling)",
          "Initial type: 'snapshot' sent on connect",
          "Fallback sync every 5 minutes only when idle",
        ],
        example: `const ws = new WebSocket(hq.realtimeUrl());
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.type === "update") refreshUI(msg.data, msg.domain);
};`,
      },
      {
        id: "onboard",
        title: "Application Onboarding",
        steps: [
          "Complete the Developer Portal onboarding wizard",
          "Receive app ID and API key (shown once)",
          "Install SDK and configure environment variables",
          "App appears automatically in Software Division dashboard",
        ],
        endpoint: "POST /api/hq/developer/onboard",
      },
    ],
    barbersBenchmark: {
      locked: true,
      message: "IFCDC Barbers App is production locked. Use as integration reference — do not modify via HQ.",
    },
    sampleProjects: [
      {
        id: "music-app",
        name: "IFCDC Music",
        description: "Streaming platform inheriting auth, analytics, and AURA from Headquarters",
        stack: "React + Express + @ifcdc/headquarters-sdk",
        setupSteps: [
          "Register via Developer Portal one-click template",
          "Run setup script: bash setup-ifcdc-hq.sh",
          "Configure .env.local with provisioned API key",
          "Run environment validation before deploy",
        ],
        repoPath: "Apps/IFCDC-Music (planned)",
      },
      {
        id: "radio-app",
        name: "IFCDC Radio",
        description: "Live broadcast platform with HQ notifications and enterprise reporting",
        stack: "React + Node + @ifcdc/headquarters-sdk",
        setupSteps: [
          "Quick-register with radio-app template",
          "Install SDK: npm install @ifcdc/headquarters-sdk",
          "Connect WebSocket for real-time listener analytics",
        ],
        repoPath: "Apps/IFCDC-Radio (planned)",
      },
      {
        id: "tapis-app",
        name: "IFCDC Tapis",
        description: "Marketplace platform with finance and grants integration",
        stack: "Next.js + @ifcdc/headquarters-sdk",
        setupSteps: [
          "Register and download .env from Developer Portal",
          "Use hq.finance.overview() — never duplicate GL",
          "Validate environment before production deploy",
        ],
        repoPath: "Apps/IFCDC-Tapis (planned)",
      },
      {
        id: "barbers-reference",
        name: "IFCDC Barbers App (Reference)",
        description: "Production-locked gold-standard reference — study integration patterns only",
        stack: "React + Express + HQ SDK v1.0+",
        setupSteps: [
          "Do not modify — use as benchmark",
          "Compare your app's HQ integration against Barbers patterns",
          "All new apps inherit the same enterprise services via SDK",
        ],
        repoPath: "Apps/IFCDC-Barbers (production locked)",
      },
    ],
    implementationExamples: IMPLEMENTATION_EXAMPLES,
    timestamp: new Date().toISOString(),
  };
}
