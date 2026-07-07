/** Detect natural-language HQ navigation commands (mirrors server parseNavigationIntent prefixes). */
export function isAuraNavigationQuery(text: string): boolean {
  const q = text.trim().toLowerCase();
  if (!q) return false;
  return /^(go to|open|show|navigate to|take me to)\s+/.test(q);
}

export const AURA_NAV_SUGGESTIONS = [
  "What should I prioritize this week as IFCDC founder?",
  "How is our grant portfolio performing?",
  "Summarize our financial health",
  "Which Software Division apps need attention?",
  "Go to Financial Center",
  "Go to Grant Center",
  "Open Communications",
  "Open Software Division",
  "Open Integrations",
] as const;
