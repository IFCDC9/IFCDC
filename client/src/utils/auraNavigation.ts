/** Detect natural-language HQ navigation commands (mirrors server parseNavigationIntent prefixes). */
export function isAuraNavigationQuery(text: string): boolean {
  const q = text.trim().toLowerCase();
  if (!q) return false;
  return /^(go to|open|show|navigate to|take me to)\s+/.test(q);
}

/** Detect grant discovery / matching commands for AURA routing. */
export function isGrantAuraQuery(text: string): boolean {
  const q = text.trim().toLowerCase();
  if (!q) return false;
  return (
    /\bgrant\b|\bfunding\b|\bfunder\b|grants\.gov|\brfp\b|\bnofo\b|find grant|search grant|discover grant/.test(q)
    || /transitional housing|anti.?gang|workforce|scholarship|staffing|hiring|software division|technology infrastructure|community outreach/.test(q)
    || /whole ifcdc|entire organization|all program|every program|org.?wide|organization.?wide/.test(q)
    || /rank.*grant|due soon|start application|top five|top 5|draft.*grant|founder approval/.test(q)
  );
}

export const AURA_NAV_SUGGESTIONS = [
  "What should I prioritize this week as IFCDC founder?",
  "Find grants for the whole IFCDC project",
  "Find grants for HR and staffing",
  "Show grants due soon",
  "Rank all grants by best fit",
  "Go to Grant Center",
  "Go to Financial Center",
  "Open Communications",
] as const;
