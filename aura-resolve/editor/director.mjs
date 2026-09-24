/**
 * Creative director — natural-language idea → full IFCDC PRODUCTION plan.
 * Credits always include IFCDC PRODUCTIONS.
 */
import { analyzeAssets } from "./assets.mjs";
import { parseRevision, formatFromRevisionOrInstruction, VERTICAL } from "./revision.mjs";
import { gatePayload } from "./gates.mjs";
import { readCreativeMemory } from "./memory.mjs";

const COMPANY = "IFCDC PRODUCTIONS";

function projectNameFrom(lower, options = {}) {
  if (options.projectName) return options.projectName;
  if (/phase\s*4|p4|multi.?format|master/.test(lower)) return "IFCDC-AURA-BARBERS-PROMO-P4";
  if (/barber/.test(lower) && /promo|promotional|commercial|tiktok|draft|youtube/.test(lower)) {
    return options.preferExistingV1 ? "IFCDC-AURA-BARBERS-PROMO-V1" : "IFCDC-AURA-BARBERS-PROMO-P4";
  }
  if (/barber/.test(lower)) return "IFCDC-AURA-BARBERS-COMMERCIAL";
  const slug = lower
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 28)
    .toUpperCase();
  return `IFCDC-AURA-${slug || "EDIT"}`.slice(0, 40);
}

/**
 * Full creative-director package for an IFCDC PRODUCTION.
 */
export function directCreativeIdea(text, options = {}) {
  const instruction = String(text || "").trim();
  const lower = instruction.toLowerCase();
  const memory = readCreativeMemory();
  const revision = options.revisionNote ? parseRevision(options.revisionNote, {
    instruction,
    projectName: options.projectName,
    preferences: memory.preferences,
  }) : null;
  const format = formatFromRevisionOrInstruction(revision, instruction) || VERTICAL;
  const durationMatch = /(\d+)\s*-?\s*second/.exec(lower);
  const durationSeconds = durationMatch
    ? Number(durationMatch[1])
    : /short|tiktok|promo/.test(lower)
      ? 12
      : 30;
  const project = projectNameFrom(lower, options);
  const assets = analyzeAssets({
    requiredRoles: ["logo", "broll", "app-store", "music"],
  });

  const concept = /barber/.test(lower)
    ? "A polished IFCDC Barbers App promo that opens on brand, proves the product with approved stills, then closes on CTA + IFCDC PRODUCTIONS credit."
    : "An IFCDC production that turns the Founder idea into a branded draft using only approved assets.";

  const script = [
    { beat: "HOOK", line: "IFCDC Barbers App — book your look." },
    { beat: "PROOF", line: "Real service stills. Real brand. No filler." },
    { beat: "BRAND", line: "IFCDC quality you can trust." },
    { beat: "CTA", line: "Book in the IFCDC Barbers App." },
    { beat: "CREDIT", line: `AN IFCDC PRODUCTION · ${COMPANY}` },
  ];

  const scenes = [
    { id: "open", label: "Brand open / logo", seconds: revision?.openSeconds ?? 2.2, visual: "Logo title card + gold accent" },
    { id: "proof-a", label: "Service proof A", seconds: Math.max(2.4, Math.floor(durationSeconds * 0.22)), visual: "Approved barber service still" },
    { id: "bridge", label: "Brand flash transition", seconds: 0.5, visual: "Visible gold flash (API has no native dissolve)" },
    { id: "proof-b", label: "Service proof B / store", seconds: Math.max(2.4, Math.floor(durationSeconds * 0.22)), visual: "Second approved still or store graphic" },
    { id: "brand", label: "Lower-third + title", seconds: 2.4, visual: "IFCDC lower-third template + product title" },
    { id: "cta", label: "CTA + captions", seconds: 2.2, visual: "Social CTA card with burned-in captions" },
    { id: "end", label: "End card + credit", seconds: revision?.fadeSeconds ? revision.fadeSeconds + 1.2 : 2.4, visual: "AN IFCDC PRODUCTION end card → fade" },
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
    intro: "IFCDC production kit intro / title card",
    lowerThird: "IFCDC Productions lower-third from existing logos + gold/black/ivory",
    titles: ["IFCDC Barbers App", "Book in the IFCDC Barbers App"],
    captions: ["IFCDC Barbers App", "Book today", COMPANY],
    endCard: "AN IFCDC PRODUCTION",
    transitions: "Visible brand-flash media between scenes",
    safeAreas: { vertical: "9:16 margins 10%", landscape: "16:9 margins 8%", square: "1:1 margins 8%" },
  };

  const productionCredits = {
    company: COMPANY,
    line: `AN IFCDC PRODUCTION`,
    retainedInMemory: true,
    applyAutomatically: true,
  };

  const editorial = {
    pacing: memory.preferences?.pacing || "medium",
    cutSelection: "logo → proof → brand flash → proof → CTA → end card",
    brollPlacement: "approved service stills only",
    musicSync: musicDirection.sync,
    leveling: `music volume ${musicDirection.level}`,
    dialoguePriority: "captions over bed; no VO unless supplied",
    ducking: musicDirection.ducking,
    hooks: "brand open in first 2s",
    closing: revision?.endingStyle || memory.preferences?.endings || "smooth-fade-to-black",
    brandConsistency: "IFCDC gold #C9A227 · black · ivory; company credit always present",
  };

  return {
    instruction,
    company: COMPANY,
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
    CTA: "Book in the IFCDC Barbers App",
    ENDING: editorial.closing,
    PRODUCTION_CREDITS: productionCredits,
    EDITORIAL: editorial,
    PURPOSE: /barber/.test(lower)
      ? "Promote the IFCDC Barbers App as an IFCDC PRODUCTION"
      : "Produce an IFCDC PRODUCTION from approved assets",
    AUDIENCE: format.label === "16:9" ? "YouTube / landscape" : format.label === "1:1" ? "Square social" : "Short-form social (TikTok / Reels)",
    DURATION: `${durationSeconds}s`,
    FORMAT: format.label,
    format,
    project,
    timeline: `${project}-TL`,
    revision,
    memoryPreferences: memory.preferences,
    formatsSupported: ["9:16", "16:9", "1:1"],
  };
}
