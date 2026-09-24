/**
 * IFCDC brand-kit index for AURA Resolve.
 * Only lists files that already exist on this Mac. Never invents official marks.
 */
import { existsSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, readdirSync } from "fs";
import { homedir } from "os";
import { basename, join, extname } from "path";

const ROOT = join(homedir(), "Library/Application Support/IFCDC/aura-resolve");
const MEDIA = join(ROOT, "media");
const BRAND_DIR = join(ROOT, "brand-kit");
const INDEX_PATH = join(BRAND_DIR, "index.json");

const CANDIDATES = [
  {
    id: "ifcdc-logo-hq",
    role: "logo",
    label: "IFCDC HQ logo",
    paths: [
      "/Users/fahrealallah/Development/IFCDC/Apps/IMPERIAL-FOUNDATION-CDC/public/ifcdc-logo.png",
      "/Users/fahrealallah/Development/IFCDC/Apps/IMPERIAL-FOUNDATION-CDC/public/ifcdc-logo.jpeg",
      "/Users/fahrealallah/Development/IFCDC/Apps/IMPERIAL-FOUNDATION-CDC/ifcdc-logo.png",
    ],
  },
  {
    id: "barbers-logo-app",
    role: "logo",
    label: "IFCDC Barbers App logo",
    paths: [
      "/Users/fahrealallah/IFCDC-BARBERS-APP/assets/brand/ifcdc-logo-app.png",
      "/Users/fahrealallah/IFCDC-BARBERS-APP/public/assets/brand/ifcdc-logo-app.png",
      "/Users/fahrealallah/IFCDC-BARBERS-APP/public/assets/brand/ifcdc-logo.png",
    ],
  },
  {
    id: "barbers-store-icon",
    role: "app-store",
    label: "Barbers App Store icon",
    paths: [
      "/Users/fahrealallah/Development/IFCDC/Apps/IFCDC-BARBERS-APP/IFCDC-BARBERS-APPP-22/ifcdc-barbers-backend 2/mobile/store-listing/icon-512.png",
      "/Users/fahrealallah/IFCDC-BARBERS-APP/ios/App/Assets.xcassets/AppIcon.appiconset/ios-marketing-1024x1024-1x.png",
    ],
  },
  {
    id: "barbers-feature-graphic",
    role: "app-store",
    label: "Barbers feature graphic",
    paths: [
      "/Users/fahrealallah/Development/IFCDC/Apps/IFCDC-BARBERS-APP/IFCDC-BARBERS-APPP-22/ifcdc-barbers-backend 2/mobile/store-listing/feature-graphic.png",
    ],
  },
  {
    id: "barbers-service-still-a",
    role: "broll",
    label: "Barbers service still A",
    paths: ["/Users/fahrealallah/IFCDC-BARBERS-APP/uploads/services/service-1768318869721.jpeg"],
  },
  {
    id: "barbers-service-still-b",
    role: "broll",
    label: "Barbers service still B",
    paths: ["/Users/fahrealallah/IFCDC-BARBERS-APP/uploads/services/service-1768504101777.jpeg"],
  },
  {
    id: "ifcdc-music-nite-day",
    role: "music",
    label: "IFCDC Nite Day master (approved IFCDC music)",
    paths: [
      "/Users/fahrealallah/Music/IFCDC-MUSIC/exports/IFCDC-NITE-DAY-MASTER_V6.mp3",
      "/Users/fahrealallah/Music/IFCDC-MUSIC/productions/IFCDC-NITE-DAY/exports/IFCDC-NITE-DAY-MASTER_V6.mp3",
    ],
  },
  {
    id: "aura-test-tone",
    role: "music-fallback",
    label: "AURA test tone (approved test audio)",
    paths: ["/Users/fahrealallah/Music/IFCDC-MUSIC/imports/aura-test-tone-440hz.wav"],
  },
];

export const BRAND_COLORS = {
  gold: "#C9A227",
  black: "#0B0B0B",
  ivory: "#F5F0E6",
};

export const BRAND_HANDLES = {
  org: "@IFCDC",
  product: "IFCDC Barbers App",
  cta: "Book in the IFCDC Barbers App",
};

export const GAPS = [
  "No dedicated gold-circle vector found outside composite logos.",
  "No separate lower-third / intro / outro package on disk.",
  "No official font files indexed; Resolve default titles are used.",
];

function firstExisting(paths) {
  for (const path of paths) {
    if (path && existsSync(path)) return path;
  }
  return null;
}

export function scanBrandKit() {
  const assets = [];
  for (const candidate of CANDIDATES) {
    const source = firstExisting(candidate.paths);
    assets.push({
      id: candidate.id,
      role: candidate.role,
      label: candidate.label,
      source,
      available: Boolean(source),
    });
  }
  return {
    updatedAt: new Date().toISOString(),
    colors: BRAND_COLORS,
    handles: BRAND_HANDLES,
    gaps: GAPS,
    assets,
  };
}

export function stageBrandKit({ intoMedia = true } = {}) {
  mkdirSync(BRAND_DIR, { recursive: true });
  mkdirSync(MEDIA, { recursive: true });
  const kit = scanBrandKit();
  const staged = [];
  for (const asset of kit.assets) {
    if (!asset.source) continue;
    const ext = extname(asset.source) || ".bin";
    const stagedName = `${asset.id}${ext}`;
    const destBrand = join(BRAND_DIR, stagedName);
    copyFileSync(asset.source, destBrand);
    let mediaPath = destBrand;
    if (intoMedia) {
      mediaPath = join(MEDIA, stagedName);
      copyFileSync(asset.source, mediaPath);
    }
    staged.push({ ...asset, stagedPath: destBrand, mediaPath, mediaName: basename(mediaPath) });
  }
  const index = { ...kit, staged };
  writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2));
  return index;
}

export function readBrandKit() {
  if (!existsSync(INDEX_PATH)) return stageBrandKit();
  try {
    return JSON.parse(readFileSync(INDEX_PATH, "utf8"));
  } catch {
    return stageBrandKit();
  }
}

export function pickAssets(kit, roles = ["logo", "broll", "app-store", "music"]) {
  const picked = [];
  for (const role of roles) {
    const match = (kit.staged || kit.assets || []).find((item) => item.role === role && (item.mediaPath || item.source));
    if (match) picked.push(match);
  }
  if (!picked.find((item) => item.role === "music" || item.role === "music-fallback")) {
    const tone = (kit.staged || kit.assets || []).find((item) => item.role === "music-fallback" && (item.mediaPath || item.source));
    if (tone) picked.push(tone);
  }
  return picked;
}

export function listStagedMedia() {
  if (!existsSync(MEDIA)) return [];
  return readdirSync(MEDIA).map((name) => ({ name, path: join(MEDIA, name) }));
}
