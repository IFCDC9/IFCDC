/**
 * Founder Identity Library — operational architecture (Phase 5).
 * ORIGINAL_FOUNDER_MEDIA vs GENERATED_FOUNDER_MEDIA stay separated.
 * Scans only approved IFCDC aura-resolve / productions trees.
 * Never copies from the general Photos library. Never generates a face.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { randomBytes } from "crypto";
import { PRODUCTIONS_ROOT } from "../brand/production-identity.mjs";
import { ensureCloneArchitecture, CLONE_DIRS, writeProvenance } from "../clone/pipeline.mjs";

export const IDENTITY_ROOT = join(PRODUCTIONS_ROOT, "FOUNDER-IDENTITY-LIBRARY");
export const ORIGINAL_FOUNDER_MEDIA = join(PRODUCTIONS_ROOT, "ORIGINAL_FOUNDER_MEDIA");
export const GENERATED_FOUNDER_MEDIA = join(PRODUCTIONS_ROOT, "GENERATED_FOUNDER_MEDIA");

export const IDENTITY_RECORD_FIELDS = [
  "face",
  "body",
  "voice",
  "wardrobe",
  "location",
  "role",
  "camera",
  "expression",
  "movement",
  "continuity",
];

const MEDIA_EXT = /\.(png|jpe?g|webp|gif|mp4|mov|m4a|mp3|wav|aac)$/i;

function listMedia(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  const walk = (current, depth = 0) => {
    if (depth > 3) return;
    let entries = [];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      if (!MEDIA_EXT.test(entry.name)) continue;
      let bytes = 0;
      try {
        bytes = statSync(full).size;
      } catch {
        bytes = 0;
      }
      out.push({ name: entry.name, bytes, relativeHint: full.replace(PRODUCTIONS_ROOT + "/", "") });
    }
  };
  walk(dir);
  return out;
}

export function ensureFounderIdentityLibrary() {
  ensureCloneArchitecture();
  mkdirSync(IDENTITY_ROOT, { recursive: true });
  mkdirSync(ORIGINAL_FOUNDER_MEDIA, { recursive: true });
  mkdirSync(join(GENERATED_FOUNDER_MEDIA, "images"), { recursive: true });
  mkdirSync(join(GENERATED_FOUNDER_MEDIA, "video"), { recursive: true });
  mkdirSync(join(GENERATED_FOUNDER_MEDIA, "voice"), { recursive: true });
  mkdirSync(join(IDENTITY_ROOT, "records"), { recursive: true });
  mkdirSync(join(IDENTITY_ROOT, "provenance"), { recursive: true });

  // Mirror slots under clone originals for bridge compatibility
  mkdirSync(CLONE_DIRS.originals, { recursive: true });
  mkdirSync(CLONE_DIRS.generatedScenes, { recursive: true });

  const slots = {};
  for (const field of IDENTITY_RECORD_FIELDS) {
    const slotDir = join(IDENTITY_ROOT, "records", field);
    mkdirSync(slotDir, { recursive: true });
    const files = listMedia(slotDir);
    const approvedMarker = join(slotDir, "APPROVED.json");
    const approved = existsSync(approvedMarker);
    slots[field] = {
      field,
      pathHint: `FOUNDER-IDENTITY-LIBRARY/records/${field}`,
      files: files.length,
      approved,
      status: approved && files.length ? "PRESENT_APPROVED" : files.length ? "PRESENT_UNAPPROVED" : "FOUNDATION_MEDIA_MISSING",
    };
  }

  // Scan ONLY existing IFCDC aura-resolve / productions trees for already-designated approved media.
  const scannedOriginals = [
    ...listMedia(ORIGINAL_FOUNDER_MEDIA),
    ...listMedia(CLONE_DIRS.originals),
  ];
  const scannedGenerated = [
    ...listMedia(join(GENERATED_FOUNDER_MEDIA, "images")),
    ...listMedia(join(GENERATED_FOUNDER_MEDIA, "video")),
    ...listMedia(join(GENERATED_FOUNDER_MEDIA, "voice")),
    ...listMedia(CLONE_DIRS.generatedScenes),
  ];

  const designatedApproved = scannedOriginals.filter((f) => /approved|founder-approved/i.test(f.name));
  const status =
    designatedApproved.length > 0
      ? "HAS_APPROVED_ORIGINALS"
      : scannedOriginals.length > 0
        ? "HAS_FILES_NOT_DESIGNATED_APPROVED"
        : "FOUNDATION_MEDIA_MISSING";

  const doc = {
    at: new Date().toISOString(),
    company: "IFCDC PRODUCTIONS",
    publish: false,
    generationEngine: "NOT_EXECUTED_FOR_PERSON",
    separation: {
      ORIGINAL_FOUNDER_MEDIA: "IFCDC-PRODUCTIONS/ORIGINAL_FOUNDER_MEDIA",
      GENERATED_FOUNDER_MEDIA: "IFCDC-PRODUCTIONS/GENERATED_FOUNDER_MEDIA",
      rule: "Originals stay protected and separate from generated outputs.",
    },
    records: slots,
    inventory: {
      originalsCount: scannedOriginals.length,
      designatedApprovedCount: designatedApproved.length,
      generatedCount: scannedGenerated.length,
      status,
    },
    note: "Do not copy private photos from the general Photos library. Do not generate a face without approved provider + approved source.",
  };

  writeFileSync(join(IDENTITY_ROOT, "LIBRARY.json"), JSON.stringify(doc, null, 2));
  writeProvenance({
    kind: "founder-identity-library-ensure",
    status: doc.inventory.status,
    generationExecuted: false,
  });
  return doc;
}

export function founderIdentityStatus() {
  const lib = ensureFounderIdentityLibrary();
  return {
    status: "ARCHITECTURE_READY",
    libraryStatus: lib.inventory.status,
    founderIdentityLibrary: lib.inventory.status === "HAS_APPROVED_ORIGINALS" ? "HAS_APPROVED" : "READY_FOR_APPROVED_UPLOADS",
    approvedPhotosVideoVoice:
      lib.inventory.designatedApprovedCount > 0 ? "HAS_APPROVED_MEDIA" : "WAITING_FOR_APPROVED_MEDIA",
    foundationMediaMissing: lib.inventory.status === "FOUNDATION_MEDIA_MISSING",
    generationEngine: "NOT_EXECUTED_FOR_PERSON",
    records: lib.records,
    blockers:
      lib.inventory.designatedApprovedCount === 0
        ? [
            "FOUNDATION_MEDIA_MISSING: no designated approved Founder source files under IFCDC aura-resolve / productions trees",
            "MISSING_PROVIDER:founder_visual_clone",
            "MISSING_PROVIDER:founder_voice_clone",
          ]
        : ["MISSING_PROVIDER:founder_visual_clone", "MISSING_PROVIDER:founder_voice_clone"],
    separation: lib.separation,
  };
}

export function readFounderIdentityLibrary() {
  const path = join(IDENTITY_ROOT, "LIBRARY.json");
  if (!existsSync(path)) return ensureFounderIdentityLibrary();
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return ensureFounderIdentityLibrary();
  }
}
