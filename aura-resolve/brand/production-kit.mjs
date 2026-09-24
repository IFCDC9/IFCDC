/**
 * IFCDC Production Kit — reusable templates the agent imports automatically.
 * Built from existing logos + approved brand colors. Not a newly invented official logo.
 */
import { spawnSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync } from "fs";
import { homedir } from "os";
import { basename, dirname, join } from "path";
import { fileURLToPath } from "url";
import { stageBrandKit, pickAssets, BRAND_COLORS, BRAND_HANDLES } from "./kit.mjs";

const ROOT = join(homedir(), "Library/Application Support/IFCDC/aura-resolve");
const KIT_DIR = join(ROOT, "production-kit");
const MEDIA = join(ROOT, "media");
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "compose_templates.py");

const FORMATS = [
  { width: 1080, height: 1920, label: "9:16" },
  { width: 1920, height: 1080, label: "16:9" },
  { width: 1080, height: 1080, label: "1:1" },
];

export const PRODUCTION_COMPANY = "IFCDC PRODUCTIONS";

export function ensureProductionKit({ force = false } = {}) {
  mkdirSync(KIT_DIR, { recursive: true });
  mkdirSync(MEDIA, { recursive: true });
  const indexPath = join(KIT_DIR, "index.json");
  if (!force && existsSync(indexPath)) {
    try {
      return JSON.parse(readFileSync(indexPath, "utf8"));
    } catch {
      /* rebuild */
    }
  }

  const brand = stageBrandKit({ intoMedia: true });
  const logos = pickAssets(brand, ["logo"]);
  const logoPath = logos[0]?.mediaPath || logos[0]?.source || null;

  const result = spawnSync(
    "python3",
    [SCRIPT],
    {
      encoding: "utf8",
      input: JSON.stringify({
        outDir: KIT_DIR,
        logoPath,
        formats: FORMATS,
        title: "IFCDC Barbers App",
        subtitle: "Book your look",
        cta: BRAND_HANDLES.cta,
        captions: ["IFCDC Barbers App", "Book today", PRODUCTION_COMPANY],
      }),
    },
  );
  if (result.status !== 0) {
    throw new Error(`production kit compose failed: ${(result.stderr || result.stdout || "").slice(-500)}`);
  }
  let parsed;
  try {
    parsed = JSON.parse((result.stdout || "").trim().split("\n").pop());
  } catch {
    parsed = { ok: true, manifest: JSON.parse(readFileSync(indexPath, "utf8")) };
  }
  const manifest = parsed.manifest || JSON.parse(readFileSync(indexPath, "utf8"));
  manifest.company = PRODUCTION_COMPANY;
  manifest.colors = BRAND_COLORS;
  manifest.handles = BRAND_HANDLES;
  manifest.fonts = {
    preferred: "Arial Bold (system)",
    fallback: "Helvetica / default",
    note: "No dedicated IFCDC official font file was found on disk; system Arial Bold is the named fallback.",
  };
  manifest.layouts = {
    vertical: { ...FORMATS[0], safeAreaPct: 10 },
    landscape: { ...FORMATS[1], safeAreaPct: 8 },
    square: { ...FORMATS[2], safeAreaPct: 8 },
  };
  manifest.transitions = ["brand-flash-gold", "fade-to-black"];
  manifest.autoApplyCompany = true;
  writeFileSync(indexPath, JSON.stringify(manifest, null, 2));

  // Stage PNGs into media for Resolve import.
  for (const item of manifest.items || []) {
    if (!item.path || !existsSync(item.path)) continue;
    const dest = join(MEDIA, basename(item.path));
    copyFileSync(item.path, dest);
    item.mediaPath = dest;
    item.mediaName = basename(dest);
  }
  writeFileSync(indexPath, JSON.stringify(manifest, null, 2));
  return manifest;
}

export function readProductionKit() {
  const indexPath = join(KIT_DIR, "index.json");
  if (!existsSync(indexPath)) return ensureProductionKit({ force: true });
  try {
    return JSON.parse(readFileSync(indexPath, "utf8"));
  } catch {
    return ensureProductionKit({ force: true });
  }
}

export function kitAsset(role, formatLabel = "9:16") {
  const kit = readProductionKit();
  const suffix = String(formatLabel).replace(":", "x");
  const items = kit.items || [];
  return (
    items.find((item) => item.role === role && String(item.format || "").replace(":", "x") === suffix) ||
    items.find((item) => item.role === role) ||
    null
  );
}

export function listKitFiles() {
  if (!existsSync(KIT_DIR)) return [];
  return readdirSync(KIT_DIR).map((name) => ({ name, path: join(KIT_DIR, name) }));
}
