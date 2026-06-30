import type { LucideIcon } from "lucide-react";
import {
  ClipboardList, FileText, TrendingUp, PenLine, Handshake, Calendar,
  Upload, Wallet, Shield, BarChart3,
} from "lucide-react";

/** Canonical Grant Center tabs (Sprint 3 consolidation). */
export type GrantTab =
  | "overview"
  | "discover"
  | "pipeline"
  | "applications"
  | "funders"
  | "calendar"
  | "documents"
  | "finance"
  | "compliance"
  | "intelligence";

export const GRANT_TABS: { id: GrantTab; label: string; icon: LucideIcon }[] = [
  { id: "overview", label: "Executive Dashboard", icon: ClipboardList },
  { id: "discover", label: "Opportunity Finder", icon: FileText },
  { id: "pipeline", label: "Funding Pipeline", icon: TrendingUp },
  { id: "applications", label: "Applications & Writing", icon: PenLine },
  { id: "funders", label: "Partner CRM", icon: Handshake },
  { id: "calendar", label: "Calendar & Deadlines", icon: Calendar },
  { id: "documents", label: "Documents Vault", icon: Upload },
  { id: "finance", label: "Awards & Finance", icon: Wallet },
  { id: "compliance", label: "Compliance & Reports", icon: Shield },
  { id: "intelligence", label: "Analytics & AI", icon: BarChart3 },
];

/** Legacy tab URLs from pre–Sprint 3 bookmarks still resolve. */
const TAB_ALIASES: Record<string, GrantTab> = {
  opportunities: "discover",
  "writer-studio": "applications",
  library: "applications",
  deadlines: "calendar",
  notifications: "calendar",
  awards: "finance",
  budgets: "finance",
  "funder-reports": "compliance",
  analytics: "intelligence",
  "ai-intelligence": "intelligence",
  history: "intelligence",
  divisions: "intelligence",
};

export function resolveGrantTab(raw: string | null | undefined): GrantTab {
  if (!raw) return "overview";
  if (GRANT_TABS.some((t) => t.id === raw)) return raw as GrantTab;
  return TAB_ALIASES[raw] ?? "overview";
}

export function grantTabIncludes(tab: GrantTab, ...legacyIds: string[]): boolean {
  if (legacyIds.some((id) => tab === resolveGrantTab(id))) return true;
  return legacyIds.some((id) => TAB_ALIASES[id] === tab);
}
