/**
 * AURA MUSIC — Sampling workspace data from real IFCDC Music Library assets.
 * No demo/fake content — filesystem + mastery status only.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { homedir } from "os";
import { join, basename, extname } from "path";

const MUSIC_ROOT = join(homedir(), "Music", "IFCDC-MUSIC");
const LIBRARY = join(MUSIC_ROOT, "library");
const SIGNATURE_HSS = join(LIBRARY, "Signature Sounds", "Hard Street Soul");
const SAMPLE_RIGHTS = join(LIBRARY, "sample-rights");
const ORIGINALS = join(LIBRARY, "originals");
const EXPORTS = join(MUSIC_ROOT, "exports");
const MASTERY = join(MUSIC_ROOT, "mastery");

export interface SamplingAsset {
  id: string;
  name: string;
  category: string;
  path: string;
  modifiedAt: string;
  sizeBytes: number;
  rightsId?: string | null;
  sourceType?: string | null;
  production?: string | null;
  tags?: string[];
}

export interface SamplingWorkspace {
  ok: boolean;
  generatedAt: string;
  level7: {
    complete: boolean;
    mastered: number;
    total: number;
    gate: string | null;
  };
  overallMasteryPercent: number | null;
  areas: {
    id: string;
    label: string;
    count: number;
    assets: SamplingAsset[];
  }[];
  rightsRecords: Array<{
    id: string;
    path: string;
    sourceType?: string;
    authorized?: boolean;
    production?: string;
  }>;
  hardStreetSoul: {
    catalogAssets: number;
    categories: string[];
  };
  message?: string;
}

function readJson<T>(path: string): T | null {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function safeStat(path: string) {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

function walkAudio(dir: string, maxDepth = 4, depth = 0): SamplingAsset[] {
  const out: SamplingAsset[] = [];
  if (!existsSync(dir) || depth > maxDepth) return out;
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    if (name.startsWith(".")) continue;
    const full = join(dir, name);
    const st = safeStat(full);
    if (!st) continue;
    if (st.isDirectory()) {
      out.push(...walkAudio(full, maxDepth, depth + 1));
      continue;
    }
    if (!/\.(wav|aif|aiff|mp3|flac)$/i.test(name)) continue;
    out.push({
      id: full.replace(/[^a-zA-Z0-9]+/g, "-").slice(-120),
      name,
      category: basename(dirnameCategory(full)),
      path: full,
      modifiedAt: st.mtime.toISOString(),
      sizeBytes: st.size,
    });
  }
  return out;
}

function dirnameCategory(fullPath: string): string {
  const rel = fullPath.replace(SIGNATURE_HSS, "").replace(LIBRARY, "");
  const parts = rel.split("/").filter(Boolean);
  if (parts.length >= 2) return parts[0];
  if (/originals/i.test(fullPath)) return "originals";
  if (/exports/i.test(fullPath)) return "exports";
  if (/vocals/i.test(fullPath)) return "vocals";
  return "library";
}

function categorizeAssets(all: SamplingAsset[]): SamplingWorkspace["areas"] {
  const buckets: Record<string, SamplingAsset[]> = {
    "sample-library": [],
    "one-shots": [],
    "drum-chops": [],
    "vocal-chops": [],
    loops: [],
    "resampled-assets": [],
    "warped-assets": [],
    "sliced-assets": [],
    "playable-instruments": [],
    "ifcdc-originals": [],
    "hard-street-soul": [],
  };

  for (const a of all) {
    const low = `${a.name} ${a.path}`.toLowerCase();
    if (/hard-street|sig-001|signature-sound|hss/i.test(low)) {
      buckets["hard-street-soul"].push(a);
    } else if (/original|mus-asset/i.test(low)) {
      buckets["ifcdc-originals"].push(a);
    } else if (/vocal|vox/i.test(low)) {
      buckets["vocal-chops"].push(a);
    } else if (/drum.?chop|chop|slice|transient/i.test(low)) {
      buckets["drum-chops"].push(a);
    } else if (/resample|bounce|recorded/i.test(low)) {
      buckets["resampled-assets"].push(a);
    } else if (/warp|stretch|reverse|l7/i.test(low)) {
      buckets["warped-assets"].push(a);
    } else if (/loop/i.test(low)) {
      buckets["loops"].push(a);
    } else if (/one.?shot|hit/i.test(low)) {
      buckets["one-shots"].push(a);
    } else if (/simpler|instrument|preset|\.adv$/i.test(low)) {
      buckets["playable-instruments"].push(a);
    } else {
      buckets["sample-library"].push(a);
    }
  }

  // Dedupe by path across buckets — prefer most specific
  const seen = new Set<string>();
  const areaDefs: { id: string; label: string; key: string }[] = [
    { id: "sample-library", label: "Sample Library", key: "sample-library" },
    { id: "one-shots", label: "One-Shots", key: "one-shots" },
    { id: "drum-chops", label: "Drum Chops", key: "drum-chops" },
    { id: "vocal-chops", label: "Vocal Chops", key: "vocal-chops" },
    { id: "loops", label: "Loops", key: "loops" },
    { id: "resampled-assets", label: "Resampled Assets", key: "resampled-assets" },
    { id: "warped-assets", label: "Warped Assets", key: "warped-assets" },
    { id: "sliced-assets", label: "Sliced Assets", key: "sliced-assets" },
    { id: "playable-instruments", label: "Playable Instruments", key: "playable-instruments" },
    { id: "ifcdc-originals", label: "IFCDC Original Samples", key: "ifcdc-originals" },
    { id: "hard-street-soul", label: "Hard Street Soul Samples", key: "hard-street-soul" },
  ];

  return areaDefs.map(({ id, label, key }) => {
    const assets = (buckets[key] || []).filter((a) => {
      if (seen.has(a.path)) return false;
      seen.add(a.path);
      return true;
    });
    return { id, label, count: assets.length, assets: assets.slice(0, 48) };
  });
}

function loadRightsRecords() {
  const records: SamplingWorkspace["rightsRecords"] = [];
  if (!existsSync(SAMPLE_RIGHTS)) return records;
  for (const name of readdirSync(SAMPLE_RIGHTS).filter((n) => n.endsWith(".rights.json"))) {
    const path = join(SAMPLE_RIGHTS, name);
    const raw = readJson<Record<string, unknown>>(path);
    if (!raw) continue;
    records.push({
      id: String(raw.assetId || name.replace(/\.rights\.json$/, "")),
      path,
      sourceType: raw.sourceType ? String(raw.sourceType) : undefined,
      authorized: raw.authorized === true,
      production: raw.production ? String(raw.production) : undefined,
    });
  }
  return records.sort((a, b) => a.id.localeCompare(b.id));
}

function loadCatalogMeta(): { catalogAssets: number; categories: string[] } {
  const catalogPath = join(SIGNATURE_HSS, "catalog.json");
  const catalog = readJson<{ assets?: unknown[] }>(catalogPath);
  if (!catalog?.assets) return { catalogAssets: 0, categories: [] };
  const categories = [
    ...new Set(
      (catalog.assets as Array<{ category?: string }>).map((a) => a.category).filter(Boolean) as string[]
    ),
  ];
  return { catalogAssets: catalog.assets.length, categories };
}

/** Build sampling workspace from local IFCDC-MUSIC library. */
export function getAuraMusicSamplingWorkspace(): SamplingWorkspace {
  const generatedAt = new Date().toISOString();
  const l7 = readJson<{ level7?: { complete?: boolean; mastered?: number; total?: number }; gate?: string; overallMasteryPercent?: number }>(
    join(MASTERY, "levels-7-status.json")
  );
  const l9 = readJson<{ overallMasteryPercent?: number }>(join(MASTERY, "levels-9-status.json"));

  const collected: SamplingAsset[] = [];
  for (const root of [SIGNATURE_HSS, ORIGINALS, join(SIGNATURE_HSS, "Vocals"), EXPORTS]) {
    if (existsSync(root)) collected.push(...walkAudio(root, 5));
  }

  // Attach rights metadata where filenames match
  const rights = loadRightsRecords();
  for (const a of collected) {
    const hit = rights.find((r) => a.path.includes(r.id) || a.name.includes(r.id));
    if (hit) {
      a.rightsId = hit.id;
      a.sourceType = hit.sourceType ?? null;
    }
  }

  if (!existsSync(MUSIC_ROOT)) {
    return {
      ok: false,
      generatedAt,
      level7: { complete: false, mastered: 0, total: 18, gate: null },
      overallMasteryPercent: null,
      areas: [],
      rightsRecords: [],
      hardStreetSoul: { catalogAssets: 0, categories: [] },
      message: "IFCDC-MUSIC library not found on this host",
    };
  }

  return {
    ok: true,
    generatedAt,
    level7: {
      complete: Boolean(l7?.level7?.complete),
      mastered: l7?.level7?.mastered ?? 0,
      total: l7?.level7?.total ?? 18,
      gate: l7?.gate ?? null,
    },
    overallMasteryPercent: l9?.overallMasteryPercent ?? l7?.overallMasteryPercent ?? null,
    areas: categorizeAssets(collected),
    rightsRecords: rights,
    hardStreetSoul: loadCatalogMeta(),
  };
}

/**
 * Prefer local Mac library; on cloud HQ fall back to production-node heartbeat snapshot.
 */
export async function getAuraMusicSamplingWorkspaceForHq(): Promise<SamplingWorkspace> {
  const local = getAuraMusicSamplingWorkspace();
  if (local.ok && local.areas.some((a) => a.count > 0)) return local;

  try {
    const { getPrimaryAuraMusicNodeSnapshot } = await import("./auraMusicProductionNode");
    const snap = await getPrimaryAuraMusicNodeSnapshot();
    const remote = (snap?.heartbeat as { samplingWorkspace?: SamplingWorkspace } | null)?.samplingWorkspace;
    if (remote && remote.ok) {
      return {
        ...remote,
        generatedAt: new Date().toISOString(),
        message: remote.message || "Sampling workspace from production-node heartbeat",
      };
    }
  } catch {
    /* fall through */
  }

  return local;
}
