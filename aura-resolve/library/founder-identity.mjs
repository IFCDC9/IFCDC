/**
 * Founder Identity Library — Phase 5 architecture + Phase 6 onboarding.
 * ORIGINAL_FOUNDER_MEDIA vs GENERATED_FOUNDER_MEDIA stay separated.
 * Scans only approved IFCDC aura-resolve / productions trees.
 * Never copies from the general Photos library. Never generates a face.
 * Never auto-designates existing files. Never overwrites originals.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync, readFileSync, statSync, copyFileSync } from "fs";
import { basename, extname, join } from "path";
import { randomBytes } from "crypto";
import { PRODUCTIONS_ROOT } from "../brand/production-identity.mjs";
import { ensureCloneArchitecture, CLONE_DIRS, writeProvenance } from "../clone/pipeline.mjs";

export const IDENTITY_ROOT = join(PRODUCTIONS_ROOT, "FOUNDER-IDENTITY-LIBRARY");
export const ORIGINAL_FOUNDER_MEDIA = join(PRODUCTIONS_ROOT, "ORIGINAL_FOUNDER_MEDIA");
export const GENERATED_FOUNDER_MEDIA = join(PRODUCTIONS_ROOT, "GENERATED_FOUNDER_MEDIA");

/** Explicit Phase 6 designation slots — Founder must act; nothing auto-fills. */
export const DESIGNATION_SLOTS = [
  { id: "FOUNDER_FACE_REFERENCE", label: "Founder face reference", kind: "image", field: "face" },
  { id: "FOUNDER_BODY_REFERENCE", label: "Founder body reference", kind: "image", field: "body" },
  { id: "FOUNDER_VIDEO_REFERENCE", label: "Founder video reference", kind: "video", field: "movement" },
  { id: "FOUNDER_VOICE_REFERENCE", label: "Founder voice reference", kind: "audio", field: "voice" },
  { id: "OFFICIAL_GOLD_CIRCLE_LOGO", label: "Official gold-circle logo", kind: "image", official: true },
  { id: "OFFICIAL_TRANSPARENT_LOGO", label: "Transparent logo", kind: "image", official: true },
  { id: "OFFICIAL_FONT", label: "Official font", kind: "font", official: true },
  { id: "OFFICIAL_ANIMATED_LOGO", label: "Animated logo", kind: "video", official: true },
];

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

function designationDir(slotId) {
  return join(ORIGINAL_FOUNDER_MEDIA, "designations", slotId);
}

function readDesignationManifest() {
  const path = join(ORIGINAL_FOUNDER_MEDIA, "DESIGNATIONS.json");
  if (!existsSync(path)) {
    return {
      version: 1,
      company: "IFCDC PRODUCTIONS",
      slots: {},
      note: "Explicit Founder designation only. No auto-designation of existing files.",
    };
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return { version: 1, company: "IFCDC PRODUCTIONS", slots: {} };
  }
}

function writeDesignationManifest(doc) {
  mkdirSync(ORIGINAL_FOUNDER_MEDIA, { recursive: true });
  writeFileSync(join(ORIGINAL_FOUNDER_MEDIA, "DESIGNATIONS.json"), JSON.stringify(doc, null, 2));
}

export function founderDesignationStatus() {
  ensureFounderIdentityLibrary();
  const manifest = readDesignationManifest();
  const slots = DESIGNATION_SLOTS.map((slot) => {
    const entry = manifest.slots?.[slot.id];
    const dir = designationDir(slot.id);
    const files = listMedia(dir);
    const present = Boolean(entry?.fileName) || files.length > 0;
    return {
      id: slot.id,
      label: slot.label,
      kind: slot.kind,
      official: Boolean(slot.official),
      status: present
        ? "DESIGNATED"
        : slot.official
          ? "MISSING_FOR_FOUNDER_UPLOAD"
          : "MISSING",
      awaiting: present
        ? null
        : slot.official
          ? "MISSING_FOR_FOUNDER_UPLOAD"
          : "awaiting Founder designation",
      fileName: entry?.fileName || files[0]?.name || null,
      designatedAt: entry?.designatedAt || null,
      neverOverwrite: true,
    };
  });
  const missing = slots.filter((s) => s.status === "MISSING" || s.status === "MISSING_FOR_FOUNDER_UPLOAD").map((s) => s.id);
  return {
    phase: "6B",
    company: "IFCDC PRODUCTIONS",
    ORIGINAL_FOUNDER_MEDIA: "IFCDC-PRODUCTIONS/ORIGINAL_FOUNDER_MEDIA",
    GENERATED_FOUNDER_MEDIA: "IFCDC-PRODUCTIONS/GENERATED_FOUNDER_MEDIA",
    slots,
    foundationMediaMissing: slots.filter((s) => !s.official && s.status === "MISSING").length > 0,
    missingDesignations: missing,
    visualContinuityOperational: false,
    voiceIntegrationOperational: false,
    note: "Visual continuity + voice clone stay architecture-only until provider + approved references both exist. No auto-designate.",
  };
}

/**
 * Designate a Founder / official asset. Writes a NEW filename under ORIGINAL_FOUNDER_MEDIA.
 * Never overwrites an existing original file.
 */
export function designateFounderMedia({
  slotId,
  sourcePath = null,
  bytes = null,
  originalName = null,
  mimeType = null,
} = {}) {
  ensureFounderIdentityLibrary();
  const slot = DESIGNATION_SLOTS.find((s) => s.id === slotId);
  if (!slot) {
    return { ok: false, status: "INVALID_SLOT", blocker: `UNKNOWN_SLOT:${slotId}` };
  }
  if (!sourcePath && !bytes) {
    return { ok: false, status: "FAILED", blocker: "MISSING_FILE", reason: "sourcePath or bytes required" };
  }
  if (sourcePath && !existsSync(sourcePath)) {
    return { ok: false, status: "FAILED", blocker: "SOURCE_NOT_FOUND", reason: "sourcePath does not exist" };
  }

  const dir = designationDir(slotId);
  mkdirSync(dir, { recursive: true });
  mkdirSync(CLONE_DIRS.originals, { recursive: true });

  const ext =
    (originalName && extname(originalName)) ||
    (sourcePath && extname(sourcePath)) ||
    (mimeType?.includes("video") ? ".mp4" : mimeType?.includes("audio") ? ".wav" : mimeType?.includes("font") ? ".ttf" : ".png");
  const safeBase = String(originalName || basename(sourcePath || "upload") || "upload")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .slice(0, 48);
  const fileName = `${slotId.toLowerCase()}-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}-${safeBase}${extname(safeBase) ? "" : ext}`;
  const dest = join(dir, fileName);
  if (existsSync(dest)) {
    return { ok: false, status: "FAILED", blocker: "REFUSING_OVERWRITE", reason: "destination exists — choose new name" };
  }

  if (bytes) writeFileSync(dest, Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes));
  else copyFileSync(sourcePath, dest);

  // Mirror into clone originals with a NEW name (never overwrite).
  const cloneDest = join(CLONE_DIRS.originals, fileName);
  if (!existsSync(cloneDest)) copyFileSync(dest, cloneDest);

  if (slot.field) {
    const fieldDir = join(IDENTITY_ROOT, "records", slot.field);
    mkdirSync(fieldDir, { recursive: true });
    const fieldDest = join(fieldDir, fileName);
    if (!existsSync(fieldDest)) copyFileSync(dest, fieldDest);
    writeFileSync(
      join(fieldDir, "APPROVED.json"),
      JSON.stringify(
        {
          approved: true,
          slotId,
          fileName,
          at: new Date().toISOString(),
          by: "FOUNDER_EXPLICIT_DESIGNATION",
          publish: false,
        },
        null,
        2,
      ),
    );
  }

  const manifest = readDesignationManifest();
  manifest.slots = manifest.slots || {};
  // Keep prior designation history; current pointer updates without deleting prior files.
  const prior = manifest.slots[slotId];
  manifest.slots[slotId] = {
    slotId,
    fileName,
    pathHint: `ORIGINAL_FOUNDER_MEDIA/designations/${slotId}/${fileName}`,
    designatedAt: new Date().toISOString(),
    priorFileName: prior?.fileName || null,
    mimeType: mimeType || null,
    neverOverwrite: true,
  };
  writeDesignationManifest(manifest);

  writeProvenance({
    kind: "founder-designation",
    slotId,
    fileName,
    generationExecuted: false,
    status: "DESIGNATED",
  });

  const status = founderDesignationStatus();
  return {
    ok: true,
    status: "DESIGNATED",
    slotId,
    fileName,
    path: dest,
    publish: false,
    designations: status,
  };
}

export function founderIdentityOnboardingPublic() {
  const lib = ensureFounderIdentityLibrary();
  const designations = founderDesignationStatus();
  const identity = founderIdentityStatus();
  return {
    phase: 6,
    company: "IFCDC PRODUCTIONS",
    FOUNDATION_MEDIA_MISSING: designations.missingDesignations.filter((id) => id.startsWith("FOUNDER_")).length > 0,
    designations,
    library: lib.inventory,
    identity,
    operational: {
      founderVisual: "ARCHITECTURE_READY",
      founderVoice: "ARCHITECTURE_READY",
      requires: [
        "FOUNDER explicit designation of reference media in HQ",
        "compatible identity provider credential (none configured)",
      ],
    },
  };
}
