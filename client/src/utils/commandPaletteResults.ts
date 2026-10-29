import type { EnterpriseSearchResult } from "../api/enterpriseApi";

/** Navigation is searchable even before the remote index responds, or if it fails. */
export function commandPaletteResults(query: string,
  nav: Array<{ path: string; label: string; section: string }>,
  remote: EnterpriseSearchResult[] = []): EnterpriseSearchResult[] {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const matches = terms.length ? nav.filter((n) => terms.every((t) => `${n.label} ${n.section} ${n.path}`.toLowerCase().includes(t))) : nav.slice(0, 8);
  const local: EnterpriseSearchResult[] = matches.map((n) => ({ type: "module", id: n.path, title: n.label, subtitle: n.section, path: n.path }));
  const paths = new Set(local.map((n) => n.path));
  return [...local, ...remote.filter((r) => !((r.type === "module" || r.type === "page") && paths.has(r.path)))].slice(0, 30);
}
