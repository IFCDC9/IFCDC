/**
 * Phase 6B — HQ cloud Founder / official asset intake.
 * ORIGINAL_FOUNDER_MEDIA stays immutable and separate from GENERATED_FOUNDER_MEDIA.
 * Never auto-designates existing files. Never generates face/voice. Never overwrites originals.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { getDataDir } from "../config/dataPaths";

export const FOUNDER_REFERENCE_SLOTS = [
  { id: "FOUNDER_FACE_REFERENCE", label: "Founder face reference", kind: "image", group: "founder" as const },
  { id: "FOUNDER_BODY_REFERENCE", label: "Founder body reference", kind: "image", group: "founder" as const },
  { id: "FOUNDER_VIDEO_REFERENCE", label: "Founder video reference", kind: "video", group: "founder" as const },
  { id: "FOUNDER_VOICE_REFERENCE", label: "Founder voice reference", kind: "audio", group: "founder" as const },
] as const;

export const OFFICIAL_ASSET_SLOTS = [
  { id: "OFFICIAL_GOLD_CIRCLE_LOGO", label: "Gold-circle logo", kind: "image", group: "official" as const, reportKey: "GOLD_CIRCLE_LOGO" },
  { id: "OFFICIAL_TRANSPARENT_LOGO", label: "Transparent logo", kind: "image", group: "official" as const, reportKey: "TRANSPARENT_LOGO" },
  { id: "OFFICIAL_FONT", label: "Official font", kind: "font", group: "official" as const, reportKey: "OFFICIAL_FONT" },
  { id: "OFFICIAL_ANIMATED_LOGO", label: "Animated logo", kind: "video", group: "official" as const, reportKey: "ANIMATED_LOGO" },
] as const;

export const ALL_INTAKE_SLOTS = [...FOUNDER_REFERENCE_SLOTS, ...OFFICIAL_ASSET_SLOTS];

function intakeRoot() {
  const root = path.join(getDataDir(), "aura-resolve-founder-intake");
  const original = path.join(root, "ORIGINAL_FOUNDER_MEDIA");
  const generated = path.join(root, "GENERATED_FOUNDER_MEDIA");
  fs.mkdirSync(path.join(original, "designations"), { recursive: true });
  fs.mkdirSync(path.join(generated, "images"), { recursive: true });
  fs.mkdirSync(path.join(generated, "video"), { recursive: true });
  fs.mkdirSync(path.join(generated, "voice"), { recursive: true });
  return { root, original, generated };
}

function manifestPath() {
  return path.join(intakeRoot().original, "DESIGNATIONS.json");
}

function readManifest(): {
  version: number;
  company: string;
  phase: string;
  slots: Record<string, Record<string, unknown>>;
  note: string;
} {
  const file = manifestPath();
  if (!fs.existsSync(file)) {
    return {
      version: 1,
      company: "IFCDC PRODUCTIONS",
      phase: "6B",
      slots: {},
      note: "Explicit Founder designation only. No auto-designation. ORIGINAL separate from GENERATED.",
    };
  }
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {
      version: 1,
      company: "IFCDC PRODUCTIONS",
      phase: "6B",
      slots: {},
      note: "Explicit Founder designation only.",
    };
  }
}

function writeManifest(doc: ReturnType<typeof readManifest>) {
  intakeRoot();
  fs.writeFileSync(manifestPath(), JSON.stringify(doc, null, 2));
}

function slotStatus(slotId: string, group: "founder" | "official", entry: Record<string, unknown> | undefined) {
  if (entry?.fileName) {
    return "DESIGNATED";
  }
  return group === "official" ? "MISSING_FOR_FOUNDER_UPLOAD" : "MISSING";
}

export function getFounderIntakeStatus() {
  intakeRoot();
  const manifest = readManifest();
  const slots = ALL_INTAKE_SLOTS.map((slot) => {
    const entry = manifest.slots?.[slot.id];
    const status = slotStatus(slot.id, slot.group, entry);
    return {
      id: slot.id,
      label: slot.label,
      kind: slot.kind,
      group: slot.group,
      status,
      awaiting: status === "MISSING" ? "awaiting Founder designation" : status === "MISSING_FOR_FOUNDER_UPLOAD" ? "MISSING_FOR_FOUNDER_UPLOAD" : null,
      fileName: (entry?.fileName as string) || null,
      designatedAt: (entry?.designatedAt as string) || null,
      pathHint: (entry?.pathHint as string) || null,
      neverOverwrite: true,
      generationBlocked: true,
    };
  });

  const founderSlots = slots.filter((s) => s.group === "founder");
  const officialSlots = slots.filter((s) => s.group === "official");
  const missingFounder = founderSlots.filter((s) => s.status === "MISSING").map((s) => s.id);
  const missingOfficial = officialSlots.filter((s) => s.status === "MISSING_FOR_FOUNDER_UPLOAD").map((s) => s.id);

  return {
    phase: "6B",
    company: "IFCDC PRODUCTIONS",
    FOUNDATION_MEDIA_MISSING: missingFounder.length > 0,
    ORIGINAL_FOUNDER_MEDIA: "aura-resolve-founder-intake/ORIGINAL_FOUNDER_MEDIA",
    GENERATED_FOUNDER_MEDIA: "aura-resolve-founder-intake/GENERATED_FOUNDER_MEDIA",
    separation: {
      rule: "ORIGINAL_FOUNDER_MEDIA immutable and separate from GENERATED_FOUNDER_MEDIA",
      cloningOrGeneration: "blocked until explicit designation exists",
    },
    designations: {
      slots,
      missingDesignations: [...missingFounder, ...missingOfficial],
      missingFounder,
      missingOfficial,
    },
    founder: Object.fromEntries(
      founderSlots.map((s) => [s.id, s.status === "DESIGNATED" ? `DESIGNATED:${s.fileName}` : "MISSING / awaiting Founder designation"]),
    ),
    official: Object.fromEntries(
      officialSlots.map((s) => [s.id, s.status === "DESIGNATED" ? `DESIGNATED:${s.fileName}` : "MISSING_FOR_FOUNDER_UPLOAD"]),
    ),
    note: "No face/voice generation from intake. Upload + classify + store only.",
  };
}

export function designateFounderIntake(opts: {
  slotId: string;
  base64?: string | null;
  originalName?: string | null;
  mimeType?: string | null;
}) {
  const slot = ALL_INTAKE_SLOTS.find((s) => s.id === opts.slotId);
  if (!slot) {
    return { ok: false as const, status: "INVALID_SLOT", blocker: `UNKNOWN_SLOT:${opts.slotId}` };
  }
  const b64 = String(opts.base64 || "").trim();
  if (!b64) {
    return { ok: false as const, status: "FAILED", blocker: "MISSING_FILE", reason: "base64 required" };
  }

  let bytes: Buffer;
  try {
    bytes = Buffer.from(b64, "base64");
  } catch {
    return { ok: false as const, status: "FAILED", blocker: "INVALID_BASE64" };
  }
  if (!bytes.length) {
    return { ok: false as const, status: "FAILED", blocker: "EMPTY_FILE" };
  }
  // Soft cap ~25MB to keep Render disk sane
  if (bytes.length > 25 * 1024 * 1024) {
    return { ok: false as const, status: "FAILED", blocker: "FILE_TOO_LARGE", reason: "max 25MB per designation upload" };
  }

  const { original } = intakeRoot();
  const dir = path.join(original, "designations", slot.id);
  fs.mkdirSync(dir, { recursive: true });

  const extFromName = opts.originalName ? path.extname(opts.originalName) : "";
  const ext =
    extFromName ||
    (opts.mimeType?.includes("video")
      ? ".mp4"
      : opts.mimeType?.includes("audio")
        ? ".wav"
        : opts.mimeType?.includes("font")
          ? ".ttf"
          : ".png");
  const safeBase = String(opts.originalName || "upload")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .slice(0, 48);
  const fileName = `${slot.id.toLowerCase()}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}-${safeBase}${
    path.extname(safeBase) ? "" : ext
  }`;
  const dest = path.join(dir, fileName);
  if (fs.existsSync(dest)) {
    return { ok: false as const, status: "FAILED", blocker: "REFUSING_OVERWRITE", reason: "destination exists" };
  }
  fs.writeFileSync(dest, bytes);

  const manifest = readManifest();
  const prior = manifest.slots[slot.id];
  manifest.slots[slot.id] = {
    slotId: slot.id,
    group: slot.group,
    fileName,
    pathHint: `ORIGINAL_FOUNDER_MEDIA/designations/${slot.id}/${fileName}`,
    designatedAt: new Date().toISOString(),
    priorFileName: prior?.fileName || null,
    mimeType: opts.mimeType || null,
    bytes: bytes.length,
    neverOverwrite: true,
    generationExecuted: false,
  };
  writeManifest(manifest);

  const status = getFounderIntakeStatus();
  return {
    ok: true as const,
    status: "DESIGNATED",
    slotId: slot.id,
    fileName,
    bytes: bytes.length,
    publish: false,
    generationExecuted: false,
    ORIGINAL_FOUNDER_MEDIA: status.ORIGINAL_FOUNDER_MEDIA,
    GENERATED_FOUNDER_MEDIA: status.GENERATED_FOUNDER_MEDIA,
    designations: status.designations,
    message: `Designated ${slot.id} on HQ. Original stored; no face/voice generated.`,
  };
}
