import { enterpriseGlobalSearch, type EnterpriseSearchResult } from "./enterpriseHub";

const MODULE_ROUTES: { keywords: string[]; path: string; label: string }[] = [
  { keywords: ["executive dashboard", "dashboard", "command center", "home"], path: "/hq", label: "Executive Dashboard" },
  { keywords: ["finance", "financial", "financial center", "ledger", "general ledger", "accounts payable", "accounts receivable", "budget", "invoice", "payroll"], path: "/hq/finance", label: "Financial Center" },
  { keywords: ["grant", "grants", "funder", "compliance deadline", "award"], path: "/hq/grants", label: "Grant Center" },
  { keywords: ["knowledge base", "knowledge", "institutional memory", "grant writer memory"], path: "/hq/knowledge", label: "AURA Knowledge Base" },
  { keywords: ["people", "hr", "human resources", "employee", "volunteer", "onboarding", "certification"], path: "/hq/people", label: "People Management" },
  { keywords: ["intelligence", "analytics", "warehouse", "kpi", "forecast"], path: "/hq/intelligence", label: "Enterprise Intelligence" },
  { keywords: ["aura", "ai assistant", "copilot"], path: "/hq/aura", label: "AURA Command Center" },
  { keywords: ["security", "mfa", "backup", "session", "threat"], path: "/hq/security", label: "Security Center" },
  { keywords: ["integration", "integrations", "quickbooks", "oauth", "paypal"], path: "/hq/integrations", label: "Integrations Hub" },
  { keywords: ["communication", "communications", "email", "sms", "twilio", "broadcast"], path: "/hq/communications", label: "Communications Center" },
  { keywords: ["workflow", "approval", "automation"], path: "/hq/workflows", label: "Workflow Automation" },
  { keywords: ["document", "documents", "file"], path: "/hq/documents", label: "Document Management" },
  { keywords: ["program", "community program"], path: "/hq/programs", label: "Community Programs" },
  { keywords: ["donation", "donations", "fundraising"], path: "/hq/donations", label: "Donations" },
  { keywords: ["board", "governance"], path: "/hq/board", label: "Board Portal" },
  { keywords: ["compliance", "risk", "policy"], path: "/hq/compliance", label: "Compliance & Risk" },
  { keywords: ["software", "barbers", "application", "app division"], path: "/hq/software", label: "Software Division" },
  { keywords: ["calendar", "event", "schedule meeting"], path: "/hq/calendar", label: "Organization Calendar" },
  { keywords: ["notification", "alert"], path: "/hq/notifications", label: "Notifications" },
  { keywords: ["setting", "settings", "organization config"], path: "/hq/settings", label: "Organization Settings" },
];

export function parseNavigationIntent(query: string): { path: string; label: string; confidence: "high" | "medium" } | null {
  const q = query.toLowerCase().trim();
  if (!q) return null;

  const openPatterns = [
    /^(?:go to|open|show|navigate to|take me to)\s+(?:the\s+)?(.+)$/i,
    /^(.+)\s+(?:page|module|center)$/i,
  ];
  let target = q;
  for (const pat of openPatterns) {
    const m = q.match(pat);
    if (m?.[1]) { target = m[1].trim(); break; }
  }

  for (const route of MODULE_ROUTES) {
    if (route.keywords.some((k) => target.includes(k) || q.includes(k))) {
      return { path: route.path, label: route.label, confidence: target === q ? "medium" : "high" };
    }
  }
  return null;
}

export async function auraNavigate(query: string): Promise<{
  intent: "navigate" | "search" | "unknown";
  path?: string;
  label?: string;
  results?: EnterpriseSearchResult[];
  message: string;
}> {
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    return { intent: "unknown", message: "Please provide a module name or search term." };
  }

  const nav = parseNavigationIntent(trimmed);
  if (nav) {
    return {
      intent: "navigate",
      path: nav.path,
      label: nav.label,
      message: `Opening ${nav.label}.`,
    };
  }

  const results = await enterpriseGlobalSearch(trimmed);
  if (results.length > 0) {
    return {
      intent: "search",
      results: results.slice(0, 8),
      path: results[0].path,
      label: results[0].title,
      message: `Found ${results.length} result(s). Top match: ${results[0].title}.`,
    };
  }

  return { intent: "unknown", message: "No matching modules or records found. Try people names, grant titles, or module names like Finance or Grants." };
}
