/**
 * Asset intelligence — report what approved IFCDC assets can be reused vs must be supplied.
 */
import { stageBrandKit, pickAssets, BRAND_COLORS, BRAND_HANDLES, GAPS } from "../brand/kit.mjs";
import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const ROOT = join(homedir(), "Library/Application Support/IFCDC/aura-resolve");
const KIT_DIR = join(ROOT, "production-kit");

/**
 * @param {{ requiredRoles?: string[], requiredLabels?: string[] }} [needs]
 */
export function analyzeAssets(needs = {}) {
  const kit = stageBrandKit({ intoMedia: true });
  const staged = kit.staged || [];
  const requiredRoles = needs.requiredRoles || ["logo", "broll", "app-store", "music"];
  const requiredLabels = needs.requiredLabels || [
    "IFCDC logo",
    "Product / service stills",
    "Approved music bed",
    "Title / end-card templates",
  ];

  const reusable = staged
    .filter((item) => item.available !== false && (item.mediaPath || item.source))
    .map((item) => ({
      id: item.id,
      role: item.role,
      label: item.label,
      path: item.mediaPath || item.source,
      decision: "REUSE",
    }));

  const missingRoles = requiredRoles.filter(
    (role) => !reusable.some((item) => item.role === role || (role === "music" && item.role === "music-fallback")),
  );

  const mustSupply = [];
  for (const role of missingRoles) {
    mustSupply.push({
      role,
      decision: "MUST_SUPPLY_OR_GENERATE",
      note: `No approved ${role} asset found on disk. Do not substitute random assets.`,
    });
  }

  const kitFiles = existsSync(KIT_DIR)
    ? readdirSync(KIT_DIR)
        .filter((name) => !name.endsWith(".json"))
        .map((name) => {
          const path = join(KIT_DIR, name);
          return { name, path, bytes: statSync(path).size };
        })
    : [];

  const templateGaps = [];
  if (!kitFiles.some((f) => /end-card|an-ifcdc-production/i.test(f.name))) {
    templateGaps.push("AN IFCDC PRODUCTION end card will be composed from existing logos + brand colors");
  }
  if (!kitFiles.some((f) => /lower-third/i.test(f.name))) {
    templateGaps.push("Lower-third template will be composed from existing logos + brand colors");
  }

  const picked = pickAssets(kit, requiredRoles);
  return {
    at: new Date().toISOString(),
    company: "IFCDC PRODUCTIONS",
    colors: BRAND_COLORS,
    handles: BRAND_HANDLES,
    requiredLabels,
    reusable,
    mustSupply,
    kitTemplates: kitFiles,
    brandGaps: GAPS,
    templateNotes: templateGaps,
    canProceed: reusable.filter((r) => r.role === "logo" || r.role === "broll").length >= 2,
    picked: picked.map((p) => ({ id: p.id, role: p.role, label: p.label })),
    rule: "Never substitute random assets. Only approved IFCDC-indexed files may be reused.",
  };
}
