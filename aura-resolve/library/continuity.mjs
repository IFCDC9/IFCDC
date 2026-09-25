/**
 * Continuity memory across scenes — persisted on the project.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { PRODUCTIONS_ROOT } from "../brand/production-identity.mjs";

export function defaultContinuity({ brandPromoted, format, project } = {}) {
  return {
    version: 1,
    project: project || null,
    characterIdentity: {
      subject: "non-person / brand-led unless Founder clone approved",
      founderClone: false,
      notes: [],
    },
    wardrobe: { locked: false, description: null, history: [] },
    hairstyle: { locked: false, description: null, history: [] },
    accessories: { locked: false, items: [], history: [] },
    environment: { locked: false, description: null, history: [] },
    lighting: { locked: false, description: "IFCDC gold accent on black / ivory", history: [] },
    camera: { locked: false, framing: format?.label || "9:16", history: [] },
    color: { locked: true, palette: ["#C9A227", "#0B0B0B", "#F5F0E6"], history: [] },
    aspectRatio: format?.label || "9:16",
    props: { items: [], history: [] },
    brand: {
      productionCompany: "IFCDC PRODUCTIONS",
      productionIdentity: "IFCDC PRODUCTION",
      brandPromoted: brandPromoted || null,
      visibleAutoBurn: false,
    },
    voice: { locked: false, source: null, cloneApproved: false, history: [] },
    sceneOrder: [],
    updatedAt: new Date().toISOString(),
  };
}

export function continuityPath(project) {
  const safe = String(project || "UNKNOWN")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .slice(0, 64);
  return join(PRODUCTIONS_ROOT, "continuity", `${safe}.json`);
}

export function readProjectContinuity(project, seed = {}) {
  mkdirSync(join(PRODUCTIONS_ROOT, "continuity"), { recursive: true });
  const path = continuityPath(project);
  if (!existsSync(path)) {
    const created = defaultContinuity({ ...seed, project });
    writeFileSync(path, JSON.stringify(created, null, 2));
    return created;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return defaultContinuity({ ...seed, project });
  }
}

/**
 * Merge continuity updates without wiping prior locked fields' history.
 */
export function updateProjectContinuity(project, patch = {}) {
  const current = readProjectContinuity(project);
  const next = {
    ...current,
    ...patch,
    characterIdentity: { ...current.characterIdentity, ...(patch.characterIdentity || {}) },
    wardrobe: appendField(current.wardrobe, patch.wardrobe),
    hairstyle: appendField(current.hairstyle, patch.hairstyle),
    accessories: appendField(current.accessories, patch.accessories),
    environment: appendField(current.environment, patch.environment),
    lighting: appendField(current.lighting, patch.lighting),
    camera: appendField(current.camera, patch.camera),
    color: appendField(current.color, patch.color),
    props: appendField(current.props, patch.props),
    brand: { ...current.brand, ...(patch.brand || {}) },
    voice: appendField(current.voice, patch.voice),
    sceneOrder: patch.sceneOrder || current.sceneOrder,
    aspectRatio: patch.aspectRatio || current.aspectRatio,
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(continuityPath(project), JSON.stringify(next, null, 2));
  return next;
}

function appendField(prev = {}, patch) {
  if (!patch) return prev;
  const history = Array.isArray(prev.history) ? [...prev.history] : [];
  if (patch.description && patch.description !== prev.description) {
    history.push({ at: new Date().toISOString(), previous: prev.description, next: patch.description });
  }
  return { ...prev, ...patch, history: history.slice(-40) };
}

export function continuityFromScenes(scenes = [], seed = {}) {
  const continuity = readProjectContinuity(seed.project || "UNNAMED", seed);
  return updateProjectContinuity(seed.project || continuity.project, {
    sceneOrder: scenes.map((s, i) => ({ order: i + 1, id: s.id, label: s.label })),
    brand: {
      productionCompany: "IFCDC PRODUCTIONS",
      productionIdentity: "IFCDC PRODUCTION",
      brandPromoted: seed.brandPromoted || continuity.brand?.brandPromoted || null,
      visibleAutoBurn: false,
    },
    aspectRatio: seed.format?.label || continuity.aspectRatio,
    camera: { framing: seed.format?.label || continuity.aspectRatio },
  });
}
