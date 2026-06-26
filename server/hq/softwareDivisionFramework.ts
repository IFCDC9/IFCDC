/**
 * IFCDC Software Division — Enterprise Integration Framework
 *
 * Every IFCDC application inherits Headquarters services while remaining
 * independently deployable. Apps register in appRegistry.ts and consume
 * these shared endpoints via JWT (same auth cookie / Bearer token).
 */

import { SOFTWARE_DIVISION_APPS } from "./appRegistry";

export interface InheritedService {
  id: string;
  name: string;
  description: string;
  endpoint: string;
  scopes: string[];
}

export interface AppIntegrationContract {
  appId: string;
  appName: string;
  status: string;
  locked: boolean;
  independentlyDeployable: true;
  inheritedServices: string[];
  integrationEndpoints: {
    auth: string;
    validateToken: string;
    people: string;
    finance: string;
    analytics: string;
    notifications: string;
    aura: string;
    health: string;
    register: string;
  };
  requiredHeaders: string[];
  analyticsWebhook?: string;
}

export const HQ_INHERITED_SERVICES: InheritedService[] = [
  { id: "auth", name: "Enterprise Authentication", description: "Single login, JWT, RBAC across all IFCDC apps", endpoint: "/api/hq/auth", scopes: ["login", "validate", "roles"] },
  { id: "people", name: "People Database", description: "Master people records for employees, volunteers, clients, and all person types", endpoint: "/api/hq/people", scopes: ["read", "write", "search", "sync"] },
  { id: "finance", name: "Financial Engine", description: "GL, budgets, payroll, donations, AP/AR, and audit", endpoint: "/api/hq/finance", scopes: ["read", "write", "reporting"] },
  { id: "grants", name: "Grant Center", description: "Grant lifecycle integrated with finance", endpoint: "/api/hq/grants", scopes: ["read", "write", "compliance"] },
  { id: "analytics", name: "Organization Analytics", description: "Cross-org KPIs, trends, forecasting, and executive reports", endpoint: "/api/hq/analytics", scopes: ["overview", "kpi", "reports", "export"] },
  { id: "operations", name: "Operations Modules", description: "Housing, scholarships, fleet, facilities, board, compliance, calendar", endpoint: "/api/hq/operations", scopes: ["read", "write"] },
  { id: "notifications", name: "Enterprise Notifications", description: "Unified alerts, compliance reminders, and broadcasts", endpoint: "/api/hq/notifications/broadcast", scopes: ["read", "send"] },
  { id: "aura", name: "AURA AI", description: "Executive assistant, report summaries, and strategic recommendations", endpoint: "/api/hq/aura/chat", scopes: ["chat", "summarize", "recommend", "forecast"] },
  { id: "enterprise", name: "Enterprise Hub", description: "Global search, module registry, and activity feed", endpoint: "/api/hq/enterprise", scopes: ["search", "modules", "overview"] },
];

const BASE_INTEGRATION = {
  auth: "/api/hq/auth",
  validateToken: "/api/hq/auth/verify",
  people: "/api/hq/people",
  finance: "/api/hq/finance",
  analytics: "/api/hq/analytics",
  notifications: "/api/hq/enterprise/notifications",
  aura: "/api/hq/aura/chat",
  health: "/api/hq/health",
  register: "/api/hq/software-division/register",
};

export function buildSoftwareDivisionFramework() {
  const apps: AppIntegrationContract[] = SOFTWARE_DIVISION_APPS.map((app) => ({
    appId: app.id,
    appName: app.name,
    status: app.status,
    locked: app.locked ?? false,
    independentlyDeployable: true as const,
    inheritedServices: HQ_INHERITED_SERVICES.map((s) => s.id),
    integrationEndpoints: {
      ...BASE_INTEGRATION,
      health: app.healthUrl,
    },
    requiredHeaders: ["Authorization: Bearer <jwt>", "X-IFCDC-App-Id: " + app.id],
    analyticsWebhook: app.reportsAnalytics ? `${app.launchUrl?.replace(/\/$/, "")}/api/analytics/overview` : undefined,
  }));

  return {
    platform: "IFCDC Headquarters Enterprise Operating System",
    version: "2.1.0",
    principles: [
      "One enterprise login across all applications",
      "One people database shared by every module",
      "One financial engine for all revenue and expenses",
      "One analytics platform for organization-wide intelligence",
      "One AURA AI layer for executive decision support",
      "Each app remains independently deployable",
      "Production-locked apps (Barbers) are never modified via HQ integration",
    ],
    inheritedServices: HQ_INHERITED_SERVICES,
    apps,
    barbersProductionLocked: true,
    timestamp: new Date().toISOString(),
  };
}
