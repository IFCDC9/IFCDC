/**
 * Permanent GLOBAL production identity for AURA Creative Video Production.
 * Organization-wide: every video/film/commercial/promo/social/training/music video/
 * documentary/short/branded piece created through this system is an IFCDC PRODUCTION.
 *
 * Distinguishes:
 * 1) PRODUCTION OWNERSHIP / METADATA (always IFCDC PRODUCTIONS)
 * 2) VISIBLE PRODUCTION BRANDING (template / Founder direction — not auto-burned)
 * 3) brandPromoted (product/program) vs productionCompany (never conflated)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "fs";
import { spawnSync } from "child_process";
import { homedir } from "os";
import { basename, dirname, join } from "path";
import { fileURLToPath } from "url";
import { stageBrandKit, pickAssets, BRAND_COLORS } from "./kit.mjs";

export const PRODUCTION_COMPANY = "IFCDC PRODUCTIONS";
export const PRODUCTION_IDENTITY = "IFCDC PRODUCTION";
export const PRODUCTION_CREDIT_LINE = "AN IFCDC PRODUCTION";
export const PRODUCTION_PRESENTS = "presents";

export const GLOBAL_IDENTITY_RULE = {
  id: "IFCDC_PRODUCTIONS_GLOBAL_IDENTITY",
  permanent: true,
  organizationWide: true,
  notLimitedToBarbersApp: true,
  productionCompany: PRODUCTION_COMPANY,
  productionIdentity: PRODUCTION_IDENTITY,
  productionCredit: PRODUCTION_CREDIT_LINE,
  applyToEveryNewProject: true,
  visibleBranding: {
    autoBurnFrames: false,
    followTemplateAndFounderDirection: true,
    cardsAvailable: true,
    note: "Default is metadata + available cards. Do not force IFCDC PRODUCTIONS onto every frame.",
  },
  structureTemplate: [
    "IFCDC PRODUCTIONS",
    "presents",
    "[PROJECT TITLE]",
    "An IFCDC Production",
  ],
  distinctions: {
    productionCompany: PRODUCTION_COMPANY,
    project: "e.g. IFCDC Barbers App Commercial — project title, not the company",
    brandPromoted: "e.g. IFCDC Barbers App — product/program being promoted",
    productionCredit: PRODUCTION_CREDIT_LINE,
  },
};

const ROOT = join(homedir(), "Library/Application Support/IFCDC/aura-resolve");
export const PRODUCTIONS_ROOT = join(ROOT, "IFCDC-PRODUCTIONS");
const IDENTITY_KIT_DIR = join(ROOT, "production-kit", "identity");
const RULE_PATH = join(PRODUCTIONS_ROOT, "PRODUCTION-IDENTITY-RULE.md");
const INDEX_PATH = join(PRODUCTIONS_ROOT, "index.json");
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "compose_identity_cards.py");

export const CATEGORY_FOLDERS = [
  "BARBERS-APP-COMMERCIAL",
  "MUSIC-VIDEOS",
  "SHORT-FILMS",
  "TRAINING",
  "SOCIAL",
  "DOCUMENTARIES",
  "PROGRAM-PROMOTIONS",
];

export const PROJECT_SUBFOLDERS = [
  "Creative Brief",
  "Assets",
  "Source Media",
  "Audio",
  "Graphics",
  "Generated Media",
  "Resolve Project",
  "Drafts",
  "Revisions",
  "Masters",
  "Social Deliverables",
  "Production Metadata",
];

const FORMATS = [
  { width: 1080, height: 1920, label: "9:16" },
  { width: 1920, height: 1080, label: "16:9" },
  { width: 1080, height: 1080, label: "1:1" },
];

/**
 * Infer brand being promoted from Founder instruction — never returns the production company.
 */
export function inferBrandPromoted(instruction = "") {
  const lower = String(instruction || "").toLowerCase();
  if (/barber/.test(lower)) return "IFCDC Barbers App";
  if (/youth/.test(lower)) return "IFCDC youth programs";
  if (/mentor|tapis/.test(lower)) return "IFCDC Mentor";
  if (/inclusive\s*community/.test(lower)) return "Inclusive Community";
  if (/swift.?ware|swiftware/.test(lower)) return "Swift-Ware";
  if (/crypto/.test(lower)) return "CryptoCoin";
  if (/music\s*(app|video)|ifcdc\s*music/.test(lower)) return "IFCDC Music";
  if (/training/.test(lower)) {
    const about = /about\s+(.+?)(?:\.|$)/i.exec(String(instruction || ""));
    if (about?.[1]) return about[1].trim().replace(/\s+/g, " ").slice(0, 80);
    return "IFCDC training";
  }
  if (/documentary/.test(lower)) return "IFCDC documentary subject";
  if (/short\s*film/.test(lower)) return "IFCDC short film subject";
  // Strip leading "Aura, make a …" noise and use a short subject phrase.
  const cleaned = String(instruction || "")
    .replace(/^aura[,:\s]*/i, "")
    .replace(/^(make|create|produce|shoot|edit)\s+(a|an|the)?\s*/i, "")
    .replace(/\b(short|vertical|tiktok|youtube|promo|promotional|commercial|video|film)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  if (cleaned && !/^ifcdc\s*productions?$/i.test(cleaned)) return cleaned || "IFCDC program";
  return "IFCDC program";
}

export function inferProjectCategory(instruction = "") {
  const lower = String(instruction || "").toLowerCase();
  if (/barber/.test(lower)) return "BARBERS-APP-COMMERCIAL";
  if (/music\s*video/.test(lower)) return "MUSIC-VIDEOS";
  if (/short\s*film/.test(lower)) return "SHORT-FILMS";
  if (/train|training|workshop/.test(lower)) return "TRAINING";
  if (/documentar/.test(lower)) return "DOCUMENTARIES";
  if (/tiktok|reel|social|instagram|story/.test(lower)) return "SOCIAL";
  if (/promo|promot|commercial|program/.test(lower)) return "PROGRAM-PROMOTIONS";
  return "PROGRAM-PROMOTIONS";
}

export function inferProjectTitle(instruction = "", brandPromoted = null) {
  const brand = brandPromoted || inferBrandPromoted(instruction);
  const lower = String(instruction || "").toLowerCase();
  if (/barber/.test(lower) && /commercial|promo/.test(lower)) return "IFCDC Barbers App Commercial";
  if (/train/.test(lower)) return `${brand} Training Video`;
  if (/music\s*video/.test(lower)) return `${brand} Music Video`;
  if (/documentar/.test(lower)) return `${brand} Documentary`;
  if (/short\s*film/.test(lower)) return `${brand} Short Film`;
  if (/commercial/.test(lower)) return `${brand} Commercial`;
  if (/promo/.test(lower)) return `${brand} Promo`;
  return `${brand} Video`;
}

export function slugProjectFolder(title) {
  return String(title || "PROJECT")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "PROJECT";
}

export function projectMetadataDefaults({ instruction = "", project = null, brandPromoted = null, category = null } = {}) {
  const brand = brandPromoted || inferBrandPromoted(instruction);
  const projectTitle = inferProjectTitle(instruction, brand);
  const cat = category || inferProjectCategory(instruction);
  return {
    PRODUCTION_COMPANY,
    PRODUCTION_IDENTITY,
    productionCompany: PRODUCTION_COMPANY,
    productionIdentity: PRODUCTION_IDENTITY,
    productionCredit: PRODUCTION_CREDIT_LINE,
    brandPromoted: brand,
    projectTitle,
    project: project || slugProjectFolder(projectTitle),
    category: cat,
    creditTemplate: {
      company: PRODUCTION_COMPANY,
      presents: PRODUCTION_PRESENTS,
      projectTitle,
      credit: PRODUCTION_CREDIT_LINE,
      lines: [PRODUCTION_COMPANY, PRODUCTION_PRESENTS, projectTitle, PRODUCTION_CREDIT_LINE],
    },
    visibleBrandingAutoBurn: false,
    publish: false,
    globalRuleId: GLOBAL_IDENTITY_RULE.id,
  };
}

export function ensureProductionsLibrary() {
  mkdirSync(PRODUCTIONS_ROOT, { recursive: true });
  for (const category of CATEGORY_FOLDERS) {
    const catDir = join(PRODUCTIONS_ROOT, category);
    mkdirSync(catDir, { recursive: true });
    writeFileSync(
      join(catDir, ".keep"),
      `# ${category} — IFCDC PRODUCTIONS category\n`,
      { flag: "w" },
    );
  }

  const ruleMd = `# IFCDC PRODUCTIONS — Permanent Global Identity Rule

**Status:** PERMANENT · ORGANIZATION-WIDE  
**Applies to:** Every NEW AURA video-production project (not limited to IFCDC Barbers App)

## Defaults (automatic — Founder does not need to say this)

- \`PRODUCTION_COMPANY=${PRODUCTION_COMPANY}\`
- \`PRODUCTION_IDENTITY=${PRODUCTION_IDENTITY}\`
- Production credit line: **${PRODUCTION_CREDIT_LINE}**

When the Founder says “Aura, make a video…”, the planner already knows: **THIS IS AN IFCDC PRODUCTION**.

## Distinctions

1. **PRODUCTION OWNERSHIP / METADATA** — all projects belong to ${PRODUCTION_COMPANY} internally. Always.
2. **VISIBLE PRODUCTION BRANDING** — follow the production template and Founder direction. Do NOT force “${PRODUCTION_COMPANY}” onto every frame.
3. **brandPromoted** — the product/program being promoted (e.g. IFCDC Barbers App, IFCDC youth programs). Never replace the production company.

## Credit structure AURA understands

\`\`\`
${PRODUCTION_COMPANY}
${PRODUCTION_PRESENTS}
[PROJECT TITLE]
${PRODUCTION_CREDIT_LINE}
\`\`\`

## Library root

\`${PRODUCTIONS_ROOT}\`

Categories: ${CATEGORY_FOLDERS.join(", ")}

Each project folder contains: ${PROJECT_SUBFOLDERS.join(" · ")}

## Cards

Reusable opening/closing/credits/lower-third/metadata assets live under \`production-kit/identity/\`.  
They are **available** when the template or Founder asks — not auto-stamped onto every existing draft.
Animation: still cards ship first; animated logo treatment is not yet rendered.
`;

  writeFileSync(RULE_PATH, ruleMd);

  const index = {
    company: PRODUCTION_COMPANY,
    productionIdentity: PRODUCTION_IDENTITY,
    root: PRODUCTIONS_ROOT,
    rulePath: RULE_PATH,
    categories: CATEGORY_FOLDERS,
    projectSubfolders: PROJECT_SUBFOLDERS,
    globalRule: GLOBAL_IDENTITY_RULE,
    projects: [],
    updatedAt: new Date().toISOString(),
  };

  // Index / migrate existing Barbers promo UNDER IFCDC PRODUCTIONS without deleting originals.
  const barbersSlug = "BARBERS-APP-COMMERCIAL";
  const barbersProject = "IFCDC-AURA-BARBERS-PROMO";
  const barbersDir = join(PRODUCTIONS_ROOT, barbersSlug, barbersProject);
  ensureProjectSkeleton(barbersDir, {
    projectTitle: "IFCDC Barbers App Commercial",
    brandPromoted: "IFCDC Barbers App",
    resolveProjects: [
      "IFCDC-AURA-BARBERS-PROMO-V1",
      "IFCDC-AURA-BARBERS-PROMO-P4",
      "IFCDC-AURA-BRIDGE-PROOF",
      "IFCDC-AURA-BRIDGE-PROOF-2",
      "IFCDC-NEXT LEVEL",
    ],
  });
  index.projects.push({
    category: barbersSlug,
    folder: barbersProject,
    path: barbersDir,
    brandPromoted: "IFCDC Barbers App",
    productionCompany: PRODUCTION_COMPANY,
    productionIdentity: PRODUCTION_IDENTITY,
    linkedResolveProjects: [
      "IFCDC-AURA-BARBERS-PROMO-V1",
      "IFCDC-AURA-BARBERS-PROMO-P4",
    ],
    protectedOriginalsPreserved: [
      "IFCDC-AURA-BARBERS-PROMO-V1",
      "IFCDC-AURA-BARBERS-PROMO-P4",
      "IFCDC-AURA-BRIDGE-PROOF",
      "IFCDC-AURA-BRIDGE-PROOF-2",
      "IFCDC-NEXT LEVEL",
    ],
    note: "Indexed under IFCDC PRODUCTIONS; originals not deleted or moved.",
  });

  writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2));
  return index;
}

export function ensureProjectSkeleton(projectDir, meta = {}) {
  mkdirSync(projectDir, { recursive: true });
  for (const sub of PROJECT_SUBFOLDERS) {
    mkdirSync(join(projectDir, sub), { recursive: true });
  }
  const metadata = {
    ...projectMetadataDefaults({
      instruction: meta.instruction || "",
      brandPromoted: meta.brandPromoted,
      project: basename(projectDir),
    }),
    projectTitle: meta.projectTitle || inferProjectTitle(meta.instruction || "", meta.brandPromoted),
    brandPromoted: meta.brandPromoted || inferBrandPromoted(meta.instruction || ""),
    resolveProjects: meta.resolveProjects || [],
    createdAt: new Date().toISOString(),
  };
  writeFileSync(
    join(projectDir, "Production Metadata", "project.json"),
    JSON.stringify(metadata, null, 2),
  );
  writeFileSync(
    join(projectDir, "Creative Brief", "BRIEF.md"),
    `# ${metadata.projectTitle}\n\nProduction company: ${PRODUCTION_COMPANY}\nIdentity: ${PRODUCTION_IDENTITY}\nBrand promoted: ${metadata.brandPromoted}\nCredit: ${PRODUCTION_CREDIT_LINE}\n`,
  );
  // Soft-index resolve project names (no delete / no move of protected originals).
  if (Array.isArray(meta.resolveProjects)) {
    writeFileSync(
      join(projectDir, "Resolve Project", "linked-resolve-projects.json"),
      JSON.stringify(
        {
          note: "Index only — originals remain in Resolve / aura-resolve renders. Do not delete.",
          projects: meta.resolveProjects,
        },
        null,
        2,
      ),
    );
  }
  return metadata;
}

/**
 * Create a new production project folder under IFCDC-PRODUCTIONS with full skeleton.
 */
export function createProductionProject({ instruction, projectName } = {}) {
  ensureProductionsLibrary();
  const meta = projectMetadataDefaults({ instruction, project: projectName });
  const folder = slugProjectFolder(projectName || meta.projectTitle);
  const projectDir = join(PRODUCTIONS_ROOT, meta.category, folder);
  const record = ensureProjectSkeleton(projectDir, {
    instruction,
    brandPromoted: meta.brandPromoted,
    projectTitle: meta.projectTitle,
  });
  // Refresh index entry
  let index = { projects: [] };
  try {
    index = JSON.parse(readFileSync(INDEX_PATH, "utf8"));
  } catch {
    /* rebuild via ensure */
  }
  index.projects = [
    {
      category: meta.category,
      folder,
      path: projectDir,
      brandPromoted: record.brandPromoted,
      productionCompany: PRODUCTION_COMPANY,
      productionIdentity: PRODUCTION_IDENTITY,
      projectTitle: record.projectTitle,
      createdAt: record.createdAt,
    },
    ...(index.projects || []).filter((p) => !(p.category === meta.category && p.folder === folder)),
  ].slice(0, 80);
  index.updatedAt = new Date().toISOString();
  writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2));
  return { ...record, path: projectDir, category: meta.category, folder };
}

/**
 * Build reusable identity card assets (still). Animation not yet rendered.
 */
export function ensureIdentityCardAssets({ force = false } = {}) {
  mkdirSync(IDENTITY_KIT_DIR, { recursive: true });
  const indexPath = join(IDENTITY_KIT_DIR, "index.json");
  if (!force && existsSync(indexPath)) {
    try {
      return JSON.parse(readFileSync(indexPath, "utf8"));
    } catch {
      /* rebuild */
    }
  }

  const brand = stageBrandKit({ intoMedia: false });
  const logos = pickAssets(brand, ["logo"]);
  const logoPath = logos[0]?.mediaPath || logos[0]?.source || null;

  const result = spawnSync("python3", [SCRIPT], {
    encoding: "utf8",
    input: JSON.stringify({
      outDir: IDENTITY_KIT_DIR,
      logoPath,
      formats: FORMATS,
      company: PRODUCTION_COMPANY,
      credit: PRODUCTION_CREDIT_LINE,
      presents: PRODUCTION_PRESENTS,
      colors: BRAND_COLORS,
    }),
  });
  if (result.status !== 0) {
    throw new Error(`identity card compose failed: ${(result.stderr || result.stdout || "").slice(-500)}`);
  }

  let manifest;
  try {
    manifest = JSON.parse((result.stdout || "").trim().split("\n").pop()).manifest;
  } catch {
    manifest = JSON.parse(readFileSync(indexPath, "utf8"));
  }

  manifest.company = PRODUCTION_COMPANY;
  manifest.productionIdentity = PRODUCTION_IDENTITY;
  manifest.credit = PRODUCTION_CREDIT_LINE;
  manifest.animationStatus = "NOT_YET_RENDERED";
  manifest.animationNote =
    "Still opening/closing cards ship from existing IFCDC logos + approved colors. Animated logo treatment is not yet rendered.";
  manifest.autoBurnFrames = false;
  manifest.usage =
    "Available when template or Founder asks. Do not stamp onto accepted drafts unless template already includes end credit.";

  // Project template record + metadata stamp (file/project metadata, not burned-in).
  const templateRecord = {
    id: "ifcdc-productions-project-template",
    productionCompany: PRODUCTION_COMPANY,
    productionIdentity: PRODUCTION_IDENTITY,
    productionCredit: PRODUCTION_CREDIT_LINE,
    subfolders: PROJECT_SUBFOLDERS,
    categories: CATEGORY_FOLDERS,
    creditStructure: GLOBAL_IDENTITY_RULE.structureTemplate,
  };
  writeFileSync(join(IDENTITY_KIT_DIR, "project-template.json"), JSON.stringify(templateRecord, null, 2));
  writeFileSync(
    join(IDENTITY_KIT_DIR, "metadata-stamp.json"),
    JSON.stringify(
      {
        kind: "metadata-stamp",
        burnIntoFrames: false,
        PRODUCTION_COMPANY,
        PRODUCTION_IDENTITY,
        productionCredit: PRODUCTION_CREDIT_LINE,
        note: "Stamp into file/project metadata only — not every frame.",
      },
      null,
      2,
    ),
  );
  manifest.items = manifest.items || [];
  manifest.items.push(
    { id: "project-template", role: "project-template", path: join(IDENTITY_KIT_DIR, "project-template.json") },
    { id: "metadata-stamp", role: "metadata-stamp", path: join(IDENTITY_KIT_DIR, "metadata-stamp.json") },
  );

  writeFileSync(indexPath, JSON.stringify(manifest, null, 2));

  // Stage key cards into media for Resolve import when requested.
  const media = join(ROOT, "media");
  mkdirSync(media, { recursive: true });
  for (const item of manifest.items || []) {
    if (!item.path || !existsSync(item.path) || !/\.png$/i.test(item.path)) continue;
    const dest = join(media, `identity-${basename(item.path)}`);
    copyFileSync(item.path, dest);
    item.mediaPath = dest;
    item.mediaName = basename(dest);
  }
  writeFileSync(indexPath, JSON.stringify(manifest, null, 2));
  return manifest;
}

export function readIdentityKit() {
  const indexPath = join(IDENTITY_KIT_DIR, "index.json");
  if (!existsSync(indexPath)) return ensureIdentityCardAssets({ force: true });
  try {
    return JSON.parse(readFileSync(indexPath, "utf8"));
  } catch {
    return ensureIdentityCardAssets({ force: true });
  }
}

export function identityAsset(role, formatLabel = "9:16") {
  const kit = readIdentityKit();
  const suffix = String(formatLabel).replace(":", "x");
  const items = kit.items || [];
  return (
    items.find((item) => item.role === role && String(item.format || "").replace(":", "x") === suffix) ||
    items.find((item) => item.role === role) ||
    null
  );
}

/** Full bootstrap: library folders + rule file + identity cards. */
export function ensureGlobalProductionIdentity({ forceCards = false } = {}) {
  const library = ensureProductionsLibrary();
  const cards = ensureIdentityCardAssets({ force: forceCards });
  return {
    productionCompany: PRODUCTION_COMPANY,
    productionIdentity: PRODUCTION_IDENTITY,
    productionsRoot: PRODUCTIONS_ROOT,
    rulePath: RULE_PATH,
    library,
    cards: {
      itemCount: (cards.items || []).length,
      animationStatus: cards.animationStatus,
      autoBurnFrames: false,
    },
    globalRule: GLOBAL_IDENTITY_RULE,
  };
}
