/**
 * IFCDC Headquarters — Division Connector Registry
 * Software Division, Economic Development, and Case Management HQ connectors.
 */
import { buildSoftwareDivisionFramework } from "./softwareDivisionFramework";
import { SOFTWARE_DIVISION_APPS } from "./appRegistry";

export interface DivisionConnector {
  id: string;
  name: string;
  divisionType: "software_app" | "hq_module" | "program";
  status: "live" | "beta" | "development";
  independentlyDeployable: boolean;
  inheritedServices: string[];
  integrationEndpoints: Record<string, string>;
  reportingPath: string;
  description: string;
}

const BASE_HQ_ENDPOINTS = {
  auth: "/api/hq/auth/verify",
  people: "/api/hq/people",
  analytics: "/api/hq/analytics/overview",
  reporting: "/api/hq/reporting/catalog",
  notifications: "/api/hq/enterprise/notifications",
  divisions: "/api/hq/intelligence/divisions",
};

export function buildSoftwareDivisionConnectors(): DivisionConnector[] {
  const framework = buildSoftwareDivisionFramework();
  return SOFTWARE_DIVISION_APPS.map((app) => ({
    id: app.id,
    name: app.name,
    divisionType: "software_app" as const,
    status: app.status === "mvp" ? "beta" as const : (app.status as DivisionConnector["status"]),
    independentlyDeployable: true,
    inheritedServices: framework.inheritedServices.map((s) => s.id),
    integrationEndpoints: {
      ...BASE_HQ_ENDPOINTS,
      health: app.healthUrl,
      launch: app.launchUrl || "",
      analyticsWebhook: "/api/hq/intelligence/webhooks/analytics/" + app.id,
    },
    reportingPath: "/hq/software",
    description: app.description || `${app.name} — Software Division application`,
  }));
}

export function buildEconomicDevelopmentConnector(): DivisionConnector {
  return {
    id: "economic_development",
    name: "Economic Development",
    divisionType: "program",
    status: "live",
    independentlyDeployable: true,
    inheritedServices: ["auth", "people", "grants", "analytics", "programs", "clients"],
    integrationEndpoints: {
      ...BASE_HQ_ENDPOINTS,
      program: "/api/hq/programs/economic-development",
      grants: "/api/hq/grants/funding-engine/v5/programs",
      clients: "/api/hq/clients?program=ECON_DEV",
      analyticsWebhook: "/api/hq/intelligence/webhooks/analytics/economic_development",
    },
    reportingPath: "/hq/programs/economic-development",
    description: "Workforce development, job training, and small business support — integrated with Grant Center and Client & Case Management.",
  };
}

export function buildCaseManagementConnector(): DivisionConnector {
  return {
    id: "case_management",
    name: "Client & Case Management",
    divisionType: "hq_module",
    status: "live",
    independentlyDeployable: false,
    inheritedServices: ["auth", "people", "analytics", "notifications", "reporting"],
    integrationEndpoints: {
      ...BASE_HQ_ENDPOINTS,
      clients: "/api/hq/clients",
      overview: "/api/hq/clients/overview",
      executiveSummary: "/api/hq/clients/executive-summary",
      legacyApi: "/api/clients",
    },
    reportingPath: "/hq/clients",
    description: "Enterprise client registry, case assignments, goals, assessments, and appointments — unified HQ auth and executive reporting.",
  };
}

export function buildDivisionConnectorManifest() {
  return {
    softwareDivision: buildSoftwareDivisionConnectors(),
    economicDevelopment: buildEconomicDevelopmentConnector(),
    caseManagement: buildCaseManagementConnector(),
    headquartersRole: "unified_auth_permissions_database_reporting",
    timestamp: new Date().toISOString(),
  };
}
