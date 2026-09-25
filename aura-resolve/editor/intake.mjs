/**
 * Phase 7 — natural-language Founder intake → structured production plan fields.
 * Examples: 30s barbers commercial; vertical TikTok; gold branding + aggressive music;
 * replace scene 3 keep everything else; also make a YouTube version.
 */
import { inferBrandPromoted, PRODUCTION_COMPANY, PRODUCTION_IDENTITY } from "../brand/production-identity.mjs";

const VERTICAL = { width: 1080, height: 1920, label: "9:16" };
const LANDSCAPE = { width: 1920, height: 1080, label: "16:9" };
const SQUARE = { width: 1080, height: 1080, label: "1:1" };

export const PHASE7_GATE_STATES = [
  "FOUNDER_IDEA",
  "AURA_PLAN",
  "ASSET_SEARCH",
  "GENERATION",
  "RESOLVE_BUILD",
  "DRAFT",
  "HQ_PREVIEW",
  "FOUNDER_REVISION",
  "FOUNDER_APPROVAL",
  "MASTER",
  "DISTRIBUTION_AUTHORIZATION",
];

function formatFromText(lower) {
  if (/square|1\s*:\s*1/.test(lower)) return SQUARE;
  if (/vertical|tiktok|reel|story|9\s*:\s*16/.test(lower)) return VERTICAL;
  if (/landscape|youtube|16\s*:\s*9/.test(lower)) return LANDSCAPE;
  return VERTICAL;
}

function inferProjectType(lower) {
  if (/commercial/.test(lower)) return "commercial";
  if (/music\s*video/.test(lower)) return "music_video";
  if (/documentar/.test(lower)) return "documentary";
  if (/short\s*film/.test(lower)) return "short_film";
  if (/train|bumper/.test(lower)) return "training_bumper";
  if (/promo|promotional/.test(lower)) return "promotional";
  if (/social|tiktok|reel|instagram/.test(lower)) return "social";
  return "promotional";
}

function inferStyle(lower) {
  const styles = [];
  if (/gold|brand/.test(lower)) styles.push("gold_branding");
  if (/aggressive|hard|punchy|energy/.test(lower)) styles.push("aggressive");
  if (/calm|soft|elegant|polish/.test(lower)) styles.push("polished");
  if (/youth/.test(lower)) styles.push("youth_program");
  if (!styles.length) styles.push("ifcdc_branded");
  return styles.join("+");
}

function inferMusic(lower) {
  if (/aggressive|hard|punchy|energy/.test(lower)) return "aggressive_bed";
  if (/quiet|soft|turn\s*(the\s*)?music\s*down|no\s*music/.test(lower)) return "low_or_none";
  if (/music|soundtrack|bed|nite.?day/.test(lower)) return "approved_ifcdc_bed";
  return "approved_ifcdc_bed_if_available";
}

function inferVoice(lower) {
  if (/synthetic\s*voice|tts|voice.?over|narrat/.test(lower)) return "synthetic_speech_if_requested";
  if (/founder\s*voice|clone\s*voice|my\s*voice/.test(lower)) return "founder_clone_blocked_until_approved";
  return "none";
}

function inferPlatform(lower) {
  if (/tiktok|reel|story/.test(lower)) return "tiktok";
  if (/youtube/.test(lower)) return "youtube";
  if (/instagram/.test(lower)) return "instagram";
  if (/internal|train/.test(lower)) return "internal";
  return "short_form_social";
}

function inferScenes(lower, durationSeconds) {
  const replaceScene = /replace\s*scene\s*(\d+)/i.exec(lower);
  const base = [
    { id: "open", label: "Brand open / title", order: 1 },
    { id: "proof", label: "Program / product proof", order: 2 },
    { id: "brand", label: "Branding lower-third", order: 3 },
    { id: "cta", label: "CTA", order: 4 },
    { id: "end", label: "End card + credit", order: 5 },
  ];
  if (replaceScene) {
    const n = Number(replaceScene[1]);
    return base.map((s) =>
      s.order === n
        ? { ...s, revision: "REPLACE", keepEverythingElse: /keep\s*everything\s*else/i.test(lower) }
        : { ...s, revision: "KEEP" },
    );
  }
  // Short drafts collapse to fewer beats
  if (durationSeconds <= 12) {
    return [
      { id: "open", label: "Brand open", order: 1 },
      { id: "proof", label: "Approved motion / still proof", order: 2 },
      { id: "cta", label: "CTA + end credit", order: 3 },
    ];
  }
  return base;
}

function projectNameFrom(lower, brandPromoted, options = {}) {
  if (options.projectName) return options.projectName;
  if (/youth/.test(lower) && /promo|promotional|program/.test(lower)) {
    return "IFCDC-AURA-YOUTH-PROMO-P7";
  }
  if (/phase\s*7|p7/.test(lower)) {
    const slug = String(brandPromoted || "EDIT")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 20);
    return `IFCDC-AURA-${slug || "EDIT"}-P7`.slice(0, 40);
  }
  const slug = String(brandPromoted || "EDIT")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
  return `IFCDC-AURA-${slug || "EDIT"}-P7`.slice(0, 40);
}

/**
 * Parse Founder natural language into Phase 7 structured plan fields.
 */
export function parseFounderIntake(text, options = {}) {
  const instruction = String(text || "").trim();
  const lower = instruction.toLowerCase();
  const format = formatFromText(lower);
  const durationMatch = /(\d+)\s*-?\s*second/.exec(lower);
  const durationSeconds = durationMatch
    ? Number(durationMatch[1])
    : /short|tiktok|promo|bumper/.test(lower)
      ? 10
      : 30;
  const brandPromoted = options.brandPromoted || inferBrandPromoted(instruction);
  const alsoYoutube = /also\s*make\s*a\s*youtube|youtube\s*version|and\s*a\s*youtube/.test(lower);
  const project = projectNameFrom(lower, brandPromoted, options);

  const fields = {
    PROJECT_TYPE: inferProjectType(lower),
    TARGET_AUDIENCE:
      format.label === "16:9"
        ? "YouTube / landscape viewers"
        : /youth/.test(lower)
          ? "Youth program participants + community"
          : format.label === "1:1"
            ? "Square social"
            : "Short-form social (TikTok / Reels)",
    DURATION: `${durationSeconds}s`,
    DURATION_SECONDS: durationSeconds,
    ASPECT_RATIO: format.label,
    BRAND: brandPromoted,
    STYLE: inferStyle(lower),
    SCENES: inferScenes(lower, durationSeconds),
    VOICE: inferVoice(lower),
    MUSIC: inferMusic(lower),
    CTA: /barber/.test(lower)
      ? "Book in the IFCDC Barbers App"
      : /youth/.test(lower)
        ? "Join IFCDC youth programs"
        : `Learn more · ${brandPromoted}`,
    PLATFORM: inferPlatform(lower),
    EXISTING_ASSETS_TO_USE: [],
    NEW_ASSETS_REQUIRED: [],
    FOUNDER_APPROVAL_REQUIRED: true,
  };

  return {
    phase: 7,
    instruction,
    company: PRODUCTION_COMPANY,
    productionCompany: PRODUCTION_COMPANY,
    productionIdentity: PRODUCTION_IDENTITY,
    brandPromoted,
    project,
    projectTitle: `${brandPromoted} Promo`,
    format,
    alsoYoutube,
    publish: false,
    gate: "FOUNDER_IDEA",
    gateStates: PHASE7_GATE_STATES,
    fields,
    NATURAL_LANGUAGE_INTAKE: fields,
  };
}

export { VERTICAL, LANDSCAPE, SQUARE };
