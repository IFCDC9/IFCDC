/**
 * Founder Digital Clone pipeline — production architecture only.
 * No generation engine. No model calls. No synthesis of a person.
 * Originals and generated outputs stay in separate directories/records.
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { randomBytes } from "crypto";

const ROOT = join(homedir(), "Library/Application Support/IFCDC/aura-resolve");
const CLONE_ROOT = join(ROOT, "clone");

export const CLONE_DIRS = {
  originals: join(CLONE_ROOT, "originals"),
  references: join(CLONE_ROOT, "references"),
  wardrobe: join(CLONE_ROOT, "references", "wardrobe"),
  roles: join(CLONE_ROOT, "references", "roles"),
  environments: join(CLONE_ROOT, "references", "environments"),
  generated: join(CLONE_ROOT, "generated"),
  generatedScenes: join(CLONE_ROOT, "generated", "scenes"),
  provenance: join(CLONE_ROOT, "provenance"),
};

export const CLONE_PROVIDERS = [
  { id: "resolve-fusion", role: "edit, composite, warp, titles, grade, finish", local: true },
  {
    id: "approved-generator",
    role: "still or video identity generation from approved Founder media",
    local: true,
    configured: false,
    execution: "DISABLED",
  },
];

export function ensureCloneArchitecture() {
  for (const dir of Object.values(CLONE_DIRS)) mkdirSync(dir, { recursive: true });
  const readme = join(CLONE_ROOT, "README.json");
  const doc = {
    company: "IFCDC PRODUCTIONS",
    publish: false,
    generationEngine: "NOT_EXECUTED",
    separation: {
      originals: CLONE_DIRS.originals,
      generated: CLONE_DIRS.generated,
      rule: "Founder identity originals stay protected and separate from generated media.",
    },
    note: "Architecture and storage only. No face/voice generator is called.",
  };
  writeFileSync(readme, JSON.stringify(doc, null, 2));
  return doc;
}

export function writeProvenance(record) {
  ensureCloneArchitecture();
  const id = record.id || `prov_${randomBytes(6).toString("hex")}`;
  const payload = {
    id,
    at: new Date().toISOString(),
    publish: false,
    generationExecuted: false,
    company: "IFCDC PRODUCTIONS",
    ...record,
  };
  const path = join(CLONE_DIRS.provenance, `${id}.json`);
  writeFileSync(path, JSON.stringify(payload, null, 2));
  return { ...payload, path };
}

export function listCloneInventory() {
  ensureCloneArchitecture();
  const list = (dir) =>
    existsSync(dir)
      ? readdirSync(dir).filter((name) => !name.startsWith(".")).map((name) => ({ name, dir }))
      : [];
  return {
    originals: list(CLONE_DIRS.originals),
    wardrobe: list(CLONE_DIRS.wardrobe),
    roles: list(CLONE_DIRS.roles),
    environments: list(CLONE_DIRS.environments),
    generated: list(CLONE_DIRS.generatedScenes),
    provenance: list(CLONE_DIRS.provenance),
  };
}

export function clonePlan(instruction) {
  const architecture = ensureCloneArchitecture();
  const inventory = listCloneInventory();
  const provenance = writeProvenance({
    kind: "clone-plan",
    instruction: String(instruction || ""),
    status: "ARCHITECTURE_READY",
    modules: [
      "founderIdentityLibrary",
      "approvedPhotosVideoVoice",
      "wardrobe",
      "roles",
      "environments",
      "generatedScenesTakes",
      "provenance",
    ],
  });

  return {
    publish: false,
    founderApprovalRequired: true,
    usesExistingResolveBridge: true,
    status: "ARCHITECTURE_READY",
    generationEngine: "NOT_EXECUTED",
    architecture,
    inventory,
    provenance,
    modules: {
      founderIdentityLibrary: {
        status: "READY_FOR_APPROVED_UPLOADS",
        path: CLONE_DIRS.originals,
        note: "Approved Founder photos / video / voice only. Empty until Founder supplies.",
      },
      approvedPhotosVideoVoice: {
        status: inventory.originals.length ? "HAS_FILES" : "WAITING_FOR_APPROVED_MEDIA",
        count: inventory.originals.length,
        note: "Creative draft runs never import Founder-identity assets automatically.",
      },
      generatedScenesTakes: {
        status: "STORAGE_READY_NO_GENERATION",
        path: CLONE_DIRS.generatedScenes,
        note: "Scene / take generation stays off. Directory exists for future approved outputs only.",
      },
      identityConsistency: {
        status: "DEFINED",
        note: "Likeness locks will reference approved originals only when a generator is enabled later.",
      },
      wardrobeEnvironment: {
        status: "REFERENCE_DIRS_READY",
        paths: { wardrobe: CLONE_DIRS.wardrobe, environments: CLONE_DIRS.environments },
        note: "Reference folders only. No generation.",
      },
      roleTransformation: {
        status: "REFERENCE_DIRS_READY",
        path: CLONE_DIRS.roles,
        note: "Role folders (barber / loctician / etc.) wait on approved media.",
      },
      provenance: {
        status: "ACTIVE",
        path: CLONE_DIRS.provenance,
        latest: provenance.id,
        note: "Provenance metadata written for every clone-plan touch.",
      },
    },
    stages: [
      { id: "source", label: "Approved Founder photos and video only", path: CLONE_DIRS.originals },
      { id: "identity", label: "Lock face, voice, and likeness to those approved sources" },
      { id: "roles", label: "Role / wardrobe / environment references", path: CLONE_DIRS.references },
      { id: "generate-off", label: "Generation engine remains NOT_EXECUTED" },
      { id: "review-assets", label: "Founder accepts or rejects each future generated clip" },
      { id: "resolve", label: "Import accepted clips into the Resolve timeline" },
      { id: "finish", label: "Branding, music, captions, transitions, IFCDC PRODUCTIONS credit" },
      { id: "preview", label: "Show the finished version in HQ" },
      { id: "approval", label: "Founder approval before any release" },
    ],
    providers: CLONE_PROVIDERS,
    generator: {
      id: "approved-generator",
      status: "NOT_CONFIGURED",
      execution: "DISABLED",
      note: "No generation model is called. Accepted files are the only assets Resolve will import.",
    },
    instruction: String(instruction || ""),
  };
}

export function readLatestProvenance() {
  ensureCloneArchitecture();
  const files = readdirSync(CLONE_DIRS.provenance)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .reverse();
  if (!files.length) return null;
  try {
    return JSON.parse(readFileSync(join(CLONE_DIRS.provenance, files[0]), "utf8"));
  } catch {
    return null;
  }
}
