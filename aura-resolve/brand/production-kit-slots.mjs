/**
 * Production kit slot inventory — PRESENT (with path) or MISSING_FOR_FOUNDER_UPLOAD.
 * Does not fabricate missing official originals.
 */
import { existsSync } from "fs";
import { basename } from "path";
import { ensureProductionKit, readProductionKit, listKitFiles } from "./production-kit.mjs";
import { stageBrandKit, pickAssets } from "./kit.mjs";
import { ensureGlobalProductionIdentity } from "./production-identity.mjs";

export const KIT_SLOTS = [
  { id: "gold-circle-logo", label: "Gold-circle logo", match: /gold-circle/i, roleHints: ["logo"] },
  { id: "transparent-logos", label: "Transparent logos", match: /logo|transparent/i, roleHints: ["logo"] },
  { id: "official-fonts", label: "Official fonts", match: /font/i, roleHints: [] },
  { id: "opening-card", label: "Opening card", match: /title-card|open|identity-open/i, roleHints: ["title-card"] },
  { id: "closing-card", label: "Closing card", match: /end-card|closing|identity-end/i, roleHints: ["end-card"] },
  { id: "lower-thirds", label: "Lower thirds", match: /lower-third/i, roleHints: ["lower-third"] },
  { id: "animated-logo", label: "Animated logo", match: /animated.?logo/i, roleHints: [] },
  { id: "title-cta-templates", label: "Title / CTA templates", match: /social-cta|caption-plate|title-card/i, roleHints: ["social-cta", "caption-plate"] },
  { id: "vertical-template", label: "Vertical template", match: /9x16|9:16/i, roleHints: [] },
  { id: "landscape-template", label: "Landscape template", match: /16x9|16:9/i, roleHints: [] },
  { id: "square-template", label: "Square template", match: /1x1|1:1/i, roleHints: [] },
];

function present(path) {
  return {
    status: "PRESENT",
    pathHint: path ? basename(path) : null,
    path: path || null,
  };
}

function missing(note) {
  return {
    status: "MISSING_FOR_FOUNDER_UPLOAD",
    pathHint: null,
    path: null,
    note: note || "Official original not found — do not fabricate",
  };
}

export function inventoryProductionKitSlots({ forceCompose = false } = {}) {
  try {
    ensureGlobalProductionIdentity({ forceCards: false });
  } catch {
    /* identity cards optional */
  }
  if (forceCompose) {
    try {
      ensureProductionKit({ force: true });
    } catch {
      /* keep still cards if compose fails */
    }
  } else {
    try {
      readProductionKit();
    } catch {
      try {
        ensureProductionKit({ force: false });
      } catch {
        /* */
      }
    }
  }

  const kit = (() => {
    try {
      return readProductionKit();
    } catch {
      return { items: [], fonts: {} };
    }
  })();
  const files = listKitFiles();
  const brand = stageBrandKit({ intoMedia: true });
  const logos = pickAssets(brand, ["logo"]);
  const identityDirFiles = files.filter((f) => /identity/i.test(f.path) || /identity/i.test(f.name));

  const slots = KIT_SLOTS.map((slot) => {
    if (slot.id === "official-fonts") {
      const preferred = kit.fonts?.preferred;
      if (preferred && !/no dedicated|not found/i.test(String(kit.fonts?.note || ""))) {
        return { ...slot, ...present(preferred), note: kit.fonts?.note || null };
      }
      return {
        ...slot,
        ...missing("No dedicated IFCDC official font file on disk; system Arial Bold is named fallback only"),
        fallbackNamed: kit.fonts?.preferred || "Arial Bold (system)",
      };
    }

    if (slot.id === "animated-logo") {
      const hit = files.find((f) => /\.(mp4|mov|webm)$/i.test(f.name) && /logo|anim/i.test(f.name));
      if (hit) return { ...slot, ...present(hit.path) };
      return { ...slot, ...missing("Animated logo not yet rendered — still cards preserved") };
    }

    if (slot.id === "gold-circle-logo") {
      const composed = files.find((f) => /gold-circle/i.test(f.name));
      if (composed) {
        return {
          ...slot,
          ...present(composed.path),
          note: "Composed from approved brand colors — not a newly invented official vector mark",
        };
      }
      return { ...slot, ...missing("No gold-circle logo asset found") };
    }

    if (slot.id === "transparent-logos") {
      const logo = logos[0]?.mediaPath || logos[0]?.source;
      if (logo) return { ...slot, ...present(logo), note: "Staged existing logo (transparency depends on source file)" };
      return { ...slot, ...missing("No logo file staged from approved IFCDC trees") };
    }

    // Template / card slots
    const fromKit = (kit.items || []).find((item) => {
      if (slot.roleHints?.length && slot.roleHints.includes(item.role)) return true;
      return slot.match.test(String(item.role || "")) || slot.match.test(String(item.path || ""));
    });
    if (fromKit?.path || fromKit?.mediaPath) {
      return { ...slot, ...present(fromKit.mediaPath || fromKit.path), format: fromKit.format || null };
    }

    const fromFiles = files.find((f) => slot.match.test(f.name));
    if (fromFiles) return { ...slot, ...present(fromFiles.path) };

    if (slot.id === "vertical-template" || slot.id === "landscape-template" || slot.id === "square-template") {
      const tag =
        slot.id === "vertical-template" ? /9x16|9:16/ : slot.id === "landscape-template" ? /16x9|16:9/ : /1x1|1:1/;
      const hit = (kit.items || []).find((item) => tag.test(String(item.format || "")) || tag.test(String(item.path || "")));
      if (hit?.path || hit?.mediaPath) return { ...slot, ...present(hit.mediaPath || hit.path) };
    }

    // Identity still cards count toward opening/closing when present
    if ((slot.id === "opening-card" || slot.id === "closing-card") && identityDirFiles.length) {
      const hit = identityDirFiles.find((f) =>
        slot.id === "opening-card" ? /open|title|presents/i.test(f.name) : /end|credit|closing/i.test(f.name),
      );
      if (hit) return { ...slot, ...present(hit.path), note: "Identity still card" };
    }

    return { ...slot, ...missing() };
  });

  const presentCount = slots.filter((s) => s.status === "PRESENT").length;
  const missingCount = slots.filter((s) => s.status === "MISSING_FOR_FOUNDER_UPLOAD").length;

  return {
    at: new Date().toISOString(),
    company: "IFCDC PRODUCTIONS",
    existingStillCardsPreserved: true,
    fabricatedOfficialOriginals: false,
    presentCount,
    missingCount,
    slots: slots.map(({ path, ...rest }) => ({
      ...rest,
      // HQ-safe: basename only
      path: undefined,
      pathHint: rest.pathHint || (path ? basename(path) : null),
    })),
    localSlots: slots,
  };
}
