/**
 * AURA Code Index Engine — metadata index of allowlisted IFCDC repositories.
 * Sources: GitHub Tree/Contents API and/or local AURA_SE_WORKSPACE_ROOT.
 * Never stores .env values or secret file bodies.
 */
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { getDb } from "../db";
import { ensureAuraSoftwareEngineeringTables } from "./auraSoftwareEngineeringSchema";
import {
  SE_MAX_INDEX_FILES,
  classifyFileKind,
  extractEnvNames,
  getAllowedRepos,
  getSeWorkspaceRoot,
  isPathAllowlisted,
  isPathDenied,
  redactSecrets,
  resolveAllowedRepo,
  type AllowedRepo,
} from "./auraSoftwareEngineeringPolicy";

const GITHUB_API = "https://api.github.com";

function githubToken(): string | null {
  const t = (process.env.GITHUB_TOKEN || "").trim();
  return t || null;
}

function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "IFCDC-Headquarters-AURA-SE",
  };
}

function idFor(repoId: string, branch: string, filePath: string): string {
  return crypto.createHash("sha1").update(`${repoId}|${branch}|${filePath}`).digest("hex").slice(0, 24);
}

function extractSymbols(content: string, filePath: string): string[] {
  const symbols = new Set<string>();
  const patterns = [
    /(?:export\s+(?:async\s+)?function|export\s+const|export\s+class|function|class)\s+([A-Za-z_][A-Za-z0-9_]*)/g,
    /(?:interface|type)\s+([A-Za-z_][A-Za-z0-9_]*)/g,
    /(?:router\.(?:get|post|put|patch|delete)|app\.(?:get|post|put|patch|delete))\(\s*["'`]([^"'`]+)["'`]/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      if (m[1]) symbols.add(m[1].slice(0, 80));
      if (symbols.size >= 40) break;
    }
  }
  if (filePath.endsWith("package.json")) {
    try {
      const pkg = JSON.parse(content) as { name?: string };
      if (pkg.name) symbols.add(pkg.name);
    } catch {
      /* ignore */
    }
  }
  return Array.from(symbols);
}

function extractPackageMeta(content: string): { deps: string[]; scripts: string[] } {
  try {
    const pkg = JSON.parse(content) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };
    const deps = [
      ...Object.keys(pkg.dependencies || {}),
      ...Object.keys(pkg.devDependencies || {}),
    ].slice(0, 120);
    const scripts = Object.keys(pkg.scripts || {}).slice(0, 40);
    return { deps, scripts };
  } catch {
    return { deps: [], scripts: [] };
  }
}

async function upsertIndexFile(row: {
  repoId: string;
  branch: string;
  path: string;
  kind: string;
  symbols: string[];
  deps: string[];
  envNames: string[];
  scripts: string[];
  sizeBytes: number;
  sha?: string | null;
}) {
  const db = await getDb();
  const now = new Date().toISOString();
  const id = idFor(row.repoId, row.branch, row.path);
  await db.run(
    `INSERT INTO aura_se_index_files (
      id, repo_id, branch, path, kind, symbols_json, deps_json, env_names_json, scripts_json, size_bytes, sha, indexed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(repo_id, branch, path) DO UPDATE SET
      kind = excluded.kind,
      symbols_json = excluded.symbols_json,
      deps_json = excluded.deps_json,
      env_names_json = excluded.env_names_json,
      scripts_json = excluded.scripts_json,
      size_bytes = excluded.size_bytes,
      sha = excluded.sha,
      indexed_at = excluded.indexed_at`,
    id,
    row.repoId,
    row.branch,
    row.path,
    row.kind,
    JSON.stringify(row.symbols),
    JSON.stringify(row.deps),
    JSON.stringify(row.envNames),
    JSON.stringify(row.scripts),
    row.sizeBytes,
    row.sha ?? null,
    now
  );
}

async function indexLocalFile(repo: AllowedRepo, absRoot: string, relPath: string): Promise<boolean> {
  if (!isPathAllowlisted(relPath, repo)) return false;
  const abs = path.join(absRoot, relPath);
  let content = "";
  let size = 0;
  try {
    const st = await fs.stat(abs);
    if (!st.isFile() || st.size > 400_000) return false;
    size = st.size;
    const base = path.basename(relPath);
    const isEnvExample = /\.env\.(example|sample|template)$/i.test(base) || base === ".env.example";
    const isPackage = base === "package.json";
    const isCode = /\.(ts|tsx|js|jsx|mjs|cjs|md|yml|yaml|json|sql)$/i.test(base);
    if (!isEnvExample && !isPackage && !isCode) {
      // Still index path metadata for deployment configs
      if (!/\.(ya?ml|toml|Dockerfile)$/i.test(base) && !base.includes("render")) return false;
    }
    if (isEnvExample || isPackage || isCode || base.includes("render") || /\.ya?ml$/i.test(base)) {
      content = await fs.readFile(abs, "utf8");
      content = redactSecrets(content);
    }
  } catch {
    return false;
  }

  const kind = classifyFileKind(relPath);
  const symbols = content ? extractSymbols(content, relPath) : [];
  let deps: string[] = [];
  let scripts: string[] = [];
  let envNames: string[] = [];
  if (relPath.endsWith("package.json") && content) {
    const meta = extractPackageMeta(content);
    deps = meta.deps;
    scripts = meta.scripts;
  }
  if (/\.env\.(example|sample|template)$/i.test(relPath) && content) {
    envNames = extractEnvNames(content);
    // Never keep values — content discarded after name extract
  }

  await upsertIndexFile({
    repoId: repo.id,
    branch: repo.defaultBranch,
    path: relPath.replace(/\\/g, "/"),
    kind,
    symbols,
    deps,
    envNames,
    scripts,
    sizeBytes: size,
  });
  return true;
}

async function walkLocal(repo: AllowedRepo, absRoot: string, relDir: string, budget: { left: number }): Promise<number> {
  if (budget.left <= 0) return 0;
  let counted = 0;
  const absDir = path.join(absRoot, relDir);
  let entries: { name: string; isDirectory: () => boolean; isFile: () => boolean }[] = [];
  try {
    entries = await fs.readdir(absDir, { withFileTypes: true }) as unknown as typeof entries;
  } catch {
    return 0;
  }
  for (const ent of entries) {
    if (budget.left <= 0) break;
    const rel = path.join(relDir, ent.name).replace(/\\/g, "/");
    if (isPathDenied(rel)) continue;
    if (ent.isDirectory()) {
      // Only descend into allowlisted prefixes or their parents
      const mayDescend = repo.pathPrefixes.some(
        (p) => p.startsWith(rel + "/") || rel.startsWith(p.replace(/\/$/, "")) || p.startsWith(rel)
      );
      if (!mayDescend && rel !== "" && !repo.pathPrefixes.some((p) => p.startsWith(rel))) continue;
      counted += await walkLocal(repo, absRoot, rel, budget);
    } else if (ent.isFile()) {
      const ok = await indexLocalFile(repo, absRoot, rel);
      if (ok) {
        budget.left -= 1;
        counted += 1;
      }
    }
  }
  return counted;
}

async function fetchGitHubTree(repo: AllowedRepo): Promise<{ path: string; sha: string; size?: number; type: string }[]> {
  const token = githubToken();
  if (!token) return [];
  const url = `${GITHUB_API}/repos/${repo.owner}/${repo.name}/git/trees/${encodeURIComponent(repo.defaultBranch)}?recursive=1`;
  const res = await fetch(url, { headers: githubHeaders(token), signal: AbortSignal.timeout(20_000) });
  if (!res.ok) return [];
  const body = (await res.json()) as { tree?: Array<{ path: string; sha: string; size?: number; type: string }> };
  return (body.tree || []).filter((t) => t.type === "blob");
}

async function fetchGitHubFileText(repo: AllowedRepo, filePath: string): Promise<string | null> {
  const token = githubToken();
  if (!token) return null;
  const url = `${GITHUB_API}/repos/${repo.owner}/${repo.name}/contents/${filePath.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(repo.defaultBranch)}`;
  const res = await fetch(url, { headers: githubHeaders(token), signal: AbortSignal.timeout(12_000) });
  if (!res.ok) return null;
  const body = (await res.json()) as { content?: string; encoding?: string; size?: number };
  if (!body.content || body.encoding !== "base64") return null;
  if ((body.size ?? 0) > 400_000) return null;
  try {
    return redactSecrets(Buffer.from(body.content, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

async function indexFromGitHub(repo: AllowedRepo, maxFiles: number): Promise<number> {
  const tree = await fetchGitHubTree(repo);
  let count = 0;
  const interesting = tree.filter((t) => {
    if (!isPathAllowlisted(t.path, repo)) return false;
    const base = t.path.split("/").pop() || "";
    return (
      /\.(ts|tsx|js|jsx|mjs|cjs|md|ya?ml|json|sql)$/i.test(base)
      || base === "package.json"
      || /\.env\.(example|sample|template)$/i.test(base)
      || /render\.ya?ml|dockerfile/i.test(base)
    );
  });

  for (const item of interesting.slice(0, maxFiles)) {
    const kind = classifyFileKind(item.path);
    let symbols: string[] = [];
    let deps: string[] = [];
    let scripts: string[] = [];
    let envNames: string[] = [];
    const base = item.path.split("/").pop() || "";
    const needsContent =
      base === "package.json"
      || /\.env\.(example|sample|template)$/i.test(base)
      || /\.(ts|tsx|js|jsx)$/i.test(base);

    if (needsContent && count < 400) {
      // Cap content fetches to avoid API rate limits
      const content = await fetchGitHubFileText(repo, item.path);
      if (content) {
        symbols = extractSymbols(content, item.path);
        if (base === "package.json") {
          const meta = extractPackageMeta(content);
          deps = meta.deps;
          scripts = meta.scripts;
        }
        if (/\.env\.(example|sample|template)$/i.test(base)) {
          envNames = extractEnvNames(content);
        }
      }
    }

    await upsertIndexFile({
      repoId: repo.id,
      branch: repo.defaultBranch,
      path: item.path,
      kind,
      symbols,
      deps,
      envNames,
      scripts,
      sizeBytes: item.size ?? 0,
      sha: item.sha,
    });
    count += 1;
  }
  return count;
}

export async function refreshCodeIndex(opts?: {
  repoId?: string;
  actorEmail?: string;
  preferLocal?: boolean;
}): Promise<{
  ok: boolean;
  source: "workspace" | "github" | "none";
  repos: Array<{ repoId: string; files: number }>;
  message: string;
}> {
  await ensureAuraSoftwareEngineeringTables();
  const db = await getDb();
  const now = new Date().toISOString();
  const repos = opts?.repoId
    ? ([resolveAllowedRepo(opts.repoId)].filter(Boolean) as AllowedRepo[])
    : getAllowedRepos().filter((r, i, arr) => arr.findIndex((x) => x.id === r.id) === i);

  // Deduplicate by id
  const unique = new Map<string, AllowedRepo>();
  for (const r of repos) unique.set(r.id, r);

  const workspace = getSeWorkspaceRoot();
  const useLocal = Boolean(workspace) && (opts?.preferLocal !== false);
  const results: Array<{ repoId: string; files: number }> = [];
  let source: "workspace" | "github" | "none" = "none";

  for (const repo of Array.from(unique.values())) {
    let files = 0;
    if (useLocal && workspace) {
      const budget = { left: Math.floor(SE_MAX_INDEX_FILES / Math.max(unique.size, 1)) };
      // Index from monorepo root; pathPrefixes are relative to workspace
      files = await walkLocal(repo, workspace, "", budget);
      // Also try each prefix directly if walk was sparse
      if (files < 10) {
        for (const prefix of repo.pathPrefixes) {
          files += await walkLocal(repo, workspace, prefix.replace(/\/$/, ""), budget);
        }
      }
      if (files > 0) source = "workspace";
    }
    if (files === 0 && githubToken()) {
      files = await indexFromGitHub(repo, Math.floor(SE_MAX_INDEX_FILES / Math.max(unique.size, 1)));
      if (files > 0) source = "github";
    }

    await db.run(
      `INSERT INTO aura_se_repos (id, owner, name, default_branch, label, path_prefixes_json, last_indexed_at, index_source, file_count, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         last_indexed_at = excluded.last_indexed_at,
         index_source = excluded.index_source,
         file_count = excluded.file_count,
         updated_at = excluded.updated_at,
         path_prefixes_json = excluded.path_prefixes_json`,
      repo.id,
      repo.owner,
      repo.name,
      repo.defaultBranch,
      repo.label,
      JSON.stringify(repo.pathPrefixes),
      now,
      source === "none" ? null : source,
      files,
      now,
      now
    );
    results.push({ repoId: repo.id, files });
  }

  return {
    ok: source !== "none",
    source,
    repos: results,
    message:
      source === "none"
        ? "No index source available. Set GITHUB_TOKEN and/or AURA_SE_WORKSPACE_ROOT."
        : `Indexed ${results.reduce((s, r) => s + r.files, 0)} files via ${source}.`,
  };
}

export async function searchCodeIndex(opts: {
  q?: string;
  kind?: string;
  repoId?: string;
  limit?: number;
}): Promise<Array<Record<string, unknown>>> {
  await ensureAuraSoftwareEngineeringTables();
  const db = await getDb();
  const limit = Math.min(opts.limit ?? 40, 100);
  const params: unknown[] = [];
  let sql = `SELECT repo_id, branch, path, kind, symbols_json, deps_json, env_names_json, scripts_json, size_bytes, indexed_at
             FROM aura_se_index_files WHERE 1=1`;
  if (opts.repoId) {
    sql += " AND repo_id = ?";
    params.push(opts.repoId);
  }
  if (opts.kind) {
    sql += " AND kind = ?";
    params.push(opts.kind);
  }
  if (opts.q?.trim()) {
    sql += " AND (path LIKE ? OR symbols_json LIKE ? OR deps_json LIKE ?)";
    const like = `%${opts.q.trim()}%`;
    params.push(like, like, like);
  }
  sql += " ORDER BY indexed_at DESC LIMIT ?";
  params.push(limit);
  const rows = (await db.all(sql, ...params)) as Record<string, unknown>[];
  return rows.map((r) => ({
    ...r,
    symbols: safeJson(r.symbols_json),
    dependencies: safeJson(r.deps_json),
    envNames: safeJson(r.env_names_json),
    scripts: safeJson(r.scripts_json),
  }));
}

function safeJson(v: unknown): unknown {
  if (typeof v !== "string") return v ?? [];
  try {
    return JSON.parse(v);
  } catch {
    return [];
  }
}

export async function getIndexStats(): Promise<{
  repos: Array<Record<string, unknown>>;
  totalFiles: number;
  workspaceConfigured: boolean;
  githubConfigured: boolean;
}> {
  await ensureAuraSoftwareEngineeringTables();
  const db = await getDb();
  const repos = (await db.all(`SELECT * FROM aura_se_repos ORDER BY label`)) as Record<string, unknown>[];
  const countRow = (await db.get(`SELECT COUNT(*) as c FROM aura_se_index_files`)) as { c: number };
  return {
    repos,
    totalFiles: Number(countRow?.c ?? 0),
    workspaceConfigured: Boolean(getSeWorkspaceRoot()),
    githubConfigured: Boolean(githubToken()),
  };
}
