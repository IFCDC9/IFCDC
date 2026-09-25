/**
 * Searchable IFCDC PRODUCTIONS asset library.
 * Search-before-generate is mandatory for the planner.
 */
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync, readFileSync } from "fs";
import { homedir } from "os";
import { basename, extname, join } from "path";
import { stageBrandKit } from "../brand/kit.mjs";
import { readProductionKit } from "../brand/production-kit.mjs";
import { PRODUCTIONS_ROOT } from "../brand/production-identity.mjs";

const ROOT = join(homedir(), "Library/Application Support/IFCDC/aura-resolve");

export const LIBRARY_CATEGORIES = [
  "Founder",
  "IFCDC",
  "Barbers App",
  "Programs",
  "Youth",
  "Community",
  "Music",
  "Logos",
  "Branding",
  "Voice",
  "Sound Effects",
  "B-roll",
  "Generated Images",
  "Generated Video",
  "Finished Productions",
  "Templates",
];

const MEDIA_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".mov", ".m4a", ".mp3", ".wav", ".aac"]);

function safeList(dir, category, limit = 80) {
  if (!existsSync(dir)) return [];
  const out = [];
  const walk = (current, depth = 0) => {
    if (out.length >= limit || depth > 4) return;
    let entries = [];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= limit) break;
      if (entry.name.startsWith(".")) continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      const ext = extname(entry.name).toLowerCase();
      if (!MEDIA_EXT.has(ext) && !entry.name.endsWith(".json")) continue;
      let bytes = 0;
      try {
        bytes = statSync(full).size;
      } catch {
        bytes = 0;
      }
      out.push({
        name: entry.name,
        category,
        // Store basename-relative hint only in API responses; full path stays Mac-local.
        relativeHint: full.replace(ROOT + "/", ""),
        ext,
        bytes,
        path: full,
      });
    }
  };
  walk(dir);
  return out;
}

function categorizeBrandAsset(asset) {
  if (asset.role === "logo") return "Logos";
  if (asset.role === "music" || asset.role === "music-fallback") return "Music";
  if (asset.role === "broll") return "B-roll";
  if (asset.role === "app-store") return "Barbers App";
  return "IFCDC";
}

export function ensureLibraryRoots() {
  mkdirSync(PRODUCTIONS_ROOT, { recursive: true });
  const generatedImages = join(PRODUCTIONS_ROOT, "GENERATED_FOUNDER_MEDIA", "images");
  const generatedVideo = join(PRODUCTIONS_ROOT, "GENERATED_FOUNDER_MEDIA", "video");
  const originals = join(PRODUCTIONS_ROOT, "ORIGINAL_FOUNDER_MEDIA");
  for (const dir of [generatedImages, generatedVideo, originals]) mkdirSync(dir, { recursive: true });
  return { generatedImages, generatedVideo, originals };
}

/**
 * Build / refresh the searchable catalog from approved IFCDC trees only.
 * Does not scan the user's general Photos library.
 */
export function buildAssetLibraryIndex() {
  const roots = ensureLibraryRoots();
  const brand = stageBrandKit({ intoMedia: true });
  const kit = readProductionKit();
  const items = [];

  for (const asset of brand.staged || []) {
    if (!asset.mediaPath && !asset.source) continue;
    items.push({
      id: asset.id,
      name: asset.mediaName || basename(asset.mediaPath || asset.source),
      category: categorizeBrandAsset(asset),
      role: asset.role,
      label: asset.label,
      path: asset.mediaPath || asset.source,
      relativeHint: (asset.mediaPath || asset.source || "").replace(ROOT + "/", ""),
      source: "brand-kit",
    });
  }

  for (const item of kit.items || []) {
    if (!item.path && !item.mediaPath) continue;
    items.push({
      id: `kit-${item.role}-${item.format || "any"}`,
      name: basename(item.mediaPath || item.path),
      category: "Templates",
      role: item.role,
      label: item.role,
      path: item.mediaPath || item.path,
      relativeHint: (item.mediaPath || item.path || "").replace(ROOT + "/", ""),
      source: "production-kit",
    });
  }

  items.push(...safeList(roots.originals, "Founder").map((f) => ({ ...f, id: `orig-${f.name}`, source: "ORIGINAL_FOUNDER_MEDIA" })));
  items.push(...safeList(roots.generatedImages, "Generated Images").map((f) => ({ ...f, id: `gen-img-${f.name}`, source: "GENERATED_FOUNDER_MEDIA" })));
  items.push(...safeList(roots.generatedVideo, "Generated Video").map((f) => ({ ...f, id: `gen-vid-${f.name}`, source: "GENERATED_FOUNDER_MEDIA" })));
  items.push(...safeList(join(ROOT, "renders"), "Finished Productions").map((f) => ({ ...f, id: `render-${f.name}`, source: "renders" })));
  items.push(...safeList(join(PRODUCTIONS_ROOT, "TRAINING"), "Programs").map((f) => ({ ...f, id: `train-${f.name}`, source: "TRAINING" })));
  items.push(...safeList(join(PRODUCTIONS_ROOT, "PROGRAM-PROMOTIONS"), "Youth").map((f) => ({ ...f, id: `youth-${f.name}`, source: "PROGRAM-PROMOTIONS" })));

  // Keyword tags for Youth / Community / Programs from names
  for (const item of items) {
    const hay = `${item.name} ${item.label || ""} ${item.category}`.toLowerCase();
    if (/youth/.test(hay) && item.category === "IFCDC") item.category = "Youth";
    if (/community/.test(hay)) item.tags = [...(item.tags || []), "Community"];
    if (/voice|vo\b/.test(hay)) item.tags = [...(item.tags || []), "Voice"];
    if (/sfx|sound.?effect/.test(hay)) item.category = "Sound Effects";
    if (/brand|ifcdc/.test(hay) && item.category === "Logos") item.tags = [...(item.tags || []), "Branding"];
  }

  const index = {
    at: new Date().toISOString(),
    company: "IFCDC PRODUCTIONS",
    categories: LIBRARY_CATEGORIES,
    count: items.length,
    items: items.map(({ path, ...rest }) => ({ ...rest, path })), // keep path Mac-local for engine; HQ strips later
  };
  mkdirSync(PRODUCTIONS_ROOT, { recursive: true });
  writeFileSync(join(PRODUCTIONS_ROOT, "asset-library-index.json"), JSON.stringify({
    ...index,
    items: index.items.map(({ path, ...rest }) => rest),
  }, null, 2));
  return index;
}

/**
 * Real search used by the planner before any generate call.
 */
export function searchAssetLibrary(query = "", { category = null, limit = 40 } = {}) {
  const index = buildAssetLibraryIndex();
  const q = String(query || "").trim().toLowerCase();
  const cat = category ? String(category) : null;
  let results = index.items;
  if (cat) results = results.filter((item) => item.category === cat || (item.tags || []).includes(cat));
  if (q) {
    const tokens = q.split(/\s+/).filter(Boolean);
    results = results
      .map((item) => {
        const hay = `${item.name} ${item.label || ""} ${item.category} ${item.role || ""} ${(item.tags || []).join(" ")}`.toLowerCase();
        const hitCount = tokens.filter((token) => hay.includes(token)).length;
        return { item, hitCount };
      })
      .filter((row) => row.hitCount > 0)
      .sort((a, b) => b.hitCount - a.hitCount)
      .map((row) => row.item);
  }
  return {
    query: query || null,
    category: cat,
    searchedBeforeGenerate: true,
    totalIndexed: index.count,
    categories: LIBRARY_CATEGORIES,
    matches: results.slice(0, limit).map(({ path, ...rest }) => ({
      ...rest,
      available: true,
      // Do not expose deep private dumps; relative hint only for HQ.
      pathHint: rest.relativeHint || rest.name,
    })),
    localMatches: results.slice(0, limit), // engine-side with paths
  };
}

export function readAssetLibraryPublic() {
  const path = join(PRODUCTIONS_ROOT, "asset-library-index.json");
  if (!existsSync(path)) {
    const built = buildAssetLibraryIndex();
    return {
      at: built.at,
      count: built.count,
      categories: built.categories,
      items: built.items.map(({ path: _p, ...rest }) => rest),
    };
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return { count: 0, categories: LIBRARY_CATEGORIES, items: [] };
  }
}
