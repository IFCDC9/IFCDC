/**
 * Creative director — natural-language idea → full IFCDC PRODUCTION plan.
 * Every plan inherits PRODUCTION_COMPANY + PRODUCTION_IDENTITY by default.
 * brandPromoted is separate from the production company.
 */
import { analyzeAssets } from "./assets.mjs";
import { parseRevision, formatFromRevisionOrInstruction, VERTICAL } from "./revision.mjs";
import { gatePayload } from "./gates.mjs";
import { readCreativeMemory } from "./memory.mjs";
import {
  PRODUCTION_COMPANY,
  PRODUCTION_IDENTITY,
  PRODUCTION_CREDIT_LINE,
  inferBrandPromoted,
  inferProjectTitle,
  projectMetadataDefaults,
  createProductionProject,
} from "../brand/production-identity.mjs";

function projectNameFrom(lower, options = {}, brandPromoted = "EDIT") {
  if (options.projectName) return options.projectName;
  if (/phase\s*4|p4|multi.?format|master/.test(lower)) return "IFCDC-AURA-BARBERS-PROMO-P4";
  if (/barber/.test(lower) && /promo|promotional|commercial|tiktok|draft|youtube/.test(lower)) {
    return options.preferExistingV1 ? "IFCDC-AURA-BARBERS-PROMO-V1" : "IFCDC-AURA-BARBERS-PROMO-P4";
  }
  if (/barber/.test(lower)) return "IFCDC-AURA-BARBERS-COMMERCIAL";
  const slug = String(brandPromoted || "EDIT")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 28);
  return `IFCDC-AURA-${slug || "EDIT"}`.slice(0, 40);
}

/**
 * Full creative-director package for an IFCDC PRODUCTION.
 */
export function directCreativeIdea(text, options = {}) {
  const instruction = String(text || "").trim();
  const lower = instruction.toLowerCase();
  const memory = readCreativeMemory();
  const brandPromoted = options.brandPromoted || inferBrandPromoted(instruction);
  const projectTitle = options.projectTitle || inferProjectTitle(instruction, brandPromoted);
  const isBarbers = /barber/.test(lower);
  const revision = options.revisionNote
    ? parseRevision(options.revisionNote, {
        instruction,
        projectName: options.projectName,
        preferences: memory.preferences,
      })
    : null;
  const format = formatFromRevisionOrInstruction(revision, instruction) || VERTICAL;
  const durationMatch = /(\d+)\s*-?\s*second/.exec(lower);
  const durationSeconds = durationMatch
    ? Number(durationMatch[1])
    : /short|tiktok|promo/.test(lower)
      ? 12
      : 30;
  const project = projectNameFrom(lower, options, brandPromoted);
  const identityMeta = projectMetadataDefaults({
    instruction,
    project,
    brandPromoted,
  });
  let libraryProject = null;
  try {
    libraryProject = createProductionProject({ instruction, projectName: project });
  } catch {
    libraryProject = null;
  }

  const assets = analyzeAssets({
    requiredRoles: isBarbers ? ["logo", "broll", "app-store", "music"] : ["logo", "music"],
  });

  const concept = isBarbers
    ? "A polished IFCDC Barbers App promo that opens on brand, proves the product with approved stills, then closes on CTA + IFCDC PRODUCTION credit when the template asks."
    : `An IFCDC PRODUCTION promoting ${brandPromoted}: ${projectTitle}.`;

  const ctaLine = isBarbers ? "Book in the IFCDC Barbers App." : `Learn more about ${brandPromoted}.`;

  const script = [
    { beat: "HOOK", line: isBarbers ? "IFCDC Barbers App — book your look." : `${brandPromoted} — ${projectTitle}.` },
    { beat: "PROOF", line: isBarbers ? "Real service stills. Real brand. No filler." : `Approved media for ${brandPromoted}.` },
    { beat: "BRAND", line: "IFCDC quality you can trust." },
    { beat: "CTA", line: ctaLine },
    { beat: "CREDIT", line: `${PRODUCTION_CREDIT_LINE} · ${PRODUCTION_COMPANY}` },
  ];

  const scenes = [
    { id: "open", label: "Brand open / logo", seconds: revision?.openSeconds ?? 2.2, visual: "Logo title card + gold accent" },
    {
      id: "proof-a",
      label: "Service proof A",
      seconds: Math.max(2.4, Math.floor(durationSeconds * 0.22)),
      visual: isBarbers ? "Approved barber service still" : `Approved ${brandPromoted} still`,
    },
    { id: "bridge", label: "Brand flash transition", seconds: 0.5, visual: "Visible gold flash (API has no native dissolve)" },
    {
      id: "proof-b",
      label: "Service proof B / store",
      seconds: Math.max(2.4, Math.floor(durationSeconds * 0.22)),
      visual: isBarbers ? "Second approved still or store graphic" : `Second approved ${brandPromoted} still`,
    },
    { id: "brand", label: "Lower-third + title", seconds: 2.4, visual: "IFCDC lower-third template + product title (optional burn)" },
    { id: "cta", label: "CTA + captions", seconds: 2.2, visual: "Social CTA card with burned-in captions" },
    {
      id: "end",
      label: "End card + credit",
      seconds: revision?.fadeSeconds ? revision.fadeSeconds + 1.2 : 2.4,
      visual: `${PRODUCTION_CREDIT_LINE} end card → fade (when template asks)`,
    },
  ];

  const shotList = scenes.map((scene, index) => ({
    shot: index + 1,
    sceneId: scene.id,
    description: scene.label,
    duration: scene.seconds,
    framing: format.label,
    safeArea: "Keep titles inside 10% margins",
  }));

  const storyboard = scenes.map((scene) => ({
    id: scene.id,
    frame: scene.visual,
    notes: scene.label,
  }));

  const musicDirection = {
    source: assets.picked.find((p) => p.role === "music" || p.role === "music-fallback")?.id || "approved-ifcdc-bed",
    level: revision?.musicVolume ?? memory.preferences?.musicVolume ?? 0.28,
    ducking: "ffmpeg pre-shape (Fairlight fader not writable)",
    sync: "bed under proof + CTA; fade with ending",
  };

  const voiceoverPlan = {
    required: /voiceover|voice over|vo\b/.test(lower),
    lines: /voiceover|voice over|vo\b/.test(lower) ? script.map((s) => s.line) : [],
    status: /voiceover|voice over|vo\b/.test(lower) ? "MUST_SUPPLY_APPROVED_VO" : "none",
  };

  const graphics = {
    intro: "IFCDC PRODUCTIONS opening card (available)",
    lowerThird: "IFCDC Productions lower-third (available, not auto-burned)",
    titles: [brandPromoted, ctaLine.replace(/\.$/, "")],
    captions: [brandPromoted, PRODUCTION_COMPANY],
    endCard: PRODUCTION_CREDIT_LINE,
    transitions: "Visible brand-flash media between scenes",
    safeAreas: { vertical: "9:16 margins 10%", landscape: "16:9 margins 8%", square: "1:1 margins 8%" },
    visibleBrandingAutoBurn: false,
  };

  const productionCredits = {
    company: PRODUCTION_COMPANY,
    productionCompany: PRODUCTION_COMPANY,
    productionIdentity: PRODUCTION_IDENTITY,
    line: PRODUCTION_CREDIT_LINE,
    retainedInMemory: true,
    applyAutomatically: true,
    visibleAutoBurn: false,
    creditTemplate: identityMeta.creditTemplate,
  };

  const editorial = {
    pacing: memory.preferences?.pacing || "medium",
    cutSelection: "logo → proof → brand flash → proof → CTA → end card",
    brollPlacement: isBarbers ? "approved service stills only" : "approved program media only",
    musicSync: musicDirection.sync,
    leveling: `music volume ${musicDirection.level}`,
    dialoguePriority: "captions over bed; no VO unless supplied",
    ducking: musicDirection.ducking,
    hooks: "brand open in first 2s",
    closing: revision?.endingStyle || memory.preferences?.endings || "smooth-fade-to-black",
    brandConsistency: "IFCDC gold #C9A227 · black · ivory; production identity always in metadata",
  };

  return {
    instruction,
    company: PRODUCTION_COMPANY,
    productionCompany: PRODUCTION_COMPANY,
    productionIdentity: PRODUCTION_IDENTITY,
    PRODUCTION_COMPANY,
    PRODUCTION_IDENTITY,
    brandPromoted,
    projectTitle,
    projectMetadata: identityMeta,
    libraryProject: libraryProject
      ? { path: libraryProject.path, category: libraryProject.category, folder: libraryProject.folder }
      : null,
    publish: false,
    founderApprovalRequiredForFinal: true,
    draftAllowedWithoutFinalApproval: true,
    gate: gatePayload(revision ? "FOUNDER_REVISION" : "PLAN"),
    CONCEPT: concept,
    SCRIPT: script,
    SCENE_PLAN: scenes,
    SHOT_LIST: shotList,
    STORYBOARD: storyboard,
    ASSET_REQUIREMENTS: assets,
    MUSIC_DIRECTION: musicDirection,
    VOICEOVER_PLAN: voiceoverPlan,
    PACING: editorial.pacing,
    TRANSITIONS: graphics.transitions,
    GRAPHICS: graphics,
    TITLES: graphics.titles,
    CTA: ctaLine.replace(/\.$/, ""),
    ENDING: editorial.closing,
    PRODUCTION_CREDITS: productionCredits,
    EDITORIAL: editorial,
    PURPOSE: isBarbers
      ? "Promote the IFCDC Barbers App as an IFCDC PRODUCTION"
      : `Produce an IFCDC PRODUCTION promoting ${brandPromoted}`,
    AUDIENCE:
      format.label === "16:9"
        ? "YouTube / landscape"
        : format.label === "1:1"
          ? "Square social"
          : /train/.test(lower)
            ? "Internal / program audience"
            : "Short-form social (TikTok / Reels)",
    DURATION: `${durationSeconds}s`,
    FORMAT: format.label,
    format,
    project,
    timeline: `${project}-TL`,
    revision,
    memoryPreferences: memory.preferences,
    formatsSupported: ["9:16", "16:9", "1:1"],
    permanentRule: memory.permanentRules?.[0] || null,
  };
}
